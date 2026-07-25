/** POSIX path helpers that never touch the filesystem. */

export function normalizePath(input: string): string {
  const replaced = input.replace(/\\/g, '/');
  const isAbsolute = replaced.startsWith('/');
  const parts: string[] = [];
  for (const segment of replaced.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!isAbsolute) parts.push('..');
      continue;
    }
    parts.push(segment);
  }
  const joined = parts.join('/');
  return isAbsolute ? `/${joined}` : joined;
}

export function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) return '';
  if (idx === 0) return '/';
  return path.slice(0, idx);
}

export function basename(path: string, stripExt = false): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!stripExt) return name;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function joinPath(...segments: string[]): string {
  return normalizePath(segments.filter(Boolean).join('/'));
}

export function resolveRelative(fromFile: string, specifier: string): string {
  return normalizePath(`${dirname(fromFile)}/${specifier}`);
}

/** First path segment, used as the default clustering key. */
export function topLevelSegment(path: string): string {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  const idx = clean.indexOf('/');
  return idx < 0 ? clean : clean.slice(0, idx);
}

export function pathDepth(path: string): number {
  if (!path) return 0;
  return path.split('/').filter(Boolean).length;
}

/**
 * Module bucket for a file — the first two path segments, which maps well onto
 * `src/features/*`, `apps/*`, `packages/*`, `internal/*` and similar layouts.
 */
export function moduleKeyFor(path: string, depth = 2): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '(root)';
  const container = new Set(['src', 'lib', 'app', 'apps', 'packages', 'internal', 'pkg', 'cmd']);
  let take = depth;
  if (parts.length > 2 && container.has(parts[0])) take = depth + 1;
  return parts.slice(0, Math.min(take, parts.length - 1)).join('/') || '(root)';
}

const TEST_PATTERNS = [
  /(^|\/)tests?(\/|$)/i,
  /(^|\/)__tests__(\/|$)/i,
  /(^|\/)spec(\/|$)/i,
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /_test\.(go|py|rb)$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /Test(s)?\.(java|cs|kt|scala)$/,
  /(^|\/)e2e(\/|$)/i,
  /(^|\/)cypress(\/|$)/i,
  /(^|\/)playwright(\/|$)/i,
];

export function isTestPath(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

const GENERATED_PATTERNS = [
  /(^|\/)(dist|build|out|target|bin|obj|coverage|\.next|\.nuxt|\.svelte-kit|__pycache__)(\/|$)/i,
  /(^|\/)(node_modules|vendor|bower_components|third_party)(\/|$)/i,
  /\.min\.(js|css)$/i,
  /\.(generated|gen)\.[^/]+$/i,
  /(^|\/)generated(\/|$)/i,
  /\.pb\.(go|ts|js|py)$/i,
  /_pb2\.py$/i,
  /(^|\/)migrations?(\/|$)/i,
];

export function isGeneratedPath(path: string): boolean {
  return GENERATED_PATTERNS.some((re) => re.test(path));
}

/** Directories never worth walking into. */
export const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '.pnpm',
  '.yarn',
  'vendor',
  '.venv',
  'venv',
  'env',
  '.tox',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.gradle',
  '.idea',
  '.vscode',
  '.vs',
  'obj',
  'bin',
  'coverage',
  '.nyc_output',
  '.terraform',
  'Pods',
  'DerivedData',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.tiff',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.bz2',
  '.xz',
  '.7z',
  '.rar',
  '.mp3',
  '.mp4',
  '.wav',
  '.mov',
  '.avi',
  '.webm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.so',
  '.dylib',
  '.dll',
  '.exe',
  '.class',
  '.jar',
  '.wasm',
  '.pyc',
  '.pyo',
  '.o',
  '.a',
  '.node',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.parquet',
  '.bin',
  '.dat',
  '.psd',
  '.sketch',
  '.fig',
]);

export function isBinaryPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return BINARY_EXTENSIONS.has(base.slice(dot));
}

export function shouldIgnorePath(path: string): boolean {
  const segments = path.split('/');
  // Ignore lockfiles: huge, low signal.
  const base = segments[segments.length - 1];
  if (
    /^(pnpm-lock\.yaml|yarn\.lock|package-lock\.json|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/.test(
      base,
    )
  )
    return true;
  return segments.some((segment) => IGNORED_DIRECTORIES.has(segment));
}
