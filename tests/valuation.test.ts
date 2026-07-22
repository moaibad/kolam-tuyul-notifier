import { describe, expect, it } from 'vitest'
import { calculateProfit, formatAge, getRangeStatus, tickToPrice } from '../src/uniswap/valuation.js'

describe('valuation helpers', () => {
  it('detects range status', () => {
    expect(getRangeStatus(10, 0, 20)).toBe('in_range')
    expect(getRangeStatus(20, 0, 20)).toBe('out_of_range')
    expect(getRangeStatus(-1, 0, 20)).toBe('out_of_range')
  })

  it('calculates profit and percentage', () => {
    expect(calculateProfit(2869.14, 2000)).toEqual({ profitLossUsdg: 869.1399999999999, profitLossPercent: 43.456999999999994 })
  })

  it('formats age compactly', () => {
    const now = 2 * 86_400_000 + 7 * 3_600_000
    expect(formatAge(now, 0)).toBe('2 days, 7 hours')
  })

  it('converts tick zero to unit price for equal decimals', () => {
    expect(tickToPrice(0, 18, 18)).toBe(1)
  })
})
