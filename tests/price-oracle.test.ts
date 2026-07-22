import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { PortfolioPriceOracle, quotePrices, selectQuoteToken, type PoolPriceSource } from '../src/uniswap/price-oracle.js'

const USDG = token('0x0000000000000000000000000000000000000001', 'USDG', 6)
const PONS = token('0x0000000000000000000000000000000000000002', 'PONS', 18)
const WETH = token('0x0000000000000000000000000000000000000003', 'WETH', 18)

describe('portfolio price oracle', () => {
  it('uses a direct USDG pool', async () => {
    const oracle = new PortfolioPriceOracle([source('pons-usdg', PONS, USDG, -299_351)], USDG.address)
    expect(await oracle.tokenPriceUsdg(PONS)).toBeCloseTo(0.1, 3)
  })

  it('routes WETH through PONS to USDG with at most two hops', async () => {
    const oracle = new PortfolioPriceOracle([source('weth-pons', WETH, PONS, 99_040), source('pons-usdg', PONS, USDG, -299_351)], USDG.address)
    expect(await oracle.tokenPriceUsdg(WETH)).toBeCloseTo(2_000, -1)
  })

  it('returns null rather than a fabricated zero when no route exists', async () => {
    const oracle = new PortfolioPriceOracle([], USDG.address)
    expect(await oracle.tokenPriceUsdg(PONS)).toBeNull()
  })

  it('quotes a non-USDG WETH pair in WETH', () => {
    const quote = selectQuoteToken(WETH, PONS, USDG.address)
    expect(quote.symbol).toBe('WETH')
    const prices = quotePrices({ token0: WETH, token1: PONS, quoteToken: quote, currentTick: 0, tickLower: -10, tickUpper: 10 })
    expect(prices.lower).toBeLessThan(prices.current)
    expect(prices.current).toBeLessThan(prices.upper)
  })
})

function token(address: string, symbol: string, decimals: number) {
  return { address: getAddress(address), symbol, decimals }
}

function source(key: string, token0: ReturnType<typeof token>, token1: ReturnType<typeof token>, currentTick: number): PoolPriceSource {
  return { key, token0, token1, currentTick, readTickAt: async () => currentTick }
}
