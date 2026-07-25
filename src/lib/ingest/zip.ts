import { unzipSync } from 'fflate';
import type { RepoSource } from '@/lib/core/types';
import { assertArchiveSize, decodeEntries } from './decode';
import { DEFAULT_INGEST_LIMITS, IngestError, type IngestLimits, type IngestResult } from './types';

/**
 * ZIP upload ingestion.
 *
 * The archive is validated before decompression (magic bytes, declared size),
 * and every entry path is sanitised in `decodeEntries` so a crafted archive
 * cannot write or read outside the logical root.
 */

const ZIP_MAGIC = [0x50, 0x4b]; // "PK"

export interface ZipIngestOptions {
  data: Uint8Array;
  filename: string;
  limits?: IngestLimits;
}

export function ingestZip(options: ZipIngestOptions): IngestResult {
  const limits = options.limits ?? DEFAULT_INGEST_LIMITS;
  const { data, filename } = options;

  if (data.byteLength < 22) {
    throw new IngestError('That file is too small to be a ZIP archive.', 'invalid-input');
  }
  if (data[0] !== ZIP_MAGIC[0] || data[1] !== ZIP_MAGIC[1]) {
    throw new IngestError('That file is not a ZIP archive.', 'invalid-input');
  }
  assertArchiveSize(data.byteLength, limits);

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(data, {
      filter: (file) => !file.name.endsWith('/') && file.originalSize <= limits.maxFileBytes,
    });
  } catch (error) {
    throw new IngestError(
      `Could not read the archive: ${error instanceof Error ? error.message : 'unknown error'}`,
      'invalid-input',
    );
  }

  const names = Object.keys(unzipped);
  if (!names.length) {
    throw new IngestError('The archive is empty.', 'unsupported', 422);
  }

  // Archives exported from GitHub/GitLab wrap everything in one directory.
  const root = commonRoot(names);
  const entries = names.map((name) => ({
    name: root ? name.slice(root.length + 1) : name,
    size: unzipped[name].byteLength,
    read: () => unzipped[name],
  }));

  const { files, warnings } = decodeEntries(entries, limits);
  if (!files.length) {
    throw new IngestError('The archive contained no analysable source files.', 'unsupported', 422);
  }

  const label = filename.replace(/\.zip$/i, '') || 'uploaded-archive';
  const source: RepoSource = { kind: 'zip', label };

  return { source, files, repo: { name: label }, warnings };
}

function commonRoot(names: string[]): string | undefined {
  const first = names[0]?.split('/')[0];
  if (!first) return undefined;
  const allShare = names.every((name) => name.startsWith(`${first}/`));
  return allShare ? first : undefined;
}

export function validateUpload(
  file: { size: number; name: string; type: string },
  limits: IngestLimits = DEFAULT_INGEST_LIMITS,
): void {
  if (file.size > limits.maxArchiveBytes) {
    throw new IngestError(
      `Upload is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the ${(
        limits.maxArchiveBytes /
        1024 /
        1024
      ).toFixed(0)} MB limit.`,
      'too-large',
      413,
    );
  }
  if (file.size === 0) {
    throw new IngestError('The uploaded file is empty.', 'invalid-input');
  }
  const looksZip =
    /\.zip$/i.test(file.name) ||
    file.type === 'application/zip' ||
    file.type === 'application/x-zip-compressed';
  if (!looksZip) {
    throw new IngestError('Only .zip archives are supported.', 'unsupported', 415);
  }
}
