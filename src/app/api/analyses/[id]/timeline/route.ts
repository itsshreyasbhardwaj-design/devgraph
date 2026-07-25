import { NextResponse } from 'next/server';
import { serverEnv } from '@/lib/config/env';
import { buildGitHubTimeline } from '@/lib/git/timeline';
import { parseRepoInput } from '@/lib/ingest/github';
import { getAnalysisStore } from '@/lib/storage';
import { apiError, guard, handleGuardError, NO_STORE_HEADERS, toApiError } from '@/lib/security/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Timeline is fetched on demand rather than during analysis: it costs one API
 * call per sampled commit, and a rate-limited or history-less repository should
 * never delay the main result.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { userId, headers } = await guard(request, { bucket: 'timeline', limit: 10 });
    const { id } = await context.params;
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) {
      return apiError('Invalid analysis id.', 'invalid-input', 400);
    }

    const store = await getAnalysisStore();
    const result = await store.get(id, userId);
    if (!result) return apiError('Analysis not found or expired.', 'not-found', 404);

    if (result.timeline.available) {
      return NextResponse.json(result.timeline, { headers: { ...NO_STORE_HEADERS, ...headers } });
    }

    if (result.source.kind !== 'github') {
      return NextResponse.json(
        {
          available: false,
          reason:
            'Timeline needs Git history. Analyse a GitHub repository to see how its architecture evolved.',
          commits: [],
          snapshots: [],
          moduleGrowth: [],
          dependencyEvents: [],
        },
        { headers: { ...NO_STORE_HEADERS, ...headers } },
      );
    }

    const ref = parseRepoInput(result.source.label);
    const timeline = await buildGitHubTimeline(
      ref,
      result.source.ref ?? result.repo.defaultBranch ?? 'main',
      serverEnv().GITHUB_TOKEN,
      { signal: request.signal },
    );

    if (timeline.available) {
      // Cache it back onto the stored analysis so a revisit is instant.
      await store.save({ ...result, timeline }, userId).catch(() => undefined);
    }

    return NextResponse.json(timeline, { headers: { ...NO_STORE_HEADERS, ...headers } });
  } catch (error) {
    return handleGuardError(error) ?? toApiError(error);
  }
}
