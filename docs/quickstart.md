# Quick Start

## Prerequisites

- [Bun](https://bun.sh) >= 1.2
- [Docker](https://docker.com) (for Chroma vector DB)
- Anthropic API key
- Helius API key (free tier works for paper trading)

## Install

```bash
git clone https://github.com/YOUR_ORG/aegis
cd aegis
bun install
```

## Configure

```bash
bun run setup
# Follow the interactive wizard
```

Or manually:

```bash
cp .env.example .env
# Edit .env with your keys
```

## Start vector memory backend

```bash
docker-compose up chroma -d
```

## Run (paper trading)

```bash
bun run dev
```

You'll see the agent loop start:

```
2026-04-02T10:00:00Z [INFO] [tee] Initializing TEE runtime { mode: 'software' }
2026-04-02T10:00:00Z [WARN] [tee] Running in SOFTWARE TEE mode — not suitable for production
2026-04-02T10:00:00Z [INFO] [signer] Keypair generated and sealed { publicKey: '...' }
2026-04-02T10:00:00Z [INFO] [aegis] All subsystems ready. Starting agent loop.
2026-04-02T10:00:00Z [INFO] [aegis] Cycle start { cycleId: 'cycle-1-...', paperTrading: true }
```

## Verify attestation

```bash
bun run verify
```

## Go live

Set `PAPER_TRADING=false` in `.env`. Start with small position sizes (`MAX_POSITION_SIZE_USD=50`) and monitor the first few cycles.
