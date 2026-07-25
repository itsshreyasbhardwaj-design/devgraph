import { gunzipSync } from 'fflate';
import type { CommitRecord, RepoSource, RepoSummary } from '@/lib/core/types';
import { assertArchiveSize, decodeEntries } from './decode';
import { readTar, stripRootDirectory } from './tar';
import { DEFAULT_INGEST_LIMITS, IngestError, type IngestLimits, type IngestResult } from './types';

/**
 * GitHub ingestion.
 *
 * Public repositories only, fetched as a gzipped tarball from codeload. A
 * `GITHUB_TOKEN` is optional and used purely to raise the anonymous rate limit
 * — DevGraph never requests write scopes and never reads private repositories
 * unless the operator explicitly supplies a token that can.
 */

export interface ParsedRepoRef {
  owner: string;
  repo: string;
  ref?: string;
}

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const REF_PATTERN = /^[A-Za-z0-9._\/-]{1,255}$/;

/**
 * Accepts `owner/repo`, a full GitHub URL, an SSH remote, or any of those with
 * a `/tree/<ref>` suffix. Rejects everything else — this string reaches an
 * outbound fetch, so it is validated strictly rather than escaped.
 */
export function parseRepoInput(input: string): ParsedRepoRef {
  const trimmed = input.trim();
  if (!trimmed) throw new IngestError('Enter a GitHub repository.', 'invalid-input');

  let owner: string | undefined;
  let repo: string | undefined;
  let ref: string | undefined;

  const sshMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(trimmed);
  const urlMatch = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+)(?:\/(?:tree|commit|blob)\/([^\s?#]+))?/.exec(
    trimmed,
  );
  const shorthandMatch = /^([^/\s]+)\/([^/\s@#]+)(?:[@#]([^\s]+))?$/.exec(trimmed);

  if (sshMatch) {
    [, owner, repo] = sshMatch;
  } else if (urlMatch) {
    [, owner, repo, ref] = urlMatch;
  } else if (shorthandMatch) {
    [, owner, repo, ref] = shorthandMatch;
  }

  repo = repo?.replace(/\.git$/, '');

  if (!owner || !repo || !OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) {
    throw new IngestError(
      'That does not look like a GitHub repository. Use `owner/repo` or a github.com URL.',
      'invalid-input',
    );
  }
  if (ref && !REF_PATTERN.test(ref)) {
    throw new IngestError('Invalid branch, tag or commit reference.', 'invalid-input');
  }

  return { owner, repo, ref };
}

interface GitHubRepoResponse {
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
  license: { spdx_id?: string; name?: string } | null;
  topics?: string[];
  size: number;
  private: boolean;
  html_url: string;
}

function headers(token?: string): HeadersInit {
  const base: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'devgraph-analyzer',
  };
  if (token) base.Authorization = `Bearer ${token}`;
  return base;
}

async function githubFetch(url: string, token: string | undefined, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(url, { headers: headers(token), signal, cache: 'no-store' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new IngestError('Could not reach GitHub. Check your network and try again.', 'network', 502);
  }

  if (response.status === 404) {
    throw new IngestError('Repository not found, or it is private.', 'not-found', 404);
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    throw new IngestError(
      remaining === '0'
        ? 'GitHub rate limit reached. Set GITHUB_TOKEN to raise it, or try again shortly.'
        : 'GitHub refused the request.',
      'rate-limited',
      429,
    );
  }
  if (!response.ok) {
    throw new IngestError(`GitHub returned ${response.status}.`, 'network', 502);
  }
  return response;
}

export async function fetchRepoMetadata(
  ref: ParsedRepoRef,
  token?: string,
  signal?: AbortSignal,
): Promise<Partial<RepoSummary> & { defaultBranch: string; htmlUrl: string }> {
  const response = await githubFetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}`,
    token,
    signal,
  );
  const json = (await response.json()) as GitHubRepoResponse;

  return {
    name: json.full_name ?? `${ref.owner}/${ref.repo}`,
    description: json.description ?? undefined,
    defaultBranch: json.default_branch ?? 'main',
    stars: json.stargazers_count,
    license: json.license?.spdx_id && json.license.spdx_id !== 'NOASSERTION' ? json.license.spdx_id : json.license?.name,
    topics: json.topics,
    htmlUrl: json.html_url,
  };
}

export async function fetchCommits(
  ref: ParsedRepoRef,
  branch: string,
  token: string | undefined,
  limit = 100,
  signal?: AbortSignal,
): Promise<CommitRecord[]> {
  const perPage = Math.min(100, limit);
  const url = `https://api.github.com/repos/${ref.owner}/${ref.repo}/commits?sha=${encodeURIComponent(
    branch,
  )}&per_page=${perPage}`;

  try {
    const response = await githubFetch(url, token, signal);
    const json = (await response.json()) as {
      sha: string;
      commit: { author: { name: string; date: string }; message: string };
    }[];
    return json.map((entry) => ({
      sha: entry.sha,
      shortSha: entry.sha.slice(0, 7),
      author: entry.commit.author?.name ?? 'unknown',
      date: entry.commit.author?.date ?? new Date(0).toISOString(),
      message: entry.commit.message.split('\n')[0].slice(0, 200),
    }));
  } catch {
    // History is a bonus, never a blocker.
    return [];
  }
}

export interface GitHubIngestOptions {
  input: string;
  token?: string;
  limits?: IngestLimits;
  signal?: AbortSignal;
}

export async function ingestGitHub(options: GitHubIngestOptions): Promise<IngestResult> {
  const limits = options.limits ?? DEFAULT_INGEST_LIMITS;
  const parsed = parseRepoInput(options.input);
  const metadata = await fetchRepoMetadata(parsed, options.token, options.signal);
  const ref = parsed.ref ?? metadata.defaultBranch;

  const archiveUrl = `https://codeload.github.com/${parsed.owner}/${parsed.repo}/tar.gz/${encodeURIComponent(ref)}`;

  let response: Response;
  try {
    response = await fetch(archiveUrl, {
      headers: options.token
        ? { Authorization: `Bearer ${options.token}`, 'User-Agent': 'devgraph-analyzer' }
        : { 'User-Agent': 'devgraph-analyzer' },
      signal: options.signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new IngestError('Could not download the repository archive.', 'network', 502);
  }

  if (response.status === 404) {
    throw new IngestError(`Branch, tag or commit "${ref}" was not found.`, 'not-found', 404);
  }
  if (!response.ok) {
    throw new IngestError(`Archive download failed with ${response.status}.`, 'network', 502);
  }

  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength) assertArchiveSize(declaredLength, limits);

  const archive = new Uint8Array(await response.arrayBuffer());
  assertArchiveSize(archive.byteLength, limits);

  const tarball = gunzipSync(archive);
  const entries = stripRootDirectory(
    readTar(tarball, {
      maxEntryBytes: limits.maxFileBytes,
      maxEntries: limits.maxFiles * 3,
    }),
  );

  const { files, warnings } = decodeEntries(
    entries.map((entry) => ({ name: entry.name, size: entry.size, read: () => entry.data })),
    limits,
  );

  if (!files.length) {
    throw new IngestError('The repository contained no analysable source files.', 'unsupported', 422);
  }

  const source: RepoSource = {
    kind: 'github',
    label: `${parsed.owner}/${parsed.repo}`,
    url: metadata.htmlUrl ?? `https://github.com/${parsed.owner}/${parsed.repo}`,
    ref,
  };

  return {
    source,
    files,
    repo: {
      name: metadata.name,
      description: metadata.description,
      defaultBranch: metadata.defaultBranch,
      stars: metadata.stars,
      license: metadata.license,
      topics: metadata.topics,
    },
    warnings,
  };
}
