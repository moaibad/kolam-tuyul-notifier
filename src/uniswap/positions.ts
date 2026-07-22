import type { Address, Hash, PublicClient } from 'viem'
import { encodeAbiParameters, getAddress, keccak256, padHex, toHex, zeroAddress } from 'viem'
import {
  erc20Abi,
  v3FactoryAbi,
  v3PoolAbi,
  v3PositionManagerAbi,
  v4PositionManagerAbi,
  v4StateViewAbi,
  type DeploymentAddresses,
} from '../contracts.js'
import { explorerTokenUrl } from '../chain.js'
import type { PositionSnapshot, TokenInfo } from '../types.js'
import type { StateDatabase } from '../state/database.js'
import type { DiscoveredPosition } from './discovery.js'
import { calculatePositionResult } from './accounting.js'
import { PortfolioPriceOracle, quotePrices, selectQuoteToken, type PoolPriceSource } from './price-oracle.js'
import { formatTokenAmount, getRangeStatus } from './valuation.js'
import { getSqrtRatioAtTick } from './tick-math.js'

const Q128 = 2n ** 128n
const UINT256 = 2n ** 256n
const DYNAMIC_FEE_FLAG = 0x800000
const nativeEth: TokenInfo = { address: zeroAddress, symbol: 'ETH', decimals: 18 }

export interface PositionData {
  position: DiscoveredPosition
  id: string
  token0: TokenInfo
  token1: TokenInfo
  feeTier: number
  feeLabel?: string
  tickLower: number
  tickUpper: number
  currentTick: number
  sqrtPriceX96: bigint
  liquidity: bigint
  unclaimed0: bigint
  unclaimed1: bigint
  pendingPrincipal0?: bigint
  pendingPrincipal1?: bigint
  poolAddress?: Address
  poolId?: Hash
  hooks?: Address
  priceSource: PoolPriceSource
}

interface PositionInput {
  client: PublicClient
  db: StateDatabase
  position: DiscoveredPosition
  deployments: DeploymentAddresses
}

export async function loadPositionData(input: PositionInput): Promise<PositionData> {
  return input.position.version === 'v3' ? loadV3Position(input) : loadV4Position(input)
}

async function loadV3Position(input: PositionInput): Promise<PositionData> {
  if (!input.deployments.v3Factory) throw new Error('Uniswap v3 Factory is not configured')
  const raw = await input.client.readContract({ address: input.position.manager, abi: v3PositionManagerAbi, functionName: 'positions', args: [input.position.tokenId] })
  const token0 = await getTokenInfo(input.client, input.db, getAddress(raw[2]))
  const token1 = await getTokenInfo(input.client, input.db, getAddress(raw[3]))
  const poolAddress = await input.client.readContract({ address: input.deployments.v3Factory, abi: v3FactoryAbi, functionName: 'getPool', args: [token0.address, token1.address, raw[4]] })
  if (poolAddress === zeroAddress) throw new Error(`No v3 pool found for position #${input.position.tokenId}`)
  const slot0 = await input.client.readContract({ address: poolAddress, abi: v3PoolAbi, functionName: 'slot0' })
  const unclaimed = await getV3UnclaimedFees(input.client, poolAddress, raw)
  const pendingPrincipal = input.db.getPendingPrincipal(positionId(input.position))
  const id = positionId(input.position)
  const priceSource: PoolPriceSource = {
    key: `v3:${poolAddress.toLowerCase()}`,
    token0,
    token1,
    currentTick: slot0[1],
    readTickAt: async (blockNumber) => {
      const historical = await input.client.readContract({ address: poolAddress, abi: v3PoolAbi, functionName: 'slot0', blockNumber })
      return historical[1]
    },
  }
  return {
    position: input.position,
    id,
    token0,
    token1,
    feeTier: raw[4],
    tickLower: raw[5],
    tickUpper: raw[6],
    currentTick: slot0[1],
    sqrtPriceX96: slot0[0],
    liquidity: raw[7],
    unclaimed0: unclaimed[0] > pendingPrincipal[0] ? unclaimed[0] - pendingPrincipal[0] : 0n,
    unclaimed1: unclaimed[1] > pendingPrincipal[1] ? unclaimed[1] - pendingPrincipal[1] : 0n,
    pendingPrincipal0: pendingPrincipal[0],
    pendingPrincipal1: pendingPrincipal[1],
    poolAddress,
    priceSource,
  }
}

async function loadV4Position(input: PositionInput): Promise<PositionData> {
  if (!input.deployments.v4StateView) throw new Error('Uniswap v4 StateView is not configured')
  const [[poolKey, info], liquidity] = await Promise.all([
    input.client.readContract({ address: input.position.manager, abi: v4PositionManagerAbi, functionName: 'getPoolAndPositionInfo', args: [input.position.tokenId] }),
    input.client.readContract({ address: input.position.manager, abi: v4PositionManagerAbi, functionName: 'getPositionLiquidity', args: [input.position.tokenId] }),
  ])
  const token0 = await getTokenInfo(input.client, input.db, getAddress(poolKey.currency0))
  const token1 = await getTokenInfo(input.client, input.db, getAddress(poolKey.currency1))
  const decoded = decodeV4PositionInfo(info)
  const poolId = getV4PoolId(poolKey)
  const slot0 = await input.client.readContract({ address: input.deployments.v4StateView, abi: v4StateViewAbi, functionName: 'getSlot0', args: [poolId] })
  let unclaimed0 = 0n
  let unclaimed1 = 0n
  if (liquidity > 0n) {
    const [positionInfo, feeGrowthInside] = await Promise.all([
      input.client.readContract({
        address: input.deployments.v4StateView,
        abi: v4StateViewAbi,
        functionName: 'getPositionInfo',
        args: [poolId, input.position.manager, decoded.tickLower, decoded.tickUpper, tokenIdSalt(input.position.tokenId)],
      }),
      input.client.readContract({ address: input.deployments.v4StateView, abi: v4StateViewAbi, functionName: 'getFeeGrowthInside', args: [poolId, decoded.tickLower, decoded.tickUpper] }),
    ])
    unclaimed0 = (modSub(feeGrowthInside[0], positionInfo[1]) * liquidity) / Q128
    unclaimed1 = (modSub(feeGrowthInside[1], positionInfo[2]) * liquidity) / Q128
  }
  const dynamic = (poolKey.fee & DYNAMIC_FEE_FLAG) !== 0
  const priceSource: PoolPriceSource = {
    key: `v4:${poolId}`,
    token0,
    token1,
    currentTick: slot0[1],
    readTickAt: async (blockNumber) => {
      const historical = await input.client.readContract({ address: input.deployments.v4StateView!, abi: v4StateViewAbi, functionName: 'getSlot0', args: [poolId], blockNumber })
      return historical[1]
    },
  }
  return {
    position: input.position,
    id: positionId(input.position),
    token0,
    token1,
    feeTier: dynamic ? slot0[3] : poolKey.fee,
    feeLabel: dynamic ? 'Dynamic' : undefined,
    tickLower: decoded.tickLower,
    tickUpper: decoded.tickUpper,
    currentTick: slot0[1],
    sqrtPriceX96: slot0[0],
    liquidity,
    unclaimed0,
    unclaimed1,
    poolId,
    hooks: getAddress(poolKey.hooks),
    priceSource,
  }
}

export async function buildPositionSnapshot(input: {
  client: PublicClient
  db: StateDatabase
  data: PositionData
  oracle: PortfolioPriceOracle
  walletAddress: Address
  blockNumber: bigint
  nowMs: number
}): Promise<PositionSnapshot | undefined> {
  const position = input.data
  if (position.liquidity === 0n) return undefined
  const stored = input.db.getPosition(position.id)
  const mintTimestampMs = stored?.mintTimestampMs ?? input.nowMs
  const accounting = input.db.getAccounting(position.id)
  const quoteToken = selectQuoteToken(position.token0, position.token1, input.oracle.usdgAddress)
  const prices = quotePrices({ ...position, quoteToken })
  const status = getRangeStatus(position.currentTick, position.tickLower, position.tickUpper)
  const previous = input.db.getPositionStatus(position.id)
  const outOfRangeSinceMs = status === 'out_of_range' ? previous.outOfRangeSinceMs ?? input.nowMs : undefined
  const [amount0Raw, amount1Raw] = getAmountsForLiquidity(position.sqrtPriceX96, position.currentTick, position.tickLower, position.tickUpper, position.liquidity)
  const [value0, value1, unclaimedValue0, unclaimedValue1] = await Promise.all([
    input.oracle.valueUsdg(position.token0, amount0Raw),
    input.oracle.valueUsdg(position.token1, amount1Raw),
    input.oracle.valueUsdg(position.token0, position.unclaimed0),
    input.oracle.valueUsdg(position.token1, position.unclaimed1),
  ])
  const currentLpValueUsdg = addNullable(value0, value1)
  const unclaimedFeesUsdg = addNullable(unclaimedValue0, unclaimedValue1)
  const result = calculatePositionResult({
    depositedUsdg: accounting.depositedUsdg,
    withdrawnUsdg: accounting.withdrawnUsdg,
    claimedFeesUsdg: accounting.claimedFeesUsdg,
    currentLpValueUsdg,
    unclaimedFeesUsdg,
  })

  return {
    id: position.id,
    tokenId: position.position.tokenId,
    version: position.position.version,
    manager: position.position.manager,
    poolAddress: position.poolAddress,
    token0: position.token0,
    token1: position.token1,
    quoteToken,
    feeTier: position.feeTier,
    feeLabel: position.feeLabel,
    tickLower: position.tickLower,
    tickUpper: position.tickUpper,
    currentTick: position.currentTick,
    currentPrice: prices.current,
    lowerPrice: prices.lower,
    upperPrice: prices.upper,
    liquidity: position.liquidity,
    status,
    outOfRangeSinceMs,
    mintTimestampMs,
    blockNumber: input.blockNumber,
    amounts: [
      { token: position.token0, raw: amount0Raw, formatted: formatTokenAmount(amount0Raw, position.token0.decimals), valueUsdg: value0 },
      { token: position.token1, raw: amount1Raw, formatted: formatTokenAmount(amount1Raw, position.token1.decimals), valueUsdg: value1 },
    ],
    currentLpValueUsdg,
    claimedFeesUsdg: accounting.claimedFeesUsdg,
    unclaimedFeesUsdg,
    depositedUsdg: accounting.depositedUsdg,
    withdrawnUsdg: accounting.withdrawnUsdg,
    totalResultUsdg: result.totalResultUsdg,
    profitLossUsdg: result.profitLossUsdg,
    profitLossPercent: result.profitLossPercent,
    accountingStatus: accounting.status,
    accountingError: accounting.error,
    uniswapUrl: `https://app.uniswap.org/portfolio/${input.walletAddress}`,
    explorerUrl: explorerTokenUrl(position.position.manager, position.position.tokenId),
  }
}

export function createPriceOracle(data: PositionData[], usdgAddress: Address) {
  return new PortfolioPriceOracle(data.map((position) => position.priceSource), usdgAddress)
}

async function getTokenInfo(client: PublicClient, db: StateDatabase, address: Address): Promise<TokenInfo> {
  if (address === zeroAddress) return nativeEth
  const cached = db.getToken(address)
  if (cached) return { address, ...cached }
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
    client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
  ])
  db.setToken(address, symbol, decimals)
  return { address, symbol, decimals }
}

async function getV3UnclaimedFees(client: PublicClient, pool: Address, position: readonly unknown[]): Promise<[bigint, bigint]> {
  const raw = position as unknown as readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]
  if (raw[7] === 0n) return [raw[10], raw[11]]
  const [slot0, global0, global1, lower, upper] = await Promise.all([
    client.readContract({ address: pool, abi: v3PoolAbi, functionName: 'slot0' }),
    client.readContract({ address: pool, abi: v3PoolAbi, functionName: 'feeGrowthGlobal0X128' }),
    client.readContract({ address: pool, abi: v3PoolAbi, functionName: 'feeGrowthGlobal1X128' }),
    client.readContract({ address: pool, abi: v3PoolAbi, functionName: 'ticks', args: [raw[5]] }),
    client.readContract({ address: pool, abi: v3PoolAbi, functionName: 'ticks', args: [raw[6]] }),
  ])
  const inside0 = feeGrowthInside(slot0[1], raw[5], raw[6], global0, lower[2], upper[2])
  const inside1 = feeGrowthInside(slot0[1], raw[5], raw[6], global1, lower[3], upper[3])
  return [raw[10] + (modSub(inside0, raw[8]) * raw[7]) / Q128, raw[11] + (modSub(inside1, raw[9]) * raw[7]) / Q128]
}

function feeGrowthInside(currentTick: number, lowerTick: number, upperTick: number, global: bigint, lowerOutside: bigint, upperOutside: bigint) {
  if (currentTick < lowerTick) return modSub(lowerOutside, upperOutside)
  if (currentTick >= upperTick) return modSub(upperOutside, lowerOutside)
  return modSub(modSub(global, lowerOutside), upperOutside)
}

export function decodeV4PositionInfo(value: bigint) {
  const raw = (shift: bigint) => {
    const number = Number((value >> shift) & 0xffffffn)
    return number >= 0x800000 ? number - 0x1000000 : number
  }
  return { tickLower: raw(8n), tickUpper: raw(32n) }
}

export function getV4PoolId(poolKey: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }) {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }],
      [poolKey],
    ),
  )
}

export function getAmountsForLiquidity(sqrtPriceX96: bigint, currentTick: number, tickLower: number, tickUpper: number, liquidity: bigint): [bigint, bigint] {
  const sqrtLower = getSqrtRatioAtTick(tickLower)
  const sqrtUpper = getSqrtRatioAtTick(tickUpper)
  if (currentTick < tickLower) return [getAmount0Delta(sqrtLower, sqrtUpper, liquidity), 0n]
  if (currentTick >= tickUpper) return [0n, getAmount1Delta(sqrtLower, sqrtUpper, liquidity)]
  return [getAmount0Delta(sqrtPriceX96, sqrtUpper, liquidity), getAmount1Delta(sqrtLower, sqrtPriceX96, liquidity)]
}

function getAmount0Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint) {
  const [sqrtA, sqrtB] = sqrtRatioAX96 > sqrtRatioBX96 ? [sqrtRatioBX96, sqrtRatioAX96] : [sqrtRatioAX96, sqrtRatioBX96]
  return (((liquidity << 96n) * (sqrtB - sqrtA)) / sqrtB) / sqrtA
}

function getAmount1Delta(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint) {
  const [sqrtA, sqrtB] = sqrtRatioAX96 > sqrtRatioBX96 ? [sqrtRatioBX96, sqrtRatioAX96] : [sqrtRatioAX96, sqrtRatioBX96]
  return (liquidity * (sqrtB - sqrtA)) / (2n ** 96n)
}

export function tokenIdSalt(tokenId: bigint) {
  return padHex(toHex(tokenId), { size: 32 })
}

function positionId(position: DiscoveredPosition) {
  return `${position.version}:${position.manager.toLowerCase()}:${position.tokenId.toString()}`
}

function modSub(left: bigint, right: bigint) {
  return (left - right + UINT256) % UINT256
}

function addNullable(left: number | null, right: number | null) {
  return left == null || right == null ? null : left + right
}
