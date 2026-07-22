import { ChannelType, Client, GatewayIntentBits, type TextChannel } from 'discord.js'
import type { AppConfig } from '../config.js'

export async function createDiscordClient(config: AppConfig) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] })
  await client.login(config.discord.token)
  await onceReady(client)
  const channel = await client.channels.fetch(config.discord.channelId)
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error(`Discord channel ${config.discord.channelId} is not a guild text channel`)
  return { client, channel: channel as TextChannel }
}

function onceReady(client: Client) {
  if (client.isReady()) return Promise.resolve()
  return new Promise<void>((resolve) => client.once('ready', () => resolve()))
}
