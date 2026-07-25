import type { ImportRef, SymbolKind, Visibility } from '@/lib/core/types';
import { lineAt, SYNTAX_PROFILES, type ScanResult } from '../scanner';
import { createClassLanguageParser, splitTypeList } from './classLanguage';

const IMPORT_DECL = /^[ \t]*import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
const PACKAGE_DECL = /^[ \t]*package\s+([\w.]+)\s*;/m;

const MODIFIERS =
  '(?:public|protected|private|static|final|abstract|sealed|non-sealed|strictfp|default|native|synchronized|transient|volatile)';

const TYPE_DECL = new RegExp(
  `(?:^|[\\n;{}])\\s*((?:${MODIFIERS}\\s+)*)(class|interface|enum|record|@interface)\\s+([A-Za-z_]\\w*)\\s*(?:<[^{]*?>)?\\s*(?:\\([^)]*\\))?\\s*((?:extends|implements)[^{]+)?\\{`,
  'g',
);

const MEMBER_DECL = new RegExp(
  `(?:^|[\\n;{}])\\s*(?:@[\\w.]+(?:\\([^)]*\\))?\\s*)*((?:${MODIFIERS}\\s+)*)(?:<[^>]+>\\s*)?([\\w.$]+(?:\\s*<[^>]*>)?(?:\\s*\\[\\s*\\])*)\\s+([A-Za-z_]\\w*)\\s*\\(`,
  'g',
);

const FIELD_DECL = new RegExp(
  `(?:^|[\\n;{}])\\s*((?:${MODIFIERS}\\s+)*)([\\w.$]+(?:\\s*<[^>]*>)?(?:\\s*\\[\\s*\\])*)\\s+([A-Za-z_]\\w*)\\s*[=;]`,
  'g',
);

const TYPE_KINDS: Record<string, SymbolKind> = {
  class: 'class',
  interface: 'interface',
  '@interface': 'interface',
  enum: 'enum',
  record: 'struct',
};

export const javaParser = createClassLanguageParser({
  id: 'java',
  language: 'java',
  complexityKey: 'java',
  extensions: ['.java'],
  profile: SYNTAX_PROFILES.java,
  docPrefixes: ['///', '//'],
  typeDecl: TYPE_DECL,
  memberDecl: MEMBER_DECL,
  fieldDecl: FIELD_DECL,
  typeKindOf: (keyword) => TYPE_KINDS[keyword] ?? 'class',
  visibilityOf(modifiers): Visibility {
    if (/\bpublic\b/.test(modifiers)) return 'public';
    if (/\bprotected\b/.test(modifiers)) return 'protected';
    if (/\bprivate\b/.test(modifiers)) return 'private';
    return 'package';
  },
  isExported: (modifiers) => /\bpublic\b/.test(modifiers),
  parseInheritance(clause) {
    if (!clause) return { extends: [], implements: [] };
    const extendsMatch = /extends\s+([^]*?)(?:\s+implements\b|$)/.exec(clause);
    const implementsMatch = /implements\s+([^]*)$/.exec(clause);
    return {
      extends: splitTypeList(extendsMatch?.[1]),
      implements: splitTypeList(implementsMatch?.[1]),
    };
  },
  namespaceOf(scan: ScanResult) {
    return PACKAGE_DECL.exec(scan.code)?.[1];
  },
  collectImports(scan: ScanResult): ImportRef[] {
    const imports: ImportRef[] = [];
    for (const match of scan.code.matchAll(IMPORT_DECL)) {
      const specifier = match[2];
      const segments = specifier.split('.');
      imports.push({
        specifier,
        kind: match[1] ? 'static' : 'static',
        symbols: [segments[segments.length - 1] || '*'],
        line: lineAt(scan, match.index),
      });
    }
    return imports;
  },
});
