/**
 * DevGraph core domain model.
 *
 * Everything in this file is framework-agnostic and dependency-free so the
 * analysis engine can run in a Node server, a worker, a CLI, or a test runner.
 */

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export const LANGUAGE_IDS = [
  'typescript',
  'javascript',
  'python',
  'java',
  'go',
  'rust',
  'csharp',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'scala',
  'c',
  'cpp',
  'sql',
  'html',
  'css',
  'shell',
  'markdown',
  'json',
  'yaml',
  'toml',
  'xml',
  'other',
] as const;

export type LanguageId = (typeof LANGUAGE_IDS)[number];

/** Languages with a dedicated structural parser. */
export const ANALYZED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'java',
  'go',
  'rust',
  'csharp',
  'php',
] as const satisfies readonly LanguageId[];

export type AnalyzedLanguage = (typeof ANALYZED_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type RepoSourceKind = 'github' | 'zip' | 'local' | 'sample';

export interface RepoSource {
  kind: RepoSourceKind;
  /** Human readable label, e.g. `vercel/next.js` or `my-app.zip`. */
  label: string;
  /** Canonical URL when the source is remote. */
  url?: string;
  ref?: string;
  commit?: string;
}

export interface SourceFile {
  /** Repo-relative POSIX path. */
  path: string;
  content: string;
  bytes: number;
}

// ---------------------------------------------------------------------------
// Parsed IR — produced by language parsers
// ---------------------------------------------------------------------------

export type ImportKind = 'static' | 'dynamic' | 'require' | 'type' | 'side-effect' | 'reexport';

export interface ImportRef {
  specifier: string;
  kind: ImportKind;
  /** Imported binding names, `*` for namespace imports, `default` for defaults. */
  symbols: string[];
  line: number;
}

export type ExportKind = 'named' | 'default' | 'namespace' | 'type' | 'declaration';

export interface ExportRef {
  name: string;
  kind: ExportKind;
  line: number;
}

export const SYMBOL_KINDS = [
  'class',
  'interface',
  'struct',
  'enum',
  'trait',
  'type',
  'function',
  'method',
  'component',
  'hook',
  'constant',
  'variable',
  'module',
] as const;

export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export type Visibility = 'public' | 'private' | 'protected' | 'internal' | 'package';

export interface SymbolDef {
  /** Stable id: `<path>#<name>@<line>`. */
  id: string;
  name: string;
  kind: SymbolKind;
  path: string;
  line: number;
  endLine: number;
  /** Name of the enclosing class/struct/module, when nested. */
  container?: string;
  visibility?: Visibility;
  isAsync?: boolean;
  isStatic?: boolean;
  isAbstract?: boolean;
  isExported?: boolean;
  isGenerator?: boolean;
  params: string[];
  returnType?: string;
  /** Superclasses / embedded types. */
  extends?: string[];
  /** Implemented interfaces / traits. */
  implements?: string[];
  decorators?: string[];
  /** Capitalised JSX elements rendered by a UI component. */
  renders?: string[];
  /** Cyclomatic complexity of the symbol body. */
  complexity: number;
  /** Physical lines of the symbol body. */
  loc: number;
  /** Nesting depth of control flow inside the symbol. */
  maxNesting: number;
  doc?: string;
}

export interface CallRef {
  /** Symbol name that contains the call site (or `<module>`). */
  from: string;
  /** Callee name as written at the call site. */
  to: string;
  line: number;
  /** Receiver expression for member calls, e.g. `this`, `db`, `axios`. */
  receiver?: string;
}

export interface ParsedFile {
  path: string;
  language: LanguageId;
  imports: ImportRef[];
  exports: ExportRef[];
  symbols: SymbolDef[];
  calls: CallRef[];
  /** Referenced environment variables. */
  envRefs: EnvRef[];
  /** File-level cyclomatic complexity. */
  complexity: number;
  loc: LineCounts;
  /** Parse issues that did not prevent extraction. */
  warnings?: string[];
}

export interface EnvRef {
  name: string;
  line: number;
  accessor: string;
}

export interface LineCounts {
  total: number;
  code: number;
  comment: number;
  blank: number;
}

// ---------------------------------------------------------------------------
// File records — the analysed unit persisted in a result
// ---------------------------------------------------------------------------

export interface FileRecord {
  path: string;
  dir: string;
  name: string;
  ext: string;
  language: LanguageId;
  bytes: number;
  loc: LineCounts;
  complexity: number;
  maintainability: number;
  /** Number of resolved internal imports. */
  fanOut: number;
  /** Number of internal files importing this one. */
  fanIn: number;
  symbolCount: number;
  isTest: boolean;
  isGenerated: boolean;
  isEntryPoint: boolean;
  coverage?: number;
  duplicationRatio?: number;
  parsed?: boolean;
}

// ---------------------------------------------------------------------------
// Graphs
// ---------------------------------------------------------------------------

export const GRAPH_KINDS = [
  'folders',
  'imports',
  'modules',
  'classes',
  'calls',
  'components',
  'cycles',
  'api',
  'schema',
  'env',
] as const;

export type GraphKind = (typeof GRAPH_KINDS)[number];

export type NodeKind =
  | 'folder'
  | 'file'
  | 'module'
  | 'package'
  | 'external'
  | 'class'
  | 'interface'
  | 'enum'
  | 'function'
  | 'method'
  | 'component'
  | 'route'
  | 'table'
  | 'column'
  | 'env'
  | 'cycle'
  | 'entry';

export type EdgeKind =
  | 'contains'
  | 'imports'
  | 'reexports'
  | 'calls'
  | 'extends'
  | 'implements'
  | 'renders'
  | 'references'
  | 'foreign-key'
  | 'cycle'
  | 'handles';

export type LayoutHint = 'layered' | 'tree' | 'force' | 'radial' | 'grid';

export interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Cluster key used for colouring and grouping (usually the top-level dir). */
  group?: string;
  path?: string;
  line?: number;
  language?: LanguageId;
  /** Relative visual weight (LOC, member count, …). */
  weight?: number;
  parentId?: string;
  childIds?: string[];
  /** True when the node aggregates children that were pruned for performance. */
  collapsed?: boolean;
  metrics?: NodeMetrics;
  meta?: Record<string, string | number | boolean | string[]>;
}

export interface NodeMetrics {
  loc?: number;
  complexity?: number;
  maintainability?: number;
  fanIn?: number;
  fanOut?: number;
  instability?: number;
  coverage?: number;
  members?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  weight?: number;
  label?: string;
  /** Marks an edge that participates in a dependency cycle. */
  cyclic?: boolean;
}

export interface DevGraphView {
  kind: GraphKind;
  title: string;
  description: string;
  layout: LayoutHint;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Set when nodes/edges were capped for rendering performance. */
  truncated?: { nodes: number; edges: number; reason: string };
  stats: GraphStats;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;
  density: number;
}

// ---------------------------------------------------------------------------
// Stack detection
// ---------------------------------------------------------------------------

export type StackCategory =
  | 'language'
  | 'framework'
  | 'runtime'
  | 'package-manager'
  | 'build-tool'
  | 'database'
  | 'orm'
  | 'api-style'
  | 'testing'
  | 'ci-cd'
  | 'deployment'
  | 'containerization'
  | 'styling'
  | 'state-management'
  | 'auth'
  | 'monorepo';

export interface StackFinding {
  category: StackCategory;
  name: string;
  /** 0–1. */
  confidence: number;
  version?: string;
  /** Files that produced the signal. */
  evidence: string[];
}

export interface LanguageBreakdown {
  language: LanguageId;
  files: number;
  lines: number;
  bytes: number;
  share: number;
}

export interface StackProfile {
  primaryLanguage: LanguageId;
  languages: LanguageBreakdown[];
  findings: StackFinding[];
  monorepo: boolean;
  workspaces: string[];
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface MetricsReport {
  totals: {
    files: number;
    analysedFiles: number;
    lines: number;
    code: number;
    comment: number;
    blank: number;
    bytes: number;
    symbols: number;
    dependencies: number;
    externalDependencies: number;
  };
  complexity: {
    total: number;
    average: number;
    max: number;
    /** Distribution buckets for the dashboard. */
    histogram: Histogram;
    hotspots: ComplexityHotspot[];
  };
  maintainability: {
    average: number;
    /** Files below the "needs attention" threshold. */
    atRisk: MaintainabilityEntry[];
    histogram: Histogram;
  };
  size: {
    largestFiles: SizeEntry[];
    histogram: Histogram;
  };
  coupling: CouplingReport;
  duplication: DuplicationReport;
  coverage?: CoverageReport;
  debt: TechnicalDebtReport;
}

export interface Histogram {
  buckets: { label: string; from: number; to: number; count: number }[];
}

export interface ComplexityHotspot {
  path: string;
  symbol?: string;
  line?: number;
  complexity: number;
  loc: number;
  maxNesting: number;
}

export interface MaintainabilityEntry {
  path: string;
  maintainability: number;
  complexity: number;
  loc: number;
}

export interface SizeEntry {
  path: string;
  lines: number;
  bytes: number;
}

export interface CouplingReport {
  /** Files with the highest afferent coupling. */
  mostDependedUpon: CouplingEntry[];
  /** Files with the highest efferent coupling. */
  mostDependent: CouplingEntry[];
  averageFanIn: number;
  averageFanOut: number;
  /** Ratio of internal edges to possible edges. */
  graphDensity: number;
  modules: ModuleCoupling[];
}

export interface CouplingEntry {
  path: string;
  fanIn: number;
  fanOut: number;
  instability: number;
}

export interface ModuleCoupling {
  module: string;
  files: number;
  internalEdges: number;
  incoming: number;
  outgoing: number;
  instability: number;
  /** Relational cohesion: internal edges per file. */
  cohesion: number;
}

export interface DuplicationReport {
  /** Share of analysed code lines that appear in at least one clone. */
  ratio: number;
  clones: DuplicateBlock[];
  totalDuplicatedLines: number;
}

export interface DuplicateBlock {
  lines: number;
  tokens: number;
  occurrences: { path: string; startLine: number; endLine: number }[];
}

export interface CoverageReport {
  source: string;
  overall: number;
  files: { path: string; coverage: number; covered: number; total: number }[];
}

export interface TechnicalDebtReport {
  score: number;
  markers: DebtMarker[];
  signals: DebtSignal[];
}

export interface DebtMarker {
  path: string;
  line: number;
  tag: string;
  text: string;
}

export interface DebtSignal {
  id: string;
  title: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  detail: string;
  files: string[];
  metric?: number;
}

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

export type HttpMethod =
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'ALL' | 'WS' | 'RPC';

export interface ApiRoute {
  id: string;
  method: HttpMethod;
  path: string;
  handler?: string;
  file: string;
  line: number;
  framework: string;
  style: 'rest' | 'graphql' | 'grpc' | 'trpc' | 'websocket' | 'rpc';
  middleware?: string[];
}

export interface DbColumn {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: string;
  references?: { table: string; column?: string };
}

export interface DbTable {
  id: string;
  name: string;
  file: string;
  line: number;
  source: string;
  columns: DbColumn[];
  indexes?: string[];
}

export interface DbSchema {
  dialect: string;
  tables: DbTable[];
  relations: { id: string; from: string; to: string; label: string }[];
}

export interface EnvVarRecord {
  name: string;
  usages: { path: string; line: number; accessor: string }[];
  declaredIn: string[];
  hasDefault: boolean;
  /** Heuristic: looks like a secret (KEY/TOKEN/SECRET/PASSWORD/…). */
  sensitive: boolean;
  clientExposed: boolean;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export type SearchEntryKind =
  | 'file'
  | 'folder'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'component'
  | 'route'
  | 'table'
  | 'column'
  | 'env'
  | 'dependency';

export interface SearchEntry {
  id: string;
  label: string;
  kind: SearchEntryKind;
  path?: string;
  line?: number;
  detail?: string;
  /** Graph views in which this entry has a node, mapped to the node id. */
  targets: { graph: GraphKind; nodeId: string }[];
  /** Lowercased haystack used for matching. */
  haystack: string;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export type InsightTopic =
  | 'overview'
  | 'modules'
  | 'entry-points'
  | 'auth-flow'
  | 'api-lifecycle'
  | 'data-flow'
  | 'state-management'
  | 'dependencies'
  | 'performance'
  | 'technical-debt'
  | 'improvements';

export interface InsightSection {
  topic: InsightTopic;
  title: string;
  summary: string;
  /** Markdown body. */
  body: string;
  references: InsightReference[];
  confidence: 'high' | 'medium' | 'low';
}

export interface InsightReference {
  path: string;
  line?: number;
  note?: string;
}

export interface InsightReport {
  generatedBy: 'heuristic' | 'llm';
  model?: string;
  sections: InsightSection[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface CommitRecord {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  message: string;
  additions?: number;
  deletions?: number;
  filesChanged?: number;
}

export interface TimelineSnapshot {
  sha: string;
  date: string;
  files: number;
  lines: number;
  modules: Record<string, number>;
  dependencies: string[];
}

export interface TimelineReport {
  available: boolean;
  reason?: string;
  commits: CommitRecord[];
  snapshots: TimelineSnapshot[];
  moduleGrowth: { module: string; series: { date: string; value: number }[] }[];
  dependencyEvents: {
    date: string;
    sha: string;
    added: string[];
    removed: string[];
  }[];
}

export interface TimelineDiff {
  from: string;
  to: string;
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  addedDependencies: string[];
  removedDependencies: string[];
  moduleDelta: { module: string; before: number; after: number; delta: number }[];
}

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

export interface RepoSummary {
  name: string;
  description?: string;
  defaultBranch?: string;
  stars?: number;
  license?: string;
  topics?: string[];
  totalFiles: number;
  skippedFiles: number;
  sizeBytes: number;
}

export interface AnalysisResult {
  id: string;
  version: number;
  createdAt: string;
  durationMs: number;
  source: RepoSource;
  repo: RepoSummary;
  stack: StackProfile;
  files: FileRecord[];
  dependencies: DependencyRecord[];
  graphs: Partial<Record<GraphKind, DevGraphView>>;
  metrics: MetricsReport;
  apis: ApiRoute[];
  schema: DbSchema;
  env: EnvVarRecord[];
  entryPoints: EntryPoint[];
  cycles: DependencyCycle[];
  searchIndex: SearchEntry[];
  insights: InsightReport;
  timeline: TimelineReport;
  warnings: string[];
}

export interface DependencyRecord {
  name: string;
  version?: string;
  kind: 'runtime' | 'dev' | 'peer' | 'optional' | 'unknown';
  ecosystem: string;
  usedBy: number;
  manifest: string;
}

export interface EntryPoint {
  path: string;
  reason: string;
  kind: 'app' | 'server' | 'cli' | 'worker' | 'test' | 'build' | 'page';
  confidence: number;
}

export interface DependencyCycle {
  id: string;
  files: string[];
  length: number;
  severity: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Progress streaming
// ---------------------------------------------------------------------------

export type AnalysisPhase =
  | 'queued'
  | 'fetching'
  | 'unpacking'
  | 'scanning'
  | 'parsing'
  | 'resolving'
  | 'metrics'
  | 'extracting'
  | 'graphing'
  | 'insights'
  | 'timeline'
  | 'finalizing'
  | 'done'
  | 'error';

export interface AnalysisProgress {
  phase: AnalysisPhase;
  message: string;
  /** 0–1. */
  progress: number;
  detail?: string;
}

export type AnalysisStreamEvent =
  | { type: 'progress'; data: AnalysisProgress }
  | { type: 'warning'; data: string }
  | { type: 'result'; data: AnalysisResult }
  | { type: 'error'; data: { message: string; code?: string } };
