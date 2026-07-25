import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnalysisResult } from '@/lib/core/types';
import { analyzeRepository } from '@/lib/analysis/pipeline';
import { InMemoryRateLimiter, clientKey } from '@/lib/security/ratelimit';
import { MemoryAnalysisStore } from '@/lib/storage/memory';
import { sourceKey } from '@/lib/storage/types';
import { analysisToMermaid, toMermaid } from '@/lib/export/mermaid';
import { buildDependencyEvents, buildModuleGrowth, diffSnapshots, sampleCommits } from '@/lib/git/timeline';
import { buildAnalysisDigest } from '@/lib/insights/context';
import { toInsightSection, unverifiedReferences } from '@/lib/insights/openrouter';
import { sampleRepoFiles } from '../fixtures/sampleRepo';

let analysis: AnalysisResult;

beforeAll(async () => {
  analysis = await analyzeRepository({
    id: 'infra-test',
    source: { kind: 'github', label: 'acme/shop', ref: 'main' },
    files: sampleRepoFiles(),
  });
});

describe('InMemoryRateLimiter', () => {
  it('allows up to the limit then blocks', () => {
    const limiter = new InMemoryRateLimiter(3, 60_000);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
    const blocked = limiter.check('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('tracks keys independently and resets after the window', () => {
    vi.useFakeTimers();
    try {
      const limiter = new InMemoryRateLimiter(1, 1000);
      expect(limiter.check('a').allowed).toBe(true);
      expect(limiter.check('b').allowed).toBe(true);
      expect(limiter.check('a').allowed).toBe(false);
      vi.advanceTimersByTime(1500);
      expect(limiter.check('a').allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('derives a client key from proxy headers and prefers the user id', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    });
    expect(clientKey(request)).toBe('ip:203.0.113.9');
    expect(clientKey(request, 'user_123')).toBe('user:user_123');
    expect(clientKey(new Request('https://example.com'))).toBe('ip:anonymous');
  });
});

describe('MemoryAnalysisStore', () => {
  it('saves, reads back and lists analyses', async () => {
    const store = new MemoryAnalysisStore();
    await store.init();
    await store.save(analysis);

    expect((await store.get(analysis.id))?.id).toBe(analysis.id);
    const list = await store.list();
    expect(list[0]).toMatchObject({ id: analysis.id, repoName: analysis.repo.name });
    expect(await store.findBySource(sourceKey(analysis.source))).toBeDefined();
  });

  it('keeps owned analyses private to their owner', async () => {
    const store = new MemoryAnalysisStore();
    await store.init();
    await store.save({ ...analysis, id: 'owned1' }, 'user_a');

    expect(await store.get('owned1', 'user_a')).toBeDefined();
    expect(await store.get('owned1', 'user_b')).toBeUndefined();
    expect(await store.get('owned1')).toBeUndefined();
    expect(await store.delete('owned1', 'user_b')).toBe(false);
    expect(await store.delete('owned1', 'user_a')).toBe(true);
  });

  it('evicts the least recently used entry past the cap', async () => {
    const store = new MemoryAnalysisStore(2);
    await store.init();
    await store.save({ ...analysis, id: 'a1' });
    await store.save({ ...analysis, id: 'a2' });
    await store.get('a1');
    await store.save({ ...analysis, id: 'a3' });

    expect(await store.get('a2')).toBeUndefined();
    expect(await store.get('a1')).toBeDefined();
    expect(await store.get('a3')).toBeDefined();
  });
});

describe('mermaid export', () => {
  it('emits a flowchart for the import graph', () => {
    const diagram = toMermaid(analysis.graphs.imports!);
    expect(diagram).toContain('flowchart');
    expect(diagram).toContain('-->');
    expect(diagram).not.toContain('undefined');
  });

  it('emits a class diagram for types', () => {
    const diagram = toMermaid(analysis.graphs.classes!);
    expect(diagram).toContain('classDiagram');
  });

  it('emits an ER diagram for the schema', () => {
    const diagram = toMermaid(analysis.graphs.schema!);
    expect(diagram).toContain('erDiagram');
    expect(diagram).toContain('User');
    expect(diagram).toContain('Order');
  });

  it('produces sanitised node ids', () => {
    const diagram = toMermaid(analysis.graphs.folders!);
    // Raw slashes and dots in ids would break Mermaid parsing.
    for (const line of diagram.split('\n')) {
      const match = /^\s{2}(n_[A-Za-z0-9_]+)/.exec(line);
      if (match) expect(match[1]).toMatch(/^n_[A-Za-z0-9_]+$/);
    }
  });

  it('bundles every view into one markdown document', () => {
    const doc = analysisToMermaid(analysis);
    expect(doc).toContain('# acme-shop');
    expect((doc.match(/```mermaid/g) ?? []).length).toBeGreaterThan(3);
  });
});

describe('timeline helpers', () => {
  const snapshots = [
    { sha: 'a', date: '2024-01-01T00:00:00Z', files: 10, lines: 100, modules: { 'src/core': 5, 'src/ui': 5 }, dependencies: ['react'] },
    { sha: 'b', date: '2024-06-01T00:00:00Z', files: 20, lines: 300, modules: { 'src/core': 8, 'src/ui': 12 }, dependencies: ['react', 'zustand'] },
    { sha: 'c', date: '2024-12-01T00:00:00Z', files: 26, lines: 500, modules: { 'src/core': 8, 'src/ui': 18 }, dependencies: ['zustand'] },
  ];

  it('samples commits evenly and orders them oldest first', () => {
    const commits = Array.from({ length: 50 }, (_, i) => ({
      sha: `sha${i}`,
      shortSha: `sha${i}`,
      author: 'a',
      date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
      message: 'm',
    }));
    const sampled = sampleCommits(commits, 5);
    expect(sampled).toHaveLength(5);
    expect(sampled[0].sha).toBe('sha49');
    expect(sampled.at(-1)?.sha).toBe('sha0');
  });

  it('charts module growth', () => {
    const growth = buildModuleGrowth(snapshots);
    const ui = growth.find((g) => g.module === 'src/ui');
    expect(ui?.series.map((point) => point.value)).toEqual([5, 12, 18]);
  });

  it('detects dependency additions and removals', () => {
    const events = buildDependencyEvents(snapshots);
    expect(events[0].added).toEqual(['zustand']);
    expect(events[1].removed).toEqual(['react']);
  });

  it('diffs two snapshots', () => {
    const diff = diffSnapshots(snapshots[0], snapshots[2]);
    expect(diff.addedDependencies).toEqual(['zustand']);
    expect(diff.removedDependencies).toEqual(['react']);
    expect(diff.moduleDelta.find((m) => m.module === 'src/ui')?.delta).toBe(13);
  });
});

describe('insight context', () => {
  it('builds a factual digest bounded in size', () => {
    const digest = buildAnalysisDigest(analysis);
    expect(digest).toContain('## REPOSITORY');
    expect(digest).toContain('acme-shop');
    expect(digest).toContain('## API ROUTES');
    expect(digest).toContain('## CIRCULAR DEPENDENCIES');
    expect(digest.length).toBeLessThanOrEqual(14_100);
  });

  it('truncates rather than growing without bound', () => {
    const digest = buildAnalysisDigest(analysis, { maxChars: 500 });
    expect(digest.length).toBeLessThan(600);
    expect(digest).toContain('digest truncated');
  });

  it('keeps only file references that really exist', () => {
    const body = 'Look at `src/lib/db.ts` and `src/does/not/exist.ts` and `formatCurrency`.';
    const section = toInsightSection(analysis, 'overview', body, 'test-model');
    expect(section.references.map((r) => r.path)).toEqual(['src/lib/db.ts']);
    expect(unverifiedReferences(analysis, body)).toEqual(['src/does/not/exist.ts']);
  });

  it('falls back to the deterministic section title', () => {
    const section = toInsightSection(analysis, 'overview', 'Body text.', 'test-model');
    expect(section.title).toBe('Architecture overview');
    expect(section.body).toBe('Body text.');
  });
});
