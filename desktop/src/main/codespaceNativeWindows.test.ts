import { expect, it, vi } from 'vitest';
import { CodeSpaceNativeWindow, codeSpaceWindowFailure, type NativeCodeSpaceWindow } from './codespaceNativeWindows';
import type { NativeCodeSpaceGateway, NativeCodeSpaceRoute } from './codespaceNativeGateway';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  let currentURL = 'about:blank';
  let destroyed = false;
  const loads: { url: string; done: ReturnType<typeof deferred> }[] = [];
  const active = new Set<ReturnType<typeof deferred>>();
  const dispose = vi.fn();
  const route = { pathPrefix: '', authority: '', headers: {}, openConnection: vi.fn(), close: vi.fn(async () => {}) } as NativeCodeSpaceRoute;
  const gateway = { origin: 'http://127.0.0.1:43210', port: 43210, token: 'private-token', mintBrowserEntry: vi.fn(), close: vi.fn(async () => {}) } as NativeCodeSpaceGateway;
  const window: NativeCodeSpaceWindow = {
    loadURL: vi.fn((url) => {
      const done = deferred();
      active.add(done);
      loads.push({ url, done });
      return done.promise.then(() => { currentURL = url; }).finally(() => active.delete(done));
    }),
    getURL: () => currentURL,
    isDestroyed: () => destroyed,
    present: vi.fn(),
    stop: vi.fn(() => { for (const done of active) done.reject(Object.assign(new Error('cancelled'), { code: 'ERR_ABORTED', errno: -3 })); }),
    destroy: vi.fn(() => { destroyed = true; }),
    prepareSession: vi.fn(async () => {}),
    installSession: vi.fn(() => dispose),
  };
  const options = {
    identity: 'a'.repeat(64), window,
    profiles: () => ({ port: vi.fn(() => 43210), remember: vi.fn() }),
    loadingURL: (copy: { title?: string }) => `data:${copy.title ?? 'loading'}`,
    createRoute: vi.fn(async () => route),
    createGateway: vi.fn(async () => gateway),
    onReady: vi.fn(), onFailure: vi.fn(),
  };
  const owner = new CodeSpaceNativeWindow(options);
  const finish = async (index: number) => { loads[index]!.done.resolve(); await tick(); };
  const initialize = async () => { const pending = owner.showLoading({}); await tick(); await finish(loads.length - 1); await pending; };
  const ready = async () => { await initialize(); const pending = owner.open(); await tick(); await finish(loads.length - 1); await pending; };
  return { owner, options, loads, active, route, gateway, dispose, finish, initialize, ready, setURL: (url: string) => { currentURL = url; } };
}

it('finishes the loading document before acknowledging it or starting the editor', async () => {
  const h = harness();
  let acknowledged = false;
  const loading = h.owner.showLoading({}).then(() => { acknowledged = true; });
  const opening = h.owner.open();
  await tick();
  expect(acknowledged).toBe(false);
  expect(h.loads.map((load) => load.url)).toEqual(['data:loading']);
  expect(h.options.createRoute).not.toHaveBeenCalled();
  await h.finish(0);
  await loading;
  expect(h.loads.map((load) => load.url)).toEqual(['data:loading', h.gateway.origin + '/']);
  expect(h.options.onReady).not.toHaveBeenCalled();
  await h.finish(1);
  await opening;
  expect(h.options.onReady).toHaveBeenCalledExactlyOnceWith(43210);
  await h.owner.close();
});

it('does not let a delayed cancellation of the loading document fail an editor navigation', async () => {
  const h = harness();
  const loading = h.owner.showLoading({}).catch((error: unknown) => error);
  const opening = h.owner.open().catch((error: unknown) => error);
  await tick();
  // Replay the old data document failure seen in Desktop diagnostics. No editor
  // load may be listening to these document events while that load is pending.
  h.loads[0]!.done.reject(Object.assign(new Error("loading 'data:private-document'"), { code: 'ERR_ABORTED', errno: -3 }));
  expect(await loading).toMatchObject({ stage: 'loading_document', code: 'ERR_ABORTED' });
  expect(await opening).toMatchObject({ stage: 'loading_document', code: 'ERR_ABORTED' });
  expect(h.loads).toHaveLength(1);
  expect(h.options.createRoute).not.toHaveBeenCalled();
  expect(h.options.onReady).not.toHaveBeenCalled();
  expect(h.options.onFailure).toHaveBeenCalledOnce();
  await h.ready();
  expect(h.options.onReady).toHaveBeenCalledOnce();
  await h.owner.close();
});

it('coalesces obsolete theme documents and skips their navigation once opening begins', async () => {
  const h = harness();
  const loading = h.owner.showLoading({ title: 'initial' });
  await tick();
  const theme1 = h.owner.refreshLoading();
  const theme2 = h.owner.showLoading({ title: 'new-theme' });
  const opening = h.owner.open();
  await h.owner.refreshLoading();
  await h.finish(0);
  await Promise.all([loading, theme1, theme2]);
  expect(h.loads.map((load) => load.url)).toEqual(['data:initial', h.gateway.origin + '/']);
  expect(h.active.size).toBe(1);
  await h.finish(1);
  await opening;
  await h.owner.refreshLoading();
  expect(h.loads).toHaveLength(2);
  await h.owner.close();
});

it('shares pending opens even after a gateway exists and only focuses a ready editor', async () => {
  const h = harness();
  await h.initialize();
  const opening = h.owner.open();
  await tick();
  expect(h.owner.open()).toBe(opening);
  expect(h.options.onReady).not.toHaveBeenCalled();
  await h.owner.showLoading({ state: 'error', title: 'stale failure' });
  expect(h.loads).toHaveLength(2);
  await h.finish(1);
  await opening;
  await h.owner.open();
  expect(h.options.createRoute).toHaveBeenCalledOnce();
  expect(h.loads).toHaveLength(2);
  expect(h.options.window.present).toHaveBeenCalledTimes(2);
  await h.owner.close();
});

it('rejects premature navigation completion outside the editor origin', async () => {
  const h = harness();
  await h.initialize();
  vi.mocked(h.options.window.loadURL).mockResolvedValueOnce();
  await expect(h.owner.open()).rejects.toMatchObject({ stage: 'editor_navigation' });
  expect(h.options.onReady).not.toHaveBeenCalled();
  expect(h.dispose).toHaveBeenCalledOnce();
  expect(h.gateway.close).toHaveBeenCalledOnce();
  await h.owner.close();
});

it('releases failed opening resources and permits an explicit retry in the same window', async () => {
  const h = harness();
  await h.initialize();
  const opening = h.owner.open().catch((error: unknown) => error);
  await tick();
  h.loads[1]!.done.reject(Object.assign(new Error('net failure at private URL'), { code: 'ERR_CONNECTION_RESET', errno: -101 }));
  expect(await opening).toMatchObject({ stage: 'editor_navigation', code: 'ERR_CONNECTION_RESET', errno: -101 });
  expect(h.dispose).toHaveBeenCalledOnce();
  expect(h.gateway.close).toHaveBeenCalledOnce();
  const failure = h.owner.showLoading({ state: 'error', title: 'failed' });
  await tick(); await h.finish(2); await failure;
  await h.ready();
  expect(h.options.createRoute).toHaveBeenCalledTimes(2);
  expect(h.options.onReady).toHaveBeenCalledOnce();
  await h.owner.close();
  expect(h.gateway.close).toHaveBeenCalledTimes(2);
});

it.each(['route', 'gateway', 'session', 'navigation'] as const)('closes and drains an opening paused at %s without installing late authority', async (stage) => {
  const h = harness();
  await h.initialize();
  const blocked = deferred();
  if (stage === 'route') h.options.createRoute.mockImplementation(async () => { await blocked.promise; return h.route; });
  if (stage === 'gateway') h.options.createGateway.mockImplementation(async () => { await blocked.promise; return h.gateway; });
  if (stage === 'session') vi.mocked(h.options.window.prepareSession).mockImplementation(() => blocked.promise);
  const opening = h.owner.open().catch((error: unknown) => error);
  await tick();
  const closing = h.owner.close();
  blocked.resolve();
  await closing;
  expect(await opening).toMatchObject({ code: 'codespace_closed' });
  expect(h.options.onReady).not.toHaveBeenCalled();
  expect(h.options.onFailure).not.toHaveBeenCalled();
  expect(h.options.window.destroy).toHaveBeenCalledOnce();
  expect(h.options.window.installSession).toHaveBeenCalledTimes(stage === 'navigation' ? 1 : 0);
  expect(stage === 'route' ? h.route.close : h.gateway.close).toHaveBeenCalledOnce();
  await h.owner.close();
  expect(h.options.window.destroy).toHaveBeenCalledOnce();
});

it('cancels a pending loading document and never resurrects a closed window', async () => {
  const h = harness();
  const loading = h.owner.showLoading({}).catch((error: unknown) => error);
  await tick();
  await h.owner.close();
  await loading;
  await expect(h.owner.showLoading({ state: 'error' })).rejects.toThrow('codespace_closed');
  await expect(h.owner.open()).rejects.toThrow('codespace_closed');
  expect(h.options.window.present).not.toHaveBeenCalled();
  expect(h.options.onFailure).not.toHaveBeenCalled();
});

it('does not revoke a replacement window when an old preparation completes late', async () => {
  const old = harness();
  await old.initialize();
  const blocked = deferred();
  vi.mocked(old.options.window.prepareSession).mockImplementation(() => blocked.promise);
  const opening = old.owner.open().catch((error: unknown) => error);
  await tick();
  const closing = old.owner.close();
  const replacement = harness();
  await replacement.ready();
  blocked.resolve();
  await closing; await opening;
  expect(old.options.window.installSession).not.toHaveBeenCalled();
  expect(replacement.dispose).not.toHaveBeenCalled();
  expect(replacement.owner.allowsNavigation(replacement.gateway.origin + '/')).toBe(true);
  await replacement.owner.close();
});

it('serializes same-origin editor navigation and rejects foreign or credentialed targets', async () => {
  const h = harness();
  await h.ready();
  expect(h.owner.allowsNavigation('http://user@127.0.0.1:43210/')).toBe(false);
  await h.owner.navigate('https://foreign.test/');
  const first = h.owner.navigate(h.gateway.origin + '/first');
  const second = h.owner.navigate(h.gateway.origin + '/second');
  await tick();
  expect(h.loads).toHaveLength(3);
  await h.finish(2);
  expect(h.loads).toHaveLength(4);
  await h.finish(3);
  await Promise.all([first, second]);
  await h.owner.close(false);
  expect(h.options.window.destroy).not.toHaveBeenCalled();
  expect(h.dispose).toHaveBeenCalledOnce();
});

it('retains actionable product codes while excluding URLs, tokens, and arbitrary exception text', () => {
  expect(codeSpaceWindowFailure(new Error('codespace_password_required'), 'route').code).toBe('codespace_password_required');
  expect(codeSpaceWindowFailure(Object.assign(new Error('private contents'), { code: 'EADDRINUSE' }), 'gateway').code).toBe('EADDRINUSE');
  const error = codeSpaceWindowFailure(new Error('https://private.test/?token=secret'), 'editor_navigation');
  expect(error).toMatchObject({ code: 'codespace_open_failed', stage: 'editor_navigation' });
  expect(JSON.stringify(error)).not.toContain('secret');
  expect(error.message).not.toContain('private');
});

it('refreshes the loading theme without stealing focus from the user', async () => {
  const h = harness();
  await h.initialize();
  const refresh = h.owner.refreshLoading();
  await tick();
  await h.finish(1);
  await refresh;
  expect(h.options.window.present).toHaveBeenCalledOnce();
  await h.owner.close();
});
