import type { Address } from 'viem'

export type PositionVersion = 'v3' | 'v4'
export type RangeStatus = 'in_range' | 'out_of_range'
export type AccountingStatus = 'syncing' | 'synced' | 'unavailable'

export interface TokenInfo {
  address: Address
  symbol: string
  decimals: number
}

export interface TokenAmountView {
  token: TokenInfo
  raw: bigint
  formatted: string
  valueUsdg: number | null
}

export interface PositionSnapshot {
  id: string
  tokenId: bigint
  version: PositionVersion
  manager: Address
  poolAddress?: Address
  token0: TokenInfo
  token1: TokenInfo
  quoteToken: TokenInfo
  quoteTokenPriceUsdg: number | null
  feeLabel?: string
  feeTier: number
  tickLower: number
  tickUpper: number
  currentTick: number
  currentPrice: number
  lowerPrice: number
  upperPrice: number
  liquidity: bigint
  status: RangeStatus
  outOfRangeSinceMs?: number
  mintTimestampMs: number
  blockNumber: bigint
  amounts: TokenAmountView[]
  currentLpValueUsdg: number | null
  claimedFeesUsdg: number | null
  unclaimedFeesUsdg: number | null
  depositedUsdg: number | null
  withdrawnUsdg: number | null
  totalResultUsdg: number | null
  profitLossUsdg: number | null
  profitLossPercent: number | null
  hodlValueQuote: number | null
  lpPrincipalValueQuote: number | null
  claimedFeesValueQuote: number | null
  unclaimedFeesValueQuote: number | null
  impermanentLossQuote: number | null
  impermanentLossPercent: number | null
  netLpResultQuote: number | null
  netLpResultPercent: number | null
  depositedValueQuote: number | null
  activeLpValueQuote: number | null
  totalResultValueQuote: number | null
  accountingStatus: AccountingStatus
  accountingError?: string
  uniswapUrl: string
  explorerUrl: string
}

export interface PortfolioSnapshot {
  chainName: string
  blockNumber: bigint
  updatedAtMs: number
  positions: PositionSnapshot[]
  totals: {
    depositedUsdg: number | null
    currentLpValueUsdg: number | null
    claimedFeesUsdg: number | null
    unclaimedFeesUsdg: number | null
    totalResultUsdg: number | null
    profitLossUsdg: number | null
    profitLossPercent: number | null
    partial: boolean
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
