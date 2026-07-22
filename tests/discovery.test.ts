import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAddress, type PublicClient } from 'viem'
import { discoverOpenPositions } from '../src/uniswap/discovery.js'

const wallet = getAddress('0x0000000000000000000000000000000000000001')
const manager = getAddress('0x58daec3116aae6d93017baaea7749052e8a04fa7')

afterEach(() => vi.unstubAllGlobals())

describe('position discovery', () => {
  it('uses the current Blockscout NFT endpoint and follows pagination', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(item('267843'), { token_contract_address_hash: manager, token_id: '267843', token_type: 'ERC-721' }))
      .mockResolvedValueOnce(response(item('267775'), null))
    vi.stubGlobal('fetch', fetchMock)
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === 'ownerOf') return wallet
        if (functionName === 'getPositionLiquidity') return 1n
        return [{}, 0n]
      }),
    } as unknown as PublicClient

    const result = await discoverOpenPositions({
      client,
      walletAddress: wallet,
      deployments: { v4PositionManager: manager, warnMissingV3: false },
    })

    expect(result.positions.map((position) => position.tokenId)).toEqual([267843n, 267775n])
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/addresses/${wallet}/nft?type=ERC-721`)
    expect(fetchMock.mock.calls[1]?.[0]).toContain('token_contract_address_hash=')
  })

  it('does not accept an unrelated ERC-721 collection as a position manager', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...item('1'), token: { address_hash: getAddress('0x0000000000000000000000000000000000000009') } }, null)))
    const client = { getBlockNumber: vi.fn(async () => 100n), getContractEvents: vi.fn(async () => []) } as unknown as PublicClient
    const result = await discoverOpenPositions({ client, walletAddress: wallet, deployments: { v4PositionManager: manager, warnMissingV3: false } })
    expect(result.positions).toEqual([])
  })
})

function item(id: string) {
  return { id, token: { address_hash: manager, type: 'ERC-721', symbol: 'UNI-V4-POSM' } }
}

function response(value: object, nextPageParams: Record<string, string> | null) {
  return { ok: true, json: async () => ({ items: [value], next_page_params: nextPageParams }) } as Response
}
