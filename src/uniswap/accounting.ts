import type { AccountingSummary } from '../types.js'
import { calculateProfit } from './valuation.js'

export function calculatePositionResult(input: AccountingSummary & { currentLpValueUsdg: number; unclaimedFeesUsdg: number }) {
  const totalResultUsdg = input.currentLpValueUsdg + input.withdrawnUsdg + input.claimedFeesUsdg + input.unclaimedFeesUsdg
  const { profitLossUsdg, profitLossPercent } = calculateProfit(totalResultUsdg, input.depositedUsdg)
  return { totalResultUsdg, profitLossUsdg, profitLossPercent }
}

export function calculatePortfolioTotals(positions: Array<{ depositedUsdg: number; currentLpValueUsdg: number; claimedFeesUsdg: number; unclaimedFeesUsdg: number; totalResultUsdg: number }>) {
  const totals = positions.reduce(
    (acc, position) => {
      acc.depositedUsdg += position.depositedUsdg
      acc.currentLpValueUsdg += position.currentLpValueUsdg
      acc.claimedFeesUsdg += position.claimedFeesUsdg
      acc.unclaimedFeesUsdg += position.unclaimedFeesUsdg
      acc.totalResultUsdg += position.totalResultUsdg
      return acc
    },
    { depositedUsdg: 0, currentLpValueUsdg: 0, claimedFeesUsdg: 0, unclaimedFeesUsdg: 0, totalResultUsdg: 0 },
  )
  const { profitLossUsdg, profitLossPercent } = calculateProfit(totals.totalResultUsdg, totals.depositedUsdg)
  return { ...totals, profitLossUsdg, profitLossPercent }
}

export function feesTotal(claimedFeesUsdg: number, unclaimedFeesUsdg: number) {
  return claimedFeesUsdg + unclaimedFeesUsdg
}
