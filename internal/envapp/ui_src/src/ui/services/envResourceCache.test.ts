// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
const requests = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: requests.fetch }));
import { createEnvCachedResource, createEnvResourceCacheAccess, envResourceCache } from './envResourceCache';
import { LocalApiError } from './localApi';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); requests.fetch.mockReset(); });
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const decode = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid list');
  return value;
};
function mount(scope: () => string | undefined) {
  return createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: () => ({ phase: scope() ? 'ready' : 'pending', generation: 0, scope: scope() }) }, () => 'list', decode); });
}

describe('Env App cache identity and presentation binding', () => {
  it('requests identity in parallel with permissions without exposing persistent data early', async () => {
    const pending = deferred<{ scope_id: string }>();
    requests.fetch.mockReturnValue(pending.promise);
    const [readable, setReadable] = createSignal<boolean | undefined>();
    const scope = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({
      environment: () => 'parallel-host', locked: () => false, readable, connection: () => 'parallel-session',
    }); });
    await settle();
    expect(requests.fetch).toHaveBeenCalledOnce();
    pending.resolve({ scope_id: 'e'.repeat(64) }); await settle();
    expect(scope().scope).toBeUndefined();
    setReadable(true); await settle();
    expect(scope().scope).toBe('e'.repeat(64));
    expect(requests.fetch).toHaveBeenCalledOnce();
  });

  it('keeps restoration pending after unlock until the authenticated connection is available', async () => {
    requests.fetch.mockResolvedValue({ scope_id: 'f'.repeat(64) });
    const [locked, setLocked] = createSignal(true);
    const [connection, setConnection] = createSignal<string | null>(null);
    const access = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment: () => 'host', locked, readable: () => true, connection }); });
    expect(access().phase).toBe('denied');
    setLocked(false); await settle();
    expect(access().phase).toBe('pending');
    expect(requests.fetch).not.toHaveBeenCalled();
    setConnection('session'); await settle();
    expect(access().phase).toBe('ready');
  });

  it('allows volatile live data after a scope network failure without adopting a durable owner', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    requests.fetch.mockRejectedValue(new Error('offline'));
    const access = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment: () => 'offline-host', locked: () => false, readable: () => true, connection: () => 'offline-session' }); });
    const page = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: access }, () => 'offline-list', decode); });
    expect(page.ready()).toBe(false);
    await settle();
    expect(access().phase).toBe('ready');
    expect(access().scope).toBeUndefined();
    await page.refresh(async () => []);
    expect(page.data()).toEqual([]);
    expect(page.restoring()).toBe(false);
    warning.mockRestore();
  });

  it('does not restore before server identity confirmation and fences late responses across scope changes', async () => {
    const scopeID = 'confirmed-a';
    const original = mount(() => scopeID);
    await original.refresh(async () => ['alice']);
    const [scope, setScope] = createSignal<string>();
    const page = mount(scope);
    expect(page.data()).toBeUndefined();
    setScope(scopeID); await settle();
    expect(page.data()).toEqual(['alice']);
    const slow = deferred<string[]>();
    const old = page.refresh(() => slow.promise);
    setScope('confirmed-b'); await settle();
    await page.refresh(async () => ['bob']);
    slow.resolve(['late-alice']); await old;
    expect(page.data()).toEqual(['bob']);
    expect(original.data()).toEqual(['late-alice']);
  });
  it('retains a successful empty list on failure and clears every consumer on authorization rejection', async () => {
    const first = mount(() => 'authorization');
    const second = mount(() => 'authorization');
    await first.refresh(async () => []);
    await expect(first.refresh(async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(second.data()).toEqual([]);
    await expect(first.refresh(async () => { throw new LocalApiError({ status: 403, message: 'denied' }); })).rejects.toThrow('denied');
    expect(first.data()).toBeUndefined();
    expect(second.data()).toBeUndefined();
  });
  it('does not revoke a new scope when an obsolete request is denied', async () => {
    const [scope, setScope] = createSignal('denied-old');
    const page = mount(scope);
    await page.refresh(async () => ['old']);
    let reject!: (reason: unknown) => void;
    const pending = page.refresh(() => new Promise<string[]>((_resolve, fail) => { reject = fail; }));
    const denied = expect(pending).rejects.toThrow('denied');
    await settle();
    setScope('allowed-new'); await settle();
    await page.refresh(async () => ['new']);
    reject(new LocalApiError({ status: 403, message: 'denied' }));
    await denied;
    expect(page.data()).toEqual(['new']);
  });
  it('confirms scope once in the Shell, clears on lock, and ignores an obsolete identity response', async () => {
    const first = deferred<{ scope_id: string }>();
    requests.fetch.mockReturnValueOnce(first.promise).mockResolvedValue({ scope_id: 'b'.repeat(64) });
    const [environment, setEnvironment] = createSignal('host-a');
    const [locked, setLocked] = createSignal(false);
    const scope = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment, locked, readable: () => true, connection: () => 'session' }); });
    expect(scope().scope).toBeUndefined();
    setEnvironment('host-b'); await settle();
    expect(scope().scope).toBe('b'.repeat(64));
    first.resolve({ scope_id: 'a'.repeat(64) }); await settle();
    expect(scope().scope).toBe('b'.repeat(64));
    const resource = envResourceCache().resource({ scope: scope().scope!, key: 'locked-list', version: 1, decode });
    resource.set(['private']);
    setLocked(true); await settle();
    expect(scope().scope).toBeUndefined();
    expect(resource.snapshot().data).toBeUndefined();
    expect(requests.fetch).toHaveBeenCalledTimes(2);
  });
  it('retains disconnected content but confirms a new session before restoring its user scope', async () => {
    const next = deferred<{ scope_id: string }>();
    const first = deferred<{ scope_id: string }>();
    requests.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const [connection, setConnection] = createSignal<string | null>('alice-session');
    const scope = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({
      environment: () => 'host', readable: () => true, locked: () => false, connection,
    }); });
    const page = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: scope }, () => 'list', decode); });
    await expect(page.refresh(async () => ['unconfirmed-alice'])).rejects.toThrow('Resource identity is pending');
    first.resolve({ scope_id: 'c'.repeat(64) }); await settle();
    await page.refresh(async () => ['alice']);
    setConnection(null); await settle();
    expect(page.data()).toEqual(['alice']);
    setConnection('bob-session'); await settle();
    expect(scope().scope).toBeUndefined();
    expect(page.data()).toBeUndefined();
    next.resolve({ scope_id: 'd'.repeat(64) }); await settle();
    expect(scope().scope).toBe('d'.repeat(64));
    expect(page.data()).toBeUndefined();
  });
});
