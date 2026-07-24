import { Collection, type Message, type TextChannel } from 'discord.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { zeroAddress } from 'viem'
import { ReportPublisher } from '../src/discord/publisher.js'
import { StateDatabase, type StoredDiscordReportMessage } from '../src/state/database.js'
import type { PositionSnapshot, RefreshResult, TransitionAlert } from '../src/types.js'

const databases: StateDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('ReportPublisher', () => {
  it('publishes a complete generation before deleting the previous report', async () => {
    const db = await createDatabase([storedMessage('old-portfolio', 'portfolio'), storedMessage('old-position', 'position:v4:manager:1', 'position')])
    const mock = createChannelMock()
    const publisher = createPublisher(mock.channel, db)

    await publisher.publish(refreshResult())

    expect(mock.sent.map((message) => message.id)).toEqual(['sent-1', 'sent-2', 'sent-3'])
    expect(mock.deletedIds).toEqual(['old-portfolio', 'old-position'])
    expect(await db.listDiscordReportMessages('stale')).toEqual([])
    expect((await db.listDiscordReportMessages('current')).map((message) => message.messageId)).toEqual(['sent-1', 'sent-2', 'sent-3'])
  })

  it('rolls back a partial generation and keeps the previous report current', async () => {
    const db = await createDatabase([storedMessage('old-portfolio', 'portfolio')])
    const mock = createChannelMock({ failSendAt: 2 })
    const publisher = createPublisher(mock.channel, db)

    await expect(publisher.publish(refreshResult())).rejects.toThrow('send failed')

    expect(mock.sent).toHaveLength(1)
    expect(mock.sent[0]?.delete).toHaveBeenCalledOnce()
    expect(mock.deletedIds).toEqual([])
    expect((await db.listDiscordReportMessages('current')).map((message) => message.messageId)).toEqual(['old-portfolio'])
  })

  it('retains transient delete failures and retries them on the next refresh', async () => {
    const db = await createDatabase([storedMessage('old-portfolio', 'portfolio')])
    const mock = createChannelMock({ transientDeleteFailures: new Set(['old-portfolio']) })
    const publisher = createPublisher(mock.channel, db)

    await publisher.publish(refreshResult({ positions: [] }))
    expect((await db.listDiscordReportMessages('stale')).map((message) => message.messageId)).toEqual(['old-portfolio'])

    await createPublisher(mock.channel, db).publish(refreshResult({ positions: [] }))
    expect(mock.deletedIds.filter((id) => id === 'old-portfolio')).toHaveLength(2)
    expect(await db.listDiscordReportMessages('stale')).toEqual([])
  })

  it('treats an already deleted Discord message as successfully cleaned', async () => {
    const db = await createDatabase([storedMessage('missing', 'portfolio')])
    const mock = createChannelMock({ unknownMessageIds: new Set(['missing']) })

    await createPublisher(mock.channel, db).publish(refreshResult({ positions: [] }))

    expect((await db.listDiscordReportMessages()).some((message) => message.messageId === 'missing')).toBe(false)
  })

  it('discovers legacy reports, removes duplicates, and preserves alerts and unrelated messages', async () => {
    const db = await createDatabase()
    const history = new Collection<string, Message>()
    history.set('portfolio-newest', legacyMessage({ id: 'portfolio-newest', title: '📊 Uniswap LP Portfolio', createdTimestamp: 50 }))
    history.set('portfolio-duplicate', legacyMessage({ id: 'portfolio-duplicate', title: 'UNISWAP LP PORTFOLIO', createdTimestamp: 40 }))
    history.set('position-old', legacyMessage({
      id: 'position-old',
      title: 'PONS / USDG',
      description: 'Uniswap v4 · 0.70% fee',
      fields: [
        { name: 'STATUS', value: 'IN RANGE' },
        { name: 'PRICE RANGE', value: 'Current 0.03' },
        { name: 'CURRENT ASSETS', value: 'PONS 1' },
        { name: 'PERFORMANCE', value: 'LP value 1' },
        { name: 'PROFIT / LOSS', value: '0' },
        { name: 'POSITION DETAILS', value: 'Position ID #267843' },
      ],
      createdTimestamp: 30,
    }))
    history.set('alert', legacyMessage({ id: 'alert', title: '🔴 Position Left Range', description: 'Uniswap v4 · #267843', createdTimestamp: 20 }))
    history.set('other', legacyMessage({ id: 'other', title: 'Another Bot Report', createdTimestamp: 10 }))
    history.set('other-uniswap', legacyMessage({ id: 'other-uniswap', title: 'Trade Filled', description: 'Uniswap v4 · #267843', createdTimestamp: 8 }))
    history.set('foreign', legacyMessage({ id: 'foreign', title: '📊 Uniswap LP Portfolio', authorId: 'another-user', createdTimestamp: 5 }))
    const mock = createChannelMock({ historyPages: [history] })

    await createPublisher(mock.channel, db).publish(refreshResult({ positions: [] }))

    expect(mock.deletedIds).toEqual(expect.arrayContaining(['portfolio-newest', 'portfolio-duplicate', 'position-old']))
    expect(mock.deletedIds).not.toEqual(expect.arrayContaining(['alert', 'other', 'other-uniswap', 'foreign']))
    expect((await db.listDiscordReportMessages('current')).map((message) => message.messageId)).toEqual(['sent-1'])
  })

  it('limits legacy discovery to 1,000 messages', async () => {
    const db = await createDatabase()
    const pages = Array.from({ length: 10 }, (_, pageIndex) => {
      const page = new Collection<string, Message>()
      for (let index = 0; index < 100; index += 1) {
        const id = `history-${pageIndex}-${index}`
        page.set(id, legacyMessage({ id, title: 'Unrelated', createdTimestamp: 2_000 - pageIndex * 100 - index }))
      }
      return page
    })
    const mock = createChannelMock({ historyPages: pages })

    await createPublisher(mock.channel, db).publish(refreshResult({ positions: [] }))

    expect(mock.fetchHistory).toHaveBeenCalledTimes(10)
  })

  it('continues publishing when Discord history cannot be read', async () => {
    const db = await createDatabase()
    const mock = createChannelMock({ historyError: new Error('Missing Read Message History permission') })

    await expect(createPublisher(mock.channel, db).publish(refreshResult({ positions: [] }))).resolves.toBeUndefined()

    expect(mock.sent).toHaveLength(1)
    expect((await db.listDiscordReportMessages('current')).map((message) => message.messageId)).toEqual(['sent-1'])
  })

  it('keeps transition alerts as untracked messages', async () => {
    const db = await createDatabase()
    const position = basePosition()
    const alert: TransitionAlert = { position, from: 'in_range', to: 'out_of_range', detectedAtMs: 100 }
    const mock = createChannelMock()

    await createPublisher(mock.channel, db).publish(refreshResult({ positions: [position], alerts: [alert] }))

    expect(mock.sent).toHaveLength(3)
    expect((await db.listDiscordReportMessages('current')).map((message) => message.messageId)).toEqual(['sent-2', 'sent-3'])
  })

  it('serializes concurrent report replacements', async () => {
    const db = await createDatabase()
    const mock = createChannelMock()
    const publisher = createPublisher(mock.channel, db)

    await Promise.all([
      publisher.publish(refreshResult({ positions: [] })),
      publisher.publish(refreshResult({ positions: [basePosition()] })),
    ])

    expect(mock.sent.map((message) => message.id)).toEqual(['sent-1', 'sent-2', 'sent-3'])
    expect((await db.listDiscordReportMessages('current')).map((message) => message.messageId)).toEqual(['sent-2', 'sent-3'])
    expect(mock.deletedIds).toContain('sent-1')
  })
})

function createPublisher(channel: TextChannel, db: StateDatabase) {
  return new ReportPublisher(channel, { outOfRangeEmphasisAfterMs: 15 * 60_000 }, db, { warn: vi.fn() } as any)
}

async function createDatabase(messages: StoredDiscordReportMessage[] = []) {
  const db = new StateDatabase(':memory:')
  databases.push(db)
  await db.initialize()
  await db.seedDiscordReportMessages(messages)
  return db
}

function storedMessage(messageId: string, messageKey: string, kind: StoredDiscordReportMessage['kind'] = 'portfolio'): StoredDiscordReportMessage {
  return { messageId, messageKey, kind, generation: 'old', status: 'current', createdAtMs: 1 }
}

function createChannelMock(options: {
  failSendAt?: number
  transientDeleteFailures?: Set<string>
  unknownMessageIds?: Set<string>
  historyPages?: Array<Collection<string, Message>>
  historyError?: Error
} = {}) {
  const sent: Array<{ id: string; delete: ReturnType<typeof vi.fn>; payload: unknown }> = []
  const deletedIds: string[] = []
  const failureCounts = new Map<string, number>()
  const historyPages = [...(options.historyPages ?? [])]
  let sendAttempts = 0

  const fetchHistory = vi.fn(async () => {
    if (options.historyError) throw options.historyError
    return historyPages.shift() ?? new Collection<string, Message>()
  })
  const deleteMessage = vi.fn(async (messageId: string) => {
    deletedIds.push(messageId)
    if (options.unknownMessageIds?.has(messageId)) throw Object.assign(new Error('Unknown Message'), { code: 10_008 })
    if (options.transientDeleteFailures?.has(messageId) && (failureCounts.get(messageId) ?? 0) === 0) {
      failureCounts.set(messageId, 1)
      throw new Error('temporary Discord failure')
    }
  })
  const send = vi.fn(async (payload: unknown) => {
    sendAttempts += 1
    if (sendAttempts === options.failSendAt) throw new Error('send failed')
    const message = { id: `sent-${sent.length + 1}`, payload, delete: vi.fn(async () => undefined) }
    sent.push(message)
    return message as unknown as Message
  })
  const channel = {
    send,
    messages: { fetch: fetchHistory, delete: deleteMessage },
    client: { user: { id: 'bot-user' } },
  } as unknown as TextChannel

  return { channel, sent, deletedIds, fetchHistory }
}

function legacyMessage(input: {
  id: string
  title: string
  description?: string
  fields?: Array<{ name: string; value: string }>
  authorId?: string
  createdTimestamp: number
}) {
  return {
    id: input.id,
    author: { id: input.authorId ?? 'bot-user' },
    embeds: [{ title: input.title, description: input.description ?? null, fields: input.fields ?? [] }],
    createdTimestamp: input.createdTimestamp,
  } as unknown as Message
}

function refreshResult(overrides: { positions?: PositionSnapshot[]; alerts?: TransitionAlert[] } = {}): RefreshResult {
  const positions = overrides.positions ?? [basePosition({ tokenId: 1n, id: 'v4:manager:1' }), basePosition({ tokenId: 2n, id: 'v4:manager:2' })]
  return {
    alerts: overrides.alerts ?? [],
    portfolio: {
      chainName: 'Robinhood Chain',
      blockNumber: 100n,
      updatedAtMs: 1_000,
      positions,
      totals: {
        depositedUsdg: 30,
        currentLpValueUsdg: 31,
        claimedFeesUsdg: 0,
        unclaimedFeesUsdg: 1,
        totalResultUsdg: 32,
        profitLossUsdg: 2,
        profitLossPercent: 6.67,
        partial: false,
      },
      warnings: [],
    },
  }
}

function basePosition(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    id: 'v4:manager:1',
    tokenId: 1n,
    version: 'v4',
    manager: zeroAddress,
    token0: { address: zeroAddress, symbol: 'PONS', decimals: 18 },
    token1: { address: zeroAddress, symbol: 'USDG', decimals: 18 },
    quoteToken: { address: zeroAddress, symbol: 'USDG', decimals: 18 },
    feeTier: 7000,
    tickLower: 0,
    tickUpper: 10,
    currentTick: 5,
    currentPrice: 0.03,
    lowerPrice: 0.02,
    upperPrice: 0.04,
    liquidity: 1n,
    status: 'in_range',
    mintTimestampMs: 0,
    blockNumber: 100n,
    amounts: [],
    currentLpValueUsdg: 31,
    claimedFeesUsdg: 0,
    unclaimedFeesUsdg: 1,
    depositedUsdg: 30,
    withdrawnUsdg: 0,
    totalResultUsdg: 32,
    profitLossUsdg: 2,
    profitLossPercent: 6.67,
    accountingStatus: 'synced',
    uniswapUrl: 'https://app.uniswap.org',
    explorerUrl: 'https://example.com',
    ...overrides,
  }
}
