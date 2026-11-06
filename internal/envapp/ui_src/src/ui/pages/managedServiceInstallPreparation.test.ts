// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManagedServiceInstallPreparation } from './managedServiceInstallPreparation';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../services/localApi', () => ({ fetchLocalApiJSON: api.fetch }));
const selection = (accessMode = 'unified_proxy', identity = 'session-one', workspace = '/services/example') => ({
  identity, request: { template_id: 'example', deployment: 'host', workspace_path: workspace, access_mode: accessMode, parameters: {}, accepted_notice_revisions: {} },
});
const plan = (id: string, expires = Date.now() + 60_000, workspace = '/services/example/instance') => ({service_id: id, plan_digest: id, workspace_path: workspace, expires_at_unix_ms: expires});
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let dispose: (() => void) | undefined;
function setup(initial: ReturnType<typeof selection> | null) {
  return createRoot(cleanup => {
    dispose = cleanup;
    const [target, setTarget] = createSignal(initial);
    return {...createManagedServiceInstallPreparation(target), setTarget};
  });
}
afterEach(() => { dispose?.(); vi.useRealTimers(); api.fetch.mockReset(); });

describe('managed install preparation', () => {
  it('prepares an exact request automatically without creating a service', async () => {
    api.fetch.mockResolvedValue(plan('ready'));
    const state = setup(selection());
    await flush();
    expect(state.current()?.request.workspace_path).toBe('/services/example/instance');
    expect(state.current()?.request.access_mode).toBe('unified_proxy');
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(api.fetch.mock.calls[0][0]).toBe('/_redeven_proxy/api/managed-web-services/install-plans');
    state.setTarget(selection());
    await flush();
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it('invalidates edits immediately and ignores a late result without blocking the next check', async () => {
    let finishOld!: (value: unknown) => void;
    api.fetch.mockResolvedValueOnce(plan('initial')).mockImplementationOnce(() => new Promise(resolve => {finishOld = resolve;})).mockResolvedValue(plan('latest'));
    const state = setup(selection());
    await flush();
    state.setTarget(selection('desktop_loopback'));
    expect(state.current()).toBeNull();
    expect(state.workspacePath()).toBe('/services/example/instance');
    await flush();
    state.setTarget({...selection(), request: {...selection().request, parameters: {display_name: 'Latest'}}});
    await flush();
    expect(api.fetch.mock.calls[1][1].signal.aborted).toBe(true);
    expect(state.current()?.plan.service_id).toBe('latest');
    expect(state.current()?.request.parameters).toEqual({display_name: 'Latest'});
    finishOld(plan('stale', Date.now() + 60_000, '/wrong-directory'));
    await flush();
    expect(state.current()?.plan.service_id).toBe('latest');
    expect(JSON.parse(api.fetch.mock.calls[2][1].body).workspace_path).toBe('/services/example/instance');
  });

  it('renews expired plans using the same final directory and never deploys', async () => {
    vi.useFakeTimers();
    api.fetch.mockResolvedValueOnce(plan('old', Date.now() + 1000)).mockImplementation(async () => plan('renewed'));
    const state = setup(selection());
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(state.current()?.plan.service_id).toBe('renewed');
    expect(JSON.parse(api.fetch.mock.calls[1][1].body).workspace_path).toBe('/services/example/instance');
    expect(api.fetch.mock.calls.every(([url]) => url.endsWith('/install-plans'))).toBe(true);
  });

  it('respects a changed directory and a new authorization identity', async () => {
    api.fetch.mockResolvedValue(plan('ready'));
    const state = setup(selection());
    await flush();
    state.setTarget(selection('unified_proxy', 'session-one', '/chosen'));
    await flush();
    expect(JSON.parse(api.fetch.mock.calls[1][1].body).workspace_path).toBe('/chosen');
    state.setTarget(selection('unified_proxy', 'session-two'));
    expect(state.current()).toBeNull();
    await flush();
    expect(JSON.parse(api.fetch.mock.calls[2][1].body).workspace_path).toBe('/services/example');
  });

  it('discards closed sessions and disposes expiry timers', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    api.fetch.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;})).mockImplementation(async () => plan('new'));
    const state = setup(selection());
    await flush();
    state.setTarget(null);
    await flush();
    finish(plan('closed'));
    await flush();
    expect(state.current()).toBeNull();
    expect(state.loading()).toBe(false);
    state.setTarget(selection('unified_proxy', 'new-session'));
    await flush();
    expect(state.current()?.plan.service_id).toBe('new');
    dispose?.();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps failures visible until an explicit retry', async () => {
    api.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(plan('retry'));
    const state = setup(selection());
    await flush();
    expect(state.current()).toBeNull();
    expect(state.error()).toBeInstanceOf(Error);
    expect(state.loading()).toBe(false);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    state.refresh();
    await flush();
    expect(state.current()?.plan.service_id).toBe('retry');
    expect(state.error()).toBeNull();
  });

  it.each([{}, plan('expired', Date.now() - 1000), {...plan('invalid'), expires_at_unix_ms: NaN}])('rejects an unusable plan', async result => {
    api.fetch.mockResolvedValue(result);
    const state = setup(selection());
    await flush();
    expect(state.current()).toBeNull();
    expect(state.error()).toBeInstanceOf(Error);
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
});
