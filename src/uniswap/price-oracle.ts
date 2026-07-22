import { formatUnits, type Address } from 'viem'
import type { TokenInfo } from '../types.js'
import { tickToPrice } from './valuation.js'

export interface PoolPriceSource {
  key: string
  token0: TokenInfo
  token1: TokenInfo
  currentTick: number
  readTickAt(blockNumber: bigint): Promise<number>
}

export class PortfolioPriceOracle {
  private readonly cache = new Map<string, number | null>()
  private readonly sources: PoolPriceSource[]

  constructor(sources: PoolPriceSource[], readonly usdgAddress: Address) {
    this.sources = [...new Map(sources.map((source) => [source.key, source])).values()]
  }

  async tokenPriceUsdg(token: TokenInfo, blockNumber?: bigint): Promise<number | null> {
    if (token.address.toLowerCase() === this.usdgAddress.toLowerCase()) return 1
    const cacheKey = `${token.address.toLowerCase()}:${blockNumber?.toString() ?? 'latest'}`
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey) ?? null

    const direct = await this.rates(token.address, this.usdgAddress, blockNumber)
    if (direct.length > 0) {
      const price = median(direct)
      this.cache.set(cacheKey, price)
      return price
    }

    const candidates: number[] = []
    const intermediates = new Set<Address>()
    for (const source of this.sources) {
      if (same(source.token0.address, token.address)) intermediates.add(source.token1.address)
      if (same(source.token1.address, token.address)) intermediates.add(source.token0.address)
    }
    for (const intermediate of intermediates) {
      if (same(intermediate, this.usdgAddress)) continue
      const first = await this.rates(token.address, intermediate, blockNumber)
      const second = await this.rates(intermediate, this.usdgAddress, blockNumber)
      for (const left of first) for (const right of second) candidates.push(left * right)
    }

    const price = candidates.length > 0 ? median(candidates) : null
    this.cache.set(cacheKey, price)
    return price
  }

  async valueUsdg(token: TokenInfo, raw: bigint, blockNumber?: bigint): Promise<number | null> {
    const price = await this.tokenPriceUsdg(token, blockNumber)
    if (price == null) return null
    return Number(formatUnits(raw, token.decimals)) * price
  }

  private async rates(from: Address, to: Address, blockNumber?: bigint) {
    const result: number[] = []
    for (const source of this.sources) {
      const forward = same(source.token0.address, from) && same(source.token1.address, to)
      const reverse = same(source.token1.address, from) && same(source.token0.address, to)
      if (!forward && !reverse) continue
      try {
        const tick = blockNumber == null ? source.currentTick : await source.readTickAt(blockNumber)
        const token1PerToken0 = tickToPrice(tick, source.token0.decimals, source.token1.decimals)
        const rate = forward ? token1PerToken0 : 1 / token1PerToken0
        if (Number.isFinite(rate) && rate > 0) result.push(rate)
      } catch {
        // A pool may not have existed at the requested historical block.
      }
    }
    return result
  }
}

export function selectQuoteToken(token0: TokenInfo, token1: TokenInfo, usdgAddress: Address) {
  if (same(token0.address, usdgAddress)) return token0
  if (same(token1.address, usdgAddress)) return token1
  if (isWrappedEth(token0)) return token0
  if (isWrappedEth(token1)) return token1
  return token1
}

export function quotePrices(input: { token0: TokenInfo; token1: TokenInfo; quoteToken: TokenInfo; currentTick: number; tickLower: number; tickUpper: number }) {
  const toToken1 = (tick: number) => tickToPrice(tick, input.token0.decimals, input.token1.decimals)
  if (same(input.quoteToken.address, input.token1.address)) {
    return { current: toToken1(input.currentTick), lower: toToken1(input.tickLower), upper: toToken1(input.tickUpper) }
  }
  return { current: 1 / toToken1(input.currentTick), lower: 1 / toToken1(input.tickUpper), upper: 1 / toToken1(input.tickLower) }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function same(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase()
}

function isWrappedEth(token: TokenInfo) {
  const symbol = token.symbol.toUpperCase()
  return symbol === 'ETH' || symbol === 'WETH'
}
