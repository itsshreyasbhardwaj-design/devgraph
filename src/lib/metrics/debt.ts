import type {
  CoverageReport,
  DebtMarker,
  DebtSignal,
  DependencyCycle,
  DuplicationReport,
  FileRecord,
  TechnicalDebtReport,
} from '@/lib/core/types';

const MARKER_PATTERN =
  /(?:^|[^\w])(TODO|FIXME|HACK|XXX|BUG|REFACTOR|DEPRECATED|OPTIMIZE|WORKAROUND|TEMP|KLUDGE)\b[:\s-]*(.{0,160})/g;

/** Scan a file's raw text for debt markers. Cheap enough to run on every file. */
export function extractDebtMarkers(path: string, content: string, limit = 40): DebtMarker[] {
  const markers: DebtMarker[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length && markers.length < limit; i += 1) {
    const line = lines[i];
    // Only look at lines that plausibly contain a comment.
    if (!/[/#*<!-]/.test(line)) continue;
    const rex = new RegExp(MARKER_PATTERN.source, MARKER_PATTERN.flags);
    let match = rex.exec(line);
    while (match !== null && markers.length < limit) {
      markers.push({
        path,
        line: i + 1,
        tag: match[1].toUpperCase(),
        text: match[2]
          .trim()
          .replace(/\*\/\s*$/, '')
          .trim()
          .slice(0, 160),
      });
      match = rex.exec(line);
    }
  }
  return markers;
}

export interface DebtInput {
  files: FileRecord[];
  markers: DebtMarker[];
  cycles: DependencyCycle[];
  duplication: DuplicationReport;
  coverage?: CoverageReport;
  averageMaintainability: number;
  maxComplexity: number;
}

const HIGH_COMPLEXITY = 20;
// See `maintainabilityBand`: on the per-file SEI scale, below 10 is the band
// that genuinely correlates with code people avoid touching.
const LOW_MAINTAINABILITY = 10;
const LARGE_FILE_LINES = 600;

/**
 * A composite 0–100 debt score. Higher means more debt. Every contributing
 * signal is reported alongside the score so the number is never a black box.
 */
export function buildDebtReport(input: DebtInput): TechnicalDebtReport {
  const signals: DebtSignal[] = [];
  const analysed = input.files.filter((f) => !f.isGenerated && f.parsed);
  const analysedCount = Math.max(1, analysed.length);

  const complexFiles = analysed
    .filter((f) => f.complexity >= HIGH_COMPLEXITY)
    .sort((a, b) => b.complexity - a.complexity);
  if (complexFiles.length) {
    signals.push({
      id: 'high-complexity',
      title: `${complexFiles.length} files exceed a cyclomatic complexity of ${HIGH_COMPLEXITY}`,
      severity: severityFromRatio(complexFiles.length / analysedCount, 0.05, 0.12),
      detail:
        'High branching density makes behaviour hard to reason about and hard to cover with tests. Extracting guard clauses and splitting responsibilities usually pays off fastest here.',
      files: complexFiles.slice(0, 10).map((f) => f.path),
      metric: complexFiles.length,
    });
  }

  const fragile = analysed
    .filter((f) => f.maintainability < LOW_MAINTAINABILITY)
    .sort((a, b) => a.maintainability - b.maintainability);
  if (fragile.length) {
    signals.push({
      id: 'low-maintainability',
      title: `${fragile.length} files score below ${LOW_MAINTAINABILITY} on the maintainability index`,
      severity: severityFromRatio(fragile.length / analysedCount, 0.05, 0.15),
      detail:
        'Maintainability combines volume, complexity and length. Files in this band tend to be the ones engineers avoid touching.',
      files: fragile.slice(0, 10).map((f) => f.path),
      metric: fragile.length,
    });
  }

  const large = analysed
    .filter((f) => f.loc.code > LARGE_FILE_LINES)
    .sort((a, b) => b.loc.code - a.loc.code);
  if (large.length) {
    signals.push({
      id: 'large-files',
      title: `${large.length} files are longer than ${LARGE_FILE_LINES} lines of code`,
      severity: severityFromRatio(large.length / analysedCount, 0.03, 0.1),
      detail:
        'Long files usually hide several responsibilities and slow down navigation and review.',
      files: large.slice(0, 10).map((f) => f.path),
      metric: large.length,
    });
  }

  if (input.cycles.length) {
    const worst = input.cycles[0];
    signals.push({
      id: 'circular-dependencies',
      title: `${input.cycles.length} circular dependenc${input.cycles.length === 1 ? 'y' : 'ies'} detected`,
      severity: input.cycles.some((c) => c.severity === 'high') ? 'high' : 'medium',
      detail:
        'Cycles prevent independent testing and reuse, and make build tooling (tree-shaking, incremental compilation) far less effective. Breaking the smallest edge in each cycle is normally enough.',
      files: worst.files.slice(0, 10),
      metric: input.cycles.length,
    });
  }

  if (input.duplication.ratio > 0.02) {
    signals.push({
      id: 'duplication',
      title: `${(input.duplication.ratio * 100).toFixed(1)}% of analysed lines appear in duplicated blocks`,
      severity:
        input.duplication.ratio > 0.1 ? 'high' : input.duplication.ratio > 0.05 ? 'medium' : 'low',
      detail:
        'Duplicated logic drifts apart over time, so a fix applied in one copy silently misses the others.',
      files: input.duplication.clones
        .slice(0, 5)
        .flatMap((c) => c.occurrences.slice(0, 2).map((o) => o.path)),
      metric: Number((input.duplication.ratio * 100).toFixed(1)),
    });
  }

  const markerCount = input.markers.length;
  if (markerCount) {
    const urgent = input.markers.filter((m) => ['FIXME', 'HACK', 'BUG', 'XXX'].includes(m.tag));
    signals.push({
      id: 'debt-markers',
      title: `${markerCount} debt markers left in the code`,
      severity: urgent.length > 20 ? 'medium' : 'low',
      detail: `${urgent.length} of them are FIXME/HACK/BUG/XXX rather than plain TODOs.`,
      files: [...new Set(input.markers.map((m) => m.path))].slice(0, 10),
      metric: markerCount,
    });
  }

  const testFiles = input.files.filter((f) => f.isTest).length;
  const testRatio = testFiles / analysedCount;
  if (testRatio < 0.1) {
    signals.push({
      id: 'thin-test-suite',
      title:
        testFiles === 0
          ? 'No test files detected'
          : `Only ${testFiles} test files for ${analysedCount} source files`,
      severity: testFiles === 0 ? 'high' : 'medium',
      detail:
        'Refactoring safety scales with test coverage. A thin suite makes every architectural change a gamble.',
      files: [],
      metric: Number((testRatio * 100).toFixed(1)),
    });
  }

  if (input.coverage && input.coverage.overall < 60) {
    signals.push({
      id: 'low-coverage',
      title: `Reported test coverage is ${input.coverage.overall.toFixed(1)}%`,
      severity: input.coverage.overall < 40 ? 'high' : 'medium',
      detail: `Parsed from ${input.coverage.source}.`,
      files: input.coverage.files.slice(0, 8).map((f) => f.path),
      metric: input.coverage.overall,
    });
  }

  const severityWeights = { info: 0, low: 4, medium: 10, high: 18 };
  const score = Math.min(
    100,
    Math.round(signals.reduce((sum, signal) => sum + severityWeights[signal.severity], 0)),
  );

  return {
    score,
    markers: input.markers.slice(0, 300),
    signals: signals.sort((a, b) => severityWeights[b.severity] - severityWeights[a.severity]),
  };
}

function severityFromRatio(
  ratio: number,
  mediumAt: number,
  highAt: number,
): DebtSignal['severity'] {
  if (ratio >= highAt) return 'high';
  if (ratio >= mediumAt) return 'medium';
  return 'low';
}
