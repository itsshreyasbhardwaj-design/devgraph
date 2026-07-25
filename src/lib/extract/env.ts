import type { EnvVarRecord, ParsedFile, SourceFile } from '@/lib/core/types';
import { basename } from '@/lib/core/paths';

/**
 * Environment configuration extraction.
 *
 * Combines two signals: variables *referenced* in code (collected by the
 * language parsers) and variables *declared* in `.env` templates, Docker
 * Compose files, CI workflows and Kubernetes manifests.
 *
 * Values are never read. Only names, declaration sites and usage sites are
 * recorded, so committing a real `.env` by accident cannot leak secrets through
 * an analysis result.
 */

const SENSITIVE_PATTERN =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|APIKEY|API_KEY|PRIVATE|CREDENTIAL|AUTH|SIGNING|SALT|CERT|SSN|ACCESS_KEY|CLIENT_SECRET|WEBHOOK_SECRET|DSN|CONNECTION_STRING|DATABASE_URL)/i;

/** Prefixes that a bundler inlines into client-side JavaScript. */
const CLIENT_PREFIXES = [
  'NEXT_PUBLIC_',
  'VITE_',
  'REACT_APP_',
  'PUBLIC_',
  'NUXT_PUBLIC_',
  'GATSBY_',
  'EXPO_PUBLIC_',
  'VUE_APP_',
  'STORYBOOK_',
];

export function isEnvFile(path: string): boolean {
  const base = basename(path);
  return (
    base === '.env' ||
    base.startsWith('.env.') ||
    base === 'env.example' ||
    base === '.env.example' ||
    base === '.env.sample' ||
    base === '.env.template'
  );
}

function isDeclarationFile(path: string): boolean {
  const base = basename(path).toLowerCase();
  if (isEnvFile(path)) return true;
  if (/^(docker-)?compose\.ya?ml$/.test(base)) return true;
  if (/^dockerfile/.test(base)) return true;
  if (/^\.github\/workflows\//.test(path)) return true;
  if (/^(app|fly|vercel|netlify|railway|render)\.(toml|json|yaml|yml)$/.test(base)) return true;
  return /\.(ya?ml|tf)$/.test(path) && /(k8s|kubernetes|manifests|deploy|charts|infra)/.test(path);
}

interface Declaration {
  name: string;
  file: string;
  hasDefault: boolean;
}

function parseDeclarations(file: SourceFile): Declaration[] {
  const declarations: Declaration[] = [];
  const base = basename(file.path);

  if (isEnvFile(file.path)) {
    for (const raw of file.content.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
      if (!match) continue;
      declarations.push({
        name: match[1],
        file: file.path,
        hasDefault: match[2].trim().length > 0,
      });
    }
    return declarations;
  }

  if (/^dockerfile/i.test(base)) {
    for (const match of file.content.matchAll(/^\s*(?:ENV|ARG)\s+([A-Za-z_][A-Za-z0-9_]*)(?:[=\s](.*))?$/gim)) {
      declarations.push({
        name: match[1],
        file: file.path,
        hasDefault: Boolean(match[2]?.trim()),
      });
    }
    return declarations;
  }

  // YAML-ish: `environment:` / `env:` blocks and `${VAR}` interpolation.
  for (const match of file.content.matchAll(/^\s*-?\s*([A-Z][A-Z0-9_]{2,})\s*:\s*(.*)$/gm)) {
    declarations.push({ name: match[1], file: file.path, hasDefault: Boolean(match[2].trim()) });
  }
  for (const match of file.content.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g)) {
    declarations.push({ name: match[1], file: file.path, hasDefault: false });
  }
  for (const match of file.content.matchAll(/secrets\.([A-Z][A-Z0-9_]{2,})/g)) {
    declarations.push({ name: match[1], file: file.path, hasDefault: false });
  }

  return declarations;
}

export interface EnvExtractionInput {
  sources: SourceFile[];
  parsed: Map<string, ParsedFile>;
}

export function extractEnv(input: EnvExtractionInput): EnvVarRecord[] {
  const byName = new Map<string, EnvVarRecord>();

  const ensure = (name: string): EnvVarRecord => {
    const existing = byName.get(name);
    if (existing) return existing;
    const record: EnvVarRecord = {
      name,
      usages: [],
      declaredIn: [],
      hasDefault: false,
      sensitive: SENSITIVE_PATTERN.test(name),
      clientExposed: CLIENT_PREFIXES.some((prefix) => name.startsWith(prefix)),
    };
    byName.set(name, record);
    return record;
  };

  for (const parsed of input.parsed.values()) {
    for (const ref of parsed.envRefs) {
      const record = ensure(ref.name);
      record.usages.push({ path: parsed.path, line: ref.line, accessor: ref.accessor });
    }
  }

  for (const file of input.sources) {
    if (!isDeclarationFile(file.path)) continue;
    for (const declaration of parseDeclarations(file)) {
      // Declarations alone are noisy in YAML; only keep names already used in
      // code, or ones from a real `.env` template where intent is unambiguous.
      const known = byName.has(declaration.name);
      if (!known && !isEnvFile(file.path)) continue;
      const record = ensure(declaration.name);
      if (!record.declaredIn.includes(declaration.file)) record.declaredIn.push(declaration.file);
      record.hasDefault = record.hasDefault || declaration.hasDefault;
    }
  }

  return [...byName.values()]
    .filter((record) => record.usages.length > 0 || record.declaredIn.length > 0)
    .sort((a, b) => b.usages.length - a.usages.length || a.name.localeCompare(b.name));
}

/**
 * Configuration risks worth surfacing: secrets that a bundler would inline into
 * the client, and variables used in code but never declared anywhere.
 */
export function envWarnings(records: EnvVarRecord[]): string[] {
  const warnings: string[] = [];

  const exposedSecrets = records.filter((r) => r.clientExposed && r.sensitive);
  if (exposedSecrets.length) {
    warnings.push(
      `${exposedSecrets.length} client-exposed variable(s) look like secrets: ${exposedSecrets
        .slice(0, 5)
        .map((r) => r.name)
        .join(', ')}. Bundlers inline these into browser JavaScript.`,
    );
  }

  const undeclared = records.filter((r) => r.usages.length > 0 && r.declaredIn.length === 0);
  if (undeclared.length > 3) {
    warnings.push(
      `${undeclared.length} environment variables are read in code but never declared in an .env template, so new contributors cannot know they exist.`,
    );
  }

  return warnings;
}
