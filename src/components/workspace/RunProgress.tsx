'use client';

import * as React from 'react';
import { AlertCircle, ArrowLeft, Check } from 'lucide-react';
import Link from 'next/link';
import type { AnalysisPhase, AnalysisProgress } from '@/lib/core/types';
import type { AnalysisRunState } from '@/lib/client/store';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/**
 * Analysis progress.
 *
 * The pipeline streams a phase per stage, so the wait shows real work rather
 * than an indeterminate spinner. Phases already passed stay listed and ticked —
 * on a large repository that is the difference between "it's working" and
 * "it's hung".
 */

const PHASES: { id: AnalysisPhase; label: string }[] = [
  { id: 'fetching', label: 'Fetching repository' },
  { id: 'scanning', label: 'Selecting files' },
  { id: 'parsing', label: 'Parsing source' },
  { id: 'resolving', label: 'Resolving imports' },
  { id: 'extracting', label: 'Extracting routes and schema' },
  { id: 'metrics', label: 'Computing metrics' },
  { id: 'graphing', label: 'Building graphs' },
  { id: 'insights', label: 'Generating insights' },
];

const ORDER = new Map(PHASES.map((phase, index) => [phase.id, index]));
// Phases the pipeline emits that share a step with a listed one.
ORDER.set('unpacking', 1);
ORDER.set('queued', 0);
ORDER.set('finalizing', PHASES.length - 1);
ORDER.set('done', PHASES.length);

export interface RunProgressProps {
  run: AnalysisRunState;
  label: string;
  onRetry?: () => void;
}

export function RunProgress({ run, label, onRetry }: RunProgressProps) {
  const progress: AnalysisProgress | null = run.progress;
  const currentIndex = progress ? (ORDER.get(progress.phase) ?? 0) : 0;
  const percent = Math.round((progress?.progress ?? 0) * 100);

  if (run.status === 'error') {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-5">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-md border border-cycle/40 bg-cycle/10">
            <AlertCircle className="size-4 text-cycle" />
          </div>
          <h2 className="mt-5 font-display text-lg font-semibold text-ink">Analysis failed</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{run.error}</p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/">
                <ArrowLeft />
                Back
              </Link>
            </Button>
            {onRetry ? (
              <Button variant="accent" size="sm" onClick={onRetry}>
                Try again
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-5">
      <div className="w-full max-w-md">
        <p className="tabular text-[11px] uppercase tracking-[0.16em] text-ink-ghost">Analysing</p>
        <h2 className="tabular mt-2 break-all font-display text-xl font-semibold text-ink">
          {label}
        </h2>

        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] text-ink-muted">
              {progress?.message ?? 'Starting up'}
            </span>
            <span className="tabular text-[12px] text-ink-faint">{percent}%</span>
          </div>
          <Progress className="mt-2" value={percent} />
          {progress?.detail ? (
            <p className="tabular mt-2 text-[11px] text-ink-ghost">{progress.detail}</p>
          ) : null}
        </div>

        <ol className="mt-8 space-y-2.5">
          {PHASES.map((phase, index) => {
            const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'todo';
            return (
              <li key={phase.id} className="flex items-center gap-2.5">
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                    state === 'done'
                      ? 'border-stable/50 bg-stable/15 text-stable'
                      : state === 'active'
                        ? 'border-edge bg-edge/15'
                        : 'border-line',
                  )}
                >
                  {state === 'done' ? (
                    <Check className="size-2.5" />
                  ) : state === 'active' ? (
                    <span className="size-1.5 animate-pulse rounded-full bg-edge" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    'text-[12.5px] transition-colors',
                    state === 'done'
                      ? 'text-ink-faint'
                      : state === 'active'
                        ? 'text-ink'
                        : 'text-ink-ghost',
                  )}
                >
                  {phase.label}
                </span>
              </li>
            );
          })}
        </ol>

        {run.warnings.length ? (
          <div className="mt-8 rounded-md border border-line bg-raised/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-ghost">
              Notes
            </p>
            <ul className="mt-2 space-y-1">
              {run.warnings.slice(-4).map((warning, index) => (
                <li key={index} className="text-[11.5px] leading-relaxed text-ink-faint">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
