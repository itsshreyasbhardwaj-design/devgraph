'use client';

import * as React from 'react';
import { cn, formatCount } from '@/lib/utils';

/**
 * Chart primitives.
 *
 * Hand-rolled SVG rather than a charting library: the product needs four chart
 * shapes, all of them small, and a dependency-free implementation keeps the
 * client bundle honest and the styling consistent with the rest of the system.
 */

export interface BarDatum {
  /** Stable identity. Labels are truncated for display and can collide. */
  id: string;
  label: string;
  value: number;
  color?: string;
  detail?: string;
}

/** Horizontal bars — the right shape for ranked lists with long labels. */
export function BarList({
  data,
  max,
  className,
  format = formatCount,
  onSelect,
}: {
  data: BarDatum[];
  max?: number;
  className?: string;
  format?: (value: number) => string;
  onSelect?: (datum: BarDatum) => void;
}) {
  const ceiling = max ?? Math.max(1, ...data.map((datum) => datum.value));

  return (
    <ul className={cn('space-y-1.5', className)}>
      {data.map((datum) => {
        const width = `${Math.max(1.5, (datum.value / ceiling) * 100)}%`;
        const Wrapper = onSelect ? 'button' : 'div';
        return (
          <li key={datum.id}>
            <Wrapper
              {...(onSelect
                ? { type: 'button' as const, onClick: () => onSelect(datum) }
                : {})}
              className={cn(
                'group relative block w-full overflow-hidden rounded-sm px-2 py-1.5 text-left',
                onSelect && 'cursor-pointer transition-colors hover:bg-hover',
              )}
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-sm opacity-20 transition-opacity group-hover:opacity-30"
                style={{ width, backgroundColor: datum.color ?? 'var(--color-edge)' }}
              />
              <span className="relative flex items-baseline gap-3">
                <span className="tabular min-w-0 flex-1 truncate text-[11.5px] text-ink-muted">
                  {datum.label}
                </span>
                {datum.detail ? (
                  <span className="tabular shrink-0 text-[10px] text-ink-ghost">{datum.detail}</span>
                ) : null}
                <span className="tabular shrink-0 text-[11.5px] text-ink">{format(datum.value)}</span>
              </span>
            </Wrapper>
          </li>
        );
      })}
    </ul>
  );
}

/** Vertical column chart for distributions. */
export function Histogram({
  buckets,
  className,
  tone = 'var(--color-edge)',
}: {
  buckets: { label: string; count: number }[];
  className?: string;
  tone?: string;
}) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));

  return (
    <div className={cn('flex items-end gap-1.5', className)}>
      {buckets.map((bucket) => (
        <div key={bucket.label} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="tabular text-[10px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100">
            {bucket.count}
          </span>
          <div
            className="w-full rounded-t-xs transition-all duration-300"
            style={{
              height: `${Math.max(2, (bucket.count / max) * 88)}px`,
              backgroundColor: tone,
              opacity: bucket.count === 0 ? 0.15 : 0.55,
            }}
            title={`${bucket.label}: ${bucket.count}`}
          />
          <span className="w-full truncate text-center text-[9.5px] leading-tight text-ink-ghost">
            {bucket.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Proportional stacked bar — used for the language breakdown. */
export function StackedBar({
  segments,
  className,
}: {
  segments: { label: string; value: number; color: string }[];
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;

  return (
    <div className={className}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className="h-full transition-all"
            style={{
              width: `${(segment.value / total) * 100}%`,
              backgroundColor: segment.color,
            }}
            title={`${segment.label}: ${((segment.value / total) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((segment) => (
          <li key={segment.label} className="flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: segment.color }}
            />
            <span className="text-[11.5px] text-ink-muted">{segment.label}</span>
            <span className="tabular text-[11px] text-ink-ghost">
              {((segment.value / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Multi-series line chart for the timeline. */
export function LineChart({
  series,
  height = 180,
  className,
  formatValue = formatCount,
}: {
  series: { name: string; color: string; points: { x: number; y: number }[] }[];
  height?: number;
  className?: string;
  formatValue?: (value: number) => string;
}) {
  const width = 720;
  const padding = { top: 12, right: 12, bottom: 22, left: 44 };

  const allPoints = series.flatMap((entry) => entry.points);
  if (!allPoints.length) return null;

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const maxY = Math.max(1, ...allPoints.map((point) => point.y));

  const scaleX = (x: number) =>
    padding.left +
    ((x - minX) / Math.max(1, maxX - minX)) * (width - padding.left - padding.right);
  const scaleY = (y: number) =>
    height - padding.bottom - (y / maxY) * (height - padding.top - padding.bottom);

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * maxY);

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Module growth over time">
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={scaleY(value)}
              y2={scaleY(value)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={padding.left - 8}
              y={scaleY(value) + 3}
              textAnchor="end"
              fontSize={9}
              fontFamily="var(--font-mono)"
              fill="var(--color-ink-ghost)"
            >
              {formatValue(Math.round(value))}
            </text>
          </g>
        ))}

        {series.map((entry) => {
          const path = entry.points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${scaleX(point.x)} ${scaleY(point.y)}`)
            .join(' ');
          return (
            <g key={entry.name}>
              <path d={path} fill="none" stroke={entry.color} strokeWidth={1.6} />
              {entry.points.map((point, index) => (
                <circle
                  key={index}
                  cx={scaleX(point.x)}
                  cy={scaleY(point.y)}
                  r={2}
                  fill={entry.color}
                />
              ))}
            </g>
          );
        })}
      </svg>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((entry) => (
          <li key={entry.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="tabular text-[11px] text-ink-muted">{entry.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A compact 0–100 gauge for single scores. */
export function ScoreDial({
  value,
  label,
  tone,
  invert = false,
}: {
  value: number;
  label: string;
  tone?: 'good' | 'warn' | 'bad';
  /** When true, a high value is bad (debt score). */
  invert?: boolean;
}) {
  const resolved =
    tone ??
    (invert
      ? value > 45
        ? 'bad'
        : value > 20
          ? 'warn'
          : 'good'
      : value > 70
        ? 'good'
        : value > 45
          ? 'warn'
          : 'bad');

  const color = {
    good: 'var(--color-stable)',
    warn: 'var(--color-warn)',
    bad: 'var(--color-cycle)',
  }[resolved];

  const radius = 30;
  const circumference = Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, value)) / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 80 46" className="w-20" role="img" aria-label={`${label}: ${value} of 100`}>
        <path
          d="M 10 40 A 30 30 0 0 1 70 40"
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={5}
          strokeLinecap="round"
        />
        <path
          d="M 10 40 A 30 30 0 0 1 70 40"
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
        />
        <text
          x={40}
          y={38}
          textAnchor="middle"
          fontSize={17}
          fontFamily="var(--font-mono)"
          fill="var(--color-ink)"
        >
          {Math.round(value)}
        </text>
      </svg>
      <span className="mt-1 text-[10px] uppercase tracking-[0.13em] text-ink-ghost">{label}</span>
    </div>
  );
}
