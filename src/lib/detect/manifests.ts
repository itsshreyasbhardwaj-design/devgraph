import type { DependencyRecord, SourceFile } from '@/lib/core/types';
import { basename, dirname } from '@/lib/core/paths';

/**
 * Manifest parsing.
 *
 * Every ecosystem gets a small reader that produces `DependencyRecord`s plus a
 * few resolver hints (tsconfig paths, go module name, PSR-4 roots). Readers are
 * intentionally forgiving: a malformed manifest degrades to zero dependencies
 * rather than failing the whole analysis.
 */

export interface ManifestData {
  dependencies: DependencyRecord[];
  /** package.json `name` → directory, for monorepo workspace resolution. */
  workspacePackages: Map<string, string>;
  workspaceGlobs: string[];
  tsconfig?: { baseUrl?: string; paths?: Record<string, string[]> };
  goModule?: string;
  psr4?: Record<string, string | string[]>;
  /** Raw package.json scripts from the root manifest. */
  scripts: Record<string, string>;
  /** Declared entry points (`main`, `bin`, `exports`). */
  declaredEntries: string[];
  projectName?: string;
  projectDescription?: string;
  license?: string;
}

const MANIFEST_NAMES = new Set([
  'package.json',
  'requirements.txt',
  'requirements-dev.txt',
  'pyproject.toml',
  'Pipfile',
  'setup.py',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'tsconfig.json',
  'jsconfig.json',
]);

export function isManifest(path: string): boolean {
  const base = basename(path);
  return MANIFEST_NAMES.has(base) || base.endsWith('.csproj') || base.endsWith('.fsproj');
}

export function parseManifests(files: SourceFile[]): ManifestData {
  const data: ManifestData = {
    dependencies: [],
    workspacePackages: new Map(),
    workspaceGlobs: [],
    scripts: {},
    declaredEntries: [],
  };

  const manifests = files.filter((file) => isManifest(file.path));
  // Shallowest first so the root manifest wins for project-level metadata.
  manifests.sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  for (const file of manifests) {
    const base = basename(file.path);
    try {
      if (base === 'package.json') readPackageJson(file, data);
      else if (base === 'tsconfig.json' || base === 'jsconfig.json') readTsconfig(file, data);
      else if (base.startsWith('requirements')) readRequirements(file, data);
      else if (base === 'pyproject.toml') readPyproject(file, data);
      else if (base === 'Pipfile') readPipfile(file, data);
      else if (base === 'go.mod') readGoMod(file, data);
      else if (base === 'Cargo.toml') readCargoToml(file, data);
      else if (base === 'pom.xml') readPomXml(file, data);
      else if (base.startsWith('build.gradle')) readGradle(file, data);
      else if (base === 'composer.json') readComposerJson(file, data);
      else if (base === 'Gemfile') readGemfile(file, data);
      else if (base.endsWith('.csproj') || base.endsWith('.fsproj')) readCsproj(file, data);
    } catch {
      // A single broken manifest must never fail the analysis.
    }
  }

  data.dependencies = dedupeDependencies(data.dependencies);
  return data;
}

function dedupeDependencies(records: DependencyRecord[]): DependencyRecord[] {
  const byKey = new Map<string, DependencyRecord>();
  for (const record of records) {
    const key = `${record.ecosystem}:${record.name}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, record);
      continue;
    }
    // Runtime beats dev when a package appears in both.
    if (existing.kind !== 'runtime' && record.kind === 'runtime') byKey.set(key, record);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function add(
  data: ManifestData,
  name: string,
  version: string | undefined,
  kind: DependencyRecord['kind'],
  ecosystem: string,
  manifest: string,
): void {
  const clean = name.trim();
  if (!clean) return;
  data.dependencies.push({ name: clean, version, kind, ecosystem, usedBy: 0, manifest });
}

// -- npm ---------------------------------------------------------------------

interface PackageJsonShape {
  name?: string;
  description?: string;
  license?: string;
  main?: string;
  module?: string;
  types?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  scripts?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function readPackageJson(file: SourceFile, data: ManifestData): void {
  const json = JSON.parse(file.content) as PackageJsonShape;
  const isRoot = dirname(file.path) === '' || file.path === 'package.json';

  if (json.name) data.workspacePackages.set(json.name, dirname(file.path));

  if (isRoot) {
    data.projectName ??= json.name;
    data.projectDescription ??= json.description;
    data.license ??= json.license;
    data.scripts = json.scripts ?? {};
    const workspaces = Array.isArray(json.workspaces) ? json.workspaces : json.workspaces?.packages;
    if (workspaces) data.workspaceGlobs.push(...workspaces);
    for (const entry of [json.main, json.module, json.types]) {
      if (typeof entry === 'string') data.declaredEntries.push(entry.replace(/^\.\//, ''));
    }
    if (typeof json.bin === 'string') data.declaredEntries.push(json.bin.replace(/^\.\//, ''));
    else if (json.bin) {
      for (const value of Object.values(json.bin))
        data.declaredEntries.push(value.replace(/^\.\//, ''));
    }
  }

  const groups: [Record<string, string> | undefined, DependencyRecord['kind']][] = [
    [json.dependencies, 'runtime'],
    [json.devDependencies, 'dev'],
    [json.peerDependencies, 'peer'],
    [json.optionalDependencies, 'optional'],
  ];
  for (const [group, kind] of groups) {
    for (const [name, version] of Object.entries(group ?? {})) {
      add(data, name, version, kind, 'npm', file.path);
    }
  }
}

/**
 * Strip comments and trailing commas from JSONC.
 *
 * This is a character walk rather than a regex because tsconfig files are full
 * of glob patterns. A naive block-comment regex sees the slash-star inside a
 * path alias such as the `@` wildcard mapping, then matches it against the
 * star-slash inside a recursive include glob, and silently deletes everything
 * between them — which quietly drops `paths` and collapses the import graph.
 * Only text outside string literals is considered here.
 */
export function stripJsonComments(source: string): string {
  let output = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        output += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      } else if (char === '\n') {
        output += char;
      }
      continue;
    }
    if (inString) {
      output += char;
      if (char === '\\') {
        output += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    output += char;
  }

  // Trailing commas are legal in tsconfig but not in JSON.
  return output.replace(/,(\s*[}\]])/g, '$1');
}

function readTsconfig(file: SourceFile, data: ManifestData): void {
  const json = JSON.parse(stripJsonComments(file.content)) as {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  };
  const options = json.compilerOptions;
  if (!options?.paths && !options?.baseUrl) return;
  const prefix = dirname(file.path);
  const rebase = (value: string) => (prefix ? `${prefix}/${value}` : value);
  data.tsconfig = {
    baseUrl: options.baseUrl ? rebase(options.baseUrl.replace(/^\.\//, '')) : prefix || undefined,
    paths: Object.fromEntries(
      Object.entries(options.paths ?? {}).map(([key, targets]) => [
        key,
        targets.map((target) => target.replace(/^\.\//, '')),
      ]),
    ),
  };
}

// -- Python ------------------------------------------------------------------

function readRequirements(file: SourceFile, data: ManifestData): void {
  const dev = file.path.includes('dev');
  for (const raw of file.content.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line || line.startsWith('-')) continue;
    const match = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*([<>=!~^].*)?$/.exec(line);
    if (!match) continue;
    add(data, match[1], match[2]?.trim(), dev ? 'dev' : 'runtime', 'pypi', file.path);
  }
}

function readPyproject(file: SourceFile, data: ManifestData): void {
  const nameMatch = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(file.content);
  if (nameMatch) data.projectName ??= nameMatch[1];

  // PEP 621 `dependencies = [...]`
  for (const block of file.content.matchAll(
    /^\s*(?:dependencies|dev-dependencies)\s*=\s*\[([\s\S]*?)\]/gm,
  )) {
    const dev = block[0].includes('dev-');
    for (const entry of block[1].matchAll(/["']([^"']+)["']/g)) {
      const name = /^([A-Za-z0-9._-]+)/.exec(entry[1])?.[1];
      if (name) add(data, name, undefined, dev ? 'dev' : 'runtime', 'pypi', file.path);
    }
  }

  // Poetry `[tool.poetry.dependencies]`
  for (const section of file.content.matchAll(
    /\[tool\.poetry\.(?:group\.\w+\.)?(dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g,
  )) {
    const dev = Boolean(section[1]) || section[0].includes('group.dev');
    for (const line of section[2].split('\n')) {
      const match = /^\s*([A-Za-z0-9._-]+)\s*=\s*(.+)$/.exec(line);
      if (!match || match[1] === 'python') continue;
      const version = /["']([^"']+)["']/.exec(match[2])?.[1];
      add(data, match[1], version, dev ? 'dev' : 'runtime', 'pypi', file.path);
    }
  }
}

function readPipfile(file: SourceFile, data: ManifestData): void {
  for (const section of file.content.matchAll(/\[(packages|dev-packages)\]([\s\S]*?)(?=\n\[|$)/g)) {
    const dev = section[1] === 'dev-packages';
    for (const line of section[2].split('\n')) {
      const match = /^\s*([A-Za-z0-9._-]+)\s*=\s*(.+)$/.exec(line);
      if (!match) continue;
      add(data, match[1], undefined, dev ? 'dev' : 'runtime', 'pypi', file.path);
    }
  }
}

// -- Go ----------------------------------------------------------------------

function readGoMod(file: SourceFile, data: ManifestData): void {
  const moduleMatch = /^\s*module\s+(\S+)/m.exec(file.content);
  if (moduleMatch && !data.goModule) data.goModule = moduleMatch[1];

  for (const block of file.content.matchAll(/require\s*\(([\s\S]*?)\)/g)) {
    for (const line of block[1].split('\n')) {
      const match = /^\s*(\S+)\s+(\S+)/.exec(line.split('//')[0]);
      if (!match) continue;
      const indirect = line.includes('// indirect');
      add(data, match[1], match[2], indirect ? 'optional' : 'runtime', 'go', file.path);
    }
  }
  for (const single of file.content.matchAll(/^\s*require\s+(\S+)\s+(\S+)/gm)) {
    add(data, single[1], single[2], 'runtime', 'go', file.path);
  }
}

// -- Rust --------------------------------------------------------------------

function readCargoToml(file: SourceFile, data: ManifestData): void {
  const nameMatch = /\[package\][\s\S]*?^\s*name\s*=\s*["']([^"']+)["']/m.exec(file.content);
  if (nameMatch) data.projectName ??= nameMatch[1];

  for (const section of file.content.matchAll(
    /\[(dependencies|dev-dependencies|build-dependencies)\]([\s\S]*?)(?=\n\[|$)/g,
  )) {
    const kind: DependencyRecord['kind'] = section[1] === 'dependencies' ? 'runtime' : 'dev';
    for (const line of section[2].split('\n')) {
      const match = /^\s*([A-Za-z0-9._-]+)\s*=\s*(.+)$/.exec(line);
      if (!match) continue;
      const version = /["']([^"']+)["']/.exec(match[2])?.[1];
      add(data, match[1], version, kind, 'crates.io', file.path);
    }
  }
  // `[dependencies.serde]` table form.
  for (const table of file.content.matchAll(/\[dependencies\.([A-Za-z0-9._-]+)\]/g)) {
    add(data, table[1], undefined, 'runtime', 'crates.io', file.path);
  }
}

// -- JVM ---------------------------------------------------------------------

function readPomXml(file: SourceFile, data: ManifestData): void {
  for (const dep of file.content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const groupId = /<groupId>([^<]+)<\/groupId>/.exec(dep[1])?.[1];
    const artifactId = /<artifactId>([^<]+)<\/artifactId>/.exec(dep[1])?.[1];
    const version = /<version>([^<]+)<\/version>/.exec(dep[1])?.[1];
    const scope = /<scope>([^<]+)<\/scope>/.exec(dep[1])?.[1];
    if (!artifactId) continue;
    add(
      data,
      groupId ? `${groupId}:${artifactId}` : artifactId,
      version,
      scope === 'test' ? 'dev' : 'runtime',
      'maven',
      file.path,
    );
  }
}

function readGradle(file: SourceFile, data: ManifestData): void {
  const pattern =
    /\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testCompileOnly|annotationProcessor)\s*\(?\s*["']([^"']+)["']/g;
  for (const match of file.content.matchAll(pattern)) {
    const [group, artifact, version] = match[2].split(':');
    add(
      data,
      artifact ? `${group}:${artifact}` : group,
      version,
      match[1].startsWith('test') ? 'dev' : 'runtime',
      'maven',
      file.path,
    );
  }
}

// -- .NET --------------------------------------------------------------------

function readCsproj(file: SourceFile, data: ManifestData): void {
  for (const match of file.content.matchAll(
    /<PackageReference\s+Include="([^"]+)"(?:[^>]*Version="([^"]+)")?/g,
  )) {
    add(data, match[1], match[2], 'runtime', 'nuget', file.path);
  }
}

// -- PHP ---------------------------------------------------------------------

function readComposerJson(file: SourceFile, data: ManifestData): void {
  const json = JSON.parse(file.content) as {
    name?: string;
    description?: string;
    license?: string;
    require?: Record<string, string>;
    'require-dev'?: Record<string, string>;
    autoload?: { 'psr-4'?: Record<string, string | string[]> };
    'autoload-dev'?: { 'psr-4'?: Record<string, string | string[]> };
  };
  const prefix = dirname(file.path);
  const rebase = (value: string) => (prefix ? `${prefix}/${value}` : value).replace(/\/$/, '');

  data.projectName ??= json.name;
  data.projectDescription ??= json.description;
  data.license ??= json.license;

  for (const [name, version] of Object.entries(json.require ?? {})) {
    if (name === 'php' || name.startsWith('ext-')) continue;
    add(data, name, version, 'runtime', 'packagist', file.path);
  }
  for (const [name, version] of Object.entries(json['require-dev'] ?? {})) {
    add(data, name, version, 'dev', 'packagist', file.path);
  }

  const psr4 = { ...(json.autoload?.['psr-4'] ?? {}), ...(json['autoload-dev']?.['psr-4'] ?? {}) };
  if (Object.keys(psr4).length) {
    data.psr4 = {
      ...data.psr4,
      ...Object.fromEntries(
        Object.entries(psr4).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.map(rebase) : rebase(value),
        ]),
      ),
    };
  }
}

// -- Ruby --------------------------------------------------------------------

function readGemfile(file: SourceFile, data: ManifestData): void {
  for (const match of file.content.matchAll(
    /^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm,
  )) {
    add(data, match[1], match[2], 'runtime', 'rubygems', file.path);
  }
}
