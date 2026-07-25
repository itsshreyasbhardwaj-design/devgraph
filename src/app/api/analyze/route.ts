import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { AnalysisStreamEvent, RepoSource } from '@/lib/core/types';
import { analyzeRepository } from '@/lib/analysis/pipeline';
import { featureFlags, localRoots, serverEnv } from '@/lib/config/env';
import { ingestGitHub, parseRepoInput } from '@/lib/ingest/github';
import { ingestLocal } from '@/lib/ingest/local';
import { ingestZip, validateUpload } from '@/lib/ingest/zip';
import { DEFAULT_INGEST_LIMITS, IngestError, type IngestResult } from '@/lib/ingest/types';
import { getAnalysisStore } from '@/lib/storage';
import { sourceKey } from '@/lib/storage/types';
import {
  apiError,
  guard,
  handleGuardError,
  NO_STORE_HEADERS,
  toApiError,
} from '@/lib/security/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Large repositories take time; Vercel caps this at the plan maximum. */
export const maxDuration = 300;

const githubSchema = z.object({
  kind: z.literal('github'),
  repository: z.string().min(1).max(300),
  refresh: z.boolean().optional(),
});

const localSchema = z.object({
  kind: z.literal('local'),
  path: z.string().min(1).max(1000),
  refresh: z.boolean().optional(),
});

const requestSchema = z.discriminatedUnion('kind', [githubSchema, localSchema]);

/**
 * Analysis endpoint.
 *
 * Responds with newline-delimited JSON so the client can render live progress
 * while a large repository is being parsed, instead of staring at a spinner for
 * two minutes. Each line is one `AnalysisStreamEvent`.
 *
 * Accepts either a JSON body (GitHub / local) or a multipart upload (ZIP).
 */
export async function POST(request: Request): Promise<Response> {
  let userId: string | undefined;
  let guardHeaders: Record<string, string> = {};

  try {
    const result = await guard(request, { bucket: 'analyze' });
    userId = result.userId;
    guardHeaders = result.headers;
  } catch (error) {
    const rateLimited = handleGuardError(error);
    if (rateLimited) return rateLimited;
    return toApiError(error);
  }

  const contentType = request.headers.get('content-type') ?? '';
  const flags = featureFlags();
  const limits = { ...DEFAULT_INGEST_LIMITS, maxArchiveBytes: flags.maxUploadBytes };

  let ingest: () => Promise<IngestResult>;
  let refresh = false;

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return apiError('Attach a .zip archive in the `file` field.', 'invalid-input', 400);
      }
      validateUpload({ size: file.size, name: file.name, type: file.type }, limits);
      const data = new Uint8Array(await file.arrayBuffer());
      ingest = async () => ingestZip({ data, filename: file.name, limits });
      refresh = true; // uploads are never cache-hits
    } else {
      const body = requestSchema.parse(await request.json());
      refresh = body.refresh ?? false;

      if (body.kind === 'github') {
        // Validate the reference before the stream opens. Once a streaming
        // response has started the status code is already committed, so an
        // obviously malformed input would otherwise return 200 with an error
        // buried in the body — useless to any non-browser client.
        parseRepoInput(body.repository);
        ingest = () =>
          ingestGitHub({
            input: body.repository,
            token: serverEnv().GITHUB_TOKEN,
            limits,
            signal: request.signal,
          });
      } else {
        ingest = () =>
          ingestLocal({
            path: body.path,
            enabled: flags.localAnalysis,
            allowedRoots: localRoots(),
            limits,
          });
      }
    }
  } catch (error) {
    return toApiError(error);
  }

  const encoder = new TextEncoder();
  const store = await getAnalysisStore();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalysisStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({
          type: 'progress',
          data: { phase: 'fetching', message: 'Fetching repository', progress: 0.02 },
        });

        const ingested = await ingest();
        for (const warning of ingested.warnings) send({ type: 'warning', data: warning });

        send({
          type: 'progress',
          data: {
            phase: 'unpacking',
            message: 'Repository ready',
            progress: 0.1,
            detail: `${ingested.files.length.toLocaleString()} source files`,
          },
        });

        // Reuse an identical prior analysis unless a refresh was requested.
        if (!refresh) {
          const cached = await store.findBySource(sourceKey(ingested.source), userId);
          if (cached) {
            send({
              type: 'progress',
              data: { phase: 'done', message: 'Loaded a previous analysis', progress: 1 },
            });
            send({ type: 'result', data: cached });
            controller.close();
            return;
          }
        }

        const analysis = await analyzeRepository({
          id: nanoid(12),
          source: ingested.source satisfies RepoSource,
          files: ingested.files,
          repo: ingested.repo,
          onProgress: (progress) => send({ type: 'progress', data: progress }),
        });

        analysis.warnings = [...new Set([...ingested.warnings, ...analysis.warnings])];

        try {
          await store.save(analysis, userId);
        } catch (error) {
          send({
            type: 'warning',
            data: `The analysis could not be persisted: ${
              error instanceof Error ? error.message : 'unknown error'
            }. It is still available in this session.`,
          });
        }

        send({ type: 'result', data: analysis });
      } catch (error) {
        if (error instanceof IngestError) {
          send({ type: 'error', data: { message: error.message, code: error.code } });
        } else if (error instanceof Error && error.name === 'AbortError') {
          // The client navigated away; nothing to report.
        } else {
          console.error('[devgraph] Analysis failed:', error);
          send({
            type: 'error',
            data: {
              message:
                error instanceof Error ? error.message : 'Analysis failed for an unknown reason.',
              code: 'internal',
            },
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...NO_STORE_HEADERS,
      ...guardHeaders,
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}
