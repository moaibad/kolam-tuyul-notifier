import type { Address, PublicClient } from 'viem'
import { getAddress } from 'viem'
import { erc721Abi, v3PositionManagerAbi, v4PositionManagerAbi, type DeploymentAddresses } from '../contracts.js'
import type { PositionVersion } from '../types.js'

export interface DiscoveredPosition {
  version: PositionVersion
  manager: Address
  tokenId: bigint
}

export async function discoverOpenPositions(input: { client: PublicClient; walletAddress: Address; deployments: DeploymentAddresses }): Promise<{ positions: DiscoveredPosition[]; warnings: string[] }> {
  const positions: DiscoveredPosition[] = []
  const warnings: string[] = []

  if (input.deployments.v3PositionManager) {
    positions.push(...(await discoverV3Positions(input.client, input.deployments.v3PositionManager, input.walletAddress)))
  } else {
    warnings.push('Uniswap v3 PositionManager is not configured for Robinhood Chain.')
  }

  if (input.deployments.v4PositionManager) {
    positions.push(...(await discoverV4Positions(input.client, input.deployments.v4PositionManager, input.walletAddress)))
  } else {
    warnings.push('Uniswap v4 PositionManager is not configured for Robinhood Chain.')
  }

  return { positions, warnings }
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

async function discoverV4Positions(client: PublicClient, manager: Address, walletAddress: Address): Promise<DiscoveredPosition[]> {
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
  const result: DiscoveredPosition[] = []

  for (const tokenIdText of uniqueTokenIds) {
    const tokenId = BigInt(tokenIdText as string)
    try {
      const owner = await client.readContract({ address: manager, abi: v4PositionManagerAbi, functionName: 'ownerOf', args: [tokenId] })
      if (getAddress(owner) === walletAddress) result.push({ version: 'v4', manager, tokenId })
    } catch {
      // Burned positions are ignored.
    }
  }

  return result
}
