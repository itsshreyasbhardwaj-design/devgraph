import { describe, expect, it } from 'vitest';
import { typescriptParser } from '@/lib/parsing/languages/typescript';

function parse(content: string, path = 'src/example.ts') {
  return typescriptParser.parse({ path, content, bytes: content.length });
}

describe('typescript parser', () => {
  it('extracts every import form', () => {
    const result = parse(`
import React from 'react';
import { useState, useEffect as effect } from 'react';
import * as path from 'node:path';
import type { Foo } from './types';
import './styles.css';
const lazy = await import('./lazy');
const cjs = require('./cjs');
export { helper } from './helper';
export * from './all';
    `);

    const specifiers = result.imports.map((i) => i.specifier);
    expect(specifiers).toContain('react');
    expect(specifiers).toContain('node:path');
    expect(specifiers).toContain('./types');
    expect(specifiers).toContain('./styles.css');
    expect(specifiers).toContain('./lazy');
    expect(specifiers).toContain('./cjs');
    expect(specifiers).toContain('./helper');
    expect(specifiers).toContain('./all');

    const named = result.imports.find((i) => i.symbols.includes('useState'));
    expect(named?.symbols).toContain('useEffect');
    expect(result.imports.find((i) => i.specifier === './types')?.kind).toBe('type');
    expect(result.imports.find((i) => i.specifier === './lazy')?.kind).toBe('dynamic');
    expect(result.imports.find((i) => i.specifier === './styles.css')?.kind).toBe('side-effect');
  });

  it('ignores imports inside comments and strings', () => {
    const result = parse(`
// import ghost from 'ghost';
/* import phantom from 'phantom'; */
const sample = "import spectre from 'spectre';";
import real from './real';
    `);
    expect(result.imports.map((i) => i.specifier)).toEqual(['./real']);
  });

  it('extracts classes with inheritance and methods', () => {
    const result = parse(`
export abstract class BaseService extends Core implements Disposable, Loggable {
  private cache = new Map();

  constructor(private readonly deps: Deps) { super(); }

  public async fetch(id: string): Promise<Item> {
    if (this.cache.has(id)) return this.cache.get(id);
    return this.deps.http.get(id);
  }

  static create(): BaseService { return new BaseService(); }
}
    `);

    const cls = result.symbols.find((s) => s.name === 'BaseService');
    expect(cls?.kind).toBe('class');
    expect(cls?.isAbstract).toBe(true);
    expect(cls?.isExported).toBe(true);
    expect(cls?.extends).toEqual(['Core']);
    expect(cls?.implements).toEqual(['Disposable', 'Loggable']);

    const fetchMethod = result.symbols.find((s) => s.name === 'fetch');
    expect(fetchMethod?.kind).toBe('method');
    expect(fetchMethod?.container).toBe('BaseService');
    expect(fetchMethod?.isAsync).toBe(true);
    expect(fetchMethod?.visibility).toBe('public');
    expect(fetchMethod?.complexity).toBeGreaterThan(1);

    const staticMethod = result.symbols.find((s) => s.name === 'create');
    expect(staticMethod?.isStatic).toBe(true);
  });

  it('extracts interfaces, enums and type aliases', () => {
    const result = parse(`
export interface User extends Base { id: string }
export enum Role { Admin, User }
export type Handler = (req: Request) => Response;
    `);
    expect(result.symbols.find((s) => s.name === 'User')?.kind).toBe('interface');
    expect(result.symbols.find((s) => s.name === 'User')?.extends).toEqual(['Base']);
    expect(result.symbols.find((s) => s.name === 'Role')?.kind).toBe('enum');
    expect(result.symbols.find((s) => s.name === 'Handler')?.kind).toBe('type');
  });

  it('classifies React components and hooks', () => {
    const result = typescriptParser.parse({
      path: 'src/Button.tsx',
      bytes: 0,
      content: `
export function Button({ label }: Props) {
  return <button className="x">{label}</button>;
}

export const Card = ({ children }: Props) => {
  return (
    <div>
      <Button label="ok" />
      {children}
    </div>
  );
};

export function useToggle(initial: boolean) {
  const [on, setOn] = useState(initial);
  return [on, () => setOn(!on)] as const;
}

export function plainHelper(a: number) { return a * 2; }
      `,
    });

    expect(result.symbols.find((s) => s.name === 'Button')?.kind).toBe('component');
    expect(result.symbols.find((s) => s.name === 'Card')?.kind).toBe('component');
    expect(result.symbols.find((s) => s.name === 'useToggle')?.kind).toBe('hook');
    expect(result.symbols.find((s) => s.name === 'plainHelper')?.kind).toBe('function');
  });

  it('collects call sites attributed to the enclosing symbol', () => {
    const result = parse(`
function outer() {
  helper();
  service.load();
}
function other() {
  helper();
}
    `);
    const fromOuter = result.calls.filter((c) => c.from === 'outer').map((c) => c.to);
    expect(fromOuter).toContain('helper');
    expect(fromOuter).toContain('load');
    expect(result.calls.some((c) => c.from === 'other' && c.to === 'helper')).toBe(true);
    expect(result.calls.find((c) => c.to === 'load')?.receiver).toBe('service');
  });

  it('collects environment variable references', () => {
    const result = parse(`
const key = process.env.API_KEY;
const url = process.env['DATABASE_URL'];
const mode = import.meta.env.MODE;
    `);
    const names = result.envRefs.map((r) => r.name);
    expect(names).toContain('API_KEY');
    expect(names).toContain('DATABASE_URL');
    expect(names).toContain('MODE');
  });

  it('computes line counts and complexity', () => {
    const result = parse(`
// comment
export function branchy(a: number) {
  if (a > 1 && a < 10) return 1;
  for (let i = 0; i < a; i++) {
    if (i % 2 === 0) continue;
  }
  return a ? 2 : 3;
}
    `);
    expect(result.loc.comment).toBe(1);
    expect(result.complexity).toBeGreaterThanOrEqual(6);
    const fn = result.symbols.find((s) => s.name === 'branchy');
    expect(fn?.complexity).toBeGreaterThanOrEqual(5);
    expect(fn?.maxNesting).toBeGreaterThanOrEqual(2);
  });

  it('records exports', () => {
    const result = parse(`
export const a = 1;
export function b() {}
export default class C {}
export { d, e as f };
    `);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toContain('C');
    expect(names).toContain('f');
  });

  it('never throws on malformed input', () => {
    expect(() => parse('export class {{{ unbalanced')).not.toThrow();
    expect(() => parse('')).not.toThrow();
  });
});
