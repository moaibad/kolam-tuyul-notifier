import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import type { StoredPositionCashflow } from '../src/state/database.js'
import { calculateEntryValuation, valueRawAtEntryPrice } from '../src/uniswap/entry-valuation.js'

const ETH = { address: getAddress('0x0000000000000000000000000000000000000001'), symbol: 'ETH', decimals: 18 }
const GME = { address: getAddress('0x0000000000000000000000000000000000000002'), symbol: 'GME', decimals: 18 }
const unit = 10n ** 18n

describe('entry-price valuation', () => {
  it('keeps an untouched out-of-range position equal to its deposit despite market movement', async () => {
    const valuation = await calculateEntryValuation({
      token0: ETH,
      token1: GME,
      cashflows: [flow('deposit', 1n * unit, 0n, 10n)],
      priceAt: async (token) => token.symbol === 'ETH' ? 2_000 : 10,
    })

    expect(valuation.depositedUsdg).toBe(2_000)
    expect(valueRawAtEntryPrice(1n * unit, ETH, valuation.basis.token0PriceUsdg)).toBe(2_000)
  })

  it('uses a moving weighted average for multiple deposits', async () => {
    const valuation = await calculateEntryValuation({
      token0: ETH,
      token1: GME,
      cashflows: [
        flow('deposit', 1n * unit, 0n, 10n),
        flow('deposit', 3n * unit, 0n, 20n),
      ],
      priceAt: async (token, block) => token.symbol === 'ETH' ? (block === 10n ? 2_000 : 3_000) : 10,
    })

    expect(valuation.basis.token0PriceUsdg).toBe(2_750)
    expect(valuation.depositedUsdg).toBe(11_000)
  })

  it('withdraws principal at basis without changing the remaining unit price', async () => {
    const valuation = await calculateEntryValuation({
      token0: ETH,
      token1: GME,
      cashflows: [
        flow('deposit', 2n * unit, 0n, 10n),
        flow('withdrawal', 1n * unit, 0n, 20n),
      ],
      priceAt: async (token, block) => token.symbol === 'ETH' ? (block === 10n ? 2_000 : 9_000) : 10,
    })

    expect(valuation.withdrawnUsdg).toBe(2_000)
    expect(valuation.basis.token0PriceUsdg).toBe(2_000)
  })

  it('values claimed fees at the entry basis', async () => {
    const valuation = await calculateEntryValuation({
      token0: ETH,
      token1: GME,
      cashflows: [
        flow('deposit', 1n * unit, 0n, 10n),
        flow('fee', unit / 100n, 0n, 20n),
      ],
      priceAt: async (token, block) => token.symbol === 'ETH' ? (block === 10n ? 2_000 : 9_000) : 10,
    })

    expect(valuation.claimedFeesUsdg).toBe(20)
  })

  it('retains the deposit-block fallback price for a token initially deposited at zero', async () => {
    const valuation = await calculateEntryValuation({
      token0: ETH,
      token1: GME,
      cashflows: [flow('deposit', 1n * unit, 0n, 10n)],
      priceAt: async (token) => token.symbol === 'ETH' ? 2_000 : 12,
    })

    expect(valuation.basis.token1PriceUsdg).toBe(12)
  })

  it('fails instead of using the latest price when a historical entry price is unavailable', async () => {
    await expect(calculateEntryValuation({
      token0: ETH,
      token1: GME,
      cashflows: [flow('deposit', 1n * unit, 0n, 10n)],
      priceAt: async (token) => token.symbol === 'ETH' ? 2_000 : null,
    })).rejects.toThrow('Entry price unavailable at block 10')
  })
})

function flow(type: StoredPositionCashflow['type'], token0Raw: bigint, token1Raw: bigint, blockNumber: bigint): StoredPositionCashflow {
  return { type, token0Raw, token1Raw, blockNumber, logIndex: 0 }
}
