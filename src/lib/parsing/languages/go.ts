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

const IMPORT_BLOCK = /\bimport\s*\(/g;
const IMPORT_SINGLE = /\bimport\s+(?:[\w.]+\s+)?(")/g;
const FUNC_DECL =
  /\bfunc\s+(?:\(\s*[\w*\s]+?\s+([\w*[\].]+)\s*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)?\(/g;
const TYPE_DECL = /\btype\s+([A-Za-z_]\w*)(?:\s*\[[^\]]*\])?\s+(struct|interface)\s*\{/g;
const TYPE_ALIAS = /\btype\s+([A-Za-z_]\w*)\s*=?\s*([\w.*[\]]+)\s*(?:\n|$)/g;
const PACKAGE_DECL = /^\s*package\s+([\w]+)/m;

function collectImports(scan: ScanResult): ImportRef[] {
  const imports: ImportRef[] = [];
  const code = scan.code;

  for (const match of code.matchAll(IMPORT_BLOCK)) {
    const open = match.index + match[0].length - 1;
    const close = matchBrace(code, open, '(', ')');
    if (close < 0) continue;
    for (const literal of scan.literals) {
      if (literal.start <= open || literal.start >= close) continue;
      imports.push({
        specifier: literal.value,
        kind: 'static',
        symbols: ['*'],
        line: literal.line,
      });
    }
  }

  for (const match of code.matchAll(IMPORT_SINGLE)) {
    const quoteIndex = match.index + match[0].length - 1;
    const literal = scan.literalByStart.get(quoteIndex);
    if (!literal) continue;
    if (imports.some((i) => i.specifier === literal.value && i.line === literal.line)) continue;
    imports.push({ specifier: literal.value, kind: 'static', symbols: ['*'], line: literal.line });
  }

  return imports;
}

function structFields(body: string): string[] {
  const fields: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line || line === '{' || line === '}') continue;
    const match = /^([A-Za-z_]\w*)\s+([\w*.[\]]+)/.exec(line);
    if (match) fields.push(`${match[1]} ${match[2]}`);
  }
  return fields;
}

function collectSymbols(scan: ScanResult, path: string): SymbolDef[] {
  const symbols: SymbolDef[] = [];
  const code = scan.code;

  for (const match of code.matchAll(TYPE_DECL)) {
    const name = match[1];
    const nameIndex = match.index + match[0].indexOf(name);
    const braceIndex = match.index + match[0].length - 1;
    const end = matchBrace(code, braceIndex);
    if (end < 0) continue;
    const body = code.slice(braceIndex, end);
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: match[2] === 'interface' ? 'interface' : 'struct',
        line: lineAt(scan, nameIndex),
        endLine: lineAt(scan, end - 1),
        body,
        language: 'go',
        isExported: /^[A-Z]/.test(name),
        params: match[2] === 'struct' ? structFields(body) : [],
        doc: docCommentAbove(scan.original, match.index, ['//']),
      }),
    );
  }

  for (const match of code.matchAll(TYPE_ALIAS)) {
    const name = match[1];
    if (symbols.some((s) => s.name === name)) continue;
    const line = lineAt(scan, match.index);
    symbols.push(
      buildSymbol({
        path,
        name,
        kind: 'type',
        line,
        endLine: line,
        body: '',
        language: 'go',
        isExported: /^[A-Z]/.test(name),
        returnType: match[2],
      }),
    );
  }

  for (const match of code.matchAll(FUNC_DECL)) {
    const receiver = match[1]?.replace(/[*[\]]/g, '');
    const name = match[2];
    const nameIndex = match.index + match[0].lastIndexOf(name);
    const parenIndex = match.index + match[0].length - 1;
    const parenEnd = matchBrace(code, parenIndex, '(', ')');
    const params = parenEnd > 0 ? splitParams(code.slice(parenIndex + 1, parenEnd - 1)) : [];
    const body = parenEnd > 0 ? readBraceBody(scan, parenEnd) : undefined;
    const line = lineAt(scan, nameIndex);
    const returnSlice =
      parenEnd > 0 ? code.slice(parenEnd, body?.bodyStart ?? parenEnd).trim() : '';

    symbols.push(
      buildSymbol({
        path,
        name,
        kind: receiver ? 'method' : 'function',
        line,
        endLine: body?.endLine ?? line,
        body: body?.body ?? '',
        language: 'go',
        container: receiver,
        isExported: /^[A-Z]/.test(name),
        params,
        returnType: returnSlice || undefined,
        doc: docCommentAbove(scan.original, match.index, ['//']),
      }),
    );
  }

  return symbols.sort((a, b) => a.line - b.line);
}

export const goParser: LanguageParser = {
  id: 'go',
  language: 'go',
  extensions: ['.go'],
  parse(file: SourceFile): ParsedFile {
    const scan = scanSource(file.content, SYNTAX_PROFILES.go);
    const symbols = collectSymbols(scan, file.path);
    const ranges: SymbolRange[] = symbols.map((s) => ({
      name: s.name,
      line: s.line,
      endLine: s.endLine,
    }));
    const pkg = PACKAGE_DECL.exec(scan.code);
    const exports: ExportRef[] = symbols
      .filter((s) => s.isExported)
      .map((s) => ({ name: s.name, kind: 'declaration' as const, line: s.line }));

    return {
      path: file.path,
      language: 'go',
      imports: collectImports(scan),
      exports: pkg ? [{ name: pkg[1], kind: 'namespace', line: 1 }, ...exports] : exports,
      symbols,
      calls: collectCalls(scan, ranges),
      envRefs: collectEnvRefs(scan),
      complexity: cyclomaticComplexity(scan.code, 'go'),
      loc: scan.lines,
    };
  },
};
