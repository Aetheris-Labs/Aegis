import { ChromaClient, Collection } from "chromadb";
import { randomUUID } from "crypto";
import { createLogger } from "../core/logger.js";
import type { MemoryEntry, MemoryEntryType } from "../core/types.js";

const log = createLogger("memory");

export interface MemoryConfig {
  collectionName: string;
  patternTTLDays: number;
  warningTTLDays: number;
  mergeSimilarityThreshold: number;
  pruneSuccessRateThreshold: number;
}

export class AgentMemory {
  private readonly collection: Collection;
  private readonly config: MemoryConfig;

  private constructor(collection: Collection, config: MemoryConfig) {
    this.collection = collection;
    this.config = config;
  }

  static async initialize(
    client: ChromaClient,
    config: MemoryConfig
  ): Promise<AgentMemory> {
    const collection = await client.getOrCreateCollection({
      name: config.collectionName,
      metadata: { "hnsw:space": "cosine" },
    });

    log.info("Memory collection initialized", {
      name: config.collectionName,
      count: await collection.count(),
    });

    return new AgentMemory(collection, config);
  }

  async upsert(entry: Omit<MemoryEntry, "id">): Promise<void> {
    const id = randomUUID();
    const expiresAt = this.getExpiryDate(entry.type);

    await this.collection.upsert({
      ids: [id],
      documents: [entry.content],
      metadatas: [
        {
          type: entry.type,
          timestamp: entry.timestamp.toISOString(),
          expiresAt: expiresAt.toISOString(),
          ...(entry.metadata as Record<string, string | number | boolean>),
        },
      ],
    });
  }

  async getRelevantContext(opts: {
    query: string;
    topK: number;
    type?: MemoryEntryType;
  }): Promise<MemoryEntry[]> {
    const where = opts.type ? { type: opts.type } : undefined;

    const results = await this.collection.query({
      queryTexts: [opts.query],
      nResults: opts.topK,
      where,
    });

    const docs = results.documents[0] ?? [];
    const metadatas = results.metadatas[0] ?? [];
    const ids = results.ids[0] ?? [];

    return docs
      .map((doc, i) => {
        const meta = metadatas[i];
        if (!doc || !meta) return null;
        return {
          id: ids[i] ?? randomUUID(),
          type: (meta["type"] as MemoryEntryType) ?? "observation",
          content: doc,
          timestamp: new Date(meta["timestamp"] as string),
          metadata: meta,
        } satisfies MemoryEntry;
      })
      .filter((e): e is MemoryEntry => e !== null);
  }

  async pruneExpired(): Promise<number> {
    const all = await this.collection.get();
    const now = new Date();
    const expiredIds: string[] = [];

    for (let i = 0; i < all.ids.length; i++) {
      const meta = all.metadatas[i];
      if (!meta) continue;
      const expiresAt = meta["expiresAt"] as string | undefined;
      if (expiresAt && new Date(expiresAt) < now) {
        expiredIds.push(all.ids[i] as string);
      }
    }

    if (expiredIds.length > 0) {
      await this.collection.delete({ ids: expiredIds });
      log.info("Pruned expired memories", { count: expiredIds.length });
    }

    return expiredIds.length;
  }

  private getExpiryDate(type: MemoryEntryType): Date {
    const now = new Date();
    const ttlDays =
      type === "pattern"
        ? this.config.patternTTLDays
        : type === "warning"
        ? this.config.warningTTLDays
        : 30;

    return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  }
}

