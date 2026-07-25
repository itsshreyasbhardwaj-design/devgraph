import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { sanitizePath, decodeEntries } from '@/lib/ingest/decode';
import { parseRepoInput } from '@/lib/ingest/github';
import { ingestZip, validateUpload } from '@/lib/ingest/zip';
import { readTar, stripRootDirectory } from '@/lib/ingest/tar';
import { DEFAULT_INGEST_LIMITS, IngestError } from '@/lib/ingest/types';

describe('sanitizePath', () => {
  it('accepts ordinary repository paths', () => {
    expect(sanitizePath('src/lib/index.ts')).toBe('src/lib/index.ts');
    expect(sanitizePath('./src/a.ts')).toBe('src/a.ts');
    expect(sanitizePath('a\\b\\c.ts')).toBe('a/b/c.ts');
  });

  it('rejects path traversal and absolute paths', () => {
    expect(sanitizePath('../../etc/passwd')).toBeUndefined();
    expect(sanitizePath('src/../../secret')).toBeUndefined();
    expect(sanitizePath('/etc/passwd')).toBeUndefined();
    expect(sanitizePath('C:/Windows/system32')).toBeUndefined();
    expect(sanitizePath('//server/share')).toBeUndefined();
    expect(sanitizePath('a/\0b')).toBeUndefined();
    expect(sanitizePath('')).toBeUndefined();
    expect(sanitizePath('dir/')).toBeUndefined();
  });

  it('rejects absurdly long paths', () => {
    expect(sanitizePath(`${'a/'.repeat(300)}file.ts`)).toBeUndefined();
  });
});

describe('decodeEntries', () => {
  const encode = (text: string) => new TextEncoder().encode(text);

  it('keeps text files and drops binaries, vendored paths and oversized files', () => {
    const outcome = decodeEntries(
      [
        { name: 'src/a.ts', size: 10, read: () => encode('const a = 1;') },
        { name: 'node_modules/pkg/index.js', size: 10, read: () => encode('module.exports={}') },
        { name: 'assets/logo.png', size: 10, read: () => encode('PNG') },
        { name: 'bin/blob.txt', size: 10, read: () => new Uint8Array([1, 2, 0, 3]) },
        { name: '../escape.ts', size: 10, read: () => encode('nope') },
        { name: 'huge.ts', size: 99_999_999, read: () => encode('x') },
      ],
      DEFAULT_INGEST_LIMITS,
    );

    expect(outcome.files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(outcome.skipped).toBe(5);
    expect(outcome.warnings.join(' ')).toContain('per-file limit');
  });

  it('stops once the total byte budget is exhausted', () => {
    const big = 'x'.repeat(1000);
    const entries = Array.from({ length: 50 }, (_, i) => ({
      name: `src/file${i}.ts`,
      size: 1000,
      read: () => encode(big),
    }));
    const outcome = decodeEntries(entries, { ...DEFAULT_INGEST_LIMITS, maxTotalBytes: 5000 });
    expect(outcome.files.length).toBeLessThanOrEqual(5);
    expect(outcome.warnings.some((w) => w.includes('Stopped reading'))).toBe(true);
  });
});

describe('parseRepoInput', () => {
  it('accepts every common GitHub reference form', () => {
    expect(parseRepoInput('vercel/next.js')).toMatchObject({ owner: 'vercel', repo: 'next.js' });
    expect(parseRepoInput('https://github.com/vercel/next.js')).toMatchObject({
      owner: 'vercel',
      repo: 'next.js',
    });
    expect(parseRepoInput('github.com/facebook/react')).toMatchObject({
      owner: 'facebook',
      repo: 'react',
    });
    expect(parseRepoInput('https://github.com/vercel/next.js/tree/canary')).toMatchObject({
      owner: 'vercel',
      repo: 'next.js',
      ref: 'canary',
    });
    expect(parseRepoInput('git@github.com:vercel/next.js.git')).toMatchObject({
      owner: 'vercel',
      repo: 'next.js',
    });
    expect(parseRepoInput('owner/repo@v1.2.3')).toMatchObject({ ref: 'v1.2.3' });
  });

  it('rejects malformed and hostile input', () => {
    for (const input of [
      '',
      '   ',
      'not a repo',
      'https://evil.com/a/b',
      'owner/repo; rm -rf /',
      '../../etc/passwd',
      `${'a'.repeat(60)}/repo`,
    ]) {
      expect(() => parseRepoInput(input), input).toThrow(IngestError);
    }
  });
});

describe('tar reader', () => {
  it('reads entries and strips the archive root directory', () => {
    const tar = buildTar([
      { name: 'repo-abc123/README.md', content: '# hi' },
      { name: 'repo-abc123/src/index.ts', content: 'export const x = 1;' },
    ]);
    const entries = stripRootDirectory(readTar(tar));
    expect(entries.map((e) => e.name)).toEqual(['README.md', 'src/index.ts']);
    expect(new TextDecoder().decode(entries[1].data)).toBe('export const x = 1;');
  });

  it('stops at the terminating zero blocks', () => {
    const tar = buildTar([{ name: 'a.txt', content: 'a' }]);
    expect(readTar(tar)).toHaveLength(1);
  });

  it('honours the entry-size limit', () => {
    const tar = buildTar([{ name: 'big.txt', content: 'x'.repeat(2000) }]);
    expect(readTar(tar, { maxEntryBytes: 100 })).toHaveLength(0);
  });
});

describe('ingestZip', () => {
  it('reads a zip archive and strips its common root', () => {
    const encoder = new TextEncoder();
    const zip = zipSync({
      'my-app/package.json': encoder.encode('{"name":"my-app"}'),
      'my-app/src/index.ts': encoder.encode('export const a = 1;'),
      'my-app/node_modules/dep/index.js': encoder.encode('skip me'),
    });

    const result = ingestZip({ data: zip, filename: 'my-app.zip' });
    expect(result.source.kind).toBe('zip');
    expect(result.source.label).toBe('my-app');
    expect(result.files.map((f) => f.path).sort()).toEqual(['package.json', 'src/index.ts']);
  });

  it('rejects non-zip payloads', () => {
    expect(() =>
      ingestZip({ data: new TextEncoder().encode('not a zip at all!!!!!!'), filename: 'x.zip' }),
    ).toThrow(IngestError);
    expect(() => ingestZip({ data: new Uint8Array(4), filename: 'x.zip' })).toThrow(IngestError);
  });

  it('rejects an archive with no analysable files', () => {
    const zip = zipSync({ 'x/logo.png': new Uint8Array([1, 2, 3]) });
    expect(() => ingestZip({ data: zip, filename: 'x.zip' })).toThrow(IngestError);
  });
});

describe('validateUpload', () => {
  it('accepts a plausible zip', () => {
    expect(() =>
      validateUpload({ size: 1024, name: 'repo.zip', type: 'application/zip' }),
    ).not.toThrow();
  });

  it('rejects wrong types, empty files and oversized uploads', () => {
    expect(() =>
      validateUpload({ size: 1024, name: 'repo.tar.gz', type: 'application/gzip' }),
    ).toThrow();
    expect(() => validateUpload({ size: 0, name: 'repo.zip', type: 'application/zip' })).toThrow();
    expect(() =>
      validateUpload({ size: 999_999_999, name: 'repo.zip', type: 'application/zip' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------

interface TarFile {
  name: string;
  content: string;
}

/** Build a minimal ustar archive so the reader is tested against real bytes. */
function buildTar(files: TarFile[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const file of files) {
    const data = encoder.encode(file.content);
    const header = new Uint8Array(512);
    const write = (text: string, offset: number, length: number) => {
      const bytes = encoder.encode(text);
      header.set(bytes.subarray(0, length), offset);
    };

    write(file.name, 0, 100);
    write('0000644\0', 100, 8);
    write('0000000\0', 108, 8);
    write('0000000\0', 116, 8);
    write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    write('00000000000\0', 136, 12);
    write('        ', 148, 8); // checksum placeholder
    header[156] = '0'.charCodeAt(0);
    write('ustar\0', 257, 6);
    write('00', 263, 2);

    let checksum = 0;
    for (const byte of header) checksum += byte;
    write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);

    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }

  blocks.push(new Uint8Array(1024)); // end-of-archive marker

  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    output.set(block, offset);
    offset += block.length;
  }
  return output;
}
