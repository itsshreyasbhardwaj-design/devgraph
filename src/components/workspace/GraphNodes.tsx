'use client';

import * as React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ChevronRight, CornerDownRight, Lock, Zap } from 'lucide-react';
import type { GraphNode, LanguageId } from '@/lib/core/types';
import { LANGUAGE_COLORS } from '@/lib/core/languages';
import { cn } from '@/lib/utils';

/**
 * Custom node renderers.
 *
 * Every node shares one device — a language-coloured rail down its left edge —
 * so a file's language is readable at any zoom without a legend. Beyond that,
 * each kind shows only what its view is for: a class shows members, a table
 * shows columns, a route shows its method.
 */

export interface DevGraphNodeData extends Record<string, unknown> {
  node: GraphNode;
  selected: boolean;
  /** Dimmed because a selection elsewhere excluded it. */
  muted: boolean;
  collapsible: boolean;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
}

const METHOD_TONE: Record<string, string> = {
  GET: 'text-signal',
  POST: 'text-stable',
  PUT: 'text-warn',
  PATCH: 'text-warn',
  DELETE: 'text-cycle',
  ALL: 'text-edge-soft',
  RPC: 'text-edge-soft',
  WS: 'text-edge-soft',
};

function railColor(node: GraphNode): string {
  if (node.language) return LANGUAGE_COLORS[node.language as LanguageId] ?? 'var(--color-ink-ghost)';
  switch (node.kind) {
    case 'external':
    case 'package':
      return 'var(--color-ink-ghost)';
    case 'table':
      return 'var(--color-stable)';
    case 'route':
      return 'var(--color-signal)';
    case 'env':
      return 'var(--color-warn)';
    default:
      return 'var(--color-edge)';
  }
}

/** Shared frame: rail, border state, handles. */
function Frame({
  data,
  children,
  className,
  accent,
}: {
  data: DevGraphNodeData;
  children: React.ReactNode;
  className?: string;
  accent?: string;
}) {
  const { node, selected, muted } = data;
  const cyclic = Boolean(node.meta?.cycle);

  return (
    <div
      className={cn(
        'group relative h-full w-full overflow-hidden rounded-md border bg-raised/95 transition-[opacity,border-color,box-shadow] duration-150',
        selected
          ? 'border-edge shadow-[0_0_0_1px_var(--color-edge),0_10px_30px_-12px_var(--color-edge)]'
          : cyclic
            ? 'border-cycle/70'
            : 'border-line hover:border-line-strong',
        muted ? 'opacity-25' : 'opacity-100',
        className,
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: accent ?? railColor(node) }}
      />
      {children}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// File / module / generic
// ---------------------------------------------------------------------------

export function FileNode({ data }: NodeProps) {
  const nodeData = data as DevGraphNodeData;
  const { node, collapsible, collapsed, onToggleCollapse } = nodeData;
  const complexity = node.metrics?.complexity ?? 0;
  const maintainability = node.metrics?.maintainability;

  return (
    <Frame data={nodeData}>
      <div className="flex h-full items-center gap-2 pl-3 pr-2.5">
        {collapsible ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(node.id);
            }}
            aria-label={collapsed ? `Expand ${node.label}` : `Collapse ${node.label}`}
            className="-ml-1 rounded-xs p-0.5 text-ink-ghost transition-colors hover:bg-hover hover:text-ink"
          >
            <ChevronRight className={cn('size-3 transition-transform', !collapsed && 'rotate-90')} />
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {node.kind === 'entry' ? (
              <Zap className="size-3 shrink-0 text-stable" aria-label="Entry point" />
            ) : null}
            <span className="tabular truncate text-[11.5px] leading-none text-ink">
              {node.label}
            </span>
          </div>
          {node.metrics?.loc ? (
            <div className="tabular mt-1 flex items-center gap-2 text-[9.5px] leading-none text-ink-ghost">
              <span>{node.metrics.loc} LOC</span>
              {node.metrics.fanIn !== undefined ? (
                <span title="Files importing this / files it imports">
                  {node.metrics.fanIn}↓ {node.metrics.fanOut ?? 0}↑
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* A two-bar readout: complexity height, maintainability colour. */}
        {complexity > 0 ? (
          <div
            className="flex h-5 w-1 shrink-0 flex-col justify-end rounded-full bg-line"
            title={`Complexity ${complexity}${maintainability ? ` · maintainability ${maintainability}` : ''}`}
          >
            <span
              className={cn(
                'w-full rounded-full',
                complexity > 20 ? 'bg-cycle' : complexity > 10 ? 'bg-warn' : 'bg-stable',
              )}
              style={{ height: `${Math.min(100, (complexity / 30) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

export function FolderNode({ data }: NodeProps) {
  const nodeData = data as DevGraphNodeData;
  const { node, collapsed, onToggleCollapse } = nodeData;

  return (
    <Frame data={nodeData} accent="var(--color-ink-ghost)" className="bg-surface/95">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapse(node.id);
        }}
        className="flex h-full w-full items-center gap-2 pl-3 pr-2.5 text-left"
        aria-expanded={!collapsed}
      >
        <ChevronRight
          className={cn('size-3 shrink-0 text-ink-ghost transition-transform', !collapsed && 'rotate-90')}
        />
        <span className="tabular flex-1 truncate text-[11.5px] text-ink-muted">{node.label}</span>
        {node.metrics?.loc ? (
          <span className="tabular shrink-0 text-[9.5px] text-ink-ghost">
            {Intl.NumberFormat('en', { notation: 'compact' }).format(node.metrics.loc)}
          </span>
        ) : null}
      </button>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Class / interface / enum
// ---------------------------------------------------------------------------

export function ClassNode({ data }: NodeProps) {
  const nodeData = data as DevGraphNodeData;
  const { node } = nodeData;
  const methods = (node.meta?.methods as string[] | undefined) ?? [];
  const fields = (node.meta?.fields as string[] | undefined) ?? [];
  const stereotype =
    node.kind === 'interface' ? 'interface' : node.kind === 'enum' ? 'enum' : (node.meta?.kind as string) ?? 'class';

  return (
    <Frame data={nodeData}>
      <div className="flex h-full flex-col">
        <div className="border-b border-line px-3 py-1.5">
          <div className="text-[9px] uppercase tracking-[0.14em] text-ink-ghost">
            {node.meta?.isAbstract ? 'abstract ' : ''}
            {stereotype}
          </div>
          <div className="tabular mt-0.5 truncate text-[12px] font-medium text-ink">{node.label}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-3 py-1.5">
          {fields.slice(0, 4).map((field) => (
            <div key={field} className="tabular truncate text-[10px] leading-[15px] text-ink-faint">
              <span className="text-ink-ghost">+</span> {field}
            </div>
          ))}
          {methods.slice(0, 6).map((method) => (
            <div key={method} className="tabular truncate text-[10px] leading-[15px] text-ink-muted">
              {method}
            </div>
          ))}
          {methods.length > 6 ? (
            <div className="tabular text-[10px] leading-[15px] text-ink-ghost">
              +{methods.length - 6} more
            </div>
          ) : null}
        </div>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Function / method / component
// ---------------------------------------------------------------------------

export function FunctionNode({ data }: NodeProps) {
  const nodeData = data as DevGraphNodeData;
  const { node } = nodeData;
  const complexity = node.metrics?.complexity ?? 0;

  return (
    <Frame data={nodeData}>
      <div className="flex h-full items-center gap-2 pl-3 pr-2.5">
        <div className="min-w-0 flex-1">
          <div className="tabular flex items-center gap-1.5 truncate text-[11.5px] leading-none text-ink">
            {node.meta?.isAsync ? <span className="text-[9px] text-edge-soft">async</span> : null}
            {node.label}
          </div>
          <div className="tabular mt-1 truncate text-[9.5px] leading-none text-ink-ghost">
            {node.path?.split('/').pop()}
            {node.line ? `:${node.line}` : ''}
          </div>
        </div>
        {complexity > 1 ? (
          <span
            className={cn(
              'tabular shrink-0 rounded-xs px-1 py-0.5 text-[9px] leading-none',
              complexity > 20
                ? 'bg-cycle/15 text-cycle'
                : complexity > 10
                  ? 'bg-warn/15 text-warn'
                  : 'bg-line text-ink-faint',
            )}
            title="Cyclomatic complexity"
          >
            {complexity}
          </span>
        ) : null}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function RouteNode({ data }: NodeProps) {
  const nodeData = data as DevGraphNodeData;
  const { node } = nodeData;
  const method = String(node.meta?.method ?? 'GET');
  const [, ...rest] = node.label.split(' ');
  const path = rest.join(' ') || node.label;

  return (
    <Frame data={nodeData}>
      <div className="flex h-full items-center gap-2 pl-3 pr-2.5">
        <span className={cn('tabular shrink-0 text-[10px] font-medium', METHOD_TONE[method] ?? 'text-ink-faint')}>
          {method}
        </span>
        <span className="tabular min-w-0 flex-1 truncate text-[11.5px] text-ink">{path}</span>
        {node.meta?.framework ? (
          <span className="shrink-0 text-[9px] text-ink-ghost">{String(node.meta.framework)}</span>
        ) : null}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function TableNode({ data }: NodeProps) {
  const nodeData = data as DevGraphNodeData;
  const { node } = nodeData;
  const columns = (node.meta?.columns as string[] | undefined) ?? [];

  return (
    <Frame data={nodeData} accent="var(--color-stable)">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
          <span className="tabular truncate text-[12px] font-medium text-ink">{node.label}</span>
          <span className="tabular shrink-0 text-[9px] text-ink-ghost">{columns.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-3 py-1.5">
          {columns.slice(0, 10).map((column) => (
            <div key={column} className="tabular truncate text-[10px] leading-[15px] text-ink-faint">
              {column}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Environment variable
// ---------------------------------------------------------------------------

export function EnvNode({ data }: NodeProps) {
  const nodeData = data as DevGraphNodeData;
  const { node } = nodeData;
  const sensitive = Boolean(node.meta?.sensitive);
  const exposed = Boolean(node.meta?.clientExposed);

  return (
    <Frame data={nodeData} accent={exposed && sensitive ? 'var(--color-cycle)' : 'var(--color-warn)'}>
      <div className="flex h-full items-center gap-2 pl-3 pr-2.5">
        {sensitive ? <Lock className="size-3 shrink-0 text-warn" aria-label="Looks sensitive" /> : null}
        <span className="tabular min-w-0 flex-1 truncate text-[11px] text-ink">{node.label}</span>
        {exposed ? (
          <span
            className="shrink-0 rounded-xs bg-cycle/15 px-1 py-0.5 text-[8.5px] uppercase tracking-wide text-cycle"
            title="Bundlers inline this into client JavaScript"
          >
            public
          </span>
        ) : null}
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// External package
// ---------------------------------------------------------------------------

export function ExternalNode({ data }: NodeProps) {
  const nodeData = data as DevGraphNodeData;
  const { node } = nodeData;

  return (
    <Frame data={nodeData} accent="var(--color-ink-ghost)" className="border-dashed bg-surface/80">
      <div className="flex h-full items-center gap-2 pl-3 pr-2.5">
        <CornerDownRight className="size-3 shrink-0 text-ink-ghost" />
        <span className="tabular min-w-0 flex-1 truncate text-[11px] text-ink-muted">
          {node.label}
        </span>
        {node.metrics?.fanIn ? (
          <span className="tabular shrink-0 text-[9.5px] text-ink-ghost">{node.metrics.fanIn}</span>
        ) : null}
      </div>
    </Frame>
  );
}

export const NODE_TYPES = {
  file: FileNode,
  folder: FolderNode,
  module: FileNode,
  entry: FileNode,
  class: ClassNode,
  interface: ClassNode,
  enum: ClassNode,
  function: FunctionNode,
  method: FunctionNode,
  component: FunctionNode,
  route: RouteNode,
  table: TableNode,
  env: EnvNode,
  external: ExternalNode,
  package: ExternalNode,
  column: FileNode,
  cycle: FileNode,
} as const;

export type DevGraphNodeType = keyof typeof NODE_TYPES;

export function nodeTypeFor(node: GraphNode): DevGraphNodeType {
  return (node.kind in NODE_TYPES ? node.kind : 'file') as DevGraphNodeType;
}
