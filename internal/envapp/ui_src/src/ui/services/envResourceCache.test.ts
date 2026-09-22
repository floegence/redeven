// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
const requests = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('./localApi', async original => ({ ...await original<object>(), fetchLocalApiJSON: requests.fetch }));
import { createEnvCachedResource, createEnvResourceCacheScope, envResourceCache } from './envResourceCache';
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
  return createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheScope: scope }, () => 'list', decode); });
}

describe('Env App cache identity and presentation binding', () => {
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
    const scope = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheScope({ environment, locked, readable: () => true, connection: () => 'session' }); });
    expect(scope()).toBeUndefined();
    setEnvironment('host-b'); await settle();
    expect(scope()).toBe('b'.repeat(64));
    first.resolve({ scope_id: 'a'.repeat(64) }); await settle();
    expect(scope()).toBe('b'.repeat(64));
    const resource = envResourceCache().resource({ scope: scope()!, key: 'locked-list', version: 1, decode });
    resource.set(['private']);
    setLocked(true); await settle();
    expect(scope()).toBeUndefined();
    expect(resource.snapshot().data).toBeUndefined();
    expect(requests.fetch).toHaveBeenCalledTimes(2);
  });
  it('retains disconnected content but confirms a new session before restoring its user scope', async () => {
    const next = deferred<{ scope_id: string }>();
    const first = deferred<{ scope_id: string }>();
    requests.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const [connection, setConnection] = createSignal<string | null>('alice-session');
    const scope = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheScope({
      environment: () => 'host', readable: () => true, locked: () => false, connection,
    }); });
    const page = mount(scope);
    await page.refresh(async () => ['unconfirmed-alice']);
    first.resolve({ scope_id: 'c'.repeat(64) }); await settle();
    await page.refresh(async () => ['alice']);
    setConnection(null); await settle();
    expect(page.data()).toEqual(['alice']);
    setConnection('bob-session'); await settle();
    expect(scope()).toBeUndefined();
    expect(page.data()).toBeUndefined();
    next.resolve({ scope_id: 'd'.repeat(64) }); await settle();
    expect(scope()).toBe('d'.repeat(64));
    expect(page.data()).toBeUndefined();
  });
});
