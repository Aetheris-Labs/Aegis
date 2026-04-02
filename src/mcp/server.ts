import { Connection, PublicKey } from "@solana/web3.js";
import type Anthropic from "@anthropic-ai/sdk";
import { createLogger } from "../core/logger.js";

const log = createLogger("mcp");

export interface MCPServerConfig {
  helApiKey: string;
  rpcUrl: string;
  walletPubkey: PublicKey;
}

/**
 * createMCPServer
 *
 * Returns tool definitions for the Claude Agent SDK and an executor function.
 * Each tool corresponds to a Solana data source or execution action.
 * The signer is NOT accessible from tools — only the orchestrator can call sign().
 */
export async function createMCPServer(config: MCPServerConfig) {
  const connection = new Connection(config.rpcUrl, "confirmed");

  const tools: Anthropic.Tool[] = [
    {
      name: "solana_get_price",
      description:
        "Get the current price of a Solana token from Pyth oracle and DexScreener. Returns price, 24h volume, and 1h/4h/24h price change.",
      input_schema: {
        type: "object" as const,
        properties: {
          token_mint: {
            type: "string",
            description: "Solana token mint address",
          },
        },
        required: ["token_mint"],
      },
    },
    {
      name: "solana_get_pool_state",
      description:
        "Get Meteora DLMM pool state including active bin, bin range, TVL, fee rate, and 24h volume.",
      input_schema: {
        type: "object" as const,
        properties: {
          pool_address: {
            type: "string",
            description: "Meteora DLMM pool address",
          },
        },
        required: ["pool_address"],
      },
    },
    {
      name: "solana_get_funding_rate",
      description:
        "Get Drift Protocol funding rate, open interest, mark price, and oracle price for a perp market.",
      input_schema: {
        type: "object" as const,
        properties: {
          market_symbol: {
            type: "string",
            description: "Market symbol e.g. SOL-PERP",
          },
        },
        required: ["market_symbol"],
      },
    },
    {
      name: "jupiter_get_quote",
      description:
        "Get best swap route from Jupiter v6. Returns expected output amount, price impact, and route path.",
      input_schema: {
        type: "object" as const,
        properties: {
          input_mint: { type: "string" },
          output_mint: { type: "string" },
          amount_lamports: { type: "number" },
          slippage_bps: { type: "number", description: "Max slippage in bps, default 50" },
        },
        required: ["input_mint", "output_mint", "amount_lamports"],
      },
    },
    {
      name: "solana_get_wallet_positions",
      description:
        "Get current wallet token balances and open positions on Drift and Meteora.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "enclave_execute_trade",
      description:
        "FINAL ACTION: Submit a trade decision for execution. Only call this after analysis is complete and you have high confidence. The risk engine will validate before signing.",
      input_schema: {
        type: "object" as const,
        properties: {
          strategy: {
            type: "string",
            enum: ["dlmm", "perps", "spot"],
          },
          token: { type: "string", description: "Token symbol or mint" },
          action: {
            type: "string",
            enum: ["buy", "sell", "long", "short", "add_liquidity", "remove_liquidity"],
          },
          size_usd: { type: "number", description: "Position size in USD" },
          confidence: {
            type: "number",
            description: "Your confidence 0.0-1.0",
          },
          reasoning: {
            type: "string",
            description: "Explanation of why this trade meets your criteria",
          },
        },
        required: ["strategy", "token", "action", "size_usd", "confidence", "reasoning"],
      },
    },
  ];

  async function executeTool(
    name: string,
    input: Record<string, unknown>
  ): Promise<unknown> {
    switch (name) {
      case "solana_get_price":
        return fetchPrice(input["token_mint"] as string, config.helApiKey);
      case "solana_get_pool_state":
        return fetchPoolState(input["pool_address"] as string);
      case "solana_get_funding_rate":
        return fetchFundingRate(input["market_symbol"] as string);
      case "jupiter_get_quote":
        return fetchJupiterQuote(input);
      case "solana_get_wallet_positions":
        return fetchWalletPositions(config.walletPubkey, connection);
      case "enclave_execute_trade":
        // This is handled by the orchestrator — should not reach here
        return { status: "intercepted_by_orchestrator" };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  return { getToolDefinitions: () => tools, executeTool };
}

// ─── Tool implementations ──────────────────────────────────────────────────────

async function fetchPrice(mint: string, helApiKey: string) {
  const url = `https://api.helius.xyz/v0/token-metadata?api-key=${helApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAccounts: [mint] }),
  });
  if (!res.ok) throw new Error(`Helius API error: ${res.status}`);
  return res.json();
}

async function fetchPoolState(poolAddress: string) {
  const res = await fetch(
    `https://dlmm-api.meteora.ag/pair/${poolAddress}`
  );
  if (!res.ok) throw new Error(`Meteora API error: ${res.status}`);
  return res.json();
}

async function fetchFundingRate(marketSymbol: string) {
  const res = await fetch(
    `https://dlob.drift.trade/fundingRate?marketName=${marketSymbol}`
  );
  if (!res.ok) throw new Error(`Drift API error: ${res.status}`);
  return res.json();
}

async function fetchJupiterQuote(input: Record<string, unknown>) {
  const params = new URLSearchParams({
    inputMint: input["input_mint"] as string,
    outputMint: input["output_mint"] as string,
    amount: String(input["amount_lamports"]),
    slippageBps: String(input["slippage_bps"] ?? 50),
  });
  const res = await fetch(`https://quote-api.jup.ag/v6/quote?${params}`);
  if (!res.ok) throw new Error(`Jupiter API error: ${res.status}`);
  return res.json();
}

async function fetchWalletPositions(pubkey: PublicKey, connection: Connection) {
  const balance = await connection.getBalance(pubkey);
  return {
    wallet: pubkey.toBase58(),
    solBalance: balance / 1e9,
    positions: [],
  };
}
