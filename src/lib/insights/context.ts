import type { AnalysisResult, InsightTopic } from '@/lib/core/types';

/**
 * Prompt context construction.
 *
 * The model never sees raw source. It sees a compact, factual digest of the
 * analysis: real paths, real numbers, real symbol names. That is deliberate —
 * it keeps token cost bounded and independent of repository size, and it means
 * every file the model can cite is a file that provably exists.
 */

export interface ContextOptions {
  /** Hard ceiling on the digest, so cost does not scale with repo size. */
  maxChars: number;
  topic?: InsightTopic;
}

export const DEFAULT_CONTEXT_OPTIONS: ContextOptions = { maxChars: 14_000 };

export function buildAnalysisDigest(
  result: AnalysisResult,
  options: Partial<ContextOptions> = {},
): string {
  const config = { ...DEFAULT_CONTEXT_OPTIONS, ...options };
  const sections: string[] = [];

  sections.push(
    heading('REPOSITORY'),
    `name: ${result.repo.name}`,
    result.repo.description ? `description: ${result.repo.description}` : '',
    `source: ${result.source.kind}${result.source.ref ? ` @ ${result.source.ref}` : ''}`,
    `files: ${result.metrics.totals.files} (${result.metrics.totals.analysedFiles} analysed)`,
    `lines of code: ${result.metrics.totals.code}`,
    `symbols: ${result.metrics.totals.symbols}`,
  );

  sections.push(
    heading('LANGUAGES'),
    ...result.stack.languages
      .filter((l) => l.share > 0.01)
      .slice(0, 8)
      .map(
        (l) => `${l.language}: ${l.files} files, ${l.lines} lines (${(l.share * 100).toFixed(1)}%)`,
      ),
  );

  const byCategory = new Map<string, string[]>();
  for (const finding of result.stack.findings) {
    if (finding.category === 'language') continue;
    const bucket = byCategory.get(finding.category) ?? [];
    bucket.push(finding.version ? `${finding.name} ${finding.version}` : finding.name);
    byCategory.set(finding.category, bucket);
  }
  sections.push(
    heading('DETECTED STACK'),
    ...[...byCategory.entries()].map(
      ([category, names]) => `${category}: ${names.slice(0, 8).join(', ')}`,
    ),
  );

  sections.push(
    heading('ENTRY POINTS'),
    ...result.entryPoints.slice(0, 10).map((e) => `${e.path} — ${e.reason} (${e.kind})`),
  );

  sections.push(
    heading('MODULES (files, internal edges, in/out, cohesion, instability)'),
    ...result.metrics.coupling.modules
      .slice(0, 18)
      .map(
        (m) =>
          `${m.module}: ${m.files} files, ${m.internalEdges} internal, ${m.incoming}/${m.outgoing}, cohesion ${m.cohesion}, instability ${m.instability}`,
      ),
  );

  sections.push(
    heading('MOST DEPENDED-UPON FILES'),
    ...result.metrics.coupling.mostDependedUpon
      .slice(0, 12)
      .map(
        (f) => `${f.path}: ${f.fanIn} importers, ${f.fanOut} imports, instability ${f.instability}`,
      ),
  );

  if (result.apis.length) {
    sections.push(
      heading(`API ROUTES (${result.apis.length} total, showing 25)`),
      ...result.apis
        .slice(0, 25)
        .map((r) => `${r.method} ${r.path} → ${r.file}:${r.line} [${r.framework}]`),
    );
  }

  if (result.schema.tables.length) {
    sections.push(
      heading(`DATABASE SCHEMA (${result.schema.dialect})`),
      ...result.schema.tables.slice(0, 20).map(
        (t) =>
          `${t.name} (${t.file}:${t.line}): ${t.columns
            .slice(0, 12)
            .map(
              (c) =>
                `${c.name}:${c.type}${c.primaryKey ? ' PK' : ''}${c.references ? ` →${c.references.table}` : ''}`,
            )
            .join(', ')}`,
      ),
    );
  }

  if (result.env.length) {
    sections.push(
      heading('ENVIRONMENT VARIABLES'),
      ...result.env
        .slice(0, 25)
        .map(
          (v) =>
            `${v.name}: ${v.usages.length} usages${v.sensitive ? ' [sensitive]' : ''}${
              v.clientExposed ? ' [client-exposed]' : ''
            }${v.declaredIn.length ? ` declared in ${v.declaredIn[0]}` : ' [undeclared]'}`,
        ),
    );
  }

  sections.push(
    heading('METRICS'),
    `average complexity: ${result.metrics.complexity.average} (max ${result.metrics.complexity.max})`,
    `average maintainability: ${result.metrics.maintainability.average}/100`,
    `duplication: ${(result.metrics.duplication.ratio * 100).toFixed(1)}% of analysed lines`,
    `average fan-in/fan-out: ${result.metrics.coupling.averageFanIn}/${result.metrics.coupling.averageFanOut}`,
    result.metrics.coverage
      ? `test coverage: ${result.metrics.coverage.overall}%`
      : 'test coverage: not reported',
    `debt score: ${result.metrics.debt.score}/100`,
  );

  sections.push(
    heading('COMPLEXITY HOTSPOTS'),
    ...result.metrics.complexity.hotspots
      .slice(0, 15)
      .map(
        (h) =>
          `${h.symbol ?? '(file)'} at ${h.path}:${h.line ?? 1} — complexity ${h.complexity}, ${h.loc} lines, nesting ${h.maxNesting}`,
      ),
  );

  if (result.cycles.length) {
    sections.push(
      heading(`CIRCULAR DEPENDENCIES (${result.cycles.length})`),
      ...result.cycles
        .slice(0, 8)
        .map((c) => `[${c.severity}] ${c.files.join(' → ')} → ${c.files[0]}`),
    );
  }

  if (result.metrics.duplication.clones.length) {
    sections.push(
      heading('DUPLICATE BLOCKS'),
      ...result.metrics.duplication.clones
        .slice(0, 8)
        .map(
          (c) =>
            `${c.lines} lines duplicated across ${c.occurrences
              .map((o) => `${o.path}:${o.startLine}-${o.endLine}`)
              .join(', ')}`,
        ),
    );
  }

  if (result.metrics.debt.signals.length) {
    sections.push(
      heading('DEBT SIGNALS'),
      ...result.metrics.debt.signals.map((s) => `[${s.severity}] ${s.title}`),
    );
  }

  sections.push(
    heading('LARGEST FILES'),
    ...result.metrics.size.largestFiles.slice(0, 12).map((f) => `${f.path}: ${f.lines} lines`),
  );

  const dependencies = result.dependencies
    .filter((d) => d.kind === 'runtime')
    .sort((a, b) => b.usedBy - a.usedBy)
    .slice(0, 30);
  sections.push(
    heading('RUNTIME DEPENDENCIES (name, files importing it)'),
    dependencies.map((d) => `${d.name}(${d.usedBy})`).join(', '),
  );

  const digest = sections.filter(Boolean).join('\n');
  return digest.length > config.maxChars
    ? `${digest.slice(0, config.maxChars)}\n… digest truncated at ${config.maxChars} characters`
    : digest;
}

function heading(title: string): string {
  return `\n## ${title}`;
}

/** Paths the model is allowed to cite. Anything else is a hallucination. */
export function citablePaths(result: AnalysisResult): Set<string> {
  return new Set(result.files.map((f) => f.path));
}
