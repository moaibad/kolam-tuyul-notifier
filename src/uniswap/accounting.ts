import { calculateProfit } from './valuation.js'

export function calculatePositionResult(input: { depositedUsdg: number | null; withdrawnUsdg: number | null; claimedFeesUsdg: number | null; currentLpValueUsdg: number | null; unclaimedFeesUsdg: number | null }) {
  if (input.depositedUsdg == null || input.withdrawnUsdg == null || input.claimedFeesUsdg == null || input.currentLpValueUsdg == null || input.unclaimedFeesUsdg == null) {
    return { totalResultUsdg: null, profitLossUsdg: null, profitLossPercent: null }
  }
  const totalResultUsdg = input.currentLpValueUsdg + input.withdrawnUsdg + input.claimedFeesUsdg + input.unclaimedFeesUsdg
  const { profitLossUsdg, profitLossPercent } = calculateProfit(totalResultUsdg, input.depositedUsdg)
  return { totalResultUsdg, profitLossUsdg, profitLossPercent }
}

export function calculatePortfolioTotals(positions: Array<{
  accountingStatus: 'syncing' | 'synced' | 'unavailable'
  quoteTokenPriceUsdg: number | null
  depositedValueQuote: number | null
  amounts: Array<{ valueUsdg: number | null }>
  claimedFeesValueQuote: number | null
  unclaimedFeesValueQuote: number | null
  totalResultValueQuote: number | null
  netLpResultQuote: number | null
  hodlValueQuote: number | null
}>) {
  let benchmarkUsdg = 0
  let profitLossUsdg = 0
  const totals = { depositedUsdg: 0, currentLpValueUsdg: 0, claimedFeesUsdg: 0, unclaimedFeesUsdg: 0, totalResultUsdg: 0 }
  let partial = false

  for (const position of positions) {
    const price = position.quoteTokenPriceUsdg
    const complete = position.accountingStatus === 'synced' &&
      price != null &&
      position.depositedValueQuote != null &&
      position.amounts.length > 0 &&
      position.amounts.every((amount) => amount.valueUsdg != null) &&
      position.claimedFeesValueQuote != null &&
      position.unclaimedFeesValueQuote != null &&
      position.totalResultValueQuote != null &&
      position.netLpResultQuote != null &&
      position.hodlValueQuote != null
    if (!complete) {
      partial = true
      continue
    }

    totals.depositedUsdg += position.depositedValueQuote! * price!
    totals.currentLpValueUsdg += position.amounts.reduce((sum, amount) => sum + amount.valueUsdg!, 0)
    totals.claimedFeesUsdg += position.claimedFeesValueQuote! * price!
    totals.unclaimedFeesUsdg += position.unclaimedFeesValueQuote! * price!
    totals.totalResultUsdg += position.totalResultValueQuote! * price!
    profitLossUsdg += position.netLpResultQuote! * price!
    benchmarkUsdg += position.hodlValueQuote! * price!
  }

  if (positions.length === 0) return { ...totals, profitLossUsdg: 0, profitLossPercent: 0, partial: false }
  return {
    ...totals,
    profitLossUsdg: partial ? null : profitLossUsdg,
    profitLossPercent: partial ? null : benchmarkUsdg > 0 ? (profitLossUsdg / benchmarkUsdg) * 100 : 0,
    partial,
  }
}

export function feesTotal(claimedFeesUsdg: number | null, unclaimedFeesUsdg: number | null) {
  if (claimedFeesUsdg == null || unclaimedFeesUsdg == null) return null
  return claimedFeesUsdg + unclaimedFeesUsdg
}
