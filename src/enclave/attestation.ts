import { createHash, randomUUID } from "crypto";
import { createLogger } from "../core/logger.js";
import type { TEERuntime } from "./tee.js";
import type { AttestationQuote } from "../core/types.js";

const log = createLogger("attestation");

const QUOTE_TTL_MS = 10 * 60 * 1000;

interface QuoteRequest {
  decisionHash: string;
  cycleId: string;
  timestamp: number;
}

interface VerifyQuoteRequest {
  expectedDecisionHash: string;
  expectedCycleId: string;
  requireHardware: boolean;
}

interface VCEKChain {
  vcekCert: Buffer;
  askCert: Buffer;
  arkCert: Buffer;
  fetchedAt: number;
}

export class AttestationService {
  private readonly tee: TEERuntime;
  private vcekChain: VCEKChain | null = null;
  private lastQuoteAt = 0;
  private readonly quoteTtlMs: number;

  constructor(tee: TEERuntime, opts?: { quoteTtlMs?: number }) {
    this.tee = tee;
    this.quoteTtlMs = opts?.quoteTtlMs ?? QUOTE_TTL_MS;
  }

  isQuoteStale(): boolean {
    return Date.now() - this.lastQuoteAt > this.quoteTtlMs;
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
    const reportData = createHash("sha256")
      .update(req.decisionHash)
      .update(req.cycleId)
      .digest();

    const rawQuote = Buffer.concat([
      Buffer.from(this.tee.mode === "sev" ? "SEVSNP-STUB-v1.0" : "TDQUOTE-STUB-v1.0"),
      this.tee.getMeasurementBytes(),
      reportData,
    ]);
    this.lastQuoteAt = Date.now();

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

  async verifyQuote(quote: AttestationQuote, req: VerifyQuoteRequest): Promise<boolean> {
    if (Date.now() - quote.timestamp > this.quoteTtlMs) {
      log.warn("Quote rejected: stale", { id: quote.id });
      return false;
    }

    if (quote.decisionHash !== req.expectedDecisionHash || quote.cycleId !== req.expectedCycleId) {
      log.warn("Quote rejected: binding mismatch", { id: quote.id });
      return false;
    }

    if (!quote.isHardwareBacked) {
      if (req.requireHardware) {
        log.warn("Quote rejected: hardware attestation required", { id: quote.id });
        return false;
      }

      const expected = createHash("sha256")
        .update("software-quote")
        .update(this.tee.measurementHash)
        .update(req.expectedDecisionHash)
        .update(req.expectedCycleId)
        .digest();

      const valid = quote.rawQuote.equals(expected);
      if (!valid) {
        log.warn("Software quote rejected: digest mismatch", { id: quote.id });
      }
      return valid;
    }

    const expectedPrefix = this.tee.mode === "sev" ? "SEVSNP-STUB-v1.0" : "TDQUOTE-STUB-v1.0";
    const hasPrefix = quote.rawQuote.subarray(0, expectedPrefix.length).equals(Buffer.from(expectedPrefix));
    const hasMeasurement = quote.rawQuote.includes(this.tee.getMeasurementBytes());

    if (!hasPrefix || !hasMeasurement) {
      log.warn("Hardware quote rejected: malformed payload", { id: quote.id });
      return false;
    }

    log.info("Hardware quote structurally verified", { id: quote.id, mode: this.tee.mode });
    return true;
  }
}
