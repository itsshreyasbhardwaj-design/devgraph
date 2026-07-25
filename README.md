<div align="center">

# DevGraph

**Every codebase is a graph you can't see.**

DevGraph reads a repository and draws it — imports, calls, classes, components,
API routes, database schema, and the dependency cycles nobody meant to create.

[![CI](https://github.com/itsshreyasbhardwaj-design/devgraph/actions/workflows/ci.yml/badge.svg)](https://github.com/itsshreyasbhardwaj-design/devgraph/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org)

</div>

---

> **Screenshot placeholder** — `docs/screenshots/landing.png`
>
> The landing page, with the hero graph showing an example repository and its
> one circular dependency picked out in coral.

## Why

You join a team, or open an unfamiliar repository, and spend a week finding out
where things are. The README explains what the project does. The file tree shows
what exists. Neither shows you the **shape** — what depends on what, where the
load-bearing modules are, which endpoints reach which tables, and where the
structure has quietly gone wrong.

DevGraph answers those questions in about the time it takes to read the README.

- **No install.** Paste a GitHub URL, or drop a `.zip`.
- **No execution.** Nothing is cloned to disk, run, or evaluated. Analysis is
  purely lexical and structural.
- **No API key required.** Every metric and every architecture explanation is
  computed deterministically. AI is an optional enhancement, never a dependency.

## Features

### Ten views of one analysis

| View                      | Answers                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| **Import graph**          | Which file depends on which, and where the cycles are                  |
| **Module dependencies**   | Directory-level shape, plus the external packages each module pulls in |
| **Folder hierarchy**      | The tree, sized by the code inside it                                  |
| **Class diagram**         | Types with their members, inheritance and interface implementations    |
| **Call graph**            | Which function reaches which                                           |
| **Component hierarchy**   | What renders what, and how deep the tree goes                          |
| **Circular dependencies** | Every cycle, ordered by severity                                       |
| **API routes**            | Every endpoint, its method, framework and handler                      |
| **Database schema**       | Tables, columns and foreign keys                                       |
| **Environment config**    | Which variables are read where — and which ones leak to the client     |

Zoom, pan, search, filter, collapse, expand, focus on a subgraph, and export
any view.

> **Screenshot placeholder** — `docs/screenshots/workspace.png`

### Metrics you can audit

Cyclomatic complexity, Halstead volume, the SEI maintainability index, module
cohesion and instability, duplication, coupling, coverage, and a technical-debt
score that lists every contributing signal rather than presenting a bare number.

> **Screenshot placeholder** — `docs/screenshots/metrics.png`

### Architecture insights

Eleven topics — overall architecture, major modules, entry points,
authentication flow, API lifecycle, data flow, state management, dependency
structure, performance signals, technical debt, and a prioritised improvement
plan. Every claim references a file you can open.

These are **computed, not generated**. With `OPENROUTER_API_KEY` set, a model
can expand any section; it receives a factual digest of the analysis rather than
your source, and every file path it cites is verified against the real file list
before being rendered as a link.

### Timeline

Connects to Git history, samples commits across the repository's life, and
charts module growth, dependency additions and removals, and the diff between
any two points.

### Export

SVG, PNG and PDF from the live canvas; JSON, Mermaid and a full Markdown
document from the server.

## Supported languages

| Language         | Imports | Symbols | Calls | Inheritance | Routes | Schema |
| ---------------- | :-----: | :-----: | :---: | :---------: | :----: | :----: |
| TypeScript / TSX |    ✓    |    ✓    |   ✓   |      ✓      |   ✓    |   ✓    |
| JavaScript / JSX |    ✓    |    ✓    |   ✓   |      ✓      |   ✓    |   ✓    |
| Python           |    ✓    |    ✓    |   ✓   |      ✓      |   ✓    |   ✓    |
| Java             |    ✓    |    ✓    |   ✓   |      ✓      |   ✓    |   ✓    |
| Go               |    ✓    |    ✓    |   ✓   |      ✓      |   ✓    |   —    |
| Rust             |    ✓    |    ✓    |   ✓   |      ✓      |   ✓    |   —    |
| C#               |    ✓    |    ✓    |   ✓   |      ✓      |   ✓    |   ✓    |
| PHP              |    ✓    |    ✓    |   ✓   |      ✓      |   ✓    |   ✓    |

Adding a language is one file plus one registry line — see
[ARCHITECTURE.md](./ARCHITECTURE.md#adding-a-language).

## Quick start

```bash
git clone https://github.com/itsshreyasbhardwaj-design/devgraph.git
cd devgraph
pnpm install
pnpm dev
```

Open <http://localhost:3000> and paste a repository. That is the whole setup —
no database, no API key, no account.

**Requirements:** Node.js 20+ and pnpm 9+.

## Configuration

Every variable is optional. Copy `.env.example` to `.env.local` and set only
what you want.

| Variable                                                  | Default                      | Effect                                                                                                                            |
| --------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`                                            | —                            | Raises GitHub's rate limit from 60 to 5,000 requests/hour. Read-only; no scopes needed for public repositories.                   |
| `OPENROUTER_API_KEY`                                      | —                            | Enables **Expand with AI** on insight sections. Without it, the deterministic engine covers every section.                        |
| `OPENROUTER_MODEL`                                        | `anthropic/claude-3.5-haiku` | Model used for expansion.                                                                                                         |
| `DATABASE_URL`                                            | —                            | Persists analyses to PostgreSQL/Supabase. Without it, results live in an in-memory LRU cache. The schema is created on first use. |
| `CLERK_SECRET_KEY`<br>`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | —                            | Enables accounts. Signed-in users get a private analysis history; anonymous use keeps working.                                    |
| `DEVGRAPH_ALLOW_LOCAL`                                    | `false`                      | Allows analysing a directory on the server's own filesystem. Only enable on an instance you control.                              |
| `DEVGRAPH_LOCAL_ROOTS`                                    | —                            | Colon-separated allow-list for local analysis.                                                                                    |
| `DEVGRAPH_RATE_LIMIT_PER_MINUTE`                          | `10`                         | Analyses per client per minute.                                                                                                   |
| `DEVGRAPH_MAX_UPLOAD_MB`                                  | `120`                        | Maximum archive size.                                                                                                             |

`GET /api/health` reports which of these are active.

## Usage

### Web

Paste any of these into the field:

```
owner/repo
https://github.com/owner/repo
https://github.com/owner/repo/tree/branch-name
git@github.com:owner/repo.git
owner/repo@v1.2.3
```

Or drag a `.zip` onto the field.

### API

The analysis endpoint streams newline-delimited JSON so a client can render
live progress.

```bash
curl -N -X POST http://localhost:3000/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"kind":"github","repository":"honojs/hono"}'
```

```
{"type":"progress","data":{"phase":"fetching","message":"Fetching repository","progress":0.02}}
{"type":"progress","data":{"phase":"parsing","message":"Parsing source files","progress":0.31}}
{"type":"result","data":{ … }}
```

Other endpoints:

| Endpoint                                                                    | Purpose                               |
| --------------------------------------------------------------------------- | ------------------------------------- |
| `GET /api/analyses`                                                         | Recent analyses visible to the caller |
| `GET /api/analyses/:id`                                                     | Full analysis result                  |
| `DELETE /api/analyses/:id`                                                  | Delete an analysis                    |
| `GET /api/analyses/:id/export?format=json\|mermaid\|markdown&graph=imports` | Export                                |
| `GET /api/analyses/:id/timeline`                                            | Sample and return Git history         |
| `POST /api/insights`                                                        | Stream an AI-expanded insight section |
| `GET /api/health`                                                           | Liveness and enabled capabilities     |

### Mermaid in your own docs

```bash
curl 'http://localhost:3000/api/analyses/<id>/export?format=markdown' > ARCHITECTURE-DIAGRAMS.md
```

Produces one document with every view as a Mermaid diagram, ready to paste into
a README or a pull request.

## Deploy

### Vercel

```bash
pnpm dlx vercel
```

Nothing needs configuring. Add environment variables in the Vercel dashboard to
enable persistence, accounts or AI.

> Analysis runs in a Node.js serverless function with `maxDuration = 300`.
> Very large repositories may need a plan that permits longer executions, or a
> self-hosted deployment.

### Docker

```bash
docker build -t devgraph .
docker run -p 3000:3000 devgraph
```

### Anywhere else

```bash
pnpm build
pnpm start
```

## Development

```bash
pnpm dev             # dev server
pnpm test            # unit and integration tests
pnpm test:coverage   # with a coverage report
pnpm test:e2e        # Playwright, against a production build
pnpm typecheck       # strict TypeScript
pnpm lint            # ESLint
pnpm verify          # lint → typecheck → test → build
```

`pnpm verify` is what CI runs. Run it before opening a pull request.

## How it works

```
GitHub tarball / ZIP / local directory
              │
              ▼
      ┌───────────────┐   path sanitisation, size caps,
      │   Ingestion   │   binary and vendored-path filtering
      └───────┬───────┘
              ▼
      ┌───────────────┐   comment- and string-aware scanner,
      │    Parsing    │   then one structural parser per language
      └───────┬───────┘
              ▼
      ┌───────────────┐   relative paths, tsconfig aliases, PSR-4,
      │  Resolution   │   go.mod, crate paths, JVM/.NET namespaces
      └───────┬───────┘
              ▼
      ┌───────────────┐   Tarjan SCC, complexity, coupling,
      │   Analysis    │   duplication, coverage, extraction
      └───────┬───────┘
              ▼
      ┌───────────────┐   ten views, each with its own node budget
      │    Graphs     │
      └───────────────┘
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design, including why
the scanner exists and how to add a language.

## Accuracy

DevGraph is a **static, lexical** analyser. It does not run a type checker or
build the project. That is a deliberate trade: it works on any repository
instantly, in eight languages, with no toolchain.

What that means in practice:

- **Imports are resolved, not guessed.** Relative paths, tsconfig aliases,
  monorepo workspaces, PSR-4 roots, `go.mod` module paths and JVM namespaces are
  all followed to real files. Unresolvable specifiers become external packages
  rather than being dropped.
- **Comments and strings never become code.** A comment-aware scanner masks them
  before any pattern runs, so a commented-out import is not an edge and a
  docstring example is not a route.
- **Call graphs prefer same-file definitions** and only accept a cross-file
  target when the name is globally unique. Dynamic dispatch is not resolved.
- **Duplication is a line-window indicator**, not a token-level proof.
- **Performance signals are structural.** They tell you where to profile, not
  what is slow.

Where a limit is hit — a node budget, a file-size cap, a truncated graph — the
UI says so rather than quietly showing less.

## Roadmap

- [ ] Ruby, Kotlin, Swift and C/C++ parsers
- [ ] GitLab and Bitbucket ingestion
- [ ] Persistent shareable analysis links with access control
- [ ] PR mode: diff two refs and show what the change does to the architecture
- [ ] Incremental re-analysis of only the files that changed
- [ ] Web Worker offloading for the layout of very large graphs
- [ ] CLI (`npx devgraph .`) emitting Mermaid and JSON for CI checks
- [ ] Custom rules: fail CI when a forbidden dependency edge appears
- [ ] Type-aware TypeScript mode using the compiler API, opt-in

Ideas and pull requests welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Contributing

Contributions are welcome, especially new language parsers and framework
detection rules. Start with [CONTRIBUTING.md](./CONTRIBUTING.md); by
participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Analysis never executes repository code. To report a vulnerability, see
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
