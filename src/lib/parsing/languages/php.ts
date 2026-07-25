import type { ImportRef, SymbolKind, Visibility } from '@/lib/core/types';
import { lineAt, SYNTAX_PROFILES, type ScanResult } from '../scanner';
import { createClassLanguageParser, splitTypeList } from './classLanguage';

const USE_DECL = /^[ \t]*use\s+(?:function\s+|const\s+)?([\w\\]+)(?:\s+as\s+\w+)?\s*;/gm;
const USE_GROUP = /^[ \t]*use\s+([\w\\]+)\\\{([^}]+)\}\s*;/gm;
const REQUIRE_DECL = /\b(?:require|require_once|include|include_once)\s*\(?\s*(['"])/g;
const NAMESPACE_DECL = /^[ \t]*namespace\s+([\w\\]+)\s*;/m;

const MODIFIERS = '(?:public|private|protected|static|abstract|final|readonly)';

const TYPE_DECL = new RegExp(
  `(?:^|[\\n;{}])\\s*((?:${MODIFIERS}\\s+)*)(class|interface|trait|enum)\\s+([A-Za-z_]\\w*)\\s*(?::\\s*\\w+\\s*)?((?:extends|implements)[^{]+)?\\{`,
  'g',
);

const MEMBER_DECL = new RegExp(
  `(?:^|[\\n;{}])\\s*(?:#\\[[^\\]]*\\]\\s*)*((?:${MODIFIERS}\\s+)*)function\\s*(&?)\\s*([A-Za-z_]\\w*)\\s*\\(`,
  'g',
);

const PROPERTY_DECL = new RegExp(
  `(?:^|[\\n;{}])\\s*((?:${MODIFIERS}\\s+)+)([\\w|?\\\\]*)\\s*\\$([A-Za-z_]\\w*)\\s*[=;]`,
  'g',
);

const FUNCTION_DECL = /(?:^|[\n;}])\s*function\s+(&?)\s*()([A-Za-z_]\w*)\s*\(/g;

const TYPE_KINDS: Record<string, SymbolKind> = {
  class: 'class',
  interface: 'interface',
  trait: 'trait',
  enum: 'enum',
};

export const phpParser = createClassLanguageParser({
  id: 'php',
  language: 'php',
  complexityKey: 'php',
  extensions: ['.php', '.phtml'],
  profile: SYNTAX_PROFILES.php,
  docPrefixes: ['//', '#'],
  typeDecl: TYPE_DECL,
  memberDecl: MEMBER_DECL,
  fieldDecl: PROPERTY_DECL,
  functionDecl: FUNCTION_DECL,
  typeKindOf: (keyword) => TYPE_KINDS[keyword] ?? 'class',
  visibilityOf(modifiers): Visibility {
    if (/\bprivate\b/.test(modifiers)) return 'private';
    if (/\bprotected\b/.test(modifiers)) return 'protected';
    return 'public';
  },
  isExported: () => true,
  parseInheritance(clause) {
    if (!clause) return { extends: [], implements: [] };
    const extendsMatch = /extends\s+([^]*?)(?:\s+implements\b|$)/.exec(clause);
    const implementsMatch = /implements\s+([^]*)$/.exec(clause);
    return {
      extends: splitTypeList(extendsMatch?.[1]).map(stripLeadingSlash),
      implements: splitTypeList(implementsMatch?.[1]).map(stripLeadingSlash),
    };
  },
  namespaceOf(scan: ScanResult) {
    return NAMESPACE_DECL.exec(scan.code)?.[1];
  },
  collectImports(scan: ScanResult): ImportRef[] {
    const imports: ImportRef[] = [];

    for (const match of scan.code.matchAll(USE_GROUP)) {
      const line = lineAt(scan, match.index);
      for (const entry of match[2].split(',')) {
        const name = entry.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        const specifier = `${match[1]}\\${name}`;
        imports.push({ specifier, kind: 'static', symbols: [name], line });
      }
    }

    for (const match of scan.code.matchAll(USE_DECL)) {
      const specifier = match[1];
      if (specifier.includes('{')) continue;
      const segments = specifier.split('\\');
      imports.push({
        specifier,
        kind: 'static',
        symbols: [segments[segments.length - 1] || '*'],
        line: lineAt(scan, match.index),
      });
    }

    for (const match of scan.code.matchAll(REQUIRE_DECL)) {
      const quoteIndex = match.index + match[0].length - 1;
      const literal = scan.literalByStart.get(quoteIndex);
      if (!literal?.value) continue;
      imports.push({
        specifier: literal.value,
        kind: 'require',
        symbols: [],
        line: literal.line,
      });
    }

    return imports;
  },
});

function stripLeadingSlash(name: string): string {
  return name.replace(/^\\+/, '');
}
