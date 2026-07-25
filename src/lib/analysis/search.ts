import type {
  ApiRoute,
  DbSchema,
  DependencyRecord,
  EnvVarRecord,
  FileRecord,
  GraphKind,
  ParsedFile,
  SearchEntry,
  SearchEntryKind,
} from '@/lib/core/types';
import { basename, dirname, moduleKeyFor } from '@/lib/core/paths';

/**
 * Search index construction.
 *
 * Every entry carries the graph node ids it maps to, so selecting a result can
 * focus the right node in whichever view the user is looking at.
 */

export interface SearchIndexInput {
  files: FileRecord[];
  parsed: Map<string, ParsedFile>;
  apis: ApiRoute[];
  schema: DbSchema;
  env: EnvVarRecord[];
  dependencies: DependencyRecord[];
}

const SYMBOL_KIND_MAP: Partial<Record<string, SearchEntryKind>> = {
  class: 'class',
  struct: 'class',
  interface: 'interface',
  trait: 'interface',
  enum: 'class',
  function: 'function',
  method: 'method',
  component: 'component',
  hook: 'function',
};

export function buildSearchIndex(input: SearchIndexInput): SearchEntry[] {
  const entries: SearchEntry[] = [];
  const directories = new Set<string>();

  const push = (
    id: string,
    label: string,
    kind: SearchEntryKind,
    targets: { graph: GraphKind; nodeId: string }[],
    extra: { path?: string; line?: number; detail?: string; keywords?: string[] } = {},
  ) => {
    entries.push({
      id,
      label,
      kind,
      path: extra.path,
      line: extra.line,
      detail: extra.detail,
      targets,
      haystack: [label, extra.path ?? '', extra.detail ?? '', ...(extra.keywords ?? [])]
        .join(' ')
        .toLowerCase(),
    });
  };

  for (const file of input.files) {
    push(
      `search:file:${file.path}`,
      file.name,
      'file',
      [
        { graph: 'imports', nodeId: file.path },
        { graph: 'folders', nodeId: `file:${file.path}` },
      ],
      {
        path: file.path,
        detail: `${file.loc.total.toLocaleString()} lines · complexity ${file.complexity}`,
        keywords: [file.language, moduleKeyFor(file.path)],
      },
    );
    if (file.dir && file.dir !== '.') directories.add(file.dir);
  }

  for (const dir of directories) {
    push(
      `search:dir:${dir}`,
      basename(dir) || dir,
      'folder',
      [
        { graph: 'folders', nodeId: `dir:${dir}` },
        { graph: 'modules', nodeId: `mod:${moduleKeyFor(`${dir}/x`)}` },
      ],
      { path: dir, detail: dirname(dir) || 'root' },
    );
  }

  for (const parsed of input.parsed.values()) {
    for (const symbol of parsed.symbols) {
      const kind = SYMBOL_KIND_MAP[symbol.kind];
      if (!kind) continue;
      const targets: { graph: GraphKind; nodeId: string }[] = [];
      if (['class', 'interface'].includes(kind))
        targets.push({ graph: 'classes', nodeId: symbol.id });
      if (['function', 'method', 'component'].includes(kind)) {
        targets.push({ graph: 'calls', nodeId: symbol.id });
      }
      if (kind === 'component') targets.push({ graph: 'components', nodeId: symbol.id });
      targets.push({ graph: 'imports', nodeId: parsed.path });

      push(
        `search:symbol:${symbol.id}`,
        symbol.container ? `${symbol.container}.${symbol.name}` : symbol.name,
        kind,
        targets,
        {
          path: parsed.path,
          line: symbol.line,
          detail: `${symbol.kind} · ${symbol.loc} lines · complexity ${symbol.complexity}`,
          keywords: [symbol.container ?? '', ...(symbol.decorators ?? [])],
        },
      );
    }
  }

  for (const route of input.apis) {
    push(
      `search:route:${route.id}`,
      `${route.method} ${route.path}`,
      'route',
      [
        { graph: 'api', nodeId: route.id },
        { graph: 'imports', nodeId: route.file },
      ],
      {
        path: route.file,
        line: route.line,
        detail: `${route.framework} · ${route.style}`,
        keywords: [route.handler ?? ''],
      },
    );
  }

  for (const table of input.schema.tables) {
    push(`search:table:${table.id}`, table.name, 'table', [{ graph: 'schema', nodeId: table.id }], {
      path: table.file,
      line: table.line,
      detail: `${table.columns.length} columns · ${table.source}`,
      keywords: table.columns.map((c) => c.name),
    });
    for (const column of table.columns) {
      push(
        `search:column:${table.id}:${column.name}`,
        `${table.name}.${column.name}`,
        'column',
        [{ graph: 'schema', nodeId: table.id }],
        { path: table.file, detail: column.type },
      );
    }
  }

  for (const variable of input.env) {
    push(
      `search:env:${variable.name}`,
      variable.name,
      'env',
      [{ graph: 'env', nodeId: `env:${variable.name}` }],
      {
        detail: `${variable.usages.length} usages${variable.sensitive ? ' · sensitive' : ''}`,
        keywords: variable.usages.slice(0, 5).map((u) => u.path),
      },
    );
  }

  for (const dependency of input.dependencies) {
    push(
      `search:dep:${dependency.ecosystem}:${dependency.name}`,
      dependency.name,
      'dependency',
      [{ graph: 'modules', nodeId: `pkg:${dependency.name}` }],
      {
        detail: `${dependency.kind} · ${dependency.ecosystem}${dependency.version ? ` · ${dependency.version}` : ''}`,
      },
    );
  }

  return entries;
}

export interface SearchHit {
  entry: SearchEntry;
  score: number;
}

/**
 * Ranked substring search. Exact and prefix matches on the label outrank path
 * matches, so typing `Button` finds the component before `ButtonGroup.test.ts`.
 */
export function searchIndex(entries: SearchEntry[], query: string, limit = 40): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const label = entry.label.toLowerCase();
    let score = 0;

    if (label === needle) score = 1000;
    else if (label.startsWith(needle)) score = 800 - label.length;
    else if (label.includes(needle)) score = 600 - label.indexOf(needle);
    else if (entry.haystack.includes(needle))
      score = 300 - Math.min(200, entry.haystack.indexOf(needle));
    else {
      const fuzzy = subsequenceScore(label, needle);
      if (fuzzy > 0) score = fuzzy;
    }

    if (score <= 0) continue;
    // Prefer structural results over raw files when scores are close.
    if (entry.kind !== 'file' && entry.kind !== 'folder') score += 25;
    hits.push({ entry, score });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.entry.label.length - b.entry.label.length)
    .slice(0, limit);
}

/** Cheap camelCase-friendly subsequence match: `gsi` matches `getSearchIndex`. */
function subsequenceScore(haystack: string, needle: string): number {
  let index = 0;
  let score = 0;
  let lastMatch = -1;
  for (const char of needle) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return 0;
    score += found === lastMatch + 1 ? 12 : 4;
    lastMatch = found;
    index = found + 1;
  }
  return Math.max(1, score - haystack.length / 10);
}
