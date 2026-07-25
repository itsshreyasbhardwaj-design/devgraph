import type { ApiRoute, HttpMethod, LanguageId, ParsedFile, SourceFile } from '@/lib/core/types';
import { basename, dirname } from '@/lib/core/paths';

/**
 * API route extraction.
 *
 * Two complementary strategies:
 *
 * 1. **File conventions** — Next.js, SvelteKit, Nuxt and Remix encode the route
 *    in the path, so the path itself is the source of truth.
 * 2. **Code patterns** — everything else registers routes in code. Each entry in
 *    `ROUTE_PATTERNS` describes one framework's registration syntax.
 *
 * Pattern matching runs against source text with comment-only lines stripped,
 * because route paths live inside string literals that a code mask would blank.
 */

const METHODS = new Set<HttpMethod>([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'ALL',
  'WS',
  'RPC',
]);

interface RoutePattern {
  framework: string;
  style: ApiRoute['style'];
  languages: LanguageId[];
  pattern: RegExp;
  methodGroup?: number;
  pathGroup: number;
  fixedMethod?: HttpMethod;
  /** Restrict to files whose path matches. */
  fileFilter?: RegExp;
}

const ROUTE_PATTERNS: RoutePattern[] = [
  // ---- Node / TypeScript -------------------------------------------------
  {
    framework: 'Express',
    style: 'rest',
    languages: ['javascript', 'typescript'],
    pattern:
      /\b(?:app|router|api|server)\s*\.\s*(get|post|put|patch|delete|head|options|all)\s*\(\s*(['"`])([^'"`]+)\2/gi,
    methodGroup: 1,
    pathGroup: 3,
  },
  {
    framework: 'Fastify',
    style: 'rest',
    languages: ['javascript', 'typescript'],
    pattern:
      /\b(?:fastify|app|server)\s*\.\s*route\s*\(\s*\{[^}]*?method\s*:\s*['"`](\w+)['"`][^}]*?url\s*:\s*['"`]([^'"`]+)['"`]/gi,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    framework: 'Hono',
    style: 'rest',
    languages: ['javascript', 'typescript'],
    pattern:
      /\bnew Hono\(\)[\s\S]{0,4000}?\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\2/gi,
    methodGroup: 1,
    pathGroup: 3,
  },
  {
    framework: 'NestJS',
    style: 'rest',
    languages: ['typescript'],
    pattern: /@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g,
    methodGroup: 1,
    pathGroup: 3,
  },
  {
    framework: 'tRPC',
    style: 'trpc',
    languages: ['typescript'],
    pattern: /(\w+)\s*:\s*(?:publicProcedure|protectedProcedure|procedure|t\.procedure)\b/g,
    pathGroup: 1,
    fixedMethod: 'RPC',
  },
  // ---- Python ------------------------------------------------------------
  {
    framework: 'FastAPI',
    style: 'rest',
    languages: ['python'],
    pattern: /@\w+\.(get|post|put|patch|delete|head|options|websocket)\s*\(\s*(['"])([^'"]+)\2/gi,
    methodGroup: 1,
    pathGroup: 3,
  },
  {
    framework: 'Flask',
    style: 'rest',
    languages: ['python'],
    pattern: /@\w+\.route\s*\(\s*(['"])([^'"]+)\1(?:[^)]*methods\s*=\s*\[([^\]]*)\])?/g,
    pathGroup: 2,
    methodGroup: 3,
  },
  {
    framework: 'Django',
    style: 'rest',
    languages: ['python'],
    pattern: /\b(?:path|re_path|url)\s*\(\s*(['"])([^'"]*)\1\s*,\s*([\w.]+)/g,
    pathGroup: 2,
    fixedMethod: 'ALL',
  },
  // ---- Go ----------------------------------------------------------------
  {
    framework: 'Go router',
    style: 'rest',
    languages: ['go'],
    pattern: /\b\w+\s*\.\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any)\s*\(\s*"([^"]+)"/g,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    framework: 'net/http',
    style: 'rest',
    languages: ['go'],
    pattern:
      /\b(?:http|mux|r)\s*\.\s*Handle(?:Func)?\s*\(\s*"((?:GET|POST|PUT|PATCH|DELETE)\s+)?([^"]+)"/g,
    methodGroup: 1,
    pathGroup: 2,
  },
  // ---- Rust --------------------------------------------------------------
  {
    framework: 'Actix / Rocket',
    style: 'rest',
    languages: ['rust'],
    pattern: /#\[(get|post|put|patch|delete|head|options)\s*\(\s*"([^"]+)"/gi,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    framework: 'Axum',
    style: 'rest',
    languages: ['rust'],
    pattern: /\.route\s*\(\s*"([^"]+)"\s*,\s*(get|post|put|patch|delete)\s*\(/gi,
    pathGroup: 1,
    methodGroup: 2,
  },
  // ---- JVM ---------------------------------------------------------------
  {
    framework: 'Spring',
    style: 'rest',
    languages: ['java', 'kotlin'],
    pattern: /@(Get|Post|Put|Patch|Delete)Mapping\s*\(\s*(?:value\s*=\s*)?(?:\{\s*)?"([^"]*)"/g,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    framework: 'Spring',
    style: 'rest',
    languages: ['java', 'kotlin'],
    pattern:
      /@RequestMapping\s*\(\s*(?:value\s*=\s*)?"([^"]*)"(?:[^)]*method\s*=\s*RequestMethod\.(\w+))?/g,
    pathGroup: 1,
    methodGroup: 2,
  },
  {
    framework: 'JAX-RS',
    style: 'rest',
    languages: ['java'],
    pattern: /@Path\s*\(\s*"([^"]*)"\s*\)/g,
    pathGroup: 1,
    fixedMethod: 'ALL',
  },
  // ---- .NET --------------------------------------------------------------
  {
    framework: 'ASP.NET Core',
    style: 'rest',
    languages: ['csharp'],
    pattern: /\[Http(Get|Post|Put|Patch|Delete|Head|Options)(?:\s*\(\s*"([^"]*)"\s*\))?\]/g,
    methodGroup: 1,
    pathGroup: 2,
  },
  {
    framework: 'ASP.NET Minimal API',
    style: 'rest',
    languages: ['csharp'],
    pattern: /\bapp\s*\.\s*Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"/g,
    methodGroup: 1,
    pathGroup: 2,
  },
  // ---- PHP ---------------------------------------------------------------
  {
    framework: 'Laravel',
    style: 'rest',
    languages: ['php'],
    pattern: /Route\s*::\s*(get|post|put|patch|delete|any|match)\s*\(\s*(['"])([^'"]+)\2/gi,
    methodGroup: 1,
    pathGroup: 3,
  },
  {
    framework: 'Symfony',
    style: 'rest',
    languages: ['php'],
    pattern: /#\[Route\s*\(\s*(['"])([^'"]+)\1(?:[^)]*methods\s*:\s*\[([^\]]*)\])?/g,
    pathGroup: 2,
    methodGroup: 3,
  },
];

const GRAPHQL_PATTERN =
  /\b(?:type\s+(Query|Mutation|Subscription)\s*\{|@(?:Query|Mutation|Subscription)\s*\()/g;

// ---------------------------------------------------------------------------
// File-convention routers
// ---------------------------------------------------------------------------

interface ConventionResult {
  path: string;
  framework: string;
  methods: HttpMethod[];
}

function nextAppRouterPath(filePath: string): string | undefined {
  const match = /(?:^|\/)(?:src\/)?app\/(.*)\/(route|page)\.(t|j)sx?$/.exec(filePath);
  if (!match) return undefined;
  return normalizeSegments(match[1]);
}

function nextAppRootPath(filePath: string): string | undefined {
  if (!/(?:^|\/)(?:src\/)?app\/(route|page)\.(t|j)sx?$/.test(filePath)) return undefined;
  return '/';
}

function normalizeSegments(raw: string): string {
  const segments = raw
    .split('/')
    .filter(Boolean)
    // Route groups `(marketing)` and parallel routes `@modal` do not affect the URL.
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .filter((segment) => !segment.startsWith('@'))
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '*?';
      if (/^\[\.\.\..+\]$/.test(segment)) return '*';
      if (/^\[.+\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
      return segment;
    });
  return `/${segments.join('/')}`.replace(/\/+/g, '/');
}

function detectConvention(
  file: SourceFile,
  parsed: ParsedFile | undefined,
): ConventionResult | undefined {
  const path = file.path;

  // Next.js App Router
  if (
    /(?:^|\/)(?:src\/)?app\/.*route\.(t|j)sx?$/.test(path) ||
    /(?:^|\/)(?:src\/)?app\/route\.(t|j)sx?$/.test(path)
  ) {
    const routePath = nextAppRouterPath(path) ?? nextAppRootPath(path) ?? '/';
    const methods = (parsed?.exports ?? [])
      .map((e) => e.name.toUpperCase())
      .filter((name): name is HttpMethod => METHODS.has(name as HttpMethod));
    return {
      path: routePath,
      framework: 'Next.js Route Handler',
      methods: methods.length ? methods : ['GET'],
    };
  }

  if (
    /(?:^|\/)(?:src\/)?app\/.*page\.(t|j)sx?$/.test(path) ||
    /(?:^|\/)(?:src\/)?app\/page\.(t|j)sx?$/.test(path)
  ) {
    const routePath = nextAppRouterPath(path) ?? nextAppRootPath(path) ?? '/';
    return { path: routePath, framework: 'Next.js Page', methods: ['GET'] };
  }

  // Next.js Pages Router API
  const pagesApi = /(?:^|\/)(?:src\/)?pages\/api\/(.*)\.(t|j)sx?$/.exec(path);
  if (pagesApi) {
    const cleaned = pagesApi[1].replace(/\/index$/, '');
    return {
      path: normalizeSegments(`api/${cleaned}`),
      framework: 'Next.js API Route',
      methods: ['ALL'],
    };
  }

  // SvelteKit
  const svelte = /(?:^|\/)src\/routes\/(.*)\/\+server\.(t|j)s$/.exec(path);
  if (svelte) {
    const methods = (parsed?.exports ?? [])
      .map((e) => e.name.toUpperCase())
      .filter((name): name is HttpMethod => METHODS.has(name as HttpMethod));
    return {
      path: normalizeSegments(svelte[1].replace(/\[([^\]]+)\]/g, '[$1]')),
      framework: 'SvelteKit',
      methods: methods.length ? methods : ['GET'],
    };
  }

  // Nuxt server routes
  const nuxt = /(?:^|\/)server\/(?:api|routes)\/(.*)\.(t|j)s$/.exec(path);
  if (nuxt) {
    const [, name] = /^(.*?)(?:\.(get|post|put|patch|delete))?$/.exec(nuxt[1]) ?? [];
    const method = /\.(get|post|put|patch|delete)$/.exec(nuxt[1])?.[1];
    return {
      path: normalizeSegments(`api/${name ?? nuxt[1]}`),
      framework: 'Nuxt',
      methods: [(method?.toUpperCase() as HttpMethod) ?? 'ALL'],
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Was the character at `index` blanked by the scanner?
 *
 * The mask replaces comment bodies and string contents with spaces while
 * preserving every offset, so comparing the two strings at a single index tells
 * us whether a match started inside a comment or a docstring. This is what
 * stops Flask's own documentation examples from being reported as routes.
 */
function isMaskedAt(masked: string | undefined, original: string, index: number): boolean {
  if (!masked) return false;
  return masked[index] !== original[index];
}

/** Fallback for files with no mask: drop whole-line comments. */
function stripCommentLines(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart();
      if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*')
      ) {
        return ' '.repeat(line.length);
      }
      return line;
    })
    .join('\n');
}

export interface RouteExtractionInput {
  sources: SourceFile[];
  parsed: Map<string, ParsedFile>;
  /** Scanner output per file, used to reject matches inside comments. */
  masked?: Map<string, string>;
  /** Detected framework names, used to disambiguate shared syntax. */
  frameworks?: Set<string>;
}

export function extractRoutes(input: RouteExtractionInput): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const seen = new Set<string>();

  const push = (route: Omit<ApiRoute, 'id'>) => {
    const id = `route:${route.method}:${route.path}:${route.file}:${route.line}`;
    const dedupeKey = `${route.method} ${route.path} ${route.file}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    routes.push({ ...route, id });
  };

  for (const file of input.sources) {
    const parsed = input.parsed.get(file.path);
    const language = parsed?.language;

    const convention = detectConvention(file, parsed);
    if (convention) {
      for (const method of convention.methods) {
        push({
          method,
          path: convention.path,
          file: file.path,
          line: 1,
          framework: convention.framework,
          style: 'rest',
          handler: handlerFor(parsed, 1),
        });
      }
      continue;
    }

    if (!language) continue;

    // Route paths live inside string literals, which the mask blanks, so the
    // patterns run against the original text and the mask is consulted only to
    // reject matches that started inside a comment or docstring.
    const masked = input.masked?.get(file.path);
    const text = file.content;
    const guard = masked ? masked : stripCommentLines(file.content);

    for (const rule of ROUTE_PATTERNS) {
      if (!rule.languages.includes(language)) continue;
      if (rule.fileFilter && !rule.fileFilter.test(file.path)) continue;

      const rex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match = rex.exec(text);
      while (match !== null) {
        if (isMaskedAt(guard, text, match.index)) {
          match = rex.exec(text);
          continue;
        }
        const rawPath = match[rule.pathGroup] ?? '';
        const line = lineNumberAt(text, match.index);
        const methods = resolveMethods(rule, match);
        for (const method of methods) {
          push({
            method,
            path: normalizeRoutePath(rawPath, rule.style),
            file: file.path,
            line,
            framework: resolveFramework(rule, input.frameworks),
            style: rule.style,
            handler: handlerFor(parsed, line),
          });
        }
        match = rex.exec(text);
      }
    }

    const graphqlRex = new RegExp(GRAPHQL_PATTERN.source, GRAPHQL_PATTERN.flags);
    let graphqlMatch = graphqlRex.exec(text);
    while (graphqlMatch !== null) {
      if (!isMaskedAt(guard, text, graphqlMatch.index)) {
        push({
          method: 'RPC',
          path: `graphql:${(graphqlMatch[1] ?? 'Resolver').toLowerCase()}`,
          file: file.path,
          line: lineNumberAt(text, graphqlMatch.index),
          framework: 'GraphQL',
          style: 'graphql',
        });
      }
      graphqlMatch = graphqlRex.exec(text);
    }
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/**
 * Some frameworks share a registration syntax — `@app.get("/x")` is valid in
 * both FastAPI and Flask 2+. When the stack detector has already identified one
 * of them, prefer that over the pattern's nominal owner.
 */
const AMBIGUOUS_FRAMEWORKS: Record<string, string[]> = {
  FastAPI: ['FastAPI', 'Flask', 'Sanic', 'Quart'],
  'Go router': ['Gin', 'Echo', 'Fiber', 'Chi'],
  'Actix / Rocket': ['Actix Web', 'Rocket'],
};

function resolveFramework(rule: RoutePattern, detected: Set<string> | undefined): string {
  const alternatives = AMBIGUOUS_FRAMEWORKS[rule.framework];
  if (!alternatives || !detected) return rule.framework;
  const match = alternatives.find((name) => detected.has(name));
  return match ?? rule.framework;
}

function resolveMethods(rule: RoutePattern, match: RegExpExecArray): HttpMethod[] {
  if (rule.fixedMethod) return [rule.fixedMethod];
  const raw = rule.methodGroup !== undefined ? match[rule.methodGroup] : undefined;
  if (!raw) return ['GET'];

  // Some patterns capture a list: `methods=['GET', 'POST']`.
  if (raw.includes(',') || raw.includes("'") || raw.includes('"')) {
    const found = [...raw.matchAll(/([A-Za-z]+)/g)]
      .map((m) => m[1].toUpperCase())
      .filter((m): m is HttpMethod => METHODS.has(m as HttpMethod));
    return found.length ? found : ['GET'];
  }

  const upper = raw.trim().toUpperCase();
  if (upper === 'ANY' || upper === 'MATCH') return ['ALL'];
  if (upper === 'WEBSOCKET') return ['WS'];
  return METHODS.has(upper as HttpMethod) ? [upper as HttpMethod] : ['GET'];
}

function normalizeRoutePath(raw: string, style: ApiRoute['style']): string {
  if (style === 'trpc') return `trpc:${raw}`;
  const trimmed = raw.trim();
  if (!trimmed) return '/';
  const withSlash =
    trimmed.startsWith('/') || trimmed.startsWith('trpc:') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
}

function handlerFor(parsed: ParsedFile | undefined, line: number): string | undefined {
  if (!parsed) return undefined;
  // The handler is the first callable declared at or after the registration.
  const candidates = parsed.symbols
    .filter((s) => ['function', 'method', 'component'].includes(s.kind))
    .sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line));
  const nearest = candidates[0];
  if (!nearest) return undefined;
  return nearest.container ? `${nearest.container}.${nearest.name}` : nearest.name;
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/** Route files that a convention router owns, for entry-point weighting. */
export function isRouteFile(path: string): boolean {
  const base = basename(path);
  if (/^(route|page|\+server)\.(t|j)sx?$/.test(base)) return true;
  return /(?:^|\/)(?:src\/)?pages\/api\//.test(dirname(path));
}
