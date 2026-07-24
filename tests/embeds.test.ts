import { describe, expect, it } from 'vitest'
import { zeroAddress } from 'viem'
import {
  buildPortfolioButtons,
  buildPortfolioEmbed,
  buildPositionButtons,
  buildPositionEmbed,
  buildTransitionAlertEmbed,
} from '../src/discord/embeds.js'
import type { PortfolioSnapshot, PositionSnapshot, TransitionAlert } from '../src/types.js'

describe('portfolio embed', () => {
  it('renders a compact profitable portfolio with responsive metric fields', () => {
    const embed = buildPortfolioEmbed(basePortfolio()).toJSON()

    expect(embed.color).toBe(0x22c55e)
    expect(embed.title).toBe('📊 Uniswap LP Portfolio')
    expect(embed.description).toBe('Robinhood Chain')
    expect(embed.fields?.map((field) => field.name)).toEqual([
      'Open Positions',
      'In Range',
      'Out of Range',
      'Deposited',
      'LP Value',
      'Total Fees',
      'Total Result',
      'Profit / Loss',
    ])
    expect(embed.fields?.every((field) => field.inline)).toBe(true)
    expect(fieldValue(embed, 'Total Fees')).toContain('118.40 USDG')
    expect(fieldValue(embed, 'Profit / Loss')).toBe('**+1,302.60 USDG**\n+13.03%')
    expect(embed.footer?.text).toBe('Updated 14:35 UTC · Block 38,291,407')
    expect(JSON.stringify(embed)).not.toContain('```')
  })

  it('uses a red accent for a loss', () => {
    const portfolio = basePortfolio()
    portfolio.totals.profitLossUsdg = -100
    portfolio.totals.profitLossPercent = -1

    const embed = buildPortfolioEmbed(portfolio).toJSON()

    expect(embed.color).toBe(0xef4444)
    expect(fieldValue(embed, 'Profit / Loss')).toBe('**-100.00 USDG**\n-1.00%')
  })

  it('marks partial and unavailable totals without rendering false zeroes', () => {
    const unavailable = basePosition({
      accountingStatus: 'unavailable',
      depositedUsdg: null,
      claimedFeesUsdg: null,
      unclaimedFeesUsdg: null,
      totalResultUsdg: null,
      profitLossUsdg: null,
      profitLossPercent: null,
    })
    const portfolio = basePortfolio({ positions: [unavailable] })
    portfolio.totals = {
      depositedUsdg: null,
      currentLpValueUsdg: 28.92,
      claimedFeesUsdg: null,
      unclaimedFeesUsdg: null,
      totalResultUsdg: null,
      profitLossUsdg: null,
      profitLossPercent: null,
      partial: true,
    }
    portfolio.warnings = ['Historical RPC calls are unavailable.']

    const embed = buildPortfolioEmbed(portfolio).toJSON()

    expect(embed.color).toBe(0x5865f2)
    expect(embed.description).toContain('⚠️ Partial data')
    expect(fieldValue(embed, 'Deposited')).toBe('**Unavailable**')
    expect(fieldValue(embed, 'LP Value')).toBe('**28.92 USDG**')
    expect(fieldValue(embed, 'Profit / Loss')).toContain('Unavailable')
    expect(fieldValue(embed, '⚠️ Warnings')).toContain('Historical RPC calls are unavailable.')
    expect(JSON.stringify(embed)).not.toContain('0.00 USDG')
  })

  it('shows a synchronizing state while position history is being indexed', () => {
    const syncing = basePosition({ accountingStatus: 'syncing' })
    const portfolio = basePortfolio({ positions: [syncing] })
    portfolio.totals.partial = true

    const embed = buildPortfolioEmbed(portfolio).toJSON()

    expect(embed.color).toBe(0x5865f2)
    expect(fieldValue(embed, 'Deposited')).toBe('**Synchronizing**')
    expect(fieldValue(embed, 'Profit / Loss')).toContain('Synchronizing position history')
  })
})

describe('position embed', () => {
  it('renders an in-range position without fixed-width tables or truncated range values', () => {
    const position = basePosition({
      currentTick: 5,
      currentPrice: 0.033239,
      lowerPrice: 0.023391,
      upperPrice: 0.040949,
      quoteToken: { address: zeroAddress, symbol: 'VERY-LONG-QUOTE', decimals: 18 },
      quoteTokenPriceUsdg: 1.5,
    })
    const embed = buildPositionEmbed(position, 15 * 60_000, 25 * 60_000).toJSON()

    expect(embed.color).toBe(0x22c55e)
    expect(embed.title).toBe('🟢 MEME / USDG')
    expect(embed.description).toBe('Uniswap v4 · 0.30% fee · #123456')
    expect(fieldValue(embed, 'Status')).toBe('**IN RANGE**')
    expect(fieldValue(embed, 'Current Price')).toBe('**0.033239 VERY-LONG-QUOTE**')
    expect(fieldValue(embed, 'Lower')).toBe('**0.023391 VERY-LONG-QUOTE**')
    expect(fieldValue(embed, 'Upper')).toBe('**0.040949 VERY-LONG-QUOTE**')
    expect(fieldValue(embed, 'Range Position')).toBe('`├───────●───────┤`')
    expect(fieldValue(embed, 'MEME')).toBe('**12,450.00**')
    expect(fieldValue(embed, 'USDG')).toBe('**1,290.25**')
    expect(embed.fields?.findIndex((field) => field.name === '\u200b')).toBeLessThan(embed.fields?.findIndex((field) => field.name === 'Deposited') ?? 0)
    expect(fieldValue(embed, 'Total Fees')).toContain('**27.6200 VERY-LONG-QUOTE ($41.43)**')
    expect(fieldValue(embed, 'Total Fees')).toContain('Claimed 9.2000 VERY-LONG-QUOTE ($13.80)')
    expect(fieldValue(embed, 'Total Fees')).toContain('Unclaimed 18.4200 VERY-LONG-QUOTE ($27.63)')
    expect(fieldValue(embed, 'Deposited')).toBe('**2,000.0000 VERY-LONG-QUOTE ($3,000.00)**')
    expect(fieldValue(embed, 'LP Value')).toBe('**2,841.5200 VERY-LONG-QUOTE ($4,262.28)**')
    expect(fieldValue(embed, 'Total Result')).toBe('**2,927.6200 VERY-LONG-QUOTE ($4,391.43)**')
    expect(fieldValue(embed, 'Profit / Loss')).toBe('**-72.3800 VERY-LONG-QUOTE (-$108.57)**\n-2.41%\n*Includes IL + fees*')
    expect(embed.fields?.map((field) => field.name)).not.toContain('Impermanent Loss')
    expect(embed.fields?.map((field) => field.name)).not.toContain('HODL Value')
    expect(embed.footer?.text).toBe('Age 25 minutes · Block 38,291,407')
    expect(JSON.stringify(embed)).not.toContain('```')
    expect(JSON.stringify(embed)).not.toContain('…')
  })

  it('uses amber and emphasizes a position that has remained out of range', () => {
    const embed = buildPositionEmbed(
      basePosition({ status: 'out_of_range', outOfRangeSinceMs: 0, currentTick: 11 }),
      15 * 60_000,
      25 * 60_000,
    ).toJSON()

    expect(embed.color).toBe(0xf59e0b)
    expect(embed.title).toBe('🟠 MEME / USDG')
    expect(fieldValue(embed, 'Status')).toContain('OUT OF RANGE FOR 25 MINUTES')
  })

  it('keeps quote values available when the USDG conversion route is missing', () => {
    const embed = buildPositionEmbed(basePosition({
      quoteToken: { address: zeroAddress, symbol: 'ETH', decimals: 18 },
      quoteTokenPriceUsdg: null,
    }), 15 * 60_000, 25 * 60_000).toJSON()

    expect(fieldValue(embed, 'Deposited')).toContain('ETH (USDG unavailable)')
  })

  it('shows positive signs consistently for quote and USDG profit', () => {
    const embed = buildPositionEmbed(basePosition({
      quoteToken: { address: zeroAddress, symbol: 'ETH', decimals: 18 },
      quoteTokenPriceUsdg: 2_000,
      netLpResultQuote: 0.001,
      netLpResultPercent: 2,
    }), 15 * 60_000, 25 * 60_000).toJSON()

    expect(fieldValue(embed, 'Profit / Loss')).toContain('+0.001000 ETH (+$2.00)')
  })

  it.each([
    ['lower bound', 0, 0, 10, '`├●──────────────┤`'],
    ['middle', 5, 0, 10, '`├───────●───────┤`'],
    ['near upper bound', 9, 0, 10, '`├─────────────●─┤`'],
    ['below range', -1, 0, 10, '`●  ├───────────────┤`'],
    ['at upper bound', 10, 0, 10, '`├───────────────┤  ●`'],
    ['above range', 11, 0, 10, '`├───────────────┤  ●`'],
    ['wide negative range', -150, -300, 0, '`├───────●───────┤`'],
  ])('places the tick marker at the %s', (_case, currentTick, tickLower, tickUpper, expected) => {
    const status = currentTick >= tickLower && currentTick < tickUpper ? 'in_range' : 'out_of_range'
    const embed = buildPositionEmbed(basePosition({ currentTick, tickLower, tickUpper, status }), 15 * 60_000, 25 * 60_000).toJSON()

    expect(fieldValue(embed, 'Range Position')).toBe(expected)
  })

  it('renders dynamic fee labels unchanged', () => {
    const embed = buildPositionEmbed(basePosition({ feeLabel: 'Dynamic' }), 15 * 60_000, 25 * 60_000).toJSON()

    expect(embed.description).toContain('Uniswap v4 · Dynamic fee · #123456')
  })

  it.each([
    ['syncing', 'Synchronizing', 'Position history is still synchronizing.'],
    ['unavailable', 'Unavailable', 'Archive history is missing.'],
  ] as const)('renders %s accounting explicitly', (accountingStatus, label, notice) => {
    const position = basePosition({
      accountingStatus,
      accountingError: accountingStatus === 'unavailable' ? 'Archive history is missing.' : undefined,
      depositedUsdg: null,
      claimedFeesUsdg: null,
      unclaimedFeesUsdg: null,
      totalResultUsdg: null,
      profitLossUsdg: null,
      profitLossPercent: null,
    })

    const embed = buildPositionEmbed(position, 15 * 60_000, 25 * 60_000).toJSON()

    expect(embed.color).toBe(0x5865f2)
    expect(fieldValue(embed, 'Deposited')).toBe(`**${label}**`)
    expect(fieldValue(embed, 'Total Fees')).toBe(`**${label}**`)
    expect(fieldValue(embed, 'Profit / Loss')).toContain(label)
    expect(fieldValue(embed, '⚠️ Accounting')).toContain(notice)
    expect(JSON.stringify(embed)).not.toContain('0.00 USDG')
  })
})

describe('alerts, actions, and Discord limits', () => {
  it('renders transition alerts with a red accent and compact range metrics', () => {
    const alert: TransitionAlert = {
      position: basePosition({ status: 'out_of_range' }),
      from: 'in_range',
      to: 'out_of_range',
      detectedAtMs: Date.UTC(2026, 6, 22, 14, 35),
    }

    const embed = buildTransitionAlertEmbed(alert).toJSON()

    expect(embed.color).toBe(0xef4444)
    expect(embed.title).toBe('🔴 Position Left Range')
    expect(fieldValue(embed, 'Status')).toBe('**IN RANGE → OUT OF RANGE**')
    expect(fieldValue(embed, 'Range Position')).toBe('`├───────●───────┤`')
    expect(fieldValue(embed, 'Detected')).toBe('**14:35 UTC**')
  })

  it('uses concise and consistent button labels', () => {
    const portfolioButtons = buildPortfolioButtons().toJSON()
    const positionButtons = buildPositionButtons(basePosition()).toJSON()

    expect(portfolioButtons.components.map((button) => 'label' in button ? button.label : undefined)).toEqual(['Refresh'])
    expect(positionButtons.components.map((button) => 'label' in button ? button.label : undefined)).toEqual(['Open Uniswap', 'Explorer'])
  })

  it('keeps generated embeds inside Discord field limits', () => {
    const embeds = [
      buildPortfolioEmbed(basePortfolio()).toJSON(),
      buildPositionEmbed(basePosition(), 15 * 60_000, 25 * 60_000).toJSON(),
    ]

    for (const embed of embeds) {
      expect(embed.title?.length ?? 0).toBeLessThanOrEqual(256)
      expect(embed.description?.length ?? 0).toBeLessThanOrEqual(4_096)
      expect(embed.fields?.length ?? 0).toBeLessThanOrEqual(25)
      for (const field of embed.fields ?? []) {
        expect(field.name.length).toBeLessThanOrEqual(256)
        expect(field.value.length).toBeLessThanOrEqual(1_024)
      }
      expect(embed.footer?.text.length ?? 0).toBeLessThanOrEqual(2_048)
    }
  })
})

function fieldValue(embed: ReturnType<ReturnType<typeof buildPortfolioEmbed>['toJSON']>, name: string) {
  return embed.fields?.find((field) => field.name === name)?.value
}

function basePortfolio(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
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
    ...overrides,
  }
}

function basePosition(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    id: 'v4:0x:1',
    tokenId: 123456n,
    version: 'v4',
    manager: zeroAddress,
    token0: { address: zeroAddress, symbol: 'MEME', decimals: 18 },
    token1: { address: zeroAddress, symbol: 'USDG', decimals: 18 },
    quoteToken: { address: zeroAddress, symbol: 'USDG', decimals: 18 },
    quoteTokenPriceUsdg: 1,
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
    hodlValueQuote: 3000,
    lpPrincipalValueQuote: 2900,
    claimedFeesValueQuote: 9.2,
    unclaimedFeesValueQuote: 18.42,
    impermanentLossQuote: -100,
    impermanentLossPercent: -3.3333,
    netLpResultQuote: -72.38,
    netLpResultPercent: -2.4127,
    depositedValueQuote: 2000,
    activeLpValueQuote: 2841.52,
    totalResultValueQuote: 2927.62,
    accountingStatus: 'synced',
    uniswapUrl: 'https://app.uniswap.org',
    explorerUrl: 'https://example.com',
    ...overrides,
  }
}
