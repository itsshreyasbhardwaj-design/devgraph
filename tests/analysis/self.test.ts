import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SourceFile } from '@/lib/core/types';
import { analyzeRepository } from '@/lib/analysis/pipeline';
import { MAINTAINABILITY_THRESHOLDS } from '@/lib/parsing/complexity';

/**
 * Self-analysis.
 *
 * DevGraph should be able to read DevGraph. This is the broadest smoke test in
 * the suite: it runs the whole pipeline over a real, multi-hundred-file
 * TypeScript codebase and asserts the structural facts we know to be true about
 * this repository. It catches the class of regression where every unit test
 * passes but the pipeline silently stops producing edges.
 */

const ROOT = resolve(__dirname, '..', '..');
const SKIP = new Set([
  'node_modules',
  '.git',
  '.next',
  'coverage',
  'test-results',
  'playwright-report',
]);

function collectFiles(): SourceFile[] {
  const files: SourceFile[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = statSync(full);
      if (info.size > 1_000_000) continue;
      try {
        files.push({
          path: relative(ROOT, full).split(sep).join('/'),
          content: readFileSync(full, 'utf8'),
          bytes: info.size,
        });
      } catch {
        // Unreadable or non-UTF8; the pipeline would skip it anyway.
      }
    }
  };

  walk(ROOT);
  return files;
}

describe('DevGraph analysing itself', () => {
  it('produces a coherent analysis of its own source', async () => {
    const result = await analyzeRepository({
      id: 'self-analysis',
      source: { kind: 'local', label: 'devgraph' },
      files: collectFiles(),
    });

    // -- scale ------------------------------------------------------------
    expect(result.metrics.totals.analysedFiles).toBeGreaterThan(40);
    expect(result.metrics.totals.code).toBeGreaterThan(5_000);
    expect(result.metrics.totals.symbols).toBeGreaterThan(300);

    // -- stack ------------------------------------------------------------
    const detected = result.stack.findings.map((finding) => finding.name);
    expect(result.stack.primaryLanguage).toBe('typescript');
    expect(detected).toContain('Next.js');
    expect(detected).toContain('React');
    expect(detected).toContain('TypeScript');
    expect(detected).toContain('Tailwind CSS');
    expect(detected).toContain('Vitest');
    expect(detected).toContain('Playwright');
    expect(detected).toContain('pnpm');
    expect(detected).toContain('GitHub Actions');

    // -- resolution -------------------------------------------------------
    // The `@/*` alias must resolve, or the whole import graph collapses.
    const imports = result.graphs.imports;
    expect(imports).toBeDefined();
    expect(imports!.edges.length).toBeGreaterThan(60);

    const pipelineImportsParsers = imports!.edges.some(
      (edge) =>
        edge.source === 'src/lib/analysis/pipeline.ts' &&
        edge.target === 'src/lib/parsing/index.ts',
    );
    expect(pipelineImportsParsers).toBe(true);

    // -- structure --------------------------------------------------------
    // The layering rule the project documents should be visible in the graph:
    // nothing under lib/ depends on app/ or components/.
    const violations = imports!.edges.filter(
      (edge) =>
        edge.source.startsWith('src/lib/') &&
        (edge.target.startsWith('src/app/') || edge.target.startsWith('src/components/')),
    );
    expect(violations.map((edge) => `${edge.source} → ${edge.target}`)).toEqual([]);

    // -- extraction -------------------------------------------------------
    const routes = result.apis.map((route) => `${route.method} ${route.path}`);
    expect(routes).toContain('GET /api/health');
    expect(routes).toContain('POST /api/analyze');
    expect(routes).toContain('POST /api/insights');

    const envNames = result.env.map((entry) => entry.name);
    expect(envNames).toContain('OPENROUTER_API_KEY');
    expect(envNames).toContain('DATABASE_URL');

    // -- views ------------------------------------------------------------
    expect(result.graphs.classes!.nodes.length).toBeGreaterThan(5);
    expect(result.graphs.calls!.nodes.length).toBeGreaterThan(20);
    expect(result.graphs.components!.nodes.length).toBeGreaterThan(10);
    expect(result.graphs.folders!.nodes.length).toBeGreaterThan(50);

    // -- health -----------------------------------------------------------
    // These are assertions about this codebase, not about the analyser. If a
    // change makes one fail, that is a signal worth reading.
    expect(result.cycles).toEqual([]);
    expect(result.metrics.maintainability.average).toBeGreaterThan(MAINTAINABILITY_THRESHOLDS.good);
    expect(result.metrics.duplication.ratio).toBeLessThan(0.15);
  }, 60_000);
});
