import { beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisProgress, AnalysisResult } from '@/lib/core/types';
import { analyzeRepository } from '@/lib/analysis/pipeline';
import { searchIndex } from '@/lib/analysis/search';
import { sampleRepoFiles } from '../fixtures/sampleRepo';

let result: AnalysisResult;
const progress: AnalysisProgress[] = [];

beforeAll(async () => {
  result = await analyzeRepository({
    id: 'test-analysis',
    source: { kind: 'local', label: 'acme-shop' },
    files: sampleRepoFiles(),
    onProgress: (event) => progress.push(event),
  });
});

describe('analysis pipeline', () => {
  it('reports progress through to completion', () => {
    expect(progress.length).toBeGreaterThan(3);
    expect(progress.at(-1)?.phase).toBe('done');
    expect(progress.at(-1)?.progress).toBe(1);
  });

  it('summarises the repository', () => {
    expect(result.repo.name).toBe('acme-shop');
    expect(result.repo.license).toBe('MIT');
    expect(result.metrics.totals.files).toBeGreaterThan(20);
    expect(result.metrics.totals.analysedFiles).toBeGreaterThan(10);
    expect(result.metrics.totals.code).toBeGreaterThan(100);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('detects the stack', () => {
    const names = result.stack.findings.map((f) => f.name);
    expect(names).toContain('Next.js');
    expect(names).toContain('React');
    expect(names).toContain('Prisma');
    expect(names).toContain('PostgreSQL');
    expect(names).toContain('Clerk');
    expect(names).toContain('Zustand');
    expect(names).toContain('Tailwind CSS');
    expect(names).toContain('GitHub Actions');
    expect(names).toContain('Docker');
    expect(names).toContain('Vitest');
    expect(result.stack.primaryLanguage).toBe('typescript');
  });

  it('resolves tsconfig path aliases into real import edges', () => {
    const imports = result.graphs.imports;
    expect(imports).toBeDefined();
    const edge = imports!.edges.find(
      (e) => e.source === 'src/app/page.tsx' && e.target === 'src/components/ProductList.tsx',
    );
    expect(edge).toBeDefined();

    const service = result.files.find((f) => f.path === 'src/lib/db.ts');
    expect(service?.fanIn).toBeGreaterThanOrEqual(2);
  });

  it('finds the circular dependency between the two services', () => {
    expect(result.cycles.length).toBeGreaterThanOrEqual(1);
    const cycle = result.cycles.find(
      (c) =>
        c.files.includes('src/services/orderService.ts') &&
        c.files.includes('src/services/userService.ts'),
    );
    expect(cycle).toBeDefined();
    expect(result.graphs.cycles?.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts API routes from Next.js conventions', () => {
    const paths = result.apis.map((r) => `${r.method} ${r.path}`);
    expect(paths).toContain('GET /api/orders');
    expect(paths).toContain('POST /api/orders');
    expect(paths).toContain('GET /api/users/:id');
    expect(paths).toContain('GET /');
    expect(result.apis.every((r) => r.file && r.framework)).toBe(true);
  });

  it('extracts the Prisma schema with relations', () => {
    expect(result.schema.dialect).toContain('postgresql');
    const tables = result.schema.tables.map((t) => t.name);
    expect(tables).toContain('User');
    expect(tables).toContain('Order');
    const user = result.schema.tables.find((t) => t.name === 'User');
    expect(user?.columns.find((c) => c.name === 'id')?.primaryKey).toBe(true);
    expect(user?.columns.find((c) => c.name === 'email')?.unique).toBe(true);
    expect(result.schema.relations.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts environment variables and flags exposed secrets', () => {
    const names = result.env.map((v) => v.name);
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('CLERK_SECRET_KEY');
    expect(names).toContain('NEXT_PUBLIC_API_SECRET');

    const exposed = result.env.find((v) => v.name === 'NEXT_PUBLIC_API_SECRET');
    expect(exposed?.clientExposed).toBe(true);
    expect(exposed?.sensitive).toBe(true);
    expect(result.warnings.some((w) => w.includes('client-exposed'))).toBe(true);

    const declared = result.env.find((v) => v.name === 'DATABASE_URL');
    expect(declared?.declaredIn).toContain('.env.example');
  });

  it('identifies entry points', () => {
    const paths = result.entryPoints.map((e) => e.path);
    expect(paths).toContain('src/app/layout.tsx');
    expect(result.files.find((f) => f.path === 'src/app/layout.tsx')?.isEntryPoint).toBe(true);
  });

  it('computes complexity, maintainability and hotspots', () => {
    expect(result.metrics.complexity.max).toBeGreaterThan(5);
    expect(result.metrics.maintainability.average).toBeGreaterThan(0);
    expect(result.metrics.maintainability.average).toBeLessThanOrEqual(100);
    const hotspot = result.metrics.complexity.hotspots.find((h) => h.symbol === 'computePrice');
    expect(hotspot).toBeDefined();
    expect(hotspot!.complexity).toBeGreaterThanOrEqual(10);
  });

  it('detects the duplicated formatter', () => {
    expect(result.metrics.duplication.clones.length).toBeGreaterThanOrEqual(1);
    const clone = result.metrics.duplication.clones[0];
    expect(clone.occurrences.every((o) => o.path === 'src/lib/format.ts')).toBe(true);
    expect(result.metrics.duplication.ratio).toBeGreaterThan(0);
  });

  it('collects debt markers', () => {
    const tags = result.metrics.debt.markers.map((m) => m.tag);
    expect(tags).toContain('TODO');
    expect(tags).toContain('FIXME');
    expect(result.metrics.debt.score).toBeGreaterThan(0);
    expect(result.metrics.debt.signals.length).toBeGreaterThan(0);
  });

  it('computes module coupling and cohesion', () => {
    const modules = result.metrics.coupling.modules.map((m) => m.module);
    expect(modules).toContain('src/services');
    expect(modules).toContain('src/components');
    const services = result.metrics.coupling.modules.find((m) => m.module === 'src/services');
    expect(services?.internalEdges).toBeGreaterThanOrEqual(1);
    expect(services?.cohesion).toBeGreaterThan(0);
  });

  it('builds every graph view', () => {
    for (const kind of [
      'folders',
      'imports',
      'modules',
      'classes',
      'calls',
      'components',
      'cycles',
      'api',
      'schema',
      'env',
    ] as const) {
      expect(result.graphs[kind], kind).toBeDefined();
      expect(result.graphs[kind]!.stats.nodeCount).toBe(result.graphs[kind]!.nodes.length);
    }

    expect(result.graphs.components!.nodes.map((n) => n.label)).toContain('ProductList');
    const renders = result.graphs.components!.edges.find(
      (e) => e.source.includes('ProductList') && e.target.includes('ProductCard'),
    );
    expect(renders).toBeDefined();

    expect(result.graphs.folders!.nodes.some((n) => n.kind === 'folder')).toBe(true);
    expect(result.graphs.schema!.nodes).toHaveLength(2);
    expect(result.graphs.api!.nodes.some((n) => n.kind === 'route')).toBe(true);
  });

  it('produces a searchable index', () => {
    expect(result.searchIndex.length).toBeGreaterThan(30);
    const hits = searchIndex(result.searchIndex, 'computePrice');
    expect(hits[0].entry.label).toBe('computePrice');
    expect(hits[0].entry.path).toBe('src/lib/pricing.ts');

    const routeHits = searchIndex(result.searchIndex, '/api/orders');
    expect(routeHits.length).toBeGreaterThan(0);

    const fuzzy = searchIndex(result.searchIndex, 'prodlist');
    expect(fuzzy.length).toBeGreaterThan(0);
  });

  it('generates heuristic insights for every topic with file references', () => {
    expect(result.insights.generatedBy).toBe('heuristic');
    const topics = result.insights.sections.map((s) => s.topic);
    for (const topic of [
      'overview',
      'modules',
      'entry-points',
      'auth-flow',
      'api-lifecycle',
      'data-flow',
      'state-management',
      'dependencies',
      'performance',
      'technical-debt',
      'improvements',
    ]) {
      expect(topics).toContain(topic);
    }

    for (const section of result.insights.sections) {
      expect(section.body.length).toBeGreaterThan(40);
      expect(section.summary.length).toBeGreaterThan(0);
    }

    const auth = result.insights.sections.find((s) => s.topic === 'auth-flow');
    expect(auth?.body).toContain('Clerk');

    const improvements = result.insights.sections.find((s) => s.topic === 'improvements');
    expect(improvements?.body.toLowerCase()).toContain('cycle');
    expect(improvements!.references.length).toBeGreaterThan(0);
  });

  it('marks unused dependencies', () => {
    const unused = result.dependencies.find((d) => d.name === 'unusedpkg');
    expect(unused?.usedBy).toBe(0);
    const used = result.dependencies.find((d) => d.name === 'next');
    expect(used?.usedBy).toBeGreaterThan(0);
  });

  it('is deterministic across runs', async () => {
    const second = await analyzeRepository({
      id: 'test-analysis-2',
      source: { kind: 'local', label: 'acme-shop' },
      files: sampleRepoFiles(),
    });
    expect(second.metrics.totals).toEqual(result.metrics.totals);
    expect(second.cycles.map((c) => c.files)).toEqual(result.cycles.map((c) => c.files));
    expect(second.apis.map((a) => a.path)).toEqual(result.apis.map((a) => a.path));
  });

  it('handles an empty repository without throwing', async () => {
    const empty = await analyzeRepository({
      id: 'empty',
      source: { kind: 'local', label: 'empty' },
      files: [],
    });
    expect(empty.files).toHaveLength(0);
    expect(empty.metrics.totals.files).toBe(0);
    expect(empty.insights.sections.length).toBeGreaterThan(0);
  });
});
