import { formatUnits } from 'viem'
import type { StoredPositionCashflow } from '../state/database.js'
import type { TokenInfo } from '../types.js'

export interface ImpermanentLossResult {
  hodlValueQuote: number
  lpPrincipalValueQuote: number
  claimedFeesValueQuote: number
  unclaimedFeesValueQuote: number
  impermanentLossQuote: number
  impermanentLossPercent: number
  netLpResultQuote: number
  netLpResultPercent: number
}

export function calculateImpermanentLoss(input: {
  token0: TokenInfo
  token1: TokenInfo
  quoteToken: TokenInfo
  currentPrice: number
  current0Raw: bigint
  current1Raw: bigint
  unclaimed0Raw: bigint
  unclaimed1Raw: bigint
  cashflows: StoredPositionCashflow[]
}): ImpermanentLossResult {
  const deposits = sumCashflows(input.cashflows, 'deposit')
  if (deposits[0] === 0n && deposits[1] === 0n) throw new Error('Impermanent loss unavailable because no deposit cashflow was found')
  const withdrawals = sumCashflows(input.cashflows, 'withdrawal')
  const claimedFees = sumCashflows(input.cashflows, 'fee')
  const value = (raw0: bigint, raw1: bigint) => valuePairInQuote({
    token0: input.token0,
    token1: input.token1,
    quoteToken: input.quoteToken,
    currentPrice: input.currentPrice,
    raw0,
    raw1,
  })

  const hodlValueQuote = value(deposits[0], deposits[1])
  if (!Number.isFinite(hodlValueQuote) || hodlValueQuote <= 0) throw new Error('Impermanent loss unavailable because the HODL benchmark has no value')
  const lpPrincipalValueQuote = value(input.current0Raw + withdrawals[0], input.current1Raw + withdrawals[1])
  const claimedFeesValueQuote = value(claimedFees[0], claimedFees[1])
  const unclaimedFeesValueQuote = value(input.unclaimed0Raw, input.unclaimed1Raw)
  const impermanentLossQuote = lpPrincipalValueQuote - hodlValueQuote
  const impermanentLossPercent = (impermanentLossQuote / hodlValueQuote) * 100
  const netLpResultQuote = impermanentLossQuote + claimedFeesValueQuote + unclaimedFeesValueQuote
  const netLpResultPercent = (netLpResultQuote / hodlValueQuote) * 100

  return {
    hodlValueQuote,
    lpPrincipalValueQuote,
    claimedFeesValueQuote,
    unclaimedFeesValueQuote,
    impermanentLossQuote,
    impermanentLossPercent,
    netLpResultQuote,
    netLpResultPercent,
  }
}

export function valuePairInQuote(input: {
  token0: TokenInfo
  token1: TokenInfo
  quoteToken: TokenInfo
  currentPrice: number
  raw0: bigint
  raw1: bigint
}) {
  const amount0 = Number(formatUnits(input.raw0, input.token0.decimals))
  const amount1 = Number(formatUnits(input.raw1, input.token1.decimals))
  if (same(input.quoteToken.address, input.token0.address)) return amount0 + amount1 * input.currentPrice
  if (same(input.quoteToken.address, input.token1.address)) return amount1 + amount0 * input.currentPrice
  throw new Error('Impermanent loss quote token is not part of the pair')
}

export async function calculateDepositedValueQuote(input: {
  cashflows: StoredPositionCashflow[]
  valueAtBlock(raw0: bigint, raw1: bigint, blockNumber: bigint): Promise<number>
}) {
  let total = 0
  let found = false
  for (const cashflow of input.cashflows) {
    if (cashflow.type !== 'deposit') continue
    found = true
    total += await input.valueAtBlock(cashflow.token0Raw, cashflow.token1Raw, cashflow.blockNumber)
  }
  if (!found) throw new Error('Deposited value unavailable because no deposit cashflow was found')
  return total
}

function sumCashflows(cashflows: StoredPositionCashflow[], type: StoredPositionCashflow['type']): [bigint, bigint] {
  return cashflows.reduce<[bigint, bigint]>((sum, cashflow) => {
    if (cashflow.type !== type) return sum
    return [sum[0] + cashflow.token0Raw, sum[1] + cashflow.token1Raw]
  }, [0n, 0n])
}

function same(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase()
}
