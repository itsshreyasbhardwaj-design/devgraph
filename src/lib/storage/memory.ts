import type { AnalysisResult } from '@/lib/core/types';
import { type AnalysisStore, type StoredAnalysisSummary, sourceKey, summarize } from './types';

interface Entry {
  result: AnalysisResult;
  ownerId?: string;
  bytes: number;
  /** Monotonic access counter — `Date.now()` is too coarse to order LRU. */
  touchedAt: number;
}

/**
 * In-memory analysis store.
 *
 * The default when no `DATABASE_URL` is configured, which makes DevGraph
 * genuinely zero-setup: clone, `pnpm dev`, analyse. Entries are evicted
 * least-recently-used once the byte budget is reached so a long-running
 * process cannot grow without bound.
 */
export class MemoryAnalysisStore implements AnalysisStore {
  readonly kind = 'memory' as const;
  private readonly entries = new Map<string, Entry>();
  private readonly bySource = new Map<string, string>();
  private totalBytes = 0;
  private clock = 0;

  constructor(
    private readonly maxEntries = 24,
    private readonly maxBytes = 256 * 1024 * 1024,
  ) {}

  async init(): Promise<void> {
    // Nothing to prepare.
  }

  async save(result: AnalysisResult, ownerId?: string): Promise<void> {
    const bytes = estimateBytes(result);
    const existing = this.entries.get(result.id);
    if (existing) this.totalBytes -= existing.bytes;

    this.clock += 1;
    this.entries.set(result.id, { result, ownerId, bytes, touchedAt: this.clock });
    this.bySource.set(`${ownerId ?? ''}::${sourceKey(result.source)}`, result.id);
    this.totalBytes += bytes;
    this.evict();
  }

  async get(id: string, ownerId?: string): Promise<AnalysisResult | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (!this.canRead(entry, ownerId)) return undefined;
    this.clock += 1;
    entry.touchedAt = this.clock;
    return entry.result;
  }

  async list(ownerId?: string, limit = 25): Promise<StoredAnalysisSummary[]> {
    return [...this.entries.values()]
      .filter((entry) => this.canRead(entry, ownerId))
      .sort((a, b) => Date.parse(b.result.createdAt) - Date.parse(a.result.createdAt))
      .slice(0, limit)
      .map((entry) => summarize(entry.result, entry.ownerId));
  }

  async delete(id: string, ownerId?: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry || !this.canRead(entry, ownerId)) return false;
    this.entries.delete(id);
    this.bySource.delete(`${entry.ownerId ?? ''}::${sourceKey(entry.result.source)}`);
    this.totalBytes -= entry.bytes;
    return true;
  }

  async findBySource(key: string, ownerId?: string): Promise<AnalysisResult | undefined> {
    const id = this.bySource.get(`${ownerId ?? ''}::${key}`);
    return id ? this.get(id, ownerId) : undefined;
  }

  /** Anonymous results are public; owned results are visible to their owner. */
  private canRead(entry: Entry, ownerId?: string): boolean {
    if (!entry.ownerId) return true;
    return entry.ownerId === ownerId;
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      let oldestId: string | undefined;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [id, entry] of this.entries) {
        if (entry.touchedAt < oldestAt) {
          oldestAt = entry.touchedAt;
          oldestId = id;
        }
      }
      if (!oldestId) break;
      const entry = this.entries.get(oldestId)!;
      this.entries.delete(oldestId);
      this.bySource.delete(`${entry.ownerId ?? ''}::${sourceKey(entry.result.source)}`);
      this.totalBytes -= entry.bytes;
    }
  }
}

/** Rough in-memory footprint. Cheaper and good enough for eviction decisions. */
function estimateBytes(result: AnalysisResult): number {
  const nodes = Object.values(result.graphs).reduce(
    (sum, graph) => sum + (graph?.nodes.length ?? 0) + (graph?.edges.length ?? 0),
    0,
  );
  return result.files.length * 400 + nodes * 250 + result.searchIndex.length * 200 + 50_000;
}
