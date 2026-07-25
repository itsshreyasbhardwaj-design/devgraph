import type { RepoSource, RepoSummary, SourceFile } from '@/lib/core/types';

export interface IngestLimits {
  /** Bytes of the downloaded/uploaded archive. */
  maxArchiveBytes: number;
  /** Bytes of any single file kept for analysis. */
  maxFileBytes: number;
  /** Total decoded bytes across kept files — guards against zip bombs. */
  maxTotalBytes: number;
  /** Files kept. */
  maxFiles: number;
}

export const DEFAULT_INGEST_LIMITS: IngestLimits = {
  maxArchiveBytes: 120 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFiles: 20_000,
};

export interface IngestResult {
  source: RepoSource;
  files: SourceFile[];
  repo: Partial<RepoSummary>;
  warnings: string[];
}

export class IngestError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid-input'
      | 'not-found'
      | 'too-large'
      | 'rate-limited'
      | 'unsupported'
      | 'network'
      | 'forbidden',
    readonly status = 400,
  ) {
    super(message);
    this.name = 'IngestError';
  }
}
