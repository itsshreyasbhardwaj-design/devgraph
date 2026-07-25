import type { LanguageId, ParsedFile, SourceFile } from '@/lib/core/types';
import { detectLanguage } from '@/lib/core/languages';

export interface LanguageParser {
  /** Stable identifier, e.g. `typescript`. */
  id: string;
  language: LanguageId;
  /** File extensions this parser claims, including the leading dot. */
  extensions: string[];
  parse(file: SourceFile): ParsedFile;
}

/**
 * Registry of structural parsers.
 *
 * Adding a language is a two-step change: implement `LanguageParser` in
 * `parsing/languages/<lang>.ts`, then register it in `parsing/index.ts`. No
 * other module needs to know the language exists.
 */
export class ParserRegistry {
  private readonly byExtension = new Map<string, LanguageParser>();
  private readonly byId = new Map<string, LanguageParser>();

  register(parser: LanguageParser): this {
    this.byId.set(parser.id, parser);
    for (const ext of parser.extensions) {
      this.byExtension.set(ext.toLowerCase(), parser);
    }
    return this;
  }

  get(id: string): LanguageParser | undefined {
    return this.byId.get(id);
  }

  forPath(path: string): LanguageParser | undefined {
    const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    // Longest extension wins so `.d.ts` beats `.ts`.
    let best: LanguageParser | undefined;
    let bestLength = -1;
    for (const [ext, parser] of this.byExtension) {
      if (base.endsWith(ext) && ext.length > bestLength) {
        best = parser;
        bestLength = ext.length;
      }
    }
    return best;
  }

  supports(path: string): boolean {
    return this.forPath(path) !== undefined;
  }

  list(): LanguageParser[] {
    return [...this.byId.values()];
  }

  /**
   * Parse a file, falling back to an empty structural record for unsupported
   * languages so downstream consumers never need a null check.
   */
  parse(file: SourceFile): ParsedFile {
    const parser = this.forPath(file.path);
    if (!parser) return emptyParse(file);
    try {
      return parser.parse(file);
    } catch (error) {
      const record = emptyParse(file);
      record.warnings = [
        `${parser.id} parser failed: ${error instanceof Error ? error.message : String(error)}`,
      ];
      return record;
    }
  }
}

export function emptyParse(file: SourceFile): ParsedFile {
  const total = file.content.length === 0 ? 0 : file.content.split('\n').length;
  let blank = 0;
  for (const line of file.content.split('\n')) if (!line.trim()) blank += 1;
  return {
    path: file.path,
    language: detectLanguage(file.path),
    imports: [],
    exports: [],
    symbols: [],
    calls: [],
    envRefs: [],
    complexity: 0,
    loc: { total, code: Math.max(0, total - blank), comment: 0, blank },
  };
}
