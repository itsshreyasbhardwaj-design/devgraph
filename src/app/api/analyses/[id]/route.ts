import { NextResponse } from 'next/server';
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

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { userId, headers } = await guard(request, { bucket: 'read', limit: 120 });
    const { id } = await context.params;
    if (!ID_PATTERN.test(id)) return apiError('Invalid analysis id.', 'invalid-input', 400);

    const store = await getAnalysisStore();
    const result = await store.get(id, userId);
    if (!result) return apiError('Analysis not found or expired.', 'not-found', 404);

    return NextResponse.json(result, { headers: { ...NO_STORE_HEADERS, ...headers } });
  } catch (error) {
    return handleGuardError(error) ?? toApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { userId, headers } = await guard(request, { bucket: 'write', limit: 30 });
    const { id } = await context.params;
    if (!ID_PATTERN.test(id)) return apiError('Invalid analysis id.', 'invalid-input', 400);

    const store = await getAnalysisStore();
    const deleted = await store.delete(id, userId);
    if (!deleted) return apiError('Analysis not found.', 'not-found', 404);

    return NextResponse.json({ deleted: true }, { headers: { ...NO_STORE_HEADERS, ...headers } });
  } catch (error) {
    return handleGuardError(error) ?? toApiError(error);
  }
}
