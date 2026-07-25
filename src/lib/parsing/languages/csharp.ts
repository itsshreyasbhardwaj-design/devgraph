import type { ImportRef, SymbolKind, Visibility } from '@/lib/core/types';
import { lineAt, SYNTAX_PROFILES, type ScanResult } from '../scanner';
import { createClassLanguageParser, splitTypeList } from './classLanguage';

const USING_DECL =
  /^[ \t]*(?:global\s+)?using\s+(?:static\s+)?(?:[\w]+\s*=\s*)?([\w.<>, ]+?)\s*;/gm;
const NAMESPACE_DECL = /^[ \t]*namespace\s+([\w.]+)/m;

const MODIFIERS =
  '(?:public|private|protected|internal|static|sealed|abstract|virtual|override|partial|readonly|async|extern|unsafe|new|required|file)';

const TYPE_DECL = new RegExp(
  // Trailing `[{;]` so positional records without a body (`record X(int A);`)
  // are captured alongside block-bodied declarations.
  `(?:^|[\\n;{}])\\s*((?:${MODIFIERS}\\s+)*)(class|interface|struct|record|enum)\\s+(?:class\\s+|struct\\s+)?([A-Za-z_]\\w*)\\s*(?:<[^{(;]*?>)?\\s*(?:\\([^)]*\\))?\\s*(:[^{;]+)?(?:where[^{;]*)?[{;]`,
  'g',
);

const MEMBER_DECL = new RegExp(
  `(?:^|[\\n;{}])\\s*(?:\\[[^\\]]*\\]\\s*)*((?:${MODIFIERS}\\s+)*)([\\w.<>,?\\[\\] ]+?)\\s+([A-Za-z_]\\w*)\\s*(?:<[^>(]*>)?\\s*\\(`,
  'g',
);

const PROPERTY_DECL = new RegExp(
  `(?:^|[\\n;{}])\\s*((?:${MODIFIERS}\\s+)*)([\\w.<>,?\\[\\]]+)\\s+([A-Za-z_]\\w*)\\s*(?:\\{\\s*(?:get|set|init)|=>|=|;)`,
  'g',
);

const TYPE_KINDS: Record<string, SymbolKind> = {
  class: 'class',
  interface: 'interface',
  struct: 'struct',
  record: 'struct',
  enum: 'enum',
};

export const csharpParser = createClassLanguageParser({
  id: 'csharp',
  language: 'csharp',
  complexityKey: 'csharp',
  extensions: ['.cs', '.csx'],
  profile: SYNTAX_PROFILES.csharp,
  docPrefixes: ['///', '//'],
  typeDecl: TYPE_DECL,
  memberDecl: MEMBER_DECL,
  fieldDecl: PROPERTY_DECL,
  typeKindOf: (keyword) => TYPE_KINDS[keyword] ?? 'class',
  visibilityOf(modifiers): Visibility {
    if (/\bpublic\b/.test(modifiers)) return 'public';
    if (/\bprotected\b/.test(modifiers)) return 'protected';
    if (/\bprivate\b/.test(modifiers)) return 'private';
    if (/\binternal\b/.test(modifiers)) return 'internal';
    return 'private';
  },
  isExported: (modifiers) => /\b(public|internal)\b/.test(modifiers),
  parseInheritance(clause) {
    // C# uses a single `: A, IB, IC` list. Interfaces conventionally start with
    // `I` followed by an uppercase letter; everything else is treated as a base.
    const entries = splitTypeList(clause?.replace(/^\s*:/, ''));
    const base: string[] = [];
    const interfaces: string[] = [];
    for (const entry of entries) {
      if (/^I[A-Z]/.test(entry)) interfaces.push(entry);
      else base.push(entry);
    }
    return { extends: base, implements: interfaces };
  },
  namespaceOf(scan: ScanResult) {
    return NAMESPACE_DECL.exec(scan.code)?.[1];
  },
  collectImports(scan: ScanResult): ImportRef[] {
    const imports: ImportRef[] = [];
    for (const match of scan.code.matchAll(USING_DECL)) {
      const specifier = match[1].trim();
      // `using (var x = …)` resource blocks are not imports.
      if (!specifier || /\s/.test(specifier.replace(/,\s*/g, ','))) continue;
      const segments = specifier.split('.');
      imports.push({
        specifier,
        kind: 'static',
        symbols: [segments[segments.length - 1] || '*'],
        line: lineAt(scan, match.index),
      });
    }
    return imports;
  },
});
