import type { Address, PublicClient } from 'viem'
import type { AppConfig } from './config.js'

export const erc20Abi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

export const erc721Abi = [
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'tokenId', type: 'uint256', indexed: true }] },
] as const

export const v3PositionManagerAbi = [
  ...erc721Abi,
  {
    type: 'function',
    name: 'positions',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
  },
  { type: 'event', name: 'IncreaseLiquidity', inputs: [{ name: 'tokenId', type: 'uint256', indexed: true }, { name: 'liquidity', type: 'uint128', indexed: false }, { name: 'amount0', type: 'uint256', indexed: false }, { name: 'amount1', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'DecreaseLiquidity', inputs: [{ name: 'tokenId', type: 'uint256', indexed: true }, { name: 'liquidity', type: 'uint128', indexed: false }, { name: 'amount0', type: 'uint256', indexed: false }, { name: 'amount1', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'Collect', inputs: [{ name: 'tokenId', type: 'uint256', indexed: true }, { name: 'recipient', type: 'address', indexed: false }, { name: 'amount0', type: 'uint256', indexed: false }, { name: 'amount1', type: 'uint256', indexed: false }] },
] as const

export const v4PositionManagerAbi = [
  ...erc721Abi,
  {
    type: 'function',
    name: 'getPoolAndPositionInfo',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'poolKey', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] },
      { name: 'info', type: 'uint256' },
    ],
  },
  { type: 'function', name: 'getPositionLiquidity', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint128' }] },
] as const

export const v4StateViewAbi = [
  { type: 'function', name: 'getSlot0', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }] },
  { type: 'function', name: 'getLiquidity', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }], outputs: [{ type: 'uint128' }] },
  { type: 'function', name: 'getFeeGrowthInside', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'bytes32' }, { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
] as const

export interface DeploymentAddresses {
  v3PositionManager?: Address
  v4PositionManager?: Address
  v4PoolManager?: Address
  v4StateView?: Address
}

export function resolveDeployments(config: AppConfig): DeploymentAddresses {
  return { ...config.contracts }
}

export async function validateContractCode(client: PublicClient, deployments: DeploymentAddresses) {
  const entries = Object.entries(deployments).filter((entry): entry is [string, Address] => Boolean(entry[1]))
  for (const [name, address] of entries) {
    const bytecode = await client.getCode({ address })
    if (!bytecode || bytecode === '0x') throw new Error(`${name} has no contract bytecode at ${address}`)
  }
}
