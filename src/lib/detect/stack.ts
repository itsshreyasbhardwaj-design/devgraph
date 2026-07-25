import type {
  DependencyRecord,
  FileRecord,
  LanguageBreakdown,
  LanguageId,
  SourceFile,
  StackFinding,
  StackProfile,
} from '@/lib/core/types';
import { basename } from '@/lib/core/paths';
import { isCodeLanguage } from '@/lib/core/languages';
import type { ManifestData } from './manifests';
import { STACK_RULES, type StackRule } from './rules';

export interface DetectInput {
  files: FileRecord[];
  /** Content is needed only for the small set of rules with `content` signals. */
  sources: Map<string, string>;
  manifests: ManifestData;
}

/** Max bytes of a single file scanned for content signals. */
const CONTENT_SCAN_LIMIT = 200_000;
/** Max files scanned per content rule — keeps detection O(rules), not O(repo). */
const CONTENT_FILE_LIMIT = 60;

export function detectStack(input: DetectInput): StackProfile {
  const paths = new Set(input.files.map((f) => f.path));
  const basenames = new Set(input.files.map((f) => basename(f.path)));
  const directories = new Set<string>();
  for (const file of input.files) {
    for (const segment of file.path.split('/').slice(0, -1)) directories.add(segment);
  }

  const dependencyNames = new Set(input.manifests.dependencies.map((d) => d.name));
  const findings: StackFinding[] = [];

  for (const rule of STACK_RULES) {
    const evidence: string[] = [];
    let score = 0;

    for (const dependency of rule.dependencies ?? []) {
      if (dependencyNames.has(dependency)) {
        evidence.push(`dependency: ${dependency}`);
        score += 0.6;
      }
    }

    for (const file of rule.files ?? []) {
      if (paths.has(file) || basenames.has(file)) {
        evidence.push(`file: ${file}`);
        score += 0.5;
      }
    }

    for (const dir of rule.dirs ?? []) {
      if (directories.has(dir)) {
        evidence.push(`directory: ${dir}/`);
        score += 0.3;
      }
    }

    for (const pattern of rule.pathPatterns ?? []) {
      const match = input.files.find((f) => pattern.test(f.path));
      if (match) {
        evidence.push(`path: ${match.path}`);
        score += 0.45;
      }
    }

    if (rule.content) {
      const match = findContentMatch(input, rule.content);
      if (match) {
        evidence.push(`code: ${match}`);
        score += 0.5;
      }
    }

    if (score === 0) continue;
    findings.push({
      category: rule.category,
      name: rule.name,
      confidence: Math.min(1, (rule.confidence ?? 0.8) * Math.min(1.2, 0.6 + score / 2)),
      version: versionOf(rule, input.manifests.dependencies),
      evidence: evidence.slice(0, 4),
    });
  }

  const languages = languageBreakdown(input.files);
  const primaryLanguage = languages[0]?.language ?? 'other';

  for (const language of languages.slice(0, 6)) {
    if (!isCodeLanguage(language.language)) continue;
    findings.push({
      category: 'language',
      name: languageDisplayName(language.language),
      confidence: Math.min(1, 0.5 + language.share),
      evidence: [`${language.files} files, ${language.lines.toLocaleString()} lines`],
    });
  }

  const monorepoFindings = findings.filter((f) => f.category === 'monorepo');
  const workspaces = [...input.manifests.workspacePackages.entries()]
    .filter(([, dir]) => dir !== '')
    .map(([name, dir]) => `${name} → ${dir}`);

  return {
    primaryLanguage,
    languages,
    findings: dedupeFindings(findings),
    monorepo: monorepoFindings.length > 0 || workspaces.length > 1,
    workspaces,
  };
}

function findContentMatch(
  input: DetectInput,
  content: NonNullable<StackRule['content']>,
): string | undefined {
  let scanned = 0;
  for (const file of input.files) {
    if (scanned >= CONTENT_FILE_LIMIT) break;
    if (!content.in.test(file.path)) continue;
    const source = input.sources.get(file.path);
    if (!source) continue;
    scanned += 1;
    if (content.pattern.test(source.slice(0, CONTENT_SCAN_LIMIT))) return file.path;
  }
  return undefined;
}

function versionOf(rule: StackRule, dependencies: DependencyRecord[]): string | undefined {
  for (const name of rule.dependencies ?? []) {
    const found = dependencies.find((d) => d.name === name && d.version);
    if (found?.version) return normalizeVersion(found.version);
  }
  return undefined;
}

function normalizeVersion(version: string): string {
  return version.replace(/^[\^~>=<\s]+/, '').split(/[\s,|]/)[0];
}

function dedupeFindings(findings: StackFinding[]): StackFinding[] {
  const byKey = new Map<string, StackFinding>();
  for (const finding of findings) {
    const key = `${finding.category}:${finding.name}`;
    const existing = byKey.get(key);
    if (!existing || finding.confidence > existing.confidence) byKey.set(key, finding);
  }
  return [...byKey.values()].sort(
    (a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name),
  );
}

export function languageBreakdown(files: FileRecord[]): LanguageBreakdown[] {
  const totals = new Map<LanguageId, { files: number; lines: number; bytes: number }>();
  let totalLines = 0;

  for (const file of files) {
    if (file.isGenerated) continue;
    const entry = totals.get(file.language) ?? { files: 0, lines: 0, bytes: 0 };
    entry.files += 1;
    entry.lines += file.loc.total;
    entry.bytes += file.bytes;
    totals.set(file.language, entry);
    if (isCodeLanguage(file.language)) totalLines += file.loc.total;
  }

  return [...totals.entries()]
    .map(([language, entry]) => ({
      language,
      files: entry.files,
      lines: entry.lines,
      bytes: entry.bytes,
      share: totalLines > 0 && isCodeLanguage(language) ? entry.lines / totalLines : 0,
    }))
    .sort((a, b) => b.lines - a.lines);
}

function languageDisplayName(language: LanguageId): string {
  const labels: Partial<Record<LanguageId, string>> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    csharp: 'C#',
    cpp: 'C++',
  };
  return labels[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const ENTRY_PATTERNS: { pattern: RegExp; kind: 'app' | 'server' | 'cli' | 'worker' | 'page' | 'build' | 'test'; reason: string; confidence: number }[] = [
  { pattern: /^src\/(app|main|index)\.[cm]?[jt]sx?$/, kind: 'app', reason: 'Conventional application entry file', confidence: 0.9 },
  { pattern: /^(app|main|index|server)\.[cm]?[jt]sx?$/, kind: 'server', reason: 'Root server entry file', confidence: 0.85 },
  { pattern: /^src\/app\/layout\.[jt]sx$/, kind: 'app', reason: 'Next.js App Router root layout', confidence: 0.95 },
  { pattern: /^app\/layout\.[jt]sx$/, kind: 'app', reason: 'Next.js App Router root layout', confidence: 0.95 },
  { pattern: /^(src\/)?pages\/_app\.[jt]sx$/, kind: 'app', reason: 'Next.js Pages Router entry', confidence: 0.95 },
  { pattern: /^(src\/)?app\/page\.[jt]sx$/, kind: 'page', reason: 'Next.js root page', confidence: 0.8 },
  { pattern: /^main\.go$/, kind: 'server', reason: 'Go program entry', confidence: 0.95 },
  { pattern: /^cmd\/[^/]+\/main\.go$/, kind: 'cli', reason: 'Go command entry', confidence: 0.95 },
  { pattern: /^src\/main\.rs$/, kind: 'cli', reason: 'Rust binary crate root', confidence: 0.95 },
  { pattern: /^src\/lib\.rs$/, kind: 'app', reason: 'Rust library crate root', confidence: 0.9 },
  { pattern: /^manage\.py$/, kind: 'cli', reason: 'Django management entry', confidence: 0.95 },
  { pattern: /^(src\/)?main\.py$/, kind: 'app', reason: 'Python program entry', confidence: 0.85 },
  { pattern: /^(app|wsgi|asgi)\.py$/, kind: 'server', reason: 'WSGI/ASGI application entry', confidence: 0.9 },
  { pattern: /__main__\.py$/, kind: 'cli', reason: 'Python module entry', confidence: 0.85 },
  { pattern: /Application\.java$/, kind: 'server', reason: 'Spring Boot application class', confidence: 0.9 },
  { pattern: /^.*\/Program\.cs$/, kind: 'server', reason: '.NET program entry', confidence: 0.9 },
  { pattern: /^Program\.cs$/, kind: 'server', reason: '.NET program entry', confidence: 0.9 },
  { pattern: /^public\/index\.php$/, kind: 'server', reason: 'PHP front controller', confidence: 0.9 },
  { pattern: /^artisan$/, kind: 'cli', reason: 'Laravel console entry', confidence: 0.9 },
  { pattern: /^(src\/)?worker\.[jt]s$/, kind: 'worker', reason: 'Background worker entry', confidence: 0.8 },
  { pattern: /^(src\/)?middleware\.[jt]s$/, kind: 'server', reason: 'Edge middleware entry', confidence: 0.85 },
];

export interface EntryPointResult {
  path: string;
  reason: string;
  kind: 'app' | 'server' | 'cli' | 'worker' | 'test' | 'build' | 'page';
  confidence: number;
}

export function detectEntryPoints(
  files: FileRecord[],
  manifests: ManifestData,
  fanIn: Map<string, number>,
): EntryPointResult[] {
  const results = new Map<string, EntryPointResult>();

  for (const file of files) {
    for (const rule of ENTRY_PATTERNS) {
      if (!rule.pattern.test(file.path)) continue;
      results.set(file.path, {
        path: file.path,
        reason: rule.reason,
        kind: rule.kind,
        confidence: rule.confidence,
      });
      break;
    }
  }

  for (const declared of manifests.declaredEntries) {
    const match = files.find((f) => f.path === declared || f.path.startsWith(`${declared}/`));
    if (match && !results.has(match.path)) {
      results.set(match.path, {
        path: match.path,
        reason: 'Declared in package manifest',
        kind: 'app',
        confidence: 0.85,
      });
    }
  }

  // Anything nothing imports, that imports plenty itself, is likely a root.
  const orphanRoots = files
    .filter(
      (file) =>
        !file.isTest &&
        !file.isGenerated &&
        (fanIn.get(file.path) ?? 0) === 0 &&
        file.fanOut >= 3 &&
        file.loc.code > 10,
    )
    .sort((a, b) => b.fanOut - a.fanOut)
    .slice(0, 8);

  for (const file of orphanRoots) {
    if (results.has(file.path)) continue;
    results.set(file.path, {
      path: file.path,
      reason: `Imported by nothing but pulls in ${file.fanOut} modules`,
      kind: 'app',
      confidence: 0.5,
    });
  }

  return [...results.values()].sort((a, b) => b.confidence - a.confidence);
}
