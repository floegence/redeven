import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { runtimeArchiveEntries } from './runtimeArchive';

function tarEntry(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, Math.min(Buffer.byteLength(name), 100), 'ascii');
  header.write(data.length.toString(8).padStart(11, '0'), 124, 11, 'ascii');
  header[156] = '0'.charCodeAt(0);
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

function archive(entries: readonly [string, string][]): Buffer {
  return gzipSync(Buffer.concat([
    ...entries.map(([name, value]) => tarEntry(name, Buffer.from(value))),
    Buffer.alloc(1024),
  ]));
}

describe('runtimeArchiveEntries', () => {
  it('parses a regular archive and preserves entry data', () => {
    const result = runtimeArchiveEntries(archive([['redeven', 'binary']]));
    expect(result.get('redeven')?.toString()).toBe('binary');
  });

  it('rejects unsafe and duplicate archive entries', () => {
    expect(() => runtimeArchiveEntries(archive([['../redeven', 'binary']]))).toThrow(/unsafe entry/u);
    expect(() => runtimeArchiveEntries(archive([['redeven', 'one'], ['redeven', 'two']]))).toThrow(/duplicate entry/u);
  });
});
