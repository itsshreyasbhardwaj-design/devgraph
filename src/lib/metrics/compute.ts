import type {
  ComplexityHotspot,
  CouplingEntry,
  CouplingReport,
  CoverageReport,
  DebtMarker,
  DependencyCycle,
  DependencyRecord,
  DuplicationReport,
  FileRecord,
  Histogram,
  MaintainabilityEntry,
  MetricsReport,
  ModuleCoupling,
  ParsedFile,
} from '@/lib/core/types';
import { moduleKeyFor } from '@/lib/core/paths';
import type { ResolvedFileEdge } from '@/lib/graph/builders';
import { buildDebtReport } from './debt';

export interface MetricsInput {
  files: FileRecord[];
  parsed: Map<string, ParsedFile>;
  fileEdges: ResolvedFileEdge[];
  dependencies: DependencyRecord[];
  externalCount: number;
  cycles: DependencyCycle[];
  duplication: DuplicationReport;
  coverage?: CoverageReport;
  markers: DebtMarker[];
}

export function computeMetrics(input: MetricsInput): MetricsReport {
  const analysed = input.files.filter((file) => file.parsed && !file.isGenerated);
  const totals = computeTotals(input);
  const complexity = computeComplexity(input, analysed);
  const maintainability = computeMaintainability(analysed);
  const size = computeSize(input.files);
  const coupling = computeCoupling(input);

  const debt = buildDebtReport({
    files: input.files,
    markers: input.markers,
    cycles: input.cycles,
    duplication: input.duplication,
    coverage: input.coverage,
    averageMaintainability: maintainability.average,
    maxComplexity: complexity.max,
  });

  return {
    totals,
    complexity,
    maintainability,
    size,
    coupling,
    duplication: input.duplication,
    coverage: input.coverage,
    debt,
  };
}

function computeTotals(input: MetricsInput): MetricsReport['totals'] {
  let lines = 0;
  let code = 0;
  let comment = 0;
  let blank = 0;
  let bytes = 0;
  let symbols = 0;
  let analysedFiles = 0;

  for (const file of input.files) {
    lines += file.loc.total;
    code += file.loc.code;
    comment += file.loc.comment;
    blank += file.loc.blank;
    bytes += file.bytes;
    symbols += file.symbolCount;
    if (file.parsed) analysedFiles += 1;
  }

  return {
    files: input.files.length,
    analysedFiles,
    lines,
    code,
    comment,
    blank,
    bytes,
    symbols,
    dependencies: input.dependencies.length,
    externalDependencies: input.externalCount,
  };
}

function computeComplexity(
  input: MetricsInput,
  analysed: FileRecord[],
): MetricsReport['complexity'] {
  const hotspots: ComplexityHotspot[] = [];
  let total = 0;
  let max = 0;

  for (const file of analysed) {
    total += file.complexity;
    max = Math.max(max, file.complexity);
    const parsed = input.parsed.get(file.path);
    if (!parsed) continue;
    for (const symbol of parsed.symbols) {
      if (symbol.complexity < 8) continue;
      hotspots.push({
        path: file.path,
        symbol: symbol.container ? `${symbol.container}.${symbol.name}` : symbol.name,
        line: symbol.line,
        complexity: symbol.complexity,
        loc: symbol.loc,
        maxNesting: symbol.maxNesting,
      });
    }
  }

  // Files that are complex overall but whose complexity is spread thin.
  for (const file of analysed) {
    if (file.complexity < 25) continue;
    if (hotspots.some((h) => h.path === file.path)) continue;
    hotspots.push({
      path: file.path,
      complexity: file.complexity,
      loc: file.loc.code,
      maxNesting: 0,
    });
  }

  return {
    total,
    average: analysed.length ? Number((total / analysed.length).toFixed(2)) : 0,
    max,
    histogram: histogram(
      analysed.map((f) => f.complexity),
      [
        { label: '1–5', from: 0, to: 5 },
        { label: '6–10', from: 5, to: 10 },
        { label: '11–20', from: 10, to: 20 },
        { label: '21–50', from: 20, to: 50 },
        { label: '50+', from: 50, to: Infinity },
      ],
    ),
    hotspots: hotspots.sort((a, b) => b.complexity - a.complexity).slice(0, 50),
  };
}

function computeMaintainability(analysed: FileRecord[]): MetricsReport['maintainability'] {
  const scores = analysed.map((f) => f.maintainability);
  const average = scores.length
    ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1))
    : 100;

  const atRisk: MaintainabilityEntry[] = analysed
    .filter((f) => f.maintainability < 65)
    .sort((a, b) => a.maintainability - b.maintainability)
    .slice(0, 40)
    .map((f) => ({
      path: f.path,
      maintainability: f.maintainability,
      complexity: f.complexity,
      loc: f.loc.code,
    }));

  return {
    average,
    atRisk,
    histogram: histogram(scores, [
      { label: 'Poor (0–49)', from: -1, to: 50 },
      { label: 'Moderate (50–69)', from: 50, to: 70 },
      { label: 'Good (70–84)', from: 70, to: 85 },
      { label: 'Excellent (85+)', from: 85, to: Infinity },
    ]),
  };
}

function computeSize(files: FileRecord[]): MetricsReport['size'] {
  return {
    largestFiles: [...files]
      .sort((a, b) => b.loc.total - a.loc.total)
      .slice(0, 30)
      .map((f) => ({ path: f.path, lines: f.loc.total, bytes: f.bytes })),
    histogram: histogram(
      files.map((f) => f.loc.total),
      [
        { label: '< 50', from: -1, to: 50 },
        { label: '50–150', from: 50, to: 150 },
        { label: '150–400', from: 150, to: 400 },
        { label: '400–1000', from: 400, to: 1000 },
        { label: '1000+', from: 1000, to: Infinity },
      ],
    ),
  };
}

function computeCoupling(input: MetricsInput): CouplingReport {
  const entries: CouplingEntry[] = input.files
    .filter((f) => f.parsed)
    .map((f) => ({
      path: f.path,
      fanIn: f.fanIn,
      fanOut: f.fanOut,
      instability: f.fanIn + f.fanOut > 0 ? Number((f.fanOut / (f.fanIn + f.fanOut)).toFixed(3)) : 0,
    }));

  const totalFanIn = entries.reduce((sum, e) => sum + e.fanIn, 0);
  const totalFanOut = entries.reduce((sum, e) => sum + e.fanOut, 0);
  const n = entries.length;

  // -- module-level coupling and cohesion ---------------------------------
  const moduleFiles = new Map<string, Set<string>>();
  for (const file of input.files) {
    if (!file.parsed) continue;
    const key = moduleKeyFor(file.path);
    const set = moduleFiles.get(key) ?? new Set<string>();
    set.add(file.path);
    moduleFiles.set(key, set);
  }

  const moduleOf = new Map<string, string>();
  for (const [key, paths] of moduleFiles) {
    for (const path of paths) moduleOf.set(path, key);
  }

  const stats = new Map<string, { internal: number; incoming: number; outgoing: number }>();
  for (const key of moduleFiles.keys()) stats.set(key, { internal: 0, incoming: 0, outgoing: 0 });

  for (const edge of input.fileEdges) {
    const from = moduleOf.get(edge.from);
    const to = moduleOf.get(edge.to);
    if (!from || !to) continue;
    if (from === to) {
      stats.get(from)!.internal += 1;
      continue;
    }
    stats.get(from)!.outgoing += 1;
    stats.get(to)!.incoming += 1;
  }

  const modules: ModuleCoupling[] = [...moduleFiles.entries()]
    .map(([module, paths]) => {
      const stat = stats.get(module)!;
      const fileCount = paths.size;
      return {
        module,
        files: fileCount,
        internalEdges: stat.internal,
        incoming: stat.incoming,
        outgoing: stat.outgoing,
        instability:
          stat.incoming + stat.outgoing > 0
            ? Number((stat.outgoing / (stat.incoming + stat.outgoing)).toFixed(3))
            : 0,
        // Relational cohesion: internal references per file. Values around
        // 1.5–4 indicate a module whose parts genuinely belong together.
        cohesion: Number((stat.internal / Math.max(1, fileCount)).toFixed(2)),
      };
    })
    .sort((a, b) => b.files - a.files);

  const possibleEdges = n * (n - 1);

  return {
    mostDependedUpon: [...entries].sort((a, b) => b.fanIn - a.fanIn).slice(0, 20),
    mostDependent: [...entries].sort((a, b) => b.fanOut - a.fanOut).slice(0, 20),
    averageFanIn: n ? Number((totalFanIn / n).toFixed(2)) : 0,
    averageFanOut: n ? Number((totalFanOut / n).toFixed(2)) : 0,
    graphDensity: possibleEdges ? Number((input.fileEdges.length / possibleEdges).toFixed(5)) : 0,
    modules: modules.slice(0, 60),
  };
}

export function histogram(
  values: number[],
  buckets: { label: string; from: number; to: number }[],
): Histogram {
  return {
    buckets: buckets.map((bucket) => ({
      ...bucket,
      count: values.filter((value) => value > bucket.from && value <= bucket.to).length,
    })),
  };
}
