import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { resolveDeployments } from '../src/contracts.js'

describe('contract deployment resolution', () => {
  it('uses bundled Robinhood v3 and v4 deployments', () => {
    const deployments = resolveDeployments()

    expect(deployments.v3Factory).toBe(getAddress('0x1f7d7550b1b028f7571e69a784071f0205fd2efa'))
    expect(deployments.v3PositionManager).toBe(getAddress('0x73991a25c818bf1f1128deaab1492d45638de0d3'))
    expect(deployments.warnMissingV3).toBe(false)
    expect(deployments.v4PositionManager).toBe(getAddress('0x58daec3116aae6D93017bAAea7749052E8a04fA7'))
    expect(deployments.v4PoolManager).toBe(getAddress('0x8366a39CC670B4001A1121B8F6A443A643e40951'))
    expect(deployments.v4StateView).toBe(getAddress('0xF3334192D15450CdD385c8B70e03f9A6bD9E673b'))
  })
})
