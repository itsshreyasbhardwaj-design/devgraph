import type {
  ExportRef,
  ImportRef,
  LanguageId,
  ParsedFile,
  SourceFile,
  SymbolDef,
  SymbolKind,
  Visibility,
} from '@/lib/core/types';
import { cyclomaticComplexity } from '../complexity';
import type { LanguageParser } from '../registry';
import { lineAt, matchBrace, scanSource, type ScanResult, type SyntaxProfile } from '../scanner';
import {
  buildSymbol,
  collectCalls,
  collectEnvRefs,
  docCommentAbove,
  readBraceBody,
  splitParams,
  type SymbolRange,
} from '../shared';

/**
 * Shared engine for curly-brace, class-oriented languages (Java, C#, PHP).
 *
 * The three differ in their import syntax, inheritance clause, and visibility
 * keywords but share the same shape: a modifier list, a type keyword, a body of
 * members. Each language file supplies its regexes and a handful of small
 * predicates; everything structural lives here.
 */
export interface ClassLangConfig {
  id: string;
  language: LanguageId;
  /** Key into `DECISION_KEYWORDS`. */
  complexityKey: string;
  extensions: string[];
  profile: SyntaxProfile;
  docPrefixes: string[];
  /** Groups: 1 = modifiers, 2 = keyword, 3 = name, 4 = inheritance clause. */
  typeDecl: RegExp;
  /** Groups: 1 = modifiers, 2 = return type, 3 = name. Must end with `(`. */
  memberDecl: RegExp;
  /** Optional top-level function declarations (PHP). */
  functionDecl?: RegExp;
  /** Optional property/field declarations for richer class diagrams. */
  fieldDecl?: RegExp;
  parseInheritance(clause: string | undefined): { extends: string[]; implements: string[] };
  collectImports(scan: ScanResult): ImportRef[];
  namespaceOf?(scan: ScanResult): string | undefined;
  typeKindOf(keyword: string): SymbolKind;
  visibilityOf(modifiers: string): Visibility;
  isExported(modifiers: string, name: string): boolean;
}

const MEMBER_BLOCKLIST = new Set([
  'if',
  'for',
  'foreach',
  'while',
  'switch',
  'catch',
  'return',
  'do',
  'else',
  'try',
  'finally',
  'lock',
  'using',
  'new',
  'throw',
  'yield',
  'await',
  'echo',
  'print',
  'match',
  'fn',
  'get',
  'set',
  'add',
  'remove',
  'when',
]);

function depthAt(body: string, index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    if (body[i] === '{') depth += 1;
    else if (body[i] === '}') depth -= 1;
  }
  return depth;
}

function collectMembers(
  scan: ScanResult,
  config: ClassLangConfig,
  path: string,
  typeName: string,
  bodyStart: number,
  bodyEnd: number,
): SymbolDef[] {
  const members: SymbolDef[] = [];
  const body = scan.code.slice(bodyStart, bodyEnd);
  const rex = new RegExp(config.memberDecl.source, config.memberDecl.flags);
  let match = rex.exec(body);

  while (match !== null) {
    const name = match[3];
    const nameOffset = match.index + match[0].lastIndexOf(name);
    if (name && !MEMBER_BLOCKLIST.has(name) && depthAt(body, nameOffset) === 1) {
      const absolute = bodyStart + nameOffset;
      const parenIndex = bodyStart + match.index + match[0].length - 1;
      const parenEnd = matchBrace(scan.code, parenIndex, '(', ')');
      const params = parenEnd > 0 ? splitParams(scan.code.slice(parenIndex + 1, parenEnd - 1)) : [];
      const memberBody = parenEnd > 0 ? readBraceBody(scan, parenEnd) : undefined;
      const line = lineAt(scan, absolute);
      const modifiers = match[1] ?? '';

      members.push(
        buildSymbol({
          path,
          name,
          kind: 'method',
          line,
          endLine: memberBody?.endLine ?? line,
          body: memberBody?.body ?? '',
          language: config.complexityKey,
          container: typeName,
          visibility: config.visibilityOf(modifiers),
          isStatic: /\bstatic\b/.test(modifiers),
          isAbstract: /\babstract\b/.test(modifiers),
          isAsync: /\basync\b/.test(modifiers),
          params,
          returnType: match[2]?.trim() || undefined,
          decorators: annotationsAbove(scan.code, bodyStart + match.index),
        }),
      );
    }
    match = rex.exec(body);
  }

  if (config.fieldDecl) {
    const fieldRex = new RegExp(config.fieldDecl.source, config.fieldDecl.flags);
    let field = fieldRex.exec(body);
    while (field !== null) {
      const name = field[3];
      const fieldOffset = field.index + field[0].lastIndexOf(name);
      if (name && !MEMBER_BLOCKLIST.has(name) && depthAt(body, fieldOffset) === 1) {
        const line = lineAt(scan, bodyStart + field.index);
        if (!members.some((m) => m.name === name && m.line === line)) {
          members.push(
            buildSymbol({
              path,
              name,
              kind: 'variable',
              line,
              endLine: line,
              body: '',
              language: config.complexityKey,
              container: typeName,
              visibility: config.visibilityOf(field[1] ?? ''),
              isStatic: /\bstatic\b/.test(field[1] ?? ''),
              returnType: field[2]?.trim() || undefined,
            }),
          );
        }
      }
      field = fieldRex.exec(body);
    }
  }

  return members;
}

function annotationsAbove(code: string, index: number): string[] {
  const window = code.slice(Math.max(0, index - 300), index);
  const found: string[] = [];
  for (const match of window.matchAll(/[@#]\[?([A-Za-z_][\w.]*)/g)) found.push(match[1]);
  return found;
}

export function createClassLanguageParser(config: ClassLangConfig): LanguageParser {
  return {
    id: config.id,
    language: config.language,
    extensions: config.extensions,
    parse(file: SourceFile): ParsedFile {
      const scan = scanSource(file.content, config.profile);
      const code = scan.code;
      const symbols: SymbolDef[] = [];
      const claimed: [number, number][] = [];

      const typeRex = new RegExp(config.typeDecl.source, config.typeDecl.flags);
      let match = typeRex.exec(code);
      while (match !== null) {
        const modifiers = match[1] ?? '';
        const keyword = match[2];
        const name = match[3];
        const braceIndex = match.index + match[0].length - 1;
        const bodyEnd = code[braceIndex] === '{' ? matchBrace(code, braceIndex) : -1;
        const nameIndex = match.index + match[0].indexOf(name);
        const line = lineAt(scan, nameIndex);
        const inheritance = config.parseInheritance(match[4]);

        if (bodyEnd > 0) claimed.push([braceIndex, bodyEnd]);

        symbols.push(
          buildSymbol({
            path: file.path,
            name,
            kind: config.typeKindOf(keyword),
            line,
            endLine: bodyEnd > 0 ? lineAt(scan, bodyEnd - 1) : line,
            body: bodyEnd > 0 ? code.slice(braceIndex, bodyEnd) : '',
            language: config.complexityKey,
            visibility: config.visibilityOf(modifiers),
            isAbstract: /\babstract\b/.test(modifiers),
            isStatic: /\bstatic\b/.test(modifiers),
            isExported: config.isExported(modifiers, name),
            extends: inheritance.extends.length ? inheritance.extends : undefined,
            implements: inheritance.implements.length ? inheritance.implements : undefined,
            decorators: annotationsAbove(code, match.index),
            doc: docCommentAbove(scan.original, match.index, config.docPrefixes),
          }),
        );

        if (bodyEnd > 0) {
          symbols.push(...collectMembers(scan, config, file.path, name, braceIndex, bodyEnd));
        }
        match = typeRex.exec(code);
      }

      if (config.functionDecl) {
        const fnRex = new RegExp(config.functionDecl.source, config.functionDecl.flags);
        let fn = fnRex.exec(code);
        while (fn !== null) {
          const name = fn[3] ?? fn[1];
          const nameIndex = fn.index + fn[0].lastIndexOf(name);
          const inClass = claimed.some(([start, end]) => nameIndex > start && nameIndex < end);
          if (!inClass && name) {
            const parenIndex = fn.index + fn[0].length - 1;
            const parenEnd = matchBrace(code, parenIndex, '(', ')');
            const params =
              parenEnd > 0 ? splitParams(code.slice(parenIndex + 1, parenEnd - 1)) : [];
            const body = parenEnd > 0 ? readBraceBody(scan, parenEnd) : undefined;
            const line = lineAt(scan, nameIndex);
            symbols.push(
              buildSymbol({
                path: file.path,
                name,
                kind: 'function',
                line,
                endLine: body?.endLine ?? line,
                body: body?.body ?? '',
                language: config.complexityKey,
                isExported: true,
                params,
                doc: docCommentAbove(scan.original, fn.index, config.docPrefixes),
              }),
            );
          }
          fn = fnRex.exec(code);
        }
      }

      symbols.sort((a, b) => a.line - b.line);
      const ranges: SymbolRange[] = symbols.map((s) => ({
        name: s.name,
        line: s.line,
        endLine: s.endLine,
      }));

      const exports: ExportRef[] = symbols
        .filter((s) => s.isExported && !s.container)
        .map((s) => ({ name: s.name, kind: 'declaration' as const, line: s.line }));
      const namespace = config.namespaceOf?.(scan);
      if (namespace) exports.unshift({ name: namespace, kind: 'namespace', line: 1 });

      return {
        path: file.path,
        language: config.language,
        imports: config.collectImports(scan),
        exports,
        symbols,
        calls: collectCalls(scan, ranges),
        envRefs: collectEnvRefs(scan),
        complexity: cyclomaticComplexity(code, config.complexityKey),
        loc: scan.lines,
      };
    },
  };
}

/** Split a comma-separated inheritance clause, tolerating generics. */
export function splitTypeList(clause: string | undefined): string[] {
  if (!clause) return [];
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of clause) {
    if (ch === '<' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '>' || ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.map((p) => p.replace(/<.*$/, '').trim()).filter(Boolean);
}
