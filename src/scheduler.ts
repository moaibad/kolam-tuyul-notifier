import type pino from 'pino'
import type { AppConfig } from './config.js'
import type { ReportPublisher } from './discord/publisher.js'
import type { RefreshService } from './refresh.js'

export async function startScheduler(input: { refreshService: RefreshService; publisher: ReportPublisher; config: AppConfig; logger: pino.Logger }) {
  const run = async () => {
    try {
      const result = await input.refreshService.refresh()
      await input.publisher.publish(result)
    } catch (error) {
      input.logger.error({ error }, 'scheduled refresh failed')
    }
  }
  await run()
  const timer = setInterval(run, input.config.reportIntervalMs)
  return () => clearInterval(timer)
}
