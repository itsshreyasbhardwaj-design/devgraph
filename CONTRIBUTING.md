# Contributing to DevGraph

Thanks for wanting to help. This guide covers what you need to get productive
quickly.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Setup

```bash
git clone https://github.com/<your-username>/devgraph.git
cd devgraph
pnpm install
pnpm dev
```

Node.js 20+ and pnpm 9+. Nothing else — no database, no API key, no account.

## Before you open a pull request

```bash
pnpm verify
```

That runs lint, typecheck, tests and a production build in sequence, which is
exactly what CI does. For end-to-end tests:

```bash
pnpm fixtures     # builds the test archive
pnpm test:e2e
```

## Good first contributions

**A new language parser** is the highest-value contribution and the most
self-contained. [ARCHITECTURE.md](./ARCHITECTURE.md#adding-a-language) has the
seven-step recipe. Ruby, Kotlin, Swift and C/C++ are on the roadmap.

**A framework detection rule** is a one-line data change in
`src/lib/detect/rules.ts`. If DevGraph did not recognise a stack you use, that
is a bug worth a five-minute fix.

**A route pattern** for a framework whose endpoints are not being found —
`src/lib/extract/routes.ts`.

**A schema extractor** for an ORM that is not covered —
`src/lib/extract/schema.ts`.

## Architecture rules

These are enforced by review, and breaking them is the main reason a pull
request gets change requests.

1. **`lib/` does not import from `app/` or `components/`.** The analysis engine
   must run in a test runner and, eventually, a CLI.
2. **`lib/` does not import React or Next.js**, except `lib/client/` (browser
   layout and state) and `lib/security/api.ts` (response shaping).
3. **Parsers run against masked source.** Never pattern-match raw text for
   structure — that is how commented-out code becomes an edge. If you need a
   string literal's value, read it from the scanner's literal table.
4. **Analysis is deterministic.** No `Math.random()`, no wall-clock in results,
   no iteration-order dependence. Two runs over the same input must produce
   identical output; there is a test that asserts this.
5. **Limits are visible.** If you cap, trim or sample something, record it and
   surface it. A truncated graph presented as complete is a lie.

## Code style

- **Strict TypeScript.** No `any`, no non-null assertions without a comment
  explaining why the invariant holds.
- **Comments explain _why_, not _what_.** `// increment counter` is noise;
  `// dagre reports centres, the canvas positions from the top-left` is the kind
  of thing that saves the next person twenty minutes.
- **Name things by what they do**, not how they are built.
- Prettier and ESLint are configured; `pnpm format` and `pnpm lint:fix` apply
  them. Do not hand-format around them.

## Tests

Every behavioural change needs a test.

- Parser changes → `tests/parsing/`
- Pipeline, metrics, extraction → `tests/analysis/`
- Ingestion and safety → `tests/ingest/`
- UI flows → `tests/e2e/`

Write tests that assert **behaviour**, not implementation. A test that breaks
when you rename a private helper is a test that will be deleted.

If you are fixing a bug, add the failing test first. It documents the bug better
than the commit message will.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(parsers): add Ruby parser
fix(resolve): follow tsconfig paths with a trailing wildcard
perf(layout): skip relayout when only the selection changes
docs(readme): document the export endpoints
test(ingest): cover nested zip path traversal
refactor(graph): extract node budget enforcement
```

Types: `feat`, `fix`, `perf`, `docs`, `test`, `refactor`, `chore`, `ci`, `style`.

Write the body for someone reading `git log` in a year with no memory of the
discussion. Explain the reasoning, not the diff.

## Pull requests

- One logical change per pull request.
- Fill in the template — especially "how did you verify this".
- Include a screenshot for anything visual.
- If you changed analysis output, say what a real repository looked like before
  and after. "Reduced false-positive routes on `pallets/flask` from 298 to 176"
  is far more convincing than "improved route detection".

## Reporting bugs

Analysis bugs are much easier to fix with a reproduction. The most useful bug
report names a **public repository** and says what DevGraph got wrong about it:

> Analysing `owner/repo`, the import graph misses the edge from `src/a.ts` to
> `src/b.ts`. `b.ts` is imported via the `#internal/*` subpath import in
> `package.json`, which the resolver does not handle.

## Questions

Open a discussion or a draft pull request. A half-finished attempt with a
question attached is a perfectly good way to start.
