import pino from 'pino'
import { loadConfig } from './config.js'
import { createChainClient } from './chain.js'
import { resolveDeployments, validateContractCode } from './contracts.js'
import { createDiscordClient } from './discord/client.js'
import { registerInteractions } from './discord/interactions.js'
import { ReportPublisher } from './discord/publisher.js'
import { RefreshService } from './refresh.js'
import { startScheduler } from './scheduler.js'
import { StateDatabase } from './state/database.js'

const config = loadConfig()
const logger = pino({ level: config.logLevel })
const db = new StateDatabase(config.stateDatabasePath)
const client = createChainClient(config)
const deployments = resolveDeployments()

try {
  await validateContractCode(client, deployments)
  const discord = await createDiscordClient(config)
  const refreshService = new RefreshService(config, client, db, deployments)
  const publisher = new ReportPublisher(discord.channel, config, db, logger)
  registerInteractions({ client: discord.client, publisher, refreshService, config })
  const stopScheduler = await startScheduler({ refreshService, publisher, config, logger })

  const shutdown = async () => {
    logger.info('shutting down')
    stopScheduler()
    db.close()
    discord.client.destroy()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  logger.info('kolam tuyul notifier started')
} catch (error) {
  logger.error({ error }, 'failed to start notifier')
  db.close()
  process.exit(1)
}
