/**
 * Minimal TAR reader.
 *
 * GitHub serves repository archives as gzipped tarballs, and pulling in a full
 * tar library for one format would be a heavy dependency for ~80 lines of
 * header parsing. Handles the ustar and GNU long-name extensions that git's
 * archive writer actually emits.
 */

export interface TarEntry {
  name: string;
  size: number;
  type: 'file' | 'directory' | 'other';
  data: Uint8Array;
}

const BLOCK_SIZE = 512;

function readString(block: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && block[end] !== 0) end += 1;
  return new TextDecoder().decode(block.subarray(offset, end));
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const raw = readString(block, offset, length).trim();
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 8);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export interface TarReadOptions {
  /** Skip entries larger than this many bytes. */
  maxEntryBytes?: number;
  /** Stop after this many entries. */
  maxEntries?: number;
  /** Return false to skip an entry before its body is copied. */
  filter?: (name: string, size: number) => boolean;
}

export function readTar(buffer: Uint8Array, options: TarReadOptions = {}): TarEntry[] {
  const entries: TarEntry[] = [];
  const maxEntryBytes = options.maxEntryBytes ?? Number.POSITIVE_INFINITY;
  const maxEntries = options.maxEntries ?? Number.POSITIVE_INFINITY;

  let offset = 0;
  /** Set by a GNU `L` long-name header for the following entry. */
  let pendingLongName: string | undefined;

  while (offset + BLOCK_SIZE <= buffer.length && entries.length < maxEntries) {
    const header = buffer.subarray(offset, offset + BLOCK_SIZE);

    // Two consecutive zero blocks terminate the archive.
    if (header.every((byte) => byte === 0)) break;

    const rawName = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156]) || '0';
    const prefix = readString(header, 345, 155);

    offset += BLOCK_SIZE;
    const dataStart = offset;
    const padded = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    offset += padded;

    if (typeFlag === 'L') {
      // GNU long name: the body holds the real name of the next entry.
      pendingLongName = new TextDecoder()
        .decode(buffer.subarray(dataStart, dataStart + size))
        .replace(/\0+$/, '');
      continue;
    }
    if (typeFlag === 'K' || typeFlag === 'x' || typeFlag === 'g') {
      // Long link name / pax headers — not needed for source archives.
      pendingLongName = undefined;
      continue;
    }

    const name = pendingLongName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    pendingLongName = undefined;
    if (!name) continue;

    const type: TarEntry['type'] =
      typeFlag === '5' || name.endsWith('/')
        ? 'directory'
        : typeFlag === '0' || typeFlag === '\0'
          ? 'file'
          : 'other';

    if (type !== 'file') continue;
    if (size > maxEntryBytes) continue;
    if (options.filter && !options.filter(name, size)) continue;
    if (dataStart + size > buffer.length) break;

    entries.push({
      name,
      size,
      type,
      data: buffer.subarray(dataStart, dataStart + size),
    });
  }

  return entries;
}

/** Strip the leading `repo-sha/` directory that archive writers add. */
export function stripRootDirectory(entries: TarEntry[]): TarEntry[] {
  if (!entries.length) return entries;
  const firstSegments = entries.map((entry) => entry.name.split('/')[0]);
  const root = firstSegments[0];
  if (!root || !firstSegments.every((segment) => segment === root)) return entries;
  return entries.map((entry) => ({ ...entry, name: entry.name.slice(root.length + 1) }));
}
