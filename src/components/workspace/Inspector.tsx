'use client';

import * as React from 'react';
import { ArrowDownLeft, ArrowUpRight, ExternalLink, Scan, X } from 'lucide-react';
import type { AnalysisResult, GraphEdge, GraphNode } from '@/lib/core/types';
import { LANGUAGE_LABELS } from '@/lib/core/languages';
import { MAINTAINABILITY_THRESHOLDS, maintainabilityBand } from '@/lib/parsing/complexity';
import { directNeighbours } from '@/lib/client/store';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Eyebrow,
  EmptyState,
  Progress,
  ScrollArea,
  Separator,
} from '@/components/ui/primitives';
import { cn, formatCount } from '@/lib/utils';

/**
 * The inspector.
 *
 * Answers the question a selected node raises: what is this, how healthy is it,
 * what depends on it, and what does it depend on. Neighbour lists are clickable
 * so the panel doubles as a keyboard-free way to walk the graph.
 */

export interface InspectorProps {
  result: AnalysisResult;
  node: GraphNode | null;
  edges: GraphEdge[];
  nodesById: Map<string, GraphNode>;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onClose: () => void;
}

export function Inspector({
  result,
  node,
  edges,
  nodesById,
  onSelect,
  onFocus,
  onClose,
}: InspectorProps) {
  if (!node) {
    return (
      <EmptyState
        icon={<Scan className="size-4" />}
        title="Nothing selected"
        description="Click a node to inspect it. Double-click to focus its neighbourhood."
      />
    );
  }

  const { incoming, outgoing } = directNeighbours(node.id, edges);
  const file = node.path ? result.files.find((entry) => entry.path === node.path) : undefined;
  const cycle = result.cycles.find((entry) => entry.files.includes(node.path ?? node.id));
  const sourceUrl = repoFileUrl(result, node.path, node.line);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 pb-10">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Eyebrow>{labelForKind(node)}</Eyebrow>
            <h2 className="tabular text-ink mt-1.5 text-[14px] leading-snug font-medium break-all">
              {node.label}
            </h2>
            {node.path ? (
              <p className="tabular text-ink-faint mt-1 text-[11px] break-all">
                {node.path}
                {node.line ? `:${node.line}` : ''}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspector">
            <X />
          </Button>
        </header>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {node.language ? <Badge>{LANGUAGE_LABELS[node.language] ?? node.language}</Badge> : null}
          {node.group ? <Badge tone="ghost">{node.group}</Badge> : null}
          {node.kind === 'entry' || file?.isEntryPoint ? (
            <Badge tone="good">Entry point</Badge>
          ) : null}
          {file?.isTest ? <Badge tone="ghost">Test</Badge> : null}
          {file?.isGenerated ? <Badge tone="ghost">Generated</Badge> : null}
          {cycle ? <Badge tone="bad">In a {cycle.length}-file cycle</Badge> : null}
          {node.meta?.clientExposed ? <Badge tone="bad">Client-exposed</Badge> : null}
          {node.meta?.sensitive ? <Badge tone="warn">Sensitive</Badge> : null}
        </div>

        <div className="mt-4 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => onFocus(node.id)}>
            <Scan />
            Focus
          </Button>
          {sourceUrl ? (
            <Button variant="subtle" size="sm" asChild>
              <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink />
                Source
              </a>
            </Button>
          ) : null}
        </div>

        {/* ------------------------------------------------------- metrics */}
        {node.metrics && Object.values(node.metrics).some((value) => value !== undefined) ? (
          <>
            <Separator className="my-4" />
            <Eyebrow className="pb-2.5">Metrics</Eyebrow>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {node.metrics.loc !== undefined ? (
                <Metric label="Lines" value={formatCount(node.metrics.loc)} />
              ) : null}
              {node.metrics.complexity !== undefined ? (
                <Metric
                  label="Complexity"
                  value={node.metrics.complexity}
                  tone={
                    node.metrics.complexity > 20
                      ? 'bad'
                      : node.metrics.complexity > 10
                        ? 'warn'
                        : 'good'
                  }
                />
              ) : null}
              {node.metrics.fanIn !== undefined ? (
                <Metric label="Imported by" value={node.metrics.fanIn} />
              ) : null}
              {node.metrics.fanOut !== undefined ? (
                <Metric label="Imports" value={node.metrics.fanOut} />
              ) : null}
              {node.metrics.members !== undefined ? (
                <Metric label="Members" value={node.metrics.members} />
              ) : null}
              {node.metrics.coverage !== undefined ? (
                <Metric
                  label="Coverage"
                  value={`${node.metrics.coverage.toFixed(0)}%`}
                  tone={
                    node.metrics.coverage > 70
                      ? 'good'
                      : node.metrics.coverage > 40
                        ? 'warn'
                        : 'bad'
                  }
                />
              ) : null}
            </dl>

            {node.metrics.maintainability !== undefined ? (
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-ink-muted text-[11.5px]">Maintainability</span>
                  <span className="tabular text-ink text-[11.5px]">
                    {node.metrics.maintainability.toFixed(0)}
                    {/* The band is stated because this scale is not linear-intuitive:
                        on a per-file SEI index, 25 is healthy, not a failure. */}
                    <span className="text-ink-ghost ml-1.5">
                      {maintainabilityBand(node.metrics.maintainability)}
                    </span>
                  </span>
                </div>
                <Progress
                  className="mt-1.5"
                  value={node.metrics.maintainability}
                  tone={
                    node.metrics.maintainability >= MAINTAINABILITY_THRESHOLDS.good
                      ? 'good'
                      : node.metrics.maintainability >= MAINTAINABILITY_THRESHOLDS.moderate
                        ? 'warn'
                        : 'bad'
                  }
                />
              </div>
            ) : null}

            {node.metrics.instability !== undefined ? (
              <div className="mt-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-ink-muted text-[11.5px]">Instability</span>
                  <span className="tabular text-ink text-[11.5px]">
                    {node.metrics.instability.toFixed(2)}
                  </span>
                </div>
                <Progress className="mt-1.5" value={node.metrics.instability * 100} tone="accent" />
                <p className="text-ink-ghost mt-1.5 text-[10.5px] leading-relaxed">
                  {node.metrics.instability > 0.7
                    ? 'Depends on much, is depended on by little — a good place for volatile code.'
                    : node.metrics.instability < 0.3
                      ? 'Many things depend on this. Changes here ripple widely.'
                      : 'Balanced between depending and being depended upon.'}
                </p>
              </div>
            ) : null}
          </>
        ) : null}

        {/* --------------------------------------------------- node detail */}
        <NodeDetail node={node} />

        {/* ---------------------------------------------------- neighbours */}
        <Separator className="my-4" />
        <NeighbourList
          title="Depended on by"
          icon={<ArrowDownLeft className="size-3" />}
          edges={incoming}
          endpoint="source"
          nodesById={nodesById}
          onSelect={onSelect}
        />
        <NeighbourList
          title="Depends on"
          icon={<ArrowUpRight className="size-3" />}
          edges={outgoing}
          endpoint="target"
          nodesById={nodesById}
          onSelect={onSelect}
          className="mt-4"
        />
      </div>
    </ScrollArea>
  );
}

function NodeDetail({ node }: { node: GraphNode }) {
  const methods = node.meta?.methods as string[] | undefined;
  const fields = node.meta?.fields as string[] | undefined;
  const columns = node.meta?.columns as string[] | undefined;
  const hooks = node.meta?.hooks as string[] | undefined;
  const props = node.meta?.props as string[] | undefined;
  const doc = node.meta?.doc as string | undefined;
  const signature = node.meta?.signature as string | undefined;

  const sections: { title: string; items: string[] }[] = [];
  if (fields?.length) sections.push({ title: 'Fields', items: fields });
  if (methods?.length) sections.push({ title: 'Methods', items: methods });
  if (columns?.length) sections.push({ title: 'Columns', items: columns });
  if (props?.length) sections.push({ title: 'Props', items: props });
  if (hooks?.length) sections.push({ title: 'Hooks used', items: hooks });

  if (!sections.length && !doc && !signature) return null;

  return (
    <>
      <Separator className="my-4" />
      {signature ? (
        <div className="mb-3">
          <Eyebrow className="pb-1.5">Signature</Eyebrow>
          <code className="tabular border-line bg-pit text-ink-muted block rounded-sm border px-2 py-1.5 text-[11px] break-all">
            {signature}
          </code>
        </div>
      ) : null}
      {doc ? (
        <p className="border-line text-ink-faint mb-3 border-l-2 pl-2.5 text-[11.5px] leading-relaxed">
          {doc}
        </p>
      ) : null}
      {sections.map((section) => (
        <div key={section.title} className="mb-3">
          <Eyebrow className="pb-1.5">
            {section.title} · {section.items.length}
          </Eyebrow>
          <ul className="space-y-0.5">
            {section.items.slice(0, 20).map((item) => (
              <li key={item} className="tabular text-ink-muted truncate text-[11px]">
                {item}
              </li>
            ))}
            {section.items.length > 20 ? (
              <li className="text-ink-ghost text-[10.5px]">+{section.items.length - 20} more</li>
            ) : null}
          </ul>
        </div>
      ))}
    </>
  );
}

function NeighbourList({
  title,
  icon,
  edges,
  endpoint,
  nodesById,
  onSelect,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  edges: GraphEdge[];
  endpoint: 'source' | 'target';
  nodesById: Map<string, GraphNode>;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <Eyebrow className="flex items-center gap-1.5 pb-2">
        {icon}
        {title} · {edges.length}
      </Eyebrow>
      {edges.length === 0 ? (
        <p className="text-ink-ghost text-[11px]">None in this view.</p>
      ) : (
        <ul className="space-y-0.5">
          {edges.slice(0, 40).map((edge) => {
            const id = edge[endpoint];
            const target = nodesById.get(id);
            return (
              <li key={edge.id}>
                <button
                  type="button"
                  onClick={() => onSelect(id)}
                  className={cn(
                    'tabular flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[11px] transition-colors',
                    edge.cyclic
                      ? 'text-cycle hover:bg-cycle/10'
                      : 'text-ink-muted hover:bg-hover hover:text-ink',
                  )}
                >
                  <span className="truncate">{target?.label ?? id}</span>
                  {edge.cyclic ? <span className="ml-auto shrink-0 text-[9px]">cycle</span> : null}
                </button>
              </li>
            );
          })}
          {edges.length > 40 ? (
            <li className="text-ink-ghost px-1.5 text-[10.5px]">+{edges.length - 40} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}) {
  const toneClass = {
    neutral: 'text-ink',
    good: 'text-stable',
    warn: 'text-warn',
    bad: 'text-cycle',
  }[tone];

  return (
    <div>
      <dt className="text-ink-ghost text-[10.5px] tracking-[0.1em] uppercase">{label}</dt>
      <dd className={cn('tabular mt-1 text-[15px] leading-none', toneClass)}>{value}</dd>
    </div>
  );
}

function labelForKind(node: GraphNode): string {
  const labels: Record<string, string> = {
    file: 'File',
    entry: 'Entry point',
    folder: 'Directory',
    module: 'Module',
    external: 'External package',
    package: 'Package',
    class: 'Class',
    interface: 'Interface',
    enum: 'Enum',
    function: 'Function',
    method: 'Method',
    component: 'Component',
    route: 'Route',
    table: 'Table',
    env: 'Environment variable',
  };
  return labels[node.kind] ?? node.kind;
}

/** Deep link into the source host, when the analysis came from one. */
function repoFileUrl(
  result: AnalysisResult,
  path: string | undefined,
  line: number | undefined,
): string | undefined {
  if (!path || result.source.kind !== 'github' || !result.source.url) return undefined;
  const ref = result.source.ref ?? result.repo.defaultBranch ?? 'HEAD';
  return `${result.source.url}/blob/${ref}/${path}${line ? `#L${line}` : ''}`;
}
