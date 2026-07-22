import type { TextChannel } from 'discord.js'
import type pino from 'pino'
import type { AppConfig } from './config.js'
import type { RefreshService } from './refresh.js'
import { publishReport } from './discord/publisher.js'

export async function startScheduler(input: { refreshService: RefreshService; channel: TextChannel; config: AppConfig; logger: pino.Logger }) {
  const run = async () => {
    try {
      const result = await input.refreshService.refresh()
      await publishReport(input.channel, result, input.config)
    } catch (error) {
      input.logger.error({ error }, 'scheduled refresh failed')
    }
  }
  await run()
  const timer = setInterval(run, input.config.reportIntervalMs)
  return () => clearInterval(timer)
}
