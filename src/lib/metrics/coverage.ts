import type { CoverageReport, SourceFile } from '@/lib/core/types';
import { normalizePath } from '@/lib/core/paths';

/**
 * Test-coverage ingestion.
 *
 * Coverage is opportunistic: if the repository happens to contain a coverage
 * report, DevGraph reads it. Nothing is ever executed. Supported formats:
 * LCOV, Istanbul JSON, Cobertura XML, and Go coverage profiles.
 */

const COVERAGE_FILE_PATTERNS = [
  /(^|\/)lcov\.info$/i,
  /(^|\/)coverage-final\.json$/i,
  /(^|\/)coverage\.json$/i,
  /(^|\/)(cobertura-)?coverage\.xml$/i,
  /(^|\/)clover\.xml$/i,
  /(^|\/)coverage\.out$/i,
  /(^|\/)coverage\.txt$/i,
];

export function isCoverageFile(path: string): boolean {
  return COVERAGE_FILE_PATTERNS.some((pattern) => pattern.test(path));
}

export function parseCoverage(files: SourceFile[], repoPaths: Set<string>): CoverageReport | undefined {
  for (const file of files) {
    if (!isCoverageFile(file.path)) continue;
    try {
      const parsed = parseOne(file);
      if (!parsed) continue;
      const mapped = remapPaths(parsed.files, repoPaths);
      if (!mapped.length) continue;
      const total = mapped.reduce((sum, f) => sum + f.total, 0);
      const covered = mapped.reduce((sum, f) => sum + f.covered, 0);
      return {
        source: `${parsed.format} (${file.path})`,
        overall: total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 0,
        files: mapped.sort((a, b) => a.coverage - b.coverage),
      };
    } catch {
      // Try the next candidate rather than failing the analysis.
    }
  }
  return undefined;
}

interface RawEntry {
  path: string;
  covered: number;
  total: number;
}

function parseOne(file: SourceFile): { format: string; files: RawEntry[] } | undefined {
  const base = file.path.toLowerCase();
  if (base.endsWith('lcov.info')) return { format: 'LCOV', files: parseLcov(file.content) };
  if (base.endsWith('.json')) return { format: 'Istanbul', files: parseIstanbul(file.content) };
  if (base.endsWith('.xml')) return { format: 'Cobertura', files: parseCobertura(file.content) };
  if (base.endsWith('coverage.out') || base.endsWith('coverage.txt')) {
    return { format: 'Go coverage', files: parseGoProfile(file.content) };
  }
  return undefined;
}

function parseLcov(content: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let path = '';
  let covered = 0;
  let total = 0;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      path = line.slice(3);
      covered = 0;
      total = 0;
    } else if (line.startsWith('DA:')) {
      const [, hits] = line.slice(3).split(',');
      total += 1;
      if (Number(hits) > 0) covered += 1;
    } else if (line.startsWith('LH:')) {
      covered = Number(line.slice(3)) || covered;
    } else if (line.startsWith('LF:')) {
      total = Number(line.slice(3)) || total;
    } else if (line === 'end_of_record' && path) {
      entries.push({ path, covered, total });
      path = '';
    }
  }
  return entries;
}

interface IstanbulFile {
  path?: string;
  s?: Record<string, number>;
  statementMap?: Record<string, unknown>;
}

function parseIstanbul(content: string): RawEntry[] {
  const json = JSON.parse(content) as Record<string, IstanbulFile>;
  const entries: RawEntry[] = [];
  for (const [key, value] of Object.entries(json)) {
    if (!value || typeof value !== 'object' || !value.s) continue;
    const counts = Object.values(value.s);
    entries.push({
      path: value.path ?? key,
      covered: counts.filter((count) => count > 0).length,
      total: counts.length,
    });
  }
  return entries;
}

function parseCobertura(content: string): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const match of content.matchAll(/<class\b[^>]*filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
    const lines = [...match[2].matchAll(/<line\b[^>]*hits="(\d+)"/g)];
    if (!lines.length) continue;
    entries.push({
      path: match[1],
      covered: lines.filter((line) => Number(line[1]) > 0).length,
      total: lines.length,
    });
  }
  return entries;
}

function parseGoProfile(content: string): RawEntry[] {
  const totals = new Map<string, { covered: number; total: number }>();
  for (const raw of content.split('\n')) {
    const match = /^(.+?):(\d+)\.\d+,(\d+)\.\d+\s+(\d+)\s+(\d+)$/.exec(raw.trim());
    if (!match) continue;
    const path = match[1];
    const statements = Number(match[4]);
    const count = Number(match[5]);
    const entry = totals.get(path) ?? { covered: 0, total: 0 };
    entry.total += statements;
    if (count > 0) entry.covered += statements;
    totals.set(path, entry);
  }
  return [...totals.entries()].map(([path, entry]) => ({ path, ...entry }));
}

/**
 * Coverage tools emit absolute or tool-relative paths. Match each entry to a
 * repo file by longest common suffix so `/builds/ci/src/a.ts` finds `src/a.ts`.
 */
function remapPaths(
  entries: RawEntry[],
  repoPaths: Set<string>,
): CoverageReport['files'] {
  const bySuffix = new Map<string, string[]>();
  for (const path of repoPaths) {
    const segments = path.split('/');
    for (let i = 0; i < segments.length; i += 1) {
      const suffix = segments.slice(i).join('/');
      const bucket = bySuffix.get(suffix);
      if (bucket) bucket.push(path);
      else bySuffix.set(suffix, [path]);
    }
  }

  const results: CoverageReport['files'] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry.total === 0) continue;
    const normalized = normalizePath(entry.path.replace(/^\.\//, ''));
    const segments = normalized.split('/');
    let resolved: string | undefined;
    for (let i = 0; i < segments.length && !resolved; i += 1) {
      const suffix = segments.slice(i).join('/');
      const candidates = bySuffix.get(suffix);
      if (candidates?.length === 1) resolved = candidates[0];
    }
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    results.push({
      path: resolved,
      coverage: Number(((entry.covered / entry.total) * 100).toFixed(2)),
      covered: entry.covered,
      total: entry.total,
    });
  }

  return results;
}
