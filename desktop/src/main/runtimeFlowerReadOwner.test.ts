import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import { expect, it, vi } from 'vitest';
import { awaitRuntimeFlowerRead, createRuntimeFlowerReadOwner } from './runtimeFlowerReadOwner';
import { runtimeFlowerMethodAllowed, runtimeFlowerPath } from './runtimeFlowerRoutes';
const request = { method: 'GET' as const, path: '/_redeven_proxy/api/ai/threads/thread-1', read_id: 'read-1' };
function sender(id = 1) { return Object.assign(new EventEmitter(), { id }) as unknown as WebContents; }
const readPaths = [
  '/_redeven_proxy/api/settings',
  '/_redeven_proxy/api/ai/models?mode=baseline',
  '/_redeven_proxy/api/ai/conversation_preferences',
  '/_redeven_proxy/api/ai/threads/thread-1',
  '/_redeven_proxy/api/fs/directory_favorites',
];

it.each(readPaths)('cancels and cleans up a pure GET read for %s', async path => {
  const owner = createRuntimeFlowerReadOwner(); const a = sender(); const readID = 'read-1';
  const result = owner.run(a, { method: 'GET', path, read_id: readID }, signal => awaitRuntimeFlowerRead(new Promise(() => {}), signal), 'document-1');
  expect(owner.size()).toBe(1);
  owner.cancel(a, readID, 'document-1');
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(owner.size()).toBe(0); expect(a.eventNames()).toEqual([]);
});

it('registers before preparation and isolates cancellation by sender', async () => {
  const owner = createRuntimeFlowerReadOwner(); const a = sender(), b = sender(2); let observed!: AbortSignal;
  const result = owner.run(a, request, signal => { observed = signal!; return awaitRuntimeFlowerRead(new Promise(() => {}), signal); }, 'document-1');
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  expect(owner.size()).toBe(1); owner.cancel(b, 'read-1', 'document-1'); owner.cancel(a, 'read-1', 'other-document'); expect(observed.aborted).toBe(false);
  owner.cancel(a, 'read-1', 'document-1'); await rejected; expect(owner.size()).toBe(0); expect(a.eventNames()).toEqual([]); owner.cancel(a, 'read-1', 'document-1');
});
it.each(['reload', 'crash', 'destroy'])('releases all document reads after %s', async kind => {
  const owner = createRuntimeFlowerReadOwner(); const a = sender();
  const results = readPaths.map((path, index) => owner.run(a, { ...request, path, read_id: `read-${index}` }, signal => awaitRuntimeFlowerRead(new Promise(() => {}), signal), 'document-1'));
  const rejected = results.map(result => expect(result).rejects.toMatchObject({ name: 'AbortError' }));
  expect(owner.size()).toBe(readPaths.length);
  if (kind === 'reload') a.emit('did-start-navigation', {}, 'file:///index.html', false, true);
  if (kind === 'crash') a.emit('render-process-gone');
  if (kind === 'destroy') a.emit('destroyed');
  await Promise.all(rejected); expect(owner.size()).toBe(0); expect(a.eventNames()).toEqual([]);
});
it('rejects cancellation identity on writes, bodies, and staging authorization', async () => {
  const owner = createRuntimeFlowerReadOwner(); const read = vi.fn(async () => 'never');
  const invalid = [
    { ...request, method: 'POST' as const },
    { ...request, method: 'PUT' as const, path: '/_redeven_proxy/api/fs/directory_favorites', body: { path: '/work' } },
    { ...request, method: 'DELETE' as const, path: '/_redeven_proxy/api/fs/directory_favorites' },
    { ...request, method: 'PATCH' as const },
    { ...request, body: {} },
    { ...request, body: null },
    { ...request, staging_scope_id: 'scope' },
    { ...request, staging_capability: 'secret' },
    { ...request, staging_scope_id: 'scope', staging_capability: 'secret' },
    { ...request, read_id: '' },
    { ...request, read_id: 'x'.repeat(101) },
  ];
  for (const input of invalid) {
    await expect(owner.run(sender(), input, read, 'document-1')).rejects.toThrow('Invalid cancellable Flower read.');
  }
  expect(read).not.toHaveBeenCalled(); expect(owner.size()).toBe(0);
});
it.each([request.path + '/retry', request.path + '?other=1', '/_redeven_proxy/api/private'])('keeps cancellable GET requests subject to the route and method allowlist: %s', async path => {
  const owner = createRuntimeFlowerReadOwner(); const a = sender(); const dispatch = vi.fn();
  await expect(owner.run(a, { ...request, path }, async () => {
    const allowed = runtimeFlowerPath(path);
    if (!runtimeFlowerMethodAllowed(allowed, 'GET')) throw new Error('Method is not allowed.');
    dispatch();
  }, 'document-1')).rejects.toThrow(/not allowed/u);
  expect(dispatch).not.toHaveBeenCalled(); expect(owner.size()).toBe(0); expect(a.eventNames()).toEqual([]);
});
it('does not dispatch late work when shared preparation resolves after cancellation', async () => {
  const controller = new AbortController(); let finish!: (v: string) => void; const dispatch = vi.fn();
  const preparing = new Promise<string>(resolve => { finish = resolve; });
  const result = awaitRuntimeFlowerRead(preparing, controller.signal).then(dispatch);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
  finish('prepared'); await Promise.resolve(); expect(dispatch).not.toHaveBeenCalled();
});
it.each(readPaths)('cleans listeners after success and does not cancel completed work for %s', async path => {
  const owner = createRuntimeFlowerReadOwner(); const a = sender(); let signal!: AbortSignal;
  expect(await owner.run(a, { ...request, path }, async value => { signal = value!; return 'done'; }, 'document-1')).toBe('done');
  owner.cancel(a, 'read-1', 'document-1'); expect(signal.aborted).toBe(false); expect(owner.size()).toBe(0); expect(a.eventNames()).toEqual([]);
});
