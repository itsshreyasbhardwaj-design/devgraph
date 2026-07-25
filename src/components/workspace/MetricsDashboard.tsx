'use client';

import * as React from 'react';
import { AlertTriangle, Copy, GitBranch, Layers } from 'lucide-react';
import type { AnalysisResult } from '@/lib/core/types';
import { LANGUAGE_COLORS, LANGUAGE_LABELS } from '@/lib/core/languages';
import {
  Badge,
  Eyebrow,
  EmptyState,
  Panel,
  PanelHeader,
  ScrollArea,
  Stat,
} from '@/components/ui/primitives';
import { BarList, Histogram, ScoreDial, StackedBar } from './Charts';
import { cn, formatBytes, formatCount, truncatePath } from '@/lib/utils';

/**
 * The metrics dashboard.
 *
 * Ordered by what an engineer actually asks in sequence: how big is this, how
 * healthy is it, where is the risk concentrated, and what is the debt made of.
 * Every list item is clickable and jumps to that file in the graph.
 */

export interface MetricsDashboardProps {
  result: AnalysisResult;
  onOpenFile: (path: string) => void;
}

export function MetricsDashboard({ result, onOpenFile }: MetricsDashboardProps) {
  const { metrics, stack } = result;

  const languageSegments = React.useMemo(
    () =>
      stack.languages
        .filter((language) => language.share > 0.005)
        .slice(0, 8)
        .map((language) => ({
          label: LANGUAGE_LABELS[language.language] ?? language.language,
          value: language.lines,
          color: LANGUAGE_COLORS[language.language] ?? 'var(--color-ink-ghost)',
        })),
    [stack.languages],
  );

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-6xl space-y-4 p-5 pb-16">
        {/* ---------------------------------------------------------- size */}
        <Panel>
          <div className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Lines of code"
              value={formatCount(metrics.totals.code)}
              detail={`${formatCount(metrics.totals.comment)} comment · ${formatCount(metrics.totals.blank)} blank`}
            />
            <Stat
              label="Files"
              value={formatCount(metrics.totals.files)}
              detail={`${formatCount(metrics.totals.analysedFiles)} parsed · ${formatBytes(metrics.totals.bytes)}`}
            />
            <Stat
              label="Symbols"
              value={formatCount(metrics.totals.symbols)}
              detail="Classes, functions, methods, components"
            />
            <Stat
              label="Dependencies"
              value={formatCount(metrics.totals.dependencies)}
              detail={`${formatCount(metrics.totals.externalDependencies)} imported in code`}
            />
          </div>

          {languageSegments.length > 0 ? (
            <div className="border-t border-line px-5 py-4">
              <Eyebrow className="pb-3">Language mix by lines</Eyebrow>
              <StackedBar segments={languageSegments} />
            </div>
          ) : null}
        </Panel>

        {/* -------------------------------------------------------- health */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-1">
            <PanelHeader title="Health" detail="Composite scores" />
            <div className="flex items-start justify-around gap-4 p-5">
              <ScoreDial value={metrics.maintainability.average} label="Maintainability" />
              <ScoreDial value={metrics.debt.score} label="Debt" invert />
              {metrics.coverage ? (
                <ScoreDial value={metrics.coverage.overall} label="Coverage" />
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-line px-5 py-4">
              <Stat
                label="Avg complexity"
                value={metrics.complexity.average}
                detail={`max ${metrics.complexity.max}`}
                tone={metrics.complexity.average > 12 ? 'warn' : 'good'}
              />
              <Stat
                label="Duplication"
                value={`${(metrics.duplication.ratio * 100).toFixed(1)}%`}
                detail={`${metrics.duplication.clones.length} clone groups`}
                tone={metrics.duplication.ratio > 0.08 ? 'bad' : metrics.duplication.ratio > 0.03 ? 'warn' : 'good'}
              />
              <Stat
                label="Avg fan-in"
                value={metrics.coupling.averageFanIn}
                detail="Importers per file"
              />
              <Stat
                label="Cycles"
                value={result.cycles.length}
                detail={result.cycles.length ? `longest ${result.cycles[0].length} files` : 'none'}
                tone={result.cycles.length ? 'bad' : 'good'}
              />
            </div>
          </Panel>

          <Panel className="lg:col-span-2">
            <PanelHeader
              title="Distributions"
              detail="Where files sit on each scale"
            />
            <div className="grid gap-6 p-5 sm:grid-cols-3">
              <div>
                <Eyebrow className="pb-3">Complexity</Eyebrow>
                <Histogram
                  buckets={metrics.complexity.histogram.buckets}
                  tone="var(--color-warn)"
                />
              </div>
              <div>
                <Eyebrow className="pb-3">Maintainability</Eyebrow>
                <Histogram
                  buckets={metrics.maintainability.histogram.buckets}
                  tone="var(--color-stable)"
                />
              </div>
              <div>
                <Eyebrow className="pb-3">File size</Eyebrow>
                <Histogram buckets={metrics.size.histogram.buckets} tone="var(--color-edge)" />
              </div>
            </div>
          </Panel>
        </div>

        {/* ------------------------------------------------------ hotspots */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader
              title="Complexity hotspots"
              detail="Highest cyclomatic complexity, symbol by symbol"
            />
            <div className="p-3">
              {metrics.complexity.hotspots.length ? (
                <BarList
                  data={metrics.complexity.hotspots.slice(0, 12).map((hotspot) => ({
                    id: `${hotspot.path}:${hotspot.line ?? 0}:${hotspot.symbol ?? ''}`,
                    label: hotspot.symbol ?? truncatePath(hotspot.path, 40),
                    value: hotspot.complexity,
                    detail: `${truncatePath(hotspot.path, 28)}${hotspot.line ? `:${hotspot.line}` : ''}`,
                    color:
                      hotspot.complexity > 20 ? 'var(--color-cycle)' : 'var(--color-warn)',
                  }))}
                  onSelect={(datum) => onOpenFile(datum.id.split(':')[0])}
                />
              ) : (
                <EmptyState title="No complexity hotspots" description="Nothing exceeds the reporting threshold." />
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Most depended upon"
              detail="Change these and the blast radius is large"
            />
            <div className="p-3">
              <BarList
                data={metrics.coupling.mostDependedUpon.slice(0, 12).map((entry) => ({
                  id: entry.path,
                  label: truncatePath(entry.path, 44),
                  value: entry.fanIn,
                  detail: `instability ${entry.instability}`,
                  color: 'var(--color-signal)',
                }))}
                onSelect={(datum) => onOpenFile(datum.id)}
              />
            </div>
          </Panel>
        </div>

        {/* -------------------------------------------------------- modules */}
        <Panel>
          <PanelHeader
            title="Module coupling and cohesion"
            detail="Cohesion is internal references per file; instability is outgoing ÷ total"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-line">
                  {['Module', 'Files', 'Internal', 'In', 'Out', 'Cohesion', 'Instability'].map(
                    (heading, index) => (
                      <th
                        key={heading}
                        className={cn(
                          'px-4 py-2 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-ghost',
                          index === 0 ? 'text-left' : 'text-right',
                        )}
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {metrics.coupling.modules.slice(0, 14).map((module) => (
                  <tr
                    key={module.module}
                    className="border-b border-line/50 transition-colors last:border-0 hover:bg-hover"
                  >
                    <td className="tabular max-w-[220px] truncate px-4 py-2 text-[11.5px] text-ink">
                      {module.module}
                    </td>
                    <td className="tabular px-4 py-2 text-right text-[11.5px] text-ink-muted">
                      {module.files}
                    </td>
                    <td className="tabular px-4 py-2 text-right text-[11.5px] text-ink-muted">
                      {module.internalEdges}
                    </td>
                    <td className="tabular px-4 py-2 text-right text-[11.5px] text-ink-muted">
                      {module.incoming}
                    </td>
                    <td className="tabular px-4 py-2 text-right text-[11.5px] text-ink-muted">
                      {module.outgoing}
                    </td>
                    <td
                      className={cn(
                        'tabular px-4 py-2 text-right text-[11.5px]',
                        module.cohesion >= 1.5
                          ? 'text-stable'
                          : module.cohesion >= 0.5
                            ? 'text-ink-muted'
                            : 'text-warn',
                      )}
                    >
                      {module.cohesion.toFixed(2)}
                    </td>
                    <td className="tabular px-4 py-2 text-right text-[11.5px] text-ink-muted">
                      {module.instability.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ----------------------------------------------------------- debt */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader
              title="Debt signals"
              detail={`Score ${metrics.debt.score}/100 — every contributor is listed`}
              action={
                <Badge tone={metrics.debt.score > 45 ? 'bad' : metrics.debt.score > 20 ? 'warn' : 'good'}>
                  {metrics.debt.score > 45 ? 'High' : metrics.debt.score > 20 ? 'Moderate' : 'Low'}
                </Badge>
              }
            />
            <ul className="divide-y divide-line">
              {metrics.debt.signals.length ? (
                metrics.debt.signals.map((signal) => (
                  <li key={signal.id} className="px-4 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          'mt-1 size-1.5 shrink-0 rounded-full',
                          signal.severity === 'high'
                            ? 'bg-cycle'
                            : signal.severity === 'medium'
                              ? 'bg-warn'
                              : 'bg-ink-ghost',
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-ink">{signal.title}</p>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                          {signal.detail}
                        </p>
                        {signal.files.length ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {signal.files.slice(0, 4).map((path, fileIndex) => (
                              <button
                                key={`${path}:${fileIndex}`}
                                type="button"
                                onClick={() => onOpenFile(path)}
                                className="tabular rounded-xs border border-line px-1.5 py-0.5 text-[10px] text-ink-faint transition-colors hover:border-edge/50 hover:text-edge-soft"
                              >
                                {truncatePath(path, 34)}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))
              ) : (
                <EmptyState
                  icon={<Layers className="size-4" />}
                  title="No debt signals"
                  description="Complexity, duplication, coupling and configuration all sit within healthy bands."
                />
              )}
            </ul>
          </Panel>

          <div className="space-y-4">
            <Panel>
              <PanelHeader
                title="Duplicate blocks"
                detail={`${formatCount(metrics.duplication.totalDuplicatedLines)} lines across ${metrics.duplication.clones.length} groups`}
                action={<Copy className="size-3.5 text-ink-ghost" />}
              />
              {metrics.duplication.clones.length ? (
                <ul className="divide-y divide-line">
                  {metrics.duplication.clones.slice(0, 6).map((clone, index) => (
                    <li key={index} className="px-4 py-3">
                      <p className="text-[11.5px] text-ink">
                        {clone.lines} lines · {clone.occurrences.length} copies
                      </p>
                      <ul className="mt-1.5 space-y-0.5">
                        {clone.occurrences.slice(0, 4).map((occurrence) => (
                          <li key={`${occurrence.path}:${occurrence.startLine}`}>
                            <button
                              type="button"
                              onClick={() => onOpenFile(occurrence.path)}
                              className="tabular text-[10.5px] text-ink-faint transition-colors hover:text-edge-soft"
                            >
                              {truncatePath(occurrence.path, 46)}:{occurrence.startLine}–
                              {occurrence.endLine}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No duplicate blocks found" />
              )}
            </Panel>

            <Panel>
              <PanelHeader
                title="Debt markers"
                detail={`${metrics.debt.markers.length} TODO/FIXME comments`}
                action={<AlertTriangle className="size-3.5 text-ink-ghost" />}
              />
              {metrics.debt.markers.length ? (
                <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                  {metrics.debt.markers.slice(0, 25).map((marker, index) => (
                    <li key={`${marker.path}:${marker.line}:${index}`} className="px-4 py-2.5">
                      <button
                        type="button"
                        onClick={() => onOpenFile(marker.path)}
                        className="w-full text-left"
                      >
                        <span className="flex items-center gap-2">
                          <Badge
                            tone={
                              ['FIXME', 'BUG', 'HACK', 'XXX'].includes(marker.tag) ? 'bad' : 'ghost'
                            }
                          >
                            {marker.tag}
                          </Badge>
                          <span className="tabular truncate text-[10.5px] text-ink-ghost">
                            {truncatePath(marker.path, 34)}:{marker.line}
                          </span>
                        </span>
                        {marker.text ? (
                          <span className="mt-1 block truncate text-[11.5px] text-ink-muted">
                            {marker.text}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No debt markers" />
              )}
            </Panel>
          </div>
        </div>

        {/* -------------------------------------------------------- cycles */}
        {result.cycles.length ? (
          <Panel>
            <PanelHeader
              title="Circular dependencies"
              detail="Each cycle prevents independent testing and effective tree-shaking"
              action={<GitBranch className="size-3.5 text-cycle" />}
            />
            <ul className="divide-y divide-line">
              {result.cycles.slice(0, 10).map((cycle) => (
                <li key={cycle.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={cycle.severity === 'high' ? 'bad' : 'warn'}>
                      {cycle.severity}
                    </Badge>
                    <span className="text-[11.5px] text-ink-muted">{cycle.length} files</span>
                  </div>
                  <div className="tabular mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                    {cycle.files.map((path, index) => (
                      <React.Fragment key={path}>
                        {index > 0 ? <span className="text-cycle">→</span> : null}
                        <button
                          type="button"
                          onClick={() => onOpenFile(path)}
                          className="rounded-xs px-1 py-0.5 text-ink-muted transition-colors hover:bg-cycle/10 hover:text-cycle"
                        >
                          {path.split('/').pop()}
                        </button>
                      </React.Fragment>
                    ))}
                    <span className="text-cycle">↺</span>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {/* ---------------------------------------------------- dependencies */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Largest files" detail="Dominate parse and bundle time" />
            <div className="p-3">
              <BarList
                data={metrics.size.largestFiles.slice(0, 12).map((file) => ({
                  id: file.path,
                  label: truncatePath(file.path, 46),
                  value: file.lines,
                  detail: formatBytes(file.bytes),
                  color: 'var(--color-edge)',
                }))}
                onSelect={(datum) => onOpenFile(datum.id)}
              />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="External packages"
              detail="Ranked by how many files import them"
            />
            <div className="p-3">
              <BarList
                data={[...result.dependencies]
                  .filter((dependency) => dependency.usedBy > 0)
                  .sort((a, b) => b.usedBy - a.usedBy)
                  .slice(0, 12)
                  .map((dependency) => ({
                    id: `${dependency.ecosystem}:${dependency.name}`,
                    label: dependency.name,
                    value: dependency.usedBy,
                    detail: dependency.version ?? dependency.ecosystem,
                    color: 'var(--color-stable)',
                  }))}
              />
              {result.dependencies.some((d) => d.kind === 'runtime' && d.usedBy === 0) ? (
                <p className="mt-3 px-2 text-[11px] leading-relaxed text-ink-ghost">
                  {result.dependencies.filter((d) => d.kind === 'runtime' && d.usedBy === 0).length}{' '}
                  runtime dependencies were never imported in analysed source. Some are used by
                  config or build tooling — verify before removing.
                </p>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>
    </ScrollArea>
  );
}
