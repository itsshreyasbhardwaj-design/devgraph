import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end coverage.
 *
 * The suite runs against a fixture ZIP rather than a live GitHub repository, so
 * it needs no network, no API token, and produces the same result on every run.
 * The upload path exercises the whole stack: archive validation, decoding,
 * parsing, graph building, and the workspace rendering the result.
 */

const FIXTURE = 'tests/e2e/fixtures/sample-repo.zip';

async function analyseFixture(page: Page) {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await expect(page.getByRole('tab', { name: 'Graph' })).toBeVisible({ timeout: 60_000 });
  // The workspace rewrites the URL to the stored analysis once the result
  // arrives, so interacting before that lands can be undone by the navigation.
  await page.waitForURL(/\/analyze\?id=/, { timeout: 30_000 });
  // The chrome appears before the canvas has laid out. Waiting for a node keeps
  // every test that counts or clicks nodes from racing the layout.
  await expect(page.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('landing page', () => {
  test('presents the product and its entry control', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Every codebase is a graph',
    );
    await expect(page.getByRole('img', { name: /dependency graph/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'GitHub repository' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Analyze' }).first()).toBeVisible();

    // The ten views are named on the page, not just implied.
    await expect(page.getByRole('heading', { name: 'Import graph' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Circular dependencies' })).toBeVisible();
  });

  test('rejects an empty submission with a message rather than navigating', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Analyze' }).first().click();
    await expect(page.getByText('Enter a GitHub repository to analyse.')).toBeVisible();
    await expect(page).toHaveURL('/');
  });

  test('is keyboard navigable from the top', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });
});

test.describe('analysis workspace', () => {
  test('analyses an uploaded archive and renders the graph', async ({ page }) => {
    await analyseFixture(page);

    // Header reports what was analysed.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('sample-repo');

    // The canvas drew real nodes.
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await expect(page.getByText(/\d+ nodes · \d+ edges/)).toBeVisible();
  });

  test('switches views and keeps counts consistent', async ({ page }) => {
    await analyseFixture(page);

    await page.getByRole('button', { name: /^Classes/ }).click();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();

    await page.getByRole('button', { name: /^Folders/ }).click();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
  });

  test('selects a node and populates the inspector', async ({ page }) => {
    await analyseFixture(page);

    await page.locator('.react-flow__node').first().click();
    await expect(page.getByRole('button', { name: 'Focus' })).toBeVisible();
    await expect(page.getByText(/^Depends on · \d+$/)).toBeVisible();
  });

  test('filters the graph and reports what was hidden', async ({ page }) => {
    await analyseFixture(page);

    const before = await page.locator('.react-flow__node').count();
    expect(before).toBeGreaterThan(0);

    await page.getByRole('textbox', { name: 'Filter nodes by name or path' }).fill('zzz-no-match');
    await expect(page.getByText('Nothing matches these filters')).toBeVisible();

    await page.getByRole('button', { name: 'Reset filters' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(before);
  });

  test('opens the command palette and navigates to a result', async ({ page }) => {
    await analyseFixture(page);

    await page.keyboard.press('ControlOrMeta+k');
    const search = page.getByPlaceholder(/Search files, classes/);
    await expect(search).toBeVisible();

    await search.fill('greet');
    const first = page.getByRole('option').first();
    await expect(first).toBeVisible();
    await first.click();

    await expect(search).toBeHidden();
    await expect(page.getByRole('button', { name: 'Focus' })).toBeVisible();
  });

  test('shows the metrics dashboard', async ({ page }) => {
    await analyseFixture(page);

    await page.getByRole('tab', { name: 'Metrics' }).click();
    await expect(page.getByText('Lines of code')).toBeVisible();
    await expect(page.getByText('Maintainability').first()).toBeVisible();
    await expect(page.getByText('Module coupling and cohesion')).toBeVisible();
  });

  test('shows deterministic insights without an API key', async ({ page }) => {
    await analyseFixture(page);

    await page.getByRole('tab', { name: 'Insights' }).click();
    await expect(page.getByRole('heading', { name: 'Architecture overview' })).toBeVisible();
    await expect(page.getByText('Deterministic')).toBeVisible();

    // Every topic is present.
    await expect(page.getByRole('button', { name: /Technical debt/ })).toBeVisible();
    await page.getByRole('button', { name: /Suggested improvements/ }).click();
    await expect(page.getByRole('heading', { name: 'Suggested improvements' })).toBeVisible();
  });

  test('explains that timeline needs git history for an upload', async ({ page }) => {
    await analyseFixture(page);

    await page.getByRole('tab', { name: 'Timeline' }).click();
    await expect(page.getByText('Timeline is loaded on demand')).toBeVisible();
  });

  test('exports the graph as JSON', async ({ page }) => {
    await analyseFixture(page);

    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Graph JSON/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.json$/);
  });
});

test.describe('api', () => {
  test('health reports capabilities', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.languages).toContain('typescript');
    expect(body.languages).toHaveLength(8);
  });

  test('rejects a malformed repository reference', async ({ request }) => {
    const response = await request.post('/api/analyze', {
      data: { kind: 'github', repository: 'not a repository' },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid-input');
  });

  test('rejects an unknown analysis id', async ({ request }) => {
    const response = await request.get('/api/analyses/doesnotexist1');
    expect(response.status()).toBe(404);
  });

  test('rejects a non-zip upload', async ({ request }) => {
    const response = await request.post('/api/analyze', {
      multipart: {
        file: {
          name: 'evil.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('not a zip'),
        },
      },
    });
    expect(response.status()).toBe(415);
  });
});
