import dagre from '@dagrejs/dagre';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { stratify, tree } from 'd3-hierarchy';
import type { DevGraphView, GraphEdge, GraphNode, LayoutHint } from '@/lib/core/types';
import { hashUnit } from '@/lib/utils';

/**
 * Graph layout.
 *
 * Every algorithm here is deterministic: the same graph always produces the
 * same coordinates. That matters more than layout quality — a canvas that
 * reshuffles itself when you toggle a filter is disorienting, and stable
 * positions let the user build spatial memory of a codebase.
 *
 * Above `FORCE_LIMIT` nodes the expensive algorithms are replaced by a sorted
 * grid, which is honest about being a fallback and keeps very large repositories
 * interactive.
 */

export interface Positioned {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  positions: Map<string, Positioned>;
  width: number;
  height: number;
  /** True when the node count forced a simpler algorithm. */
  degraded: boolean;
}

const FORCE_LIMIT = 900;
const DAGRE_LIMIT = 1400;

export function nodeSize(node: GraphNode): { width: number; height: number } {
  switch (node.kind) {
    case 'class':
    case 'interface':
    case 'enum': {
      const members = Math.min(8, (node.meta?.methods as string[] | undefined)?.length ?? 0);
      return { width: 210, height: 46 + members * 15 };
    }
    case 'table': {
      const columns = Math.min(10, (node.meta?.columns as string[] | undefined)?.length ?? 0);
      return { width: 208, height: 44 + columns * 15 };
    }
    case 'folder':
      return { width: 176, height: 34 };
    case 'route':
      return { width: 232, height: 34 };
    case 'env':
      return { width: 196, height: 32 };
    default:
      return { width: 184, height: 36 };
  }
}

export function layoutGraph(
  view: DevGraphView,
  nodes: GraphNode[],
  edges: GraphEdge[],
  override?: LayoutHint,
): LayoutResult {
  const hint = override ?? view.layout;
  if (!nodes.length) return { positions: new Map(), width: 0, height: 0, degraded: false };

  if (nodes.length > DAGRE_LIMIT) return gridLayout(nodes);

  switch (hint) {
    case 'tree':
      return treeLayout(nodes, edges);
    case 'radial':
      return radialLayout(nodes, edges);
    case 'force':
      return nodes.length > FORCE_LIMIT ? gridLayout(nodes) : forceLayout(nodes, edges);
    case 'grid':
      return gridLayout(nodes);
    case 'layered':
    default:
      return layeredLayout(nodes, edges);
  }
}

// ---------------------------------------------------------------------------
// Layered (dagre) — the default for dependency-shaped graphs
// ---------------------------------------------------------------------------

function layeredLayout(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
  // Nodes with no edges carry no layering information. Left in, dagre stacks
  // them into one enormous rank that dwarfs the actual dependency structure, so
  // they are laid out separately in a compact block beneath it.
  const degree = new Map<string, number>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const linked = nodes.filter((node) => (degree.get(node.id) ?? 0) > 0);
  const isolated = nodes.filter((node) => (degree.get(node.id) ?? 0) === 0);

  if (linked.length === 0) return gridLayout(nodes);

  const graph = new dagre.graphlib.Graph({ multigraph: false, compound: false });
  graph.setGraph({
    rankdir: 'LR',
    ranksep: 92,
    nodesep: 22,
    edgesep: 12,
    marginx: 40,
    marginy: 40,
    // Network-simplex gives the tidiest ranks; it is also the slowest, so very
    // large graphs fall back to the cheaper longest-path ranker.
    ranker: linked.length > 400 ? 'longest-path' : 'network-simplex',
  });
  graph.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, { width: number; height: number }>();
  for (const node of linked) {
    const size = nodeSize(node);
    sizes.set(node.id, size);
    graph.setNode(node.id, size);
  }

  const known = new Set(linked.map((n) => n.id));
  for (const edge of edges) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    if (edge.source === edge.target) continue;
    graph.setEdge(edge.source, edge.target, { weight: edge.weight ?? 1 });
  }

  dagre.layout(graph);

  const positions = new Map<string, Positioned>();
  let width = 0;
  let height = 0;

  for (const node of linked) {
    const laid = graph.node(node.id);
    const size = sizes.get(node.id)!;
    // dagre reports centres; the canvas positions from the top-left corner.
    const x = (laid?.x ?? 0) - size.width / 2;
    const y = (laid?.y ?? 0) - size.height / 2;
    positions.set(node.id, { id: node.id, x, y, ...size });
    width = Math.max(width, x + size.width);
    height = Math.max(height, y + size.height);
  }

  // Park the unconnected remainder in a tidy block under the graph.
  if (isolated.length) {
    const sorted = [...isolated].sort(
      (a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label),
    );
    const cellWidth = 200;
    const cellHeight = 46;
    const columns = Math.max(3, Math.min(12, Math.ceil(width / cellWidth) || 6));
    const top = height + 110;

    sorted.forEach((node, index) => {
      const size = nodeSize(node);
      const x = (index % columns) * cellWidth;
      const y = top + Math.floor(index / columns) * cellHeight;
      positions.set(node.id, { id: node.id, x, y, ...size });
      width = Math.max(width, x + size.width);
      height = Math.max(height, y + size.height);
    });
  }

  return { positions, width, height, degraded: false };
}

// ---------------------------------------------------------------------------
// Tree — hierarchy views (folders, components)
// ---------------------------------------------------------------------------

function treeLayout(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
  const parentOf = new Map<string, string>();
  for (const node of nodes) {
    if (node.parentId) parentOf.set(node.id, node.parentId);
  }
  // Views without an explicit parent (component hierarchy) derive one from the
  // first containment/render edge that points at each node.
  if (parentOf.size === 0) {
    for (const edge of edges) {
      if (!parentOf.has(edge.target) && edge.target !== edge.source) {
        parentOf.set(edge.target, edge.source);
      }
    }
  }

  const ids = new Set(nodes.map((n) => n.id));

  // A synthetic root keeps multi-root hierarchies in one tidy tree.
  const SYNTHETIC = '__devgraph_root__';
  const entries = [
    { id: SYNTHETIC, parentId: undefined as string | undefined },
    ...nodes.map((node) => {
      const parent = parentOf.get(node.id);
      return { id: node.id, parentId: parent && ids.has(parent) ? parent : SYNTHETIC };
    }),
  ];

  // Guard against a cycle in the derived parent links.
  if (hasParentCycle(entries)) return layeredLayout(nodes, edges);

  try {
    const root = stratify<{ id: string; parentId?: string }>()
      .id((d) => d.id)
      .parentId((d) => d.parentId)(entries);

    const sizes = new Map(nodes.map((node) => [node.id, nodeSize(node)]));
    const maxWidth = Math.max(...[...sizes.values()].map((s) => s.width), 180);

    tree<{ id: string; parentId?: string }>()
      .nodeSize([46, maxWidth + 84])
      .separation((a, b) => (a.parent === b.parent ? 1 : 1.35))(root);

    const positions = new Map<string, Positioned>();
    let minX = Infinity;
    let minY = Infinity;
    let width = 0;
    let height = 0;

    root.each((point) => {
      if (point.data.id === SYNTHETIC) return;
      const size = sizes.get(point.data.id);
      if (!size) return;
      // d3-tree lays out top-down; transposing gives a left-to-right tree.
      // `x`/`y` are typed optional but are always assigned by `tree()`.
      const x = point.y ?? 0;
      const y = point.x ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      positions.set(point.data.id, { id: point.data.id, x, y, ...size });
    });

    for (const position of positions.values()) {
      position.x = position.x - minX + 40;
      position.y = position.y - minY + 40;
      width = Math.max(width, position.x + position.width);
      height = Math.max(height, position.y + position.height);
    }

    return { positions, width, height, degraded: false };
  } catch {
    // stratify throws on malformed hierarchies; layering always works.
    return layeredLayout(nodes, edges);
  }
}

function hasParentCycle(entries: { id: string; parentId?: string }[]): boolean {
  const parents = new Map(entries.map((entry) => [entry.id, entry.parentId]));
  for (const entry of entries) {
    const seen = new Set<string>([entry.id]);
    let cursor = parents.get(entry.id);
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = parents.get(cursor);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Radial — cycle view, where the loop should read as a loop
// ---------------------------------------------------------------------------

function radialLayout(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = node.group ?? 'default';
    const bucket = groups.get(key) ?? [];
    bucket.push(node);
    groups.set(key, bucket);
  }

  const positions = new Map<string, Positioned>();
  let width = 0;
  let height = 0;
  let cursorY = 60;

  for (const [, members] of groups) {
    const radius = Math.max(130, members.length * 32);
    const centreX = radius + 80;
    const centreY = cursorY + radius;

    members.forEach((node, index) => {
      const size = nodeSize(node);
      const angle = (index / members.length) * Math.PI * 2 - Math.PI / 2;
      const x = centreX + Math.cos(angle) * radius - size.width / 2;
      const y = centreY + Math.sin(angle) * radius - size.height / 2;
      positions.set(node.id, { id: node.id, x, y, ...size });
      width = Math.max(width, x + size.width);
      height = Math.max(height, y + size.height);
    });

    cursorY = centreY + radius + 110;
  }

  if (!positions.size) return gridLayout(nodes);
  void edges;
  return { positions, width, height, degraded: false };
}

// ---------------------------------------------------------------------------
// Force — schema and configuration views
// ---------------------------------------------------------------------------

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  width: number;
  height: number;
}

function forceLayout(nodes: GraphNode[], edges: GraphEdge[]): LayoutResult {
  const simNodes: SimNode[] = nodes.map((node) => {
    const size = nodeSize(node);
    // Seed from a hash of the id so the simulation starts identically each run.
    const seed = hashUnit(node.id);
    const angle = seed * Math.PI * 2;
    const radius = 120 + seed * 320;
    return {
      id: node.id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      ...size,
    };
  });

  const byId = new Map(simNodes.map((node) => [node.id, node]));
  const simLinks = edges
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const simulation = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-620))
    .force(
      'link',
      forceLink(simLinks)
        .id((node) => (node as SimNode).id)
        .distance(190)
        .strength(0.35),
    )
    .force('x', forceX(0).strength(0.045))
    .force('y', forceY(0).strength(0.06))
    .force(
      'collide',
      forceCollide<SimNode>().radius((node) => Math.max(node.width, node.height) / 1.5 + 18),
    )
    .stop();

  // Run a fixed tick budget rather than letting alpha decay on its own — a
  // fixed count is what makes the result reproducible.
  simulation.tick(300);

  const positions = new Map<string, Positioned>();
  let minX = Infinity;
  let minY = Infinity;

  for (const node of simNodes) {
    minX = Math.min(minX, node.x - node.width / 2);
    minY = Math.min(minY, node.y - node.height / 2);
  }

  let width = 0;
  let height = 0;
  for (const node of simNodes) {
    const x = node.x - node.width / 2 - minX + 60;
    const y = node.y - node.height / 2 - minY + 60;
    positions.set(node.id, { id: node.id, x, y, width: node.width, height: node.height });
    width = Math.max(width, x + node.width);
    height = Math.max(height, y + node.height);
  }

  return { positions, width, height, degraded: false };
}

// ---------------------------------------------------------------------------
// Grid — the large-graph fallback
// ---------------------------------------------------------------------------

function gridLayout(nodes: GraphNode[]): LayoutResult {
  const sorted = [...nodes].sort(
    (a, b) => (a.group ?? '').localeCompare(b.group ?? '') || a.label.localeCompare(b.label),
  );
  const columns = Math.max(4, Math.ceil(Math.sqrt(sorted.length * 1.7)));
  const cellWidth = 200;
  const cellHeight = 52;

  const positions = new Map<string, Positioned>();
  sorted.forEach((node, index) => {
    const size = nodeSize(node);
    positions.set(node.id, {
      id: node.id,
      x: (index % columns) * cellWidth + 40,
      y: Math.floor(index / columns) * cellHeight + 40,
      ...size,
    });
  });

  return {
    positions,
    width: columns * cellWidth + 40,
    height: Math.ceil(sorted.length / columns) * cellHeight + 40,
    degraded: true,
  };
}
