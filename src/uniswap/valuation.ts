import { formatUnits } from 'viem'
import type { RangeStatus, TokenInfo } from '../types.js'

export function isUsdg(token: TokenInfo, usdgAddress?: string) {
  return Boolean(usdgAddress && token.address.toLowerCase() === usdgAddress.toLowerCase()) || token.symbol.toUpperCase() === 'USDG'
}

export function formatTokenAmount(raw: bigint, decimals: number, digits = 4) {
  return formatNumber(Number(formatUnits(raw, decimals)), digits)
}

export function formatUsdg(value: number) {
  return `${formatNumber(value, 2)} USDG`
}

export function formatPercent(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatNumber(value, 2)}%`
}

export function formatSignedUsdg(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatUsdg(value)}`
}

export function formatNumber(value: number, digits: number) {
  if (!Number.isFinite(value)) return 'n/a'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

export function tickToPrice(tick: number, baseDecimals: number, quoteDecimals: number) {
  return 1.0001 ** tick * 10 ** (baseDecimals - quoteDecimals)
}

export function getRangeStatus(currentTick: number, tickLower: number, tickUpper: number): RangeStatus {
  return currentTick >= tickLower && currentTick < tickUpper ? 'in_range' : 'out_of_range'
}

export function calculateProfit(totalResultUsdg: number, depositedUsdg: number) {
  const profitLossUsdg = totalResultUsdg - depositedUsdg
  const profitLossPercent = depositedUsdg > 0 ? (profitLossUsdg / depositedUsdg) * 100 : 0
  return { profitLossUsdg, profitLossPercent }
}

export function formatAge(nowMs: number, startedAtMs: number) {
  const minutes = Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000))
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days} days, ${hours} hours`
  if (hours > 0) return `${hours} hours, ${mins} minutes`
  return `${mins} minutes`
}
