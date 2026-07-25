import type { DbColumn, DbSchema, DbTable, SourceFile } from '@/lib/core/types';
import { basename } from '@/lib/core/paths';

/**
 * Database schema extraction.
 *
 * Handles the declaration styles that actually appear in repositories: Prisma
 * schema files, Drizzle table builders, raw SQL DDL, Django and SQLAlchemy
 * models, TypeORM/Mongoose decorators and JPA/EF entities. Each extractor is
 * independent; the first one that finds tables wins for the reported dialect,
 * but every extractor's tables are merged so polyglot repos are covered.
 */

interface ExtractorResult {
  dialect: string;
  tables: DbTable[];
}

type Extractor = (files: SourceFile[]) => ExtractorResult | undefined;

function tableId(source: string, name: string): string {
  return `table:${source}:${name}`;
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

const prismaExtractor: Extractor = (files) => {
  const tables: DbTable[] = [];
  let provider = 'Prisma';

  for (const file of files) {
    if (!file.path.endsWith('.prisma')) continue;
    const providerMatch = /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/.exec(file.content);
    if (providerMatch) provider = `Prisma (${providerMatch[1]})`;

    for (const match of file.content.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const columns: DbColumn[] = [];
      for (const raw of match[2].split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
        const field = /^(\w+)\s+([\w\[\]?]+)(.*)$/.exec(line);
        if (!field) continue;
        const attributes = field[3] ?? '';
        const relation = /@relation\([^)]*\)/.test(attributes);
        columns.push({
          name: field[1],
          type: field[2].replace('?', ''),
          nullable: field[2].endsWith('?'),
          primaryKey: /@id\b/.test(attributes),
          unique: /@unique\b/.test(attributes),
          default: /@default\(([^)]*)\)/.exec(attributes)?.[1],
          references: relation ? { table: field[2].replace(/[\[\]?]/g, '') } : undefined,
        });
      }
      tables.push({
        id: tableId('prisma', match[1]),
        name: match[1],
        file: file.path,
        line: lineNumberAt(file.content, match.index),
        source: 'prisma',
        columns,
        indexes: [...match[2].matchAll(/@@(?:index|unique)\(\[([^\]]+)\]\)/g)].map((m) => m[1]),
      });
    }
  }

  return tables.length ? { dialect: provider, tables } : undefined;
};

// ---------------------------------------------------------------------------
// Drizzle
// ---------------------------------------------------------------------------

const drizzleExtractor: Extractor = (files) => {
  const tables: DbTable[] = [];

  for (const file of files) {
    if (!/\.(ts|js|mts)$/.test(file.path)) continue;
    if (!/drizzle-orm/.test(file.content)) continue;

    for (const match of file.content.matchAll(
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\s*\(\s*(['"`])([^'"`]+)\2\s*,\s*\{([\s\S]*?)\n\s*\}/g,
    )) {
      const columns: DbColumn[] = [];
      for (const field of match[4].matchAll(/(\w+)\s*:\s*(\w+)\s*\(([^)]*)\)([^,\n]*)/g)) {
        const modifiers = field[4] ?? '';
        const referenceMatch = /references\s*\(\s*\(\)\s*=>\s*(\w+)\.(\w+)/.exec(modifiers);
        columns.push({
          name: field[1],
          type: field[2],
          nullable: !/notNull\(\)/.test(modifiers),
          primaryKey: /primaryKey\(\)/.test(modifiers),
          unique: /\.unique\(\)/.test(modifiers),
          references: referenceMatch
            ? { table: referenceMatch[1], column: referenceMatch[2] }
            : undefined,
        });
      }
      tables.push({
        id: tableId('drizzle', match[3]),
        name: match[3],
        file: file.path,
        line: lineNumberAt(file.content, match.index),
        source: 'drizzle',
        columns,
      });
    }
  }

  return tables.length ? { dialect: 'Drizzle ORM', tables } : undefined;
};

// ---------------------------------------------------------------------------
// Raw SQL DDL
// ---------------------------------------------------------------------------

const SQL_TYPE = /^([\w"`\[\]]+)\s+([A-Za-z][\w ]*(?:\([^)]*\))?)/;

const sqlExtractor: Extractor = (files) => {
  const tables: DbTable[] = [];

  for (const file of files) {
    if (!file.path.endsWith('.sql')) continue;
    for (const match of file.content.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?([\w.]+)["`\]]?\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
    )) {
      const columns: DbColumn[] = [];
      for (const raw of splitSqlColumns(match[2])) {
        const line = raw.trim().replace(/,$/, '');
        if (!line) continue;
        if (/^(PRIMARY|FOREIGN|UNIQUE|CONSTRAINT|CHECK|INDEX|KEY)\b/i.test(line)) {
          const fk =
            /FOREIGN\s+KEY\s*\(\s*["`]?(\w+)["`]?\s*\)\s*REFERENCES\s+["`\[]?([\w.]+)["`\]]?\s*(?:\(\s*["`]?(\w+)["`]?\s*\))?/i.exec(
              line,
            );
          if (fk) {
            const column = columns.find((c) => c.name === fk[1]);
            if (column) column.references = { table: fk[2], column: fk[3] };
          }
          continue;
        }
        const typeMatch = SQL_TYPE.exec(line);
        if (!typeMatch) continue;
        const inlineRef =
          /REFERENCES\s+["`\[]?([\w.]+)["`\]]?\s*(?:\(\s*["`]?(\w+)["`]?\s*\))?/i.exec(line);
        columns.push({
          name: typeMatch[1].replace(/["`\[\]]/g, ''),
          type: typeMatch[2].trim(),
          nullable: !/NOT\s+NULL/i.test(line),
          primaryKey: /PRIMARY\s+KEY/i.test(line),
          unique: /\bUNIQUE\b/i.test(line),
          default: /DEFAULT\s+([^\s,]+)/i.exec(line)?.[1],
          references: inlineRef ? { table: inlineRef[1], column: inlineRef[2] } : undefined,
        });
      }
      const name = match[1].replace(/["`\[\]]/g, '');
      tables.push({
        id: tableId('sql', name),
        name,
        file: file.path,
        line: lineNumberAt(file.content, match.index),
        source: 'sql',
        columns,
      });
    }
  }

  return tables.length ? { dialect: 'SQL', tables } : undefined;
};

/** Split a CREATE TABLE body on commas that are not inside parentheses. */
function splitSqlColumns(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// ---------------------------------------------------------------------------
// Django models
// ---------------------------------------------------------------------------

const djangoExtractor: Extractor = (files) => {
  const tables: DbTable[] = [];

  for (const file of files) {
    if (!file.path.endsWith('.py') || !/models\.Model|models\.\w+Field/.test(file.content))
      continue;

    for (const match of file.content.matchAll(
      /^class\s+(\w+)\s*\(\s*[\w.]*Model[^)]*\)\s*:\s*\n([\s\S]*?)(?=^class\s|\Z)/gm,
    )) {
      const columns: DbColumn[] = [];
      for (const field of match[2].matchAll(/^\s{4}(\w+)\s*=\s*models\.(\w+)\(([^\n]*)/gm)) {
        const args = field[3] ?? '';
        const relation = /^(ForeignKey|OneToOneField|ManyToManyField)$/.test(field[2]);
        const target = relation ? /\(\s*["']?(\w+)["']?/.exec(`(${args}`)?.[1] : undefined;
        columns.push({
          name: field[1],
          type: field[2],
          nullable: /null\s*=\s*True/.test(args),
          primaryKey: /primary_key\s*=\s*True/.test(args),
          unique: /unique\s*=\s*True/.test(args),
          default: /default\s*=\s*([^,)\s]+)/.exec(args)?.[1],
          references: target ? { table: target } : undefined,
        });
      }
      if (!columns.length) continue;
      tables.push({
        id: tableId('django', match[1]),
        name: match[1],
        file: file.path,
        line: lineNumberAt(file.content, match.index),
        source: 'django',
        columns,
      });
    }
  }

  return tables.length ? { dialect: 'Django ORM', tables } : undefined;
};

// ---------------------------------------------------------------------------
// SQLAlchemy
// ---------------------------------------------------------------------------

const sqlalchemyExtractor: Extractor = (files) => {
  const tables: DbTable[] = [];

  for (const file of files) {
    if (!file.path.endsWith('.py') || !/sqlalchemy/i.test(file.content)) continue;

    for (const match of file.content.matchAll(
      /^class\s+(\w+)\s*\([^)]*\)\s*:\s*\n([\s\S]*?)(?=^class\s|\Z)/gm,
    )) {
      const nameMatch = /__tablename__\s*=\s*["']([^"']+)["']/.exec(match[2]);
      if (!nameMatch) continue;
      const columns: DbColumn[] = [];
      for (const field of match[2].matchAll(
        /^\s+(\w+)\s*(?::\s*[^=]+)?=\s*(?:mapped_column|Column)\s*\(([^\n]*)/gm,
      )) {
        const args = field[2] ?? '';
        const fk = /ForeignKey\(\s*["']([\w.]+)["']/.exec(args);
        columns.push({
          name: field[1],
          type: /^\s*(\w+)/.exec(args)?.[1] ?? 'Column',
          nullable: !/nullable\s*=\s*False/.test(args),
          primaryKey: /primary_key\s*=\s*True/.test(args),
          unique: /unique\s*=\s*True/.test(args),
          references: fk ? { table: fk[1].split('.')[0], column: fk[1].split('.')[1] } : undefined,
        });
      }
      tables.push({
        id: tableId('sqlalchemy', nameMatch[1]),
        name: nameMatch[1],
        file: file.path,
        line: lineNumberAt(file.content, match.index),
        source: 'sqlalchemy',
        columns,
      });
    }
  }

  return tables.length ? { dialect: 'SQLAlchemy', tables } : undefined;
};

// ---------------------------------------------------------------------------
// Mongoose
// ---------------------------------------------------------------------------

const mongooseExtractor: Extractor = (files) => {
  const tables: DbTable[] = [];

  for (const file of files) {
    if (!/\.(ts|js)$/.test(file.path) || !/mongoose/.test(file.content)) continue;

    for (const match of file.content.matchAll(
      /(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\s*(?:<[^>]*>)?\s*\(\s*\{([\s\S]*?)\n\s*\}/g,
    )) {
      const columns: DbColumn[] = [];
      for (const field of match[2].matchAll(
        /(\w+)\s*:\s*\{?\s*(?:type\s*:\s*)?([\w.\[\]]+)([^,\n]*)/g,
      )) {
        const modifiers = field[3] ?? '';
        const ref = /ref\s*:\s*['"](\w+)['"]/.exec(modifiers);
        columns.push({
          name: field[1],
          type: field[2],
          nullable: !/required\s*:\s*true/.test(modifiers),
          unique: /unique\s*:\s*true/.test(modifiers),
          references: ref ? { table: ref[1] } : undefined,
        });
      }
      const name = match[1].replace(/Schema$/i, '');
      tables.push({
        id: tableId('mongoose', name),
        name,
        file: file.path,
        line: lineNumberAt(file.content, match.index),
        source: 'mongoose',
        columns,
      });
    }
  }

  return tables.length ? { dialect: 'MongoDB (Mongoose)', tables } : undefined;
};

// ---------------------------------------------------------------------------
// TypeORM / JPA / EF Core entities
// ---------------------------------------------------------------------------

const entityExtractor: Extractor = (files) => {
  const tables: DbTable[] = [];

  for (const file of files) {
    const isTs = /\.ts$/.test(file.path) && /@Entity\b/.test(file.content);
    const isJava = /\.java$/.test(file.path) && /@Entity\b/.test(file.content);
    const isCs = /\.cs$/.test(file.path) && /\[Table\(|DbSet</.test(file.content);
    if (!isTs && !isJava && !isCs) continue;

    const source = isTs ? 'typeorm' : isJava ? 'jpa' : 'efcore';
    const classPattern = isCs
      ? /class\s+(\w+)\s*(?::[^{]*)?\{([\s\S]*?)\n\}/g
      : /class\s+(\w+)[^{]*\{([\s\S]*?)\n\}/g;

    for (const match of file.content.matchAll(classPattern)) {
      const body = match[2];
      const columns: DbColumn[] = [];

      if (isTs) {
        for (const field of body.matchAll(
          /@(PrimaryGeneratedColumn|PrimaryColumn|Column|ManyToOne|OneToMany|OneToOne|ManyToMany)\s*\(([^)]*)\)[\s\S]{0,120}?(\w+)\s*[!?]?\s*:\s*([\w<>\[\]]+)/g,
        )) {
          const isRelation = /Many|One/.test(field[1]);
          columns.push({
            name: field[3],
            type: field[4],
            primaryKey: field[1].startsWith('Primary'),
            nullable: /nullable\s*:\s*true/.test(field[2]),
            references: isRelation ? { table: field[4].replace(/[\[\]]/g, '') } : undefined,
          });
        }
      } else if (isJava) {
        for (const field of body.matchAll(
          /@(Id|Column|ManyToOne|OneToMany|OneToOne|JoinColumn)[^\n]*\n\s*(?:private|public|protected)\s+([\w<>.]+)\s+(\w+)/g,
        )) {
          columns.push({
            name: field[3],
            type: field[2],
            primaryKey: field[1] === 'Id',
            references: /Many|One/.test(field[1])
              ? { table: field[2].replace(/.*<|>.*/g, '') }
              : undefined,
          });
        }
      } else {
        for (const field of body.matchAll(
          /public\s+(?:virtual\s+)?([\w<>?\[\]]+)\s+(\w+)\s*\{\s*get/g,
        )) {
          columns.push({ name: field[2], type: field[1], primaryKey: /^Id$/i.test(field[2]) });
        }
      }

      if (!columns.length) continue;
      tables.push({
        id: tableId(source, match[1]),
        name: match[1],
        file: file.path,
        line: lineNumberAt(file.content, match.index),
        source,
        columns,
      });
    }
  }

  return tables.length ? { dialect: labelFor(tables[0].source), tables } : undefined;
};

function labelFor(source: string): string {
  const labels: Record<string, string> = {
    typeorm: 'TypeORM',
    jpa: 'JPA / Hibernate',
    efcore: 'Entity Framework Core',
  };
  return labels[source] ?? source;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const EXTRACTORS: Extractor[] = [
  prismaExtractor,
  drizzleExtractor,
  sqlExtractor,
  djangoExtractor,
  sqlalchemyExtractor,
  mongooseExtractor,
  entityExtractor,
];

export function extractSchema(files: SourceFile[]): DbSchema {
  const tables: DbTable[] = [];
  const dialects: string[] = [];

  for (const extractor of EXTRACTORS) {
    const result = extractor(files);
    if (!result) continue;
    dialects.push(result.dialect);
    tables.push(...result.tables);
  }

  // Resolve foreign keys to table ids.
  const byName = new Map<string, string>();
  for (const table of tables) {
    byName.set(table.name.toLowerCase(), table.id);
    // `users` ↔ `User` naming conventions.
    byName.set(table.name.toLowerCase().replace(/s$/, ''), table.id);
  }

  const relations: DbSchema['relations'] = [];
  const seen = new Set<string>();

  for (const table of tables) {
    for (const column of table.columns) {
      if (!column.references) continue;
      const target =
        byName.get(column.references.table.toLowerCase()) ??
        byName.get(column.references.table.toLowerCase().replace(/s$/, ''));
      if (!target || target === table.id) continue;
      const id = `${table.id}->${target}:${column.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      relations.push({ id, from: table.id, to: target, label: column.name });
    }
  }

  return {
    dialect: dialects.length ? [...new Set(dialects)].join(', ') : 'none detected',
    tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
    relations,
  };
}

/** Files worth handing to the schema extractors — keeps the scan cheap. */
export function isSchemaCandidate(path: string): boolean {
  const base = basename(path).toLowerCase();
  if (path.endsWith('.prisma') || path.endsWith('.sql')) return true;
  if (/^(models?|schema|entities|entity)\b/.test(base)) return true;
  return /\.(ts|js|py|java|cs)$/.test(path);
}
