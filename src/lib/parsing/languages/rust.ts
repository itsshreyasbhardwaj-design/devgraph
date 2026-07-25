import type { ExportRef, ImportRef, ParsedFile, SourceFile, SymbolDef } from '@/lib/core/types';
import { cyclomaticComplexity } from '../complexity';
import type { LanguageParser } from '../registry';
import { lineAt, matchBrace, SYNTAX_PROFILES, scanSource, type ScanResult } from '../scanner';
import {
  buildSymbol,
  collectCalls,
  collectEnvRefs,
  docCommentAbove,
  readBraceBody,
  splitParams,
  type SymbolRange,
} from '../shared';

const USE_DECL = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm;
const MOD_DECL = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*[;{]/gm;
const EXTERN_CRATE = /^[ \t]*extern\s+crate\s+([A-Za-z_]\w*)/gm;
const STRUCT_DECL =
  /(?:^|[^\w])(?:(pub)(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)(?:\s*<[^>{;]*>)?\s*[{(;]/gm;
const ENUM_DECL =
  /(?:^|[^\w])(?:(pub)(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)(?:\s*<[^>{]*>)?\s*\{/gm;
const TRAIT_DECL =
  /(?:^|[^\w])(?:(pub)(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+([A-Za-z_]\w*)(?:\s*<[^>{]*>)?\s*(?::[^{]*)?\{/gm;
const IMPL_DECL =
  /(?:^|[^\w])impl(?:\s*<[^>]*>)?\s+(?:([\w:]+)(?:\s*<[^>]*>)?\s+for\s+)?([\w:]+)(?:\s*<[^>]*>)?\s*(?:where[^{]*)?\{/gm;
const FN_DECL =
  /(?:^|[^\w])(?:(pub)(?:\([^)]*\))?\s+)?(?:(const)\s+)?(?:(async)\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)(?:\s*<[^>(]*>)?\s*\(/gm;
const TYPE_ALIAS =
  /(?:^|[^\w])(?:(pub)(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)(?:\s*<[^>=]*>)?\s*=/gm;

/** Expand `use a::{b, c::d}` into individual paths. */
function expandUse(spec: string): string[] {
  // Strip `as` aliases before collapsing whitespace — otherwise the literal
  // substring "as" inside identifiers such as `HashMap` would be split on.
  const cleaned = spec.replace(/\s+as\s+\w+/g, '').replace(/\s+/g, '');
  const brace = cleaned.indexOf('{');
  if (brace === -1) return [cleaned];
  const prefix = cleaned.slice(0, brace);
  const inner = cleaned.slice(brace + 1, cleaned.lastIndexOf('}'));
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      if (current) parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts.flatMap((part) => expandUse(prefix + part));
}

function collectImports(scan: ScanResult): ImportRef[] {
  const imports: ImportRef[] = [];
  const code = scan.code;

  for (const match of code.matchAll(USE_DECL)) {
    const line = lineAt(scan, match.index);
    for (const specifier of expandUse(match[1])) {
      if (!specifier) continue;
      const segments = specifier.split('::');
      imports.push({
        specifier,
        kind: 'static',
        symbols: [segments[segments.length - 1] || '*'],
        line,
      });
    }
  }

  for (const match of code.matchAll(MOD_DECL)) {
    imports.push({
      specifier: `self::${match[1]}`,
      kind: 'static',
      symbols: ['*'],
      line: lineAt(scan, match.index),
    });
  }

  for (const match of code.matchAll(EXTERN_CRATE)) {
    imports.push({
      specifier: match[1],
      kind: 'static',
      symbols: ['*'],
      line: lineAt(scan, match.index),
    });
  }

  return imports;
}

function collectSymbols(scan: ScanResult, path: string): SymbolDef[] {
  const symbols: SymbolDef[] = [];
  const code = scan.code;
  /** Blocks that own the `fn`s declared inside them: `impl` and `trait`. */
  const containers: { type: string; trait?: string; start: number; end: number }[] = [];

  for (const match of code.matchAll(IMPL_DECL)) {
    const braceIndex = match.index + match[0].length - 1;
    const end = matchBrace(code, braceIndex);
    if (end < 0) continue;
    containers.push({ type: match[2], trait: match[1], start: braceIndex, end });
  }

  for (const match of code.matchAll(TRAIT_DECL)) {
    const braceIndex = match.index + match[0].length - 1;
    const end = matchBrace(code, braceIndex);
    if (end < 0) continue;
    containers.push({ type: match[2], start: braceIndex, end });
  }

  const declare = (
    match: RegExpExecArray | RegExpMatchArray,
    name: string,
    kind: SymbolDef['kind'],
    hasBody: boolean,
  ) => {
    const nameIndex = (match.index ?? 0) + match[0].indexOf(name);
    const line = lineAt(scan, nameIndex);
    let endLine = line;
    let body = '';
    if (hasBody) {
      const braceIndex = (match.index ?? 0) + match[0].length - 1;
      if (code[braceIndex] === '{') {
        const end = matchBrace(code, braceIndex);
        if (end > 0) {
          endLine = lineAt(scan, end - 1);
          body = code.slice(braceIndex, end);
        }
      }
    }
    symbols.push(
      buildSymbol({
        path,
        name,
        kind,
        line,
        endLine,
        body,
        language: 'rust',
        isExported: Boolean(match[1]),
        visibility: match[1] ? 'public' : 'private',
        doc: docCommentAbove(scan.original, match.index ?? 0, ['///', '//!', '//']),
      }),
    );
  };

  for (const match of code.matchAll(STRUCT_DECL)) declare(match, match[2], 'struct', true);
  for (const match of code.matchAll(ENUM_DECL)) declare(match, match[2], 'enum', true);
  for (const match of code.matchAll(TRAIT_DECL)) declare(match, match[2], 'trait', true);
  for (const match of code.matchAll(TYPE_ALIAS)) declare(match, match[2], 'type', false);

  for (const match of code.matchAll(FN_DECL)) {
    const name = match[4];
    const nameIndex = match.index + match[0].lastIndexOf(name);
    const parenIndex = match.index + match[0].length - 1;
    const parenEnd = matchBrace(code, parenIndex, '(', ')');
    const params =
      parenEnd > 0
        ? splitParams(code.slice(parenIndex + 1, parenEnd - 1)).filter(
            (p) => !/^&?(mut\s+)?self$/.test(p.trim()),
          )
        : [];
    const body = parenEnd > 0 ? readBraceBody(scan, parenEnd) : undefined;
    const line = lineAt(scan, nameIndex);
    const owner = containers.find((c) => nameIndex > c.start && nameIndex < c.end);
    const returnMatch =
      parenEnd > 0 ? /^\s*->\s*([^{;]+)/.exec(code.slice(parenEnd, parenEnd + 160)) : null;

    symbols.push(
      buildSymbol({
        path,
        name,
        kind: owner ? 'method' : 'function',
        line,
        endLine: body?.endLine ?? line,
        body: body?.body ?? '',
        language: 'rust',
        container: owner?.type,
        implements: owner?.trait ? [owner.trait] : undefined,
        isExported: Boolean(match[1]),
        isAsync: Boolean(match[3]),
        visibility: match[1] ? 'public' : 'private',
        params,
        returnType: returnMatch?.[1]?.trim(),
        doc: docCommentAbove(scan.original, match.index, ['///', '//!', '//']),
      }),
    );
  }

  return symbols.sort((a, b) => a.line - b.line);
}

export const rustParser: LanguageParser = {
  id: 'rust',
  language: 'rust',
  extensions: ['.rs'],
  parse(file: SourceFile): ParsedFile {
    const scan = scanSource(file.content, SYNTAX_PROFILES.rust);
    const symbols = collectSymbols(scan, file.path);
    const ranges: SymbolRange[] = symbols.map((s) => ({
      name: s.name,
      line: s.line,
      endLine: s.endLine,
    }));
    const exports: ExportRef[] = symbols
      .filter((s) => s.isExported)
      .map((s) => ({ name: s.name, kind: 'declaration' as const, line: s.line }));

    return {
      path: file.path,
      language: 'rust',
      imports: collectImports(scan),
      exports,
      symbols,
      calls: collectCalls(scan, ranges),
      envRefs: collectEnvRefs(scan),
      complexity: cyclomaticComplexity(scan.code, 'rust'),
      loc: scan.lines,
    };
  },
};
