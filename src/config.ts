import { z } from "zod";
import { config as loadEnv } from "dotenv";

loadEnv();

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  HELIUS_API_KEY: z.string().min(1, "HELIUS_API_KEY is required"),
  DATABASE_URL: z.string().default("file:./enclave-trade.db"),

  // Solana
  SOLANA_RPC_URL: z.string().url(),
  JITO_BLOCK_ENGINE_URL: z
    .string()
    .url()
    .default("https://mainnet.block-engine.jito.wtf"),

  // TEE
  TEE_MODE: z.enum(["tdx", "sev", "software"]).default("software"),
  ATTESTATION_ENDPOINT: z.string().url().optional(),
  REQUIRE_HARDWARE_TEE: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // Trading
  PAPER_TRADING: z
    .string()
    .transform((v) => v !== "false")
    .default("true"),
  ACTIVE_STRATEGIES: z
    .string()
    .transform((v) => v.split(",").map((s) => s.trim()))
    .default("dlmm,perps"),
  CYCLE_INTERVAL_MS: z
    .string()
    .transform(Number)
    .default("900000"),
  CONFIDENCE_THRESHOLD: z
    .string()
    .transform(Number)
    .default("0.65"),
  MAX_POSITION_SIZE_USD: z
    .string()
    .transform(Number)
    .default("500"),
  GLOBAL_DRAWDOWN_LIMIT: z
    .string()
    .transform(Number)
    .default("0.15"),

  // Model
  CLAUDE_MODEL: z
    .string()
    .default("claude-sonnet-4-5-20251001"),

  // Memory
  CHROMA_URL: z.string().url().default("http://localhost:8000"),
});

const parsed = ConfigSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
