'use client';

import * as React from 'react';
import { Command } from 'cmdk';
import {
  Braces,
  Database,
  FileCode,
  FolderTree,
  KeyRound,
  Package,
  Route,
  Search,
  Shapes,
} from 'lucide-react';
import type { AnalysisResult, GraphKind, SearchEntry, SearchEntryKind } from '@/lib/core/types';
import { runSearch } from '@/lib/client/store';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/primitives';
import { cn, truncatePath } from '@/lib/utils';

/**
 * Search across everything the analysis found.
 *
 * A result knows which graph views contain it, so choosing one switches to the
 * best view and selects the node there — search is navigation, not a list.
 */

const KIND_ICON: Record<SearchEntryKind, typeof FileCode> = {
  file: FileCode,
  folder: FolderTree,
  class: Shapes,
  interface: Shapes,
  function: Braces,
  method: Braces,
  component: Shapes,
  route: Route,
  table: Database,
  column: Database,
  env: KeyRound,
  dependency: Package,
};

const KIND_LABEL: Record<SearchEntryKind, string> = {
  file: 'File',
  folder: 'Folder',
  class: 'Class',
  interface: 'Interface',
  function: 'Function',
  method: 'Method',
  component: 'Component',
  route: 'Route',
  table: 'Table',
  column: 'Column',
  env: 'Env var',
  dependency: 'Dependency',
};

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: AnalysisResult;
  currentGraph: GraphKind;
  onNavigate: (graph: GraphKind, nodeId: string) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  result,
  currentGraph,
  onNavigate,
}: CommandPaletteProps) {
  const [query, setQuery] = React.useState('');

  const hits = React.useMemo(() => runSearch(result, query), [result, query]);

  // Group by kind so the list reads as a table of contents, not a flat dump.
  const grouped = React.useMemo(() => {
    const buckets = new Map<SearchEntryKind, SearchEntry[]>();
    for (const hit of hits) {
      const bucket = buckets.get(hit.entry.kind) ?? [];
      bucket.push(hit.entry);
      buckets.set(hit.entry.kind, bucket);
    }
    return [...buckets.entries()];
  }, [hits]);

  // Reset in the handler rather than an effect: closing is a user action, so
  // the state change belongs on the same event, not on a re-render.
  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  const choose = (entry: SearchEntry) => {
    // Prefer a target in the view the user is already looking at.
    const target =
      entry.targets.find((candidate) => candidate.graph === currentGraph) ?? entry.targets[0];
    if (target) onNavigate(target.graph, target.nodeId);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showClose={false}
        className="top-[18%] max-w-2xl translate-y-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Search the analysis</DialogTitle>
        <Command shouldFilter={false} loop className="flex max-h-[62vh] flex-col">
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search className="size-4 shrink-0 text-ink-ghost" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              autoFocus
              placeholder="Search files, classes, functions, routes, tables, config…"
              className="tabular h-12 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-ghost"
            />
            <kbd className="tabular hidden shrink-0 rounded-xs border border-line px-1.5 py-0.5 text-[10px] text-ink-ghost sm:block">
              ESC
            </kbd>
          </div>

          <Command.List className="flex-1 overflow-y-auto p-2">
            {query.trim() === '' ? (
              <div className="px-3 py-8 text-center">
                <p className="text-[13px] text-ink-faint">
                  {result.searchIndex.length.toLocaleString()} symbols indexed
                </p>
                <p className="mt-1.5 text-[11.5px] text-ink-ghost">
                  Type to search. Selecting a result opens the view that contains it.
                </p>
              </div>
            ) : null}

            <Command.Empty className="px-3 py-8 text-center text-[13px] text-ink-faint">
              No match for &ldquo;{query}&rdquo;.
            </Command.Empty>

            {grouped.map(([kind, entries]) => {
              const Icon = KIND_ICON[kind] ?? FileCode;
              return (
                <Command.Group
                  key={kind}
                  heading={
                    <span className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-ghost">
                      {KIND_LABEL[kind] ?? kind}
                    </span>
                  }
                  className="mb-1"
                >
                  {entries.slice(0, 8).map((entry) => (
                    <Command.Item
                      key={entry.id}
                      value={entry.id}
                      onSelect={() => choose(entry)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-2 text-[13px]',
                        'data-[selected=true]:bg-edge/12 data-[selected=true]:text-ink',
                        'text-ink-muted',
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-ink-ghost" />
                      <span className="tabular min-w-0 flex-1 truncate">{entry.label}</span>
                      {entry.path ? (
                        <span className="tabular hidden shrink-0 text-[10.5px] text-ink-ghost sm:block">
                          {truncatePath(entry.path, 40)}
                          {entry.line ? `:${entry.line}` : ''}
                        </span>
                      ) : entry.detail ? (
                        <span className="hidden shrink-0 text-[10.5px] text-ink-ghost sm:block">
                          {entry.detail}
                        </span>
                      ) : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
