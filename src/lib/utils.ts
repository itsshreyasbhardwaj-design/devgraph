import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const PLAIN = new Intl.NumberFormat('en');

export function formatCount(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value >= 10_000 ? COMPACT.format(value) : PLAIN.format(value);
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatRelativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
  ];
  let value = seconds / 60;
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  for (const [divisor, nextUnit] of thresholds) {
    if (Math.abs(value) < divisor) break;
    value /= divisor;
    unit = nextUnit;
  }
  return formatter.format(-Math.round(value), unit);
}

/** Truncate a path from the left so the filename always stays visible. */
export function truncatePath(path: string, maxLength = 48): string {
  if (path.length <= maxLength) return path;
  const segments = path.split('/');
  const file = segments.pop() ?? path;
  let result = file;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const candidate = `${segments[i]}/${result}`;
    if (candidate.length + 2 > maxLength) return `…/${result}`;
    result = candidate;
  }
  return result;
}

/** Deterministic 0–1 value from a string, for stable pseudo-random layout. */
export function hashUnit(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 10_000) / 10_000;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}
