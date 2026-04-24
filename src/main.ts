import Anthropic from "@anthropic-ai/sdk";
import { ChromaClient } from "chromadb";
import { Connection } from "@solana/web3.js";
import { config } from "./config.js";
import { TEERuntime } from "./enclave/tee.js";
import { EnclaveSignerService } from "./enclave/signer.js";
import { AttestationService } from "./enclave/attestation.js";
import { AgentMemory } from "./agent/memory.js";
import { RiskEngine } from "./risk/engine.js";
import { createMCPServer } from "./mcp/server.js";
import { createLogger } from "./core/logger.js";
import { createHash } from "crypto";
import type { TradeDecision, TradeOutcome } from "./core/types.js";

const log = createLogger("aegis");
const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

async function bootstrap(): Promise<void> {
  log.info("aegis starting", {
    teeMode: config.TEE_MODE,
    paperTrading: config.PAPER_TRADING,
    strategies: config.ACTIVE_STRATEGIES,
  });

  const teeOptions = {
    mode: config.TEE_MODE,
    ...(config.ATTESTATION_ENDPOINT
      ? { attestationEndpoint: config.ATTESTATION_ENDPOINT }
      : {}),
  };
  const tee = await TEERuntime.initialize(teeOptions);

  if (!tee.isHardwareMode && config.REQUIRE_HARDWARE_TEE) {
    throw new Error("Hardware TEE required but not available.");
  }

  const signer = await EnclaveSignerService.initialize(tee);
  log.info("In-enclave signer ready", { publicKey: signer.publicKey.toBase58() });

  const attestation = new AttestationService(tee, {
    quoteTtlMs: config.QUOTE_TTL_SECONDS * 1000,
  });
  const chroma = new ChromaClient({ path: config.CHROMA_URL });

  const memory = await AgentMemory.initialize(chroma, {
    collectionName: "aegis-memory",
    patternTTLDays: 90,
    warningTTLDays: 60,
    mergeSimilarityThreshold: 0.7,
    pruneSuccessRateThreshold: 0.3,
  });

  const risk = new RiskEngine({
    globalDrawdownLimit: config.GLOBAL_DRAWDOWN_LIMIT,
    strategyDrawdownLimit: 0.2,
    maxPositionsPerStrategy: 3,
    confidenceThreshold: config.CONFIDENCE_THRESHOLD,
    humanApprovalThresholdUSD: config.MAX_POSITION_SIZE_USD,
    maxSlippageBps: config.MAX_SLIPPAGE_BPS,
  });

  const mcpServer = await createMCPServer({
    helApiKey: config.HELIUS_API_KEY,
    rpcUrl: config.SOLANA_RPC_URL,
    walletPubkey: signer.publicKey,
  });

  const connection = new Connection(config.SOLANA_RPC_URL, "confirmed");

  log.info("All subsystems ready. Starting agent loop.");

  await runLoop({ tee, signer, attestation, memory, risk, mcpServer, connection });
}

async function runLoop(deps: {
  tee: TEERuntime;
  signer: EnclaveSignerService;
  attestation: AttestationService;
  memory: AgentMemory;
  risk: RiskEngine;
  mcpServer: Awaited<ReturnType<typeof createMCPServer>>;
  connection: Connection;
}): Promise<void> {
  const { tee, signer, attestation, memory, risk, mcpServer, connection } = deps;
  let cycleCount = 0;
  let shutdownRequested = false;
  const stopPruneScheduler = startPruneScheduler(memory, config.CYCLE_INTERVAL_MS * 10);
  const cleanupSignalHandlers = registerShutdownHandlers(() => {
    shutdownRequested = true;
  });

  try {
    while (!shutdownRequested) {
      const cycleId = `cycle-${++cycleCount}-${Date.now()}`;
      const cycleStart = Date.now();

    log.info("Cycle start", { cycleId, paperTrading: config.PAPER_TRADING });

    try {
      // OBSERVE — pull memory context
      const context = await memory.getRelevantContext({
        query: "active positions risk warnings trade outcomes",
        topK: 8,
      });

      const systemPrompt = buildSystemPrompt(context.map((m) => `[${m.type.toUpperCase()}] ${m.content}`));
      const tools = mcpServer.getToolDefinitions();

      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: "Run your market analysis and decision cycle." },
      ];

      let decision: TradeDecision | null = null;

      // REASON — agentic tool loop
      agentLoop: while (true) {
        const response = await client.messages.create({
          model: config.CLAUDE_MODEL,
          max_tokens: 4096,
          system: systemPrompt,
          tools,
          messages,
        });

        if (response.stop_reason === "end_turn") break agentLoop;

        if (response.stop_reason === "tool_use") {
          const toolBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const tb of toolBlocks) {
            if (tb.name === "enclave_execute_trade") {
              const input = tb.input as Record<string, unknown>;
              decision = {
                strategy: input["strategy"] as TradeDecision["strategy"],
                token: input["token"] as string,
                action: input["action"] as TradeDecision["action"],
                sizeUSD: input["size_usd"] as number,
                confidence: input["confidence"] as number,
                reasoning: input["reasoning"] as string,
                ...(input["slippage_bps"] !== undefined
                  ? { slippageBps: Number(input["slippage_bps"]) }
                  : {}),
              };
              break agentLoop;
            }

            try {
              const result = await mcpServer.executeTool(tb.name, tb.input as Record<string, unknown>);
              toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: JSON.stringify(result) });
            } catch (err) {
              toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: `ERROR: ${String(err)}`, is_error: true });
            }
          }

          messages.push({ role: "assistant", content: response.content });
          messages.push({ role: "user", content: toolResults });
        }
      }

      if (!decision) {
        await memory.upsert({ type: "observation", content: `${cycleId}: No trade opportunity met threshold.`, timestamp: new Date() });
        log.info("No trade this cycle", { cycleId });
      } else {
        // ATTEST
        const decisionHash = createHash("sha256").update(JSON.stringify(decision)).digest("hex");
        const quote = await attestation.generateQuote({
          decisionHash,
          cycleId,
          timestamp: Date.now(),
        });

        const attestationApproved = await attestation.verifyQuote(quote, {
          expectedDecisionHash: decisionHash,
          expectedCycleId: cycleId,
          requireHardware: config.REQUIRE_HARDWARE_TEE,
        });

        if (!attestationApproved) {
          log.warn("Attestation rejected", { cycleId, decision });
          await memory.upsert({
            type: "warning",
            content: `Attestation rejected for decision ${JSON.stringify(decision)}`,
            timestamp: new Date(),
          });
          log.info("Cycle complete", { cycleId, durationMs: Date.now() - cycleStart });
          await sleepWithShutdown(config.CYCLE_INTERVAL_MS, () => shutdownRequested);
          continue;
        }

        // VALIDATE
        const riskResult = await risk.evaluate(decision);

        if (!riskResult.approved) {
          log.warn("Risk rejection", { cycleId, reason: riskResult.reason });
          await memory.upsert({ type: "warning", content: `Risk rejection: ${riskResult.reason}. Decision: ${JSON.stringify(decision)}`, timestamp: new Date() });
        } else {
          // SIGN + EXECUTE (paper mode skips actual signing)
          if (config.PAPER_TRADING) {
            log.info("[PAPER] Simulated trade", { cycleId, decision });
          } else {
            log.info("Executing live trade", { cycleId, decision });
            // Live execution: build tx → sign in enclave → submit
            // const tx = await buildTransaction(decision, connection);
            // const signed = await signer.signTransaction(tx);
            // await connection.sendRawTransaction(signed.serialize());
          }

          // LEARN
          const outcome = derivePaperOutcome(cycleId, decision, Date.now() - cycleStart);

          await memory.upsert({
            type: outcome.pnlUSD > 0 ? "pattern" : "warning",
            content: `${outcome.pnlUSD > 0 ? "WIN" : "LOSS"} | ${decision.strategy} | ${decision.token} | $${decision.sizeUSD} | confidence: ${decision.confidence} | P&L: $${outcome.pnlUSD.toFixed(2)} | reasoning: ${decision.reasoning}`,
            timestamp: new Date(),
            metadata: { strategy: decision.strategy, pnlUSD: outcome.pnlUSD, confidence: decision.confidence, attestationId: quote.id },
          });
        }
      }

      log.info("Cycle complete", { cycleId, durationMs: Date.now() - cycleStart });
      } catch (err) {
        log.error("Cycle error", { cycleId, error: String(err) });
      }

      await sleepWithShutdown(config.CYCLE_INTERVAL_MS, () => shutdownRequested);
    }

    log.info("Shutdown requested. Agent loop stopped cleanly.");
  } finally {
    cleanupSignalHandlers();
    stopPruneScheduler();
  }
}

function startPruneScheduler(memory: AgentMemory, intervalMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) {
      return;
    }

    timer = setTimeout(async () => {
      try {
        await memory.pruneExpired();
      } catch (err) {
        log.error("Background prune failed", { error: String(err) });
      } finally {
        scheduleNext();
      }
    }, intervalMs);
  };

  scheduleNext();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function registerShutdownHandlers(onShutdown: () => void): () => void {
  const handleSignal = (signal: NodeJS.Signals) => {
    log.warn("Shutdown signal received", { signal });
    onShutdown();
  };

  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);

  return () => {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
  };
}

function buildSystemPrompt(memoryLines: string[]): string {
  return `You are an autonomous Solana trading agent running inside a Trusted Execution Environment.
Your Ed25519 signing key is sealed in the enclave and cannot be exported.

DATE: ${new Date().toISOString()}
PAPER_TRADING: ${config.PAPER_TRADING}
ACTIVE_STRATEGIES: ${config.ACTIVE_STRATEGIES.join(", ")}
CONFIDENCE_THRESHOLD: ${config.CONFIDENCE_THRESHOLD}

MEMORY:
${memoryLines.length > 0 ? memoryLines.join("\n") : "No memory yet — this is an early cycle."}

Use the available tools to observe market conditions. Reason step-by-step.
If you find an opportunity with confidence >= ${config.CONFIDENCE_THRESHOLD}, call enclave_execute_trade.
Otherwise, end your turn with your reasoning.`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sleepWithShutdown(ms: number, shouldStop: () => boolean): Promise<void> {
  const deadline = Date.now() + ms;

  while (!shouldStop()) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return;
    }

    await sleep(Math.min(remainingMs, 250));
  }
}

function derivePaperOutcome(
  cycleId: string,
  decision: TradeDecision,
  latencyMs: number
): TradeOutcome {
  const confidenceEdge = Math.max(decision.confidence - config.CONFIDENCE_THRESHOLD, 0);
  const modeledEdgeBps = Math.max(8, Math.round(confidenceEdge * 120));
  const slippageBps = Math.min(
    decision.slippageBps ?? Math.floor(config.MAX_SLIPPAGE_BPS / 2),
    config.MAX_SLIPPAGE_BPS
  );
  const directionBias =
    decision.action === "sell" || decision.action === "short" || decision.action === "remove_liquidity"
      ? -1
      : 1;
  const pnlUSD = Number(
    (((decision.sizeUSD * (modeledEdgeBps - slippageBps / 2)) / 10_000) * directionBias).toFixed(2)
  );

  return {
    cycleId,
    pnlUSD,
    slippageBps,
    latencyMs,
    simulated: true,
  };
}

bootstrap().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
