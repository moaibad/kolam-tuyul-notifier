import { formatUnits } from 'viem'
import type { StoredPositionCashflow } from '../state/database.js'
import type { TokenInfo } from '../types.js'

export interface EntryPriceBasis {
  token0PriceUsdg: number
  token1PriceUsdg: number
  token0BalanceRaw: bigint
  token1BalanceRaw: bigint
}

export interface EntryValuation {
  basis: EntryPriceBasis
  depositedUsdg: number
  withdrawnUsdg: number
  claimedFeesUsdg: number
}

export async function calculateEntryValuation(input: {
  token0: TokenInfo
  token1: TokenInfo
  cashflows: StoredPositionCashflow[]
  priceAt(token: TokenInfo, blockNumber: bigint): Promise<number | null>
}): Promise<EntryValuation> {
  const token0 = createTokenBasis(input.token0)
  const token1 = createTokenBasis(input.token1)
  let depositedUsdg = 0
  let withdrawnUsdg = 0
  let claimedFeesUsdg = 0

  for (const cashflow of input.cashflows) {
    const [price0, price1] = await Promise.all([
      input.priceAt(input.token0, cashflow.blockNumber),
      input.priceAt(input.token1, cashflow.blockNumber),
    ])
    if (price0 == null || price1 == null) {
      throw new Error(`Entry price unavailable at block ${cashflow.blockNumber.toString()}`)
    }

    if (cashflow.type === 'deposit') {
      depositedUsdg += addDeposit(token0, cashflow.token0Raw, price0)
      depositedUsdg += addDeposit(token1, cashflow.token1Raw, price1)
      rememberFallback(token0, price0)
      rememberFallback(token1, price1)
    } else if (cashflow.type === 'withdrawal') {
      withdrawnUsdg += removeAtBasis(token0, cashflow.token0Raw)
      withdrawnUsdg += removeAtBasis(token1, cashflow.token1Raw)
    } else {
      claimedFeesUsdg += valueAtBasis(token0, cashflow.token0Raw)
      claimedFeesUsdg += valueAtBasis(token1, cashflow.token1Raw)
    }
  }

  if (input.cashflows.every((cashflow) => cashflow.type !== 'deposit')) {
    throw new Error('Entry price unavailable because no deposit cashflow was found')
  }

  return {
    basis: {
      token0PriceUsdg: unitPrice(token0),
      token1PriceUsdg: unitPrice(token1),
      token0BalanceRaw: token0.balanceRaw,
      token1BalanceRaw: token1.balanceRaw,
    },
    depositedUsdg,
    withdrawnUsdg,
    claimedFeesUsdg,
  }
}

export function valueRawAtEntryPrice(raw: bigint, token: TokenInfo, priceUsdg: number) {
  return Number(formatUnits(raw, token.decimals)) * priceUsdg
}

interface TokenBasis {
  token: TokenInfo
  balanceRaw: bigint
  costUsdg: number
  fallbackPriceUsdg?: number
}

function createTokenBasis(token: TokenInfo): TokenBasis {
  return { token, balanceRaw: 0n, costUsdg: 0 }
}

function addDeposit(basis: TokenBasis, raw: bigint, priceUsdg: number) {
  const value = valueRawAtEntryPrice(raw, basis.token, priceUsdg)
  basis.balanceRaw += raw
  basis.costUsdg += value
  return value
}

function removeAtBasis(basis: TokenBasis, raw: bigint) {
  const value = valueAtBasis(basis, raw)
  if (raw >= basis.balanceRaw) {
    basis.balanceRaw = 0n
    basis.costUsdg = 0
  } else {
    basis.balanceRaw -= raw
    basis.costUsdg = Math.max(0, basis.costUsdg - value)
  }
  return value
}

function valueAtBasis(basis: TokenBasis, raw: bigint) {
  return valueRawAtEntryPrice(raw, basis.token, unitPrice(basis))
}

function unitPrice(basis: TokenBasis) {
  if (basis.balanceRaw > 0n) {
    const units = Number(formatUnits(basis.balanceRaw, basis.token.decimals))
    if (units > 0) return basis.costUsdg / units
  }
  if (basis.fallbackPriceUsdg != null) return basis.fallbackPriceUsdg
  throw new Error(`Entry price unavailable for ${basis.token.symbol}`)
}

function rememberFallback(basis: TokenBasis, priceUsdg: number) {
  basis.fallbackPriceUsdg ??= priceUsdg
}
