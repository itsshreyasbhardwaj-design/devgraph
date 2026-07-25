'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AnalysisStreamEvent } from '@/lib/core/types';
import { useWorkspace } from '@/lib/client/store';
import { pendingUpload } from '@/components/marketing/RepoInput';
import { RunProgress } from '@/components/workspace/RunProgress';
import { Workspace } from '@/components/workspace/Workspace';

/**
 * The analysis driver.
 *
 * Owns exactly one job: turn a URL into an `AnalysisResult`, streaming progress
 * while it happens. Three entry shapes are supported — a GitHub reference, a
 * stored analysis id, and a pending ZIP handed over from the landing page.
 */

export interface AnalyzeClientProps {
  aiAvailable: boolean;
}

export function AnalyzeClient({ aiAvailable }: AnalyzeClientProps) {
  const router = useRouter();
  const params = useSearchParams();
  const { result, run, setResult, setRunning, applyEvent, setError } = useWorkspace();

  const repo = params.get('repo');
  const id = params.get('id');
  const upload = params.get('upload');

  const abortRef = React.useRef<AbortController | null>(null);
  // Guards against React 18/19 double-invoked effects re-running the analysis.
  const startedRef = React.useRef<string | null>(null);

  const consumeStream = React.useCallback(
    async (response: Response) => {
      if (!response.body) throw new Error('The server returned an empty response.');

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed with ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON: one event per line; the last fragment may be incomplete.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            applyEvent(JSON.parse(trimmed) as AnalysisStreamEvent);
          } catch {
            // A malformed frame is not worth failing the whole run over.
          }
        }
      }
    },
    [applyEvent],
  );

  const start = React.useCallback(async () => {
    const key = repo ? `repo:${repo}` : upload ? 'upload' : id ? `id:${id}` : null;
    if (!key || startedRef.current === key) return;
    startedRef.current = key;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (id) {
        setRunning();
        const response = await fetch(`/api/analyses/${id}`, { signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message ?? 'That analysis is no longer available.');
        }
        setResult(await response.json());
        return;
      }

      if (upload) {
        const file = pendingUpload.file;
        if (!file) {
          // A reload clears the handed-over File; send the user back to pick one.
          router.replace('/');
          return;
        }
        pendingUpload.file = null;
        setRunning();
        const form = new FormData();
        form.append('file', file);
        await consumeStream(
          await fetch('/api/analyze', { method: 'POST', body: form, signal: controller.signal }),
        );
        return;
      }

      if (repo) {
        setRunning();
        await consumeStream(
          await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'github', repository: repo }),
            signal: controller.signal,
          }),
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setError(error instanceof Error ? error.message : 'The analysis could not be started.');
    }
  }, [repo, id, upload, consumeStream, router, setRunning, setResult, setError]);

  React.useEffect(() => {
    void start();
    return () => abortRef.current?.abort();
  }, [start]);

  // Keep the URL pointing at the stored analysis so the view is shareable and
  // a refresh reloads it instead of re-running the whole pipeline.
  React.useEffect(() => {
    if (result && !id) {
      router.replace(`/analyze?id=${result.id}`, { scroll: false });
    }
  }, [result, id, router]);

  const retry = React.useCallback(() => {
    startedRef.current = null;
    void start();
  }, [start]);

  if (result) {
    return (
      <Workspace
        result={result}
        aiAvailable={aiAvailable}
        onReanalyze={
          result.source.kind === 'github'
            ? () => router.push(`/analyze?repo=${encodeURIComponent(result.source.label)}`)
            : undefined
        }
      />
    );
  }

  return (
    <div className="relative min-h-dvh">
      <div aria-hidden className="grid-field pointer-events-none fixed inset-0 opacity-60" />
      <div className="relative z-10">
        <RunProgress
          run={run}
          label={repo ?? (upload ? 'Uploaded archive' : (id ?? 'repository'))}
          onRetry={retry}
        />
      </div>
    </div>
  );
}
