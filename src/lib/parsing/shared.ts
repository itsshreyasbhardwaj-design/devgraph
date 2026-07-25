import type { CallRef, EnvRef, SymbolDef, SymbolKind } from '@/lib/core/types';
import { cyclomaticComplexity, maxBraceNesting, maxIndentNesting } from './complexity';
import { lineAt, matchBrace, type ScanResult } from './scanner';

export function symbolId(path: string, name: string, line: number): string {
  return `${path}#${name}@${line}`;
}

/** Reserved words that look like calls but are control flow. */
const CALL_KEYWORD_BLOCKLIST = new Set([
  'if',
  'for',
  'foreach',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'fn',
  'func',
  'def',
  'class',
  'struct',
  'enum',
  'interface',
  'match',
  'with',
  'do',
  'else',
  'elif',
  'elseif',
  'try',
  'except',
  'finally',
  'and',
  'or',
  'not',
  'in',
  'is',
  'new',
  'typeof',
  'instanceof',
  'sizeof',
  'defer',
  'go',
  'select',
  'case',
  'lambda',
  'yield',
  'await',
  'async',
  'print',
  'assert',
  'throw',
  'raise',
  'use',
  'require',
  'import',
  'export',
  'let',
  'const',
  'var',
  'public',
  'private',
  'protected',
  'static',
  'void',
  'super',
  'this',
  'self',
  'echo',
  'unset',
  'isset',
  'empty',
  'array',
  'list',
  'exit',
  'die',
]);

const CALL_PATTERN = /([A-Za-z_$][A-Za-z0-9_$]*(?:\s*[.:>-]{1,2}\s*[A-Za-z_$][A-Za-z0-9_$]*)*)\s*\(/g;

export interface SymbolRange {
  name: string;
  line: number;
  endLine: number;
}

/**
 * Find every call expression in the masked source and attribute it to the
 * innermost enclosing symbol.
 */
export function collectCalls(scan: ScanResult, symbols: SymbolRange[]): CallRef[] {
  const calls: CallRef[] = [];
  const sorted = [...symbols].sort((a, b) => a.line - b.line || b.endLine - a.endLine);
  const seen = new Set<string>();

  for (const match of scan.code.matchAll(CALL_PATTERN)) {
    const raw = match[1];
    const chain = raw.split(/\s*[.:>-]{1,2}\s*/).filter(Boolean);
    const callee = chain[chain.length - 1];
    if (!callee || CALL_KEYWORD_BLOCKLIST.has(callee)) continue;
    // A declaration like `function foo(` is not a call site.
    const before = scan.code.slice(Math.max(0, match.index - 24), match.index);
    if (/\b(function|def|fn|func|class|interface|struct|new)\s+$/.test(before)) continue;

    const line = lineAt(scan, match.index);
    const from = enclosingSymbol(sorted, line) ?? '<module>';
    const receiver = chain.length > 1 ? chain.slice(0, -1).join('.') : undefined;
    const key = `${from}->${callee}@${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ from, to: callee, line, receiver });
  }

  return calls;
}

function enclosingSymbol(sorted: SymbolRange[], line: number): string | undefined {
  let best: SymbolRange | undefined;
  for (const symbol of sorted) {
    if (symbol.line > line) break;
    if (line <= symbol.endLine) {
      if (!best || symbol.line >= best.line) best = symbol;
    }
  }
  return best?.name;
}

const ENV_PATTERNS: { re: RegExp; group: number; accessor: string }[] = [
  // JS/TS
  { re: /process\.env\.([A-Z0-9_]+)/g, group: 1, accessor: 'process.env' },
  { re: /process\.env\[\s*["'`]([^"'`]+)["'`]\s*\]/g, group: 1, accessor: 'process.env' },
  { re: /import\.meta\.env\.([A-Za-z0-9_]+)/g, group: 1, accessor: 'import.meta.env' },
  { re: /Deno\.env\.get\(\s*["'`]([^"'`]+)["'`]\s*\)/g, group: 1, accessor: 'Deno.env' },
  // Python
  { re: /os\.environ\.get\(\s*["'`]([^"'`]+)["'`]/g, group: 1, accessor: 'os.environ' },
  { re: /os\.environ\[\s*["'`]([^"'`]+)["'`]\s*\]/g, group: 1, accessor: 'os.environ' },
  { re: /os\.getenv\(\s*["'`]([^"'`]+)["'`]/g, group: 1, accessor: 'os.getenv' },
  // Go
  { re: /os\.Getenv\(\s*"([^"]+)"/g, group: 1, accessor: 'os.Getenv' },
  { re: /os\.LookupEnv\(\s*"([^"]+)"/g, group: 1, accessor: 'os.LookupEnv' },
  // Rust
  { re: /(?:std::)?env::var(?:_os)?\(\s*"([^"]+)"/g, group: 1, accessor: 'std::env::var' },
  // Java / Kotlin
  { re: /System\.getenv\(\s*"([^"]+)"/g, group: 1, accessor: 'System.getenv' },
  { re: /getProperty\(\s*"([A-Za-z0-9_.]+)"/g, group: 1, accessor: 'System.getProperty' },
  // C#
  {
    re: /Environment\.GetEnvironmentVariable\(\s*"([^"]+)"/g,
    group: 1,
    accessor: 'Environment.GetEnvironmentVariable',
  },
  { re: /Configuration\[\s*"([^"]+)"\s*\]/g, group: 1, accessor: 'IConfiguration' },
  // PHP
  { re: /getenv\(\s*['"]([^'"]+)['"]/g, group: 1, accessor: 'getenv' },
  { re: /\$_ENV\[\s*['"]([^'"]+)['"]\s*\]/g, group: 1, accessor: '$_ENV' },
  { re: /\$_SERVER\[\s*['"]([A-Z0-9_]+)['"]\s*\]/g, group: 1, accessor: '$_SERVER' },
  { re: /\benv\(\s*['"]([A-Z0-9_]+)['"]/g, group: 1, accessor: 'env()' },
];

/**
 * Environment variable references. Runs against the *original* source because
 * the variable name lives inside a string literal that the mask blanks out.
 */
export function collectEnvRefs(scan: ScanResult): EnvRef[] {
  const refs: EnvRef[] = [];
  const seen = new Set<string>();
  for (const { re, group, accessor } of ENV_PATTERNS) {
    const rex = new RegExp(re.source, re.flags);
    let match = rex.exec(scan.original);
    while (match !== null) {
      const name = match[group];
      if (name && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) {
        const line = lineAt(scan, match.index);
        const key = `${name}@${line}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push({ name, line, accessor });
        }
      }
      match = rex.exec(scan.original);
    }
  }
  return refs;
}

/** Split a parameter list into individual parameter descriptors. */
export function splitParams(raw: string): string[] {
  const params: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth -= 1;
    if (ch === ',' && depth === 0) {
      if (current.trim()) params.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

/** Read a balanced `(...)` starting at `open`; returns the inner text. */
export function readParens(code: string, open: number): { inner: string; end: number } {
  const end = matchBrace(code, open, '(', ')');
  if (end < 0) return { inner: '', end: open + 1 };
  return { inner: code.slice(open + 1, end - 1), end };
}

export interface BraceBodyResult {
  bodyStart: number;
  bodyEnd: number;
  body: string;
  endLine: number;
}

/**
 * Locate the `{ … }` body that follows a declaration header. Stops at `;` so
 * abstract/interface members without bodies are handled correctly.
 */
export function readBraceBody(scan: ScanResult, from: number): BraceBodyResult | undefined {
  const code = scan.code;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') {
      const end = matchBrace(code, i);
      if (end < 0) return undefined;
      return {
        bodyStart: i,
        bodyEnd: end,
        body: code.slice(i, end),
        endLine: lineAt(scan, end - 1),
      };
    }
    if (ch === ';') return undefined;
    if (ch === '=' && code[i + 1] === '>') continue;
  }
  return undefined;
}

/**
 * Body of an indentation-scoped declaration (Python). Returns the masked block
 * and the last line belonging to it.
 */
export function readIndentBody(
  scan: ScanResult,
  declLine: number,
): { body: string; endLine: number } {
  const lines = scan.code.split('\n');
  const declIndex = declLine - 1;
  const declIndent = indentOf(lines[declIndex] ?? '');
  let end = declIndex;
  for (let i = declIndex + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    if (indentOf(raw) <= declIndent) break;
    end = i;
  }
  return {
    body: lines.slice(declIndex, end + 1).join('\n'),
    endLine: end + 1,
  };
}

export function indentOf(line: string): number {
  let indent = 0;
  for (const ch of line) {
    if (ch === ' ') indent += 1;
    else if (ch === '\t') indent += 4;
    else break;
  }
  return indent;
}

export interface BuildSymbolOptions {
  path: string;
  name: string;
  kind: SymbolKind;
  line: number;
  endLine: number;
  body: string;
  language: string;
  container?: string;
  visibility?: SymbolDef['visibility'];
  isAsync?: boolean;
  isStatic?: boolean;
  isAbstract?: boolean;
  isExported?: boolean;
  isGenerator?: boolean;
  params?: string[];
  returnType?: string;
  extends?: string[];
  implements?: string[];
  decorators?: string[];
  renders?: string[];
  doc?: string;
  indentScoped?: boolean;
}

export function buildSymbol(options: BuildSymbolOptions): SymbolDef {
  const {
    path,
    name,
    kind,
    line,
    endLine,
    body,
    language,
    indentScoped = false,
    params = [],
    ...rest
  } = options;

  return {
    id: symbolId(path, name, line),
    name,
    kind,
    path,
    line,
    endLine,
    params,
    complexity: cyclomaticComplexity(body, language),
    loc: Math.max(1, endLine - line + 1),
    maxNesting: indentScoped ? maxIndentNesting(body) : maxBraceNesting(body),
    ...rest,
  };
}

/** Leading `///`, `//`, `/** … *\/` or `#` documentation above a declaration. */
export function docCommentAbove(original: string, declOffset: number, prefixes: string[]): string | undefined {
  const before = original.slice(Math.max(0, declOffset - 2000), declOffset);
  const lines = before.split('\n');
  lines.pop(); // partial line containing the declaration
  const collected: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (collected.length) break;
      continue;
    }
    if (trimmed.endsWith('*/')) {
      const block: string[] = [];
      let j = i;
      while (j >= 0 && !lines[j].includes('/*')) {
        block.unshift(lines[j]);
        j -= 1;
      }
      if (j >= 0) block.unshift(lines[j]);
      const text = block
        .join('\n')
        .replace(/\/\*+|\*+\//g, '')
        .split('\n')
        .map((l) => l.replace(/^\s*\*?\s?/, '').trimEnd())
        .join('\n')
        .trim();
      return text || undefined;
    }
    const prefix = prefixes.find((p) => trimmed.startsWith(p));
    if (!prefix) break;
    collected.unshift(trimmed.slice(prefix.length).trim());
  }
  const doc = collected.join('\n').trim();
  return doc || undefined;
}

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;

/** Heuristic: does this function look like a UI component? */
export function looksLikeComponent(name: string, body: string): boolean {
  if (!COMPONENT_NAME.test(name)) return false;
  return (
    /return\s*\(?\s*</.test(body) ||
    /<\/[A-Za-z]/.test(body) ||
    /jsx|createElement|_jsxs?\(/.test(body)
  );
}

/** JSX/TSX elements rendered inside a component body, capitalised only. */
export function collectRenderedComponents(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(/<([A-Z][A-Za-z0-9_.]*)/g)) {
    names.add(match[1].split('.')[0]);
  }
  return [...names];
}
