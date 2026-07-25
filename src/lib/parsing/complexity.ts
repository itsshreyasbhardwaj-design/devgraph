/**
 * Complexity primitives shared by every language parser.
 *
 * All functions expect *masked* source (see `scanner.ts`) so comments and
 * string payloads cannot inflate the numbers.
 */

/** Decision-point keywords per language family. */
export const DECISION_KEYWORDS: Record<string, string[]> = {
  javascript: ['if', 'for', 'while', 'case', 'catch', 'finally'],
  typescript: ['if', 'for', 'while', 'case', 'catch', 'finally'],
  python: ['if', 'elif', 'for', 'while', 'except', 'assert', 'with'],
  java: ['if', 'for', 'while', 'case', 'catch', 'finally'],
  go: ['if', 'for', 'case', 'select'],
  rust: ['if', 'for', 'while', 'loop', 'match'],
  csharp: ['if', 'for', 'foreach', 'while', 'case', 'catch', 'finally'],
  php: ['if', 'elseif', 'for', 'foreach', 'while', 'case', 'catch', 'finally'],
};

/** Boolean/short-circuit operators that add a decision point. */
const LOGICAL_OPERATORS = ['&&', '||', '??', ' and ', ' or ', '?.'];

const TERNARY = /(?<![?:])\?(?!\.)/g;

/**
 * McCabe cyclomatic complexity: 1 + number of independent decision points.
 */
export function cyclomaticComplexity(maskedCode: string, language: string): number {
  const keywords = DECISION_KEYWORDS[language] ?? DECISION_KEYWORDS.javascript;
  let complexity = 1;

  for (const keyword of keywords) {
    const re = new RegExp(`(^|[^A-Za-z0-9_$.])${keyword}(?![A-Za-z0-9_$])`, 'g');
    complexity += countMatches(maskedCode, re);
  }

  for (const operator of LOGICAL_OPERATORS) {
    complexity += countOccurrences(maskedCode, operator);
  }

  // Ternaries — skip `?:` optional markers and `?.` which is counted above.
  complexity += countMatches(maskedCode, TERNARY);

  // Rust/Go error-propagation and pattern arms.
  if (language === 'rust') complexity += countMatches(maskedCode, /=>/g);

  return complexity;
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const rex = new RegExp(re.source, flags);
  let count = 0;
  while (rex.exec(text) !== null) count += 1;
  return count;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Deepest brace nesting inside a block. */
export function maxBraceNesting(maskedCode: string): number {
  let depth = 0;
  let max = 0;
  for (let i = 0; i < maskedCode.length; i += 1) {
    const ch = maskedCode[i];
    if (ch === '{') {
      depth += 1;
      if (depth > max) max = depth;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

/** Deepest indentation level, for indentation-scoped languages like Python. */
export function maxIndentNesting(maskedCode: string, unit = 4): number {
  let max = 0;
  for (const line of maskedCode.split('\n')) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    max = Math.max(max, Math.floor(indent / unit));
  }
  return max;
}

const OPERATOR_PATTERN =
  /(\+\+|--|<<=|>>=|===|!==|\*\*=|\?\?=|&&=|\|\|=|=>|->|::|\.\.\.|\|\||&&|\?\?|==|!=|<=|>=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|\+|-|\*|\/|%|=|<|>|!|~|\^|&|\||\?|:|;|,|\.|\(|\)|\[|\]|\{|\})/g;

const OPERAND_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*|0[xX][0-9a-fA-F]+|\d+(\.\d+)?/g;

export interface HalsteadMetrics {
  distinctOperators: number;
  distinctOperands: number;
  totalOperators: number;
  totalOperands: number;
  vocabulary: number;
  length: number;
  volume: number;
  difficulty: number;
  effort: number;
}

export function halstead(maskedCode: string): HalsteadMetrics {
  const operators = new Map<string, number>();
  const operands = new Map<string, number>();

  for (const match of maskedCode.matchAll(OPERATOR_PATTERN)) {
    const token = match[0];
    operators.set(token, (operators.get(token) ?? 0) + 1);
  }
  for (const match of maskedCode.matchAll(OPERAND_PATTERN)) {
    const token = match[0];
    operands.set(token, (operands.get(token) ?? 0) + 1);
  }

  const n1 = operators.size;
  const n2 = operands.size;
  const N1 = sum(operators.values());
  const N2 = sum(operands.values());
  const vocabulary = n1 + n2;
  const length = N1 + N2;
  const volume = vocabulary > 0 ? length * Math.log2(vocabulary) : 0;
  const difficulty = n2 > 0 ? (n1 / 2) * (N2 / n2) : 0;

  return {
    distinctOperators: n1,
    distinctOperands: n2,
    totalOperators: N1,
    totalOperands: N2,
    vocabulary,
    length,
    volume,
    difficulty,
    effort: difficulty * volume,
  };
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Maintainability Index, SEI three-metric variant normalised to 0–100.
 *
 *   MI = max(0, (171 − 5.2·ln(V) − 0.23·G − 16.2·ln(LOC)) · 100 / 171)
 *
 * A comment-density bonus is added back (capped at 100) because well-documented
 * code is genuinely easier to maintain.
 */
export function maintainabilityIndex(
  volume: number,
  complexity: number,
  linesOfCode: number,
  commentRatio = 0,
): number {
  if (linesOfCode <= 0) return 100;
  const raw =
    171 -
    5.2 * Math.log(Math.max(volume, 1)) -
    0.23 * complexity -
    16.2 * Math.log(Math.max(linesOfCode, 1));
  const normalised = (Math.max(0, raw) * 100) / 171;
  const commentBonus = 50 * Math.sin(Math.sqrt(2.4 * Math.min(commentRatio, 1)));
  return clamp(Math.round((normalised + commentBonus * 0.1) * 10) / 10, 0, 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type MaintainabilityBand = 'excellent' | 'good' | 'moderate' | 'poor';

export function maintainabilityBand(score: number): MaintainabilityBand {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'moderate';
  return 'poor';
}

export type ComplexityBand = 'simple' | 'moderate' | 'complex' | 'critical';

export function complexityBand(value: number): ComplexityBand {
  if (value <= 5) return 'simple';
  if (value <= 10) return 'moderate';
  if (value <= 20) return 'complex';
  return 'critical';
}
