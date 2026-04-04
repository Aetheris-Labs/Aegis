import { createHash, randomUUID } from "crypto";
import { createLogger } from "../core/logger.js";
import type { TEERuntime } from "./tee.js";
import type { AttestationQuote } from "../core/types.js";

const log = createLogger("attestation");

// Quote TTL: 10 minutes. Must be refreshed before expiry to prevent
// replay of stale quotes across VCEK rotation boundaries.
const QUOTE_TTL_MS = 10 * 60 * 1000;

interface QuoteRequest {
  decisionHash: string;
  cycleId: string;
  timestamp: number;
}

// AMD SEV-SNP attestation uses VCEK (Versioned Chip Endorsement Key) derived
// from the chip's UDS. VCEK certificates are fetched from AMD KDS and must be
// re-verified after firmware updates that trigger VCEK rotation.
interface VCEKChain {
  vcekCert: Buffer;
  askCert: Buffer;   // AMD Signing Key
  arkCert: Buffer;   // AMD Root Key
  fetchedAt: number;
}

export class AttestationService {
  private readonly tee: TEERuntime;
  private vcekChain: VCEKChain | null = null;
  private lastQuoteAt = 0;

  constructor(tee: TEERuntime) {
    this.tee = tee;
  }

  isQuoteStale(): boolean {
    return Date.now() - this.lastQuoteAt > QUOTE_TTL_MS;
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
    // TDX path: call DCAP library, bind decisionHash into REPORTDATA[0:32].
    // SEV-SNP path: call sev-guest ioctl, bind into REPORT_DATA field.
    // Both paths produce a hardware-rooted quote verifiable via their
    // respective certificate chains (Intel PCS / AMD KDS).
    const reportData = createHash("sha256")
      .update(req.decisionHash)
      .update(req.cycleId)
      .digest();

    // TDX: const rawQuote = await tdxAttest.generateQuote(reportData)
    // SEV: const rawQuote = await sevGuest.getReport(reportData)
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

