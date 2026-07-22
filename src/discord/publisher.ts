import type { TextChannel } from 'discord.js'
import type { AppConfig } from '../config.js'
import type { RefreshResult } from '../types.js'
import { buildPortfolioButtons, buildPortfolioEmbed, buildPositionButtons, buildPositionEmbed, buildTransitionAlertEmbed } from './embeds.js'

export async function publishReport(channel: TextChannel, result: RefreshResult, config: AppConfig) {
  for (const alert of result.alerts) {
    await channel.send({ embeds: [buildTransitionAlertEmbed(alert)], components: [buildPositionButtons(alert.position)], allowedMentions: { parse: [] } })
  }

  await channel.send({ embeds: [buildPortfolioEmbed(result.portfolio)], components: [buildPortfolioButtons()], allowedMentions: { parse: [] } })

  for (const position of result.portfolio.positions) {
    await channel.send({ embeds: [buildPositionEmbed(position, config.outOfRangeEmphasisAfterMs, result.portfolio.updatedAtMs)], components: [buildPositionButtons(position)], allowedMentions: { parse: [] } })
  }
}
