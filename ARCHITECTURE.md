# Architecture

This document explains how DevGraph is put together and, more usefully, _why_.
Read it before adding a language, a framework rule, or a new view.

## Shape of the system

```
src/
├── app/                    Next.js App Router — routes and API only
│   ├── page.tsx            Landing
│   ├── analyze/            Workspace route + the analysis driver
│   └── api/                Streaming analyze, read/list/delete, export,
│                           timeline, insights, health
├── components/
│   ├── ui/                 Design-system primitives
│   ├── marketing/          Landing-page pieces
│   └── workspace/          Canvas, rail, inspector, dashboards, palette
└── lib/
    ├── core/               Types, path helpers, language table
    ├── parsing/            Scanner, complexity, parser registry, languages/
    ├── graph/              Import resolution, cycles, ten graph builders
    ├── detect/             Manifest readers and stack-detection rules
    ├── metrics/            Complexity, duplication, coverage, debt
    ├── extract/            API routes, database schema, environment config
    ├── insights/           Deterministic engine + OpenRouter layer
    ├── analysis/           Pipeline and search index
    ├── ingest/             GitHub, ZIP, local, TAR, safe decoding
    ├── storage/            Memory and Postgres adapters
    ├── security/           Rate limiting and API plumbing
    ├── client/             Zustand store and layout algorithms
    └── export/             Mermaid generation
```

The dependency direction is strict: `app/` and `components/` may import from
`lib/`, never the reverse. Nothing under `lib/` imports React or Next.js except
`lib/client/` (browser-only layout and state) and `lib/security/api.ts` (which
shapes `NextResponse`). The analysis engine therefore runs unchanged in a test
runner, a worker, or a future CLI.

## The analysis pipeline

`lib/analysis/pipeline.ts` is one pass, reporting progress at each phase:

1. **Select files** — drop vendored directories, build output, lockfiles and
   binaries; enforce file-count and byte caps.
2. **Read manifests** — npm, pip/Poetry/Pipenv, `go.mod`, Cargo, Maven, Gradle,
   NuGet, Composer, Bundler. Produces dependencies plus resolver hints
   (tsconfig paths, PSR-4 roots, Go module path).
3. **Parse** — one structural record per file, plus a masked copy of the source.
4. **Resolve imports** — every specifier becomes an internal file or an external
   package. Fan-in and fan-out fall out of this.
5. **Find cycles** — iterative Tarjan over the file graph.
6. **Detect the stack** — before extraction, so ambiguous route syntax can be
   attributed to the framework actually present.
7. **Extract** — API routes, database schema, environment configuration.
8. **Compute metrics** — complexity, maintainability, coupling, cohesion,
   duplication, coverage, debt.
9. **Find entry points**.
10. **Build graphs** — ten views, each with its own node budget.
11. **Index and explain** — search index and deterministic insights.

Every step is pure with respect to its inputs. Two runs over the same files
produce byte-identical results, which is what makes the pipeline testable.

## Why the scanner exists

`lib/parsing/scanner.ts` is the foundation everything else stands on.

A naive regex parser reports imports that appear in comments, classes that
appear in docstrings, and routes that appear in documentation examples. Those
are not edge cases: Flask's own source documents `@app.route("/")` in a
docstring, and any repository with commented-out code has ghost dependencies.

The scanner walks the source once and produces a **masked** copy: comment bodies
and string contents are replaced with spaces, and newlines are preserved so
every offset and line number still lines up with the original. Language parsers
run their patterns against the mask and pull real literal values back out of a
recorded literal table.

It handles the awkward parts of each language explicitly:

| Feature                                           | Language         |
| ------------------------------------------------- | ---------------- |
| Regex literals (`/a\/\/b/` is not a comment)      | JS/TS            |
| Template literals with nested `${}` interpolation | JS/TS            |
| Triple-quoted strings and docstrings              | Python, Java, C# |
| Raw backtick strings                              | Go               |
| Nested block comments and `r#"…"#` raw strings    | Rust             |
| `@"…"` verbatim and `$"…"` interpolated strings   | C#               |
| Heredocs and nowdocs                              | PHP              |

Route extraction uses the mask a second way: patterns run against the _original_
text (route paths live inside string literals the mask blanks) but a match is
discarded if the mask differs from the original at the match's start offset —
which means the match began inside a comment.

## Import resolution

`lib/graph/resolve.ts` implements a strategy per language:

| Language                | Handles                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| TypeScript / JavaScript | Relative paths, extension and `/index` probing, `tsconfig` path aliases, monorepo workspace packages, `node:` builtins |
| Python                  | Relative `from .x`, absolute packages across several source roots, stdlib table                                        |
| Go                      | `go.mod` module prefix stripped to a package directory, stdlib prefixes                                                |
| Rust                    | `crate::` / `self::` / `super::` to `.rs` or `mod.rs`, crate-root modules                                              |
| Java                    | Namespace index built from parsed `package` declarations, then path suffix, then unique basename                       |
| C#                      | Namespace index from `namespace` declarations                                                                          |
| PHP                     | PSR-4 map from `composer.json`, then namespace index, then unique basename                                             |

Unresolvable specifiers become **external packages** rather than being dropped,
so an unusual layout loses precision but never loses the edge.

## Graph builders

`lib/graph/builders.ts` turns the analysis into ten `DevGraphView`s. Each
builder decides what belongs in its view — the import graph, for example,
includes only files that can participate in one, because several hundred
isolated Markdown files would dominate the layout and say nothing.

Every view enforces a node budget. When it bites, the highest-degree nodes are
kept, ancestors are preserved so hierarchies never dangle, and the view records
what was dropped and why. The UI shows that, rather than presenting a trimmed
graph as complete.

## Layout

`lib/client/layout.ts` is deliberately **deterministic**. The same graph always
produces the same coordinates, because a canvas that reshuffles when you toggle
a filter destroys the spatial memory that makes a graph useful.

| Layout  | Used by                          | Algorithm                                                          |
| ------- | -------------------------------- | ------------------------------------------------------------------ |
| Layered | Imports, modules, classes, calls | dagre, left-to-right                                               |
| Tree    | Folders, components, API         | d3-hierarchy, transposed                                           |
| Radial  | Cycles                           | Circle per cycle, so a loop reads as a loop                        |
| Force   | Schema, config                   | d3-force, seeded from a hash of the node id, fixed 300-tick budget |
| Grid    | Very large graphs                | Sorted, honest about being a fallback                              |

Nodes with no edges are laid out in a separate block. Left in the layered pass,
dagre stacks them into one enormous rank that dwarfs the real structure.

Viewport framing uses `duration: 0`. An animated fit runs through d3-zoom's
`requestAnimationFrame` transition, so anywhere the frame loop is throttled — a
background tab, a low-power device, an embedded webview — the viewport would
never reach its target and the graph would appear empty. Framing is correctness,
not decoration. The same reasoning is why the landing page's entrance uses CSS
animation whose _resting_ state is the visible one.

## Performance

For repositories with thousands of files, in order of effect:

1. **Selection** — vendored, generated and binary files never enter the pipeline.
2. **Caps** — per-file bytes, total bytes, file count; each one warns when hit.
3. **Node budgets** — per view, before anything reaches the browser.
4. **Memoised layout** — keyed on the visible node set, so selecting and panning
   never recompute positions.
5. **Viewport culling** — React Flow renders only visible nodes.
6. **Level of detail** — above 400 nodes, edge markers, labels and the minimap
   are dropped; they are the expensive part and the least informative at that
   density.
7. **Cheaper algorithms at scale** — dagre's ranker degrades past 400 nodes; the
   grid takes over past 1,400.

## Security model

Analysis never executes repository code. Beyond that:

- **One decode choke point.** `lib/ingest/decode.ts` is where untrusted archive
  contents become analysis input. Path traversal (`../`, absolute paths, UNC,
  drive letters, NUL bytes), per-file and total size caps, binary detection and
  vendored-path filtering all live there, so no ingestion source can bypass them.
- **Strict input validation.** The GitHub reference is validated against
  owner/repo/ref patterns before it reaches an outbound fetch, and before the
  streaming response opens so a malformed input still returns a 400.
- **No secret values are read.** Environment extraction records names,
  declaration sites and usage sites only. A committed `.env` cannot leak values
  through an analysis result.
- **Rate limiting** on every route, with separate buckets so cheap reads do not
  consume the analysis budget.
- **No `dangerouslySetInnerHTML`.** The Markdown renderer emits React elements,
  so model-authored text cannot inject markup.
- **Model output is verified.** File paths cited by the LLM are checked against
  the real file list before being rendered as links.

## Adding a language

1. Create `src/lib/parsing/languages/<language>.ts` exporting a `LanguageParser`.
   If the language is curly-braced and class-oriented, `createClassLanguageParser`
   in `classLanguage.ts` already implements members, modifiers and inheritance —
   supply regexes and a few predicates, as `java.ts` and `php.ts` do.
2. Add a `SyntaxProfile` in `scanner.ts` if the language has string or comment
   syntax the existing profiles do not cover.
3. Add decision keywords to `DECISION_KEYWORDS` in `complexity.ts`.
4. Add a resolution strategy in `graph/resolve.ts`.
5. Register the parser in `src/lib/parsing/index.ts`.
6. Add the extensions to `EXTENSION_MAP` and a colour to `LANGUAGE_COLORS` in
   `core/languages.ts`.
7. Write tests in `tests/parsing/languages.test.ts` covering imports, symbols,
   inheritance, calls and environment variables.

Nothing else needs to change. Graph builders, metrics and the UI all consume the
shared `ParsedFile` record.

## Adding a framework or route pattern

Stack detection is data: add a rule to `STACK_RULES` in `lib/detect/rules.ts`.
Route detection is data too: add an entry to `ROUTE_PATTERNS` in
`lib/extract/routes.ts`, or a convention branch in `detectConvention` for
frameworks that encode the route in the file path.

## Testing

- `tests/parsing/` — scanner and all eight language parsers.
- `tests/analysis/` — the full pipeline over a synthetic repository that
  deliberately contains a cycle, a duplicated block, a complex function and a
  client-exposed secret, so every metric path has something to find.
- `tests/ingest/` — archive safety: path traversal, zip bombs, malformed input.
- `tests/infra/` — rate limiting, storage, export, timeline, insight context.
- `tests/e2e/` — Playwright against a production build, analysing a generated
  fixture archive so the suite needs no network.

The e2e fixture is built by a script rather than committed as a binary, so its
contents are reviewable in a diff.
