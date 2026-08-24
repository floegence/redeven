import { gunzipSync } from 'node:zlib';

const MAX_RUNTIME_ARCHIVE_BYTES = 256 * 1024 * 1024;

function tarString(block: Buffer, offset: number, length: number): string {
  const end = block.subarray(offset, offset + length).indexOf(0);
  return block
    .subarray(offset, offset + (end < 0 ? length : end))
    .toString('utf8')
    .trim();
}

function tarSize(block: Buffer): number {
  const raw = tarString(block, 124, 12).replace(/\0/gu, '').trim();
  if (!/^[0-7]+$/u.test(raw)) {
    throw new Error('Runtime archive contains an invalid tar size.');
  }
  const size = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Runtime archive contains an invalid tar size.');
  }
  return size;
}

export function runtimeExecutableFromArchive(archive: Buffer): Buffer {
  const executable = runtimeArchiveEntries(archive).get('redeven');
  if (!executable || executable.length === 0) {
    throw new Error('Runtime release archive does not contain the redeven executable.');
  }
  return executable;
}

export function runtimeArchiveEntries(archive: Buffer): ReadonlyMap<string, Buffer> {
  if (archive.length > MAX_RUNTIME_ARCHIVE_BYTES) {
    throw new Error('Runtime release archive exceeds the size limit.');
  }
  let tar: Buffer;
  try {
    tar = gunzipSync(archive);
  } catch {
    throw new Error('Runtime release archive is not a valid gzip stream.');
  }
  if (tar.length > MAX_RUNTIME_ARCHIVE_BYTES) {
    throw new Error('Runtime release archive exceeds the size limit.');
  }
  let offset = 0;
  let totalEntryBytes = 0;
  const entries = new Map<string, Buffer>();
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = [tarString(header, 345, 155), tarString(header, 0, 100)].filter(Boolean).join('/');
    const type = String.fromCharCode(header[156] ?? 0);
    const size = tarSize(header);
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`Runtime release archive contains an unsafe entry: ${name}.`);
    }
    totalEntryBytes += size;
    if (totalEntryBytes > MAX_RUNTIME_ARCHIVE_BYTES) {
      throw new Error('Runtime release archive exceeds the size limit.');
    }
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) {
      throw new Error('Runtime release archive is truncated.');
    }
    if ((type === '\0' || type === '0') && name !== '') {
      if (entries.has(name)) {
        throw new Error(`Runtime release archive contains duplicate entry: ${name}.`);
      }
      entries.set(name, Buffer.from(tar.subarray(bodyStart, bodyEnd)));
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}
