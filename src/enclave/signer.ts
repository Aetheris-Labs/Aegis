import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createLogger } from "../core/logger.js";
import type { TEERuntime } from "./tee.js";

const log = createLogger("signer");

const SEALED_KEY_PATH = "./data/sealed-key.bin";
const SEAL_ALGORITHM = "aes-256-gcm";

/**
 * EnclaveSignerService
 *
 * Manages an Ed25519 keypair that is:
 * - Generated inside the TEE boundary on first boot
 * - Sealed (encrypted) with a key derived from the TEE measurement
 * - Never exported or logged
 *
 * In software mode: uses a process-local key for development.
 * In hardware mode: key is cryptographically bound to the TEE measurement.
 */
export class EnclaveSignerService {
  private readonly keypair: Keypair;
  readonly publicKey: Keypair["publicKey"];

  private constructor(keypair: Keypair) {
    this.keypair = keypair;
    this.publicKey = keypair.publicKey;
  }

  static async initialize(tee: TEERuntime): Promise<EnclaveSignerService> {
    const { mkdirSync } = await import("fs");
    mkdirSync("./data", { recursive: true });

    if (existsSync(SEALED_KEY_PATH)) {
      log.info("Loading sealed keypair from storage");
      const keypair = await EnclaveSignerService.unsealKeypair(tee);
      log.info("Keypair loaded", { publicKey: keypair.publicKey.toBase58() });
      return new EnclaveSignerService(keypair);
    }

    log.info("Generating new Ed25519 keypair inside TEE boundary");
    const keypair = Keypair.generate();
    await EnclaveSignerService.sealKeypair(keypair, tee);

    log.info("Keypair generated and sealed", {
      publicKey: keypair.publicKey.toBase58(),
      sealedTo: tee.measurementHash.slice(0, 16) + "...",
    });

    return new EnclaveSignerService(keypair);
  }

  async signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction> {
    tx.sign([this.keypair]);
    return tx;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const { sign } = await import("@noble/ed25519");
    return sign(message, this.keypair.secretKey.slice(0, 32));
  }

  private static async sealKeypair(keypair: Keypair, tee: TEERuntime): Promise<void> {
    const sealKey = EnclaveSignerService.deriveSealKey(tee);
    const iv = randomBytes(12);
    const cipher = createCipheriv(SEAL_ALGORITHM, sealKey, iv);

    const secretKeyBytes = Buffer.from(keypair.secretKey);
    const encrypted = Buffer.concat([cipher.update(secretKeyBytes), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: iv(12) + authTag(16) + encrypted(64)
    const sealed = Buffer.concat([iv, authTag, encrypted]);
    writeFileSync(SEALED_KEY_PATH, sealed);
  }

  private static async unsealKeypair(tee: TEERuntime): Promise<Keypair> {
    const sealKey = EnclaveSignerService.deriveSealKey(tee);
    const sealed = readFileSync(SEALED_KEY_PATH);

    const iv = sealed.subarray(0, 12);
    const authTag = sealed.subarray(12, 28);
    const encrypted = sealed.subarray(28);

    const decipher = createDecipheriv(SEAL_ALGORITHM, sealKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const keypair = Keypair.fromSecretKey(decrypted);

    // Zeroize key material from intermediate buffer immediately after use.
    // Buffer.fill(0) ensures private key bytes don't persist on the heap
    // beyond this stack frame — critical inside TEE where heap is encrypted
    // but zeroization limits exposure window if memory is ever swapped.
    decrypted.fill(0);

    return keypair;
  }

  private static deriveSealKey(tee: TEERuntime): Buffer {
    // Seal key is derived from TEE measurement — changes if measurement changes
    return createHash("sha256")
      .update("aegis-seal-v1")
      .update(tee.getMeasurementBytes())
      .digest()
      .subarray(0, 32);
  }
}
