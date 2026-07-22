import { calculateProfit } from './valuation.js'

export function calculatePositionResult(input: { depositedUsdg: number | null; withdrawnUsdg: number | null; claimedFeesUsdg: number | null; currentLpValueUsdg: number | null; unclaimedFeesUsdg: number | null }) {
  if (input.depositedUsdg == null || input.withdrawnUsdg == null || input.claimedFeesUsdg == null || input.currentLpValueUsdg == null || input.unclaimedFeesUsdg == null) {
    return { totalResultUsdg: null, profitLossUsdg: null, profitLossPercent: null }
  }
  const totalResultUsdg = input.currentLpValueUsdg + input.withdrawnUsdg + input.claimedFeesUsdg + input.unclaimedFeesUsdg
  const { profitLossUsdg, profitLossPercent } = calculateProfit(totalResultUsdg, input.depositedUsdg)
  return { totalResultUsdg, profitLossUsdg, profitLossPercent }
}

export function calculatePortfolioTotals(positions: Array<{ depositedUsdg: number | null; currentLpValueUsdg: number | null; claimedFeesUsdg: number | null; unclaimedFeesUsdg: number | null; totalResultUsdg: number | null }>) {
  const partial = positions.some(
    (position) =>
      position.depositedUsdg == null ||
      position.currentLpValueUsdg == null ||
      position.claimedFeesUsdg == null ||
      position.unclaimedFeesUsdg == null ||
      position.totalResultUsdg == null,
  )
  const totals = positions.reduce<{
    depositedUsdg: number
    currentLpValueUsdg: number
    claimedFeesUsdg: number
    unclaimedFeesUsdg: number
    totalResultUsdg: number
  }>(
    (acc, position) => {
      if (position.depositedUsdg != null) acc.depositedUsdg += position.depositedUsdg
      if (position.currentLpValueUsdg != null) acc.currentLpValueUsdg += position.currentLpValueUsdg
      if (position.claimedFeesUsdg != null) acc.claimedFeesUsdg += position.claimedFeesUsdg
      if (position.unclaimedFeesUsdg != null) acc.unclaimedFeesUsdg += position.unclaimedFeesUsdg
      if (position.totalResultUsdg != null) acc.totalResultUsdg += position.totalResultUsdg
      return acc
    },
    { depositedUsdg: 0, currentLpValueUsdg: 0, claimedFeesUsdg: 0, unclaimedFeesUsdg: 0, totalResultUsdg: 0 },
  )
  const { profitLossUsdg, profitLossPercent } = calculateProfit(totals.totalResultUsdg, totals.depositedUsdg)
  if (positions.length === 0) return { ...totals, profitLossUsdg, profitLossPercent, partial: false }
  return { ...totals, profitLossUsdg: partial ? null : profitLossUsdg, profitLossPercent: partial ? null : profitLossPercent, partial }
}

export function feesTotal(claimedFeesUsdg: number | null, unclaimedFeesUsdg: number | null) {
  if (claimedFeesUsdg == null || unclaimedFeesUsdg == null) return null
  return claimedFeesUsdg + unclaimedFeesUsdg
}
