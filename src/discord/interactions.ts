import type { Client, TextChannel } from 'discord.js'
import type { AppConfig } from '../config.js'
import type { RefreshService } from '../refresh.js'
import { publishReport } from './publisher.js'
import { refreshButtonCustomId } from './embeds.js'

export function registerInteractions(input: { client: Client; channel: TextChannel; refreshService: RefreshService; config: AppConfig }) {
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
      await publishReport(input.channel, result, input.config)
      await interaction.followUp({ content: 'Refresh complete. A new report was posted.', ephemeral: true })
    } catch (error) {
      await interaction.followUp({ content: `Refresh failed: ${error instanceof Error ? error.message : String(error)}`, ephemeral: true })
    }
  })
}
