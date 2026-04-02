export type Strategy = "dlmm" | "perps" | "spot";

export type MemoryEntryType = "pattern" | "warning" | "observation";

export interface MemoryEntry {
  id: string;
  type: MemoryEntryType;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface TradeDecision {
  strategy: Strategy;
  token: string;
  action: "buy" | "sell" | "add_liquidity" | "remove_liquidity" | "long" | "short";
  sizeUSD: number;
  confidence: number;
  reasoning: string;
  params?: Record<string, unknown>;
}

export interface TradeOutcome {
  cycleId: string;
  pnlUSD: number;
  slippageBps: number;
  latencyMs: number;
  simulated: boolean;
  txSignature?: string;
}

export interface AttestationQuote {
  id: string;
  rawQuote: Buffer;
  decisionHash: string;
  cycleId: string;
  timestamp: number;
  isHardwareBacked: boolean;
}

export interface PortfolioState {
  totalValueUSD: number;
  positions: Position[];
  unrealizedPnlUSD: number;
  drawdownFromPeak: number;
}

export interface Position {
  strategy: Strategy;
  token: string;
  sizeUSD: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnlUSD: number;
  openedAt: Date;
}

export interface RiskResult {
  approved: boolean;
  reason?: string;
  adjustedSizeUSD?: number;
}

export interface AgentCycle {
  id: string;
  startedAt: Date;
  completedAt?: Date;
  decision: TradeDecision | null;
  riskResult: RiskResult;
  outcome?: TradeOutcome;
  attestationId?: string;
}
