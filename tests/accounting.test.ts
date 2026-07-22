import { describe, expect, it } from 'vitest'
import { calculatePortfolioTotals, calculatePositionResult, feesTotal } from '../src/uniswap/accounting.js'

describe('accounting', () => {
  it('calculates simple position result without hodl', () => {
    const result = calculatePositionResult({ depositedUsdg: 2000, withdrawnUsdg: 0, claimedFeesUsdg: 9.2, currentLpValueUsdg: 2841.52, unclaimedFeesUsdg: 18.42 })
    expect(result.totalResultUsdg).toBeCloseTo(2869.14)
    expect(result.profitLossUsdg).toBeCloseTo(869.14)
    expect(result.profitLossPercent).toBeCloseTo(43.457)
  })

  it('aggregates portfolio totals', () => {
    const totals = calculatePortfolioTotals([
      { depositedUsdg: 100, currentLpValueUsdg: 120, claimedFeesUsdg: 1, unclaimedFeesUsdg: 2, totalResultUsdg: 123 },
      { depositedUsdg: 200, currentLpValueUsdg: 190, claimedFeesUsdg: 3, unclaimedFeesUsdg: 4, totalResultUsdg: 197 },
    ])
    expect(totals.depositedUsdg).toBe(300)
    expect(totals.totalResultUsdg).toBe(320)
    expect(totals.profitLossPercent).toBeCloseTo(6.666)
  })

  it('sums fees', () => {
    expect(feesTotal(9.2, 18.42)).toBeCloseTo(27.62)
  })
})
