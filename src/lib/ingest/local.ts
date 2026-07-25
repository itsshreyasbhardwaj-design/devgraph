import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { RepoSource } from '@/lib/core/types';
import { IGNORED_DIRECTORIES, isBinaryPath, shouldIgnorePath } from '@/lib/core/paths';
import { DEFAULT_INGEST_LIMITS, IngestError, type IngestLimits, type IngestResult } from './types';

/**
 * Local directory ingestion.
 *
 * Reading arbitrary paths off the host is only safe when the operator has opted
 * in, so this is gated behind `DEVGRAPH_ALLOW_LOCAL=true` and an optional
 * `DEVGRAPH_LOCAL_ROOT` allow-list. Both checks happen here rather than at the
 * route so the guarantee cannot be bypassed by a different caller.
 */

export interface LocalIngestOptions {
  path: string;
  limits?: IngestLimits;
  /** Roots the path must live inside. Empty means "any", which is opt-in only. */
  allowedRoots?: string[];
  enabled: boolean;
}

export async function ingestLocal(options: LocalIngestOptions): Promise<IngestResult> {
  if (!options.enabled) {
    throw new IngestError(
      'Local directory analysis is disabled. Set DEVGRAPH_ALLOW_LOCAL=true to enable it.',
      'forbidden',
      403,
    );
  }

  const limits = options.limits ?? DEFAULT_INGEST_LIMITS;
  const target = resolve(options.path);

  if (!isAbsolute(target)) {
    throw new IngestError('Provide an absolute directory path.', 'invalid-input');
  }

  const roots = (options.allowedRoots ?? []).filter(Boolean).map((root) => resolve(root));
  if (roots.length && !roots.some((root) => target === root || target.startsWith(root + sep))) {
    throw new IngestError('That path is outside the allowed roots.', 'forbidden', 403);
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    throw new IngestError(`No such directory: ${options.path}`, 'not-found', 404);
  }
  if (!info.isDirectory()) {
    throw new IngestError('That path is not a directory.', 'invalid-input');
  }

  const files: IngestResult['files'] = [];
  const warnings: string[] = [];
  let totalBytes = 0;
  let skipped = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 24 || files.length >= limits.maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= limits.maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await walk(join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;

      const absolute = join(dir, entry.name);
      const relativePath = relative(target, absolute).split(sep).join('/');
      if (shouldIgnorePath(relativePath) || isBinaryPath(relativePath)) {
        skipped += 1;
        continue;
      }

      let fileInfo;
      try {
        fileInfo = await stat(absolute);
      } catch {
        continue;
      }
      if (
        fileInfo.size > limits.maxFileBytes ||
        totalBytes + fileInfo.size > limits.maxTotalBytes
      ) {
        skipped += 1;
        continue;
      }

      try {
        const buffer = await readFile(absolute);
        if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
          skipped += 1;
          continue;
        }
        totalBytes += buffer.byteLength;
        files.push({
          path: relativePath,
          content: buffer.toString('utf8'),
          bytes: buffer.byteLength,
        });
      } catch {
        skipped += 1;
      }
    }
  };

  await walk(target, 0);

  if (!files.length) {
    throw new IngestError(
      'No analysable source files were found in that directory.',
      'unsupported',
      422,
    );
  }
  if (skipped) warnings.push(`${skipped} file(s) were skipped (binary, oversized or unreadable).`);

  const name = target.split(sep).filter(Boolean).pop() ?? 'local-repository';
  const source: RepoSource = { kind: 'local', label: name, url: target };

  return { source, files, repo: { name }, warnings };
}
