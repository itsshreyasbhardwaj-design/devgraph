import type {
  AnalysisResult,
  InsightReference,
  InsightReport,
  InsightSection,
  ParsedFile,
  StackFinding,
} from '@/lib/core/types';
import { moduleKeyFor } from '@/lib/core/paths';
import type { ResolvedFileEdge } from '@/lib/graph/builders';

/**
 * Deterministic architecture insights.
 *
 * These are computed directly from the analysis — no model, no network, no API
 * key — so DevGraph always explains a repository even with AI disabled. When an
 * OpenRouter key is configured the LLM layer *refines* these sections rather
 * than replacing them, which keeps every claim anchored to real files.
 */

export type InsightInput = Omit<AnalysisResult, 'insights' | 'durationMs'> & {
  parsed: Map<string, ParsedFile>;
  fileEdges: ResolvedFileEdge[];
};

export function buildHeuristicInsights(input: InsightInput): InsightReport {
  const sections: InsightSection[] = [
    overviewSection(input),
    modulesSection(input),
    entryPointsSection(input),
    authFlowSection(input),
    apiLifecycleSection(input),
    dataFlowSection(input),
    stateManagementSection(input),
    dependenciesSection(input),
    performanceSection(input),
    technicalDebtSection(input),
    improvementsSection(input),
  ];

  return {
    generatedBy: 'heuristic',
    generatedAt: new Date().toISOString(),
    sections,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findingsOf(input: InsightInput, category: StackFinding['category']): StackFinding[] {
  return input.stack.findings.filter((f) => f.category === category);
}

function nameList(findings: StackFinding[], limit = 4): string {
  const names = findings.slice(0, limit).map((f) => (f.version ? `${f.name} ${f.version}` : f.name));
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function ref(path: string, line?: number, note?: string): InsightReference {
  return { path, line, note };
}

function bullets(items: string[]): string {
  return items.filter(Boolean).map((item) => `- ${item}`).join('\n');
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function code(text: string): string {
  return `\`${text}\``;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function overviewSection(input: InsightInput): InsightSection {
  const { metrics, stack, repo } = input;
  const frameworks = findingsOf(input, 'framework');
  const languages = stack.languages.filter((l) => l.share > 0.02);
  const primary = languages[0];

  const shape = classifyShape(input);

  const body = [
    `**${repo.name}** is ${shape.article} ${shape.label} of ${metrics.totals.analysedFiles.toLocaleString()} analysed source files (${metrics.totals.code.toLocaleString()} lines of code across ${metrics.totals.files.toLocaleString()} files in total).`,
    '',
    bullets([
      primary
        ? `**Primary language** — ${labelOf(primary.language)} at ${pct(primary.share)} of the codebase${languages[1] ? `, followed by ${labelOf(languages[1].language)} at ${pct(languages[1].share)}` : ''}.`
        : '',
      frameworks.length
        ? `**Frameworks** — ${nameList(frameworks)}.`
        : '**Frameworks** — no mainstream framework signature detected; this reads as a library or a bespoke stack.',
      `**Structure** — ${input.metrics.coupling.modules.length} top-level modules, ${input.fileEdges.length.toLocaleString()} internal import edges, ${input.dependencies.length} declared dependencies.`,
      `**Health at a glance** — average maintainability ${metrics.maintainability.average}/100, average complexity ${metrics.complexity.average} per file, ${input.cycles.length} circular dependenc${input.cycles.length === 1 ? 'y' : 'ies'}.`,
      stack.monorepo ? `**Monorepo** — ${stack.workspaces.length} workspace packages detected.` : '',
    ]),
    '',
    shape.detail,
  ].join('\n');

  return {
    topic: 'overview',
    title: 'Architecture overview',
    summary: `${shape.label} · ${primary ? labelOf(primary.language) : 'mixed'} · ${metrics.totals.code.toLocaleString()} LOC`,
    body,
    references: input.entryPoints.slice(0, 3).map((e) => ref(e.path, undefined, e.reason)),
    confidence: frameworks.length ? 'high' : 'medium',
  };
}

function classifyShape(input: InsightInput): {
  label: string;
  article: string;
  detail: string;
} {
  const frameworks = findingsOf(input, 'framework').map((f) => f.name);
  const hasUi = frameworks.some((f) =>
    ['React', 'Vue', 'Angular', 'Svelte', 'SvelteKit', 'Next.js', 'Nuxt', 'Remix', 'SolidJS', 'Astro'].includes(f),
  );
  const hasServer = input.apis.length > 0;
  const hasDb = input.schema.tables.length > 0;

  if (input.stack.monorepo) {
    return {
      label: 'monorepo',
      article: 'a',
      detail:
        'Work spans multiple workspace packages, so dependency direction between packages matters more than file-level structure. The **Module dependencies** view is the fastest way to see whether the package boundaries are holding.',
    };
  }
  if (hasUi && hasServer && hasDb) {
    return {
      label: 'full-stack application',
      article: 'a',
      detail:
        'UI, HTTP surface and persistence all live in this repository. The **API routes** and **Database schema** views show the two ends of the request path; the **Import graph** shows what sits between them.',
    };
  }
  if (hasUi) {
    return {
      label: 'front-end application',
      article: 'a',
      detail:
        'The **Component hierarchy** view is the natural entry point: it shows which components compose which, and where the tree gets deep enough to be worth flattening.',
    };
  }
  if (hasServer || hasDb) {
    return {
      label: 'back-end service',
      article: 'a',
      detail:
        'Start with **API routes** to see the external surface, then follow the **Call graph** inward to the persistence layer.',
    };
  }
  return {
    label: 'library or toolkit',
    article: 'a',
    detail:
      'No HTTP surface or UI framework was detected, which usually means this code is consumed as a dependency. The **Module dependencies** view shows the public shape; anything with high fan-in is effectively part of your API contract.',
  };
}

function modulesSection(input: InsightInput): InsightSection {
  const modules = [...input.metrics.coupling.modules]
    .sort((a, b) => b.files - a.files)
    .slice(0, 10);

  const rows = modules.map((module) => {
    const cohesionNote =
      module.cohesion >= 1.5
        ? 'cohesive'
        : module.cohesion >= 0.5
          ? 'loosely knit'
          : 'barely self-referential';
    const stabilityNote =
      module.instability > 0.75
        ? 'highly unstable (depends on much, is depended on by little)'
        : module.instability < 0.25
          ? 'stable (many modules depend on it)'
          : 'balanced';
    return `| ${code(module.module)} | ${module.files} | ${module.internalEdges} | ${module.incoming} / ${module.outgoing} | ${module.cohesion} (${cohesionNote}) | ${module.instability} — ${stabilityNote} |`;
  });

  const table = [
    '| Module | Files | Internal edges | In / Out | Cohesion | Instability |',
    '| --- | ---: | ---: | ---: | --- | --- |',
    ...rows,
  ].join('\n');

  const stable = modules.filter((m) => m.instability < 0.3 && m.incoming > 2);
  const unstable = modules.filter((m) => m.instability > 0.8 && m.files > 2);

  const body = [
    `The codebase splits into ${input.metrics.coupling.modules.length} modules. The ten largest:`,
    '',
    table,
    '',
    '**How to read this**',
    '',
    bullets([
      '*Cohesion* is internal references per file — how much a module talks to itself. Low cohesion in a large module usually means it is a folder, not a module.',
      '*Instability* is outgoing ÷ (incoming + outgoing). Stable modules should be the ones you change least; unstable ones should be the ones you change most.',
    ]),
    '',
    stable.length
      ? `${nameList(stable.map((m) => ({ name: m.module }) as StackFinding), 3)} ${stable.length === 1 ? 'is a stable core' : 'are stable cores'} — changes there ripple widely, so they deserve the strongest tests.`
      : '',
    unstable.length
      ? `${nameList(unstable.map((m) => ({ name: m.module }) as StackFinding), 3)} ${unstable.length === 1 ? 'sits' : 'sit'} at the volatile edge of the graph, which is exactly where fast-changing code belongs.`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    topic: 'modules',
    title: 'Major modules',
    summary: `${input.metrics.coupling.modules.length} modules · avg fan-out ${input.metrics.coupling.averageFanOut}`,
    body,
    references: modules.slice(0, 5).map((m) => ref(m.module, undefined, `${m.files} files`)),
    confidence: 'high',
  };
}

function entryPointsSection(input: InsightInput): InsightSection {
  const entries = input.entryPoints.slice(0, 12);

  const body = entries.length
    ? [
        'Execution starts here. Reading these files first is the fastest way to build a mental model of the system.',
        '',
        bullets(
          entries.map(
            (entry) =>
              `${code(entry.path)} — ${entry.reason} *(${entry.kind}, ${Math.round(entry.confidence * 100)}% confidence)*`,
          ),
        ),
      ].join('\n')
    : 'No conventional entry point was detected. That normally means the repository is a library consumed through its package exports rather than a runnable application.';

  return {
    topic: 'entry-points',
    title: 'Entry points',
    summary: entries.length ? `${entries.length} entry points` : 'No entry points detected',
    body,
    references: entries.map((entry) => ref(entry.path, undefined, entry.reason)),
    confidence: entries.length ? 'high' : 'low',
  };
}

function authFlowSection(input: InsightInput): InsightSection {
  const authFindings = findingsOf(input, 'auth');
  const authFiles = [...input.parsed.values()]
    .filter((file) =>
      /(auth|session|login|signin|signup|token|jwt|oauth|permission|rbac|guard|middleware)/i.test(file.path),
    )
    .sort((a, b) => b.symbols.length - a.symbols.length)
    .slice(0, 10);

  const authRoutes = input.apis.filter((route) =>
    /(auth|login|logout|signin|signup|session|token|oauth|callback|register|password)/i.test(route.path),
  );

  const guards = [...input.parsed.values()]
    .flatMap((file) =>
      file.symbols
        .filter((symbol) =>
          /^(require|ensure|assert|verify|check|with|protect|authorize|authenticate)/i.test(symbol.name) &&
          /(auth|user|session|token|permission|role|admin)/i.test(symbol.name),
        )
        .map((symbol) => ({ path: file.path, symbol })),
    )
    .slice(0, 8);

  const authSecrets = input.env.filter((v) =>
    /(AUTH|JWT|SESSION|CLERK|SUPABASE|OAUTH|CLIENT_SECRET|NEXTAUTH|TOKEN)/i.test(v.name),
  );

  if (!authFindings.length && !authFiles.length && !authRoutes.length) {
    return {
      topic: 'auth-flow',
      title: 'Authentication flow',
      summary: 'No authentication layer detected',
      body:
        'No authentication library, auth-shaped route, or guard function was found. If this service is exposed publicly, that is worth confirming deliberately rather than by omission.',
      references: [],
      confidence: 'low',
    };
  }

  const body = [
    authFindings.length
      ? `Authentication is handled by **${nameList(authFindings)}**.`
      : 'Authentication appears to be hand-rolled rather than provided by a known library.',
    '',
    authRoutes.length
      ? `**Auth endpoints**\n\n${bullets(authRoutes.slice(0, 10).map((r) => `${code(`${r.method} ${r.path}`)} — ${r.file}:${r.line}`))}`
      : '',
    '',
    guards.length
      ? `**Enforcement points** — functions that gate access:\n\n${bullets(guards.map((g) => `${code(g.symbol.name)} in ${g.path}:${g.symbol.line}`))}`
      : '',
    '',
    authFiles.length
      ? `**Where the logic lives**\n\n${bullets(authFiles.slice(0, 6).map((f) => `${code(f.path)} — ${f.symbols.length} symbols`))}`
      : '',
    '',
    authSecrets.length
      ? `**Configuration** — ${authSecrets.map((v) => code(v.name)).join(', ')}.`
      : '',
    authSecrets.some((v) => v.clientExposed && v.sensitive)
      ? '\n> ⚠️ At least one auth-related variable carries a client-exposed prefix. Bundlers inline those into browser JavaScript.'
      : '',
  ]
    .filter((part) => part.trim())
    .join('\n');

  return {
    topic: 'auth-flow',
    title: 'Authentication flow',
    summary: authFindings.length ? nameList(authFindings, 2) : 'Custom authentication',
    body,
    references: [
      ...authFiles.slice(0, 4).map((f) => ref(f.path)),
      ...authRoutes.slice(0, 4).map((r) => ref(r.file, r.line, `${r.method} ${r.path}`)),
    ],
    confidence: authFindings.length ? 'high' : 'medium',
  };
}

function apiLifecycleSection(input: InsightInput): InsightSection {
  const { apis } = input;
  if (!apis.length) {
    return {
      topic: 'api-lifecycle',
      title: 'API lifecycle',
      summary: 'No HTTP surface detected',
      body: 'No route registrations or convention-based route files were found, so this repository most likely does not expose an HTTP API directly.',
      references: [],
      confidence: 'medium',
    };
  }

  const byFramework = new Map<string, number>();
  const byMethod = new Map<string, number>();
  for (const route of apis) {
    byFramework.set(route.framework, (byFramework.get(route.framework) ?? 0) + 1);
    byMethod.set(route.method, (byMethod.get(route.method) ?? 0) + 1);
  }

  const middlewareFiles = [...input.parsed.values()]
    .filter((f) => /middleware|interceptor|filter|pipeline|guard/i.test(f.path))
    .slice(0, 6);

  const validation = findingsOf(input, 'api-style');
  const writeRoutes = apis.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method));

  const body = [
    `${apis.length} endpoints are registered across ${byFramework.size} router${byFramework.size === 1 ? '' : 's'}.`,
    '',
    `**By framework** — ${[...byFramework.entries()].map(([name, count]) => `${name} (${count})`).join(', ')}.`,
    '',
    `**By method** — ${[...byMethod.entries()].sort((a, b) => b[1] - a[1]).map(([method, count]) => `${method} ${count}`).join(' · ')}. ${writeRoutes.length} of them mutate state.`,
    '',
    validation.length ? `**Protocols** — ${nameList(validation)}.` : '',
    '',
    middlewareFiles.length
      ? `**Request pipeline** — cross-cutting handling appears in:\n\n${bullets(middlewareFiles.map((f) => code(f.path)))}`
      : '**Request pipeline** — no dedicated middleware layer was found, so cross-cutting concerns are probably repeated per handler.',
    '',
    '**A typical request**',
    '',
    bullets([
      'The router matches the path and method and selects a handler.',
      middlewareFiles.length
        ? 'Middleware runs first — authentication, logging and validation are the usual occupants.'
        : 'With no middleware layer, each handler is responsible for its own auth and validation checks.',
      input.schema.tables.length
        ? `The handler reaches persistence through ${input.schema.dialect}.`
        : 'The handler resolves without touching a detected persistence layer.',
      'The response is serialised back through the same router.',
    ]),
  ]
    .filter((part) => part.trim())
    .join('\n');

  return {
    topic: 'api-lifecycle',
    title: 'API lifecycle',
    summary: `${apis.length} endpoints · ${[...byFramework.keys()][0] ?? 'mixed'}`,
    body,
    references: apis.slice(0, 6).map((r) => ref(r.file, r.line, `${r.method} ${r.path}`)),
    confidence: 'high',
  };
}

function dataFlowSection(input: InsightInput): InsightSection {
  const { schema } = input;
  const orms = findingsOf(input, 'orm');
  const databases = findingsOf(input, 'database');

  const dataAccessFiles = [...input.parsed.values()]
    .filter((f) => /(repositor|dao|models?|store|queries|db|database|prisma|drizzle|entities)/i.test(f.path))
    .sort((a, b) => b.symbols.length - a.symbols.length)
    .slice(0, 8);

  const hottest = [...schema.tables]
    .sort((a, b) => b.columns.length - a.columns.length)
    .slice(0, 6);

  const body = [
    databases.length
      ? `Persistence runs on **${nameList(databases)}**${orms.length ? `, accessed through **${nameList(orms)}**` : ''}.`
      : orms.length
        ? `Data access goes through **${nameList(orms)}**.`
        : 'No database or ORM signature was detected.',
    '',
    schema.tables.length
      ? `**${schema.tables.length} tables** were extracted from ${schema.dialect}, with ${schema.relations.length} foreign-key relationships.\n\n${bullets(
          hottest.map((t) => `${code(t.name)} — ${t.columns.length} columns (${t.file}:${t.line})`),
        )}`
      : '',
    '',
    dataAccessFiles.length
      ? `**Data access layer**\n\n${bullets(dataAccessFiles.map((f) => `${code(f.path)} — ${f.symbols.length} symbols`))}`
      : '',
    '',
    '**Flow**',
    '',
    bullets([
      input.apis.length ? 'Requests enter through the routes listed under *API lifecycle*.' : 'Callers enter through the public module exports.',
      dataAccessFiles.length
        ? 'Handlers delegate to the data-access modules above rather than issuing queries inline — worth preserving.'
        : 'No dedicated data-access layer was found, which usually means queries are written inline in handlers. That makes swapping the datastore expensive.',
      schema.relations.length
        ? `Relationships are declared in the schema (${schema.relations.length} foreign keys), so referential integrity is enforced by the database rather than by application code.`
        : 'No foreign keys were declared, so relational integrity depends on application logic.',
    ]),
  ]
    .filter((part) => part.trim())
    .join('\n');

  return {
    topic: 'data-flow',
    title: 'Data flow',
    summary: schema.tables.length ? `${schema.tables.length} tables · ${schema.dialect}` : 'No schema detected',
    body,
    references: [
      ...hottest.slice(0, 4).map((t) => ref(t.file, t.line, t.name)),
      ...dataAccessFiles.slice(0, 3).map((f) => ref(f.path)),
    ],
    confidence: schema.tables.length ? 'high' : 'low',
  };
}

function stateManagementSection(input: InsightInput): InsightSection {
  const stateFindings = findingsOf(input, 'state-management');
  const components = [...input.parsed.values()].flatMap((f) =>
    f.symbols.filter((s) => s.kind === 'component').map((s) => ({ path: f.path, symbol: s })),
  );
  const hooks = [...input.parsed.values()].flatMap((f) =>
    f.symbols.filter((s) => s.kind === 'hook').map((s) => ({ path: f.path, symbol: s })),
  );

  if (!stateFindings.length && !components.length) {
    return {
      topic: 'state-management',
      title: 'State management',
      summary: 'Not applicable',
      body: 'No UI components or client state libraries were detected, so there is no client-side state layer to describe.',
      references: [],
      confidence: 'medium',
    };
  }

  const stores = [...input.parsed.values()]
    .filter((f) => /(store|context|provider|reducer|atom|slice|state)/i.test(f.path))
    .slice(0, 8);

  const body = [
    stateFindings.length
      ? `State is managed with **${nameList(stateFindings)}**.`
      : 'No dedicated state library was found — state is most likely held in component-local hooks and React context.',
    '',
    `The UI contains **${components.length} components** and **${hooks.length} custom hooks**.`,
    hooks.length
      ? `\n\nCustom hooks are where shared behaviour tends to accumulate:\n\n${bullets(
          hooks
            .sort((a, b) => b.symbol.loc - a.symbol.loc)
            .slice(0, 6)
            .map((h) => `${code(h.symbol.name)} — ${h.path}:${h.symbol.line} (${h.symbol.loc} lines)`),
        )}`
      : '',
    '',
    stores.length
      ? `**Stores and providers**\n\n${bullets(stores.map((f) => code(f.path)))}`
      : '',
    '',
    components.length > 0 && !stateFindings.length
      ? '> With no external store, prop drilling is the failure mode to watch for. The **Component hierarchy** view makes deep chains obvious.'
      : '',
  ]
    .filter((part) => part.trim())
    .join('\n');

  return {
    topic: 'state-management',
    title: 'State management',
    summary: stateFindings.length ? nameList(stateFindings, 2) : `${components.length} components`,
    body,
    references: [...stores.slice(0, 3).map((f) => ref(f.path)), ...hooks.slice(0, 3).map((h) => ref(h.path, h.symbol.line, h.symbol.name))],
    confidence: stateFindings.length ? 'high' : 'medium',
  };
}

function dependenciesSection(input: InsightInput): InsightSection {
  const runtime = input.dependencies.filter((d) => d.kind === 'runtime');
  const dev = input.dependencies.filter((d) => d.kind === 'dev');
  const used = [...input.dependencies].sort((a, b) => b.usedBy - a.usedBy).slice(0, 10);
  const unused = input.dependencies.filter((d) => d.kind === 'runtime' && d.usedBy === 0);

  const heaviest = [...input.metrics.coupling.mostDependedUpon].slice(0, 8);

  const body = [
    `${input.dependencies.length} declared dependencies (${runtime.length} runtime, ${dev.length} dev) across ${new Set(input.dependencies.map((d) => d.ecosystem)).size} ecosystem(s).`,
    '',
    used.length
      ? `**Most-used external packages**\n\n${bullets(used.filter((d) => d.usedBy > 0).map((d) => `${code(d.name)} — imported by ${d.usedBy} files`))}`
      : '',
    '',
    heaviest.length
      ? `**Internal hubs** — files the rest of the codebase leans on hardest:\n\n${bullets(
          heaviest.map((f) => `${code(f.path)} — ${f.fanIn} importers, instability ${f.instability}`),
        )}\n\nThese are the highest-leverage files to keep well-tested: a regression here propagates everywhere.`
      : '',
    '',
    unused.length
      ? `**${unused.length} runtime dependencies were never imported** in analysed source: ${unused.slice(0, 8).map((d) => code(d.name)).join(', ')}. Some will be used by config or build tooling rather than code, so verify before removing.`
      : '',
    '',
    input.cycles.length
      ? `**${input.cycles.length} circular dependenc${input.cycles.length === 1 ? 'y' : 'ies'}** were found; the largest spans ${input.cycles[0].files.length} files. See the *Circular dependencies* view.`
      : '**No circular dependencies** — the import graph is acyclic, which keeps builds incremental and modules independently testable.',
  ]
    .filter((part) => part.trim())
    .join('\n');

  return {
    topic: 'dependencies',
    title: 'Dependency structure',
    summary: `${input.dependencies.length} declared · ${input.cycles.length} cycles`,
    body,
    references: heaviest.slice(0, 5).map((f) => ref(f.path, undefined, `${f.fanIn} importers`)),
    confidence: 'high',
  };
}

function performanceSection(input: InsightInput): InsightSection {
  const { metrics } = input;
  const deepNesting = metrics.complexity.hotspots.filter((h) => h.maxNesting >= 4).slice(0, 6);
  const bigFiles = metrics.size.largestFiles.slice(0, 6);

  const asyncHeavy = [...input.parsed.values()]
    .map((file) => ({
      path: file.path,
      awaits: file.symbols.filter((s) => s.isAsync).length,
    }))
    .filter((entry) => entry.awaits >= 5)
    .sort((a, b) => b.awaits - a.awaits)
    .slice(0, 5);

  const barrels = [...input.parsed.values()]
    .filter((f) => /(^|\/)index\.(ts|js|tsx|jsx)$/.test(f.path) && f.imports.filter((i) => i.kind === 'reexport').length >= 8)
    .slice(0, 5);

  const body = [
    'These are structural performance signals — DevGraph does not execute code, so treat them as places to profile rather than confirmed bottlenecks.',
    '',
    deepNesting.length
      ? `**Deeply nested logic** (nesting ≥ 4) — hot loops hide here:\n\n${bullets(
          deepNesting.map((h) => `${code(`${h.symbol ?? h.path}`)} — ${h.path}:${h.line ?? 1}, complexity ${h.complexity}, nesting ${h.maxNesting}`),
        )}`
      : '',
    '',
    bigFiles.length
      ? `**Largest modules** — these dominate parse and bundle time:\n\n${bullets(
          bigFiles.map((f) => `${code(f.path)} — ${f.lines.toLocaleString()} lines (${(f.bytes / 1024).toFixed(0)} KB)`),
        )}`
      : '',
    '',
    barrels.length
      ? `**Barrel files** re-exporting 8+ modules:\n\n${bullets(barrels.map((f) => code(f.path)))}\n\nBarrels defeat tree-shaking in many bundlers and turn a one-symbol import into a whole-subtree load. Importing from the source module directly is usually faster.`
      : '',
    '',
    asyncHeavy.length
      ? `**Async-dense modules** — worth checking for sequential awaits that could run concurrently:\n\n${bullets(
          asyncHeavy.map((a) => `${code(a.path)} — ${a.awaits} async functions`),
        )}`
      : '',
    '',
    input.cycles.length
      ? '**Circular imports** force bundlers to keep whole cycles in one chunk, which inflates the initial payload and prevents lazy loading of any member.'
      : '',
  ]
    .filter((part) => part.trim())
    .join('\n');

  return {
    topic: 'performance',
    title: 'Performance signals',
    summary: `${deepNesting.length} deep-nesting hotspots · ${barrels.length} barrel files`,
    body,
    references: [
      ...deepNesting.slice(0, 4).map((h) => ref(h.path, h.line, h.symbol)),
      ...barrels.slice(0, 2).map((f) => ref(f.path, undefined, 'barrel file')),
    ],
    confidence: 'medium',
  };
}

function technicalDebtSection(input: InsightInput): InsightSection {
  const { debt } = input.metrics;

  const body = [
    `**Debt score: ${debt.score}/100** (lower is better). This is the sum of the weighted signals below — every contributor is listed, so the number is auditable.`,
    '',
    debt.signals.length
      ? debt.signals
          .map((signal) => {
            const icon = { high: '🔴', medium: '🟠', low: '🟡', info: '🔵' }[signal.severity];
            const files = signal.files.length
              ? `\n\n  ${signal.files.slice(0, 5).map((f) => code(f)).join(', ')}`
              : '';
            return `${icon} **${signal.title}**\n\n  ${signal.detail}${files}`;
          })
          .join('\n\n')
      : 'No debt signals crossed their thresholds. That is unusual and worth preserving.',
    '',
    debt.markers.length
      ? `**${debt.markers.length} debt markers** are left in comments:\n\n${bullets(
          debt.markers.slice(0, 8).map((m) => `${code(m.tag)} ${m.path}:${m.line} — ${m.text || '(no description)'}`),
        )}`
      : '',
  ]
    .filter((part) => part.trim())
    .join('\n');

  return {
    topic: 'technical-debt',
    title: 'Technical debt',
    summary: `Score ${debt.score}/100 · ${debt.signals.length} signals`,
    body,
    references: debt.signals.flatMap((s) => s.files.slice(0, 2).map((f) => ref(f, undefined, s.id))).slice(0, 8),
    confidence: 'high',
  };
}

function improvementsSection(input: InsightInput): InsightSection {
  const suggestions: { title: string; detail: string; files: string[]; effort: string }[] = [];
  const { metrics } = input;

  if (input.cycles.length) {
    const worst = input.cycles[0];
    suggestions.push({
      title: `Break the ${worst.files.length}-file dependency cycle`,
      detail:
        'Pick the single weakest edge in the cycle and invert it — usually by extracting the shared type or interface into its own module that both sides import. This is almost always a smaller change than it looks.',
      files: worst.files.slice(0, 4),
      effort: 'Medium',
    });
  }

  const worstComplexity = metrics.complexity.hotspots.slice(0, 3);
  if (worstComplexity.length) {
    suggestions.push({
      title: `Decompose ${worstComplexity[0].symbol ?? worstComplexity[0].path}`,
      detail: `Cyclomatic complexity ${worstComplexity[0].complexity} means roughly ${worstComplexity[0].complexity} independent paths through one function. Extracting guard clauses and pulling each branch into a named function makes the intent readable and the paths testable.`,
      files: worstComplexity.map((h) => h.path),
      effort: 'Medium',
    });
  }

  if (metrics.duplication.ratio > 0.03) {
    const clone = metrics.duplication.clones[0];
    suggestions.push({
      title: `Consolidate ${pct(metrics.duplication.ratio)} duplicated code`,
      detail: clone
        ? `The largest clone spans ${clone.lines} lines across ${clone.occurrences.length} locations. Duplicated blocks drift apart; the copies that do not get the fix become the bugs.`
        : 'Duplicated blocks drift apart over time — a fix in one copy silently misses the others.',
      files: clone?.occurrences.map((o) => o.path) ?? [],
      effort: 'Low',
    });
  }

  const untested = input.files.filter((f) => f.isTest).length;
  if (untested / Math.max(1, input.files.length) < 0.1) {
    const hubs = metrics.coupling.mostDependedUpon.slice(0, 3);
    suggestions.push({
      title: 'Add tests to the highest-fan-in modules first',
      detail: `Test coverage is thin. Rather than chasing a coverage percentage, start with the files the rest of the codebase depends on${hubs.length ? ` — ${hubs.map((h) => code(h.path)).join(', ')}` : ''}. A regression there breaks everything downstream, so those tests buy the most safety per hour spent.`,
      files: hubs.map((h) => h.path),
      effort: 'High',
    });
  }

  const bigFiles = metrics.size.largestFiles.filter((f) => f.lines > 800).slice(0, 3);
  if (bigFiles.length) {
    suggestions.push({
      title: `Split ${bigFiles.length} oversized file${bigFiles.length === 1 ? '' : 's'}`,
      detail: `${bigFiles.map((f) => `${code(f.path)} (${f.lines.toLocaleString()} lines)`).join(', ')} — files this long almost always contain several responsibilities. Splitting along the seams the call graph already shows is low risk.`,
      files: bigFiles.map((f) => f.path),
      effort: 'Low',
    });
  }

  const exposed = input.env.filter((v) => v.clientExposed && v.sensitive);
  if (exposed.length) {
    suggestions.push({
      title: 'Move client-exposed secrets server-side',
      detail: `${exposed.map((v) => code(v.name)).join(', ')} carry a public bundler prefix but look like secrets. Anything with that prefix is compiled into browser JavaScript and readable by anyone who opens devtools.`,
      files: exposed.flatMap((v) => v.usages.slice(0, 2).map((u) => u.path)),
      effort: 'Low',
    });
  }

  const lowCohesion = metrics.coupling.modules.filter((m) => m.files >= 8 && m.cohesion < 0.4).slice(0, 2);
  if (lowCohesion.length) {
    suggestions.push({
      title: `Reconsider the boundary of ${lowCohesion.map((m) => code(m.module)).join(' and ')}`,
      detail:
        'These directories hold many files that barely reference each other. That is the signature of a folder used as a dumping ground rather than a module with a purpose. Regrouping by feature usually beats regrouping by file type.',
      files: lowCohesion.map((m) => m.module),
      effort: 'Medium',
    });
  }

  const body = suggestions.length
    ? suggestions
        .map(
          (suggestion, index) =>
            `### ${index + 1}. ${suggestion.title}\n\n${suggestion.detail}\n\n**Effort:** ${suggestion.effort}${
              suggestion.files.length
                ? `  ·  **Files:** ${suggestion.files.slice(0, 4).map((f) => code(f)).join(', ')}`
                : ''
            }`,
        )
        .join('\n\n')
    : 'No high-value structural improvements surfaced. Complexity, duplication, coupling and configuration all sit within healthy bands.';

  return {
    topic: 'improvements',
    title: 'Suggested improvements',
    summary: `${suggestions.length} recommendations`,
    body,
    references: suggestions.flatMap((s) => s.files.slice(0, 2).map((f) => ref(f, undefined, s.title))).slice(0, 10),
    confidence: 'medium',
  };
}

function labelOf(language: string): string {
  const labels: Record<string, string> = {
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    csharp: 'C#',
    cpp: 'C++',
    php: 'PHP',
    sql: 'SQL',
    html: 'HTML',
    css: 'CSS',
  };
  return labels[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

/** Re-exported so callers can group insight references the same way. */
export { moduleKeyFor };
