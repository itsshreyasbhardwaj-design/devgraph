import { serverEnv } from '@/lib/config/env';
import { MemoryAnalysisStore } from './memory';
import type { AnalysisStore } from './types';

/**
 * Store resolution.
 *
 * Postgres when `DATABASE_URL` is set, in-memory otherwise. The Postgres module
 * is imported lazily so the `postgres` driver never loads — and never tries to
 * open a socket — in the zero-config path.
 *
 * The instance is cached on `globalThis` because Next.js recreates module
 * scope on every hot reload in development, which would otherwise leak a new
 * connection pool per edit.
 */

const GLOBAL_KEY = Symbol.for('devgraph.analysisStore');

interface GlobalWithStore {
  [GLOBAL_KEY]?: Promise<AnalysisStore>;
}

export function getAnalysisStore(): Promise<AnalysisStore> {
  const container = globalThis as GlobalWithStore;
  container[GLOBAL_KEY] ??= createStore();
  return container[GLOBAL_KEY];
}

async function createStore(): Promise<AnalysisStore> {
  const url = serverEnv().DATABASE_URL;
  if (!url) {
    const store = new MemoryAnalysisStore();
    await store.init();
    return store;
  }

  try {
    const { PostgresAnalysisStore } = await import('./postgres');
    const store = new PostgresAnalysisStore(url);
    await store.init();
    return store;
  } catch (error) {
    // A misconfigured database must degrade to in-memory rather than take the
    // whole application down — analysis itself does not need persistence.
    console.error(
      '[devgraph] Postgres storage unavailable, falling back to in-memory:',
      error instanceof Error ? error.message : error,
    );
    const store = new MemoryAnalysisStore();
    await store.init();
    return store;
  }
}

export { MemoryAnalysisStore } from './memory';
export * from './types';
