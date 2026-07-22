import { describe, expect, it } from 'vitest'
import { zeroAddress } from 'viem'
import { buildPortfolioEmbed, buildPositionEmbed } from '../src/discord/embeds.js'
import type { PortfolioSnapshot, PositionSnapshot } from '../src/types.js'

describe('embeds', () => {
  it('renders portfolio summary in final native layout', () => {
    const portfolio: PortfolioSnapshot = {
      chainName: 'Robinhood Chain',
      blockNumber: 38_291_407n,
      updatedAtMs: Date.UTC(2026, 6, 22, 14, 35),
      positions: [basePosition({ status: 'in_range' }), basePosition({ status: 'out_of_range' })],
      totals: {
        depositedUsdg: 10_000,
        currentLpValueUsdg: 11_184.2,
        claimedFeesUsdg: 9.2,
        unclaimedFeesUsdg: 109.2,
        totalResultUsdg: 11_302.6,
        profitLossUsdg: 1_302.6,
        profitLossPercent: 13.026,
        partial: false,
      },
      warnings: [],
    }

    const embed = buildPortfolioEmbed(portfolio).toJSON()

    expect(embed.color).toBe(0xff37c7)
    expect(embed.title).toBe('UNISWAP LP PORTFOLIO')
    expect(embed.description).toBe('Robinhood Chain')
    expect(embed.fields?.map((field) => field.name)).toEqual(['POSITIONS', 'VALUE', 'PROFIT / LOSS'])
    expect(embed.fields?.[0]?.value).toContain('Open Positions')
    expect(embed.fields?.[1]?.value).toContain('Total Deposited')
    expect(embed.fields?.[2]?.value).toContain('+1,302.60 USDG')
    expect(embed.footer?.text).toBe('Updated 14:35 UTC · Block 38,291,407')
    expect(JSON.stringify(embed)).not.toContain('┌')
  })

  it('emphasizes out of range duration after threshold', () => {
    const embed = buildPositionEmbed(basePosition({ status: 'out_of_range', outOfRangeSinceMs: 0, currentTick: 11 }), 15 * 60_000, 25 * 60_000).toJSON()

    expect(embed.color).toBe(0xef4444)
    expect(embed.fields?.find((field) => field.name === 'STATUS')?.value).toContain('OUT OF RANGE FOR 25 MINUTES')
    expect(embed.fields?.find((field) => field.name === 'PRICE RANGE')?.value).toContain('|--------------| ●')
    expect(JSON.stringify(embed)).not.toContain('NEAR RANGE')
    expect(JSON.stringify(embed)).not.toContain('┌')
  })

  it('renders in-range position with green status and final sections', () => {
    const embed = buildPositionEmbed(basePosition({ status: 'in_range', currentTick: 5 }), 15 * 60_000, 25 * 60_000).toJSON()

    expect(embed.color).toBe(0x22c55e)
    expect(embed.fields?.map((field) => field.name)).toEqual(['STATUS', 'PRICE RANGE', 'CURRENT ASSETS', 'PERFORMANCE', 'PROFIT / LOSS', 'POSITION DETAILS'])
    expect(embed.fields?.find((field) => field.name === 'STATUS')?.value).toContain('IN RANGE')
    expect(embed.fields?.find((field) => field.name === 'PRICE RANGE')?.value).toContain('|------●-------|')
    expect(embed.fields?.find((field) => field.name === 'CURRENT ASSETS')?.value).toContain('MEME')
    expect(embed.fields?.find((field) => field.name === 'PERFORMANCE')?.value).toContain('Initial Deposit')
    expect(embed.fields?.find((field) => field.name === 'PROFIT / LOSS')?.value).toContain('+869.14 USDG')
    expect(embed.fields?.find((field) => field.name === 'POSITION DETAILS')?.value).toContain('Position Age')
  })
})

function basePosition(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    id: 'v4:0x:1',
    tokenId: 123456n,
    version: 'v4',
    manager: zeroAddress,
    token0: { address: zeroAddress, symbol: 'MEME', decimals: 18 },
    token1: { address: zeroAddress, symbol: 'USDG', decimals: 18 },
    quoteToken: { address: zeroAddress, symbol: 'USDG', decimals: 18 },
    feeTier: 3000,
    tickLower: 0,
    tickUpper: 10,
    currentTick: 5,
    currentPrice: 0.105,
    lowerPrice: 0.08,
    upperPrice: 0.12,
    liquidity: 1n,
    status: 'in_range',
    mintTimestampMs: 0,
    blockNumber: 38_291_407n,
    amounts: [
      { token: { address: zeroAddress, symbol: 'MEME', decimals: 18 }, raw: 0n, formatted: '12,450.00', valueUsdg: 1551.27 },
      { token: { address: zeroAddress, symbol: 'USDG', decimals: 18 }, raw: 0n, formatted: '1,290.25', valueUsdg: 1290.25 },
    ],
    currentLpValueUsdg: 2841.52,
    claimedFeesUsdg: 9.2,
    unclaimedFeesUsdg: 18.42,
    depositedUsdg: 2000,
    withdrawnUsdg: 0,
    totalResultUsdg: 2869.14,
    profitLossUsdg: 869.14,
    profitLossPercent: 43.46,
    accountingStatus: 'synced',
    uniswapUrl: 'https://app.uniswap.org',
    explorerUrl: 'https://example.com',
    ...overrides,
  }
}
