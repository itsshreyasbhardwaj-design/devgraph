#!/usr/bin/env node
/**
 * Builds the ZIP archive the end-to-end suite analyses.
 *
 * Generated rather than committed as a binary so the fixture's contents are
 * reviewable in a diff, and so a change to it shows up as a change to source.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));

const files = {
  'sample-repo/package.json': JSON.stringify(
    {
      name: 'sample-repo',
      description: 'Fixture repository for DevGraph end-to-end tests',
      license: 'MIT',
      main: 'src/index.ts',
      dependencies: { react: '19.0.0', zod: '3.23.0' },
      devDependencies: { typescript: '5.6.0', vitest: '2.0.0' },
    },
    null,
    2,
  ),
  'sample-repo/tsconfig.json': JSON.stringify(
    { compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } },
    null,
    2,
  ),
  'sample-repo/.env.example': 'API_TOKEN=\nDATABASE_URL=\n',
  'sample-repo/README.md': '# sample-repo\n\nA fixture.\n',

  'sample-repo/src/index.ts': `import { greet } from '@/lib/greeting';
import { Repository } from '@/lib/repository';

export function main(): void {
  const repo = new Repository();
  console.log(greet(repo.first()));
}
`,

  'sample-repo/src/lib/greeting.ts': `// Greeting helpers.
export function greet(name: string): string {
  if (!name) return 'Hello, stranger';
  if (name.length > 40) return 'Hello';
  return 'Hello, ' + name;
}

export function farewell(name: string): string {
  if (!name) return 'Goodbye, stranger';
  return 'Goodbye, ' + name;
}
`,

  'sample-repo/src/lib/repository.ts': `import { greet } from '@/lib/greeting';

export interface Person {
  id: string;
  name: string;
}

export abstract class BaseStore {
  abstract all(): Person[];
}

export class Repository extends BaseStore {
  private readonly people: Person[] = [{ id: '1', name: 'Ada' }];

  all(): Person[] {
    return this.people;
  }

  first(): string {
    const person = this.people[0];
    return person ? greet(person.name) : 'nobody';
  }
}
`,

  'sample-repo/src/lib/branchy.ts': `// TODO: simplify this once the tier table moves to config.
export function classify(value: number, tier: string, flag?: boolean): string {
  if (tier === 'a') {
    if (value > 100) return 'a-high';
    if (value > 50) return 'a-mid';
    return 'a-low';
  }
  if (tier === 'b') {
    if (value > 100 && flag) return 'b-high-flag';
    if (value > 100) return 'b-high';
    return 'b-low';
  }
  for (let i = 0; i < value; i += 1) {
    if (i % 7 === 0) return 'seven';
  }
  return flag ? 'flagged' : 'plain';
}
`,

  'sample-repo/src/app/api/people/route.ts': `import { Repository } from '@/lib/repository';

export async function GET() {
  const token = process.env.API_TOKEN;
  return Response.json({ people: new Repository().all(), token: Boolean(token) });
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.name) return Response.json({ error: 'name required' }, { status: 400 });
  return Response.json({ ok: true });
}
`,

  'sample-repo/src/components/PersonCard.tsx': `export function PersonCard({ name }: { name: string }) {
  return <li className="card">{name}</li>;
}
`,

  'sample-repo/src/components/PersonList.tsx': `import { PersonCard } from '@/components/PersonCard';

export function PersonList({ names }: { names: string[] }) {
  return (
    <ul>
      {names.map((name) => (
        <PersonCard key={name} name={name} />
      ))}
    </ul>
  );
}
`,

  'sample-repo/prisma/schema.prisma': `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Person {
  id    String @id @default(cuid())
  name  String
  notes Note[]
}

model Note {
  id       String @id @default(cuid())
  personId String
  person   Person @relation(fields: [personId], references: [id])
  body     String
}
`,

  'sample-repo/tests/greeting.test.ts': `import { describe, expect, it } from 'vitest';
import { greet } from '@/lib/greeting';

describe('greet', () => {
  it('greets', () => {
    expect(greet('Ada')).toBe('Hello, Ada');
  });
});
`,
};

const zipped = zipSync(
  Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])),
  { level: 6 },
);

mkdirSync(here, { recursive: true });
const target = join(here, 'sample-repo.zip');
writeFileSync(target, zipped);
console.log(`wrote ${target} (${zipped.byteLength} bytes, ${Object.keys(files).length} files)`);
