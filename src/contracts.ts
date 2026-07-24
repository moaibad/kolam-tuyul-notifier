import { getAddress, type Address, type PublicClient } from 'viem'

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

export const v3FactoryAbi = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ name: 'pool', type: 'address' }],
  },
] as const

export const v3PoolAbi = [
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
  { type: 'function', name: 'feeGrowthGlobal0X128', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'feeGrowthGlobal1X128', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'ticks',
    stateMutability: 'view',
    inputs: [{ name: 'tick', type: 'int24' }],
    outputs: [
      { name: 'liquidityGross', type: 'uint128' },
      { name: 'liquidityNet', type: 'int128' },
      { name: 'feeGrowthOutside0X128', type: 'uint256' },
      { name: 'feeGrowthOutside1X128', type: 'uint256' },
      { name: 'tickCumulativeOutside', type: 'int56' },
      { name: 'secondsPerLiquidityOutsideX128', type: 'uint160' },
      { name: 'secondsOutside', type: 'uint32' },
      { name: 'initialized', type: 'bool' },
    ],
  },
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
  {
    type: 'function',
    name: 'getPositionInfo',
    stateMutability: 'view',
    inputs: [
      { name: 'poolId', type: 'bytes32' },
      { name: 'owner', type: 'address' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'salt', type: 'bytes32' },
    ],
    outputs: [
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
    ],
  },
] as const

export const v4PoolManagerAbi = [
  {
    type: 'event',
    name: 'ModifyLiquidity',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'tickLower', type: 'int24', indexed: false },
      { name: 'tickUpper', type: 'int24', indexed: false },
      { name: 'liquidityDelta', type: 'int256', indexed: false },
      { name: 'salt', type: 'bytes32', indexed: false },
    ],
  },
] as const

export interface DeploymentAddresses {
  v3Factory?: Address
  v3PositionManager?: Address
  v4PositionManager?: Address
  v4PoolManager?: Address
  v4StateView?: Address
  warnMissingV3: boolean
}

export const robinhoodV4Deployments = {
  // Verified Robinhood Blockscout deployments of Uniswap v4-core/v4-periphery source.
  // The PositionManager and StateView bytecode both embed this PoolManager address.
  v4PositionManager: '0x58daec3116aae6D93017bAAea7749052E8a04fA7' as Address,
  v4PoolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951' as Address,
  v4StateView: '0xF3334192D15450CdD385c8B70e03f9A6bD9E673b' as Address,
}

export const robinhoodV3Deployments = {
  v3Factory: getAddress('0x1f7d7550b1b028f7571e69a784071f0205fd2efa'),
  v3PositionManager: getAddress('0x73991a25c818bf1f1128deaab1492d45638de0d3'),
}

export function resolveDeployments(): DeploymentAddresses {
  return {
    v3Factory: robinhoodV3Deployments.v3Factory,
    v3PositionManager: robinhoodV3Deployments.v3PositionManager,
    v4PositionManager: robinhoodV4Deployments.v4PositionManager,
    v4PoolManager: robinhoodV4Deployments.v4PoolManager,
    v4StateView: robinhoodV4Deployments.v4StateView,
    warnMissingV3: false,
  }
}

export async function validateContractCode(client: PublicClient, deployments: DeploymentAddresses) {
  const entries = Object.entries(deployments).filter((entry): entry is [string, Address] => typeof entry[1] === 'string' && Boolean(entry[1]))
  for (const [name, address] of entries) {
    const bytecode = await client.getCode({ address })
    if (!bytecode || bytecode === '0x') throw new Error(`${name} has no contract bytecode at ${address}`)
  }
}
