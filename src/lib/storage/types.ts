import type { AnalysisResult, RepoSource } from '@/lib/core/types';

export interface StoredAnalysisSummary {
  id: string;
  createdAt: string;
  source: RepoSource;
  repoName: string;
  files: number;
  lines: number;
  languages: string[];
  ownerId?: string;
}

export interface AnalysisStore {
  readonly kind: 'memory' | 'postgres';
  init(): Promise<void>;
  save(result: AnalysisResult, ownerId?: string): Promise<void>;
  get(id: string, ownerId?: string): Promise<AnalysisResult | undefined>;
  list(ownerId?: string, limit?: number): Promise<StoredAnalysisSummary[]>;
  delete(id: string, ownerId?: string): Promise<boolean>;
  /** Best-effort cache lookup keyed by source identity. */
  findBySource(key: string, ownerId?: string): Promise<AnalysisResult | undefined>;
}

/** Stable cache key for a repository source. */
export function sourceKey(source: RepoSource): string {
  return [source.kind, source.label, source.ref ?? '', source.commit ?? ''].join('|');
}

export function summarize(result: AnalysisResult, ownerId?: string): StoredAnalysisSummary {
  return {
    id: result.id,
    createdAt: result.createdAt,
    source: result.source,
    repoName: result.repo.name,
    files: result.metrics.totals.files,
    lines: result.metrics.totals.lines,
    languages: result.stack.languages.slice(0, 4).map((l) => l.language),
    ownerId,
  };
}
