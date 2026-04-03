import { createHash, randomUUID } from "crypto";
import { createLogger } from "../core/logger.js";
import type { TEERuntime } from "./tee.js";
import type { AttestationQuote } from "../core/types.js";

const log = createLogger("attestation");

interface QuoteRequest {
  decisionHash: string;
  cycleId: string;
  timestamp: number;
}

export class AttestationService {
  private readonly tee: TEERuntime;

  constructor(tee: TEERuntime) {
    this.tee = tee;
  }

  async generateQuote(req: QuoteRequest): Promise<AttestationQuote> {
    const start = Date.now();

    const quote = this.tee.isHardwareMode
      ? await this.generateHardwareQuote(req)
      : this.generateSoftwareQuote(req);

    log.info("Attestation quote generated", {
      id: quote.id,
      cycleId: req.cycleId,
      latencyMs: Date.now() - start,
      hardwareBacked: quote.isHardwareBacked,
    });

    return quote;
  }

  private async generateHardwareQuote(req: QuoteRequest): Promise<AttestationQuote> {
    // Production: call Intel TDX DCAP library to generate TDQUOTE
    // Binds req.decisionHash into the REPORTDATA field (64 bytes)
    // For now: stub that would be replaced by native addon
    const reportData = createHash("sha256")
      .update(req.decisionHash)
      .update(req.cycleId)
      .digest();

    // TODO: Replace with: const rawQuote = await tdxAttest.generateQuote(reportData)
    const rawQuote = Buffer.concat([
      Buffer.from("TDQUOTE-STUB-v1.0"),
      this.tee.getMeasurementBytes(),
      reportData,
    ]);

    return {
      id: randomUUID(),
      rawQuote,
      decisionHash: req.decisionHash,
      cycleId: req.cycleId,
      timestamp: req.timestamp,
      isHardwareBacked: true,
    };
  }

  private generateSoftwareQuote(req: QuoteRequest): AttestationQuote {
    const rawQuote = createHash("sha256")
      .update("software-quote")
      .update(this.tee.measurementHash)
      .update(req.decisionHash)
      .update(req.cycleId)
      .digest();

    return {
      id: randomUUID(),
      rawQuote,
      decisionHash: req.decisionHash,
      cycleId: req.cycleId,
      timestamp: req.timestamp,
      isHardwareBacked: false,
    };
  }

  async verifyQuote(quote: AttestationQuote): Promise<boolean> {
    if (!quote.isHardwareBacked) {
      log.warn("Software quote — skipping hardware verification");
      return true;
    }
    // Production: submit rawQuote to Intel PCS for verification
    // Returns true if quote is valid and measurement matches expected
    log.info("Hardware quote verification (stub)", { id: quote.id });
    return true;
  }
}

