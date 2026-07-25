'use client';

import * as React from 'react';
import { Loader2, Sparkles, StopCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { AnalysisResult, InsightSection, InsightTopic } from '@/lib/core/types';
import { Button } from '@/components/ui/button';
import { Badge, Eyebrow, Panel, ScrollArea, Separator } from '@/components/ui/primitives';
import { Markdown } from './Markdown';
import { cn } from '@/lib/utils';

/**
 * Architecture insights.
 *
 * The deterministic sections are always present and always shown first — they
 * need no key and no network. When AI is available, "Expand with AI" streams a
 * richer version of the *current* section over the top of it, and the original
 * stays one click away. The distinction is stated in the UI rather than blurred.
 */

export interface InsightsPanelProps {
  result: AnalysisResult;
  aiAvailable: boolean;
  onOpenFile: (path: string) => void;
}

interface StreamState {
  topic: InsightTopic | null;
  text: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
}

export function InsightsPanel({ result, aiAvailable, onOpenFile }: InsightsPanelProps) {
  const sections = result.insights.sections;
  const [active, setActive] = React.useState<InsightTopic>(sections[0]?.topic ?? 'overview');
  const [stream, setStream] = React.useState<StreamState>({ topic: null, text: '', status: 'idle' });
  const [showOriginal, setShowOriginal] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const section = sections.find((entry) => entry.topic === active) ?? sections[0];
  const knownPaths = React.useMemo(
    () => new Set(result.files.map((file) => file.path)),
    [result.files],
  );

  const showingAi = stream.topic === active && stream.text.length > 0 && !showOriginal;

  React.useEffect(() => () => abortRef.current?.abort(), []);

  /** Switching topics abandons any in-flight stream for the previous one. */
  const selectTopic = (topic: InsightTopic) => {
    abortRef.current?.abort();
    setShowOriginal(false);
    setActive(topic);
  };

  const expand = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStream({ topic: active, text: '', status: 'streaming' });

    try {
      const response = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisId: result.id, topic: active }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed with ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setStream({ topic: active, text, status: 'streaming' });
      }

      setStream({ topic: active, text, status: 'done' });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setStream({ topic: null, text: '', status: 'error' });
      toast.error(
        error instanceof Error ? error.message : 'The AI insight could not be generated.',
      );
    }
  };

  if (!section) return null;

  return (
    <div className="flex h-full min-h-0">
      {/* ------------------------------------------------------ topic rail */}
      <nav className="hidden w-56 shrink-0 border-r border-line lg:block">
        <ScrollArea className="h-full">
          <div className="p-3">
            <Eyebrow className="px-1.5 pb-2">Topics</Eyebrow>
            <ul className="space-y-0.5">
              {sections.map((entry) => (
                <li key={entry.topic}>
                  <button
                    type="button"
                    onClick={() => selectTopic(entry.topic)}
                    aria-current={entry.topic === active ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-sm px-2 py-1.5 text-left transition-colors',
                      entry.topic === active
                        ? 'bg-edge/12 text-ink'
                        : 'text-ink-muted hover:bg-hover hover:text-ink',
                    )}
                  >
                    <span className="block truncate text-[12.5px]">{entry.title}</span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-ghost">
                      {entry.summary}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>
      </nav>

      {/* --------------------------------------------------------- content */}
      <ScrollArea className="min-w-0 flex-1">
        <div className="mx-auto max-w-3xl p-6 pb-20">
          {/* Mobile topic selector. */}
          <div className="mb-5 lg:hidden">
            <label htmlFor="insight-topic" className="sr-only">
              Insight topic
            </label>
            <select
              id="insight-topic"
              value={active}
              onChange={(event) => selectTopic(event.target.value as InsightTopic)}
              className="h-9 w-full rounded-md border border-line bg-pit px-3 text-sm text-ink"
            >
              {sections.map((entry) => (
                <option key={entry.topic} value={entry.topic}>
                  {entry.title}
                </option>
              ))}
            </select>
          </div>

          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-[22px] font-semibold leading-tight text-ink">
                {section.title}
              </h2>
              <p className="mt-1.5 text-[12.5px] text-ink-faint">{section.summary}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={showingAi ? 'accent' : 'neutral'}>
                {showingAi ? 'AI expanded' : 'Deterministic'}
              </Badge>
              <ConfidenceBadge confidence={section.confidence} />
            </div>
          </header>

          <Separator className="my-5" />

          {showingAi ? (
            <>
              <Markdown
                content={stream.text}
                knownPaths={knownPaths}
                onFileClick={onOpenFile}
              />
              {stream.status === 'streaming' ? (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-edge align-middle" />
              ) : null}
            </>
          ) : (
            <Markdown content={section.body} knownPaths={knownPaths} onFileClick={onOpenFile} />
          )}

          {/* --------------------------------------------------- references */}
          {section.references.length && !showingAi ? (
            <div className="mt-8">
              <Eyebrow className="pb-2.5">Referenced files</Eyebrow>
              <ul className="flex flex-wrap gap-1.5">
                {section.references.map((reference) => (
                  <li key={`${reference.path}:${reference.line ?? 0}`}>
                    <button
                      type="button"
                      onClick={() => onOpenFile(reference.path)}
                      title={reference.note}
                      className="tabular rounded-xs border border-line px-2 py-1 text-[11px] text-ink-faint transition-colors hover:border-edge/50 hover:bg-edge/10 hover:text-edge-soft"
                    >
                      {reference.path}
                      {reference.line ? `:${reference.line}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ---------------------------------------------------- AI control */}
          <Panel className="mt-10 bg-raised/50">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <Sparkles className={cn('size-4 shrink-0', aiAvailable ? 'text-edge' : 'text-ink-ghost')} />
              <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-muted">
                {aiAvailable
                  ? 'Expand this section with a model. It reads a factual digest of the analysis — never your source — and every file it cites is verified against the real file list.'
                  : 'AI expansion is off on this instance. Set OPENROUTER_API_KEY to enable it; everything above is computed without a model either way.'}
              </p>

              {stream.status === 'streaming' && stream.topic === active ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    abortRef.current?.abort();
                    setStream((current) => ({ ...current, status: 'done' }));
                  }}
                >
                  <StopCircle />
                  Stop
                </Button>
              ) : (
                <Button
                  variant={aiAvailable ? 'accent' : 'outline'}
                  size="sm"
                  disabled={!aiAvailable}
                  onClick={expand}
                >
                  {stream.status === 'streaming' ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  Expand with AI
                </Button>
              )}

              {stream.topic === active && stream.text ? (
                <Button variant="ghost" size="sm" onClick={() => setShowOriginal((value) => !value)}>
                  {showOriginal ? 'Show AI version' : 'Show original'}
                </Button>
              ) : null}
            </div>
          </Panel>
        </div>
      </ScrollArea>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: InsightSection['confidence'] }) {
  const tone = confidence === 'high' ? 'good' : confidence === 'medium' ? 'warn' : 'neutral';
  return <Badge tone={tone}>{confidence} confidence</Badge>;
}
