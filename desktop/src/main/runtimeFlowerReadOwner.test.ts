import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { awaitRuntimeFlowerRead, createRuntimeFlowerReadOwner } from './runtimeFlowerReadOwner';
const request = { method: 'GET' as const, path: '/_redeven_proxy/api/ai/threads/thread-1', read_id: 'read-1' };
function sender(id = 1) { return Object.assign(new EventEmitter(), { id }) as unknown as WebContents; }
it('registers before preparation and isolates cancellation by sender', async () => {
  const owner = createRuntimeFlowerReadOwner(); const a = sender(), b = sender(2); let observed!: AbortSignal;
  const result = owner.run(a, request, signal => { observed = signal!; return awaitRuntimeFlowerRead(new Promise(() => {}), signal); }, 'document-1');
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(owner.size()).toBe(1); owner.cancel(b, 'read-1', 'document-1'); owner.cancel(a, 'read-1', 'other-document'); expect(observed.aborted).toBe(false);
  owner.cancel(a, 'read-1', 'document-1'); await rejected; expect(owner.size()).toBe(0); expect(a.eventNames()).toEqual([]); owner.cancel(a, 'read-1', 'document-1');
});
it.each(['reload', 'crash', 'destroy'])('releases document reads after %s', async kind => {
  const owner = createRuntimeFlowerReadOwner(); const a = sender();
  const result = owner.run(a, request, signal => awaitRuntimeFlowerRead(new Promise(() => {}), signal), 'document-1');
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  if (kind === 'reload') a.emit('did-start-navigation', {}, 'file:///index.html', false, true);
  if (kind === 'crash') a.emit('render-process-gone');
  if (kind === 'destroy') a.emit('destroyed');
  await rejected; expect(owner.size()).toBe(0); expect(a.eventNames()).toEqual([]);
});
it('rejects cancellation identity on commands and non-detail reads', async () => {
  const owner = createRuntimeFlowerReadOwner(); const read = vi.fn(async () => 'never');
  for (const input of [{ ...request, method: 'POST' as const }, { ...request, path: request.path + '/retry' }, { ...request, path: request.path + '?other=1' }, { ...request, body: {} }]) {
    await expect(owner.run(sender(), input, read, 'document-1')).rejects.toThrow('Invalid cancellable');
  }
  expect(read).not.toHaveBeenCalled(); expect(owner.size()).toBe(0);
});
it('does not dispatch late work when shared preparation resolves after cancellation', async () => {
  const controller = new AbortController(); let finish!: (v: string) => void; const dispatch = vi.fn();
  const preparing = new Promise<string>(resolve => { finish = resolve; });
  const result = awaitRuntimeFlowerRead(preparing, controller.signal).then(dispatch);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
  finish('prepared'); await Promise.resolve(); expect(dispatch).not.toHaveBeenCalled();
});
it('cleans listeners after success and does not cancel completed work', async () => {
  const owner = createRuntimeFlowerReadOwner(); const a = sender(); let signal!: AbortSignal;
  expect(await owner.run(a, request, async value => { signal = value!; return 'done'; }, 'document-1')).toBe('done');
  owner.cancel(a, 'read-1', 'document-1'); expect(signal.aborted).toBe(false); expect(owner.size()).toBe(0); expect(a.eventNames()).toEqual([]);
});
