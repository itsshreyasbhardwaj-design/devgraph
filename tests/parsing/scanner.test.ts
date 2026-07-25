import { describe, expect, it } from 'vitest';
import { lineAt, SYNTAX_PROFILES, scanSource } from '@/lib/parsing/scanner';

const ts = SYNTAX_PROFILES.typescript;

describe('scanSource', () => {
  it('masks line comments but preserves offsets', () => {
    const source = 'const a = 1; // import x from "y"\nconst b = 2;';
    const scan = scanSource(source, ts);
    expect(scan.code).toHaveLength(source.length);
    expect(scan.code).not.toContain('import');
    expect(scan.code).toContain('const a = 1;');
    expect(scan.code.split('\n')).toHaveLength(2);
  });

  it('masks block comments including multi-line ones', () => {
    const source = `/*\n import fake from "nope";\n*/\nimport real from "yes";`;
    const scan = scanSource(source, ts);
    expect(scan.code).not.toContain('fake');
    expect(scan.code).toContain('import real from');
  });

  it('records string literal values while blanking their bodies', () => {
    const scan = scanSource(`import x from "./module";`, ts);
    const literal = scan.literals[0];
    expect(literal.value).toBe('./module');
    expect(scan.code).toContain('"        "');
  });

  it('does not treat a regex literal as a comment', () => {
    const source = 'const re = /a\\/\\/b/g;\nconst after = 42;';
    const scan = scanSource(source, ts);
    expect(scan.code).toContain('const after = 42;');
    expect(scan.lines.code).toBe(2);
  });

  it('handles template literals with nested interpolation', () => {
    const source = 'const s = `a ${fn(`b ${x}`)} c`;\nconst t = 1;';
    const scan = scanSource(source, ts);
    expect(scan.code).toContain('fn(');
    expect(scan.code).toContain('const t = 1;');
  });

  it('does not confuse an apostrophe inside a comment', () => {
    const source = "// it's fine\nconst value = 1;";
    const scan = scanSource(source, ts);
    expect(scan.code).toContain('const value = 1;');
  });

  it('counts code, comment and blank lines', () => {
    const source = ['const a = 1;', '', '// note', '/* block', '   more */', 'const b = 2;'].join(
      '\n',
    );
    const scan = scanSource(source, ts);
    expect(scan.lines.total).toBe(6);
    expect(scan.lines.code).toBe(2);
    expect(scan.lines.comment).toBe(3);
    expect(scan.lines.blank).toBe(1);
  });

  it('handles python triple-quoted docstrings', () => {
    const source = 'def f():\n    """import nothing"""\n    return 1\n';
    const scan = scanSource(source, SYNTAX_PROFILES.python);
    expect(scan.code).not.toContain('import nothing');
    expect(scan.code).toContain('return 1');
    expect(scan.literals.some((l) => l.kind === 'doc')).toBe(true);
  });

  it('handles go raw backtick strings', () => {
    const source = 'const q = `SELECT * FROM "t"`\nvar x = 1';
    const scan = scanSource(source, SYNTAX_PROFILES.go);
    expect(scan.code).toContain('var x = 1');
    expect(scan.literals[0].value).toContain('SELECT');
  });

  it('handles rust nested block comments', () => {
    const source = '/* outer /* inner */ still comment */\nfn main() {}';
    const scan = scanSource(source, SYNTAX_PROFILES.rust);
    expect(scan.code).toContain('fn main()');
    expect(scan.code).not.toContain('inner');
  });

  it('handles php heredocs', () => {
    const source = '<?php\n$sql = <<<SQL\nSELECT * FROM users;\nSQL;\n$x = 1;\n';
    const scan = scanSource(source, SYNTAX_PROFILES.php);
    expect(scan.code).toContain('$x = 1;');
    expect(scan.code).not.toContain('SELECT * FROM users');
  });

  it('handles c# verbatim strings containing quotes', () => {
    const source = 'var path = @"C:\\dir\\file";\nvar y = 2;';
    const scan = scanSource(source, SYNTAX_PROFILES.csharp);
    expect(scan.code).toContain('var y = 2;');
    expect(scan.literals[0].value).toContain('C:');
  });

  it('maps offsets back to 1-based line numbers', () => {
    const source = 'a\nb\nc';
    const scan = scanSource(source, ts);
    expect(lineAt(scan, 0)).toBe(1);
    expect(lineAt(scan, 2)).toBe(2);
    expect(lineAt(scan, 4)).toBe(3);
  });

  it('is resilient to an unterminated string', () => {
    const scan = scanSource('const a = "oops\nconst b = 2;', ts);
    expect(scan.code).toHaveLength('const a = "oops\nconst b = 2;'.length);
  });
});
