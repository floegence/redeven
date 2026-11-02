import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { createTerminalViewCatalog } from './terminalViewCatalog';
import type { TerminalViewSnapshot, TerminalViewPutRequest } from '../protocol/redeven_v1/sdk/terminalViews';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const view = { id: 'view-a', name: 'A', layout: { type: 'pane' as const, id: 'a' }, revision: 2, createdAtMs: 1, updatedAtMs: 1 };
it('keeps the edit base on concurrent notifications and never blindly retries a conflict', async () => {
  let notify!: (value: TerminalViewSnapshot) => void;
  const putView = vi.fn(async (_req: TerminalViewPutRequest): Promise<TerminalViewSnapshot> => { throw new Error('conflict'); });
  const rpc = { listViews: vi.fn(async () => ({ revision: 2, views: [view] })), putView, deleteView: vi.fn(), onViewsChanged: (handler: typeof notify) => { notify = handler; return () => undefined; } };
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc }); return <div />; }, document.body);
  await expect.poll(catalog.ready).toBe(true);
  catalog.put({ ...view, name: 'Local' });
  notify({ revision: 3, views: [{ ...view, name: 'Remote', revision: 3 }] });
  await expect.poll(catalog.error).toBe('save');
  expect(putView).toHaveBeenCalledTimes(1);
  expect(putView.mock.calls[0][0]).toMatchObject({ name: 'Local', baseRevision: 2 });
  expect(catalog.views()[0].name).toBe('Local');
});
it('ignores requests from a previous environment and preserves remote deletions', async () => {
  let resolveOld!: (value: TerminalViewSnapshot) => void;
  const [scope, setScope] = createSignal('old');
  let notify!: (value: TerminalViewSnapshot) => void;
  const rpc = { listViews: vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({ revision: 1, views: [] }), putView: vi.fn(), deleteView: vi.fn(), onViewsChanged: (handler: typeof notify) => { notify = handler; return () => undefined; } };
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope, connected: () => true, rpc }); return <div />; }, document.body);
  setScope('new'); await expect.poll(catalog.ready).toBe(true);
  resolveOld({ revision: 10, views: [view] }); await Promise.resolve();
  expect(catalog.views()).toEqual([]);
  notify({ revision: 3, views: [view] }); expect(catalog.views()).toHaveLength(1);
  notify({ revision: 4, views: [] }); expect(catalog.views()).toEqual([]);
});
it('serializes edits made during a save using the acknowledged revision', async () => {
  let resolveSave!: (value: TerminalViewSnapshot) => void;
  const putView = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }))
    .mockResolvedValue({ revision: 4, views: [{ ...view, name: 'Second', revision: 4 }] });
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc: {
    listViews: async () => ({ revision: 2, views: [view] }), putView, deleteView: vi.fn(), onViewsChanged: () => () => undefined,
  } }); return <div />; }, document.body);
  await expect.poll(catalog.ready).toBe(true);
  catalog.put({ ...view, name: 'First' }); await expect.poll(() => putView.mock.calls.length).toBe(1);
  catalog.put({ ...view, name: 'Second' });
  resolveSave({ revision: 3, views: [{ ...view, name: 'First', revision: 3 }] });
  await expect.poll(catalog.pending).toBe(false);
  expect(putView.mock.calls[1][0]).toMatchObject({ name: 'Second', baseRevision: 3 });
  expect(catalog.views()[0].name).toBe('Second');
});
it('recovers initial loading on reconnect and removes metadata when access is revoked', async () => {
  const [connected, setConnected] = createSignal(true);
  const [enabled, setEnabled] = createSignal(true);
  const listViews = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ revision: 2, views: [view] });
  const unsubscribe = vi.fn();
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => 'env', connected, enabled, rpc: {
    listViews, putView: vi.fn(), deleteView: vi.fn(), onViewsChanged: () => unsubscribe,
  } }); return <div />; }, document.body);
  await expect.poll(catalog.error).toBe('load');
  setConnected(false); setConnected(true);
  await expect.poll(catalog.ready).toBe(true); expect(catalog.error()).toBeNull();
  setEnabled(false);
  expect(catalog.views()).toEqual([]); expect(catalog.ready()).toBe(false);
  expect(unsubscribe).toHaveBeenCalled();
});
it('retains failed drafts until an explicit successful reload', async () => {
  const listViews = vi.fn().mockResolvedValueOnce({ revision: 2, views: [view] }).mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ revision: 3, views: [{ ...view, name: 'Remote', revision: 3 }] });
  const putView = vi.fn().mockRejectedValue(new Error('conflict'));
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc: {
    listViews, putView, deleteView: vi.fn(), onViewsChanged: () => () => undefined,
  } }); return <div />; }, document.body);
  await expect.poll(catalog.ready).toBe(true);
  catalog.put({ ...view, name: 'Local' }); await expect.poll(catalog.error).toBe('save');
  await catalog.reload(); expect(catalog.views()[0].name).toBe('Local'); expect(catalog.pending()).toBe(true);
  await catalog.reload(); expect(catalog.views()[0].name).toBe('Remote'); expect(catalog.pending()).toBe(false);
  expect(putView).toHaveBeenCalledTimes(1);
});

it('rejects malformed published layouts before exposing them to the workspace', async () => {
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc: {
    listViews: async () => ({ revision: 2, views: [{ ...view, layout: { type: 'pane', id: '' } }] }),
    putView: vi.fn(), deleteView: vi.fn(), onViewsChanged: () => () => undefined,
  } }); return <div />; }, document.body);
  await expect.poll(catalog.error).toBe('load');
  expect(catalog.views()).toEqual([]); expect(catalog.ready()).toBe(false);
});
it('retains drafts when reload returns an invalid layout', async () => {
  const listViews = vi.fn().mockResolvedValueOnce({ revision: 2, views: [view] })
    .mockResolvedValue({ revision: 3, views: [{ ...view, layout: { type: 'pane', id: '' } }] });
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc: {
    listViews, putView: vi.fn().mockRejectedValue(new Error('conflict')), deleteView: vi.fn(), onViewsChanged: () => () => undefined,
  } }); return <div />; }, document.body);
  await expect.poll(catalog.ready).toBe(true);
  catalog.put({ ...view, name: 'Local' }); await expect.poll(catalog.error).toBe('save');
  await catalog.reload();
  expect(catalog.views()[0].name).toBe('Local'); expect(catalog.pending()).toBe(true);
});

it.each(['connection-first', 'permissions-first'])('preserves drafts across permission refreshes (%s)', async order => {
  const [connected, setConnected] = createSignal(false);
  const [permission, setPermission] = createSignal({ allowed: false });
  const listViews = vi.fn(async () => ({ revision: 2, views: [view] }));
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => 'env', connected,
    enabled: () => permission().allowed, rpc: {
      listViews, putView: vi.fn().mockRejectedValue(new Error('conflict')), deleteView: vi.fn(), onViewsChanged: () => () => undefined,
    },
  }); return <div />; }, document.body);
  expect(listViews).not.toHaveBeenCalled();
  if (order === 'connection-first') { setConnected(true); setPermission({ allowed: true }); }
  else { setPermission({ allowed: true }); setConnected(true); }
  await expect.poll(catalog.ready).toBe(true);
  catalog.put({ ...view, name: 'Local draft' });
  setPermission({ allowed: true });
  expect(catalog.ready()).toBe(true);
  expect(catalog.pending()).toBe(true);
  expect(catalog.views()[0].name).toBe('Local draft');
  expect(listViews).toHaveBeenCalledTimes(1);
});

it('keeps reload ordered when scope and permission dependencies change together', async () => {
  const [state, setState] = createSignal({ id: '', allowed: false, connected: false });
  const listViews = vi.fn(async () => ({ revision: 2, views: [view] }));
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => state().id, connected: () => state().connected,
    enabled: () => state().allowed, rpc: { listViews, putView: vi.fn(), deleteView: vi.fn(), onViewsChanged: () => () => undefined },
  }); return <div />; }, document.body);
  for (const [index, next] of [
    { id: 'env', allowed: false, connected: false },
    { id: 'env', allowed: false, connected: true },
    { id: 'env', allowed: true, connected: true },
    { id: 'env', allowed: true, connected: true },
    { id: 'env', allowed: true, connected: false },
    { id: 'env', allowed: true, connected: true },
    { id: 'other', allowed: true, connected: true },
  ].entries()) {
    setState(next);
    if (next.allowed && next.connected) await expect.poll(catalog.ready, { message: JSON.stringify({ index, ...next, calls: listViews.mock.calls.length }) }).toBe(true);
    else await Promise.resolve();
  }
});

it('ignores list responses and notifications from a retired connection', async () => {
  const [connected, setConnected] = createSignal(true);
  let resolveOld!: (snapshot: TerminalViewSnapshot) => void;
  const handlers: Array<(snapshot: TerminalViewSnapshot) => void> = [];
  const listViews = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValue({ revision: 2, views: [view] });
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => { catalog = createTerminalViewCatalog({ scope: () => 'env', connected, rpc: {
    listViews, putView: vi.fn(), deleteView: vi.fn(),
    onViewsChanged: handler => { handlers.push(handler); return () => undefined; },
  } }); return <div />; }, document.body);
  setConnected(false); setConnected(true);
  await expect.poll(catalog.ready).toBe(true);
  resolveOld({ revision: 5, views: [] });
  handlers[0]({ revision: 6, views: [] });
  await Promise.resolve();
  expect(catalog.views()).toEqual([view]);
});
