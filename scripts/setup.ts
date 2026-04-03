#!/usr/bin/env bun
import * as p from "@clack/prompts";
import { writeFileSync, existsSync, readFileSync } from "fs";

p.intro("aegis setup wizard");

const teeMode = await p.select({
  message: "TEE mode",
  options: [
    { value: "software", label: "software — local dev (no hardware required)" },
    { value: "tdx", label: "tdx — Intel TDX (production)" },
    { value: "sev", label: "sev — AMD SEV-SNP (production)" },
  ],
  initialValue: "software",
});

const anthropicKey = await p.text({
  message: "Anthropic API key",
  placeholder: "sk-ant-...",
  validate: (v) => (!v.startsWith("sk-") ? "Must start with sk-" : undefined),
});

const heliusKey = await p.text({
  message: "Helius API key",
  placeholder: "your-helius-key",
});

const paperTrading = await p.confirm({
  message: "Enable paper trading? (recommended for first run)",
  initialValue: true,
});

if (p.isCancel(teeMode) || p.isCancel(anthropicKey) || p.isCancel(heliusKey)) {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;

const envContent = `ANTHROPIC_API_KEY=${anthropicKey}
HELIUS_API_KEY=${heliusKey}
DATABASE_URL=file:./aegis.db
SOLANA_RPC_URL=${rpcUrl}
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
TEE_MODE=${teeMode}
REQUIRE_HARDWARE_TEE=false
PAPER_TRADING=${paperTrading}
ACTIVE_STRATEGIES=dlmm,perps
CYCLE_INTERVAL_MS=900000
CONFIDENCE_THRESHOLD=0.65
MAX_POSITION_SIZE_USD=500
GLOBAL_DRAWDOWN_LIMIT=0.15
CLAUDE_MODEL=claude-sonnet-4-5-20251001
CHROMA_URL=http://localhost:8000
`;

writeFileSync(".env", envContent);

p.outro(`
Setup complete.

  Start:           bun run dev
  Paper trading:   ${paperTrading ? "ON" : "OFF"}
  TEE mode:        ${teeMode}

  Run 'docker-compose up chroma' to start the vector memory backend.
`);
