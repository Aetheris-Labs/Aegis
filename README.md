<div align="center">

# Aegis

**Autonomous Solana trading agent with in-enclave key custody and attested execution.**
Private keys are generated inside a TEE. They never leave. Every trade is provably honest.

[![Build](https://img.shields.io/github/actions/workflow/status/Aetheris-Labs/Aegis/ci.yml?branch=main&style=flat-square&label=Build)](https://github.com/Aetheris-Labs/Aegis/actions)
![License](https://img.shields.io/badge/license-MIT-blue)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-cc7800?style=flat-square)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square)](https://www.typescriptlang.org/)

</div>

---

Most agents store private keys in `.env` files. One leak and everything is gone.

`Aegis` runs its entire decision loop inside a **Trusted Execution Environment**.
The Ed25519 signing key is generated inside the enclave and sealed there permanently.
The host machine, the cloud provider, and the operator cannot read it.

```
OBSERVE → REASON → ATTEST → SIGN → EXECUTE → LEARN
```

Every trade emits a remote attestation quote. Every decision is logged to an immutable JSONL audit trail.
The agent that runs tomorrow is smarter than the one today. The key has never been seen by anyone.

---

## Live Execution

<img src="assets/preview-live.png" alt="Live execution dashboard" width="100%" />

Real-time view of Aegis running: strategy signals from Meteora DLMM, Drift perps, and Jupiter spot with live confidence scores and risk gate results, confirmed Solana transactions with truncated hashes, attestation status, and Claude's full reasoning for the current decision cycle.

## System Architecture

<img src="assets/preview-architecture.png" alt="Architecture diagram" width="100%" />

Three-layer execution stack: hardware attestation (Intel TDX RTMR registers + AMD SEV-SNP VCEK chain), trusted enclave boundary (secp256k1 key that never exits), and network layer (RA-TLS to Jupiter v6 + signed transactions to Solana validator via Jito block engine).

---

## Core Engine — TEE + MCP

### Trusted Execution Environment

| Layer | Component | Function |
|-------|-----------|----------|
| **Key Custody** | `src/enclave/signer.ts` | Ed25519 key gen inside TEE, sealed with AES-256-GCM |
| **Attestation** | `src/enclave/attestation.ts` | Remote quote per trade, verifiable externally |
| **TEE Runtime** | `src/enclave/tee.ts` | Intel TDX / AMD SEV-SNP / software mode |

### MCP Tool Surface

| Tool | Source | Purpose |
|------|--------|---------|
| `solana_get_price` | Helius + Birdeye | Real-time token price, OHLCV |
| `solana_get_pool_state` | Meteora DLMM | Bin range, TVL, fee rate |
| `solana_get_funding_rate` | Drift Protocol | Perp funding rate, OI |
| `jupiter_get_quote` | Jupiter v6 | Best swap route, price impact |
| `solana_get_wallet_positions` | Helius | Current positions, P&L |
| `enclave_execute_trade` | Internal | Final execution intent |

---

## Agent Decision Loop

```mermaid
flowchart TD
    A[Market Data Ingest\nHelius · Meteora · Drift] --> B[MCP Tool Layer]
    B --> C{Claude Agent SDK\nReasoning Loop}
    C --> D[Risk Engine\nDrawdown · Confidence Gate]
    D -->|rejected| E[Log Warning to Memory]
    D -->|approved| F[TEE Attestation Quote]
    F --> G[In-Enclave Ed25519 Signer]
    G --> H[Solana Transaction]
    H --> I[Outcome Capture]
    I --> J[Chroma Vector Memory\nTTL: 90d patterns / 60d warnings]
    J --> C
    E --> J
```

---

## Performance Metrics

| Metric | Target |
|--------|--------|
| Decision latency | < 3.5s |
| Attestation overhead | < 120ms |
| Tx confirmation | < 1.2s |
| Memory retrieval | < 80ms |
| Cycle interval | 15 min (default) |

---

## Quick Start

```bash
git clone https://github.com/Aetheris-Labs/Aegis
cd Aegis && bun install
bun run setup         # interactive wizard
docker-compose up chroma -d
bun run dev
```

Paper trading is on by default.

---

## Configuration

```bash
ANTHROPIC_API_KEY=sk-ant-...
HELIUS_API_KEY=...
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
TEE_MODE=software        # software | tdx | sev
PAPER_TRADING=true
CONFIDENCE_THRESHOLD=0.65
MAX_POSITION_SIZE_USD=500
GLOBAL_DRAWDOWN_LIMIT=0.15
```

See [.env.example](.env.example) for all options.

---

## Risk Infrastructure

- Global drawdown `-15%` halts all new positions
- Per-strategy drawdown `-20%` halts strategy
- Confidence gate: minimum `0.65` to execute
- Human approval required for trades > `$500`
- Circuit breaker: 3 losses in 1h → 4h cooldown
- Trade idempotency prevents duplicate execution

---

## Technical Spec

### Attestation & Key Custody

**Intel TDX path**
- Measurement registers RTMR[0]–RTMR[3] are extended at enclave init: [0] firmware, [1] OS kernel, [2] application, [3] runtime config
- RTMR[3] is re-extended on every config reload; a drift in its value indicates tampered runtime parameters
- Quote is generated per-trade, embedded in the audit log entry, verifiable against Intel PCS

**AMD SEV-SNP path**
- VCEK certificate chain: ARK (AMD root) → ASK (AMD signing key) → VCEK (per-chip, per-TCB)
- VCEK is fetched from `kdsintf.amd.com` at startup and cached; `fetchedAt` timestamp gates rotation detection
- VCEK rotation voids all in-flight attestation sessions — sessions must re-attest after chain refresh

**Quote TTL & replay prevention**
- Quote TTL: `QUOTE_TTL_SECONDS` (default 600s); stale quotes are rejected at the verifier
- Monotonic `restartCounter` field on `TEERuntime`: incremented on every cold start, embedded in quote UserData
- A quote with a lower counter than the current session is rejected — prevents pre-restart quote replay

**Key lifecycle**
- `secp256k1` keypair generated inside enclave boundary using `@noble/secp256k1` CSPRNG
- Sealed with `AES-256-GCM`, key derived from TEE measurement (hardware-bound, not operator-visible)
- `decrypted.fill(0)` called immediately after `Keypair.fromSecretKey()` — private key bytes do not persist on heap

### Risk Engine

| Check | Threshold | Notes |
|-------|-----------|-------|
| Slippage gate | `MAX_SLIPPAGE_BPS` (default 150) | Evaluated before RPC simulation; saves ~40ms per rejection |
| Confidence gate | `CONFIDENCE_THRESHOLD` (default 0.65) | Claude agent confidence score |
| Global drawdown halt | –15% | All new positions suspended |
| Per-strategy halt | –20% | Strategy-level circuit breaker |
| Human approval | > $500 single trade | Hard override; logged to audit trail |

### RA-TLS

All outbound connections from the enclave to Jupiter v6 and Solana RPC use Remote Attestation TLS. The TLS certificate is signed with a key whose public key is embedded in the attestation quote — the verifier confirms the certificate belongs to a genuine enclave before accepting the connection. No custom handshake code; handled by mbedTLS extension.

---

## Roadmap

| Phase | Status | Scope |
|-------|--------|-------|
| **Phase 1** | ✅ | Agent loop, MCP server, memory, paper trading |
| **Phase 2** | 🔄 | Intel TDX production support, AMD SEV-SNP |
| **Phase 3** | 🗓 Q3 2026 | Live execution: Meteora DLMM, Drift perps, Jupiter spot |
| **Phase 4** | 🗓 Q4 2026 | On-chain vault (Anchor), multi-TEE threshold signing |

---

## License

MIT

---

*built for the trenches. keys stay in the box.*

