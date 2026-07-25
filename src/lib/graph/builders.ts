import type {
  ApiRoute,
  DbSchema,
  DependencyCycle,
  DevGraphView,
  EnvVarRecord,
  FileRecord,
  GraphEdge,
  GraphKind,
  GraphNode,
  GraphStats,
  LayoutHint,
  ParsedFile,
} from '@/lib/core/types';
import { LANGUAGE_LABELS } from '@/lib/core/languages';
import { basename, dirname, moduleKeyFor, topLevelSegment } from '@/lib/core/paths';
import { buildAdjacency, computeLayers, cyclicEdgeKeys, graphDepth } from './cycles';

/** Per-view node budget. Beyond this the builder aggregates or trims. */
export interface GraphLimits {
  maxNodes: number;
  maxEdges: number;
}

export const DEFAULT_LIMITS: GraphLimits = { maxNodes: 1500, maxEdges: 4000 };

export interface ResolvedFileEdge {
  from: string;
  to: string;
  kind: 'imports' | 'reexports';
  weight: number;
}

export interface ExternalDependencyUse {
  packageName: string;
  usedBy: Set<string>;
  builtin: boolean;
}

export interface GraphInput {
  files: FileRecord[];
  parsed: Map<string, ParsedFile>;
  fileEdges: ResolvedFileEdge[];
  externals: Map<string, ExternalDependencyUse>;
  cycles: DependencyCycle[];
  apis: ApiRoute[];
  schema: DbSchema;
  env: EnvVarRecord[];
  limits?: GraphLimits;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function statsFor(nodes: GraphNode[], edges: GraphEdge[], depth: number): GraphStats {
  const n = nodes.length;
  const possible = n * (n - 1);
  return {
    nodeCount: n,
    edgeCount: edges.length,
    maxDepth: depth,
    density: possible > 0 ? Number((edges.length / possible).toFixed(5)) : 0,
  };
}

function view(
  kind: GraphKind,
  title: string,
  description: string,
  layout: LayoutHint,
  nodes: GraphNode[],
  edges: GraphEdge[],
  depth = 0,
  truncated?: DevGraphView['truncated'],
): DevGraphView {
  return {
    kind,
    title,
    description,
    layout,
    nodes,
    edges,
    truncated,
    stats: statsFor(nodes, edges, depth),
  };
}

/**
 * Keep a graph renderable: retain the highest-signal nodes (by degree, then
 * weight) and drop edges that reference removed nodes. The caller is told what
 * was dropped so the UI can say so out loud instead of quietly lying.
 */
function enforceLimits(
  nodes: GraphNode[],
  edges: GraphEdge[],
  limits: GraphLimits,
  reason: string,
): { nodes: GraphNode[]; edges: GraphEdge[]; truncated?: DevGraphView['truncated'] } {
  if (nodes.length <= limits.maxNodes && edges.length <= limits.maxEdges) {
    return { nodes, edges };
  }

  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  const ranked = [...nodes].sort((a, b) => {
    const byDegree = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    if (byDegree !== 0) return byDegree;
    return (b.weight ?? 0) - (a.weight ?? 0);
  });

  const keptNodes = ranked.slice(0, limits.maxNodes);
  const keptIds = new Set(keptNodes.map((n) => n.id));
  // Preserve ancestors so the hierarchy never dangles.
  for (const node of nodes) {
    if (!keptIds.has(node.id)) continue;
    let parent = node.parentId;
    while (parent && !keptIds.has(parent)) {
      const parentNode = nodes.find((n) => n.id === parent);
      if (!parentNode) break;
      keptNodes.push(parentNode);
      keptIds.add(parentNode.id);
      parent = parentNode.parentId;
    }
  }

  const keptEdges = edges
    .filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target))
    .slice(0, limits.maxEdges);

  return {
    nodes: keptNodes,
    edges: keptEdges,
    truncated: {
      nodes: nodes.length - keptNodes.length,
      edges: edges.length - keptEdges.length,
      reason,
    },
  };
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const byId = new Map<string, GraphEdge>();
  for (const edge of edges) {
    const existing = byId.get(edge.id);
    if (existing) {
      existing.weight = (existing.weight ?? 1) + (edge.weight ?? 1);
      existing.cyclic = existing.cyclic || edge.cyclic;
      continue;
    }
    byId.set(edge.id, { ...edge });
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Folder hierarchy
// ---------------------------------------------------------------------------

export function buildFolderGraph(input: GraphInput): DevGraphView {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const ensureFolder = (path: string): string => {
    const id = `dir:${path || '.'}`;
    if (nodes.has(id)) return id;
    const parentPath = path ? dirname(path) : '';
    const parentId =
      path && parentPath !== path ? ensureFolder(parentPath === '/' ? '' : parentPath) : undefined;
    nodes.set(id, {
      id,
      label: path ? basename(path) : '/',
      kind: 'folder',
      group: topLevelSegment(path) || '/',
      path: path || '.',
      parentId,
      childIds: [],
      weight: 0,
      metrics: { loc: 0 },
    });
    if (parentId) {
      nodes.get(parentId)?.childIds?.push(id);
      edges.push({ id: `${parentId}->${id}`, source: parentId, target: id, kind: 'contains' });
    }
    return id;
  };

  ensureFolder('');

  for (const file of input.files) {
    const parentId = ensureFolder(file.dir === '.' ? '' : file.dir);
    const id = `file:${file.path}`;
    nodes.set(id, {
      id,
      label: file.name,
      kind: 'file',
      group: topLevelSegment(file.path),
      path: file.path,
      language: file.language,
      parentId,
      weight: file.loc.total,
      metrics: {
        loc: file.loc.total,
        complexity: file.complexity,
        maintainability: file.maintainability,
        fanIn: file.fanIn,
        fanOut: file.fanOut,
        coverage: file.coverage,
      },
      meta: {
        bytes: file.bytes,
        isTest: file.isTest,
        isGenerated: file.isGenerated,
        isEntryPoint: file.isEntryPoint,
        symbols: file.symbolCount,
      },
    });
    nodes.get(parentId)?.childIds?.push(id);
    edges.push({ id: `${parentId}->${id}`, source: parentId, target: id, kind: 'contains' });

    // Roll size up through the ancestry.
    let cursor: string | undefined = parentId;
    while (cursor) {
      const folder: GraphNode | undefined = nodes.get(cursor);
      if (!folder) break;
      folder.weight = (folder.weight ?? 0) + file.loc.total;
      folder.metrics = { ...folder.metrics, loc: (folder.metrics?.loc ?? 0) + file.loc.total };
      cursor = folder.parentId;
    }
  }

  const allNodes = [...nodes.values()];
  const depth = allNodes.reduce(
    (max, node) => Math.max(max, (node.path ?? '').split('/').length),
    0,
  );
  const limited = enforceLimits(allNodes, edges, limits, 'Largest directories and files retained');

  return view(
    'folders',
    'Folder hierarchy',
    'Directory tree sized by lines of code.',
    'tree',
    limited.nodes,
    limited.edges,
    depth,
    limited.truncated,
  );
}

// ---------------------------------------------------------------------------
// File import graph
// ---------------------------------------------------------------------------

export function buildImportGraph(input: GraphInput): DevGraphView {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const cycleKeys = cyclicEdgeKeys(input.cycles.map((c) => c.files));

  // Only files that can participate in an import graph belong in it. Markdown,
  // TOML and asset files would otherwise arrive as hundreds of isolated dots
  // that dominate the layout and say nothing about dependencies.
  const connected = new Set<string>();
  for (const edge of input.fileEdges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const participating = input.files.filter((file) => file.parsed || connected.has(file.path));

  const nodes: GraphNode[] = participating.map((file) => ({
    id: file.path,
    label: file.name,
    kind: file.isEntryPoint ? 'entry' : 'file',
    group: moduleKeyFor(file.path),
    path: file.path,
    language: file.language,
    weight: file.loc.total,
    metrics: {
      loc: file.loc.total,
      complexity: file.complexity,
      maintainability: file.maintainability,
      fanIn: file.fanIn,
      fanOut: file.fanOut,
      instability: file.fanIn + file.fanOut > 0 ? file.fanOut / (file.fanIn + file.fanOut) : 0,
      coverage: file.coverage,
    },
    meta: { isTest: file.isTest, isGenerated: file.isGenerated },
  }));

  const known = new Set(nodes.map((n) => n.id));
  const edges = dedupeEdges(
    input.fileEdges
      .filter((edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to)
      .map((edge) => ({
        id: `${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        kind: edge.kind,
        weight: edge.weight,
        cyclic: cycleKeys.has(`${edge.from}->${edge.to}`),
      })),
  );

  const adjacency = buildAdjacency(known, edges);
  const depth = graphDepth(computeLayers(adjacency));
  const limited = enforceLimits(nodes, edges, limits, 'Most-connected files retained');

  return view(
    'imports',
    'Import graph',
    'How files depend on each other. Red edges close a dependency cycle.',
    'layered',
    limited.nodes,
    limited.edges,
    depth,
    limited.truncated,
  );
}

// ---------------------------------------------------------------------------
// Module dependency graph (aggregated) + external packages
// ---------------------------------------------------------------------------

export function buildModuleGraph(input: GraphInput): DevGraphView {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const moduleOf = new Map<string, string>();
  const modules = new Map<string, { files: number; loc: number; complexity: number }>();

  for (const file of input.files) {
    const key = moduleKeyFor(file.path);
    moduleOf.set(file.path, key);
    const entry = modules.get(key) ?? { files: 0, loc: 0, complexity: 0 };
    entry.files += 1;
    entry.loc += file.loc.total;
    entry.complexity += file.complexity;
    modules.set(key, entry);
  }

  const nodes: GraphNode[] = [...modules.entries()].map(([key, entry]) => ({
    id: `mod:${key}`,
    label: key,
    kind: 'module',
    group: topLevelSegment(key),
    path: key,
    weight: entry.loc,
    metrics: {
      loc: entry.loc,
      complexity: entry.complexity,
      members: entry.files,
    },
  }));

  const rawEdges: GraphEdge[] = [];
  for (const edge of input.fileEdges) {
    const from = moduleOf.get(edge.from);
    const to = moduleOf.get(edge.to);
    if (!from || !to || from === to) continue;
    rawEdges.push({
      id: `mod:${from}->mod:${to}`,
      source: `mod:${from}`,
      target: `mod:${to}`,
      kind: 'imports',
      weight: 1,
    });
  }

  // Top external packages, so the graph shows the outside world too.
  const topExternals = [...input.externals.values()]
    .filter((dep) => !dep.builtin)
    .sort((a, b) => b.usedBy.size - a.usedBy.size)
    .slice(0, 25);

  for (const dep of topExternals) {
    nodes.push({
      id: `pkg:${dep.packageName}`,
      label: dep.packageName,
      kind: 'external',
      group: 'external',
      weight: dep.usedBy.size,
      metrics: { fanIn: dep.usedBy.size },
    });
    const byModule = new Map<string, number>();
    for (const file of dep.usedBy) {
      const key = moduleOf.get(file);
      if (!key) continue;
      byModule.set(key, (byModule.get(key) ?? 0) + 1);
    }
    for (const [key, weight] of byModule) {
      rawEdges.push({
        id: `mod:${key}->pkg:${dep.packageName}`,
        source: `mod:${key}`,
        target: `pkg:${dep.packageName}`,
        kind: 'imports',
        weight,
      });
    }
  }

  const edges = dedupeEdges(rawEdges);
  const ids = new Set(nodes.map((n) => n.id));
  const depth = graphDepth(computeLayers(buildAdjacency(ids, edges)));
  const limited = enforceLimits(nodes, edges, limits, 'Largest modules retained');

  return view(
    'modules',
    'Module dependencies',
    'Directory-level dependencies plus the external packages each module pulls in.',
    'layered',
    limited.nodes,
    limited.edges,
    depth,
    limited.truncated,
  );
}

// ---------------------------------------------------------------------------
// Class diagram
// ---------------------------------------------------------------------------

export function buildClassGraph(input: GraphInput): DevGraphView {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byName = new Map<string, string>();

  const TYPE_KINDS = new Set(['class', 'interface', 'struct', 'enum', 'trait']);

  for (const parsed of input.parsed.values()) {
    for (const symbol of parsed.symbols) {
      if (!TYPE_KINDS.has(symbol.kind) || symbol.container) continue;
      const id = symbol.id;
      const members = parsed.symbols.filter((s) => s.container === symbol.name);
      nodes.push({
        id,
        label: symbol.name,
        kind:
          symbol.kind === 'interface' || symbol.kind === 'trait'
            ? 'interface'
            : symbol.kind === 'enum'
              ? 'enum'
              : 'class',
        group: moduleKeyFor(parsed.path),
        path: parsed.path,
        line: symbol.line,
        language: parsed.language,
        weight: Math.max(1, members.length),
        metrics: {
          loc: symbol.loc,
          complexity: members.reduce((sum, m) => sum + m.complexity, symbol.complexity),
          members: members.length,
        },
        meta: {
          isAbstract: Boolean(symbol.isAbstract),
          visibility: symbol.visibility ?? 'public',
          kind: symbol.kind,
          methods: members
            .filter((m) => m.kind === 'method')
            .slice(0, 24)
            .map(
              (m) =>
                `${m.visibility === 'private' ? '-' : m.visibility === 'protected' ? '#' : '+'}${m.name}(${m.params.length})`,
            ),
          fields: members
            .filter((m) => m.kind === 'variable')
            .slice(0, 16)
            .map((m) => m.name),
          doc: symbol.doc?.slice(0, 200) ?? '',
        },
      });
      if (!byName.has(symbol.name)) byName.set(symbol.name, id);
    }
  }

  for (const parsed of input.parsed.values()) {
    for (const symbol of parsed.symbols) {
      if (!TYPE_KINDS.has(symbol.kind) || symbol.container) continue;
      for (const base of symbol.extends ?? []) {
        const target = byName.get(shortName(base));
        if (!target || target === symbol.id) continue;
        edges.push({
          id: `${symbol.id}-ext->${target}`,
          source: symbol.id,
          target,
          kind: 'extends',
          label: 'extends',
        });
      }
      for (const iface of symbol.implements ?? []) {
        const target = byName.get(shortName(iface));
        if (!target || target === symbol.id) continue;
        edges.push({
          id: `${symbol.id}-impl->${target}`,
          source: symbol.id,
          target,
          kind: 'implements',
          label: 'implements',
        });
      }
    }
  }

  const deduped = dedupeEdges(edges);
  const depth = graphDepth(
    computeLayers(
      buildAdjacency(
        nodes.map((n) => n.id),
        deduped,
      ),
    ),
  );
  const limited = enforceLimits(nodes, deduped, limits, 'Types with the most members retained');

  return view(
    'classes',
    'Class diagram',
    'Types with their members, inheritance and interface implementations.',
    'layered',
    limited.nodes,
    limited.edges,
    depth,
    limited.truncated,
  );
}

function shortName(name: string): string {
  return (
    name
      .split(/[.:\\]/)
      .pop()
      ?.replace(/<.*$/, '')
      .trim() ?? name
  );
}

// ---------------------------------------------------------------------------
// Function call graph
// ---------------------------------------------------------------------------

export function buildCallGraph(input: GraphInput): DevGraphView {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const CALLABLE = new Set(['function', 'method', 'component', 'hook']);

  const nodes: GraphNode[] = [];
  /** name → symbol ids. Ambiguous names resolve to the same-file definition. */
  const byName = new Map<string, { id: string; path: string }[]>();

  for (const parsed of input.parsed.values()) {
    for (const symbol of parsed.symbols) {
      if (!CALLABLE.has(symbol.kind)) continue;
      nodes.push({
        id: symbol.id,
        label: symbol.container ? `${symbol.container}.${symbol.name}` : symbol.name,
        kind:
          symbol.kind === 'method'
            ? 'method'
            : symbol.kind === 'component'
              ? 'component'
              : 'function',
        group: moduleKeyFor(parsed.path),
        path: parsed.path,
        line: symbol.line,
        language: parsed.language,
        weight: symbol.loc,
        metrics: { loc: symbol.loc, complexity: symbol.complexity },
        meta: {
          container: symbol.container ?? '',
          isAsync: Boolean(symbol.isAsync),
          params: symbol.params.length,
          maxNesting: symbol.maxNesting,
          signature: `${symbol.name}(${symbol.params.join(', ')})`,
        },
      });
      const entry = byName.get(symbol.name) ?? [];
      entry.push({ id: symbol.id, path: parsed.path });
      byName.set(symbol.name, entry);
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];

  for (const parsed of input.parsed.values()) {
    const localByName = new Map<string, string>();
    for (const symbol of parsed.symbols) {
      if (CALLABLE.has(symbol.kind)) localByName.set(symbol.name, symbol.id);
    }

    for (const call of parsed.calls) {
      const sourceId = localByName.get(call.from);
      if (!sourceId || !nodeIds.has(sourceId)) continue;

      // Prefer a definition in the same file; otherwise accept a unique global.
      let targetId = localByName.get(call.to);
      if (!targetId) {
        const candidates = byName.get(call.to) ?? [];
        if (candidates.length === 1) targetId = candidates[0].id;
      }
      if (!targetId || targetId === sourceId || !nodeIds.has(targetId)) continue;

      edges.push({
        id: `${sourceId}=>${targetId}`,
        source: sourceId,
        target: targetId,
        kind: 'calls',
        weight: 1,
      });
    }
  }

  const deduped = dedupeEdges(edges);
  // Keep only functions that participate in the graph; isolated leaves would
  // otherwise swamp the canvas with thousands of disconnected dots.
  const connected = new Set<string>();
  for (const edge of deduped) {
    connected.add(edge.source);
    connected.add(edge.target);
  }
  const visible = nodes.filter((n) => connected.has(n.id) || (n.metrics?.complexity ?? 0) > 10);
  const visibleIds = new Set(visible.map((n) => n.id));
  const visibleEdges = deduped.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));

  const depth = graphDepth(computeLayers(buildAdjacency(visibleIds, visibleEdges)));
  const limited = enforceLimits(visible, visibleEdges, limits, 'Busiest call sites retained');

  return view(
    'calls',
    'Call graph',
    'Which functions call which. Isolated leaf functions are hidden unless complex.',
    'layered',
    limited.nodes,
    limited.edges,
    depth,
    limited.truncated,
  );
}

// ---------------------------------------------------------------------------
// Component hierarchy
// ---------------------------------------------------------------------------

export function buildComponentGraph(input: GraphInput): DevGraphView {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const nodes: GraphNode[] = [];
  const byName = new Map<string, string>();

  for (const parsed of input.parsed.values()) {
    for (const symbol of parsed.symbols) {
      if (symbol.kind !== 'component') continue;
      nodes.push({
        id: symbol.id,
        label: symbol.name,
        kind: 'component',
        group: moduleKeyFor(parsed.path),
        path: parsed.path,
        line: symbol.line,
        language: parsed.language,
        weight: symbol.loc,
        metrics: { loc: symbol.loc, complexity: symbol.complexity },
        meta: {
          props: symbol.params.slice(0, 8),
          hooks: parsed.calls
            .filter((c) => c.from === symbol.name && /^use[A-Z]/.test(c.to))
            .map((c) => c.to)
            .slice(0, 12),
        },
      });
      if (!byName.has(symbol.name)) byName.set(symbol.name, symbol.id);
    }
  }

  const edges: GraphEdge[] = [];
  for (const parsed of input.parsed.values()) {
    for (const symbol of parsed.symbols) {
      if (symbol.kind !== 'component') continue;
      for (const child of symbol.renders ?? []) {
        const target = byName.get(child);
        if (!target || target === symbol.id) continue;
        edges.push({
          id: `${symbol.id}~>${target}`,
          source: symbol.id,
          target,
          kind: 'renders',
          label: 'renders',
        });
      }
    }
  }

  const deduped = dedupeEdges(edges);
  const depth = graphDepth(
    computeLayers(
      buildAdjacency(
        nodes.map((n) => n.id),
        deduped,
      ),
    ),
  );
  const limited = enforceLimits(nodes, deduped, limits, 'Most-used components retained');

  return view(
    'components',
    'Component hierarchy',
    'UI components and what they render.',
    'tree',
    limited.nodes,
    limited.edges,
    depth,
    limited.truncated,
  );
}

// ---------------------------------------------------------------------------
// Circular dependencies
// ---------------------------------------------------------------------------

export function buildCycleGraph(input: GraphInput): DevGraphView {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();

  for (const cycle of input.cycles) {
    for (const path of cycle.files) {
      if (seen.has(path)) continue;
      seen.add(path);
      const file = input.files.find((f) => f.path === path);
      nodes.push({
        id: path,
        label: basename(path),
        kind: 'file',
        group: cycle.id,
        path,
        language: file?.language,
        weight: file?.loc.total ?? 1,
        metrics: { loc: file?.loc.total, complexity: file?.complexity },
        meta: { cycle: cycle.id, severity: cycle.severity, cycleLength: cycle.length },
      });
    }
    for (let i = 0; i < cycle.files.length; i += 1) {
      const source = cycle.files[i];
      const target = cycle.files[(i + 1) % cycle.files.length];
      if (cycle.files.length === 1) continue;
      edges.push({
        id: `${cycle.id}:${source}->${target}`,
        source,
        target,
        kind: 'cycle',
        cyclic: true,
      });
    }
  }

  return view(
    'cycles',
    'Circular dependencies',
    input.cycles.length
      ? `${input.cycles.length} dependency cycle${input.cycles.length === 1 ? '' : 's'} detected.`
      : 'No circular dependencies found.',
    'radial',
    nodes,
    dedupeEdges(edges),
    0,
  );
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

export function buildApiGraph(input: GraphInput): DevGraphView {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const groups = new Map<string, string>();

  for (const route of input.apis) {
    const groupKey = route.path.split('/').filter(Boolean)[0] ?? 'root';
    const groupId = `apigroup:${groupKey}`;
    if (!groups.has(groupId)) {
      groups.set(groupId, groupKey);
      nodes.push({
        id: groupId,
        label: `/${groupKey}`,
        kind: 'folder',
        group: 'api',
        weight: 1,
      });
    }
    nodes.push({
      id: route.id,
      label: `${route.method} ${route.path}`,
      kind: 'route',
      group: groupKey,
      path: route.file,
      line: route.line,
      parentId: groupId,
      weight: 1,
      meta: {
        method: route.method,
        framework: route.framework,
        style: route.style,
        handler: route.handler ?? '',
        middleware: route.middleware ?? [],
      },
    });
    edges.push({
      id: `${groupId}->${route.id}`,
      source: groupId,
      target: route.id,
      kind: 'contains',
    });
  }

  return view(
    'api',
    'API routes',
    input.apis.length ? `${input.apis.length} endpoints detected.` : 'No API routes detected.',
    'tree',
    nodes,
    edges,
    2,
  );
}

// ---------------------------------------------------------------------------
// Database schema
// ---------------------------------------------------------------------------

export function buildSchemaGraph(input: GraphInput): DevGraphView {
  const nodes: GraphNode[] = input.schema.tables.map((table) => ({
    id: table.id,
    label: table.name,
    kind: 'table',
    group: table.source,
    path: table.file,
    line: table.line,
    weight: table.columns.length,
    metrics: { members: table.columns.length },
    meta: {
      source: table.source,
      columns: table.columns.map(
        (c) => `${c.primaryKey ? '🔑 ' : ''}${c.name}: ${c.type}${c.nullable === false ? '' : '?'}`,
      ),
      indexes: table.indexes ?? [],
    },
  }));

  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = input.schema.relations
    .filter((relation) => ids.has(relation.from) && ids.has(relation.to))
    .map((relation) => ({
      id: relation.id,
      source: relation.from,
      target: relation.to,
      kind: 'foreign-key',
      label: relation.label,
    }));

  return view(
    'schema',
    'Database schema',
    input.schema.tables.length
      ? `${input.schema.tables.length} tables from ${input.schema.dialect}.`
      : 'No database schema detected.',
    'force',
    nodes,
    dedupeEdges(edges),
    1,
  );
}

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

export function buildEnvGraph(input: GraphInput): DevGraphView {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const fileNodes = new Set<string>();

  for (const record of input.env) {
    nodes.push({
      id: `env:${record.name}`,
      label: record.name,
      kind: 'env',
      group: record.sensitive ? 'secret' : record.clientExposed ? 'public' : 'config',
      weight: record.usages.length,
      meta: {
        sensitive: record.sensitive,
        clientExposed: record.clientExposed,
        declaredIn: record.declaredIn,
        hasDefault: record.hasDefault,
        usages: record.usages.length,
      },
    });

    for (const usage of record.usages.slice(0, 12)) {
      const id = `file:${usage.path}`;
      if (!fileNodes.has(id)) {
        fileNodes.add(id);
        nodes.push({
          id,
          label: basename(usage.path),
          kind: 'file',
          group: moduleKeyFor(usage.path),
          path: usage.path,
          weight: 1,
        });
      }
      edges.push({
        id: `${id}->env:${record.name}`,
        source: id,
        target: `env:${record.name}`,
        kind: 'references',
      });
    }
  }

  return view(
    'env',
    'Environment configuration',
    input.env.length
      ? `${input.env.length} environment variables referenced across the codebase.`
      : 'No environment variables detected.',
    'force',
    nodes,
    dedupeEdges(edges),
    1,
  );
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const BUILDERS: Record<GraphKind, (input: GraphInput) => DevGraphView> = {
  folders: buildFolderGraph,
  imports: buildImportGraph,
  modules: buildModuleGraph,
  classes: buildClassGraph,
  calls: buildCallGraph,
  components: buildComponentGraph,
  cycles: buildCycleGraph,
  api: buildApiGraph,
  schema: buildSchemaGraph,
  env: buildEnvGraph,
};

export function buildGraph(kind: GraphKind, input: GraphInput): DevGraphView {
  return BUILDERS[kind](input);
}

export function buildAllGraphs(input: GraphInput): Partial<Record<GraphKind, DevGraphView>> {
  const result: Partial<Record<GraphKind, DevGraphView>> = {};
  for (const kind of Object.keys(BUILDERS) as GraphKind[]) {
    result[kind] = BUILDERS[kind](input);
  }
  return result;
}

/** Language label helper shared by the UI legends. */
export function languageLabel(language: string | undefined): string {
  if (!language) return 'Unknown';
  return LANGUAGE_LABELS[language as keyof typeof LANGUAGE_LABELS] ?? language;
}
