import { createPublicClient, defineChain, http } from 'viem'
import type { AppConfig } from './config.js'

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Robinhood Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
})

export function createChainClient(config: AppConfig) {
  return createPublicClient({
    batch: { multicall: true },
    chain: robinhoodChain,
    transport: http(config.robinhoodRpcUrl, { timeout: 20_000, retryCount: 2 }),
  })
}

export function explorerAddressUrl(address: string) {
  return `${robinhoodChain.blockExplorers.default.url}/address/${address}`
}

export function explorerTokenUrl(address: string, tokenId: bigint) {
  return `${robinhoodChain.blockExplorers.default.url}/token/${address}/instance/${tokenId.toString()}`
}
