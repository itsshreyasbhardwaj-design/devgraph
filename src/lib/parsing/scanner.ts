import type { LineCounts } from '@/lib/core/types';

/**
 * A single-pass lexical scanner that separates code from comments and string
 * literals for every language DevGraph parses.
 *
 * Why this exists: naive regex parsers hallucinate imports out of commented-out
 * code and string payloads. The scanner produces a *masked* copy of the source
 * where comment bodies and string contents are blanked out (whitespace, with
 * newlines preserved so every offset and line number still lines up with the
 * original). Language parsers then run their patterns against the mask and pull
 * real literal values back out of the recorded literal table.
 */

export type LiteralKind = 'string' | 'template' | 'raw' | 'doc';

export interface StringLiteral {
  /** Offset of the opening delimiter. */
  start: number;
  /** Offset just past the closing delimiter. */
  end: number;
  /** Offset of the first content character. */
  contentStart: number;
  value: string;
  line: number;
  kind: LiteralKind;
}

export interface ScanResult {
  /** Masked source: comments and string contents replaced by spaces. */
  code: string;
  original: string;
  lines: LineCounts;
  literals: StringLiteral[];
  /** Literal keyed by the offset of its opening delimiter. */
  literalByStart: Map<number, StringLiteral>;
  /** Offset at which each 1-based line begins; index 0 is unused. */
  lineStarts: number[];
}

export interface SyntaxProfile {
  lineComments: string[];
  blockComments: [string, string][];
  nestedBlockComments: boolean;
  quotes: string[];
  /** Python-style triple-quoted strings. */
  tripleQuotes: string[];
  /** JS/TS template literals with `${}` interpolation. */
  templateLiterals: boolean;
  /** Go-style raw backtick strings (no interpolation, no escapes). */
  backtickRaw: boolean;
  /** JS regex literals — needed so `/` in `/a\/b/` is not read as a comment. */
  regexLiterals: boolean;
  /** Rust `r#"…"#` raw strings. */
  rustRawStrings: boolean;
  /** C# `@"…"` verbatim strings. */
  verbatimStrings: boolean;
  /** PHP/shell `<<<EOT` heredocs. */
  heredocs: boolean;
  escape: string;
}

const C_LIKE: SyntaxProfile = {
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  nestedBlockComments: false,
  quotes: ['"', "'"],
  tripleQuotes: [],
  templateLiterals: false,
  backtickRaw: false,
  regexLiterals: false,
  rustRawStrings: false,
  verbatimStrings: false,
  heredocs: false,
  escape: '\\',
};

export const SYNTAX_PROFILES = {
  javascript: {
    ...C_LIKE,
    templateLiterals: true,
    regexLiterals: true,
  },
  typescript: {
    ...C_LIKE,
    templateLiterals: true,
    regexLiterals: true,
  },
  python: {
    ...C_LIKE,
    lineComments: ['#'],
    blockComments: [],
    tripleQuotes: ['"""', "'''"],
  },
  java: { ...C_LIKE, tripleQuotes: ['"""'] },
  go: { ...C_LIKE, backtickRaw: true },
  rust: { ...C_LIKE, nestedBlockComments: true, rustRawStrings: true },
  csharp: { ...C_LIKE, verbatimStrings: true, tripleQuotes: ['"""'] },
  php: {
    ...C_LIKE,
    lineComments: ['//', '#'],
    heredocs: true,
  },
  plain: { ...C_LIKE, lineComments: ['#'], blockComments: [] },
} satisfies Record<string, SyntaxProfile>;

export type SyntaxProfileName = keyof typeof SYNTAX_PROFILES;

const REGEX_PRECEDING = new Set([
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '~',
  '^',
  '<',
  '>',
  '\n',
]);

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'do',
  'else',
  'yield',
  'await',
  'case',
  'delete',
  'void',
  'new',
]);

const MASK = ' ';

/** Bit flags used while classifying each physical line. */
const HAS_CODE = 1;
const HAS_COMMENT = 2;

export function scanSource(source: string, profile: SyntaxProfile): ScanResult {
  const n = source.length;
  const out = new Array<string>(n);
  const lineFlags: number[] = [0];
  const lineStarts: number[] = [0, 0];
  const literals: StringLiteral[] = [];

  let line = 1;
  let i = 0;

  const newline = () => {
    line += 1;
    lineFlags[line] = 0;
    lineStarts[line] = i + 1;
  };

  const flag = (bit: number) => {
    lineFlags[line] = (lineFlags[line] ?? 0) | bit;
  };

  /** Copy a character to the mask verbatim. */
  const emit = (ch: string) => {
    out[i] = ch;
    if (ch === '\n') newline();
    else if (ch.trim() !== '') flag(HAS_CODE);
    i += 1;
  };

  /** Blank out a character but keep newlines so offsets stay aligned. */
  const blank = (ch: string, bit: number) => {
    if (ch === '\n') {
      out[i] = '\n';
      newline();
    } else {
      out[i] = MASK;
      if (ch.trim() !== '') flag(bit);
    }
    i += 1;
  };

  const startsWith = (token: string, at = i) => source.startsWith(token, at);

  /** Last non-whitespace character emitted as code — used for regex detection. */
  let lastSignificant = '\n';
  let lastWord = '';

  const readLineComment = (token: string) => {
    for (let k = 0; k < token.length; k += 1) blank(source[i], HAS_COMMENT);
    while (i < n && source[i] !== '\n') blank(source[i], HAS_COMMENT);
  };

  const readBlockComment = (open: string, close: string) => {
    let depth = 0;
    // Opening delimiter.
    for (let k = 0; k < open.length; k += 1) blank(source[i], HAS_COMMENT);
    depth += 1;
    while (i < n && depth > 0) {
      if (profile.nestedBlockComments && startsWith(open)) {
        for (let k = 0; k < open.length; k += 1) blank(source[i], HAS_COMMENT);
        depth += 1;
        continue;
      }
      if (startsWith(close)) {
        for (let k = 0; k < close.length; k += 1) blank(source[i], HAS_COMMENT);
        depth -= 1;
        continue;
      }
      blank(source[i], HAS_COMMENT);
    }
  };

  const pushLiteral = (
    start: number,
    contentStart: number,
    end: number,
    value: string,
    startLine: number,
    kind: LiteralKind,
  ) => {
    literals.push({ start, contentStart, end, value, line: startLine, kind });
  };

  /**
   * Read a quoted string. Delimiters are preserved in the mask so parsers can
   * still see `from " "`; the body is blanked and recorded.
   */
  const readQuoted = (
    quote: string,
    escapes: boolean,
    kind: LiteralKind,
    allowNewline: boolean,
  ) => {
    const start = i;
    const startLine = line;
    for (let k = 0; k < quote.length; k += 1) emit(source[i]);
    const contentStart = i;
    let value = '';
    while (i < n) {
      const ch = source[i];
      if (escapes && ch === profile.escape && i + 1 < n) {
        value += unescapeChar(source[i + 1]);
        blank(source[i], HAS_CODE);
        blank(source[i], HAS_CODE);
        continue;
      }
      if (startsWith(quote)) break;
      if (ch === '\n' && !allowNewline) break;
      value += ch;
      blank(ch, HAS_CODE);
    }
    if (startsWith(quote)) {
      for (let k = 0; k < quote.length; k += 1) emit(source[i]);
    }
    pushLiteral(start, contentStart, i, value, startLine, kind);
  };

  /** JS template literal: interpolations stay visible as code. */
  const readTemplate = () => {
    const start = i;
    const startLine = line;
    emit(source[i]); // opening backtick
    const contentStart = i;
    let value = '';
    while (i < n) {
      const ch = source[i];
      if (ch === profile.escape && i + 1 < n) {
        value += unescapeChar(source[i + 1]);
        blank(source[i], HAS_CODE);
        blank(source[i], HAS_CODE);
        continue;
      }
      if (ch === '`') break;
      if (ch === '$' && source[i + 1] === '{') {
        value += '${…}';
        emit(source[i]);
        emit(source[i]);
        let depth = 1;
        while (i < n && depth > 0) {
          const inner = source[i];
          if (inner === '{') depth += 1;
          else if (inner === '}') depth -= 1;
          else if (inner === '`') {
            readTemplate();
            continue;
          } else if (inner === '"' || inner === "'") {
            readQuoted(inner, true, 'string', false);
            continue;
          }
          emit(inner);
        }
        continue;
      }
      value += ch;
      blank(ch, HAS_CODE);
    }
    if (i < n) emit(source[i]);
    pushLiteral(start, contentStart, i, value, startLine, 'template');
  };

  const readRegex = () => {
    emit(source[i]);
    let inClass = false;
    while (i < n) {
      const ch = source[i];
      if (ch === '\n') break;
      if (ch === profile.escape) {
        blank(source[i], HAS_CODE);
        if (i < n) blank(source[i], HAS_CODE);
        continue;
      }
      if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) {
        emit(source[i]);
        // Flags.
        while (i < n && /[a-z]/.test(source[i])) emit(source[i]);
        return;
      }
      blank(ch, HAS_CODE);
    }
  };

  const readRustRaw = () => {
    const start = i;
    const startLine = line;
    let hashes = 0;
    let probe = i + 1;
    while (source[probe] === '#') {
      hashes += 1;
      probe += 1;
    }
    if (source[probe] !== '"') return false;
    const closer = `"${'#'.repeat(hashes)}`;
    while (i <= probe) emit(source[i]);
    const contentStart = i;
    let value = '';
    while (i < n && !startsWith(closer)) {
      value += source[i];
      blank(source[i], HAS_CODE);
    }
    for (let k = 0; k < closer.length && i < n; k += 1) emit(source[i]);
    pushLiteral(start, contentStart, i, value, startLine, 'raw');
    return true;
  };

  const readHeredoc = () => {
    const match = /^<<<\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(source.slice(i));
    if (!match) return false;
    const start = i;
    const startLine = line;
    for (let k = 0; k < match[0].length; k += 1) blank(source[i], HAS_CODE);
    const contentStart = i;
    const terminator = new RegExp(`^[ \\t]*${match[2]}\\b`);
    let value = '';
    while (i < n) {
      const lineEnd = source.indexOf('\n', i);
      const slice = source.slice(i, lineEnd < 0 ? n : lineEnd);
      if (terminator.test(slice)) break;
      value += `${slice}\n`;
      for (let k = 0; k < slice.length; k += 1) blank(source[i], HAS_CODE);
      if (i < n) blank(source[i], HAS_CODE);
    }
    const lineEnd = source.indexOf('\n', i);
    const stop = lineEnd < 0 ? n : lineEnd;
    while (i < stop) emit(source[i]);
    pushLiteral(start, contentStart, i, value, startLine, 'raw');
    return true;
  };

  while (i < n) {
    const ch = source[i];

    // Whitespace / newlines.
    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') {
      emit(ch);
      continue;
    }

    // Comments.
    let consumed = false;
    for (const token of profile.lineComments) {
      if (startsWith(token)) {
        // `#` inside PHP `#[Attribute]` is an attribute, not a comment.
        if (token === '#' && source[i + 1] === '[') break;
        readLineComment(token);
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

    for (const [open, close] of profile.blockComments) {
      if (startsWith(open)) {
        readBlockComment(open, close);
        consumed = true;
        break;
      }
    }
    if (consumed) continue;

    // Rust raw strings must be checked before identifiers.
    if (profile.rustRawStrings && ch === 'r' && (source[i + 1] === '#' || source[i + 1] === '"')) {
      if (readRustRaw()) continue;
    }

    // C# verbatim / interpolated strings.
    if (profile.verbatimStrings && (ch === '@' || ch === '$')) {
      let probe = i;
      while (source[probe] === '@' || source[probe] === '$') probe += 1;
      if (source[probe] === '"') {
        const verbatim = source.slice(i, probe).includes('@');
        while (i < probe) emit(source[i]);
        readQuoted('"', !verbatim, 'string', verbatim);
        continue;
      }
    }

    // PHP heredoc / nowdoc.
    if (profile.heredocs && startsWith('<<<')) {
      if (readHeredoc()) continue;
    }

    // Triple-quoted strings (Python docstrings, Java/C# text blocks).
    let triple = false;
    for (const token of profile.tripleQuotes) {
      if (startsWith(token)) {
        const isDoc = lastSignificant === '\n' || lastSignificant === ':' || lastSignificant === '';
        readQuoted(token, true, isDoc ? 'doc' : 'string', true);
        triple = true;
        break;
      }
    }
    if (triple) {
      lastSignificant = '"';
      lastWord = '';
      continue;
    }

    // Template / raw backtick strings.
    if (ch === '`') {
      if (profile.templateLiterals) {
        readTemplate();
        lastSignificant = '`';
        lastWord = '';
        continue;
      }
      if (profile.backtickRaw) {
        readQuoted('`', false, 'raw', true);
        lastSignificant = '`';
        lastWord = '';
        continue;
      }
    }

    // Regular quoted strings.
    if (profile.quotes.includes(ch)) {
      // Python string prefixes (r, b, f, u) were already emitted as identifier
      // characters, which is fine — the literal body is what matters.
      const raw = lastWord === 'r' || lastWord === 'rb' || lastWord === 'br';
      readQuoted(ch, !raw, 'string', false);
      lastSignificant = ch;
      lastWord = '';
      continue;
    }

    // JS regex literals.
    if (profile.regexLiterals && ch === '/') {
      const isRegex =
        REGEX_PRECEDING.has(lastSignificant) || REGEX_PRECEDING_KEYWORDS.has(lastWord);
      if (isRegex) {
        readRegex();
        lastSignificant = '/';
        lastWord = '';
        continue;
      }
    }

    // Ordinary code character.
    if (/[A-Za-z0-9_$]/.test(ch)) lastWord += ch;
    else lastWord = '';
    lastSignificant = ch;
    emit(ch);
  }

  // Materialise line counts.
  let code = 0;
  let comment = 0;
  let blankLines = 0;
  const total = line;
  for (let l = 1; l <= total; l += 1) {
    const f = lineFlags[l] ?? 0;
    if (f & HAS_CODE) code += 1;
    else if (f & HAS_COMMENT) comment += 1;
    else blankLines += 1;
  }

  const literalByStart = new Map<number, StringLiteral>();
  for (const literal of literals) literalByStart.set(literal.start, literal);

  return {
    code: out.join(''),
    original: source,
    lines: { total, code, comment, blank: blankLines },
    literals,
    literalByStart,
    lineStarts,
  };
}

function unescapeChar(ch: string): string {
  switch (ch) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case '0':
      return '\0';
    default:
      return ch;
  }
}

/** 1-based line number for a character offset. */
export function lineAt(scan: ScanResult, offset: number): number {
  const { lineStarts } = scan;
  let lo = 1;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The first string literal whose opening delimiter sits at or after `offset`,
 * bounded by `limit` so a failed match cannot grab a literal from the next
 * statement.
 */
export function literalAfter(
  scan: ScanResult,
  offset: number,
  limit = 400,
): StringLiteral | undefined {
  for (const literal of scan.literals) {
    if (literal.start < offset) continue;
    if (literal.start > offset + limit) return undefined;
    return literal;
  }
  return undefined;
}

/** All string literals starting within `[offset, offset + span)`. */
export function literalsWithin(scan: ScanResult, offset: number, span: number): StringLiteral[] {
  return scan.literals.filter((l) => l.start >= offset && l.start < offset + span);
}

/**
 * Offset just past the block that opens at `openIndex`, honouring nesting.
 * Returns -1 when unbalanced.
 */
export function matchBrace(code: string, openIndex: number, open = '{', close = '}'): number {
  if (code[openIndex] !== open) return -1;
  let depth = 0;
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === open) depth += 1;
    else if (code[i] === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}
