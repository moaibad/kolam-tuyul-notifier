import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import type { StoredPositionCashflow } from '../src/state/database.js'
import { calculateDepositedValueQuote, calculateImpermanentLoss } from '../src/uniswap/impermanent-loss.js'

const ETH = token('0x0000000000000000000000000000000000000001', 'ETH')
const GME = token('0x0000000000000000000000000000000000000002', 'GME')
const USDG = token('0x0000000000000000000000000000000000000003', 'USDG')
const unit = 10n ** 18n

describe('impermanent loss', () => {
  it('is zero for an untouched out-of-range position regardless of ETH/USDG', () => {
    const result = calculate({ deposits: [unit, 0n], current: [unit, 0n], currentPrice: 0.01 })
    expect(result.impermanentLossQuote).toBe(0)
    expect(result.impermanentLossPercent).toBe(0)
  })

  it('compares changed LP composition with the deposited-token HODL benchmark', () => {
    const result = calculate({ deposits: [unit, 100n * unit], current: [8n * unit / 10n, 80n * unit], currentPrice: 0.01 })
    expect(result.hodlValueQuote).toBeCloseTo(2)
    expect(result.lpPrincipalValueQuote).toBeCloseTo(1.6)
    expect(result.impermanentLossQuote).toBeCloseTo(-0.4)
    expect(result.impermanentLossPercent).toBeCloseTo(-20)
  })

  it('keeps fees outside IL and includes them in net LP result', () => {
    const result = calculate({
      deposits: [unit, 100n * unit],
      current: [8n * unit / 10n, 80n * unit],
      claimedFees: [unit / 10n, 0n],
      unclaimed: [unit / 20n, 0n],
      currentPrice: 0.01,
    })
    expect(result.impermanentLossQuote).toBeCloseTo(-0.4)
    expect(result.netLpResultQuote).toBeCloseTo(-0.25)
  })

  it('includes withdrawn principal in the LP strategy side', () => {
    const result = calculate({ deposits: [unit, 0n], current: [unit / 2n, 0n], withdrawals: [unit / 2n, 0n], currentPrice: 0.01 })
    expect(result.impermanentLossQuote).toBe(0)
  })

  it('adds multiple deposits to the HODL benchmark', () => {
    const result = calculateImpermanentLoss({
      token0: ETH, token1: GME, quoteToken: ETH, currentPrice: 0.01,
      current0Raw: 2n * unit, current1Raw: 100n * unit, unclaimed0Raw: 0n, unclaimed1Raw: 0n,
      cashflows: [flow('deposit', unit, 0n), flow('deposit', unit, 100n * unit)],
    })
    expect(result.hodlValueQuote).toBeCloseTo(3)
    expect(result.impermanentLossQuote).toBe(0)
  })

  it('supports USDG as the pair quote token', () => {
    const result = calculateImpermanentLoss({
      token0: GME, token1: USDG, quoteToken: USDG, currentPrice: 2,
      current0Raw: 10n * unit, current1Raw: 5n * unit, unclaimed0Raw: 0n, unclaimed1Raw: 0n,
      cashflows: [flow('deposit', 10n * unit, 5n * unit)],
    })
    expect(result.hodlValueQuote).toBe(25)
    expect(result.impermanentLossQuote).toBe(0)
  })

  it('fails when deposit history is missing', () => {
    expect(() => calculate({ deposits: [0n, 0n], current: [unit, 0n], currentPrice: 0.01 })).toThrow('no deposit cashflow')
  })

  it('values each deposit at its own historical pair price', async () => {
    const cashflows = [
      { ...flow('deposit', unit, 100n * unit), blockNumber: 10n },
      { ...flow('deposit', unit, 100n * unit), blockNumber: 20n },
    ]
    const value = await calculateDepositedValueQuote({
      cashflows,
      valueAtBlock: async (raw0, raw1, block) => {
        const eth = Number(raw0 / unit)
        const gme = Number(raw1 / unit)
        return eth + gme * (block === 10n ? 0.01 : 0.02)
      },
    })
    expect(value).toBe(5)
  })
})

function calculate(input: {
  deposits: [bigint, bigint]
  current: [bigint, bigint]
  currentPrice: number
  withdrawals?: [bigint, bigint]
  claimedFees?: [bigint, bigint]
  unclaimed?: [bigint, bigint]
}) {
  const cashflows = [flow('deposit', ...input.deposits)]
  if (input.withdrawals) cashflows.push(flow('withdrawal', ...input.withdrawals))
  if (input.claimedFees) cashflows.push(flow('fee', ...input.claimedFees))
  return calculateImpermanentLoss({
    token0: ETH, token1: GME, quoteToken: ETH, currentPrice: input.currentPrice,
    current0Raw: input.current[0], current1Raw: input.current[1],
    unclaimed0Raw: input.unclaimed?.[0] ?? 0n, unclaimed1Raw: input.unclaimed?.[1] ?? 0n,
    cashflows,
  })
}

function flow(type: StoredPositionCashflow['type'], token0Raw: bigint, token1Raw: bigint): StoredPositionCashflow {
  return { type, token0Raw, token1Raw, blockNumber: 1n, logIndex: 0 }
}

function token(address: string, symbol: string) {
  return { address: getAddress(address), symbol, decimals: 18 }
}
