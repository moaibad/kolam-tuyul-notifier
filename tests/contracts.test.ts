import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { resolveDeployments } from '../src/contracts.js'
import type { AppConfig } from '../src/config.js'

describe('contract deployment resolution', () => {
  it('uses bundled Robinhood v3 and v4 defaults when env overrides are blank', () => {
    const deployments = resolveDeployments(baseConfig())

    expect(deployments.v3Factory).toBe(getAddress('0x1f7d7550b1b028f7571e69a784071f0205fd2efa'))
    expect(deployments.v3PositionManager).toBe(getAddress('0x73991a25c818bf1f1128deaab1492d45638de0d3'))
    expect(deployments.warnMissingV3).toBe(false)
    expect(deployments.v4PositionManager).toBe(getAddress('0x58daec3116aae6D93017bAAea7749052E8a04fA7'))
    expect(deployments.v4PoolManager).toBe(getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951'))
    expect(deployments.v4StateView).toBe(getAddress('0xF3334192D15450CdD385c8B70e03f9A6bD9E673b'))
  })

  it('keeps explicit env overrides', () => {
    const override = getAddress('0x0000000000000000000000000000000000000001')
    const deployments = resolveDeployments(baseConfig({ contracts: { v3PositionManager: override, v4PositionManager: override, v4PoolManager: override, v4StateView: override } }))

    expect(deployments.v3PositionManager).toBe(override)
    expect(deployments.warnMissingV3).toBe(false)
    expect(deployments.v4PositionManager).toBe(override)
    expect(deployments.v4PoolManager).toBe(override)
    expect(deployments.v4StateView).toBe(override)
  })
})

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    discord: { token: 'token', guildId: 'guild', channelId: 'channel' },
    walletAddress: getAddress('0x0000000000000000000000000000000000000002'),
    robinhoodRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    usdgAddress: getAddress('0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'),
    contracts: { v3PositionManager: undefined, v4PositionManager: undefined, v4PoolManager: undefined, v4StateView: undefined },
    reportIntervalMs: 300_000,
    manualRefreshCooldownMs: 30_000,
    outOfRangeEmphasisAfterMs: 900_000,
    stateDatabasePath: './data/notifier.sqlite',
    logLevel: 'info',
    ...overrides,
  }
}
