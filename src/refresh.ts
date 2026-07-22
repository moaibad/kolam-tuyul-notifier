import type { PublicClient } from 'viem'
import type { AppConfig } from './config.js'
import type { DeploymentAddresses } from './contracts.js'
import type { StateDatabase } from './state/database.js'
import type { RefreshResult, TransitionAlert } from './types.js'
import { calculatePortfolioTotals } from './uniswap/accounting.js'
import { discoverOpenPositions } from './uniswap/discovery.js'
import { buildPositionSnapshot } from './uniswap/positions.js'

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
    const discovered = await discoverOpenPositions({ client: this.client, walletAddress: this.config.walletAddress, deployments: this.deployments })
    const positions = []
    const alerts: TransitionAlert[] = []

    for (const position of discovered.positions) {
      const snapshot = await buildPositionSnapshot({ client: this.client, db: this.db, position, deployments: this.deployments, walletAddress: this.config.walletAddress, usdgAddress: this.config.usdgAddress, blockNumber, nowMs })
      if (!snapshot) continue
      const previous = this.db.getPositionStatus(snapshot.id)
      if (previous.lastStatus === 'in_range' && snapshot.status === 'out_of_range') {
        alerts.push({ position: snapshot, from: 'in_range', to: 'out_of_range', detectedAtMs: nowMs })
      }
      this.db.setPositionStatus(snapshot.id, snapshot.status, snapshot.outOfRangeSinceMs)
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
        warnings: discovered.warnings,
      },
    }
  }
}
