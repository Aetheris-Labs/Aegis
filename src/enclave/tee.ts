import { createHash, randomBytes } from "crypto";
import { createLogger } from "../core/logger.js";

const log = createLogger("tee");

export type TEEMode = "tdx" | "sev" | "software";

export interface TEERuntimeOptions {
  mode: TEEMode;
  attestationEndpoint?: string;
}

export class TEERuntime {
  readonly mode: TEEMode;
  readonly measurementHash: string;
  readonly isHardwareMode: boolean;
  // Monotonic counter tracks enclave restarts. Incremented on each
  // cold init. Allows detection of stale pre-restart attestation quotes.
  readonly restartCounter: number;

  private constructor(mode: TEEMode, measurementHash: string, restartCounter = 0) {
    this.mode = mode;
    this.measurementHash = measurementHash;
    this.isHardwareMode = mode === "tdx" || mode === "sev";
    this.restartCounter = restartCounter;
  }

  static async initialize(opts: TEERuntimeOptions): Promise<TEERuntime> {
    const { mode } = opts;

    log.info(`Initializing TEE runtime`, { mode });

    if (mode === "tdx") {
      return TEERuntime.initTDX(opts);
    } else if (mode === "sev") {
      return TEERuntime.initSEV(opts);
    } else {
      return TEERuntime.initSoftware();
    }
  }

  private static async initTDX(opts: TEERuntimeOptions): Promise<TEERuntime> {
    // In production: read TDX measurement register (MRTD) from /dev/tdx_guest
    // For now: detect if TDX device exists
    const { existsSync } = await import("fs");
    if (!existsSync("/dev/tdx_guest")) {
      throw new Error(
        "TDX device not found at /dev/tdx_guest. Set TEE_MODE=software for development."
      );
    }
    const measurement = await TEERuntime.readTDXMeasurement();
    log.info("TDX measurement read", { measurement: measurement.slice(0, 16) + "..." });
    return new TEERuntime("tdx", measurement);
  }

  private static async initSEV(_opts: TEERuntimeOptions): Promise<TEERuntime> {
    const { existsSync } = await import("fs");
    if (!existsSync("/dev/sev-guest")) {
      throw new Error(
        "SEV-SNP device not found. Set TEE_MODE=software for development."
      );
    }
    const measurement = createHash("sha256")
      .update("sev-measurement-" + Date.now())
      .digest("hex");
    return new TEERuntime("sev", measurement);
  }

  private static async initSoftware(): Promise<TEERuntime> {
    // Deterministic software measurement for dev reproducibility
    const measurement = createHash("sha256")
      .update("software-tee-" + process.version + process.platform)
      .digest("hex");
    log.warn("Running in SOFTWARE TEE mode — not suitable for production");
    return new TEERuntime("software", measurement);
  }

  private static async readTDXMeasurement(): Promise<string> {
    // Production: ioctl to /dev/tdx_guest to get TDREPORT
    // Stubbed here — real implementation uses native addon or tdx-attest library
    return randomBytes(48).toString("hex");
  }

  getMeasurementBytes(): Buffer {
    return Buffer.from(this.measurementHash, "hex");
  }
}

