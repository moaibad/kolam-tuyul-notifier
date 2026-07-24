import type { Address, PublicClient } from 'viem'
import { getAddress } from 'viem'
import { erc721Abi, v3PositionManagerAbi, v4PositionManagerAbi, type DeploymentAddresses } from '../contracts.js'
import type { PositionVersion } from '../types.js'
import type { StateDatabase } from '../state/database.js'

export interface DiscoveredPosition {
  version: PositionVersion
  manager: Address
  tokenId: bigint
}

interface BlockscoutTokenOwnership {
  id?: string
  token_id?: string
  value?: string
  token?: {
    address_hash?: string
    type?: string
    symbol?: string
    name?: string
  }
}

export async function discoverOpenPositions(input: { client: PublicClient; walletAddress: Address; deployments: DeploymentAddresses; db?: StateDatabase }): Promise<{ positions: DiscoveredPosition[]; warnings: string[] }> {
  const positions: DiscoveredPosition[] = []
  const warnings: string[] = []

  if (input.deployments.v3PositionManager) {
    positions.push(...(await discoverV3Positions(input.client, input.deployments.v3PositionManager, input.walletAddress)))
  } else if (input.deployments.warnMissingV3) {
    warnings.push('Uniswap v3 PositionManager is not configured for Robinhood Chain.')
  }

  if (input.deployments.v4PositionManager) {
    positions.push(...(await discoverV4Positions(input.client, input.deployments.v4PositionManager, input.walletAddress, warnings, input.db)))
  } else {
    warnings.push('Uniswap v4 PositionManager is not configured for Robinhood Chain.')
  }

  const unique = [...new Map(positions.map((position) => [`${position.version}:${position.manager.toLowerCase()}:${position.tokenId.toString()}`, position])).values()]
  for (const position of unique) {
    await input.db?.upsertPosition({
      positionId: `${position.version}:${position.manager.toLowerCase()}:${position.tokenId.toString()}`,
      version: position.version,
      manager: position.manager,
      tokenId: position.tokenId,
    })
  }
  return { positions: unique, warnings }
}

async function discoverV3Positions(client: PublicClient, manager: Address, walletAddress: Address): Promise<DiscoveredPosition[]> {
  const balance = await client.readContract({ address: manager, abi: v3PositionManagerAbi, functionName: 'balanceOf', args: [walletAddress] })
  const result: DiscoveredPosition[] = []
  for (let index = 0n; index < balance; index += 1n) {
    const tokenId = await client.readContract({ address: manager, abi: v3PositionManagerAbi, functionName: 'tokenOfOwnerByIndex', args: [walletAddress, index] })
    result.push({ version: 'v3', manager, tokenId })
  }
  return result
}

async function discoverV4Positions(client: PublicClient, manager: Address, walletAddress: Address, warnings: string[], db?: StateDatabase): Promise<DiscoveredPosition[]> {
  const byExplorer = await discoverV4PositionsFromBlockscout(client, manager, walletAddress, warnings)
  if (byExplorer.length > 0) return byExplorer

  const cachedCandidates = (db ? await db.listPositions() : []).filter((position) => position.version === 'v4' && position.manager.toLowerCase() === manager.toLowerCase())
  const cached: DiscoveredPosition[] = []
  for (const position of cachedCandidates) {
    try {
      const owner = await client.readContract({ address: manager, abi: v4PositionManagerAbi, functionName: 'ownerOf', args: [position.tokenId] })
      if (owner.toLowerCase() === walletAddress.toLowerCase()) cached.push({ version: 'v4', manager, tokenId: position.tokenId })
    } catch {
      // Burned or transferred cached positions are ignored.
    }
  }

  const latestBlock = await client.getBlockNumber()
  const fromBlock = latestBlock > 250_000n ? latestBlock - 250_000n : 0n
  const logs = await client.getContractEvents({
    address: manager,
    abi: erc721Abi,
    eventName: 'Transfer',
    args: { to: walletAddress },
    fromBlock,
    toBlock: latestBlock,
  })
  const uniqueTokenIds = [...new Set(logs.map((log) => log.args.tokenId?.toString()).filter(Boolean))]
  const result: DiscoveredPosition[] = [...cached]

  for (const tokenIdText of uniqueTokenIds) {
    const tokenId = BigInt(tokenIdText as string)
    try {
      const owner = await client.readContract({ address: manager, abi: v4PositionManagerAbi, functionName: 'ownerOf', args: [tokenId] })
      if (getAddress(owner).toLowerCase() === walletAddress.toLowerCase()) result.push({ version: 'v4', manager, tokenId })
    } catch {
      // Burned positions are ignored.
    }
  }

  return result
}

async function discoverV4PositionsFromBlockscout(client: PublicClient, configuredManager: Address, walletAddress: Address, warnings: string[]): Promise<DiscoveredPosition[]> {
  try {
    const ownedNfts = await fetchOwnedErc721s(walletAddress)
    const result: DiscoveredPosition[] = []
    const seen = new Set<string>()

    for (const nft of ownedNfts) {
      const tokenIdText = nft.id ?? nft.token_id ?? nft.value
      const tokenAddress = nft.token?.address_hash
      if (!tokenIdText || !tokenAddress) continue

      const manager = getAddress(tokenAddress)
      const tokenId = BigInt(tokenIdText)
      const key = `${manager.toLowerCase()}:${tokenId.toString()}`
      if (seen.has(key)) continue
      seen.add(key)

      if (manager.toLowerCase() !== configuredManager.toLowerCase()) continue
      if (!(await isV4PositionManagerNft(client, manager, tokenId, walletAddress))) continue
      result.push({ version: 'v4', manager: configuredManager, tokenId })
    }

    return result
  } catch (error) {
    warnings.push(`Blockscout NFT discovery failed; falling back to recent Transfer logs: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

async function fetchOwnedErc721s(walletAddress: Address): Promise<BlockscoutTokenOwnership[]> {
  const items: BlockscoutTokenOwnership[] = []
  let url = `https://robinhoodchain.blockscout.com/api/v2/addresses/${walletAddress}/nft?type=ERC-721`

  for (let page = 0; page < 10; page += 1) {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Blockscout returned ${response.status}`)
    const json = (await response.json()) as { items?: BlockscoutTokenOwnership[]; next_page_params?: Record<string, string | number> | null }
    items.push(...(json.items ?? []))
    if (!json.next_page_params) break
    const params = new URLSearchParams({ type: 'ERC-721' })
    for (const [key, value] of Object.entries(json.next_page_params)) params.set(key, String(value))
    url = `https://robinhoodchain.blockscout.com/api/v2/addresses/${walletAddress}/nft?${params.toString()}`
  }

  return items
}

async function isV4PositionManagerNft(client: PublicClient, manager: Address, tokenId: bigint, walletAddress: Address) {
  try {
    const [owner, liquidity] = await Promise.all([
      client.readContract({ address: manager, abi: v4PositionManagerAbi, functionName: 'ownerOf', args: [tokenId] }),
      client.readContract({ address: manager, abi: v4PositionManagerAbi, functionName: 'getPositionLiquidity', args: [tokenId] }),
      client.readContract({ address: manager, abi: v4PositionManagerAbi, functionName: 'getPoolAndPositionInfo', args: [tokenId] }),
    ])
    return getAddress(owner).toLowerCase() === walletAddress.toLowerCase() && liquidity >= 0n
  } catch {
    return false
  }
}
