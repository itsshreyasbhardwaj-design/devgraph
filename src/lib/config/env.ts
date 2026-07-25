import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Every integration is optional. DevGraph runs fully — ingestion, analysis,
 * every graph, deterministic insights — with an empty environment. Setting a
 * variable *adds* a capability; nothing is required to boot, and no key is ever
 * sent to the browser.
 */

const booleanish = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Raises GitHub's anonymous rate limit. Read-only usage.
  GITHUB_TOKEN: z.string().min(1).optional(),

  // AI insights. Absent ⇒ the deterministic engine is used and the UI says so.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().default('anthropic/claude-3.5-haiku'),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),

  // Persistence. Absent ⇒ in-memory storage scoped to the running process.
  DATABASE_URL: z.string().min(1).optional(),

  // Authentication. Absent ⇒ the app is fully usable without signing in.
  CLERK_SECRET_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1).optional(),

  // Local directory analysis, off unless deliberately enabled.
  DEVGRAPH_ALLOW_LOCAL: booleanish,
  DEVGRAPH_LOCAL_ROOTS: z.string().optional(),

  // Rate limiting.
  DEVGRAPH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  DEVGRAPH_MAX_UPLOAD_MB: z.coerce.number().int().positive().default(120),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset the memoised environment. Test-only. */
export function resetEnvCache(): void {
  cached = undefined;
}

export interface FeatureFlags {
  ai: boolean;
  aiModel: string;
  persistence: boolean;
  auth: boolean;
  localAnalysis: boolean;
  githubToken: boolean;
  maxUploadBytes: number;
}

export function featureFlags(): FeatureFlags {
  const env = serverEnv();
  return {
    ai: Boolean(env.OPENROUTER_API_KEY),
    aiModel: env.OPENROUTER_MODEL,
    persistence: Boolean(env.DATABASE_URL),
    auth: Boolean(env.CLERK_SECRET_KEY && env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY),
    localAnalysis: env.DEVGRAPH_ALLOW_LOCAL,
    githubToken: Boolean(env.GITHUB_TOKEN),
    maxUploadBytes: env.DEVGRAPH_MAX_UPLOAD_MB * 1024 * 1024,
  };
}

export function localRoots(): string[] {
  const raw = serverEnv().DEVGRAPH_LOCAL_ROOTS;
  if (!raw) return [];
  return raw
    .split(/[:,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Flags safe to expose to the browser. Deliberately a hand-written allow-list
 * rather than a filter over `process.env`, so a new secret cannot leak by
 * accidentally matching a prefix.
 */
export interface PublicFeatureFlags {
  ai: boolean;
  aiModel: string;
  persistence: boolean;
  auth: boolean;
  localAnalysis: boolean;
  maxUploadBytes: number;
}

export function publicFlags(): PublicFeatureFlags {
  const flags = featureFlags();
  return {
    ai: flags.ai,
    aiModel: flags.aiModel,
    persistence: flags.persistence,
    auth: flags.auth,
    localAnalysis: flags.localAnalysis,
    maxUploadBytes: flags.maxUploadBytes,
  };
}
