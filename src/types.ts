import type { Address, Hash } from 'viem'

export type PositionVersion = 'v3' | 'v4'
export type RangeStatus = 'in_range' | 'out_of_range'

export interface TokenInfo {
  address: Address
  symbol: string
  decimals: number
}

export interface TokenAmountView {
  token: TokenInfo
  raw: bigint
  formatted: string
  valueUsdg: number
}

export interface PositionSnapshot {
  id: string
  tokenId: bigint
  version: PositionVersion
  manager: Address
  poolAddress?: Address
  token0: TokenInfo
  token1: TokenInfo
  feeTier: number
  tickLower: number
  tickUpper: number
  currentTick: number
  currentPriceUsdg: number
  lowerPriceUsdg: number
  upperPriceUsdg: number
  liquidity: bigint
  status: RangeStatus
  outOfRangeSinceMs?: number
  mintTimestampMs: number
  blockNumber: bigint
  amounts: TokenAmountView[]
  currentLpValueUsdg: number
  claimedFeesUsdg: number
  unclaimedFeesUsdg: number
  depositedUsdg: number
  withdrawnUsdg: number
  totalResultUsdg: number
  profitLossUsdg: number
  profitLossPercent: number
  uniswapUrl: string
  explorerUrl: string
}

export interface PortfolioSnapshot {
  chainName: string
  blockNumber: bigint
  updatedAtMs: number
  positions: PositionSnapshot[]
  totals: {
    depositedUsdg: number
    currentLpValueUsdg: number
    claimedFeesUsdg: number
    unclaimedFeesUsdg: number
    totalResultUsdg: number
    profitLossUsdg: number
    profitLossPercent: number
  }
  warnings: string[]
}

export interface TransitionAlert {
  position: PositionSnapshot
  from: RangeStatus
  to: RangeStatus
  detectedAtMs: number
}

export interface RefreshResult {
  portfolio: PortfolioSnapshot
  alerts: TransitionAlert[]
}

export interface AccountingSummary {
  depositedUsdg: number
  withdrawnUsdg: number
  claimedFeesUsdg: number
}

export interface CashflowRecord {
  positionId: string
  txHash: Hash
  logIndex: number
  blockNumber: bigint
  timestampMs: number
  type: 'deposit' | 'withdrawal' | 'fee'
  amountUsdg: number
}
