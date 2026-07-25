import { NextResponse } from 'next/server';
import { z } from 'zod';
import { featureFlags, serverEnv } from '@/lib/config/env';
import { IngestError } from '@/lib/ingest/types';
import { clientKey, getRateLimiter, rateLimitHeaders } from './ratelimit';

/**
 * Shared API-route plumbing: error shaping, rate limiting, body validation and
 * the optional authentication guard.
 *
 * Authentication is optional by design — DevGraph is useful to an anonymous
 * visitor. When Clerk is configured the user id is attached to stored analyses
 * so a signed-in user gets a private history; when it is not, everything is
 * anonymous and public to the instance.
 */

export interface ApiErrorBody {
  error: { message: string; code: string };
}

export function apiError(
  message: string,
  code: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { message, code } }, { status, headers });
}

export function toApiError(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof IngestError) {
    return apiError(error.message, error.code, error.status);
  }
  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return apiError(`${first.path.join('.') || 'request'}: ${first.message}`, 'invalid-input', 400);
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return apiError('The request was cancelled.', 'aborted', 499);
  }

  console.error('[devgraph] Unhandled API error:', error);
  return apiError('Something went wrong while processing the request.', 'internal', 500);
}

export interface GuardResult {
  userId?: string;
  headers: Record<string, string>;
}

export class RateLimitedError extends Error {
  constructor(
    readonly headers: Record<string, string>,
    readonly retryAfter: number,
  ) {
    super('Too many requests.');
    this.name = 'RateLimitedError';
  }
}

/**
 * Resolve the signed-in user, if authentication is configured. Import is lazy
 * so `@clerk/nextjs` stays out of the bundle when auth is disabled.
 */
export async function currentUserId(): Promise<string | undefined> {
  if (!featureFlags().auth) return undefined;
  try {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    return userId ?? undefined;
  } catch {
    return undefined;
  }
}

export interface GuardOptions {
  /** Limiter bucket name; separate buckets keep cheap reads off the analyse budget. */
  bucket: string;
  /** Requests per minute. Defaults to the configured analysis budget. */
  limit?: number;
  windowMs?: number;
}

export async function guard(request: Request, options: GuardOptions): Promise<GuardResult> {
  const userId = await currentUserId();
  const limit = options.limit ?? serverEnv().DEVGRAPH_RATE_LIMIT_PER_MINUTE;
  const limiter = getRateLimiter(options.bucket, limit, options.windowMs);
  const result = limiter.check(`${options.bucket}:${clientKey(request, userId)}`);
  const headers = rateLimitHeaders(result);

  if (!result.allowed) {
    throw new RateLimitedError(
      { ...headers, 'Retry-After': String(result.retryAfterSeconds) },
      result.retryAfterSeconds,
    );
  }

  return { userId, headers };
}

export function handleGuardError(error: unknown): NextResponse<ApiErrorBody> | undefined {
  if (error instanceof RateLimitedError) {
    return apiError(
      `Too many requests. Try again in ${error.retryAfter}s.`,
      'rate-limited',
      429,
      error.headers,
    );
  }
  return undefined;
}

/** Parse and validate a JSON body, with a hard size ceiling. */
export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes = 64 * 1024,
): Promise<T> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new IngestError('Request body is too large.', 'too-large', 413);
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new IngestError('Request body is too large.', 'too-large', 413);
  }
  let json: unknown;
  try {
    json = JSON.parse(text || '{}');
  } catch {
    throw new IngestError('Request body must be valid JSON.', 'invalid-input', 400);
  }
  return schema.parse(json);
}

/** Headers applied to every analysis response. Results are never cacheable. */
export const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};
