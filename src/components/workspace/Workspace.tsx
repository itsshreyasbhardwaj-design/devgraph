'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  BarChart3,
  History,
  Network,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AnalysisResult, GraphKind } from '@/lib/core/types';
import { useWorkspace, visibleGraph, type WorkspaceTab } from '@/lib/client/store';
import { Button } from '@/components/ui/button';
import {
  Badge,
  EmptyState,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@/components/ui/primitives';
import { cn, formatCount, formatDuration } from '@/lib/utils';
import { CommandPalette } from './CommandPalette';
import { ExportMenu } from './ExportMenu';
import { GraphCanvas } from './GraphCanvas';
import { InsightsPanel } from './InsightsPanel';
import { Inspector } from './Inspector';
import { MetricsDashboard } from './MetricsDashboard';
import { TimelinePanel } from './TimelinePanel';
import { ViewRail } from './ViewRail';

/**
 * The workspace shell.
 *
 * Three columns — views and filters, the canvas, the inspector — with the tab
 * bar swapping what occupies the centre. Selection is shared across tabs, so a
 * file opened from the metrics dashboard is already selected when you switch
 * back to the graph.
 */

const TABS: { id: WorkspaceTab; label: string; icon: typeof Network }[] = [
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'insights', label: 'Insights', icon: Sparkles },
  { id: 'metrics', label: 'Metrics', icon: BarChart3 },
  { id: 'timeline', label: 'Timeline', icon: History },
];

export interface WorkspaceProps {
  result: AnalysisResult;
  aiAvailable: boolean;
  onReanalyze?: () => void;
}

export function Workspace({ result, aiAvailable, onReanalyze }: WorkspaceProps) {
  const {
    tab,
    graph,
    selectedId,
    collapsed,
    filters,
    paletteOpen,
    inspectorOpen,
    sidebarOpen,
    timeline,
    timelineStatus,
    setTab,
    setGraph,
    select,
    toggleCollapsed,
    setFilters,
    toggleSetFilter,
    clearFilters,
    focusOn,
    setPaletteOpen,
    setInspectorOpen,
    setSidebarOpen,
    setTimeline,
  } = useWorkspace();

  const canvasRef = React.useRef<HTMLDivElement>(null);

  const view = result.graphs[graph];

  const visible = React.useMemo(() => {
    if (!view) {
      return { nodes: [], edges: [], hiddenCount: 0, groups: [], languages: [] };
    }
    return visibleGraph(view.nodes, view.edges, filters, collapsed);
  }, [view, filters, collapsed]);

  const nodesById = React.useMemo(
    () => new Map((view?.nodes ?? []).map((node) => [node.id, node])),
    [view],
  );

  const selectedNode = selectedId ? (nodesById.get(selectedId) ?? null) : null;

  // ⌘K / Ctrl-K opens search from anywhere in the workspace.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === 'Escape' && filters.focusId) {
        setFilters({ focusId: null });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPaletteOpen, setFilters, filters.focusId]);

  /**
   * Reveal a file wherever it exists. Prefers the current view so a click from
   * the metrics dashboard does not throw the user into an unfamiliar graph.
   */
  const openFile = React.useCallback(
    (path: string) => {
      const candidates: GraphKind[] = [graph, 'imports', 'folders', 'modules', 'cycles'];
      for (const kind of candidates) {
        const candidateView = result.graphs[kind];
        if (!candidateView) continue;
        const node =
          candidateView.nodes.find((entry) => entry.id === path) ??
          candidateView.nodes.find((entry) => entry.path === path);
        if (!node) continue;
        setTab('graph');
        setGraph(kind);
        select(node.id);
        return;
      }
      toast.message('Not in any graph view', {
        description: `${path} was analysed but has no node in the current graphs.`,
      });
    },
    [graph, result.graphs, setGraph, setTab, select],
  );

  const loadTimeline = React.useCallback(async () => {
    setTimeline(null, 'loading');
    try {
      const response = await fetch(`/api/analyses/${result.id}/timeline`);
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      const data = await response.json();
      setTimeline(data, 'ready');
      if (!data.available) toast.message('No history available', { description: data.reason });
    } catch (error) {
      setTimeline(null, 'error');
      toast.error(error instanceof Error ? error.message : 'Could not load history.');
    }
  }, [result.id, setTimeline]);

  const stackChips = React.useMemo(
    () =>
      result.stack.findings
        .filter((finding) =>
          ['framework', 'database', 'orm', 'package-manager', 'deployment'].includes(
            finding.category,
          ),
        )
        .slice(0, 5),
    [result.stack.findings],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-void">
      {/* ------------------------------------------------------------ chrome */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="DevGraph home">
          <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M5 5 L15 10 M15 10 L5 15" stroke="var(--color-line-strong)" strokeWidth="1.2" />
            <circle cx="5" cy="5" r="2.6" fill="var(--color-edge)" />
            <circle cx="15" cy="10" r="2.6" fill="var(--color-stable)" />
            <circle cx="5" cy="15" r="2.6" fill="var(--color-signal)" />
          </svg>
        </Link>

        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="tabular truncate text-[13px] font-medium text-ink">{result.repo.name}</h1>
          {result.source.ref ? (
            <span className="tabular hidden shrink-0 text-[11px] text-ink-ghost sm:inline">
              @{result.source.ref}
            </span>
          ) : null}
        </div>

        <div className="hidden min-w-0 items-center gap-1 lg:flex">
          {stackChips.map((finding) => (
            <Tooltip key={finding.name} content={finding.evidence[0]}>
              <span className="cursor-default">
                <Badge tone="ghost">{finding.name}</Badge>
              </span>
            </Tooltip>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            className="gap-2 pr-2"
          >
            <Search />
            <span className="hidden sm:inline">Search</span>
            <kbd className="tabular ml-1 hidden rounded-xs border border-line px-1 py-0.5 text-[9.5px] text-ink-ghost sm:block">
              ⌘K
            </kbd>
          </Button>

          <ExportMenu
            result={result}
            graph={graph}
            getCanvasElement={() =>
              canvasRef.current?.querySelector<HTMLElement>('.react-flow__viewport')?.parentElement ??
              canvasRef.current
            }
          />

          {onReanalyze ? (
            <Tooltip content="Re-run the analysis from source">
              <Button variant="ghost" size="icon" onClick={onReanalyze} aria-label="Re-analyse">
                <RefreshCw />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </header>

      {/* ------------------------------------------------------------- tabs */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <Tooltip content={sidebarOpen ? 'Hide views' : 'Show views'}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Hide views panel' : 'Show views panel'}
            className={cn(sidebarOpen && 'text-ink')}
          >
            <PanelLeft />
          </Button>
        </Tooltip>

        <Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)}>
          <TabsList>
            {TABS.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id}>
                <Icon className="size-3.5" />
                {label}
                {id === 'insights' && aiAvailable ? (
                  <span className="ml-0.5 size-1 rounded-full bg-edge" aria-hidden />
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-3">
          {result.warnings.length ? (
            <Tooltip
              content={
                <ul className="space-y-1">
                  {result.warnings.slice(0, 6).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              }
            >
              <span className="flex cursor-default items-center gap-1.5 text-[11px] text-warn">
                <AlertTriangle className="size-3" />
                {result.warnings.length}
              </span>
            </Tooltip>
          ) : null}

          <span className="tabular hidden text-[11px] text-ink-ghost md:inline">
            {formatCount(result.metrics.totals.files)} files ·{' '}
            {formatCount(result.metrics.totals.code)} LOC · {formatDuration(result.durationMs)}
          </span>

          {tab === 'graph' ? (
            <Tooltip content={inspectorOpen ? 'Hide inspector' : 'Show inspector'}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setInspectorOpen(!inspectorOpen)}
                aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'}
                className={cn(inspectorOpen && 'text-ink')}
              >
                <PanelRight />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------------------- body */}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && tab === 'graph' ? (
          <aside className="hidden w-60 shrink-0 border-r border-line md:block">
            <ViewRail
              result={result}
              graph={graph}
              filters={filters}
              groups={visible.groups}
              languages={visible.languages}
              hiddenCount={visible.hiddenCount}
              onGraphChange={setGraph}
              onFiltersChange={setFilters}
              onToggleSetFilter={toggleSetFilter}
              onClearFilters={clearFilters}
            />
          </aside>
        ) : null}

        <main id="main" className="relative min-w-0 flex-1">
          {tab === 'graph' ? (
            view && visible.nodes.length ? (
              <div ref={canvasRef} className="h-full w-full">
                <GraphCanvas
                  view={view}
                  nodes={visible.nodes}
                  edges={visible.edges}
                  selectedId={selectedId}
                  collapsed={collapsed}
                  onSelect={select}
                  onToggleCollapse={toggleCollapsed}
                  onFocus={(id) => focusOn(id, filters.focusDepth)}
                />
              </div>
            ) : (
              <EmptyState
                icon={<Network className="size-4" />}
                title={view ? 'Nothing matches these filters' : 'This view is empty'}
                description={
                  view
                    ? `${formatCount(view.nodes.length)} nodes exist in this view but all are filtered out.`
                    : 'The analysis found nothing to draw here. Try another view.'
                }
                action={
                  view ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Reset filters
                    </Button>
                  ) : null
                }
                className="h-full"
              />
            )
          ) : null}

          {tab === 'insights' ? (
            <InsightsPanel result={result} aiAvailable={aiAvailable} onOpenFile={openFile} />
          ) : null}

          {tab === 'metrics' ? (
            <MetricsDashboard result={result} onOpenFile={openFile} />
          ) : null}

          {tab === 'timeline' ? (
            <TimelinePanel
              result={result}
              timeline={timeline}
              status={timelineStatus}
              onLoad={loadTimeline}
            />
          ) : null}

          {/* Bottom rail: what the canvas is currently showing. */}
          {tab === 'graph' && view ? (
            <div className="glass pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md px-3 py-1.5">
              <span className="tabular text-[11px] text-ink-muted">
                {formatCount(visible.nodes.length)} nodes · {formatCount(visible.edges.length)} edges
              </span>
              {view.truncated ? (
                <span className="text-[10.5px] text-warn">
                  {formatCount(view.truncated.nodes)} trimmed — {view.truncated.reason}
                </span>
              ) : null}
              {visible.edges.some((edge) => edge.cyclic) ? (
                <span className="flex items-center gap-1.5 text-[10.5px] text-cycle">
                  <span className="h-px w-3 bg-cycle" />
                  cycle
                </span>
              ) : null}
            </div>
          ) : null}
        </main>

        {inspectorOpen && tab === 'graph' ? (
          <aside className="hidden w-80 shrink-0 border-l border-line xl:block">
            <Inspector
              result={result}
              node={selectedNode}
              edges={view?.edges ?? []}
              nodesById={nodesById}
              onSelect={select}
              onFocus={(id) => focusOn(id, filters.focusDepth)}
              onClose={() => setInspectorOpen(false)}
            />
          </aside>
        ) : null}
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        result={result}
        currentGraph={graph}
        onNavigate={(kind, nodeId) => {
          setTab('graph');
          setGraph(kind);
          select(nodeId);
        }}
      />
    </div>
  );
}
