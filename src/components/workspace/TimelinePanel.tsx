'use client';

import * as React from 'react';
import { GitCommitHorizontal, History, Loader2, MinusCircle, PlusCircle } from 'lucide-react';
import type { AnalysisResult, TimelineReport, TimelineSnapshot } from '@/lib/core/types';
import { diffSnapshots } from '@/lib/git/timeline';
import { Button } from '@/components/ui/button';
import {
  Badge,
  EmptyState,
  Eyebrow,
  Panel,
  PanelHeader,
  ScrollArea,
  Stat,
} from '@/components/ui/primitives';
import { LineChart } from './Charts';
import { cn, formatCount } from '@/lib/utils';

/**
 * Timeline mode.
 *
 * History is sampled rather than fully reconstructed — one file tree per sampled
 * commit — which is enough to chart module growth and dependency churn without
 * downloading the repository once per commit. The comparison picker below
 * diffs any two sampled points.
 */

const SERIES_COLORS = [
  'var(--color-edge)',
  'var(--color-stable)',
  'var(--color-signal)',
  'var(--color-warn)',
  'var(--color-cycle)',
  '#c084fc',
  '#f97316',
  '#22d3ee',
];

export interface TimelinePanelProps {
  result: AnalysisResult;
  timeline: TimelineReport | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  onLoad: () => void;
}

export function TimelinePanel({ result, timeline, status, onLoad }: TimelinePanelProps) {
  const snapshots = timeline?.snapshots ?? [];
  // Null means "not chosen yet", so the default range is derived from the data
  // rather than synchronised into state by an effect.
  const [fromChoice, setFromIndex] = React.useState<number | null>(null);
  const [toChoice, setToIndex] = React.useState<number | null>(null);
  const fromIndex = Math.min(fromChoice ?? 0, Math.max(0, snapshots.length - 1));
  const toIndex = Math.min(
    toChoice ?? Math.max(0, snapshots.length - 1),
    Math.max(0, snapshots.length - 1),
  );

  if (status === 'idle' || (!timeline && status !== 'loading')) {
    return (
      <EmptyState
        icon={<History className="size-4" />}
        title="Timeline is loaded on demand"
        description={
          result.source.kind === 'github'
            ? 'Sampling history costs one API call per commit sampled, so DevGraph only fetches it when you ask.'
            : 'Timeline needs Git history. Analyse a GitHub repository to see how its architecture evolved.'
        }
        action={
          result.source.kind === 'github' ? (
            <Button variant="accent" size="sm" onClick={onLoad}>
              <History />
              Load history
            </Button>
          ) : null
        }
      />
    );
  }

  if (status === 'loading') {
    return (
      <EmptyState
        icon={<Loader2 className="size-4 animate-spin" />}
        title="Sampling commit history"
        description="Fetching the file tree at a dozen points across the repository's life."
      />
    );
  }

  if (!timeline?.available) {
    return (
      <EmptyState
        icon={<History className="size-4" />}
        title="No history available"
        description={timeline?.reason ?? 'Commit history could not be read for this repository.'}
        action={
          <Button variant="outline" size="sm" onClick={onLoad}>
            Try again
          </Button>
        }
      />
    );
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const diff =
    snapshots.length > 1 ? diffSnapshots(snapshots[fromIndex], snapshots[toIndex]) : null;

  const series = timeline.moduleGrowth.slice(0, 8).map((entry, index) => ({
    name: entry.module,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    points: entry.series.map((point) => ({ x: Date.parse(point.date), y: point.value })),
  }));

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-6xl space-y-4 p-5 pb-16">
        <Panel>
          <div className="grid gap-6 p-5 sm:grid-cols-4">
            <Stat
              label="Commits sampled"
              value={snapshots.length}
              detail={`from ${timeline.commits.length} recent commits`}
            />
            <Stat
              label="Files"
              value={formatCount(last?.files ?? 0)}
              detail={
                first && last
                  ? `${last.files - first.files >= 0 ? '+' : ''}${last.files - first.files} over the window`
                  : undefined
              }
              tone={last && first && last.files > first.files ? 'accent' : 'neutral'}
            />
            <Stat
              label="Modules"
              value={Object.keys(last?.modules ?? {}).length}
              detail="Top-level buckets"
            />
            <Stat
              label="Dependency events"
              value={timeline.dependencyEvents.length}
              detail="Additions and removals"
            />
          </div>
        </Panel>

        {series.length ? (
          <Panel>
            <PanelHeader title="Module growth" detail="Files per module across sampled commits" />
            <div className="p-5">
              <LineChart series={series} height={220} />
            </div>
          </Panel>
        ) : null}

        {snapshots.length > 1 ? (
          <Panel>
            <PanelHeader title="Compare commits" detail="Diff any two sampled points" />
            <div className="border-line grid gap-4 border-b p-5 sm:grid-cols-2">
              <SnapshotPicker
                label="From"
                snapshots={snapshots}
                value={fromIndex}
                onChange={setFromIndex}
              />
              <SnapshotPicker
                label="To"
                snapshots={snapshots}
                value={toIndex}
                onChange={setToIndex}
              />
            </div>

            {diff ? (
              <div className="grid gap-5 p-5 lg:grid-cols-2">
                <div>
                  <Eyebrow className="pb-2.5">Module change</Eyebrow>
                  {diff.moduleDelta.length ? (
                    <ul className="space-y-1">
                      {diff.moduleDelta.slice(0, 12).map((entry) => (
                        <li
                          key={entry.module}
                          className="hover:bg-hover flex items-baseline justify-between gap-3 rounded-sm px-2 py-1"
                        >
                          <span className="tabular text-ink-muted min-w-0 flex-1 truncate text-[11.5px]">
                            {entry.module}
                          </span>
                          <span className="tabular text-ink-ghost shrink-0 text-[10.5px]">
                            {entry.before} → {entry.after}
                          </span>
                          <span
                            className={cn(
                              'tabular w-12 shrink-0 text-right text-[11.5px]',
                              entry.delta > 0 ? 'text-stable' : 'text-cycle',
                            )}
                          >
                            {entry.delta > 0 ? '+' : ''}
                            {entry.delta}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-ink-ghost text-[12px]">No module changed size.</p>
                  )}
                </div>

                <div>
                  <Eyebrow className="pb-2.5">Dependency change</Eyebrow>
                  <div className="space-y-3">
                    <DependencyList
                      title="Added"
                      names={diff.addedDependencies}
                      tone="good"
                      icon={<PlusCircle className="size-3" />}
                    />
                    <DependencyList
                      title="Removed"
                      names={diff.removedDependencies}
                      tone="bad"
                      icon={<MinusCircle className="size-3" />}
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </Panel>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader
              title="Dependency events"
              detail="When packages entered and left the manifest"
            />
            {timeline.dependencyEvents.length ? (
              <ul className="divide-line divide-y">
                {timeline.dependencyEvents.slice(0, 12).map((event) => (
                  <li key={event.sha} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="tabular text-ink-ghost text-[10.5px]">
                        {new Date(event.date).toISOString().slice(0, 10)}
                      </span>
                      <span className="tabular text-ink-ghost text-[10.5px]">
                        {event.sha.slice(0, 7)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {event.added.slice(0, 8).map((name) => (
                        <Badge key={`+${name}`} tone="good">
                          +{name}
                        </Badge>
                      ))}
                      {event.removed.slice(0, 8).map((name) => (
                        <Badge key={`-${name}`} tone="bad">
                          −{name}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No dependency changes in the sampled window" />
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Recent commits" detail={`${timeline.commits.length} loaded`} />
            <ul className="divide-line max-h-[420px] divide-y overflow-y-auto">
              {timeline.commits.slice(0, 40).map((commit) => (
                <li key={commit.sha} className="flex gap-3 px-4 py-2.5">
                  <GitCommitHorizontal className="text-ink-ghost mt-0.5 size-3.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-ink-muted truncate text-[12px]">{commit.message}</p>
                    <p className="tabular text-ink-ghost mt-0.5 truncate text-[10px]">
                      {commit.shortSha} · {commit.author} ·{' '}
                      {new Date(commit.date).toISOString().slice(0, 10)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </ScrollArea>
  );
}

function SnapshotPicker({
  label,
  snapshots,
  value,
  onChange,
}: {
  label: string;
  snapshots: TimelineSnapshot[];
  value: number;
  onChange: (index: number) => void;
}) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="text-ink-faint mb-1.5 block text-[11px]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="tabular border-line bg-pit text-ink h-9 w-full rounded-md border px-2.5 text-[12px]"
      >
        {snapshots.map((snapshot, index) => (
          <option key={snapshot.sha} value={index}>
            {new Date(snapshot.date).toISOString().slice(0, 10)} · {snapshot.sha.slice(0, 7)} ·{' '}
            {snapshot.files} files
          </option>
        ))}
      </select>
    </div>
  );
}

function DependencyList({
  title,
  names,
  tone,
  icon,
}: {
  title: string;
  names: string[];
  tone: 'good' | 'bad';
  icon: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 text-[11px]',
          tone === 'good' ? 'text-stable' : 'text-cycle',
        )}
      >
        {icon}
        {title} · {names.length}
      </div>
      {names.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {names.slice(0, 20).map((name) => (
            <span
              key={name}
              className="tabular border-line text-ink-muted rounded-xs border px-1.5 py-0.5 text-[10.5px]"
            >
              {name}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-ink-ghost mt-1 text-[11px]">None.</p>
      )}
    </div>
  );
}
