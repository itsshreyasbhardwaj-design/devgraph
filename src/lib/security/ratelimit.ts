/**
 * Fixed-window rate limiting.
 *
 * Deliberately in-process: DevGraph's default deployment is a single Next.js
 * instance, and an in-memory limiter needs no Redis to be useful. On a
 * multi-instance deployment this becomes per-instance rather than global —
 * documented rather than silently assumed. Swap in a shared counter by
 * implementing `RateLimiter`.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix ms at which the current window resets. */
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

interface Window {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();
  private lastSweep = Date.now();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    this.sweep(now);

    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      const window: Window = { count: 1, resetAt: now + this.windowMs };
      this.windows.set(key, window);
      return {
        allowed: true,
        limit: this.limit,
        remaining: this.limit - 1,
        resetAt: window.resetAt,
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
      };
    }

    existing.count += 1;
    const remaining = Math.max(0, this.limit - existing.count);
    return {
      allowed: existing.count <= this.limit,
      limit: this.limit,
      remaining,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  /** Drop expired windows so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 30_000) return;
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

const GLOBAL_KEY = Symbol.for('devgraph.rateLimiters');

interface GlobalWithLimiters {
  [GLOBAL_KEY]?: Map<string, InMemoryRateLimiter>;
}

/** Named limiters, cached across hot reloads. */
export function getRateLimiter(name: string, limit: number, windowMs = 60_000): RateLimiter {
  const container = globalThis as GlobalWithLimiters;
  container[GLOBAL_KEY] ??= new Map();
  const existing = container[GLOBAL_KEY].get(name);
  if (existing) return existing;
  const limiter = new InMemoryRateLimiter(limit, windowMs);
  container[GLOBAL_KEY].set(name, limiter);
  return limiter;
}

/**
 * Best-effort client identity for rate limiting. Proxy headers are spoofable,
 * so this is a fairness mechanism, not an authentication one.
 */
export function clientKey(request: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get('x-forwarded-for');
  const ip =
    forwarded?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'anonymous';
  return `ip:${ip}`;
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.ceil((result.resetAt - Date.now()) / 1000)),
  };
}
