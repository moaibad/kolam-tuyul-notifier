import 'dotenv/config'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { getAddress } from 'viem'
import { z } from 'zod'

export const ROBINHOOD_USDG_ADDRESS = getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168')

const addressSchema = z
  .string()
  .trim()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => getAddress(value))

const optionalAddressSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? getAddress(value) : undefined))

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  DISCORD_CHANNEL_ID: z.string().min(1),
  WALLET_ADDRESS: addressSchema,
  ROBINHOOD_RPC_URL: z.string().url().default('https://rpc.mainnet.chain.robinhood.com'),
  USDG_ADDRESS: optionalAddressSchema,
  UNISWAP_V3_POSITION_MANAGER_ADDRESS: optionalAddressSchema,
  UNISWAP_V4_POSITION_MANAGER_ADDRESS: optionalAddressSchema,
  UNISWAP_V4_POOL_MANAGER_ADDRESS: optionalAddressSchema,
  UNISWAP_V4_STATE_VIEW_ADDRESS: optionalAddressSchema,
  REPORT_INTERVAL_MINUTES: z.coerce.number().int().positive().default(5),
  MANUAL_REFRESH_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(30),
  OUT_OF_RANGE_EMPHASIS_AFTER_MINUTES: z.coerce.number().int().positive().default(15),
  STATE_DATABASE_PATH: z.string().min(1).default('./data/notifier.sqlite'),
  LOG_LEVEL: z.string().default('info'),
})

export type AppConfig = ReturnType<typeof loadConfig>

export function loadConfig() {
  const parsed = envSchema.parse(process.env)
  const stateDatabasePath = resolve(process.cwd(), parsed.STATE_DATABASE_PATH)
  const stateDir = dirname(stateDatabasePath)
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true })

  return {
    discord: {
      token: parsed.DISCORD_BOT_TOKEN,
      guildId: parsed.DISCORD_GUILD_ID,
      channelId: parsed.DISCORD_CHANNEL_ID,
    },
    walletAddress: parsed.WALLET_ADDRESS,
    robinhoodRpcUrl: parsed.ROBINHOOD_RPC_URL,
    usdgAddress: parsed.USDG_ADDRESS ?? ROBINHOOD_USDG_ADDRESS,
    contracts: {
      v3PositionManager: parsed.UNISWAP_V3_POSITION_MANAGER_ADDRESS,
      v4PositionManager: parsed.UNISWAP_V4_POSITION_MANAGER_ADDRESS,
      v4PoolManager: parsed.UNISWAP_V4_POOL_MANAGER_ADDRESS,
      v4StateView: parsed.UNISWAP_V4_STATE_VIEW_ADDRESS,
    },
    reportIntervalMs: parsed.REPORT_INTERVAL_MINUTES * 60_000,
    manualRefreshCooldownMs: parsed.MANUAL_REFRESH_COOLDOWN_SECONDS * 1_000,
    outOfRangeEmphasisAfterMs: parsed.OUT_OF_RANGE_EMPHASIS_AFTER_MINUTES * 60_000,
    stateDatabasePath,
    logLevel: parsed.LOG_LEVEL,
  }
}
