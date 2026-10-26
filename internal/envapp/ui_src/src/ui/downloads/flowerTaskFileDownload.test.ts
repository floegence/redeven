import { beforeEach, expect, it, vi } from 'vitest';
import { downloadFlowerTaskFile, flowerTaskFilePath } from './flowerTaskFileDownload';
const mock = vi.hoisted(() => ({ prepare: vi.fn(), write: vi.fn(), complete: vi.fn(), abort: vi.fn() }));
vi.mock('./downloadSinks', () => ({
  resolveDownloadSink: () => ({ kind: 'desktop_file_system', prepare: mock.prepare }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.prepare.mockResolvedValue(mock);
  mock.write.mockResolvedValue(undefined);
  mock.complete.mockResolvedValue(undefined);
  mock.abort.mockResolvedValue(undefined);
});
it('uses bounded offsets and the existing destination with encoded paths', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ bytes: btoa('abc'), size: 5, next_offset: 3, version: 'v1' })
    .mockResolvedValueOnce({ bytes: btoa('de'), size: 5, next_offset: 5, version: 'v1' });
  await downloadFlowerTaskFile('/project/report.bin', read, new AbortController().signal);
  expect(read.mock.calls).toEqual([[0], [3]]);
  expect(mock.write.mock.calls.map(([bytes]) => Array.from(bytes))).toEqual([
    [97, 98, 99],
    [100, 101],
  ]);
  expect(mock.complete).toHaveBeenCalledOnce();
  expect(mock.abort).not.toHaveBeenCalled();
  const path = flowerTaskFilePath('thread', '/project/report & data.bin', false, 0);
  const query = new URL(path, 'http://local').searchParams;
  expect(query.get('path')).toBe('/project/report & data.bin');
  expect(query.get('kind')).toBe('delivered');
});
it('aborts the destination when file identity changes or offsets fail', async () => {
  for (const last of [
    { bytes: btoa('de'), size: 5, next_offset: 5, version: 'v2' },
    { bytes: btoa('de'), size: 5, next_offset: 4, version: 'v1' },
    { bytes: '', size: 5, next_offset: 3, version: 'v1' },
  ]) {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ bytes: btoa('abc'), size: 5, next_offset: 3, version: 'v1' })
      .mockResolvedValueOnce(last);
    await expect(downloadFlowerTaskFile('/project/report.bin', read, new AbortController().signal)).rejects.toThrow(
      'File changed',
    );
  }
  expect(mock.complete).not.toHaveBeenCalled();
  expect(mock.abort).toHaveBeenCalledTimes(3);
});
it('cancels without finishing a partial destination', async () => {
  const controller = new AbortController();
  const read = vi.fn(async () => {
    controller.abort();
    return { bytes: btoa('a'), size: 1, next_offset: 1, version: 'v1' };
  });
  await expect(downloadFlowerTaskFile('/project/report.bin', read, controller.signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(mock.abort).toHaveBeenCalledWith('canceled');
  expect(mock.complete).not.toHaveBeenCalled();
});
