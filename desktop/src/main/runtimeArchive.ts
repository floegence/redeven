import { gunzipSync } from 'node:zlib';

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
  let tar: Buffer;
  try {
    tar = gunzipSync(archive);
  } catch {
    throw new Error('Runtime release archive is not a valid gzip stream.');
  }
  let offset = 0;
  let executable: Buffer | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = [tarString(header, 345, 155), tarString(header, 0, 100)].filter(Boolean).join('/');
    const type = String.fromCharCode(header[156] ?? 0);
    const size = tarSize(header);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tar.length) {
      throw new Error('Runtime release archive is truncated.');
    }
    if (name === 'redeven' && (type === '\0' || type === '0')) {
      if (executable) {
        throw new Error('Runtime release archive contains more than one redeven executable.');
      }
      executable = Buffer.from(tar.subarray(bodyStart, bodyEnd));
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (!executable || executable.length === 0) {
    throw new Error('Runtime release archive does not contain the redeven executable.');
  }
  return executable;
}
