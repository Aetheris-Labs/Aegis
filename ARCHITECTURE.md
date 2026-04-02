# Architecture — enclave-trade

## Overview

enclave-trade is structured around a single invariant: **the signing key never exists outside the TEE boundary**.

All other components — reasoning, risk, memory, execution — are designed to support and enforce this invariant.

## Component Map

```
┌──────────────────────────────────────────────────────────────────┐
│                       TEE Boundary                               │
│                                                                  │
│  src/enclave/tee.ts          TEE runtime detection + lifecycle   │
│  src/enclave/signer.ts       Ed25519 key custody + signing       │
│  src/enclave/attestation.ts  Remote quote generation (DCAP)      │
│  src/enclave/sealed-storage  AES-256-GCM enclave-bound storage   │
│                                                                  │
│  src/main.ts                 Bootstrap + agent loop              │
│  src/agent/memory.ts         Chroma vector memory + TTL pruning  │
│  src/agent/hooks.ts          Pre/post execution lifecycle hooks  │
│  src/mcp/server.ts           MCP server exposing trading tools   │
│  src/mcp/tools/              One file per trading domain         │
│  src/risk/engine.ts          Risk validation engine              │
│  src/risk/circuit-breaker.ts Loss-streak halt conditions         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  src/execution/               External Services
  strategies/dlmm.ts           Helius RPC
  strategies/perps.ts          Jupiter v6
  strategies/spot.ts           Meteora DLMM
                               Drift Protocol
```

## Agent Loop

```
ATTEST → OBSERVE → REASON → VALIDATE → SIGN → EXECUTE → LEARN
  │           │        │          │        │        │       │
  TDX      MCP tools  Claude    Risk     Enclave  Solana  Chroma
  Quote    fetch data  SDK loop  Engine   Signer   RPC     Memory
```

Each cycle:
1. **Attest** — generate TDX quote binding the decision context
2. **Observe** — pull market data via MCP tools (prices, pool state, orderbook)
3. **Reason** — Claude Agent SDK multi-turn loop with tool use
4. **Validate** — risk engine checks drawdown, position sizing, confidence gate
5. **Sign** — in-enclave Ed25519 signing; key never leaves TEE boundary
6. **Execute** — submit transaction to Solana via Jito bundle
7. **Learn** — write outcome (P&L, slippage, latency) to Chroma vector memory

## Memory Architecture

Memory uses TTL-based pruning with similarity merging:

- **Patterns** (wins): 90-day TTL, merged at 70% cosine similarity
- **Warnings** (losses/rejections): 60-day TTL
- **Observations** (no-trade cycles): 30-day TTL

Ineffective patterns (< 30% success rate over 10+ instances) are pruned automatically.

## TEE Modes

| Mode | Use Case | Attestation |
|------|----------|-------------|
| `software` | Local dev, CI | Self-signed quote (not production) |
| `tdx` | Intel TDX VMs | DCAP via PCCS |
| `sev` | AMD SEV-SNP | AMD attestation report |

## Risk Constraints (defaults)

| Constraint | Value |
|------------|-------|
| Global drawdown limit | -15% halts all new positions |
| Per-strategy drawdown | -20% halts strategy |
| Confidence gate | < 0.65 → skip cycle |
| Max positions | 3 per strategy |
| Human approval | Required > $500 |
| Circuit breaker | 3 losses in 1h → 4h cooldown |
