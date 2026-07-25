import { NextResponse } from 'next/server';
import { getAnalysisStore } from '@/lib/storage';
import { guard, handleGuardError, NO_STORE_HEADERS, toApiError } from '@/lib/security/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Recent analyses visible to the caller. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId, headers } = await guard(request, { bucket: 'read', limit: 120 });
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? '25') || 25));

    const store = await getAnalysisStore();
    const analyses = await store.list(userId, limit);

    return NextResponse.json(
      { analyses, storage: store.kind },
      { headers: { ...NO_STORE_HEADERS, ...headers } },
    );
  } catch (error) {
    return handleGuardError(error) ?? toApiError(error);
  }
}
