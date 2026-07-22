import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js'
import type { PortfolioSnapshot, PositionSnapshot, TransitionAlert } from '../types.js'
import { feesTotal } from '../uniswap/accounting.js'
import { formatAge, formatNumber, formatPercent, formatSignedUsdg, formatUsdg } from '../uniswap/valuation.js'

const color = {
  portfolio: 0xff37c7,
  inRange: 0x22c55e,
  outOfRange: 0xef4444,
}

export const refreshButtonCustomId = 'kolam-refresh-now'

export function buildPortfolioEmbed(portfolio: PortfolioSnapshot) {
  const inRange = portfolio.positions.filter((position) => position.status === 'in_range').length
  const outOfRange = portfolio.positions.length - inRange
  const accountingSynced = portfolio.positions.length === 0 || portfolio.positions.every((position) => position.accountingStatus === 'synced')
  const accountingUnavailable = portfolio.positions.some((position) => position.accountingStatus === 'unavailable')
  const warnings = portfolio.warnings.length > 0 ? trimText(portfolio.warnings.map((warning) => `- ${warning}`).join('\n'), 1_020) : undefined

  return new EmbedBuilder()
    .setColor(color.portfolio)
    .setTitle('UNISWAP LP PORTFOLIO')
    .setDescription(portfolio.chainName)
    .addFields(
      {
        name: 'POSITIONS',
        value: formatRows([
          ['Open Positions', portfolio.positions.length.toString()],
          ['In Range', inRange.toString()],
          ['Out of Range', outOfRange.toString()],
        ]),
      },
      {
        name: 'VALUE',
        value: formatRows([
          ['Total Deposited', accountingSynced ? formatMaybeUsdg(portfolio.totals.depositedUsdg) : accountingUnavailable ? 'Unavailable' : 'Synchronizing'],
          ['Current LP Value', formatMaybeUsdg(portfolio.totals.currentLpValueUsdg)],
          ['Total Fees', accountingSynced ? formatMaybeUsdg(feesTotal(portfolio.totals.claimedFeesUsdg, portfolio.totals.unclaimedFeesUsdg)) : accountingUnavailable ? 'Unavailable' : 'Synchronizing'],
          ['Total Result', accountingSynced ? formatMaybeUsdg(portfolio.totals.totalResultUsdg) : accountingUnavailable ? 'Unavailable' : 'Synchronizing'],
        ]),
      },
      {
        name: 'PROFIT / LOSS',
        value: accountingSynced
          ? formatRows([
              ['PROFIT / LOSS', formatMaybeSignedUsdg(portfolio.totals.profitLossUsdg)],
              ['', formatMaybePercent(portfolio.totals.profitLossPercent)],
            ])
          : accountingUnavailable ? 'Unavailable for one or more positions' : 'Synchronizing position history',
      },
      ...(warnings ? [{ name: 'WARNINGS', value: warnings }] : []),
    )
    .setFooter({ text: `Updated ${formatUtcTime(portfolio.updatedAtMs)} UTC · Block ${formatBlock(portfolio.blockNumber)}` })
}

export function buildPositionEmbed(position: PositionSnapshot, outOfRangeEmphasisAfterMs: number, nowMs = Date.now()) {
  const isOut = position.status === 'out_of_range'

  return new EmbedBuilder()
    .setColor(isOut ? color.outOfRange : color.inRange)
    .setTitle(`${position.token0.symbol} / ${position.token1.symbol}`)
    .setDescription(`Uniswap ${position.version} · ${position.feeLabel ?? `${formatNumber(position.feeTier / 10_000, 2)}%`} fee`)
    .addFields(
      { name: 'STATUS', value: `**${getPositionStatusLabel(position, outOfRangeEmphasisAfterMs, nowMs)}**` },
      {
        name: 'PRICE RANGE',
        value: formatRows([
          ['Current Price', `${formatPrice(position.currentPrice)} ${position.quoteToken.symbol}`],
          ['Active Range', `${formatPrice(position.lowerPrice)} - ${formatPrice(position.upperPrice)} ${position.quoteToken.symbol}`],
          ['Range', getRangeMarker(position)],
        ]),
      },
      {
        name: 'CURRENT ASSETS',
        value: position.amounts.length > 0 ? formatRows(position.amounts.map((amount) => [amount.token.symbol, amount.formatted])) : 'n/a',
      },
      {
        name: 'PERFORMANCE',
        value: formatRows([
          ['Initial Deposit', accountingValue(position, position.depositedUsdg)],
          ['Current LP Value', formatMaybeUsdg(position.currentLpValueUsdg)],
          ['Unclaimed Fees', accountingValue(position, position.unclaimedFeesUsdg)],
          ['Claimed Fees', accountingValue(position, position.claimedFeesUsdg)],
          ['Total Result', accountingValue(position, position.totalResultUsdg)],
        ]),
      },
      {
        name: 'PROFIT / LOSS',
        value: position.accountingStatus === 'synced'
          ? formatRows([
              ['PROFIT / LOSS', formatMaybeSignedUsdg(position.profitLossUsdg)],
              ['', formatMaybePercent(position.profitLossPercent)],
            ])
          : position.accountingStatus === 'unavailable' ? 'Unavailable' : 'Synchronizing position history',
      },
      {
        name: 'POSITION DETAILS',
        value: formatRows([
          ['Position Age', formatAge(nowMs, position.mintTimestampMs)],
          ['Position ID', `#${position.tokenId.toString()}`],
        ]),
      },
    )
    .setFooter({ text: `Block ${formatBlock(position.blockNumber)}` })
}

export function buildTransitionAlertEmbed(alert: TransitionAlert) {
  return new EmbedBuilder()
    .setColor(color.outOfRange)
    .setTitle('POSITION LEFT RANGE')
    .setDescription(`${alert.position.token0.symbol} / ${alert.position.token1.symbol} · Uniswap ${alert.position.version}`)
    .addFields(
      { name: 'STATUS', value: '**IN RANGE -> OUT OF RANGE**' },
      {
        name: 'PRICE RANGE',
        value: formatRows([
          ['Current Price', `${formatPrice(alert.position.currentPrice)} ${alert.position.quoteToken.symbol}`],
          ['Active Range', `${formatPrice(alert.position.lowerPrice)} - ${formatPrice(alert.position.upperPrice)} ${alert.position.quoteToken.symbol}`],
        ]),
      },
      {
        name: 'POSITION DETAILS',
        value: formatRows([
          ['Position ID', `#${alert.position.tokenId.toString()}`],
          ['Detected', `${formatUtcTime(alert.detectedAtMs)} UTC`],
        ]),
      },
    )
}

export function buildPortfolioButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(refreshButtonCustomId).setLabel('Refresh Now').setStyle(ButtonStyle.Primary))
}

export function buildPositionButtons(position: PositionSnapshot) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel('View on Uniswap').setStyle(ButtonStyle.Link).setURL(position.uniswapUrl),
    new ButtonBuilder().setLabel('View on Explorer').setStyle(ButtonStyle.Link).setURL(position.explorerUrl),
  )
}

const labelWidth = 31

function formatRows(rows: Array<[string, string]>) {
  return `\`\`\`text\n${rows.map(([label, value]) => row(label, value)).join('\n')}\n\`\`\``
}

function row(label: string, value: string) {
  const safeLabel = trimText(label, labelWidth)
  const valueWidth = 22
  const safeValue = trimText(value, valueWidth)
  return `${safeLabel.padEnd(labelWidth)}${safeValue.padStart(valueWidth)}`
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

function getRangeMarker(position: PositionSnapshot) {
  if (position.status === 'in_range') return '|------●-------|'
  return position.currentTick >= position.tickUpper ? '|--------------| ●' : '● |--------------|'
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

function formatMaybeUsdg(value: number | null) {
  return value == null ? 'Unavailable' : formatUsdg(value)
}

function formatMaybeSignedUsdg(value: number | null) {
  return value == null ? 'Unavailable' : formatSignedUsdg(value)
}

function formatMaybePercent(value: number | null) {
  return value == null ? 'Unavailable' : formatPercent(value)
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
