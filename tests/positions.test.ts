import { describe, expect, it } from 'vitest'
import { decodeV4PositionInfo, getAmountsForLiquidity } from '../src/uniswap/positions.js'
import { getSqrtRatioAtTick } from '../src/uniswap/tick-math.js'

describe('position math', () => {
  it('decodes signed v4 ticks', () => {
    const lower = BigInt(0x1000000 - 313_880)
    const upper = BigInt(0x1000000 - 308_280)
    const packed = (lower << 8n) | (upper << 32n)
    expect(decodeV4PositionInfo(packed)).toEqual({ tickLower: -313_880, tickUpper: -308_280 })
  })

  it('calculates one-sided and in-range liquidity amounts', () => {
    const liquidity = 1_000_000_000_000n
    const below = getAmountsForLiquidity(sqrt(-100), -100, 0, 100, liquidity)
    const inside = getAmountsForLiquidity(sqrt(50), 50, 0, 100, liquidity)
    const above = getAmountsForLiquidity(sqrt(100), 100, 0, 100, liquidity)
    expect(below[0]).toBeGreaterThan(0n)
    expect(below[1]).toBe(0n)
    expect(inside[0]).toBeGreaterThan(0n)
    expect(inside[1]).toBeGreaterThan(0n)
    expect(above[0]).toBe(0n)
    expect(above[1]).toBeGreaterThan(0n)
  })
})

function sqrt(tick: number) {
  return getSqrtRatioAtTick(tick)
}
