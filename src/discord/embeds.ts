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
          ? formatProfitLoss(portfolio.totals.profitLossUsdg, portfolio.totals.profitLossPercent)
          : `*${accountingUnavailable ? 'Unavailable for one or more positions' : 'Synchronizing position history'}*`,
        inline: true,
      },
      ...(warnings ? [{ name: '⚠️ Warnings', value: warnings }] : []),
    )
    .setFooter({ text: `Updated ${formatUtcTime(portfolio.updatedAtMs)} UTC · Block ${formatBlock(portfolio.blockNumber)}` })
}

export function buildPositionEmbed(position: PositionSnapshot, outOfRangeEmphasisAfterMs: number, nowMs = Date.now()) {
  const isOut = position.status === 'out_of_range'
  const totalFees = feesTotal(position.claimedFeesUsdg, position.unclaimedFeesUsdg)
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
      ...getAssetFields(position),
      metric('Deposited', accountingValue(position, position.depositedUsdg)),
      metric('LP Value', formatMaybeUsdg(position.currentLpValueUsdg)),
      {
        name: 'Total Fees',
        value: position.accountingStatus === 'synced'
          ? `**${formatMaybeUsdg(totalFees)}**\nClaimed ${formatMaybeUsdg(position.claimedFeesUsdg)}\nUnclaimed ${formatMaybeUsdg(position.unclaimedFeesUsdg)}`
          : `**${accountingValue(position, totalFees)}**`,
        inline: true,
      },
      metric('Total Result', accountingValue(position, position.totalResultUsdg)),
      {
        name: 'Profit / Loss',
        value: position.accountingStatus === 'synced'
          ? formatProfitLoss(position.profitLossUsdg, position.profitLossPercent)
          : `*${position.accountingStatus === 'unavailable' ? 'Unavailable' : 'Synchronizing'}*`,
        inline: true,
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

function getAssetFields(position: PositionSnapshot) {
  if (position.amounts.length === 0) return [{ name: 'Current Assets', value: '*Unavailable*' }]
  const fields = position.amounts.map((amount) => metric(amount.token.symbol, amount.formatted))
  while (fields.length % 3 !== 0) fields.push({ name: '\u200b', value: '\u200b', inline: true })
  return fields
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
  if (Math.abs(value) >= 1) return formatNumber(value, 3)
  return formatNumber(value, 6).replace(/0+$/, '').replace(/\.$/, '')
}

function accountingValue(position: PositionSnapshot, value: number | null) {
  if (position.accountingStatus === 'unavailable') return 'Unavailable'
  if (position.accountingStatus === 'syncing') return 'Synchronizing'
  return formatMaybeUsdg(value)
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
