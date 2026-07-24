import { randomUUID } from 'node:crypto'
import type { Message, TextChannel } from 'discord.js'
import type pino from 'pino'
import type { AppConfig } from '../config.js'
import type { StateDatabase, StoredDiscordReportMessage } from '../state/database.js'
import type { RefreshResult } from '../types.js'
import { buildPortfolioButtons, buildPortfolioEmbed, buildPositionButtons, buildPositionEmbed, buildTransitionAlertEmbed } from './embeds.js'

const legacyScanLimit = 1_000
const discordPageSize = 100
const unknownMessageCode = 10_008

type PublisherLogger = Pick<pino.Logger, 'warn'>

export class ReportPublisher {
  private queue: Promise<void> = Promise.resolve()
  private legacyScanAttempted = false

  constructor(
    private readonly channel: TextChannel,
    private readonly config: Pick<AppConfig, 'outOfRangeEmphasisAfterMs'>,
    private readonly db: StateDatabase,
    private readonly logger: PublisherLogger,
  ) {}

  publish(result: RefreshResult) {
    const pending = this.queue.then(() => this.publishOnce(result))
    this.queue = pending.catch(() => undefined)
    return pending
  }

  private async publishOnce(result: RefreshResult) {
    await this.registerLegacyReports()
    await this.cleanupStaleReports()

    for (const alert of result.alerts) {
      await this.channel.send({ embeds: [buildTransitionAlertEmbed(alert)], components: [buildPositionButtons(alert.position)], allowedMentions: { parse: [] } })
    }

    const generation = randomUUID()
    const createdAtMs = Date.now()
    const sentMessages: Message[] = []
    const storedMessages: StoredDiscordReportMessage[] = []

    try {
      const portfolioMessage = await this.channel.send({
        embeds: [buildPortfolioEmbed(result.portfolio)],
        components: [buildPortfolioButtons()],
        allowedMentions: { parse: [] },
      })
      sentMessages.push(portfolioMessage)
      storedMessages.push({
        messageId: portfolioMessage.id,
        messageKey: 'portfolio',
        kind: 'portfolio',
        generation,
        status: 'current',
        createdAtMs,
      })

      for (const position of result.portfolio.positions) {
        const positionMessage = await this.channel.send({
          embeds: [buildPositionEmbed(position, this.config.outOfRangeEmphasisAfterMs, result.portfolio.updatedAtMs)],
          components: [buildPositionButtons(position)],
          allowedMentions: { parse: [] },
        })
        sentMessages.push(positionMessage)
        storedMessages.push({
          messageId: positionMessage.id,
          messageKey: `position:${position.id}`,
          kind: 'position',
          positionId: position.id,
          generation,
          status: 'current',
          createdAtMs,
        })
      }

      await this.db.activateDiscordReportGeneration(storedMessages)
    } catch (error) {
      await this.rollbackMessages(sentMessages)
      throw error
    }

    await this.cleanupStaleReports()
  }

  private async registerLegacyReports() {
    if (this.legacyScanAttempted || (await this.db.listDiscordReportMessages()).length > 0) return
    this.legacyScanAttempted = true

    try {
      const reports: LegacyReport[] = []
      let before: string | undefined
      let scanned = 0

      while (scanned < legacyScanLimit) {
        const limit = Math.min(discordPageSize, legacyScanLimit - scanned)
        const page = await this.channel.messages.fetch({ limit, ...(before ? { before } : {}) })
        const messages = [...page.values()]
        if (messages.length === 0) break
        scanned += messages.length

        for (const message of messages) {
          const report = classifyLegacyReport(message, this.channel.client.user?.id)
          if (report) reports.push(report)
        }

        if (messages.length < limit) break
        before = messages[messages.length - 1]?.id
        if (!before) break
      }

      reports.sort((left, right) => right.createdAtMs - left.createdAtMs)
      const currentKeys = new Set<string>()
      await this.db.seedDiscordReportMessages(reports.map((report) => {
        const status = currentKeys.has(report.messageKey) ? 'stale' : 'current'
        currentKeys.add(report.messageKey)
        return { ...report, generation: 'legacy', status }
      }))
    } catch (error) {
      this.logger.warn({ error }, 'could not scan Discord message history for legacy reports')
    }
  }

  private async cleanupStaleReports() {
    for (const message of await this.db.listDiscordReportMessages('stale')) {
      try {
        await this.channel.messages.delete(message.messageId)
        await this.db.deleteDiscordReportMessage(message.messageId)
      } catch (error) {
        if (isUnknownMessage(error)) {
          await this.db.deleteDiscordReportMessage(message.messageId)
          continue
        }
        this.logger.warn({ error, messageId: message.messageId }, 'could not delete stale Discord report message; cleanup will retry')
      }
    }
  }

  private async rollbackMessages(messages: Message[]) {
    for (const message of [...messages].reverse()) {
      try {
        await message.delete()
      } catch (error) {
        if (!isUnknownMessage(error)) this.logger.warn({ error, messageId: message.id }, 'could not roll back partially published Discord report')
      }
    }
  }
}

type LegacyReport = Omit<StoredDiscordReportMessage, 'generation' | 'status'>

function classifyLegacyReport(message: Message, botUserId?: string): LegacyReport | undefined {
  if (!botUserId || message.author.id !== botUserId) return undefined
  const embed = message.embeds[0]
  if (!embed?.title) return undefined

  if (embed.title === 'POSITION LEFT RANGE' || embed.title === '🔴 Position Left Range') return undefined
  if (embed.title === 'UNISWAP LP PORTFOLIO' || embed.title === '📊 Uniswap LP Portfolio') {
    return {
      messageId: message.id,
      messageKey: 'portfolio',
      kind: 'portfolio',
      createdAtMs: message.createdTimestamp,
    }
  }

  const version = embed.description?.match(/Uniswap (v3|v4)/)?.[1]
  const fieldNames = new Set(embed.fields.map((field) => field.name))
  const isLegacyPositionReport = ['STATUS', 'PRICE RANGE', 'CURRENT ASSETS', 'PERFORMANCE', 'PROFIT / LOSS', 'POSITION DETAILS'].every((name) => fieldNames.has(name))
  const isCurrentPositionReport = ['Status', 'Current Price', 'Lower', 'Upper', 'Total Result', 'Profit / Loss'].every((name) => fieldNames.has(name))
  if (!isLegacyPositionReport && !isCurrentPositionReport) return undefined
  const searchableText = [embed.description ?? '', ...embed.fields.map((field) => field.value)].join('\n')
  const tokenId = searchableText.match(/#(\d+)/)?.[1]
  if (!version || !tokenId) return undefined

  const legacyPositionId = `${version}:${tokenId}`
  return {
    messageId: message.id,
    messageKey: `position:${legacyPositionId}`,
    kind: 'position',
    positionId: legacyPositionId,
    createdAtMs: message.createdTimestamp,
  }
}

function isUnknownMessage(error: unknown) {
  if (typeof error !== 'object' || error == null || !('code' in error)) return false
  return Number(error.code) === unknownMessageCode
}
