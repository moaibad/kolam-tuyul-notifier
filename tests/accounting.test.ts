import { describe, expect, it } from 'vitest'
import { calculatePortfolioTotals, calculatePositionResult, feesTotal } from '../src/uniswap/accounting.js'

describe('accounting', () => {
  it('calculates simple position result without hodl', () => {
    const result = calculatePositionResult({ depositedUsdg: 2000, withdrawnUsdg: 0, claimedFeesUsdg: 9.2, currentLpValueUsdg: 2841.52, unclaimedFeesUsdg: 18.42 })
    expect(result.totalResultUsdg).toBeCloseTo(2869.14)
    expect(result.profitLossUsdg).toBeCloseTo(869.14)
    expect(result.profitLossPercent).toBeCloseTo(43.457)
  })

  it('aggregates position-native metrics using each quote token USDG price', () => {
    const totals = calculatePortfolioTotals([
      portfolioPosition({ quoteTokenPriceUsdg: 2, depositedValueQuote: 10, amounts: [{ valueUsdg: 12 }, { valueUsdg: 3 }], claimedFeesValueQuote: 1, unclaimedFeesValueQuote: 2, totalResultValueQuote: 16, netLpResultQuote: 1, hodlValueQuote: 20 }),
      portfolioPosition({ quoteTokenPriceUsdg: 1, depositedValueQuote: 20, amounts: [{ valueUsdg: 18 }, { valueUsdg: 2 }], claimedFeesValueQuote: 3, unclaimedFeesValueQuote: 4, totalResultValueQuote: 25, netLpResultQuote: -2, hodlValueQuote: 22 }),
    ])
    expect(totals.depositedUsdg).toBe(40)
    expect(totals.currentLpValueUsdg).toBe(35)
    expect(totals.claimedFeesUsdg).toBe(5)
    expect(totals.unclaimedFeesUsdg).toBe(8)
    expect(totals.totalResultUsdg).toBe(57)
    expect(totals.profitLossUsdg).toBe(0)
    expect(totals.profitLossPercent).toBe(0)
  })

  it('weights portfolio profit percent by the current HODL benchmark', () => {
    const totals = calculatePortfolioTotals([
      portfolioPosition({ quoteTokenPriceUsdg: 2, netLpResultQuote: 1, hodlValueQuote: 10 }),
      portfolioPosition({ quoteTokenPriceUsdg: 1, netLpResultQuote: 1, hodlValueQuote: 30 }),
    ])
    expect(totals.profitLossUsdg).toBe(3)
    expect(totals.profitLossPercent).toBeCloseTo(6)
  })

  it('marks incomplete positions as partial and handles an empty portfolio', () => {
    const partial = calculatePortfolioTotals([portfolioPosition({ quoteTokenPriceUsdg: null })])
    expect(partial.partial).toBe(true)
    expect(partial.profitLossUsdg).toBeNull()
    expect(calculatePortfolioTotals([])).toMatchObject({ partial: false, profitLossUsdg: 0, profitLossPercent: 0 })
  })

  it('sums fees', () => {
    expect(feesTotal(9.2, 18.42)).toBeCloseTo(27.62)
  })
})

function portfolioPosition(overrides: Partial<Parameters<typeof calculatePortfolioTotals>[0][number]> = {}): Parameters<typeof calculatePortfolioTotals>[0][number] {
  return {
    accountingStatus: 'synced',
    quoteTokenPriceUsdg: 1,
    depositedValueQuote: 10,
    amounts: [{ valueUsdg: 5 }, { valueUsdg: 5 }],
    claimedFeesValueQuote: 1,
    unclaimedFeesValueQuote: 1,
    totalResultValueQuote: 12,
    netLpResultQuote: 1,
    hodlValueQuote: 10,
    ...overrides,
  }
}
