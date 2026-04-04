import { createLogger } from "../core/logger.js";
import type { TradeDecision, RiskResult, PortfolioState, Position } from "../core/types.js";

const log = createLogger("risk");

export interface RiskConfig {
  globalDrawdownLimit: number;
  strategyDrawdownLimit: number;
  maxPositionsPerStrategy: number;
  confidenceThreshold: number;
  humanApprovalThresholdUSD: number;
  // Maximum acceptable slippage in basis points (1 bps = 0.01%).
  // Trades exceeding this are rejected before simulation — saves ~40ms RPC latency.
  maxSlippageBps: number;
}

export class RiskEngine {
  private readonly config: RiskConfig;
  private portfolio: PortfolioState;
  private peakValueUSD: number;

  constructor(config: RiskConfig) {
    this.config = config;
    this.portfolio = {
      totalValueUSD: 0,
      positions: [],
      unrealizedPnlUSD: 0,
      drawdownFromPeak: 0,
    };
    this.peakValueUSD = 0;
  }

  async evaluate(decision: TradeDecision): Promise<RiskResult> {
    // Policy checks run BEFORE transaction simulation.
    // Rejecting here avoids a round-trip to the RPC node (~40ms saved per rejection).

    // 1. Slippage gate — reject before anything else
    if ((decision.slippageBps ?? 0) > this.config.maxSlippageBps) {
      return {
        approved: false,
        reason: `Slippage ${decision.slippageBps}bps exceeds max ${this.config.maxSlippageBps}bps`,
      };
    }

    // 2. Confidence gate
    if (decision.confidence < this.config.confidenceThreshold) {
      return {
        approved: false,
        reason: `Confidence ${decision.confidence.toFixed(2)} below threshold ${this.config.confidenceThreshold}`,
      };
    }

    // 2. Global drawdown check
    if (Math.abs(this.portfolio.drawdownFromPeak) > this.config.globalDrawdownLimit) {
      return {
        approved: false,
        reason: `Global drawdown ${(this.portfolio.drawdownFromPeak * 100).toFixed(1)}% exceeds limit ${(this.config.globalDrawdownLimit * 100)}%`,
      };
    }

    // 3. Position count check
    const strategyPositions = this.portfolio.positions.filter(
      (p) => p.strategy === decision.strategy
    );
    if (strategyPositions.length >= this.config.maxPositionsPerStrategy) {
      return {
        approved: false,
        reason: `Max positions (${this.config.maxPositionsPerStrategy}) reached for strategy ${decision.strategy}`,
      };
    }

    // 4. Size cap
    if (decision.sizeUSD > this.config.humanApprovalThresholdUSD) {
      return {
        approved: false,
        reason: `Trade size $${decision.sizeUSD} exceeds human approval threshold $${this.config.humanApprovalThresholdUSD}`,
      };
    }

    log.info("Trade approved by risk engine", {
      strategy: decision.strategy,
      sizeUSD: decision.sizeUSD,
      confidence: decision.confidence,
    });

    return { approved: true };
  }

  updatePortfolio(positions: Position[]): void {
    const totalValue = positions.reduce((sum, p) => sum + p.sizeUSD + p.unrealizedPnlUSD, 0);

    if (totalValue > this.peakValueUSD) {
      this.peakValueUSD = totalValue;
    }

    const drawdown = this.peakValueUSD > 0
      ? (totalValue - this.peakValueUSD) / this.peakValueUSD
      : 0;

    this.portfolio = {
      totalValueUSD: totalValue,
      positions,
      unrealizedPnlUSD: positions.reduce((sum, p) => sum + p.unrealizedPnlUSD, 0),
      drawdownFromPeak: drawdown,
    };
  }

  getPortfolioState(): PortfolioState {
    return { ...this.portfolio };
  }
}

