import type { ExportRef, ImportRef, ParsedFile, SourceFile, SymbolDef } from '@/lib/core/types';
import { cyclomaticComplexity } from '../complexity';
import type { LanguageParser } from '../registry';
import { lineAt, SYNTAX_PROFILES, scanSource, type ScanResult } from '../scanner';
import {
  buildSymbol,
  collectCalls,
  collectEnvRefs,
  indentOf,
  readIndentBody,
  splitParams,
  type SymbolRange,
} from '../shared';

const IMPORT_PLAIN = /^[ \t]*import\s+([^\n#]+)/gm;
const IMPORT_FROM = /^[ \t]*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm;
const CLASS_DECL = /^([ \t]*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/gm;
const DEF_DECL = /^([ \t]*)(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;
const DUNDER_ALL = /__all__\s*=\s*[[(]([^\])]*)[\])]/;

function collectImports(scan: ScanResult): ImportRef[] {
  const imports: ImportRef[] = [];
  const code = scan.code;

  for (const match of code.matchAll(IMPORT_PLAIN)) {
    // `from x import y` also matches `import`; skip when preceded by `from`.
    const lineStart = code.lastIndexOf('\n', match.index) + 1;
    if (/^\s*from\s/.test(code.slice(lineStart, match.index + 6))) continue;
    const line = lineAt(scan, match.index);
    for (const entry of match[1].split(',')) {
      const specifier = entry.trim().split(/\s+as\s+/)[0].trim();
      if (specifier) imports.push({ specifier, kind: 'static', symbols: ['*'], line });
    }
  }

  for (const match of code.matchAll(IMPORT_FROM)) {
    const line = lineAt(scan, match.index);
    const symbols = match[2]
      .replace(/[()]/g, '')
      .split(',')
      .map((entry) => entry.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean);
    imports.push({ specifier: match[1], kind: 'static', symbols, line });
  }

  return imports;
}

function decoratorsAbove(scan: ScanResult, declLine: number): string[] {
  const lines = scan.code.split('\n');
  const decorators: string[] = [];
  for (let i = declLine - 2; i >= 0; i -= 1) {
    const trimmed = lines[i]?.trim() ?? '';
    if (!trimmed) continue;
    if (!trimmed.startsWith('@')) break;
    decorators.unshift(trimmed.slice(1).split('(')[0].trim());
  }
  return decorators;
}

function docstringFor(scan: ScanResult, declLine: number): string | undefined {
  const doc = scan.literals.find((l) => l.kind === 'doc' && l.line >= declLine && l.line <= declLine + 3);
  if (!doc) return undefined;
  const text = doc.value.trim();
  return text ? text.slice(0, 400) : undefined;
}

function collectSymbols(scan: ScanResult, path: string): SymbolDef[] {
  const symbols: SymbolDef[] = [];
  const code = scan.code;
  const classRanges: { name: string; start: number; end: number; indent: number }[] = [];

  for (const match of code.matchAll(CLASS_DECL)) {
    const name = match[2];
    const line = lineAt(scan, match.index + match[0].indexOf(name));
    const { body, endLine } = readIndentBody(scan, line);
    const bases = (match[3] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.includes('='));

    classRanges.push({ name, start: line, end: endLine, indent: indentOf(match[1]) });
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: 'class',
        line,
        endLine,
        body,
        language: 'python',
        indentScoped: true,
        isExported: !name.startsWith('_'),
        extends: bases.length ? bases : undefined,
        decorators: decoratorsAbove(scan, line),
        doc: docstringFor(scan, line),
      }),
    );
  }

  for (const match of code.matchAll(DEF_DECL)) {
    const name = match[3];
    const nameIndex = match.index + match[0].indexOf(name);
    const line = lineAt(scan, nameIndex);
    const { body, endLine } = readIndentBody(scan, line);
    const parenIndex = match.index + match[0].length - 1;
    const closeIndex = findMatching(code, parenIndex);
    const params = closeIndex > 0 ? splitParams(code.slice(parenIndex + 1, closeIndex)) : [];
    const container = classRanges.find(
      (c) => line > c.start && line <= c.end && indentOf(match[1]) > c.indent,
    );
    const returnMatch = closeIndex > 0 ? /^\s*->\s*([^:\n]+)/.exec(code.slice(closeIndex + 1, closeIndex + 120)) : null;

    symbols.push(
      buildSymbol({
        path,
        name,
        kind: container ? 'method' : 'function',
        line,
        endLine,
        body,
        language: 'python',
        indentScoped: true,
        container: container?.name,
        visibility: name.startsWith('__') ? 'private' : name.startsWith('_') ? 'protected' : 'public',
        isAsync: Boolean(match[2]),
        isExported: !name.startsWith('_'),
        params: params.filter((p) => p !== 'self' && p !== 'cls'),
        returnType: returnMatch?.[1]?.trim(),
        decorators: decoratorsAbove(scan, line),
        doc: docstringFor(scan, line),
      }),
    );
  }

  return symbols.sort((a, b) => a.line - b.line);
}

function findMatching(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function collectExports(scan: ScanResult, symbols: SymbolDef[]): ExportRef[] {
  const explicit = DUNDER_ALL.exec(scan.original);
  if (explicit) {
    return explicit[1]
      .split(',')
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
      .map((name) => ({ name, kind: 'named' as const, line: lineAt(scan, explicit.index) }));
  }
  return symbols
    .filter((s) => !s.container && !s.name.startsWith('_'))
    .map((s) => ({ name: s.name, kind: 'declaration' as const, line: s.line }));
}

export const pythonParser: LanguageParser = {
  id: 'python',
  language: 'python',
  extensions: ['.py', '.pyi', '.pyw'],
  parse(file: SourceFile): ParsedFile {
    const scan = scanSource(file.content, SYNTAX_PROFILES.python);
    const symbols = collectSymbols(scan, file.path);
    const ranges: SymbolRange[] = symbols.map((s) => ({
      name: s.name,
      line: s.line,
      endLine: s.endLine,
    }));

    return {
      path: file.path,
      language: 'python',
      imports: collectImports(scan),
      exports: collectExports(scan, symbols),
      symbols,
      calls: collectCalls(scan, ranges),
      envRefs: collectEnvRefs(scan),
      complexity: cyclomaticComplexity(scan.code, 'python'),
      loc: scan.lines,
    };
  },
};
