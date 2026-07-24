import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js'
import type { PortfolioSnapshot, PositionSnapshot, TransitionAlert } from '../types.js'
import { feesTotal } from '../uniswap/accounting.js'
import { formatAge, formatNumber, formatPercent, formatSignedUsdg, formatUsdg } from '../uniswap/valuation.js'

const color = {
  neutral: 0x5865f2,
  inRange: 0x22c55e,
  outOfRange: 0xf59e0b,
  alert: 0xef4444,
}

export const refreshButtonCustomId = 'kolam-refresh-now'

export function buildPortfolioEmbed(portfolio: PortfolioSnapshot) {
  const inRange = portfolio.positions.filter((position) => position.status === 'in_range').length
  const outOfRange = portfolio.positions.length - inRange
  const accountingSynced = portfolio.positions.length === 0 || portfolio.positions.every((position) => position.accountingStatus === 'synced')
  const accountingUnavailable = portfolio.positions.some((position) => position.accountingStatus === 'unavailable')
  const isPartial = portfolio.totals.partial || !accountingSynced
  const warnings = portfolio.warnings.length > 0 ? trimText(portfolio.warnings.map((warning) => `• ${warning}`).join('\n'), 1_024) : undefined
  const accountingState = accountingUnavailable ? 'Unavailable' : 'Synchronizing'
  const fees = feesTotal(portfolio.totals.claimedFeesUsdg, portfolio.totals.unclaimedFeesUsdg)

  return new EmbedBuilder()
    .setColor(getPortfolioColor(portfolio))
    .setTitle('📊 Uniswap LP Portfolio')
    .setDescription(`${portfolio.chainName}${isPartial ? ' · ⚠️ Partial data' : ''}`)
    .addFields(
      metric('Open Positions', portfolio.positions.length.toString()),
      metric('In Range', `🟢 ${inRange}`),
      metric('Out of Range', outOfRange > 0 ? `🟠 ${outOfRange}` : outOfRange.toString()),
      metric('Deposited', accountingSynced ? formatMaybeUsdg(portfolio.totals.depositedUsdg) : accountingState),
      metric('LP Value', formatMaybeUsdg(portfolio.totals.currentLpValueUsdg)),
      metric('Total Fees', accountingSynced ? formatMaybeUsdg(fees) : accountingState),
      metric('Total Result', accountingSynced ? formatMaybeUsdg(portfolio.totals.totalResultUsdg) : accountingState),
      {
        name: 'Profit / Loss',
        value: accountingSynced
          ? `${formatProfitLoss(portfolio.totals.profitLossUsdg, portfolio.totals.profitLossPercent)}\n*Includes IL + fees*`
          : `*${accountingUnavailable ? 'Unavailable for one or more positions' : 'Synchronizing position history'}*`,
        inline: true,
      },
      ...(warnings ? [{ name: '⚠️ Warnings', value: warnings }] : []),
    )
    .setFooter({ text: `Updated ${formatUtcTime(portfolio.updatedAtMs)} UTC · Block ${formatBlock(portfolio.blockNumber)}` })
}

export function buildPositionEmbed(position: PositionSnapshot, outOfRangeEmphasisAfterMs: number, nowMs = Date.now()) {
  const isOut = position.status === 'out_of_range'
  const totalFeesQuote = addNullable(position.claimedFeesValueQuote, position.unclaimedFeesValueQuote)
  const accountingNotice = getAccountingNotice(position)

  return new EmbedBuilder()
    .setColor(getPositionColor(position))
    .setTitle(`${isOut ? '🟠' : '🟢'} ${position.token0.symbol} / ${position.token1.symbol}`)
    .setDescription(`Uniswap ${position.version} · ${position.feeLabel ?? `${formatNumber(position.feeTier / 10_000, 2)}%`} fee · #${position.tokenId.toString()}`)
    .addFields(
      {
        name: 'Status',
        value: `**${getPositionStatusLabel(position, outOfRangeEmphasisAfterMs, nowMs)}**`,
      },
      priceMetric('Current Price', position.currentPrice, position.quoteToken.symbol),
      priceMetric('Lower', position.lowerPrice, position.quoteToken.symbol),
      priceMetric('Upper', position.upperPrice, position.quoteToken.symbol),
      { name: 'Range Position', value: getRangeMarker(position) },
      metric('Deposited', quoteAccountingValue(position, position.depositedValueQuote)),
      metric('Total Result', quoteAccountingValue(position, position.totalResultValueQuote)),
      lpValueMetric(position),
      {
        name: 'Fees',
        value: position.accountingStatus === 'synced'
          ? `Claimed: ${formatQuoteValue(position.claimedFeesValueQuote, position)}\nUnclaimed: ${formatQuoteValue(position.unclaimedFeesValueQuote, position)}\n**Total: ${formatQuoteValue(totalFeesQuote, position)}**`
          : `**${quoteAccountingValue(position, totalFeesQuote)}**`,
        inline: false,
      },
      {
        name: 'Profit / Loss',
        value: position.accountingStatus === 'synced'
          ? `${formatQuoteResult(position.netLpResultQuote, position.netLpResultPercent, position)}\n*Includes IL + fees*`
          : `*${position.accountingStatus === 'unavailable' ? 'Unavailable' : 'Synchronizing'}*`,
        inline: false,
      },
      ...(accountingNotice ? [{ name: '⚠️ Accounting', value: accountingNotice }] : []),
    )
    .setFooter({ text: `Age ${formatAge(nowMs, position.mintTimestampMs)} · Block ${formatBlock(position.blockNumber)}` })
}

export function buildTransitionAlertEmbed(alert: TransitionAlert) {
  return new EmbedBuilder()
    .setColor(color.alert)
    .setTitle('🔴 Position Left Range')
    .setDescription(`${alert.position.token0.symbol} / ${alert.position.token1.symbol} · Uniswap ${alert.position.version} · #${alert.position.tokenId.toString()}`)
    .addFields(
      { name: 'Status', value: '**IN RANGE → OUT OF RANGE**' },
      priceMetric('Current Price', alert.position.currentPrice, alert.position.quoteToken.symbol),
      priceMetric('Lower', alert.position.lowerPrice, alert.position.quoteToken.symbol),
      priceMetric('Upper', alert.position.upperPrice, alert.position.quoteToken.symbol),
      { name: 'Range Position', value: getRangeMarker(alert.position) },
      { name: 'Detected', value: `**${formatUtcTime(alert.detectedAtMs)} UTC**`, inline: true },
    )
}

export function buildPortfolioButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(refreshButtonCustomId).setLabel('Refresh').setStyle(ButtonStyle.Primary))
}

export function buildPositionButtons(position: PositionSnapshot) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel('Open Uniswap').setStyle(ButtonStyle.Link).setURL(position.uniswapUrl),
    new ButtonBuilder().setLabel('Explorer').setStyle(ButtonStyle.Link).setURL(position.explorerUrl),
  )
}

function metric(name: string, value: string) {
  return { name, value: `**${value}**`, inline: true }
}

function priceMetric(name: string, value: number, quoteSymbol: string) {
  return metric(name, `${formatPrice(value)} ${quoteSymbol}`)
}

function lpValueMetric(position: PositionSnapshot) {
  const tokenLines = position.amounts.map((amount) => {
    const usdg = amount.valueUsdg == null ? 'USDG unavailable' : formatDollar(amount.valueUsdg)
    return `${amount.token.symbol}: ${amount.formatted} (${usdg})`
  })
  const totalUsdg = position.amounts.length > 0 && position.amounts.every((amount) => amount.valueUsdg != null)
    ? position.amounts.reduce((total, amount) => total + (amount.valueUsdg ?? 0), 0)
    : null
  const totalPrimary = position.activeLpValueQuote == null
    ? 'Unavailable'
    : formatQuotePrimary(position.activeLpValueQuote, position.quoteToken.symbol)
  const total = position.quoteToken.symbol.toUpperCase() === 'USDG'
    ? totalPrimary
    : `${totalPrimary} (${totalUsdg == null ? 'USDG unavailable' : formatDollar(totalUsdg)})`
  return {
    name: 'LP Composition',
    value: [...tokenLines, `**Total: ${total}**`].join('\n'),
    inline: false,
  }
}

function trimText(value: string, maxLength: number) {
  if (visibleLength(value) <= maxLength) return value
  return `${[...value].slice(0, Math.max(0, maxLength - 1)).join('')}…`
}

function visibleLength(value: string) {
  return [...value].length
}

function getPositionStatusLabel(position: PositionSnapshot, outOfRangeEmphasisAfterMs: number, nowMs: number) {
  if (position.status === 'in_range') return 'IN RANGE'
  const outDurationMs = position.outOfRangeSinceMs != null ? nowMs - position.outOfRangeSinceMs : 0
  if (outDurationMs >= outOfRangeEmphasisAfterMs) return `OUT OF RANGE FOR ${formatAge(nowMs, position.outOfRangeSinceMs ?? nowMs).toUpperCase()}`
  return 'OUT OF RANGE'
}

const rangeSlots = 15

function getRangeMarker(position: Pick<PositionSnapshot, 'currentTick' | 'tickLower' | 'tickUpper'>) {
  const rangeLine = '─'.repeat(rangeSlots)
  if (position.currentTick < position.tickLower) return `\`●  ├${rangeLine}┤\``
  if (position.currentTick >= position.tickUpper) return `\`├${rangeLine}┤  ●\``

  const tickSpan = position.tickUpper - position.tickLower
  const progress = tickSpan > 0 ? (position.currentTick - position.tickLower) / tickSpan : 0
  const pointIndex = Math.max(0, Math.min(rangeSlots - 1, Math.round(progress * (rangeSlots - 1))))
  return `\`├${'─'.repeat(pointIndex)}●${'─'.repeat(rangeSlots - pointIndex - 1)}┤\``
}

function formatPrice(value: number) {
  if (value === 0) return '0'
  if (Math.abs(value) >= 1) return formatNumber(value, 3)
  const absolute = Math.abs(value)
  if (absolute >= 0.000001) return trimDecimal(formatNumber(value, 6))
  const leadingZeroes = Math.max(0, Math.floor(-Math.log10(absolute)))
  return trimDecimal(formatNumber(value, Math.min(18, leadingZeroes + 4)))
}

function trimDecimal(value: string) {
  return value.replace(/0+$/, '').replace(/\.$/, '')
}

function quoteAccountingValue(position: PositionSnapshot, value: number | null) {
  if (position.accountingStatus === 'unavailable') return 'Unavailable'
  if (position.accountingStatus === 'syncing') return 'Synchronizing'
  return formatQuoteValue(value, position)
}

function formatQuoteValue(value: number | null, position: Pick<PositionSnapshot, 'quoteToken' | 'quoteTokenPriceUsdg'>, signed = false) {
  if (value == null) return 'Unavailable'
  const primary = formatQuotePrimary(value, position.quoteToken.symbol, signed)
  const symbol = position.quoteToken.symbol
  if (symbol.toUpperCase() === 'USDG') return primary
  if (position.quoteTokenPriceUsdg == null) return `${primary} (USDG unavailable)`
  return `${primary} (${formatDollar(value * position.quoteTokenPriceUsdg, signed)})`
}

function formatQuotePrimary(value: number, symbol: string, signed = false) {
  const digits = symbol.toUpperCase() === 'USDG' ? 2 : value !== 0 && Math.abs(value) < 0.01 ? 6 : 4
  const sign = signed && value > 0 ? '+' : ''
  return `${sign}${formatNumber(value, digits)} ${symbol}`
}

function formatDollar(value: number, signed = false) {
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : ''
  return `${sign}$${formatNumber(Math.abs(value), 2)}`
}

function formatQuoteResult(value: number | null, percent: number | null, position: Pick<PositionSnapshot, 'quoteToken' | 'quoteTokenPriceUsdg'>) {
  if (value == null || percent == null) return '*Unavailable*'
  const percentSign = percent > 0 ? '+' : ''
  return `**${formatQuoteValue(value, position, true)}**\n${percentSign}${formatNumber(percent, 2)}%`
}

function addNullable(left: number | null | undefined, right: number | null | undefined) {
  return left == null || right == null ? null : left + right
}

function getAccountingNotice(position: PositionSnapshot) {
  if (position.accountingStatus === 'syncing') return '*Position history is still synchronizing.*'
  if (position.accountingStatus !== 'unavailable') return undefined
  return trimText(position.accountingError ? `Accounting unavailable: ${position.accountingError}` : 'Accounting is unavailable for this position.', 1_024)
}

function getPortfolioColor(portfolio: PortfolioSnapshot) {
  if (portfolio.totals.partial || portfolio.totals.profitLossUsdg == null) return color.neutral
  return portfolio.totals.profitLossUsdg < 0 ? color.alert : color.inRange
}

function getPositionColor(position: PositionSnapshot) {
  if (position.accountingStatus !== 'synced') return color.neutral
  return position.status === 'out_of_range' ? color.outOfRange : color.inRange
}

function formatProfitLoss(value: number | null, percent: number | null) {
  if (value == null || percent == null) return '*Unavailable*'
  return `**${formatSignedUsdg(value)}**\n${formatPercent(percent)}`
}

function formatMaybeUsdg(value: number | null) {
  return value == null ? 'Unavailable' : formatUsdg(value)
}

function formatBlock(blockNumber: bigint) {
  return new Intl.NumberFormat('en-US').format(Number(blockNumber))
}

function formatUtcTime(timestampMs: number) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(timestampMs))
}
