'use client';

import * as React from 'react';
import {
  Boxes,
  Database,
  FolderTree,
  GitBranch,
  KeyRound,
  Network,
  PhoneCall,
  RotateCcw,
  Route,
  Shapes,
  Waypoints,
} from 'lucide-react';
import type { AnalysisResult, GraphKind } from '@/lib/core/types';
import { LANGUAGE_COLORS, LANGUAGE_LABELS } from '@/lib/core/languages';
import type { GraphFilters } from '@/lib/client/store';
import { Eyebrow, Input, ScrollArea, Separator, Switch, Tooltip } from '@/components/ui/primitives';
import { cn, formatCount } from '@/lib/utils';

const VIEW_META: Record<GraphKind, { label: string; icon: typeof Network; hint: string }> = {
  imports: { label: 'Imports', icon: Network, hint: 'File-level dependencies' },
  modules: { label: 'Modules', icon: Boxes, hint: 'Directory-level dependencies and packages' },
  folders: { label: 'Folders', icon: FolderTree, hint: 'Directory tree sized by code' },
  classes: { label: 'Classes', icon: Shapes, hint: 'Types, members and inheritance' },
  calls: { label: 'Calls', icon: PhoneCall, hint: 'Function call relationships' },
  components: { label: 'Components', icon: Waypoints, hint: 'UI component hierarchy' },
  cycles: { label: 'Cycles', icon: GitBranch, hint: 'Circular dependencies' },
  api: { label: 'API routes', icon: Route, hint: 'HTTP surface' },
  schema: { label: 'Schema', icon: Database, hint: 'Tables and relations' },
  env: { label: 'Config', icon: KeyRound, hint: 'Environment variables' },
};

const VIEW_ORDER: GraphKind[] = [
  'imports',
  'modules',
  'folders',
  'classes',
  'calls',
  'components',
  'cycles',
  'api',
  'schema',
  'env',
];

export interface ViewRailProps {
  result: AnalysisResult;
  graph: GraphKind;
  filters: GraphFilters;
  groups: string[];
  languages: string[];
  hiddenCount: number;
  onGraphChange: (graph: GraphKind) => void;
  onFiltersChange: (patch: Partial<GraphFilters>) => void;
  onToggleSetFilter: (key: 'languages' | 'groups', value: string) => void;
  onClearFilters: () => void;
}

export function ViewRail({
  result,
  graph,
  filters,
  groups,
  languages,
  hiddenCount,
  onGraphChange,
  onFiltersChange,
  onToggleSetFilter,
  onClearFilters,
}: ViewRailProps) {
  const filtersActive =
    filters.query.trim().length > 0 ||
    filters.languages.size > 0 ||
    filters.groups.size > 0 ||
    filters.hideTests ||
    !filters.hideGenerated ||
    filters.hideExternal ||
    filters.cyclesOnly ||
    filters.minComplexity > 0 ||
    filters.focusId !== null;

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-5 p-3 pb-8">
        {/* -------------------------------------------------------- views */}
        <section>
          <Eyebrow className="px-1.5 pb-2">Views</Eyebrow>
          <ul className="space-y-0.5">
            {VIEW_ORDER.map((kind) => {
              const view = result.graphs[kind];
              const meta = VIEW_META[kind];
              const Icon = meta.icon;
              // Every view counts nodes except cycles, where the number people
              // care about is how many cycles exist, not how many files are in
              // one — showing "20" for a single 20-file cycle reads as 20 cycles.
              const count = kind === 'cycles' ? result.cycles.length : (view?.stats.nodeCount ?? 0);
              const empty = count === 0;
              const active = kind === graph;

              return (
                <li key={kind}>
                  <Tooltip content={meta.hint} side="right">
                    <button
                      type="button"
                      disabled={empty}
                      onClick={() => onGraphChange(kind)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors',
                        active
                          ? 'bg-edge/12 text-ink'
                          : empty
                            ? 'cursor-not-allowed text-ink-ghost/60'
                            : 'text-ink-muted hover:bg-hover hover:text-ink',
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-3.5 shrink-0',
                          active ? 'text-edge' : 'text-ink-ghost group-hover:text-ink-faint',
                        )}
                      />
                      <span className="flex-1 truncate text-[12.5px]">{meta.label}</span>
                      <span
                        className={cn(
                          'tabular text-[10px]',
                          kind === 'cycles' && count > 0 ? 'text-cycle' : 'text-ink-ghost',
                        )}
                      >
                        {empty ? '—' : formatCount(count)}
                      </span>
                    </button>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </section>

        <Separator />

        {/* ------------------------------------------------------ filters */}
        <section>
          <div className="flex items-center justify-between px-1.5 pb-2">
            <Eyebrow>Filters</Eyebrow>
            {filtersActive ? (
              <button
                type="button"
                onClick={onClearFilters}
                className="flex items-center gap-1 text-[10.5px] text-ink-faint transition-colors hover:text-ink"
              >
                <RotateCcw className="size-2.5" />
                Reset
              </button>
            ) : null}
          </div>

          <Input
            value={filters.query}
            onChange={(event) => onFiltersChange({ query: event.target.value })}
            placeholder="Filter nodes…"
            aria-label="Filter nodes by name or path"
            className="tabular h-8 text-[12px]"
          />

          {filters.focusId ? (
            <div className="mt-2 flex items-center gap-2 rounded-sm border border-edge/30 bg-edge/10 px-2 py-1.5">
              <span className="flex-1 truncate text-[11px] text-edge-soft">
                Focused · {filters.focusDepth} hop{filters.focusDepth === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3].map((depth) => (
                  <button
                    key={depth}
                    type="button"
                    onClick={() => onFiltersChange({ focusDepth: depth })}
                    className={cn(
                      'tabular size-4 rounded-xs text-[9.5px] transition-colors',
                      filters.focusDepth === depth
                        ? 'bg-edge text-white'
                        : 'text-ink-faint hover:bg-hover',
                    )}
                    aria-label={`${depth} hop neighbourhood`}
                  >
                    {depth}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onFiltersChange({ focusId: null })}
                className="text-[11px] text-ink-faint transition-colors hover:text-ink"
              >
                Clear
              </button>
            </div>
          ) : null}

          <div className="mt-3 space-y-2">
            <FilterToggle
              label="Hide tests"
              checked={filters.hideTests}
              onChange={(hideTests) => onFiltersChange({ hideTests })}
            />
            <FilterToggle
              label="Hide generated"
              checked={filters.hideGenerated}
              onChange={(hideGenerated) => onFiltersChange({ hideGenerated })}
            />
            <FilterToggle
              label="Hide external packages"
              checked={filters.hideExternal}
              onChange={(hideExternal) => onFiltersChange({ hideExternal })}
            />
            <FilterToggle
              label="Cycles only"
              checked={filters.cyclesOnly}
              onChange={(cyclesOnly) => onFiltersChange({ cyclesOnly })}
              tone="cycle"
            />
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <label htmlFor="min-complexity" className="text-[11.5px] text-ink-muted">
                Min complexity
              </label>
              <span className="tabular text-[11px] text-ink-faint">
                {filters.minComplexity || 'any'}
              </span>
            </div>
            <input
              id="min-complexity"
              type="range"
              min={0}
              max={40}
              step={1}
              value={filters.minComplexity}
              onChange={(event) => onFiltersChange({ minComplexity: Number(event.target.value) })}
              className="mt-2 h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-[var(--color-edge)]"
            />
          </div>
        </section>

        {languages.length > 1 ? (
          <>
            <Separator />
            <section>
              <Eyebrow className="px-1.5 pb-2">Languages</Eyebrow>
              <div className="flex flex-wrap gap-1">
                {languages.map((language) => {
                  const active = filters.languages.has(language);
                  return (
                    <button
                      key={language}
                      type="button"
                      onClick={() => onToggleSetFilter('languages', language)}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center gap-1.5 rounded-xs border px-1.5 py-1 text-[10.5px] transition-colors',
                        active
                          ? 'border-edge/50 bg-edge/12 text-ink'
                          : 'border-line text-ink-faint hover:border-line-strong hover:text-ink-muted',
                      )}
                    >
                      <span
                        className="size-1.5 rounded-[1px]"
                        style={{
                          backgroundColor:
                            LANGUAGE_COLORS[language as keyof typeof LANGUAGE_COLORS] ??
                            'var(--color-ink-ghost)',
                        }}
                      />
                      {LANGUAGE_LABELS[language as keyof typeof LANGUAGE_LABELS] ?? language}
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}

        {groups.length > 1 ? (
          <>
            <Separator />
            <section>
              <Eyebrow className="px-1.5 pb-2">Modules</Eyebrow>
              <div className="space-y-0.5">
                {groups.slice(0, 24).map((group) => {
                  const active = filters.groups.has(group);
                  return (
                    <button
                      key={group}
                      type="button"
                      onClick={() => onToggleSetFilter('groups', group)}
                      aria-pressed={active}
                      className={cn(
                        'tabular flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-[11px] transition-colors',
                        active ? 'bg-edge/12 text-ink' : 'text-ink-faint hover:bg-hover hover:text-ink-muted',
                      )}
                    >
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-[1px]',
                          active ? 'bg-edge' : 'bg-line-strong',
                        )}
                      />
                      <span className="truncate">{group}</span>
                    </button>
                  );
                })}
                {groups.length > 24 ? (
                  <p className="px-2 pt-1 text-[10.5px] text-ink-ghost">
                    +{groups.length - 24} more — use the filter field
                  </p>
                ) : null}
              </div>
            </section>
          </>
        ) : null}

        {hiddenCount > 0 ? (
          <p className="rounded-sm border border-line bg-raised px-2.5 py-2 text-[11px] text-ink-faint">
            {formatCount(hiddenCount)} node{hiddenCount === 1 ? '' : 's'} hidden by the current
            filters.
          </p>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function FilterToggle({
  label,
  checked,
  onChange,
  tone = 'default',
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  tone?: 'default' | 'cycle';
}) {
  const id = React.useId();
  return (
    <div className="flex items-center justify-between gap-2">
      <label
        htmlFor={id}
        className={cn(
          'cursor-pointer text-[11.5px]',
          tone === 'cycle' && checked ? 'text-cycle' : 'text-ink-muted',
        )}
      >
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export { VIEW_META, VIEW_ORDER };
