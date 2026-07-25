import type { PublicClient } from 'viem'
import type { AppConfig } from './config.js'
import type { DeploymentAddresses } from './contracts.js'
import type { StateDatabase } from './state/database.js'
import type { RefreshResult, TransitionAlert } from './types.js'
import { calculatePortfolioTotals } from './uniswap/accounting.js'
import { discoverOpenPositions } from './uniswap/discovery.js'
import { buildPositionSnapshot, createPriceOracle, loadPositionData } from './uniswap/positions.js'
import { syncPositionAccounting } from './uniswap/accounting-sync.js'
import { discoverReferencePriceSources } from './uniswap/reference-pools.js'
import type { PoolPriceSource } from './uniswap/price-oracle.js'

export class RefreshService {
  private running?: Promise<RefreshResult>

  constructor(
    private readonly config: AppConfig,
    private readonly client: PublicClient,
    private readonly db: StateDatabase,
    private readonly deployments: DeploymentAddresses,
  ) {}

  refresh() {
    if (!this.running) {
      this.running = this.runRefresh().finally(() => {
        this.running = undefined
      })
    }
    return this.running
  }

  private async runRefresh(): Promise<RefreshResult> {
    const nowMs = Date.now()
    const blockNumber = await this.client.getBlockNumber()
    const discovered = await discoverOpenPositions({ client: this.client, walletAddress: this.config.walletAddress, deployments: this.deployments, db: this.db })
    const positions = []
    const alerts: TransitionAlert[] = []
    const warnings = [...discovered.warnings]
    const positionData = []

    for (const position of discovered.positions) {
      try {
        positionData.push(await loadPositionData({ client: this.client, db: this.db, position, deployments: this.deployments }))
      } catch (error) {
        warnings.push(`Position ${position.version} #${position.tokenId.toString()} could not be read: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    let referenceSources: PoolPriceSource[] = []
    try {
      referenceSources = await discoverReferencePriceSources({
        client: this.client,
        db: this.db,
        deployments: this.deployments,
        positions: positionData,
        usdgAddress: this.config.usdgAddress,
        wethAddress: this.config.wethAddress,
        intermediateTokens: this.config.priceRouteIntermediateTokens,
        blockNumber,
        cacheMs: this.config.pricePoolCacheMs,
        nowMs,
      })
    } catch (error) {
      warnings.push(`Reference price pool discovery failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    const oracle = createPriceOracle(positionData, this.config.usdgAddress, referenceSources, this.config.wethAddress)
    for (const data of positionData.filter((position) => position.liquidity > 0n)) {
      await syncPositionAccounting({ client: this.client, db: this.db, data, oracle, deployments: this.deployments, blockNumber })
      const snapshot = await buildPositionSnapshot({ client: this.client, db: this.db, data, oracle, walletAddress: this.config.walletAddress, blockNumber, nowMs })
      if (!snapshot) continue
      const previous = await this.db.getPositionStatus(snapshot.id)
      if (previous.lastStatus === 'in_range' && snapshot.status === 'out_of_range') {
        alerts.push({ position: snapshot, from: 'in_range', to: 'out_of_range', detectedAtMs: nowMs })
      }
      await this.db.setPositionStatus(snapshot.id, snapshot.status, snapshot.outOfRangeSinceMs)
      if (snapshot.quoteTokenPriceUsdg == null || snapshot.amounts.some((amount) => amount.valueUsdg == null)) {
        warnings.push(`Position ${snapshot.version} #${snapshot.tokenId.toString()} has no current USDG price route and is excluded from complete totals.`)
      }
      if (snapshot.accountingStatus === 'partial' || snapshot.accountingStatus === 'unavailable') {
        warnings.push(`Position ${snapshot.version} #${snapshot.tokenId.toString()} accounting is ${snapshot.accountingStatus}: ${snapshot.accountingError ?? 'unknown reason'}`)
      }
      positions.push(snapshot)
    }

    return {
      alerts,
      portfolio: {
        chainName: 'Robinhood Chain',
        blockNumber,
        updatedAtMs: nowMs,
        positions,
        totals: calculatePortfolioTotals(positions),
        warnings,
      },
    }
  }
}
