import { expect, it, vi } from 'vitest';
import { loadFlowerTaskFile, openFlowerTaskFile, flowerTaskFilePath } from './flowerTaskFileDownload';
async function readAll(read: Parameters<typeof openFlowerTaskFile>[0], signal = new AbortController().signal) {
  const source = await openFlowerTaskFile(read, signal);
  const chunks = [];
  for await (const bytes of source.chunks) chunks.push(Array.from(bytes));
  return { totalBytes: source.totalBytes, chunks };
}
it('streams bounded chunks and discovers the size with encoded paths', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ bytes: btoa('abc'), size: 5, next_offset: 3, version: 'v1' })
    .mockResolvedValueOnce({ bytes: btoa('de'), size: 5, next_offset: 5, version: 'v1' });
  const result = await readAll(read);
  expect(read.mock.calls).toEqual([[0], [3]]);
  expect(result.totalBytes).toBe(5);
  expect(result.chunks).toEqual([
    [97, 98, 99],
    [100, 101],
  ]);
  const path = flowerTaskFilePath('thread', '/project/report & data.bin', false, 0);
  const query = new URL(path, 'http://local').searchParams;
  expect(query.get('path')).toBe('/project/report & data.bin');
  expect(query.get('kind')).toBe('delivered');
});
it('rejects changed file identity, size or offsets', async () => {
  for (const last of [
    { bytes: btoa('de'), size: 5, next_offset: 5, version: 'v2' },
    { bytes: btoa('de'), size: 5, next_offset: 4, version: 'v1' },
    { bytes: '', size: 5, next_offset: 3, version: 'v1' },
    { bytes: btoa('de'), size: 6, next_offset: 5, version: 'v1' },
  ]) {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ bytes: btoa('abc'), size: 5, next_offset: 3, version: 'v1' })
      .mockResolvedValueOnce(last);
    await expect(readAll(read)).rejects.toThrow(
      'File changed',
    );
  }
});
it('cancels before exposing a chunk', async () => {
  const controller = new AbortController();
  const read = vi.fn(async () => {
    controller.abort();
    return { bytes: btoa('a'), size: 1, next_offset: 1, version: 'v1' };
  });
  await expect(readAll(read, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
});


it('previews authorized bytes without a destination and preserves text MIME', async () => {
  const read = vi.fn().mockResolvedValueOnce({ bytes: btoa('# Report'), size: 8, next_offset: 8, version: 'v1' });
  const blob = await loadFlowerTaskFile('/state/scratch/report.md', read, new AbortController().signal);
  expect(blob.type).toBe('text/markdown');
  expect(await blob.text()).toBe('# Report');
  expect(new URL(flowerTaskFilePath('thread', '/state/scratch/report.md', true, 0), 'http://local').searchParams.get('kind')).toBe('working');
});

it('bounds preview memory and rejects changed bytes and cancelled reads', async () => {
  const oversized = vi.fn().mockResolvedValue({ bytes: btoa('x'), size: 21 * 1024 * 1024, next_offset: 1, version: 'v1' });
  await expect(loadFlowerTaskFile('/file.bin', oversized, new AbortController().signal)).rejects.toThrow('size limit');
  expect(oversized).toHaveBeenCalledTimes(1);
  const changed = vi.fn().mockResolvedValueOnce({ bytes: btoa('a'), size: 2, next_offset: 1, version: 'v1' })
    .mockResolvedValueOnce({ bytes: btoa('b'), size: 2, next_offset: 2, version: 'v2' });
  await expect(loadFlowerTaskFile('/file.txt', changed, new AbortController().signal)).rejects.toThrow('File changed');
  const controller = new AbortController(); controller.abort();
  const read = vi.fn();
  await expect(loadFlowerTaskFile('/file.txt', read, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(read).not.toHaveBeenCalled();
});
