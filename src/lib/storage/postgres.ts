import { gunzipSync, gzipSync } from 'fflate';
import postgres from 'postgres';
import type { AnalysisResult } from '@/lib/core/types';
import { type AnalysisStore, type StoredAnalysisSummary, sourceKey, summarize } from './types';

/**
 * PostgreSQL-backed analysis store (Supabase compatible).
 *
 * Results are gzipped before insertion — an analysis of a large repository is
 * several megabytes of JSON, and compressing it keeps rows well inside normal
 * TOAST limits and cuts round-trip time by roughly an order of magnitude.
 *
 * The schema is created on first use, so deploying needs no separate migration
 * step. `IF NOT EXISTS` everywhere makes `init()` safe to call concurrently.
 */
export class PostgresAnalysisStore implements AnalysisStore {
  readonly kind = 'postgres' as const;
  private readonly sql: postgres.Sql;
  private ready?: Promise<void>;

  constructor(connectionString: string) {
    this.sql = postgres(connectionString, {
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      onnotice: () => {},
    });
  }

  init(): Promise<void> {
    this.ready ??= this.createSchema();
    return this.ready;
  }

  private async createSchema(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS devgraph_analyses (
        id            TEXT PRIMARY KEY,
        owner_id      TEXT,
        source_key    TEXT NOT NULL,
        repo_name     TEXT NOT NULL,
        source_kind   TEXT NOT NULL,
        source_label  TEXT NOT NULL,
        file_count    INTEGER NOT NULL DEFAULT 0,
        line_count    INTEGER NOT NULL DEFAULT 0,
        languages     TEXT[] NOT NULL DEFAULT '{}',
        payload       BYTEA NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS devgraph_analyses_owner_created_idx
        ON devgraph_analyses (owner_id, created_at DESC)
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS devgraph_analyses_source_idx
        ON devgraph_analyses (source_key, owner_id)
    `;
  }

  async save(result: AnalysisResult, ownerId?: string): Promise<void> {
    await this.init();
    const payload = gzipSync(new TextEncoder().encode(JSON.stringify(result)));

    await this.sql`
      INSERT INTO devgraph_analyses (
        id, owner_id, source_key, repo_name, source_kind, source_label,
        file_count, line_count, languages, payload, created_at
      ) VALUES (
        ${result.id},
        ${ownerId ?? null},
        ${sourceKey(result.source)},
        ${result.repo.name},
        ${result.source.kind},
        ${result.source.label},
        ${result.metrics.totals.files},
        ${result.metrics.totals.lines},
        ${this.sql.array(result.stack.languages.slice(0, 4).map((l) => l.language))},
        ${Buffer.from(payload)},
        ${result.createdAt}
      )
      ON CONFLICT (id) DO UPDATE SET
        payload = EXCLUDED.payload,
        repo_name = EXCLUDED.repo_name,
        file_count = EXCLUDED.file_count,
        line_count = EXCLUDED.line_count,
        languages = EXCLUDED.languages,
        created_at = EXCLUDED.created_at
    `;
  }

  async get(id: string, ownerId?: string): Promise<AnalysisResult | undefined> {
    await this.init();
    const rows = await this.sql<{ payload: Buffer; owner_id: string | null }[]>`
      SELECT payload, owner_id FROM devgraph_analyses WHERE id = ${id} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    if (row.owner_id && row.owner_id !== ownerId) return undefined;
    return decode(row.payload);
  }

  async list(ownerId?: string, limit = 25): Promise<StoredAnalysisSummary[]> {
    await this.init();
    const rows = await this.sql<
      {
        id: string;
        created_at: Date;
        source_kind: string;
        source_label: string;
        repo_name: string;
        file_count: number;
        line_count: number;
        languages: string[];
        owner_id: string | null;
      }[]
    >`
      SELECT id, created_at, source_kind, source_label, repo_name,
             file_count, line_count, languages, owner_id
      FROM devgraph_analyses
      WHERE owner_id IS NULL OR owner_id = ${ownerId ?? null}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      source: {
        kind: row.source_kind as StoredAnalysisSummary['source']['kind'],
        label: row.source_label,
      },
      repoName: row.repo_name,
      files: row.file_count,
      lines: row.line_count,
      languages: row.languages,
      ownerId: row.owner_id ?? undefined,
    }));
  }

  async delete(id: string, ownerId?: string): Promise<boolean> {
    await this.init();
    const rows = await this.sql`
      DELETE FROM devgraph_analyses
      WHERE id = ${id} AND (owner_id IS NULL OR owner_id = ${ownerId ?? null})
      RETURNING id
    `;
    return rows.length > 0;
  }

  async findBySource(key: string, ownerId?: string): Promise<AnalysisResult | undefined> {
    await this.init();
    const rows = await this.sql<{ payload: Buffer }[]>`
      SELECT payload FROM devgraph_analyses
      WHERE source_key = ${key}
        AND (owner_id IS NULL OR owner_id = ${ownerId ?? null})
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0] ? decode(rows[0].payload) : undefined;
  }
}

function decode(payload: Buffer): AnalysisResult {
  const json = new TextDecoder().decode(gunzipSync(new Uint8Array(payload)));
  return JSON.parse(json) as AnalysisResult;
}

/** Re-exported so callers can build summaries without importing `types` too. */
export { summarize };
