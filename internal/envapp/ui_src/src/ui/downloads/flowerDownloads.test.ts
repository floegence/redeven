// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { expect, it, vi, type Mock } from 'vitest';
import { createDownloadManager } from './createDownloadManager';
import { createFlowerDownloads } from './flowerDownloads';
import type { FlowerTaskMaterial } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
type ReadTaskFile = Parameters<typeof createFlowerDownloads>[1]['readTaskFile'];
function setup(read: Mock<ReadTaskFile> = vi.fn(async () => ({ bytes: btoa('abc'), size: 3, next_offset: 3, version: 'v1' }))) {
  const destination = { label: 'report.txt', canReveal: false, canOpen: false };
  const prepared = { destination, write: vi.fn(async (_bytes: Uint8Array) => {}),
    complete: vi.fn(async () => destination), abort: vi.fn(async (_reason: string) => {}) };
  const prepare = vi.fn(async () => prepared);
  const manager = createDownloadManager({ sink: { kind: 'web_file_system', prepare } });
  const loadAttachment = vi.fn(async () => new NodeBlob(['source'], { type: 'text/plain' }) as unknown as Blob);
  const downloads = createFlowerDownloads(manager, { readTaskFile: read, loadAttachment });
  return { manager, downloads, prepared, prepare, read, loadAttachment };
}

it('enqueues before choosing the destination and streams progress with bounded source reads', async () => {
  const next = deferred<{ bytes: string; size: number; next_offset: number; version: string }>();
  const read = vi.fn().mockResolvedValueOnce({ bytes: btoa('abc'), size: 5, next_offset: 3, version: 'v1' }).mockReturnValueOnce(next.promise);
  const { manager, downloads, prepared, prepare } = setup(read);
  const pending = downloads.downloadTaskFile('one', '/scratch/report.txt', true);
  expect(prepare).toHaveBeenCalledOnce();
  expect(manager.tasks()).toHaveLength(1);
  expect(downloads.hasActiveTaskFileDownloads('one')).toBe(true);
  expect(downloads.hasActiveTaskFileDownloads('two')).toBe(false);
  await vi.waitFor(() => expect(manager.tasks()[0]).toMatchObject({ status: 'streaming', bytesRead: 3, totalBytes: 5, progressRatio: 0.6 }));
  expect(read.mock.calls.map(call => call.slice(0, 4))).toEqual([['one', '/scratch/report.txt', true, 0], ['one', '/scratch/report.txt', true, 3]]);
  next.resolve({ bytes: btoa('de'), size: 5, next_offset: 5, version: 'v1' }); await pending;
  expect(manager.tasks()[0]).toMatchObject({ status: 'completed', bytesRead: 5, progressRatio: 1 });
  expect(downloads.hasActiveTaskFileDownloads('one')).toBe(false);
  expect(prepared.complete).toHaveBeenCalledOnce();
});

it('retains failures and retries through the same authorized reader', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ bytes: btoa('abc'), size: 3, next_offset: 3, version: 'v1' });
  const { manager, downloads, prepared } = setup(read);
  await expect(downloads.downloadTaskFile('one', '/project/report.txt', false)).rejects.toThrow('offline');
  const failed = manager.tasks()[0];
  expect(failed.status).toBe('failed');
  expect(prepared.abort).toHaveBeenCalledWith('failed');
  const retry = manager.retry(failed.id)!;
  await vi.waitFor(() => expect(manager.getTask(retry)?.status).toBe('completed'));
  expect(manager.tasks()).toHaveLength(2);
  expect(read.mock.calls.map(call => call.slice(0, 4))).toEqual([['one', '/project/report.txt', false, 0], ['one', '/project/report.txt', false, 0]]);
  expect(prepared.complete).toHaveBeenCalledOnce();
});

it('cancels pending source reads and preserves canceled state when the reader settles late', async () => {
  const response = deferred<{ bytes: string; size: number; next_offset: number; version: string }>();
  const { manager, downloads, prepared, read } = setup(vi.fn(() => response.promise));
  const pending = downloads.downloadTaskFile('one', '/project/report.txt', false);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  const signal = read.mock.calls[0][4] as AbortSignal;
  manager.cancel(manager.tasks()[0].id); await pending;
  expect(signal.aborted).toBe(true);
  response.resolve({ bytes: btoa('abc'), size: 3, next_offset: 3, version: 'v1' });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(manager.tasks()[0].status).toBe('canceled');
  expect(prepared.write).not.toHaveBeenCalled(); expect(prepared.complete).not.toHaveBeenCalled();
  expect(prepared.abort).toHaveBeenCalledExactlyOnceWith('canceled');
});

it('cancels a destination chosen after cancellation without opening the source', async () => {
  const { manager, downloads, prepared, prepare, read } = setup();
  const chosen = deferred<typeof prepared>(); prepare.mockReturnValueOnce(chosen.promise);
  const pending = downloads.downloadTaskFile('one', '/project/report.txt', false);
  manager.cancel(manager.tasks()[0].id); await pending;
  chosen.resolve(prepared);
  await vi.waitFor(() => expect(prepared.abort).toHaveBeenCalledWith('canceled'));
  expect(read).not.toHaveBeenCalled(); expect(prepared.complete).not.toHaveBeenCalled();
  expect(manager.tasks()[0].status).toBe('canceled');
});

it('never finalizes after cancellation during the last write', async () => {
  const { manager, downloads, prepared } = setup();
  const written = deferred<void>(); prepared.write.mockReturnValueOnce(written.promise);
  const pending = downloads.downloadTaskFile('one', '/project/report.txt', false);
  await vi.waitFor(() => expect(prepared.write).toHaveBeenCalledOnce());
  manager.cancel(manager.tasks()[0].id); await pending; written.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(manager.tasks()[0].status).toBe('canceled'); expect(prepared.complete).not.toHaveBeenCalled();
});

it.each(['input', 'media'] as const)('tracks %s originals without storing their URL or Blob in task metadata', async kind => {
  const { manager, downloads, loadAttachment, prepared } = setup();
  const item = { kind, name: 'source.txt', size: 6, mime: 'text/plain', url: '/authorized/source' } as FlowerTaskMaterial;
  await downloads.downloadTaskMaterial('one', item);
  expect(manager.tasks()[0]).toMatchObject({ status: 'completed', bytesRead: 6,
    command: { source: { kind: 'flower_file', threadID: 'one', name: 'source.txt', path: '' } } });
  expect(loadAttachment).toHaveBeenCalledExactlyOnceWith(item.url, expect.any(AbortSignal));
  expect(prepared.complete).toHaveBeenCalledOnce();
  expect(JSON.stringify(manager.tasks())).not.toContain(item.url);
});

it('keeps finalization noncancelable until its destination confirms completion', async () => {
  const { manager, downloads, prepared } = setup();
  const finished = deferred<typeof prepared.destination>(); prepared.complete.mockReturnValueOnce(finished.promise);
  const pending = downloads.downloadTaskFile('one', '/project/report.txt', false);
  await vi.waitFor(() => expect(prepared.complete).toHaveBeenCalledOnce());
  const id = manager.tasks()[0].id;
  expect(manager.getTask(id)).toMatchObject({ status: 'finalizing', cancelable: false });
  manager.cancel(id); expect(prepared.abort).not.toHaveBeenCalled();
  finished.resolve(prepared.destination); await pending;
  expect(manager.getTask(id)?.status).toBe('completed');
});
