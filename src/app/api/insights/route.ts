import { z } from 'zod';
import type { InsightTopic } from '@/lib/core/types';
import { featureFlags } from '@/lib/config/env';
import { InsightUnavailableError, insightTopics, streamInsight } from '@/lib/insights/openrouter';
import { getAnalysisStore } from '@/lib/storage';
import {
  apiError,
  guard,
  handleGuardError,
  NO_STORE_HEADERS,
  readJson,
  toApiError,
} from '@/lib/security/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const bodySchema = z.object({
  analysisId: z.string().regex(/^[A-Za-z0-9_-]{6,40}$/),
  topic: z.enum(insightTopics() as [InsightTopic, ...InsightTopic[]]),
  /**
   * Optional caller-supplied key. Lets a user try AI insights on a public
   * instance without the operator paying for it. Never persisted, never logged.
   */
  apiKey: z.string().min(20).max(300).optional(),
  model: z.string().min(1).max(120).optional(),
});

/**
 * Streams one AI-written insight section as plain text.
 *
 * When no key is available this returns 422 rather than an error page — the
 * client already holds the deterministic section and simply keeps showing it.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const { userId, headers } = await guard(request, { bucket: 'insights', limit: 20 });
    const body = await readJson(request, bodySchema);

    if (!body.apiKey && !featureFlags().ai) {
      return apiError(
        'AI insights are not configured on this instance. Add an OPENROUTER_API_KEY, or supply your own key.',
        'ai-unavailable',
        422,
      );
    }

    const store = await getAnalysisStore();
    const analysis = await store.get(body.analysisId, userId);
    if (!analysis) return apiError('Analysis not found or expired.', 'not-found', 404);

    const encoder = new TextEncoder();
    const origin = new URL(request.url).origin;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const delta of streamInsight({
            result: analysis,
            topic: body.topic,
            apiKey: body.apiKey,
            model: body.model,
            signal: request.signal,
            referer: origin,
          })) {
            controller.enqueue(encoder.encode(delta));
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            controller.close();
            return;
          }
          const message =
            error instanceof InsightUnavailableError
              ? error.message
              : 'The insight stream failed. The deterministic analysis is still shown below.';
          // The stream has already started, so surface the failure inline
          // rather than switching to a status code the client cannot see.
          controller.enqueue(encoder.encode(`\n\n> ⚠️ ${message}`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...NO_STORE_HEADERS,
        ...headers,
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    return handleGuardError(error) ?? toApiError(error);
  }
}
