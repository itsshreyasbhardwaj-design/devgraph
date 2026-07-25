import type {
  AnalysisProgress,
  AnalysisResult,
  DebtMarker,
  DependencyCycle,
  EntryPoint,
  FileRecord,
  ParsedFile,
  RepoSource,
  RepoSummary,
  SourceFile,
  TimelineReport,
} from '@/lib/core/types';
import { detectLanguage, extensionOf } from '@/lib/core/languages';
import {
  basename,
  dirname,
  isBinaryPath,
  isGeneratedPath,
  isTestPath,
  moduleKeyFor,
  normalizePath,
  shouldIgnorePath,
} from '@/lib/core/paths';
import { parsers } from '@/lib/parsing';
import { halstead, maintainabilityIndex } from '@/lib/parsing/complexity';
import { SYNTAX_PROFILES, scanSource, type SyntaxProfile } from '@/lib/parsing/scanner';
import { ImportResolver } from '@/lib/graph/resolve';
import { buildAdjacency, findCycles } from '@/lib/graph/cycles';
import {
  buildAllGraphs,
  DEFAULT_LIMITS,
  type ExternalDependencyUse,
  type GraphInput,
  type GraphLimits,
  type ResolvedFileEdge,
} from '@/lib/graph/builders';
import { parseManifests } from '@/lib/detect/manifests';
import { detectEntryPoints, detectStack } from '@/lib/detect/stack';
import { computeMetrics } from '@/lib/metrics/compute';
import { detectDuplication } from '@/lib/metrics/duplication';
import { isCoverageFile, parseCoverage } from '@/lib/metrics/coverage';
import { extractDebtMarkers } from '@/lib/metrics/debt';
import { extractRoutes } from '@/lib/extract/routes';
import { extractSchema, isSchemaCandidate } from '@/lib/extract/schema';
import { envWarnings, extractEnv } from '@/lib/extract/env';
import { buildSearchIndex } from './search';
import { buildHeuristicInsights } from '@/lib/insights/heuristic';

export const ANALYSIS_VERSION = 1;

export interface AnalysisLimits {
  /** Files considered at all. */
  maxFiles: number;
  /** Bytes of a single file that get parsed. */
  maxFileBytes: number;
  /** Total bytes across all parsed files. */
  maxTotalBytes: number;
  graph: GraphLimits;
}

export const DEFAULT_ANALYSIS_LIMITS: AnalysisLimits = {
  maxFiles: 20_000,
  maxFileBytes: 1_500_000,
  maxTotalBytes: 250_000_000,
  graph: DEFAULT_LIMITS,
};

export interface AnalyzeOptions {
  source: RepoSource;
  files: SourceFile[];
  id: string;
  repo?: Partial<RepoSummary>;
  timeline?: TimelineReport;
  limits?: Partial<AnalysisLimits>;
  onProgress?: (progress: AnalysisProgress) => void;
}

const SCAN_PROFILES: Record<string, SyntaxProfile> = {
  typescript: SYNTAX_PROFILES.typescript,
  javascript: SYNTAX_PROFILES.javascript,
  python: SYNTAX_PROFILES.python,
  java: SYNTAX_PROFILES.java,
  go: SYNTAX_PROFILES.go,
  rust: SYNTAX_PROFILES.rust,
  csharp: SYNTAX_PROFILES.csharp,
  php: SYNTAX_PROFILES.php,
};

export const EMPTY_TIMELINE: TimelineReport = {
  available: false,
  reason: 'Git history is not available for this source.',
  commits: [],
  snapshots: [],
  moduleGrowth: [],
  dependencyEvents: [],
};

/**
 * The analysis pipeline.
 *
 * Runs as a single pass over the repository, reporting progress at each phase so
 * the UI can stream a live status instead of showing an opaque spinner.
 */
export async function analyzeRepository(options: AnalyzeOptions): Promise<AnalysisResult> {
  const started = Date.now();
  const limits: AnalysisLimits = {
    ...DEFAULT_ANALYSIS_LIMITS,
    ...options.limits,
    graph: { ...DEFAULT_ANALYSIS_LIMITS.graph, ...options.limits?.graph },
  };
  const warnings: string[] = [];
  const report = (
    phase: AnalysisProgress['phase'],
    message: string,
    progress: number,
    detail?: string,
  ) => options.onProgress?.({ phase, message, progress, detail });

  // ---- 1. Select files --------------------------------------------------
  report('scanning', 'Scanning repository', 0.05);

  const allFiles = options.files.map((file) => ({
    ...file,
    path: normalizePath(file.path),
  }));

  const candidates: SourceFile[] = [];
  let skipped = 0;
  let totalBytes = 0;

  for (const file of allFiles) {
    totalBytes += file.bytes;
    if (shouldIgnorePath(file.path) || isBinaryPath(file.path)) {
      skipped += 1;
      continue;
    }
    if (candidates.length >= limits.maxFiles) {
      skipped += 1;
      continue;
    }
    candidates.push(file);
  }

  if (skipped > 0) {
    warnings.push(
      `${skipped.toLocaleString()} files were skipped (binaries, lockfiles, vendored and build output).`,
    );
  }
  if (allFiles.length > limits.maxFiles) {
    warnings.push(
      `Repository exceeds the ${limits.maxFiles.toLocaleString()}-file analysis cap; the largest directories were prioritised.`,
    );
  }

  // ---- 2. Manifests -----------------------------------------------------
  const manifests = parseManifests(candidates);

  // ---- 3. Parse ---------------------------------------------------------
  report('parsing', 'Parsing source files', 0.15, `${candidates.length} files`);

  const parsed = new Map<string, ParsedFile>();
  const maskedCode = new Map<string, string>();
  const sourceText = new Map<string, string>();
  const markers: DebtMarker[] = [];
  const fileRecords: FileRecord[] = [];

  let processed = 0;
  for (const file of candidates) {
    processed += 1;
    if (processed % 400 === 0) {
      report(
        'parsing',
        'Parsing source files',
        0.15 + 0.35 * (processed / candidates.length),
        `${processed}/${candidates.length}`,
      );
      // Yield so a streaming response can flush progress.
      await Promise.resolve();
    }

    const language = detectLanguage(file.path);
    const oversized = file.bytes > limits.maxFileBytes;
    const generated = isGeneratedPath(file.path);
    sourceText.set(file.path, file.content);

    let record: FileRecord;

    if (oversized) {
      warnings.push(`${file.path} is larger than the per-file parse limit and was measured only.`);
      record = baseRecord(file, language, generated, countLinesOnly(file.content));
    } else {
      const parser = parsers.forPath(file.path);
      if (parser) {
        const result = parsers.parse(file);
        parsed.set(file.path, result);
        if (result.warnings?.length) warnings.push(...result.warnings.map((w) => `${file.path}: ${w}`));

        const profile = SCAN_PROFILES[parser.id] ?? SYNTAX_PROFILES.plain;
        const scan = scanSource(file.content, profile);
        maskedCode.set(file.path, scan.code);

        const volume = halstead(scan.code).volume;
        const commentRatio = result.loc.total > 0 ? result.loc.comment / result.loc.total : 0;
        record = {
          ...baseRecord(file, language, generated, result.loc),
          complexity: result.complexity,
          maintainability: maintainabilityIndex(
            volume,
            result.complexity,
            Math.max(1, result.loc.code),
            commentRatio,
          ),
          symbolCount: result.symbols.length,
          parsed: true,
        };
      } else {
        record = baseRecord(file, language, generated, countLinesOnly(file.content));
      }

      if (!generated && file.bytes < 400_000) {
        markers.push(...extractDebtMarkers(file.path, file.content));
      }
    }

    fileRecords.push(record);
  }

  // ---- 4. Resolve imports ----------------------------------------------
  report('resolving', 'Resolving dependencies', 0.55);

  const resolver = new ImportResolver(
    fileRecords.map((f) => f.path),
    {
      tsconfig: manifests.tsconfig,
      goModule: manifests.goModule,
      psr4: manifests.psr4,
      workspacePackages: manifests.workspacePackages,
    },
    parsed.values(),
  );

  const fileEdges: ResolvedFileEdge[] = [];
  const externals = new Map<string, ExternalDependencyUse>();
  const edgeSeen = new Set<string>();

  for (const file of parsed.values()) {
    for (const ref of file.imports) {
      const resolved = resolver.resolve(file.path, ref, file.language);
      if (resolved.target && resolved.target !== file.path) {
        const key = `${file.path}->${resolved.target}`;
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);
        fileEdges.push({
          from: file.path,
          to: resolved.target,
          kind: ref.kind === 'reexport' ? 'reexports' : 'imports',
          weight: Math.max(1, ref.symbols.length),
        });
        continue;
      }
      if (!resolved.external || !resolved.packageName) continue;
      const entry = externals.get(resolved.packageName) ?? {
        packageName: resolved.packageName,
        usedBy: new Set<string>(),
        builtin: Boolean(resolved.builtin),
      };
      entry.usedBy.add(file.path);
      externals.set(resolved.packageName, entry);
    }
  }

  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const edge of fileEdges) {
    fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
    fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
  }
  for (const record of fileRecords) {
    record.fanIn = fanIn.get(record.path) ?? 0;
    record.fanOut = fanOut.get(record.path) ?? 0;
  }

  const dependencies = manifests.dependencies.map((dependency) => ({
    ...dependency,
    usedBy: externals.get(dependency.name)?.usedBy.size ?? 0,
  }));

  // ---- 5. Cycles --------------------------------------------------------
  const adjacency = buildAdjacency(
    fileRecords.map((f) => f.path),
    fileEdges.map((edge) => ({ source: edge.from, target: edge.to })),
  );
  const cycles: DependencyCycle[] = findCycles(adjacency).map((files, index) => ({
    id: `cycle-${index + 1}`,
    files,
    length: files.length,
    severity: files.length >= 6 ? 'high' : files.length >= 3 ? 'medium' : 'low',
  }));

  // ---- 6. Stack detection ----------------------------------------------
  // Runs before extraction so ambiguous route syntax (`@app.get` is both
  // FastAPI and Flask) can be attributed to the framework actually present.
  const stack = detectStack({ files: fileRecords, sources: sourceText, manifests });
  const detectedFrameworks = new Set(
    stack.findings.filter((finding) => finding.category === 'framework').map((finding) => finding.name),
  );

  // ---- 7. Extractors ----------------------------------------------------
  report('extracting', 'Extracting routes, schema and configuration', 0.65);

  const apis = extractRoutes({
    sources: candidates,
    parsed,
    masked: maskedCode,
    frameworks: detectedFrameworks,
  });
  const schema = extractSchema(candidates.filter((f) => isSchemaCandidate(f.path)));
  const env = extractEnv({ sources: candidates, parsed });
  warnings.push(...envWarnings(env));

  const coverage = parseCoverage(
    candidates.filter((f) => isCoverageFile(f.path)),
    new Set(fileRecords.map((f) => f.path)),
  );
  if (coverage) {
    const byPath = new Map(coverage.files.map((f) => [f.path, f.coverage]));
    for (const record of fileRecords) record.coverage = byPath.get(record.path);
  }

  // ---- 8. Metrics -------------------------------------------------------
  report('metrics', 'Computing metrics', 0.75);

  const duplication = detectDuplication(
    [...maskedCode.entries()].map(([path, code]) => ({ path, code })),
    fileRecords.reduce((sum, f) => sum + (f.parsed ? f.loc.code : 0), 0),
  );
  for (const clone of duplication.clones) {
    for (const occurrence of clone.occurrences) {
      const record = fileRecords.find((f) => f.path === occurrence.path);
      if (!record) continue;
      const lines = occurrence.endLine - occurrence.startLine + 1;
      record.duplicationRatio = Math.min(
        1,
        (record.duplicationRatio ?? 0) + lines / Math.max(1, record.loc.code),
      );
    }
  }

  const metrics = computeMetrics({
    files: fileRecords,
    parsed,
    fileEdges,
    dependencies,
    externalCount: externals.size,
    cycles,
    duplication,
    coverage,
    markers,
  });

  // ---- 9. Entry points --------------------------------------------------
  const entryPoints: EntryPoint[] = detectEntryPoints(fileRecords, manifests, fanIn);
  const entrySet = new Set(entryPoints.map((e) => e.path));
  for (const record of fileRecords) record.isEntryPoint = entrySet.has(record.path);

  // ---- 10. Graphs -------------------------------------------------------
  report('graphing', 'Building interactive graphs', 0.85);

  const graphInput: GraphInput = {
    files: fileRecords,
    parsed,
    fileEdges,
    externals,
    cycles,
    apis,
    schema,
    env,
    limits: limits.graph,
  };
  const graphs = buildAllGraphs(graphInput);

  // ---- 11. Search + insights --------------------------------------------
  report('insights', 'Generating architecture insights', 0.93);

  const searchIndexEntries = buildSearchIndex({
    files: fileRecords,
    parsed,
    apis,
    schema,
    env,
    dependencies,
  });

  const repo: RepoSummary = {
    name: options.repo?.name ?? manifests.projectName ?? options.source.label,
    description: options.repo?.description ?? manifests.projectDescription,
    defaultBranch: options.repo?.defaultBranch,
    stars: options.repo?.stars,
    license: options.repo?.license ?? manifests.license,
    topics: options.repo?.topics,
    totalFiles: allFiles.length,
    skippedFiles: skipped,
    sizeBytes: totalBytes,
  };

  const timeline = options.timeline ?? EMPTY_TIMELINE;

  const partial = {
    id: options.id,
    version: ANALYSIS_VERSION,
    createdAt: new Date().toISOString(),
    durationMs: 0,
    source: options.source,
    repo,
    stack,
    files: fileRecords,
    dependencies,
    graphs,
    metrics,
    apis,
    schema,
    env,
    entryPoints,
    cycles,
    searchIndex: searchIndexEntries,
    timeline,
    warnings: [...new Set(warnings)].slice(0, 50),
  };

  const insights = buildHeuristicInsights({ ...partial, parsed, fileEdges });

  report('done', 'Analysis complete', 1);

  return { ...partial, insights, durationMs: Date.now() - started };
}

function baseRecord(
  file: SourceFile,
  language: FileRecord['language'],
  generated: boolean,
  loc: FileRecord['loc'],
): FileRecord {
  return {
    path: file.path,
    dir: dirname(file.path) || '.',
    name: basename(file.path),
    ext: extensionOf(file.path),
    language,
    bytes: file.bytes,
    loc,
    complexity: 0,
    maintainability: 100,
    fanIn: 0,
    fanOut: 0,
    symbolCount: 0,
    isTest: isTestPath(file.path),
    isGenerated: generated,
    isEntryPoint: false,
    parsed: false,
  };
}

function countLinesOnly(content: string): FileRecord['loc'] {
  const lines = content.split('\n');
  let blank = 0;
  for (const line of lines) if (!line.trim()) blank += 1;
  return { total: lines.length, code: lines.length - blank, comment: 0, blank };
}

/** Module bucket for a path, re-exported so the UI groups the same way. */
export { moduleKeyFor };
