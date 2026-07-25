import Link from 'next/link';
import {
  Boxes,
  Braces,
  Database,
  FolderTree,
  GitBranch,
  GitCompare,
  KeyRound,
  Network,
  PhoneCall,
  Route,
  Shapes,
  Waypoints,
} from 'lucide-react';
import { HeroGraph } from '@/components/marketing/HeroGraph';
import { RepoInput } from '@/components/marketing/RepoInput';
import { Badge, Eyebrow } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { publicFlags } from '@/lib/config/env';
import { LANGUAGE_COLORS } from '@/lib/core/languages';

export const dynamic = 'force-dynamic';

const VIEWS = [
  { icon: FolderTree, name: 'Folder hierarchy', line: 'The tree, sized by the code inside it.' },
  { icon: Network, name: 'Import graph', line: 'Every file and what it pulls in.' },
  {
    icon: Boxes,
    name: 'Module dependencies',
    line: 'Directory-level shape, plus external packages.',
  },
  { icon: Shapes, name: 'Class diagram', line: 'Types, members, inheritance, interfaces.' },
  { icon: PhoneCall, name: 'Call graph', line: 'Which function reaches which.' },
  {
    icon: Waypoints,
    name: 'Component hierarchy',
    line: 'What renders what, and how deep it goes.',
  },
  { icon: GitBranch, name: 'Circular dependencies', line: 'The cycles nobody meant to create.' },
  { icon: Route, name: 'API routes', line: 'Every endpoint, its method and its handler.' },
  { icon: Database, name: 'Database schema', line: 'Tables, columns, foreign keys.' },
  {
    icon: KeyRound,
    name: 'Environment config',
    line: 'Which variables are read where — and which leak.',
  },
];

const LANGUAGES = [
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'csharp', label: 'C#' },
  { id: 'php', label: 'PHP' },
] as const;

const READS = [
  {
    title: 'Structure, not guesses',
    body: 'A comment-aware scanner strips comments and string bodies before anything is parsed, so a commented-out import never becomes an edge and a SQL string never becomes a class.',
  },
  {
    title: 'Real import resolution',
    body: 'Relative paths, tsconfig aliases, monorepo workspaces, PSR-4 roots, go.mod module paths, Rust crate paths and JVM namespaces all resolve to actual files.',
  },
  {
    title: 'Metrics you can audit',
    body: 'Cyclomatic complexity, Halstead volume, the SEI maintainability index, module cohesion and instability, duplication and coverage — each with the files that produced it.',
  },
  {
    title: 'Explanations that cite files',
    body: 'Architecture, auth flow, data flow, debt and a prioritised improvement plan. Every claim points at a path you can open. Works with no API key at all.',
  },
];

export default function LandingPage() {
  const flags = publicFlags();

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      {/* Ambient ground: the dot grid that runs under the whole product. */}
      <div aria-hidden className="grid-field pointer-events-none fixed inset-0 opacity-70" />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[560px] bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,rgba(124,92,255,0.16),transparent)]"
      />

      <header className="border-line/70 relative z-10 border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="font-display text-ink text-[15px] font-semibold tracking-tight">
              DevGraph
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href="#views">Views</a>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="#how">How it works</a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a
                href="https://github.com/itsshreyasbhardwaj-design/devgraph"
                target="_blank"
                rel="noreferrer noopener"
              >
                GitHub
              </a>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" className="relative z-10">
        {/* ---------------------------------------------------------- hero */}
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-20 sm:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div>
              <Badge tone="accent" className="mb-6">
                Open source · MIT
              </Badge>
              <h1 className="font-display text-ink text-[clamp(2.4rem,6.2vw,4.1rem)] leading-[0.98] font-semibold">
                Every codebase is a graph
                <br />
                <span className="text-ink-faint">you can&rsquo;t see.</span>
              </h1>
              <p className="text-ink-muted mt-6 max-w-lg text-[15px] leading-relaxed">
                DevGraph reads a repository and draws it — imports, calls, classes, components, API
                routes, database schema, and the dependency cycles nobody meant to create. Eight
                languages, no setup, nothing to install.
              </p>

              <div className="mt-8 max-w-xl">
                <RepoInput />
              </div>

              <dl className="mt-10 flex flex-wrap gap-x-8 gap-y-4">
                {[
                  ['10', 'interactive views'],
                  ['8', 'languages parsed'],
                  ['0', 'setup required'],
                ].map(([value, label]) => (
                  <div key={label}>
                    <dt className="sr-only">{label}</dt>
                    <dd className="tabular text-ink text-[26px] leading-none font-medium">
                      {value}
                    </dd>
                    <dd className="text-ink-ghost mt-1.5 text-[11px] tracking-[0.13em] uppercase">
                      {label}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* The signature: a real graph, drawn the way the product draws it. */}
            <div className="relative">
              <div className="glass rounded-xl p-1">
                <div className="grid-field bg-void/60 overflow-hidden rounded-lg">
                  <div className="border-line/60 flex items-center justify-between border-b px-3 py-2">
                    <span className="tabular text-ink-ghost text-[11px]">
                      acme-shop · import graph
                    </span>
                    <span className="text-ink-ghost flex items-center gap-1.5 text-[10.5px]">
                      <span className="bg-cycle size-1.5 rounded-full" />1 cycle
                    </span>
                  </div>
                  <HeroGraph className="h-auto w-full" />
                </div>
              </div>
              <p className="text-ink-ghost mt-3 text-center text-[11px]">
                Hover a node to isolate its neighbourhood — the same interaction as the workspace.
              </p>
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- views */}
        <section id="views" className="border-line/70 bg-pit/40 border-y">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <Eyebrow>Ten views of one repository</Eyebrow>
            <h2 className="font-display text-ink mt-3 max-w-2xl text-[clamp(1.6rem,3.4vw,2.3rem)] leading-tight font-semibold">
              One analysis, ten ways to look at it.
            </h2>
            <p className="text-ink-muted mt-3 max-w-xl text-[14px] leading-relaxed">
              Each view answers a different question. Switching between them keeps your selection,
              so you can follow one file from the folder tree into the call graph without losing it.
            </p>

            <ul className="border-line bg-line mt-10 grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-3">
              {VIEWS.map(({ icon: Icon, name, line }) => (
                <li
                  key={name}
                  className="group bg-surface hover:bg-raised flex gap-3 px-5 py-5 transition-colors"
                >
                  <Icon className="text-ink-ghost group-hover:text-edge mt-0.5 size-4 shrink-0 transition-colors" />
                  <div className="min-w-0">
                    <h3 className="text-ink text-[13.5px] font-medium">{name}</h3>
                    <p className="text-ink-faint mt-1 text-[12.5px] leading-relaxed">{line}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ----------------------------------------------------- languages */}
        <section className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div>
              <Eyebrow>What it reads</Eyebrow>
              <h2 className="font-display text-ink mt-3 text-[clamp(1.6rem,3.4vw,2.3rem)] leading-tight font-semibold">
                Eight languages, one model.
              </h2>
              <p className="text-ink-muted mt-3 max-w-md text-[14px] leading-relaxed">
                Every parser produces the same structural record — imports, exports, symbols, calls,
                configuration — so a polyglot repository draws as one graph instead of several.
              </p>

              <ul className="mt-8 flex flex-wrap gap-2">
                {LANGUAGES.map((language) => (
                  <li
                    key={language.id}
                    className="border-line bg-raised flex items-center gap-2 rounded-sm border px-2.5 py-1.5"
                  >
                    <span
                      className="size-2 rounded-[2px]"
                      style={{ backgroundColor: LANGUAGE_COLORS[language.id] }}
                    />
                    <span className="text-ink-muted text-[12.5px]">{language.label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-ink-ghost mt-4 text-[12px]">
                Adding a language is one file plus one registry line.
              </p>
            </div>

            <ul className="border-line bg-line grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2">
              {READS.map((item) => (
                <li key={item.title} className="bg-surface p-5">
                  <h3 className="text-ink text-[13.5px] font-medium">{item.title}</h3>
                  <p className="text-ink-faint mt-2 text-[12.5px] leading-relaxed">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------------------ how */}
        <section id="how" className="border-line/70 bg-pit/40 border-t">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <Eyebrow>How it works</Eyebrow>
            <h2 className="font-display text-ink mt-3 text-[clamp(1.6rem,3.4vw,2.3rem)] leading-tight font-semibold">
              Nothing is cloned, executed, or kept.
            </h2>

            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {[
                {
                  step: 'Fetch',
                  body: 'The repository archive is downloaded into memory. Paths are sanitised, binaries and vendored directories are dropped, and size caps are enforced before a single byte is parsed.',
                },
                {
                  step: 'Analyse',
                  body: 'Files are parsed, imports resolved, cycles found with Tarjan, metrics computed and ten graphs built — in one pass, streaming progress as it goes. No code is ever executed.',
                },
                {
                  step: 'Explore',
                  body: 'The result is yours to zoom, filter, search and export as SVG, PNG, PDF, JSON or Mermaid. Without a database configured, it lives only in the running process.',
                },
              ].map((item, index) => (
                <li key={item.step} className="border-line relative border-t pt-5">
                  {/* The number is real sequence information, so it earns its place. */}
                  <span className="tabular bg-edge absolute -top-px left-0 h-px w-8" aria-hidden />
                  <div className="flex items-baseline gap-2.5">
                    <span className="tabular text-edge text-[11px]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="text-ink text-[14px] font-medium">{item.step}</h3>
                  </div>
                  <p className="text-ink-faint mt-2.5 text-[13px] leading-relaxed">{item.body}</p>
                </li>
              ))}
            </ol>

            <div className="border-line bg-surface/60 mt-12 flex flex-wrap items-center gap-3 rounded-lg border px-5 py-4">
              <Braces className="text-ink-ghost size-4" />
              <p className="text-ink-muted flex-1 text-[13px]">
                This instance runs{' '}
                <span className="text-ink">{flags.persistence ? 'with' : 'without'}</span> a
                database, <span className="text-ink">{flags.auth ? 'with' : 'without'}</span>{' '}
                accounts, and <span className="text-ink">{flags.ai ? 'with' : 'without'}</span> AI
                insights.
                {flags.ai ? null : ' Deterministic analysis covers every section regardless.'}
              </p>
              <Button variant="subtle" size="sm" asChild>
                <a
                  href="https://github.com/itsshreyasbhardwaj-design/devgraph#configuration"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Configure
                </a>
              </Button>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ cta */}
        <section className="mx-auto max-w-3xl px-5 py-24 text-center">
          <GitCompare className="text-ink-ghost mx-auto size-5" />
          <h2 className="font-display text-ink mt-5 text-[clamp(1.7rem,4vw,2.6rem)] leading-tight font-semibold">
            Point it at a repository you have never read.
          </h2>
          <p className="text-ink-muted mx-auto mt-3 max-w-md text-[14px] leading-relaxed">
            The first graph usually arrives before you have finished reading the README.
          </p>
          <div className="mx-auto mt-8 max-w-xl text-left">
            <RepoInput />
          </div>
        </section>
      </main>

      <footer className="border-line/70 relative z-10 border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Mark />
            <span className="text-ink-faint text-[13px]">
              DevGraph — MIT licensed, contributions welcome.
            </span>
          </div>
          <div className="text-ink-faint flex items-center gap-4 text-[12.5px]">
            <a
              className="hover:text-ink transition-colors"
              href="https://github.com/itsshreyasbhardwaj-design/devgraph"
              target="_blank"
              rel="noreferrer noopener"
            >
              Source
            </a>
            <a
              className="hover:text-ink transition-colors"
              href="https://github.com/itsshreyasbhardwaj-design/devgraph/blob/main/CONTRIBUTING.md"
              target="_blank"
              rel="noreferrer noopener"
            >
              Contributing
            </a>
            <Link className="hover:text-ink transition-colors" href="/api/health">
              Status
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** The product mark: three nodes and the two edges between them. */
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M5 5 L15 10 M15 10 L5 15" stroke="var(--color-line-strong)" strokeWidth="1.2" />
      <circle cx="5" cy="5" r="2.6" fill="var(--color-edge)" />
      <circle cx="15" cy="10" r="2.6" fill="var(--color-stable)" />
      <circle cx="5" cy="15" r="2.6" fill="var(--color-signal)" />
    </svg>
  );
}
