'use client';

import { create } from 'zustand';
import type {
  AnalysisProgress,
  AnalysisResult,
  AnalysisStreamEvent,
  GraphEdge,
  GraphKind,
  GraphNode,
  TimelineReport,
} from '@/lib/core/types';
import { searchIndex } from '@/lib/analysis/search';

/**
 * Workspace state.
 *
 * One store holds the analysis, the current view, selection and filters.
 * Derived data (visible nodes, neighbourhoods) is computed by selectors rather
 * than stored, so filters can never drift out of sync with the graph.
 */

export type WorkspaceTab = 'graph' | 'insights' | 'metrics' | 'timeline';

export interface GraphFilters {
  /** Free-text filter applied to node labels and paths. */
  query: string;
  languages: Set<string>;
  groups: Set<string>;
  hideTests: boolean;
  hideGenerated: boolean;
  hideExternal: boolean;
  /** Only show nodes participating in a cycle. */
  cyclesOnly: boolean;
  minComplexity: number;
  /** When set, show only this node and everything within `focusDepth` hops. */
  focusId: string | null;
  focusDepth: number;
}

export const EMPTY_FILTERS: GraphFilters = {
  query: '',
  languages: new Set(),
  groups: new Set(),
  hideTests: false,
  hideGenerated: true,
  hideExternal: false,
  cyclesOnly: false,
  minComplexity: 0,
  focusId: null,
  focusDepth: 1,
};

export interface AnalysisRunState {
  status: 'idle' | 'running' | 'done' | 'error';
  progress: AnalysisProgress | null;
  warnings: string[];
  error: string | null;
}

interface WorkspaceState {
  result: AnalysisResult | null;
  run: AnalysisRunState;
  tab: WorkspaceTab;
  graph: GraphKind;
  selectedId: string | null;
  collapsed: Set<string>;
  filters: GraphFilters;
  paletteOpen: boolean;
  inspectorOpen: boolean;
  sidebarOpen: boolean;
  timeline: TimelineReport | null;
  timelineStatus: 'idle' | 'loading' | 'ready' | 'error';

  setResult(result: AnalysisResult): void;
  reset(): void;
  applyEvent(event: AnalysisStreamEvent): void;
  setRunning(): void;
  setError(message: string): void;

  setTab(tab: WorkspaceTab): void;
  setGraph(graph: GraphKind): void;
  select(id: string | null): void;
  toggleCollapsed(id: string): void;
  expandAll(): void;
  setFilters(patch: Partial<GraphFilters>): void;
  toggleSetFilter(key: 'languages' | 'groups', value: string): void;
  clearFilters(): void;
  focusOn(id: string | null, depth?: number): void;
  setPaletteOpen(open: boolean): void;
  setInspectorOpen(open: boolean): void;
  setSidebarOpen(open: boolean): void;
  setTimeline(timeline: TimelineReport | null, status: WorkspaceState['timelineStatus']): void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  result: null,
  run: { status: 'idle', progress: null, warnings: [], error: null },
  tab: 'graph',
  graph: 'imports',
  selectedId: null,
  collapsed: new Set(),
  filters: { ...EMPTY_FILTERS },
  paletteOpen: false,
  inspectorOpen: true,
  sidebarOpen: true,
  timeline: null,
  timelineStatus: 'idle',

  setResult(result) {
    set({
      result,
      run: { status: 'done', progress: null, warnings: result.warnings, error: null },
      graph: defaultGraphFor(result),
      selectedId: null,
      collapsed: new Set(),
      filters: { ...EMPTY_FILTERS, languages: new Set(), groups: new Set() },
      timeline: result.timeline.available ? result.timeline : null,
      timelineStatus: result.timeline.available ? 'ready' : 'idle',
    });
  },

  reset() {
    set({
      result: null,
      run: { status: 'idle', progress: null, warnings: [], error: null },
      selectedId: null,
      timeline: null,
      timelineStatus: 'idle',
    });
  },

  setRunning() {
    set({
      run: { status: 'running', progress: null, warnings: [], error: null },
      result: null,
    });
  },

  applyEvent(event) {
    const { run } = get();
    switch (event.type) {
      case 'progress':
        set({ run: { ...run, status: 'running', progress: event.data } });
        break;
      case 'warning':
        set({ run: { ...run, warnings: [...run.warnings, event.data] } });
        break;
      case 'result':
        get().setResult(event.data);
        break;
      case 'error':
        set({ run: { ...run, status: 'error', error: event.data.message } });
        break;
    }
  },

  setError(message) {
    set({ run: { ...get().run, status: 'error', error: message } });
  },

  setTab: (tab) => set({ tab }),
  setGraph: (graph) => set({ graph, filters: { ...get().filters, focusId: null } }),
  select: (selectedId) => set({ selectedId, inspectorOpen: selectedId ? true : get().inspectorOpen }),

  toggleCollapsed(id) {
    const collapsed = new Set(get().collapsed);
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    set({ collapsed });
  },

  expandAll: () => set({ collapsed: new Set() }),
  setFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),

  toggleSetFilter(key, value) {
    const filters = get().filters;
    const next = new Set(filters[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    set({ filters: { ...filters, [key]: next } });
  },

  clearFilters: () =>
    set({ filters: { ...EMPTY_FILTERS, languages: new Set(), groups: new Set() } }),

  focusOn: (focusId, focusDepth = 1) =>
    set({ filters: { ...get().filters, focusId, focusDepth }, selectedId: focusId }),

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setTimeline: (timeline, timelineStatus) => set({ timeline, timelineStatus }),
}));

/** Open on the view that best matches what the repository actually is. */
function defaultGraphFor(result: AnalysisResult): GraphKind {
  if ((result.graphs.imports?.nodes.length ?? 0) > 2) return 'imports';
  if ((result.graphs.classes?.nodes.length ?? 0) > 2) return 'classes';
  if ((result.graphs.api?.nodes.length ?? 0) > 1) return 'api';
  return 'folders';
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export interface VisibleGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hiddenCount: number;
  groups: string[];
  languages: string[];
}

/**
 * Apply filters, collapse state and focus to a graph view.
 *
 * Collapsing a folder hides its descendants but keeps the folder itself, and
 * edges that pointed into the subtree are re-pointed at the collapsed ancestor
 * so the graph stays connected rather than developing holes.
 */
export function visibleGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  filters: GraphFilters,
  collapsed: Set<string>,
): VisibleGraph {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const groups = [...new Set(nodes.map((node) => node.group).filter(Boolean) as string[])].sort();
  const languages = [
    ...new Set(nodes.map((node) => node.language).filter(Boolean) as string[]),
  ].sort();

  /** Nearest collapsed ancestor, if any. */
  const collapsedAncestor = (node: GraphNode): string | undefined => {
    let cursor = node.parentId;
    let found: string | undefined;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      if (collapsed.has(cursor)) found = cursor;
      cursor = byId.get(cursor)?.parentId;
    }
    return found;
  };

  const query = filters.query.trim().toLowerCase();

  const passes = (node: GraphNode): boolean => {
    if (query && !`${node.label} ${node.path ?? ''}`.toLowerCase().includes(query)) return false;
    if (filters.languages.size && (!node.language || !filters.languages.has(node.language))) {
      return false;
    }
    if (filters.groups.size && (!node.group || !filters.groups.has(node.group))) return false;
    if (filters.hideTests && node.meta?.isTest) return false;
    if (filters.hideGenerated && node.meta?.isGenerated) return false;
    if (filters.hideExternal && (node.kind === 'external' || node.kind === 'package')) return false;
    if (filters.minComplexity > 0 && (node.metrics?.complexity ?? 0) < filters.minComplexity) {
      return false;
    }
    return true;
  };

  // Cycle-only mode needs the cyclic edge set first.
  const cyclicNodes = new Set<string>();
  if (filters.cyclesOnly) {
    for (const edge of edges) {
      if (!edge.cyclic) continue;
      cyclicNodes.add(edge.source);
      cyclicNodes.add(edge.target);
    }
  }

  let kept = nodes.filter((node) => {
    if (collapsedAncestor(node)) return false;
    if (filters.cyclesOnly && !cyclicNodes.has(node.id)) return false;
    return passes(node);
  });

  // Focus mode: keep only the neighbourhood of the focused node.
  if (filters.focusId) {
    const neighbourhood = neighbours(filters.focusId, edges, filters.focusDepth);
    kept = kept.filter((node) => neighbourhood.has(node.id));
    const focusNode = byId.get(filters.focusId);
    if (focusNode && !kept.some((node) => node.id === filters.focusId)) kept.push(focusNode);
  }

  const keptIds = new Set(kept.map((node) => node.id));

  /** Re-point an endpoint at its collapsed ancestor when it is hidden. */
  const remap = (id: string): string | undefined => {
    if (keptIds.has(id)) return id;
    const node = byId.get(id);
    if (!node) return undefined;
    const ancestor = collapsedAncestor(node);
    return ancestor && keptIds.has(ancestor) ? ancestor : undefined;
  };

  const seen = new Set<string>();
  const visibleEdges: GraphEdge[] = [];
  for (const edge of edges) {
    const source = remap(edge.source);
    const target = remap(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}:${edge.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    visibleEdges.push(source === edge.source && target === edge.target ? edge : { ...edge, id: key, source, target });
  }

  return {
    nodes: kept,
    edges: visibleEdges,
    hiddenCount: nodes.length - kept.length,
    groups,
    languages,
  };
}

/** Node ids within `depth` undirected hops of `startId`, inclusive. */
export function neighbours(startId: string, edges: GraphEdge[], depth: number): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    (adjacency.get(edge.source) ?? adjacency.set(edge.source, []).get(edge.source)!).push(edge.target);
    (adjacency.get(edge.target) ?? adjacency.set(edge.target, []).get(edge.target)!).push(edge.source);
  }

  const reached = new Set([startId]);
  let frontier = [startId];
  for (let step = 0; step < depth; step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (reached.has(neighbour)) continue;
        reached.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return reached;
}

/** Direct in/out neighbours of a node, for the inspector. */
export function directNeighbours(
  id: string,
  edges: GraphEdge[],
): { incoming: GraphEdge[]; outgoing: GraphEdge[] } {
  return {
    incoming: edges.filter((edge) => edge.target === id),
    outgoing: edges.filter((edge) => edge.source === id),
  };
}

export function runSearch(result: AnalysisResult | null, query: string) {
  if (!result) return [];
  return searchIndex(result.searchIndex, query, 40);
}
