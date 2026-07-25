import type { LanguageId } from './types';

/**
 * Extension → language mapping. Extensions are matched longest-first so that
 * compound extensions such as `.d.ts` or `.blade.php` win over `.ts` / `.php`.
 */
const EXTENSION_MAP: Record<string, LanguageId> = {
  // TypeScript / JavaScript
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.d.ts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.svelte': 'javascript',
  '.vue': 'javascript',
  // Python
  '.py': 'python',
  '.pyi': 'python',
  '.pyw': 'python',
  // JVM
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sc': 'scala',
  // Go / Rust
  '.go': 'go',
  '.rs': 'rust',
  // .NET
  '.cs': 'csharp',
  '.csx': 'csharp',
  // PHP
  '.php': 'php',
  '.phtml': 'php',
  '.blade.php': 'php',
  // Others
  '.rb': 'ruby',
  '.rake': 'ruby',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.sql': 'sql',
  '.prisma': 'other',
  '.graphql': 'other',
  '.gql': 'other',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.sass': 'css',
  '.less': 'css',
  '.styl': 'css',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'shell',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.svg': 'xml',
};

const FILENAME_MAP: Record<string, LanguageId> = {
  dockerfile: 'shell',
  makefile: 'shell',
  rakefile: 'ruby',
  gemfile: 'ruby',
  procfile: 'yaml',
  '.env': 'shell',
  '.gitignore': 'other',
  '.npmrc': 'other',
};

const SORTED_EXTENSIONS = Object.keys(EXTENSION_MAP).sort((a, b) => b.length - a.length);

/** Longest known extension for a path, including compound extensions. */
export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  for (const ext of SORTED_EXTENSIONS) {
    if (base.endsWith(ext) && base !== ext) return ext;
  }
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

export function detectLanguage(path: string): LanguageId {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const byName = FILENAME_MAP[base];
  if (byName) return byName;
  if (base.startsWith('dockerfile')) return 'shell';
  if (base.startsWith('.env')) return 'shell';
  const ext = extensionOf(path);
  return EXTENSION_MAP[ext] ?? 'other';
}

const CODE_LANGUAGES = new Set<LanguageId>([
  'typescript',
  'javascript',
  'python',
  'java',
  'go',
  'rust',
  'csharp',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'scala',
  'c',
  'cpp',
  'sql',
  'shell',
]);

/** True for languages we count towards "lines of code" totals. */
export function isCodeLanguage(language: LanguageId): boolean {
  return CODE_LANGUAGES.has(language);
}

export const LANGUAGE_LABELS: Record<LanguageId, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  csharp: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  kotlin: 'Kotlin',
  swift: 'Swift',
  scala: 'Scala',
  c: 'C',
  cpp: 'C++',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  shell: 'Shell',
  markdown: 'Markdown',
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  other: 'Other',
};

/** Deterministic brand-ish colour per language, used across all charts. */
export const LANGUAGE_COLORS: Record<LanguageId, string> = {
  typescript: '#3b82f6',
  javascript: '#eab308',
  python: '#22c55e',
  java: '#f97316',
  go: '#06b6d4',
  rust: '#f43f5e',
  csharp: '#a855f7',
  php: '#818cf8',
  ruby: '#ef4444',
  kotlin: '#c084fc',
  swift: '#fb923c',
  scala: '#dc2626',
  c: '#64748b',
  cpp: '#0ea5e9',
  sql: '#14b8a6',
  html: '#fb7185',
  css: '#38bdf8',
  shell: '#84cc16',
  markdown: '#94a3b8',
  json: '#a3a3a3',
  yaml: '#94a3b8',
  toml: '#a8a29e',
  xml: '#78716c',
  other: '#6b7280',
};
