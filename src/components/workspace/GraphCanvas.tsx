'use client';

import * as React from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { Crosshair, Maximize2, Minus, Plus } from 'lucide-react';
import type { DevGraphView, GraphEdge, GraphNode } from '@/lib/core/types';
import { LANGUAGE_COLORS } from '@/lib/core/languages';
import { layoutGraph, nodeSize } from '@/lib/client/layout';
import { neighbours } from '@/lib/client/store';
import { cn } from '@/lib/utils';
import { NODE_TYPES, nodeTypeFor, type DevGraphNodeData } from './GraphNodes';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/primitives';

/**
 * The graph canvas.
 *
 * Performance strategy for large repositories, in order of effect:
 *
 * 1. The builder already caps each view's node count and says so.
 * 2. Layout is memoised on the visible node/edge identity, so panning, zooming
 *    and selecting never recompute positions.
 * 3. React Flow culls off-screen nodes (`onlyRenderVisibleElements`).
 * 4. Above `LOD_THRESHOLD` nodes, edge decorations and the minimap are dropped —
 *    they are the expensive part and the least informative at that density.
 */

const LOD_THRESHOLD = 400;

/**
 * One definition of "framed", shared by the initial fit and every refit.
 *
 * `duration: 0` is deliberate. An animated fit runs through d3-zoom's
 * requestAnimationFrame transition, so in any context where the frame loop is
 * throttled — a background tab, a low-power device, an embedded webview — the
 * viewport would never reach its target and the graph would appear empty.
 * Framing is a correctness concern, not a flourish, so it applies immediately.
 */
const FIT_OPTIONS = { padding: 0.14, duration: 0, maxZoom: 1, minZoom: 0.06 } as const;

export interface GraphCanvasProps {
  view: DevGraphView;
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  collapsed: Set<string>;
  onSelect: (id: string | null) => void;
  onToggleCollapse: (id: string) => void;
  onFocus: (id: string) => void;
  className?: string;
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({
  view,
  nodes,
  edges,
  selectedId,
  collapsed,
  onSelect,
  onToggleCollapse,
  onFocus,
  className,
}: GraphCanvasProps) {
  const flow = useReactFlow();
  const dense = nodes.length > LOD_THRESHOLD;

  // Identity of the laid-out graph. Selection deliberately excluded so
  // highlighting never triggers a relayout.
  const layoutKey = React.useMemo(
    () => `${view.kind}|${nodes.map((n) => n.id).join(',')}|${edges.length}`,
    [view.kind, nodes, edges.length],
  );

  const layout = React.useMemo(
    () => layoutGraph(view, nodes, edges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey],
  );

  /** Nodes within one hop of the selection; everything else dims. */
  const highlighted = React.useMemo(() => {
    if (!selectedId) return null;
    return neighbours(selectedId, edges, 1);
  }, [selectedId, edges]);

  const hasChildren = React.useMemo(() => {
    const parents = new Set<string>();
    for (const node of nodes) if (node.parentId) parents.add(node.parentId);
    // Collapsed folders keep their affordance even though their children are gone.
    for (const id of collapsed) parents.add(id);
    return parents;
  }, [nodes, collapsed]);

  const flowNodes = React.useMemo<Node<DevGraphNodeData>[]>(() => {
    return nodes.map((node) => {
      const position = layout.positions.get(node.id);
      const size = position ?? nodeSize(node);
      return {
        id: node.id,
        type: nodeTypeFor(node),
        position: { x: position?.x ?? 0, y: position?.y ?? 0 },
        width: size.width,
        height: size.height,
        draggable: true,
        selectable: true,
        data: {
          node,
          selected: node.id === selectedId,
          muted: Boolean(highlighted) && !highlighted!.has(node.id),
          collapsible: hasChildren.has(node.id),
          collapsed: collapsed.has(node.id),
          onToggleCollapse,
        },
      };
    });
  }, [nodes, layout, selectedId, highlighted, hasChildren, collapsed, onToggleCollapse]);

  const flowEdges = React.useMemo<Edge[]>(() => {
    return edges.map((edge) => {
      const active =
        !highlighted || (highlighted.has(edge.source) && highlighted.has(edge.target));
      const isSelectedEdge =
        selectedId !== null && (edge.source === selectedId || edge.target === selectedId);

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: dense ? 'straight' : 'default',
        animated: !dense && isSelectedEdge && !edge.cyclic,
        style: {
          stroke: edge.cyclic
            ? 'var(--color-cycle)'
            : isSelectedEdge
              ? 'var(--color-edge)'
              : 'var(--color-line-strong)',
          strokeWidth: edge.cyclic || isSelectedEdge ? 1.6 : 1,
          strokeOpacity: active ? (edge.cyclic || isSelectedEdge ? 0.95 : 0.55) : 0.06,
          strokeDasharray: edge.cyclic ? '4 3' : undefined,
        },
        label: dense ? undefined : edge.label,
        labelStyle: { fill: 'var(--color-ink-ghost)', fontSize: 9 },
        labelBgStyle: { fill: 'var(--color-void)' },
        markerEnd: dense
          ? undefined
          : {
              type: 'arrowclosed' as const,
              width: 12,
              height: 12,
              color: edge.cyclic
                ? 'var(--color-cycle)'
                : isSelectedEdge
                  ? 'var(--color-edge)'
                  : 'var(--color-line-strong)',
            },
      };
    });
  }, [edges, highlighted, selectedId, dense]);

  /**
   * Frame the graph whenever the shape of the view changes.
   *
   * React Flow measures nodes after paint, so fitting on the same tick as a
   * data change fits an unmeasured graph. A macrotask is enough to let
   * measurement land, and unlike an animation frame it fires even when the
   * frame loop is throttled.
   */
  React.useEffect(() => {
    const timer = window.setTimeout(() => flow.fitView(FIT_OPTIONS), 50);
    return () => window.clearTimeout(timer);
  }, [layoutKey, flow]);

  const handleNodeClick = React.useCallback<NodeMouseHandler>(
    (_event, node) => onSelect(node.id === selectedId ? null : node.id),
    [onSelect, selectedId],
  );

  const handleNodeDoubleClick = React.useCallback<NodeMouseHandler>(
    (_event, node) => onFocus(node.id),
    [onFocus],
  );

  return (
    <div className={cn('relative h-full w-full', className)}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={() => onSelect(null)}
        onlyRenderVisibleElements
        fitView
        fitViewOptions={FIT_OPTIONS}
        minZoom={0.04}
        maxZoom={2.4}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        edgesFocusable={false}
        elevateNodesOnSelect={false}
        defaultEdgeOptions={{ type: 'default' }}
        className="bg-transparent"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="rgba(255,255,255,0.05)"
        />
        {!dense ? (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="!bottom-14 !right-3"
            maskColor="rgba(8,8,12,0.72)"
            nodeColor={(node) => {
              const data = node.data as DevGraphNodeData | undefined;
              const graphNode = data?.node;
              if (!graphNode) return 'var(--color-line-strong)';
              if (graphNode.language) {
                return LANGUAGE_COLORS[graphNode.language] ?? 'var(--color-line-strong)';
              }
              return graphNode.kind === 'folder' ? 'var(--color-ink-ghost)' : 'var(--color-edge)';
            }}
            nodeStrokeWidth={0}
          />
        ) : null}
      </ReactFlow>

      <ViewportControls />

      {layout.degraded ? (
        <div className="pointer-events-none absolute left-3 top-3 rounded-sm border border-warn/30 bg-warn/10 px-2 py-1 text-[10.5px] text-warn">
          Grid layout — {nodes.length.toLocaleString()} nodes is past the layered-layout budget
        </div>
      ) : null}
    </div>
  );
}

/** Zoom and framing controls, styled to match the rest of the chrome. */
function ViewportControls() {
  const flow = useReactFlow();
  return (
    <div className="glass absolute bottom-3 left-3 flex items-center gap-0.5 rounded-md p-1">
      <Tooltip content="Zoom out">
        <Button variant="ghost" size="icon-sm" onClick={() => flow.zoomOut()} aria-label="Zoom out">
          <Minus />
        </Button>
      </Tooltip>
      <Tooltip content="Zoom in">
        <Button variant="ghost" size="icon-sm" onClick={() => flow.zoomIn()} aria-label="Zoom in">
          <Plus />
        </Button>
      </Tooltip>
      <Tooltip content="Fit to view">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => flow.fitView(FIT_OPTIONS)}
          aria-label="Fit graph to view"
        >
          <Maximize2 />
        </Button>
      </Tooltip>
      <Tooltip content="Reset zoom to 100%">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => flow.zoomTo(1)}
          aria-label="Reset zoom"
        >
          <Crosshair />
        </Button>
      </Tooltip>
    </div>
  );
}

/** Re-exported so the workspace can hide the default React Flow controls. */
export { Controls as ReactFlowControls };
