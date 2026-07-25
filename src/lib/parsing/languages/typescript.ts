import type {
  ExportRef,
  ImportRef,
  LanguageId,
  ParsedFile,
  SourceFile,
  SymbolDef,
} from '@/lib/core/types';
import { cyclomaticComplexity } from '../complexity';
import type { LanguageParser } from '../registry';
import { lineAt, matchBrace, SYNTAX_PROFILES, scanSource, type ScanResult } from '../scanner';
import {
  buildSymbol,
  collectCalls,
  collectEnvRefs,
  collectRenderedComponents,
  docCommentAbove,
  looksLikeComponent,
  readBraceBody,
  splitParams,
  type SymbolRange,
} from '../shared';

const IMPORT_FROM = /\bimport\s+(type\s+)?([^;'"`]*?)\s+from\s*(["'`])/g;
const IMPORT_BARE = /\bimport\s*(["'`])/g;
const IMPORT_DYNAMIC = /\bimport\s*\(\s*(["'`])/g;
const REQUIRE = /\brequire\s*\(\s*(["'`])/g;
const EXPORT_FROM = /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(["'`])/g;
const JEST_MOCK = /\b(?:jest|vi)\.(?:mock|doMock|unmock)\s*\(\s*(["'`])/g;

const CLASS_DECL =
  /(?:^|[^\w$.])(?:(export)\s+)?(?:(default)\s+)?(?:(abstract)\s+)?class\s+([A-Za-z_$][\w$]*)\s*(?:<[^{;=]*?>)?\s*(?:extends\s+([\w$.]+(?:<[^{]*?>)?)\s*)?(?:implements\s+([^{]+?)\s*)?\{/g;

const INTERFACE_DECL =
  /(?:^|[^\w$.])(?:(export)\s+)?(?:(default)\s+)?interface\s+([A-Za-z_$][\w$]*)\s*(?:<[^{]*?>)?\s*(?:extends\s+([^{]+?)\s*)?\{/g;

const TYPE_DECL = /(?:^|[^\w$.])(?:(export)\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*?>)?\s*=/g;

const ENUM_DECL =
  /(?:^|[^\w$.])(?:(export)\s+)?(?:(declare)\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\s*\{/g;

const FUNCTION_DECL =
  /(?:^|[^\w$.])(?:(export)\s+)?(?:(default)\s+)?(?:(async)\s+)?function(\s*\*)?\s+([A-Za-z_$][\w$]*)\s*(?:<[^(]*?>)?\s*\(/g;

const ARROW_DECL =
  /(?:^|[^\w$.])(?:(export)\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+?)?=\s*(?:(async)\s+)?(?:(\()|([A-Za-z_$][\w$]*)\s*=>|function(\s*\*)?\s*\()/g;

/** Groups: 1 visibility, 2 static, 3 abstract, 4 readonly, 5 async, 6 accessor, 7 generator, 8 private-`#`, 9 name. */
const METHOD_DECL =
  /(?:^|[\n{};])\s*(?:@[\w$.]+(?:\([^)]*\))?\s*)*(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(abstract)\s+)?(?:(readonly)\s+)?(?:(async)\s+)?(?:(get|set)\s+)?(\*\s*)?(#?)([A-Za-z_$][\w$]*)\s*(?:<[^(]*?>)?\s*\(/g;

/** Exported bindings that are plain values rather than functions. */
const VARIABLE_DECL =
  /(?:^|[^\w$.])(export)\s+(const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+?)?=/g;

const NAMED_EXPORT_BLOCK = /\bexport\s*\{([^}]*)\}/g;
const EXPORT_DEFAULT =
  /\bexport\s+default\s+(?!class\b|function\b|async\b|abstract\b)([A-Za-z_$][\w$]*)?/g;

const METHOD_KEYWORD_BLOCKLIST = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'constructor',
  'super',
  'typeof',
  'new',
  'do',
  'else',
  'try',
  'await',
  'yield',
  'import',
  'export',
  'delete',
  'void',
  'in',
  'of',
  'case',
  'default',
]);

function literalAtQuote(scan: ScanResult, quoteIndex: number): string | undefined {
  return scan.literalByStart.get(quoteIndex)?.value;
}

function collectImports(scan: ScanResult): ImportRef[] {
  const imports: ImportRef[] = [];
  const seen = new Set<string>();
  const code = scan.code;

  const push = (
    specifier: string | undefined,
    kind: ImportRef['kind'],
    symbols: string[],
    index: number,
  ) => {
    if (!specifier) return;
    const line = lineAt(scan, index);
    const key = `${specifier}|${kind}|${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    imports.push({ specifier, kind, symbols, line });
  };

  for (const match of code.matchAll(IMPORT_FROM)) {
    const quoteIndex = match.index + match[0].length - 1;
    const specifier = literalAtQuote(scan, quoteIndex);
    const clause = match[2] ?? '';
    const symbols = parseImportClause(clause);
    push(specifier, match[1] ? 'type' : 'static', symbols, match.index);
  }

  for (const match of code.matchAll(IMPORT_BARE)) {
    // Skip `import x from '…'` (handled above) and `import(` dynamic form.
    const after = code.slice(match.index, match.index + match[0].length);
    if (!/import\s*["'`]/.test(after)) continue;
    const quoteIndex = match.index + match[0].length - 1;
    push(literalAtQuote(scan, quoteIndex), 'side-effect', [], match.index);
  }

  for (const match of code.matchAll(IMPORT_DYNAMIC)) {
    const quoteIndex = match.index + match[0].length - 1;
    push(literalAtQuote(scan, quoteIndex), 'dynamic', [], match.index);
  }

  for (const match of code.matchAll(REQUIRE)) {
    const quoteIndex = match.index + match[0].length - 1;
    push(literalAtQuote(scan, quoteIndex), 'require', [], match.index);
  }

  for (const match of code.matchAll(EXPORT_FROM)) {
    const quoteIndex = match.index + match[0].length - 1;
    push(literalAtQuote(scan, quoteIndex), 'reexport', [], match.index);
  }

  for (const match of code.matchAll(JEST_MOCK)) {
    const quoteIndex = match.index + match[0].length - 1;
    push(literalAtQuote(scan, quoteIndex), 'dynamic', [], match.index);
  }

  return imports;
}

function parseImportClause(clause: string): string[] {
  const symbols: string[] = [];
  const trimmed = clause.trim();
  if (!trimmed) return symbols;

  const namespace = /\*\s*as\s+([\w$]+)/.exec(trimmed);
  if (namespace) symbols.push('*');

  const named = /\{([\s\S]*)\}/.exec(trimmed);
  if (named) {
    for (const entry of named[1].split(',')) {
      const name = entry
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim();
      if (name) symbols.push(name);
    }
  }

  const beforeBrace = trimmed.split('{')[0].split(',')[0].trim();
  if (beforeBrace && !beforeBrace.startsWith('*') && /^[\w$]+$/.test(beforeBrace)) {
    symbols.unshift('default');
  }

  return symbols;
}

function collectExports(scan: ScanResult, symbols: SymbolDef[]): ExportRef[] {
  const exports: ExportRef[] = [];
  const seen = new Set<string>();

  const push = (name: string, kind: ExportRef['kind'], line: number) => {
    const key = `${name}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    exports.push({ name, kind, line });
  };

  for (const symbol of symbols) {
    if (symbol.isExported) push(symbol.name, 'declaration', symbol.line);
  }

  for (const match of scan.code.matchAll(NAMED_EXPORT_BLOCK)) {
    const line = lineAt(scan, match.index);
    for (const entry of match[1].split(',')) {
      const cleaned = entry.trim().replace(/^type\s+/, '');
      if (!cleaned) continue;
      const parts = cleaned.split(/\s+as\s+/);
      const name = (parts[1] ?? parts[0]).trim();
      if (name) push(name, name === 'default' ? 'default' : 'named', line);
    }
  }

  for (const match of scan.code.matchAll(EXPORT_DEFAULT)) {
    push(match[1] ?? 'default', 'default', lineAt(scan, match.index));
  }

  if (/\bexport\s+\*/.test(scan.code)) push('*', 'namespace', 1);

  return exports;
}

function decoratorsAbove(code: string, index: number): string[] {
  const window = code.slice(Math.max(0, index - 400), index);
  const decorators: string[] = [];
  for (const match of window.matchAll(/@([\w$.]+)/g)) decorators.push(match[1]);
  return decorators;
}

function collectClassMembers(
  scan: ScanResult,
  path: string,
  className: string,
  bodyStart: number,
  bodyEnd: number,
  language: string,
): SymbolDef[] {
  const members: SymbolDef[] = [];
  const body = scan.code.slice(bodyStart, bodyEnd);
  const rex = new RegExp(METHOD_DECL.source, METHOD_DECL.flags);
  let match = rex.exec(body);

  while (match !== null) {
    const name = match[9];
    const nameOffset = match.index + match[0].lastIndexOf(name);
    const absolute = bodyStart + nameOffset;
    // Only direct members: nested function bodies sit at a deeper brace depth.
    // Depth is measured at the *name*, since a match may begin on the closing
    // brace of the preceding member.
    if (name && !METHOD_KEYWORD_BLOCKLIST.has(name) && depthAt(body, nameOffset) === 1) {
      const parenIndex = bodyStart + match.index + match[0].length - 1;
      const parenEnd = matchBrace(scan.code, parenIndex, '(', ')');
      const params = parenEnd > 0 ? splitParams(scan.code.slice(parenIndex + 1, parenEnd - 1)) : [];
      const memberBody = parenEnd > 0 ? readBraceBody(scan, parenEnd) : undefined;
      const line = lineAt(scan, absolute);
      const endLine = memberBody?.endLine ?? line;
      const returnType = parenEnd > 0 ? readReturnType(scan.code, parenEnd) : undefined;

      members.push(
        buildSymbol({
          path,
          name,
          kind: 'method',
          line,
          endLine,
          body: memberBody?.body ?? '',
          language,
          container: className,
          visibility: (match[1] as SymbolDef['visibility']) ?? (match[8] ? 'private' : 'public'),
          isStatic: Boolean(match[2]),
          isAbstract: Boolean(match[3]),
          isAsync: Boolean(match[5]),
          isGenerator: Boolean(match[7]?.trim()),
          params,
          returnType,
          decorators: decoratorsAbove(scan.code, absolute),
        }),
      );
    }
    match = rex.exec(body);
  }

  return members;
}

function depthAt(body: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (body[i] === '{') depth += 1;
    else if (body[i] === '}') depth -= 1;
  }
  return depth;
}

function readReturnType(code: string, afterParen: number): string | undefined {
  const slice = code.slice(afterParen, afterParen + 200);
  const match = /^\s*:\s*([^{;=]+)/.exec(slice);
  if (!match) return undefined;
  const type = match[1].trim();
  return type && type.length < 120 ? type : undefined;
}

function collectSymbols(scan: ScanResult, path: string, language: string): SymbolDef[] {
  const symbols: SymbolDef[] = [];
  const code = scan.code;
  const claimed: [number, number][] = [];

  // ---- classes -----------------------------------------------------------
  for (const match of code.matchAll(CLASS_DECL)) {
    const name = match[4];
    const nameIndex = match.index + match[0].indexOf(name);
    const braceIndex = match.index + match[0].length - 1;
    const bodyEnd = matchBrace(code, braceIndex);
    if (bodyEnd < 0) continue;
    const line = lineAt(scan, nameIndex);
    const endLine = lineAt(scan, bodyEnd - 1);
    const body = code.slice(braceIndex, bodyEnd);
    claimed.push([braceIndex, bodyEnd]);

    const members = collectClassMembers(scan, path, name, braceIndex, bodyEnd, language);

    symbols.push(
      buildSymbol({
        path,
        name,
        kind: 'class',
        line,
        endLine,
        body,
        language,
        isExported: Boolean(match[1]) || Boolean(match[2]),
        isAbstract: Boolean(match[3]),
        extends: match[5] ? [match[5].trim()] : undefined,
        implements: match[6]
          ? match[6]
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        decorators: decoratorsAbove(code, match.index),
        doc: docCommentAbove(scan.original, match.index, ['///', '//']),
      }),
    );
    symbols.push(...members);
  }

  // ---- interfaces --------------------------------------------------------
  for (const match of code.matchAll(INTERFACE_DECL)) {
    const name = match[3];
    const braceIndex = match.index + match[0].length - 1;
    const bodyEnd = matchBrace(code, braceIndex);
    if (bodyEnd < 0) continue;
    const nameIndex = match.index + match[0].indexOf(name);
    claimed.push([braceIndex, bodyEnd]);
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: 'interface',
        line: lineAt(scan, nameIndex),
        endLine: lineAt(scan, bodyEnd - 1),
        body: '',
        language,
        isExported: Boolean(match[1]) || Boolean(match[2]),
        extends: match[4]
          ? match[4]
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        doc: docCommentAbove(scan.original, match.index, ['///', '//']),
      }),
    );
  }

  // ---- enums -------------------------------------------------------------
  for (const match of code.matchAll(ENUM_DECL)) {
    const name = match[3];
    const braceIndex = match.index + match[0].length - 1;
    const bodyEnd = matchBrace(code, braceIndex);
    const nameIndex = match.index + match[0].indexOf(name);
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: 'enum',
        line: lineAt(scan, nameIndex),
        endLine: bodyEnd > 0 ? lineAt(scan, bodyEnd - 1) : lineAt(scan, nameIndex),
        body: '',
        language,
        isExported: Boolean(match[1]),
      }),
    );
  }

  // ---- type aliases ------------------------------------------------------
  for (const match of code.matchAll(TYPE_DECL)) {
    const name = match[2];
    const nameIndex = match.index + match[0].indexOf(name);
    const line = lineAt(scan, nameIndex);
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: 'type',
        line,
        endLine: line,
        body: '',
        language,
        isExported: Boolean(match[1]),
      }),
    );
  }

  // ---- function declarations ---------------------------------------------
  for (const match of code.matchAll(FUNCTION_DECL)) {
    const name = match[5];
    const nameIndex = match.index + match[0].indexOf(name);
    if (isClaimed(claimed, nameIndex)) continue;
    const parenIndex = match.index + match[0].length - 1;
    const parenEnd = matchBrace(code, parenIndex, '(', ')');
    const params = parenEnd > 0 ? splitParams(code.slice(parenIndex + 1, parenEnd - 1)) : [];
    const body = parenEnd > 0 ? readBraceBody(scan, parenEnd) : undefined;
    const line = lineAt(scan, nameIndex);
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: classifyFunction(name, body?.body ?? ''),
        renders: collectRenderedComponents(body?.body ?? ''),
        line,
        endLine: body?.endLine ?? line,
        body: body?.body ?? '',
        language,
        isExported: Boolean(match[1]) || Boolean(match[2]),
        isAsync: Boolean(match[3]),
        isGenerator: Boolean(match[4]),
        params,
        returnType: parenEnd > 0 ? readReturnType(code, parenEnd) : undefined,
        doc: docCommentAbove(scan.original, match.index, ['///', '//']),
      }),
    );
  }

  // ---- arrow / function expressions --------------------------------------
  for (const match of code.matchAll(ARROW_DECL)) {
    const name = match[2];
    const nameIndex = match.index + match[0].indexOf(name);
    if (isClaimed(claimed, nameIndex)) continue;
    const line = lineAt(scan, nameIndex);
    const arrowStart = match.index + match[0].length - 1;

    let params: string[] = [];
    let searchFrom = arrowStart;
    if (match[4] === '(' || match[6] !== undefined) {
      const parenEnd = matchBrace(code, arrowStart, '(', ')');
      if (parenEnd > 0) {
        params = splitParams(code.slice(arrowStart + 1, parenEnd - 1));
        searchFrom = parenEnd;
      }
    } else if (match[5]) {
      params = [match[5]];
    }

    const body = readArrowBody(scan, searchFrom);
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: classifyFunction(name, body.body),
        renders: collectRenderedComponents(body.body),
        line,
        endLine: body.endLine,
        body: body.body,
        language,
        isExported: Boolean(match[1]),
        isAsync: Boolean(match[3]),
        params,
        doc: docCommentAbove(scan.original, match.index, ['///', '//']),
      }),
    );
  }

  // ---- exported value bindings -------------------------------------------
  const captured = new Set(symbols.map((s) => s.name));
  for (const match of code.matchAll(VARIABLE_DECL)) {
    const name = match[3];
    if (captured.has(name)) continue;
    const nameIndex = match.index + match[0].lastIndexOf(name);
    if (isClaimed(claimed, nameIndex)) continue;
    const line = lineAt(scan, nameIndex);
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: match[2] === 'const' ? 'constant' : 'variable',
        line,
        endLine: line,
        body: '',
        language,
        isExported: true,
        doc: docCommentAbove(scan.original, match.index, ['///', '//']),
      }),
    );
  }

  return dedupeSymbols(symbols);
}

function isClaimed(ranges: [number, number][], index: number): boolean {
  return ranges.some(([start, end]) => index > start && index < end);
}

function readArrowBody(scan: ScanResult, from: number): { body: string; endLine: number } {
  const code = scan.code;
  const arrow = code.indexOf('=>', from);
  const braceBody = readBraceBody(scan, from);
  if (braceBody && (arrow < 0 || braceBody.bodyStart > arrow)) {
    return { body: braceBody.body, endLine: braceBody.endLine };
  }
  if (braceBody) return { body: braceBody.body, endLine: braceBody.endLine };
  // Expression-bodied arrow: take until the end of the statement.
  const stop = findStatementEnd(code, from);
  return { body: code.slice(from, stop), endLine: lineAt(scan, Math.max(from, stop - 1)) };
}

function findStatementEnd(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth < 0) return i;
    } else if ((ch === ';' || ch === '\n') && depth === 0) {
      if (ch === ';') return i;
      const rest = code.slice(i + 1, i + 40);
      if (/^\s*(export|const|let|var|function|class|interface|type|enum|\/)/.test(rest)) return i;
    }
  }
  return code.length;
}

function classifyFunction(name: string, body: string): SymbolDef['kind'] {
  if (/^use[A-Z]/.test(name)) return 'hook';
  if (looksLikeComponent(name, body)) return 'component';
  return 'function';
}

function dedupeSymbols(symbols: SymbolDef[]): SymbolDef[] {
  const byId = new Map<string, SymbolDef>();
  for (const symbol of symbols) {
    const existing = byId.get(symbol.id);
    if (!existing || symbol.loc > existing.loc) byId.set(symbol.id, symbol);
  }
  return [...byId.values()].sort((a, b) => a.line - b.line);
}

function createParser(id: string, language: LanguageId, extensions: string[]): LanguageParser {
  return {
    id,
    language,
    extensions,
    parse(file: SourceFile): ParsedFile {
      const profile =
        language === 'typescript' ? SYNTAX_PROFILES.typescript : SYNTAX_PROFILES.javascript;
      const scan = scanSource(file.content, profile);
      const symbols = collectSymbols(scan, file.path, 'typescript');
      const ranges: SymbolRange[] = symbols.map((s) => ({
        name: s.name,
        line: s.line,
        endLine: s.endLine,
      }));

      return {
        path: file.path,
        language,
        imports: collectImports(scan),
        exports: collectExports(scan, symbols),
        symbols,
        calls: collectCalls(scan, ranges),
        envRefs: collectEnvRefs(scan),
        complexity: cyclomaticComplexity(scan.code, 'typescript'),
        loc: scan.lines,
      };
    },
  };
}

export const typescriptParser = createParser('typescript', 'typescript', [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

export const javascriptParser = createParser('javascript', 'javascript', [
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
