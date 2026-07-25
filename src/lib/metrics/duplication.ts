import type { DuplicateBlock, DuplicationReport } from '@/lib/core/types';

/**
 * Duplicate-code detection.
 *
 * Strategy: normalise each line (collapse whitespace, mask string and numeric
 * literals) and hash sliding windows of `windowLines` consecutive significant
 * lines. Windows that hash identically across two or more locations are clone
 * candidates; adjacent candidates are merged into maximal blocks.
 *
 * This is a line-window detector rather than a full suffix-automaton token
 * detector: it is O(lines) in time and memory, gives line-accurate ranges the
 * UI can link to, and is accurate enough to answer "where is this repo
 * repeating itself". It deliberately reports *indicators*, not proofs.
 */

export interface DuplicationOptions {
  /** Consecutive significant lines that constitute a clone. */
  windowLines: number;
  /** Skip files longer than this — usually generated blobs. */
  maxFileLines: number;
  /** Cap on reported clone groups. */
  maxClones: number;
  /** Minimum characters in a normalised line for it to count. */
  minLineLength: number;
}

export const DEFAULT_DUPLICATION_OPTIONS: DuplicationOptions = {
  // Five significant lines matches the conventional `min-lines` default used by
  // established clone detectors, and the trivial-line filter keeps it honest.
  windowLines: 5,
  maxFileLines: 5000,
  maxClones: 60,
  minLineLength: 12,
};

export interface DuplicationInput {
  path: string;
  /** Masked source (comments already removed). */
  code: string;
}

interface WindowEntry {
  path: string;
  startLine: number;
  endLine: number;
}

const STRING_LITERAL = /(["'`])(?:\\.|(?!\1).)*\1/g;
const NUMBER_LITERAL = /\b\d+(\.\d+)?\b/g;
const WHITESPACE = /\s+/g;

/** Lines that are pure syntax noise and would create false clones everywhere. */
const TRIVIAL = new Set([
  '}',
  '{',
  '})',
  '});',
  '};',
  ')',
  ');',
  ']',
  '],',
  '},',
  'end',
  'else',
  'else{',
  '}else{',
  'return',
  'break',
  'continue',
  'pass',
  'fi',
  'done',
]);

export function normalizeLine(line: string): string {
  return line
    .replace(STRING_LITERAL, '"S"')
    .replace(NUMBER_LITERAL, 'N')
    .replace(WHITESPACE, '')
    .trim();
}

export function detectDuplication(
  inputs: DuplicationInput[],
  totalCodeLines: number,
  options: Partial<DuplicationOptions> = {},
): DuplicationReport {
  const config = { ...DEFAULT_DUPLICATION_OPTIONS, ...options };
  const windows = new Map<string, WindowEntry[]>();

  for (const input of inputs) {
    const rawLines = input.code.split('\n');
    if (rawLines.length > config.maxFileLines) continue;

    // Keep the original line numbers alongside the normalised text.
    const significant: { text: string; line: number }[] = [];
    for (let i = 0; i < rawLines.length; i += 1) {
      const normalized = normalizeLine(rawLines[i]);
      if (!normalized || normalized.length < config.minLineLength) continue;
      if (TRIVIAL.has(normalized)) continue;
      significant.push({ text: normalized, line: i + 1 });
    }

    for (let i = 0; i + config.windowLines <= significant.length; i += 1) {
      const slice = significant.slice(i, i + config.windowLines);
      const key = hashWindow(slice.map((s) => s.text));
      const entry: WindowEntry = {
        path: input.path,
        startLine: slice[0].line,
        endLine: slice[slice.length - 1].line,
      };
      const bucket = windows.get(key);
      if (bucket) bucket.push(entry);
      else windows.set(key, [entry]);
    }
  }

  const groups: WindowEntry[][] = [];
  for (const bucket of windows.values()) {
    if (bucket.length < 2) continue;
    // Ignore windows repeated inside a single file at overlapping offsets.
    const distinct = dedupeOverlapping(bucket);
    if (distinct.length >= 2) groups.push(distinct);
  }

  const merged = mergeAdjacent(groups);
  const clones: DuplicateBlock[] = merged
    .map((group) => ({
      lines: Math.max(...group.map((g) => g.endLine - g.startLine + 1)),
      tokens: 0,
      occurrences: group
        .map((g) => ({ path: g.path, startLine: g.startLine, endLine: g.endLine }))
        .sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine),
    }))
    .sort((a, b) => b.lines * b.occurrences.length - a.lines * a.occurrences.length)
    .slice(0, config.maxClones);

  // Count each duplicated line once per file so the ratio cannot exceed 1.
  const duplicatedLines = new Set<string>();
  for (const clone of clones) {
    for (const occurrence of clone.occurrences) {
      for (let line = occurrence.startLine; line <= occurrence.endLine; line += 1) {
        duplicatedLines.add(`${occurrence.path}:${line}`);
      }
    }
  }

  return {
    ratio: totalCodeLines > 0 ? Number((duplicatedLines.size / totalCodeLines).toFixed(4)) : 0,
    totalDuplicatedLines: duplicatedLines.size,
    clones,
  };
}

/** FNV-1a over the joined window — fast, well distributed, no dependencies. */
function hashWindow(lines: string[]): string {
  const text = lines.join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Include the length to make accidental collisions vanishingly unlikely.
  return `${hash.toString(36)}:${text.length}`;
}

function dedupeOverlapping(entries: WindowEntry[]): WindowEntry[] {
  const byPath = new Map<string, WindowEntry[]>();
  for (const entry of entries) {
    const bucket = byPath.get(entry.path) ?? [];
    if (!bucket.some((existing) => rangesOverlap(existing, entry))) bucket.push(entry);
    byPath.set(entry.path, bucket);
  }
  return [...byPath.values()].flat();
}

function rangesOverlap(a: WindowEntry, b: WindowEntry): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Merge clone groups whose occurrences all sit adjacent to another group's, so
 * a 30-line duplicate is reported once rather than as 25 overlapping windows.
 */
function mergeAdjacent(groups: WindowEntry[][]): WindowEntry[][] {
  const sorted = groups
    .map((group) => [...group].sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine))
    .sort((a, b) => signature(a).localeCompare(signature(b)));

  const merged: WindowEntry[][] = [];
  for (const group of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && canMerge(previous, group)) {
      for (let i = 0; i < previous.length; i += 1) {
        previous[i].endLine = Math.max(previous[i].endLine, group[i].endLine);
        previous[i].startLine = Math.min(previous[i].startLine, group[i].startLine);
      }
      continue;
    }
    merged.push(group);
  }
  return merged;
}

function signature(group: WindowEntry[]): string {
  return group.map((g) => `${g.path}:${String(g.startLine).padStart(7, '0')}`).join('|');
}

function canMerge(a: WindowEntry[], b: WindowEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].path !== b[i].path) return false;
    // Contiguous or overlapping windows in every occurrence.
    if (b[i].startLine > a[i].endLine + 1) return false;
    if (b[i].startLine < a[i].startLine) return false;
  }
  return true;
}
