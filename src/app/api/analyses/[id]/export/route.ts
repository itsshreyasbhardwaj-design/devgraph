import { z } from 'zod';
import { GRAPH_KINDS, type GraphKind } from '@/lib/core/types';
import { analysisToMermaid, exportBasename, toMermaid } from '@/lib/export/mermaid';
import { getAnalysisStore } from '@/lib/storage';
import {
  apiError,
  guard,
  handleGuardError,
  NO_STORE_HEADERS,
  toApiError,
} from '@/lib/security/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  format: z.enum(['json', 'mermaid', 'markdown']).default('json'),
  graph: z.enum(GRAPH_KINDS as unknown as [GraphKind, ...GraphKind[]]).optional(),
});

/**
 * Server-side exports.
 *
 * JSON and Mermaid are produced here because they are pure data transforms.
 * SVG, PNG and PDF are produced in the browser from the live canvas, where the
 * rendered geometry already exists — round-tripping that through the server
 * would mean re-implementing layout headlessly for no gain.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { userId, headers } = await guard(request, { bucket: 'read', limit: 60 });
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) {
      return apiError('Invalid analysis id.', 'invalid-input', 400);
    }

    const url = new URL(request.url);
    const query = querySchema.parse({
      format: url.searchParams.get('format') ?? undefined,
      graph: url.searchParams.get('graph') ?? undefined,
    });

    const store = await getAnalysisStore();
    const result = await store.get(id, userId);
    if (!result) return apiError('Analysis not found or expired.', 'not-found', 404);

    const stem = exportBasename(result, query.graph);
    const baseHeaders = { ...NO_STORE_HEADERS, ...headers };

    if (query.format === 'json') {
      const payload = query.graph ? result.graphs[query.graph] : result;
      if (!payload) return apiError(`No ${query.graph} graph in this analysis.`, 'not-found', 404);
      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${stem}.json"`,
        },
      });
    }

    if (query.format === 'mermaid') {
      if (!query.graph) {
        return apiError('Specify ?graph= for a single Mermaid diagram.', 'invalid-input', 400);
      }
      const view = result.graphs[query.graph];
      if (!view) return apiError(`No ${query.graph} graph in this analysis.`, 'not-found', 404);
      return new Response(toMermaid(view), {
        headers: {
          ...baseHeaders,
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${stem}.mmd"`,
        },
      });
    }

    return new Response(analysisToMermaid(result, query.graph ? [query.graph] : undefined), {
      headers: {
        ...baseHeaders,
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${stem}.md"`,
      },
    });
  } catch (error) {
    return handleGuardError(error) ?? toApiError(error);
  }
}
