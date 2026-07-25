import type { ImportRef, LanguageId, ParsedFile } from '@/lib/core/types';
import { basename, dirname, normalizePath, resolveRelative } from '@/lib/core/paths';

/**
 * Import resolution.
 *
 * Turns a language-specific import specifier into either an internal file path
 * or an external package name. Every language contributes its own strategy;
 * unresolved specifiers degrade to "external" rather than being dropped, so the
 * dependency graph never silently loses an edge.
 */

export interface ResolvedImport {
  specifier: string;
  /** Repo-relative path when the import points at a file in this repo. */
  target?: string;
  external: boolean;
  /** Package/module name when external. */
  packageName?: string;
  /** True when the specifier is a language/runtime builtin. */
  builtin?: boolean;
}

export interface ResolverManifests {
  /** Parsed `tsconfig.json` / `jsconfig.json` compilerOptions. */
  tsconfig?: { baseUrl?: string; paths?: Record<string, string[]> };
  /** Module path declared in `go.mod`. */
  goModule?: string;
  /** PSR-4 autoload map from `composer.json`. */
  psr4?: Record<string, string | string[]>;
  /** Package names declared by the repo's own manifests (monorepo packages). */
  workspacePackages?: Map<string, string>;
}

const TS_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.vue',
  '.svelte',
  '.css',
  '.scss',
  '.sass',
  '.less',
];

const TS_INDEXES = [
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '/index.mjs',
  '/index.cjs',
  '/index.d.ts',
];

const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl',
  'stream', 'string_decoder', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8',
  'vm', 'wasi', 'worker_threads', 'zlib',
]);

const PYTHON_BUILTINS = new Set([
  'abc', 'argparse', 'ast', 'asyncio', 'base64', 'collections', 'contextlib', 'copy', 'csv',
  'dataclasses', 'datetime', 'decimal', 'enum', 'functools', 'glob', 'hashlib', 'heapq', 'hmac',
  'html', 'http', 'importlib', 'inspect', 'io', 'itertools', 'json', 'logging', 'math',
  'multiprocessing', 'operator', 'os', 'pathlib', 'pickle', 'random', 're', 'secrets', 'shutil',
  'signal', 'socket', 'sqlite3', 'string', 'struct', 'subprocess', 'sys', 'tempfile', 'textwrap',
  'threading', 'time', 'traceback', 'types', 'typing', 'unittest', 'urllib', 'uuid', 'warnings',
  'weakref', 'xml', 'zipfile',
]);

const GO_BUILTIN_PREFIXES = [
  'archive/', 'bufio', 'bytes', 'compress/', 'container/', 'context', 'crypto', 'database/',
  'encoding', 'errors', 'flag', 'fmt', 'go/', 'hash', 'html', 'image', 'io', 'log', 'math',
  'mime', 'net', 'os', 'path', 'reflect', 'regexp', 'runtime', 'sort', 'strconv', 'strings',
  'sync', 'syscall', 'testing', 'text/', 'time', 'unicode', 'unsafe', 'embed', 'slices', 'maps',
];

const JAVA_BUILTIN_PREFIXES = ['java.', 'javax.', 'jakarta.', 'jdk.', 'sun.'];
const CSHARP_BUILTIN_PREFIXES = ['System', 'Microsoft.'];
const RUST_BUILTIN_ROOTS = new Set(['std', 'core', 'alloc', 'proc_macro', 'test']);

export class ImportResolver {
  private readonly files: Set<string>;
  private readonly byNoExt = new Map<string, string[]>();
  private readonly byBasename = new Map<string, string[]>();
  private readonly byNamespaceType = new Map<string, string[]>();
  private readonly byGoPackageDir = new Map<string, string[]>();
  private readonly tsAliases: { prefix: string; suffix: string; targets: string[] }[] = [];
  private readonly cache = new Map<string, ResolvedImport>();

  constructor(
    filePaths: Iterable<string>,
    private readonly manifests: ResolverManifests = {},
    parsed: Iterable<ParsedFile> = [],
  ) {
    this.files = new Set(filePaths);

    for (const path of this.files) {
      const noExt = stripExtension(path);
      push(this.byNoExt, noExt, path);
      push(this.byBasename, basename(path).toLowerCase(), path);
      push(this.byGoPackageDir, dirname(path), path);
    }

    for (const file of parsed) {
      const namespace = file.exports.find((e) => e.kind === 'namespace')?.name;
      if (!namespace) continue;
      // `com.acme.web` + type `UserController` → `com.acme.web.UserController`
      for (const symbol of file.symbols) {
        if (symbol.container) continue;
        const separator = file.language === 'php' ? '\\' : '.';
        push(this.byNamespaceType, `${namespace}${separator}${symbol.name}`, file.path);
      }
      push(this.byNamespaceType, namespace, file.path);
    }

    for (const [pattern, targets] of Object.entries(manifests.tsconfig?.paths ?? {})) {
      const [prefix, suffix = ''] = pattern.split('*');
      this.tsAliases.push({
        prefix,
        suffix,
        targets: targets.map((target) => normalizePath(joinBase(manifests.tsconfig?.baseUrl, target))),
      });
    }
    // Sort longest prefix first so `@/lib/*` beats `@/*`.
    this.tsAliases.sort((a, b) => b.prefix.length - a.prefix.length);
  }

  resolve(fromFile: string, ref: ImportRef, language: LanguageId): ResolvedImport {
    const key = `${language}|${fromFile}|${ref.specifier}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const result = this.resolveUncached(fromFile, ref.specifier, language);
    this.cache.set(key, result);
    return result;
  }

  private resolveUncached(fromFile: string, specifier: string, language: LanguageId): ResolvedImport {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.resolveJs(fromFile, specifier);
      case 'python':
        return this.resolvePython(fromFile, specifier);
      case 'go':
        return this.resolveGo(specifier);
      case 'rust':
        return this.resolveRust(fromFile, specifier);
      case 'java':
        return this.resolveJava(specifier);
      case 'csharp':
        return this.resolveCsharp(specifier);
      case 'php':
        return this.resolvePhp(fromFile, specifier);
      default:
        return { specifier, external: true, packageName: specifier };
    }
  }

  // -- JS / TS -------------------------------------------------------------

  private resolveJs(fromFile: string, specifier: string): ResolvedImport {
    if (specifier.startsWith('node:')) {
      return { specifier, external: true, builtin: true, packageName: specifier };
    }
    if (specifier.startsWith('.')) {
      const base = resolveRelative(fromFile, specifier);
      const target = this.probe(base, TS_EXTENSIONS, TS_INDEXES);
      return target
        ? { specifier, target, external: false }
        : { specifier, external: false, target: undefined };
    }

    for (const alias of this.tsAliases) {
      if (!specifier.startsWith(alias.prefix)) continue;
      const rest = specifier.slice(alias.prefix.length);
      const tail = alias.suffix && rest.endsWith(alias.suffix)
        ? rest.slice(0, rest.length - alias.suffix.length)
        : rest;
      for (const target of alias.targets) {
        const candidate = normalizePath(target.replace('*', tail));
        const found = this.probe(candidate, TS_EXTENSIONS, TS_INDEXES);
        if (found) return { specifier, target: found, external: false };
      }
    }

    if (specifier.startsWith('/') || specifier.startsWith('~/')) {
      const candidate = normalizePath(specifier.replace(/^~?\//, ''));
      const found =
        this.probe(candidate, TS_EXTENSIONS, TS_INDEXES) ??
        this.probe(`src/${candidate}`, TS_EXTENSIONS, TS_INDEXES);
      if (found) return { specifier, target: found, external: false };
    }

    const packageName = jsPackageName(specifier);
    const workspaceTarget = this.manifests.workspacePackages?.get(packageName);
    if (workspaceTarget) {
      const subpath = specifier.slice(packageName.length).replace(/^\//, '');
      const found =
        this.probe(normalizePath(`${workspaceTarget}/${subpath || 'index'}`), TS_EXTENSIONS, TS_INDEXES) ??
        this.probe(normalizePath(`${workspaceTarget}/src/${subpath || 'index'}`), TS_EXTENSIONS, TS_INDEXES);
      if (found) return { specifier, target: found, external: false };
    }

    return {
      specifier,
      external: true,
      packageName,
      builtin: NODE_BUILTINS.has(packageName),
    };
  }

  // -- Python --------------------------------------------------------------

  private resolvePython(fromFile: string, specifier: string): ResolvedImport {
    if (specifier.startsWith('.')) {
      const levels = /^\.+/.exec(specifier)?.[0].length ?? 1;
      let dir = dirname(fromFile);
      for (let i = 1; i < levels; i += 1) dir = dirname(dir);
      const rest = specifier.slice(levels).replace(/\./g, '/');
      const base = normalizePath(rest ? `${dir}/${rest}` : dir);
      const target = this.probe(base, ['', '.py', '.pyi'], ['/__init__.py']);
      return { specifier, target, external: false };
    }

    const relative = specifier.replace(/\./g, '/');
    const roots = ['', 'src/', 'lib/', 'app/', `${topPackage(fromFile)}/`];
    for (const root of roots) {
      const target = this.probe(`${root}${relative}`, ['', '.py', '.pyi'], ['/__init__.py']);
      if (target) return { specifier, target, external: false };
    }

    const packageName = specifier.split('.')[0];
    return { specifier, external: true, packageName, builtin: PYTHON_BUILTINS.has(packageName) };
  }

  // -- Go ------------------------------------------------------------------

  private resolveGo(specifier: string): ResolvedImport {
    const module = this.manifests.goModule;
    if (module && (specifier === module || specifier.startsWith(`${module}/`))) {
      const dir = normalizePath(specifier.slice(module.length).replace(/^\//, ''));
      const candidates = this.byGoPackageDir.get(dir) ?? [];
      const target = candidates.find((p) => p.endsWith('.go') && !p.endsWith('_test.go'));
      if (target) return { specifier, target, external: false };
    }
    const builtin = GO_BUILTIN_PREFIXES.some(
      (prefix) => specifier === prefix || specifier.startsWith(prefix),
    );
    return {
      specifier,
      external: true,
      packageName: builtin ? specifier : specifier.split('/').slice(0, 3).join('/'),
      builtin,
    };
  }

  // -- Rust ----------------------------------------------------------------

  private resolveRust(fromFile: string, specifier: string): ResolvedImport {
    const segments = specifier.split('::').filter(Boolean);
    const root = segments[0];

    if (root === 'crate' || root === 'self' || root === 'super') {
      let baseDir = root === 'crate' ? rustCrateRoot(fromFile) : dirname(fromFile);
      let rest = segments.slice(1);
      if (root === 'super') baseDir = dirname(baseDir);
      // Trailing segment may be a type rather than a module.
      for (let take = rest.length; take >= 0; take -= 1) {
        const candidate = normalizePath(`${baseDir}/${rest.slice(0, take).join('/')}`);
        const target = this.probe(candidate, ['', '.rs'], ['/mod.rs']);
        if (target) return { specifier, target, external: false };
      }
      return { specifier, external: false };
    }

    if (RUST_BUILTIN_ROOTS.has(root)) {
      return { specifier, external: true, packageName: root, builtin: true };
    }

    // A local module declared at the crate root (`mod foo;` then `use foo::x`).
    const local = this.probe(`src/${root}`, ['', '.rs'], ['/mod.rs']);
    if (local) return { specifier, target: local, external: false };

    return { specifier, external: true, packageName: root };
  }

  // -- JVM / .NET / PHP ----------------------------------------------------

  private resolveJava(specifier: string): ResolvedImport {
    const clean = specifier.replace(/\.\*$/, '');
    const direct = this.byNamespaceType.get(clean)?.[0];
    if (direct) return { specifier, target: direct, external: false };

    const className = clean.split('.').pop() ?? '';
    const suffixPath = `${clean.replace(/\./g, '/')}.java`;
    const bySuffix = [...this.files].find((p) => p.endsWith(suffixPath));
    if (bySuffix) return { specifier, target: bySuffix, external: false };

    const byName = this.byBasename.get(`${className.toLowerCase()}.java`);
    if (byName?.length === 1) return { specifier, target: byName[0], external: false };

    const builtin = JAVA_BUILTIN_PREFIXES.some((prefix) => clean.startsWith(prefix));
    return {
      specifier,
      external: true,
      packageName: clean.split('.').slice(0, 3).join('.'),
      builtin,
    };
  }

  private resolveCsharp(specifier: string): ResolvedImport {
    const direct = this.byNamespaceType.get(specifier)?.[0];
    if (direct) return { specifier, target: direct, external: false };
    const builtin = CSHARP_BUILTIN_PREFIXES.some(
      (prefix) => specifier === prefix || specifier.startsWith(`${prefix}.`) || specifier.startsWith(prefix),
    );
    return {
      specifier,
      external: true,
      packageName: specifier.split('.').slice(0, 2).join('.'),
      builtin,
    };
  }

  private resolvePhp(fromFile: string, specifier: string): ResolvedImport {
    if (specifier.startsWith('.') || specifier.includes('/')) {
      const base = specifier.startsWith('.')
        ? resolveRelative(fromFile, specifier)
        : normalizePath(specifier);
      const target = this.probe(base, ['', '.php'], []);
      if (target) return { specifier, target, external: false };
    }

    const clean = specifier.replace(/^\\+/, '');
    const direct = this.byNamespaceType.get(clean)?.[0];
    if (direct) return { specifier, target: direct, external: false };

    for (const [prefix, dirs] of Object.entries(this.manifests.psr4 ?? {})) {
      const normalizedPrefix = prefix.replace(/\\+$/, '');
      if (!normalizedPrefix || !clean.startsWith(normalizedPrefix)) continue;
      const rest = clean.slice(normalizedPrefix.length).replace(/^\\+/, '').replace(/\\/g, '/');
      for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
        const target = this.probe(normalizePath(`${dir}/${rest}`), ['', '.php'], []);
        if (target) return { specifier, target, external: false };
      }
    }

    const className = clean.split('\\').pop() ?? '';
    const byName = this.byBasename.get(`${className.toLowerCase()}.php`);
    if (byName?.length === 1) return { specifier, target: byName[0], external: false };

    return { specifier, external: true, packageName: clean.split('\\')[0] };
  }

  // -- shared --------------------------------------------------------------

  private probe(base: string, extensions: string[], indexes: string[]): string | undefined {
    for (const ext of extensions) {
      const candidate = `${base}${ext}`;
      if (this.files.has(candidate)) return candidate;
    }
    for (const index of indexes) {
      const candidate = `${base}${index}`;
      if (this.files.has(candidate)) return candidate;
    }
    // Fall back to a unique extension-less match (e.g. `src/foo` → `src/foo.ts`).
    const matches = this.byNoExt.get(base);
    if (matches?.length === 1) return matches[0];
    return undefined;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function stripExtension(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return path;
  return `${dirname(path)}/${base.slice(0, dot)}`.replace(/^\//, '');
}

function joinBase(baseUrl: string | undefined, target: string): string {
  if (!baseUrl || baseUrl === '.' || baseUrl === './') return target;
  return `${baseUrl.replace(/^\.\//, '').replace(/\/$/, '')}/${target}`;
}

export function jsPackageName(specifier: string): string {
  if (specifier.startsWith('node:')) return specifier;
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) return segments.slice(0, 2).join('/');
  return segments[0];
}

function topPackage(path: string): string {
  return path.split('/')[0] ?? '';
}

function rustCrateRoot(fromFile: string): string {
  const index = fromFile.indexOf('/src/');
  if (index >= 0) return fromFile.slice(0, index + 4);
  return fromFile.startsWith('src/') ? 'src' : dirname(fromFile);
}
