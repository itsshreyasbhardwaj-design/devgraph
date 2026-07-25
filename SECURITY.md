# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security vulnerability.

Report it privately through
[GitHub Security Advisories](https://github.com/itsshreyasbhardwaj-design/devgraph/security/advisories/new).

Please include:

- What the vulnerability allows an attacker to do
- Steps to reproduce, ideally with a minimal proof of concept
- The affected version or commit

You can expect an acknowledgement within a few days and an assessment within two
weeks. We will keep you informed as a fix progresses and will credit you in the
advisory unless you prefer otherwise.

## Scope

DevGraph analyses untrusted repositories, so the areas we care most about are:

- **Archive handling** — path traversal, decompression bombs, resource
  exhaustion during ingestion
- **Server-side request forgery** via the repository reference
- **Cross-site scripting** through analysed content or model output surfacing in
  the UI
- **Injection** in the Postgres storage adapter
- **Information disclosure** — one user's analysis reachable by another
- **Denial of service** — an input that hangs or exhausts the analysis pipeline

## Design guarantees

These are the properties DevGraph intends to hold. A reproducible break in any
of them is a valid vulnerability report.

1. **Repository code is never executed.** No cloning to disk, no build, no
   evaluation. Analysis is purely lexical and structural.
2. **Archive contents cannot escape their logical root.** Every entry path is
   sanitised in one place before it is used.
3. **Environment variable _values_ are never read.** Only names, declaration
   sites and usage sites are recorded, so a committed `.env` cannot leak values
   through an analysis result.
4. **No API key reaches the browser.** Only an explicit allow-list of feature
   flags is exposed to the client.
5. **Owned analyses are private to their owner** when authentication is
   configured.
6. **Model output cannot inject markup.** The Markdown renderer emits React
   elements; there is no `dangerouslySetInnerHTML` in the codebase.

## Deployment notes

- Rate limiting is **in-process**. On a multi-instance deployment it becomes
  per-instance rather than global. Put a shared limiter in front of a public
  instance.
- `DEVGRAPH_ALLOW_LOCAL` lets the server read directories on its own
  filesystem. Leave it off on any instance you do not fully control, and set
  `DEVGRAPH_LOCAL_ROOTS` if you do enable it.
- Without `DATABASE_URL`, analyses are held in memory and are visible to anyone
  who can reach the instance.
