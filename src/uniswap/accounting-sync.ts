import type { PublicClient } from 'viem'
import { getAddress, zeroAddress } from 'viem'
import { randomUUID } from 'node:crypto'
import { v3PositionManagerAbi, v4PoolManagerAbi, v4StateViewAbi, type DeploymentAddresses } from '../contracts.js'
import type { PositionCashflowWrite, StateDatabase } from '../state/database.js'
import type { PortfolioPriceOracle } from './price-oracle.js'
import { getAmountsForLiquidity, tokenIdSalt, type PositionData } from './positions.js'

const CUSTOM_LIQUIDITY_DELTA_FLAGS = 0x3n
const BLOCK_CHUNK = 50_000n
const Q128 = 2n ** 128n
const UINT256 = 2n ** 256n

export async function syncPositionAccounting(input: {
  client: PublicClient
  db: StateDatabase
  data: PositionData
  oracle: PortfolioPriceOracle
  deployments: DeploymentAddresses
  blockNumber: bigint
}) {
  if (input.data.liquidity === 0n) return
  const leaseOwnerId = randomUUID()
  if (!(await input.db.acquireAccountingLease(input.data.id, leaseOwnerId))) return
  try {
    if (input.data.hooks && (BigInt(input.data.hooks) & CUSTOM_LIQUIDITY_DELTA_FLAGS) !== 0n) {
      throw new Error('The pool hook changes liquidity deltas; accounting cannot be reconstructed safely')
    }
    const mint = await ensureMintInfo(input.client, input.db, input.data)
    if (!mint) throw new Error('Mint block was not available from Blockscout')
    if (input.data.position.version === 'v3') await syncV3({ ...input, mintBlock: mint.blockNumber, leaseOwnerId })
    else await syncV4({ ...input, mintBlock: mint.blockNumber, leaseOwnerId })
    await input.db.commitAccountingBlock({ positionId: input.data.id, blockNumber: input.blockNumber, status: 'synced', leaseOwnerId })
  } catch (error) {
    await input.db.markAccountingFailure(input.data.id, error instanceof Error ? error.message : String(error), leaseOwnerId)
  } finally {
    await input.db.releaseAccountingLease(input.data.id, leaseOwnerId)
  }
}

async function syncV4(input: Parameters<typeof syncPositionAccounting>[0] & { mintBlock: bigint; leaseOwnerId: string }) {
  if (!input.deployments.v4PoolManager || !input.deployments.v4StateView || !input.data.poolId) throw new Error('Uniswap v4 accounting contracts are not configured')
  const existing = await input.db.getAccounting(input.data.id)
  const fromBlock = existing.lastSyncedBlock != null ? existing.lastSyncedBlock + 1n : input.mintBlock
  if (fromBlock > input.blockNumber) return
  const logs = await getEventsChunked(input.client, {
    address: input.deployments.v4PoolManager,
    abi: v4PoolManagerAbi,
    eventName: 'ModifyLiquidity',
    args: { id: input.data.poolId },
    fromBlock,
    toBlock: input.blockNumber,
  })
  const matching = logs.filter((log) =>
    log.args.tickLower === input.data.tickLower &&
    log.args.tickUpper === input.data.tickUpper &&
    log.args.salt?.toLowerCase() === tokenIdSalt(input.data.position.tokenId).toLowerCase(),
  )
  if (existing.lastSyncedBlock == null && matching.length === 0) throw new Error('No v4 liquidity history was found for this NFT')
  const blockCounts = new Map<string, number>()
  for (const log of matching) {
    const key = log.blockNumber?.toString() ?? 'unknown'
    blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1)
  }
  if ([...blockCounts.values()].some((count) => count > 1)) throw new Error('Multiple v4 liquidity modifications in one block cannot be ordered through historical eth_call')

  for (const log of matching) {
    if (log.blockNumber == null || log.transactionHash == null || log.logIndex == null || log.args.liquidityDelta == null) continue
    const beforeBlock = log.blockNumber > 0n ? log.blockNumber - 1n : 0n
    const [slot0, beforePosition, beforeGrowth] = await Promise.all([
      input.client.readContract({ address: input.deployments.v4StateView, abi: v4StateViewAbi, functionName: 'getSlot0', args: [input.data.poolId], blockNumber: log.blockNumber }),
      input.client.readContract({
        address: input.deployments.v4StateView,
        abi: v4StateViewAbi,
        functionName: 'getPositionInfo',
        args: [input.data.poolId, input.data.position.manager, input.data.tickLower, input.data.tickUpper, tokenIdSalt(input.data.position.tokenId)],
        blockNumber: beforeBlock,
      }),
      input.client.readContract({ address: input.deployments.v4StateView, abi: v4StateViewAbi, functionName: 'getFeeGrowthInside', args: [input.data.poolId, input.data.tickLower, input.data.tickUpper], blockNumber: beforeBlock }),
    ])
    const fee0 = (modSub(beforeGrowth[0], beforePosition[1]) * beforePosition[0]) / Q128
    const fee1 = (modSub(beforeGrowth[1], beforePosition[2]) * beforePosition[0]) / Q128
    const cashflows: PositionCashflowWrite[] = []
    const timestampMs = await blockTimestamp(input.client, log.blockNumber)
    if (fee0 > 0n || fee1 > 0n) {
      cashflows.push({
        positionId: input.data.id,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        timestampMs,
        type: 'fee',
        token0Raw: fee0,
        token1Raw: fee1,
        valueUsdg: await valuePair(input.oracle, input.data, fee0, fee1, log.blockNumber),
      })
    }
    if (log.args.liquidityDelta !== 0n) {
      const delta = log.args.liquidityDelta < 0n ? -log.args.liquidityDelta : log.args.liquidityDelta
      const [amount0, amount1] = getAmountsForLiquidity(slot0[0], slot0[1], input.data.tickLower, input.data.tickUpper, delta)
      const value = await valuePair(input.oracle, input.data, amount0, amount1, log.blockNumber)
      cashflows.push({
        positionId: input.data.id,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        timestampMs,
        type: log.args.liquidityDelta > 0n ? 'deposit' : 'withdrawal',
        token0Raw: amount0,
        token1Raw: amount1,
        valueUsdg: value,
      })
    }
    await input.db.commitAccountingBlock({
      positionId: input.data.id,
      blockNumber: log.blockNumber,
      status: log.blockNumber === input.blockNumber ? 'synced' : 'partial',
      cashflows,
      leaseOwnerId: input.leaseOwnerId,
    })
  }
}

async function syncV3(input: Parameters<typeof syncPositionAccounting>[0] & { mintBlock: bigint; leaseOwnerId: string }) {
  const existing = await input.db.getAccounting(input.data.id)
  const fromBlock = existing.lastSyncedBlock != null ? existing.lastSyncedBlock + 1n : input.mintBlock
  if (fromBlock > input.blockNumber) return
  const [increases, decreases, collects] = await Promise.all([
    getEventsChunked(input.client, { address: input.data.position.manager, abi: v3PositionManagerAbi, eventName: 'IncreaseLiquidity', args: { tokenId: input.data.position.tokenId }, fromBlock, toBlock: input.blockNumber }),
    getEventsChunked(input.client, { address: input.data.position.manager, abi: v3PositionManagerAbi, eventName: 'DecreaseLiquidity', args: { tokenId: input.data.position.tokenId }, fromBlock, toBlock: input.blockNumber }),
    getEventsChunked(input.client, { address: input.data.position.manager, abi: v3PositionManagerAbi, eventName: 'Collect', args: { tokenId: input.data.position.tokenId }, fromBlock, toBlock: input.blockNumber }),
  ])
  const events = [
    ...increases.map((log) => ({ kind: 'increase' as const, log })),
    ...decreases.map((log) => ({ kind: 'decrease' as const, log })),
    ...collects.map((log) => ({ kind: 'collect' as const, log })),
  ].sort((left, right) => Number((left.log.blockNumber ?? 0n) - (right.log.blockNumber ?? 0n)) || Number((left.log.logIndex ?? 0) - (right.log.logIndex ?? 0)))
  if (existing.lastSyncedBlock == null && increases.length === 0) throw new Error('No v3 deposit history was found for this NFT')
  const [storedPending0, storedPending1] = await input.db.getPendingPrincipal(input.data.id)
  let pending0 = storedPending0
  let pending1 = storedPending1
  for (const blockEvents of groupEventsByBlock(events)) {
    const blockNumber = blockEvents[0]!.log.blockNumber!
    const timestampMs = await blockTimestamp(input.client, blockNumber)
    const cashflows: PositionCashflowWrite[] = []
    for (const event of blockEvents) {
      const { log } = event
      if (log.transactionHash == null || log.logIndex == null) continue
      if (event.kind === 'decrease') {
        const decrease0 = log.args.amount0 ?? 0n
        const decrease1 = log.args.amount1 ?? 0n
        pending0 += decrease0
        pending1 += decrease1
        cashflows.push({ positionId: input.data.id, txHash: log.transactionHash, logIndex: log.logIndex, blockNumber, timestampMs, type: 'decrease', token0Raw: decrease0, token1Raw: decrease1, valueUsdg: 0 })
        continue
      }
      const raw0 = log.args.amount0 ?? 0n
      const raw1 = log.args.amount1 ?? 0n
      let type: 'deposit' | 'fee' = 'deposit'
      let amount0 = raw0
      let amount1 = raw1
      if (event.kind === 'collect') {
        const principal0 = raw0 < pending0 ? raw0 : pending0
        const principal1 = raw1 < pending1 ? raw1 : pending1
        if (principal0 > 0n || principal1 > 0n) {
          const value = await valuePair(input.oracle, input.data, principal0, principal1, blockNumber)
          cashflows.push({ positionId: input.data.id, txHash: log.transactionHash, logIndex: log.logIndex, blockNumber, timestampMs, type: 'withdrawal', token0Raw: principal0, token1Raw: principal1, valueUsdg: value })
          cashflows.push({ positionId: input.data.id, txHash: log.transactionHash, logIndex: log.logIndex, blockNumber, timestampMs, type: 'principal_collect', token0Raw: principal0, token1Raw: principal1, valueUsdg: 0 })
        }
        pending0 -= principal0
        pending1 -= principal1
        amount0 = raw0 - principal0
        amount1 = raw1 - principal1
        type = 'fee'
      }
      if (amount0 === 0n && amount1 === 0n) continue
      const value = await valuePair(input.oracle, input.data, amount0, amount1, blockNumber)
      cashflows.push({ positionId: input.data.id, txHash: log.transactionHash, logIndex: log.logIndex, blockNumber, timestampMs, type, token0Raw: amount0, token1Raw: amount1, valueUsdg: value })
    }
    await input.db.commitAccountingBlock({
      positionId: input.data.id,
      blockNumber,
      status: blockNumber === input.blockNumber ? 'synced' : 'partial',
      cashflows,
      leaseOwnerId: input.leaseOwnerId,
    })
  }
  const pending = await input.db.getPendingPrincipal(input.data.id)
  const newlyIndexed0 = pending[0] - (input.data.pendingPrincipal0 ?? 0n)
  const newlyIndexed1 = pending[1] - (input.data.pendingPrincipal1 ?? 0n)
  if (newlyIndexed0 > 0n) input.data.unclaimed0 = input.data.unclaimed0 > newlyIndexed0 ? input.data.unclaimed0 - newlyIndexed0 : 0n
  if (newlyIndexed1 > 0n) input.data.unclaimed1 = input.data.unclaimed1 > newlyIndexed1 ? input.data.unclaimed1 - newlyIndexed1 : 0n
}

function groupEventsByBlock<T extends { log: { blockNumber?: bigint | null } }>(events: T[]) {
  const groups: T[][] = []
  for (const event of events) {
    if (event.log.blockNumber == null) continue
    const current = groups.at(-1)
    if (!current || current[0]!.log.blockNumber !== event.log.blockNumber) groups.push([event])
    else current.push(event)
  }
  return groups
}

async function ensureMintInfo(client: PublicClient, db: StateDatabase, data: PositionData) {
  const stored = await db.getPosition(data.id)
  if (stored?.mintBlock != null && stored.mintTimestampMs != null) return { blockNumber: stored.mintBlock, timestampMs: stored.mintTimestampMs }
  const url = `https://robinhoodchain.blockscout.com/api/v2/tokens/${data.position.manager}/instances/${data.position.tokenId.toString()}/transfers`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Blockscout mint lookup returned ${response.status}`)
  const json = (await response.json()) as { items?: Array<{ block_number?: number; timestamp?: string; from?: { hash?: string }; to?: { hash?: string } }> }
  const mint = json.items?.find((item) => item.from?.hash && getAddress(item.from.hash) === zeroAddress)
  if (mint?.block_number == null || !mint.timestamp) return undefined
  const result = { blockNumber: BigInt(mint.block_number), timestampMs: Date.parse(mint.timestamp) }
  await db.upsertPosition({ positionId: data.id, version: data.position.version, manager: data.position.manager, tokenId: data.position.tokenId, mintBlock: result.blockNumber, mintTimestampMs: result.timestampMs })
  return result
}

async function valuePair(oracle: PortfolioPriceOracle, data: PositionData, amount0: bigint, amount1: bigint, blockNumber: bigint) {
  const [value0, value1] = await Promise.all([oracle.valueUsdg(data.token0, amount0, blockNumber), oracle.valueUsdg(data.token1, amount1, blockNumber)])
  return (value0 ?? 0) + (value1 ?? 0)
}

async function blockTimestamp(client: PublicClient, blockNumber: bigint) {
  const block = await client.getBlock({ blockNumber })
  return Number(block.timestamp) * 1_000
}

async function getEventsChunked(client: PublicClient, input: Parameters<PublicClient['getContractEvents']>[0]) {
  const fromBlock = input.fromBlock as bigint
  const toBlock = input.toBlock as bigint
  const result: any[] = []
  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK) {
    const end = start + BLOCK_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_CHUNK - 1n
    result.push(...(await client.getContractEvents({ ...input, fromBlock: start, toBlock: end } as any)))
  }
  return result
}

function modSub(left: bigint, right: bigint) {
  return (left - right + UINT256) % UINT256
}
