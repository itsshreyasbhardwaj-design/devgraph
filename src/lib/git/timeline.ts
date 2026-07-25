import type {
  CommitRecord,
  TimelineDiff,
  TimelineReport,
  TimelineSnapshot,
} from '@/lib/core/types';
import { isBinaryPath, moduleKeyFor, shouldIgnorePath } from '@/lib/core/paths';
import type { ParsedRepoRef } from '@/lib/ingest/github';
import { fetchCommits } from '@/lib/ingest/github';

/**
 * Architecture timeline.
 *
 * Reconstructing full history would mean downloading one archive per commit.
 * Instead DevGraph samples commits evenly across the available history and
 * fetches only the *file tree* at each sample — one cheap API call per point.
 * That is enough to chart module growth, file churn and dependency events
 * without paying for a full re-analysis per commit.
 *
 * Timeline is loaded on demand rather than during analysis, so a repository
 * with no history (or a rate-limited token) never blocks the main result.
 */

export interface TimelineOptions {
  /** How many history points to sample. */
  samples: number;
  /** Commits to consider. */
  commitLimit: number;
  signal?: AbortSignal;
}

export const DEFAULT_TIMELINE_OPTIONS: TimelineOptions = {
  samples: 12,
  commitLimit: 100,
};

interface TreeResponse {
  tree: { path: string; type: string; size?: number }[];
  truncated: boolean;
}

async function fetchTree(
  ref: ParsedRepoRef,
  sha: string,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<TreeResponse | undefined> {
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${sha}?recursive=1`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'devgraph-analyzer',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const response = await fetch(url, { headers, signal, cache: 'no-store' });
    if (!response.ok) return undefined;
    return (await response.json()) as TreeResponse;
  } catch {
    return undefined;
  }
}

async function fetchFileAt(
  ref: ParsedRepoRef,
  sha: string,
  path: string,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${sha}/${path}`;
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
      cache: 'no-store',
    });
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

function dependenciesFrom(packageJson: string | undefined): string[] {
  if (!packageJson) return [];
  try {
    const json = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return [
      ...Object.keys(json.dependencies ?? {}),
      ...Object.keys(json.devDependencies ?? {}),
    ].sort();
  } catch {
    return [];
  }
}

/** Pick `count` commits spread evenly across the list, always keeping the ends. */
export function sampleCommits(commits: CommitRecord[], count: number): CommitRecord[] {
  if (commits.length <= count) return [...commits].reverse();
  const step = (commits.length - 1) / (count - 1);
  const picked: CommitRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    picked.push(commits[Math.round(i * step)]);
  }
  // GitHub returns newest first; charts read better oldest → newest.
  return picked.reverse();
}

export async function buildGitHubTimeline(
  ref: ParsedRepoRef,
  branch: string,
  token: string | undefined,
  options: Partial<TimelineOptions> = {},
): Promise<TimelineReport> {
  const config = { ...DEFAULT_TIMELINE_OPTIONS, ...options };
  const commits = await fetchCommits(ref, branch, token, config.commitLimit, config.signal);

  if (!commits.length) {
    return {
      available: false,
      reason: 'No commit history was returned for this repository.',
      commits: [],
      snapshots: [],
      moduleGrowth: [],
      dependencyEvents: [],
    };
  }

  const sampled = sampleCommits(commits, config.samples);
  const snapshots: TimelineSnapshot[] = [];

  for (const commit of sampled) {
    const tree = await fetchTree(ref, commit.sha, token, config.signal);
    if (!tree) continue;

    const paths = tree.tree
      .filter((entry) => entry.type === 'blob')
      .map((entry) => entry.path)
      .filter((path) => !shouldIgnorePath(path) && !isBinaryPath(path));

    const modules: Record<string, number> = {};
    for (const path of paths) {
      const key = moduleKeyFor(path);
      modules[key] = (modules[key] ?? 0) + 1;
    }

    const packageJson = await fetchFileAt(ref, commit.sha, 'package.json', token, config.signal);

    snapshots.push({
      sha: commit.sha,
      date: commit.date,
      files: paths.length,
      // Tree entries carry byte sizes, not line counts; approximate at ~35 B/line.
      lines: Math.round(
        tree.tree
          .filter((entry) => entry.type === 'blob' && entry.size)
          .reduce((sum, entry) => sum + (entry.size ?? 0), 0) / 35,
      ),
      modules,
      dependencies: dependenciesFrom(packageJson),
    });
  }

  if (!snapshots.length) {
    return {
      available: false,
      reason: 'Commit trees could not be fetched — GitHub may be rate limiting this instance.',
      commits,
      snapshots: [],
      moduleGrowth: [],
      dependencyEvents: [],
    };
  }

  return {
    available: true,
    commits,
    snapshots,
    moduleGrowth: buildModuleGrowth(snapshots),
    dependencyEvents: buildDependencyEvents(snapshots),
  };
}

export function buildModuleGrowth(snapshots: TimelineSnapshot[]): TimelineReport['moduleGrowth'] {
  const allModules = new Set<string>();
  for (const snapshot of snapshots) {
    for (const key of Object.keys(snapshot.modules)) allModules.add(key);
  }

  // Chart the modules that are largest at the end of history.
  const latest = snapshots[snapshots.length - 1];
  const ranked = [...allModules]
    .sort((a, b) => (latest.modules[b] ?? 0) - (latest.modules[a] ?? 0))
    .slice(0, 12);

  return ranked.map((module) => ({
    module,
    series: snapshots.map((snapshot) => ({
      date: snapshot.date,
      value: snapshot.modules[module] ?? 0,
    })),
  }));
}

export function buildDependencyEvents(
  snapshots: TimelineSnapshot[],
): TimelineReport['dependencyEvents'] {
  const events: TimelineReport['dependencyEvents'] = [];

  for (let i = 1; i < snapshots.length; i += 1) {
    const before = new Set(snapshots[i - 1].dependencies);
    const after = new Set(snapshots[i].dependencies);
    const added = [...after].filter((name) => !before.has(name));
    const removed = [...before].filter((name) => !after.has(name));
    if (!added.length && !removed.length) continue;
    events.push({ date: snapshots[i].date, sha: snapshots[i].sha, added, removed });
  }

  return events;
}

/** Compare two snapshots into a reviewable diff. */
export function diffSnapshots(a: TimelineSnapshot, b: TimelineSnapshot): TimelineDiff {
  const beforeModules = a.modules;
  const afterModules = b.modules;
  const modules = new Set([...Object.keys(beforeModules), ...Object.keys(afterModules)]);

  const beforeDeps = new Set(a.dependencies);
  const afterDeps = new Set(b.dependencies);

  return {
    from: a.sha,
    to: b.sha,
    // Tree sampling gives module-level resolution, not per-file diffs; the
    // module delta below is the meaningful signal.
    addedFiles: [],
    removedFiles: [],
    modifiedFiles: [],
    addedDependencies: [...afterDeps].filter((name) => !beforeDeps.has(name)),
    removedDependencies: [...beforeDeps].filter((name) => !afterDeps.has(name)),
    moduleDelta: [...modules]
      .map((module) => {
        const before = beforeModules[module] ?? 0;
        const after = afterModules[module] ?? 0;
        return { module, before, after, delta: after - before };
      })
      .filter((entry) => entry.delta !== 0)
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)),
  };
}
