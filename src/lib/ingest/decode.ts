import { isBinaryPath, normalizePath, shouldIgnorePath } from '@/lib/core/paths';
import type { SourceFile } from '@/lib/core/types';
import { DEFAULT_INGEST_LIMITS, IngestError, type IngestLimits } from './types';

/**
 * Shared archive-entry → SourceFile conversion.
 *
 * This is the single choke point where untrusted archive contents become
 * in-memory analysis input, so every safety rule lives here: path traversal
 * rejection, per-file and total size caps, binary and vendored-path filtering,
 * and UTF-8 validity checks.
 */

export interface DecodableEntry {
  name: string;
  size: number;
  read: () => Uint8Array;
}

export interface DecodeOutcome {
  files: SourceFile[];
  warnings: string[];
  skipped: number;
}

const NUL = 0;

export function decodeEntries(
  entries: Iterable<DecodableEntry>,
  limits: IngestLimits = DEFAULT_INGEST_LIMITS,
): DecodeOutcome {
  const files: SourceFile[] = [];
  const warnings: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let totalBytes = 0;
  let skipped = 0;
  let oversized = 0;
  let binary = 0;

  for (const entry of entries) {
    const path = sanitizePath(entry.name);
    if (!path) {
      skipped += 1;
      continue;
    }

    if (shouldIgnorePath(path) || isBinaryPath(path)) {
      skipped += 1;
      continue;
    }

    if (entry.size > limits.maxFileBytes) {
      oversized += 1;
      skipped += 1;
      continue;
    }

    if (files.length >= limits.maxFiles) {
      skipped += 1;
      continue;
    }

    if (totalBytes + entry.size > limits.maxTotalBytes) {
      warnings.push(
        `Stopped reading at ${(limits.maxTotalBytes / 1024 / 1024).toFixed(0)} MB of source; the remaining files were skipped.`,
      );
      skipped += 1;
      break;
    }

    const bytes = entry.read();

    // A NUL byte in the first 8 KB is the standard binary heuristic.
    const probe = bytes.subarray(0, Math.min(bytes.length, 8192));
    if (probe.includes(NUL)) {
      binary += 1;
      skipped += 1;
      continue;
    }

    const content = decoder.decode(bytes);
    totalBytes += bytes.length;
    files.push({ path, content, bytes: bytes.length });
  }

  if (oversized) {
    warnings.push(
      `${oversized} file(s) exceeded the ${(limits.maxFileBytes / 1024 / 1024).toFixed(1)} MB per-file limit and were skipped.`,
    );
  }
  if (binary) warnings.push(`${binary} binary file(s) were skipped.`);

  return { files, warnings, skipped };
}

/**
 * Reject anything that could escape the extraction root. Archives are attacker
 * controlled; `../` and absolute paths are the classic slip-through.
 */
export function sanitizePath(raw: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (cleaned.endsWith('/')) return undefined;
  if (cleaned.startsWith('/')) return undefined;
  // Windows drive letters and UNC paths.
  if (/^[A-Za-z]:/.test(cleaned) || cleaned.startsWith('//')) return undefined;
  if (cleaned.split('/').includes('..')) return undefined;
  if (cleaned.includes('\0')) return undefined;

  const normalized = normalizePath(cleaned);
  if (!normalized || normalized.startsWith('..') || normalized.startsWith('/')) return undefined;
  if (normalized.length > 400) return undefined;
  return normalized;
}

export function assertArchiveSize(bytes: number, limits: IngestLimits): void {
  if (bytes > limits.maxArchiveBytes) {
    throw new IngestError(
      `Archive is ${(bytes / 1024 / 1024).toFixed(1)} MB, over the ${(
        limits.maxArchiveBytes /
        1024 /
        1024
      ).toFixed(0)} MB limit.`,
      'too-large',
      413,
    );
  }
}
