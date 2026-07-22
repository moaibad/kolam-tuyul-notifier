import type { Client } from 'discord.js'
import type { AppConfig } from '../config.js'
import type { RefreshService } from '../refresh.js'
import type { ReportPublisher } from './publisher.js'
import { refreshButtonCustomId } from './embeds.js'

export function registerInteractions(input: { client: Client; publisher: ReportPublisher; refreshService: RefreshService; config: AppConfig }) {
  let lastRefreshAt = 0
  input.client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || interaction.customId !== refreshButtonCustomId) return
    if (interaction.channelId !== input.config.discord.channelId) {
      await interaction.reply({ content: 'Refresh is only available in the configured notifier channel.', ephemeral: true })
      return
    }
    const now = Date.now()
    const waitMs = input.config.manualRefreshCooldownMs - (now - lastRefreshAt)
    if (waitMs > 0) {
      await interaction.reply({ content: `Refresh is cooling down. Try again in ${Math.ceil(waitMs / 1_000)} seconds.`, ephemeral: true })
      return
    }
    lastRefreshAt = now
    await interaction.reply({ content: 'Refreshing Uniswap positions now...', ephemeral: true })
    try {
      const result = await input.refreshService.refresh()
      await input.publisher.publish(result)
      await interaction.followUp({ content: 'Report refreshed.', ephemeral: true })
    } catch (error) {
      await interaction.followUp({ content: `Refresh failed: ${error instanceof Error ? error.message : String(error)}`, ephemeral: true })
    }
  })
}
