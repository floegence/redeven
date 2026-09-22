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
  it.each([{ values: ['visible'] }, { values: [] }])('retains the same handle and successful content through same-user revalidation: %j', async ({ values }) => {
    const confirmed = '9'.repeat(64);
    const verification = deferred<{ scope_id: string }>();
    requests.fetch.mockResolvedValueOnce({ scope_id: confirmed }).mockReturnValueOnce(verification.promise);
    const [connection, setConnection] = createSignal<string | null>('first');
    const [readable, setReadable] = createSignal<boolean | undefined>(true);
    const access = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment: () => 'same-user', locked: () => false, readable, connection }); });
    const page = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: access }, () => 'retained-list', decode); });
    await settle();
    await page.refresh(async () => values);
    const original = page.identity();
    const operationCurrent = page.captureAuthority();
    setConnection(null); await settle();
    expect(page.data()).toEqual(values);
    setReadable(undefined); setConnection('replacement'); await settle();
    expect(page.data()).toEqual(values);
    expect(page.identity()).toBe(original);
    expect(page.ready()).toBe(false);
    verification.resolve({ scope_id: confirmed }); await settle();
    expect(page.data()).toEqual(values);
    expect(page.ready()).toBe(false);
    setReadable(true); await settle();
    expect(page.data()).toEqual(values);
    expect(page.ready()).toBe(true);
    expect(page.identity()).toBe(original);
    expect(operationCurrent()).toBe(false);
  });

  it('removes the previous user as soon as a changed identity is confirmed, even before permissions settle', async () => {
    const next = deferred<{ scope_id: string }>();
    requests.fetch.mockResolvedValueOnce({ scope_id: '1'.repeat(64) }).mockReturnValueOnce(next.promise);
    const [connection, setConnection] = createSignal('first');
    const [readable, setReadable] = createSignal<boolean | undefined>(true);
    const access = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment: () => 'changed-user', readable, locked: () => false, connection }); });
    const page = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: access }, () => 'list', decode); });
    await settle(); await page.refresh(async () => ['private']);
    setReadable(undefined); setConnection('second'); await settle();
    expect(page.data()).toEqual(['private']);
    next.resolve({ scope_id: '2'.repeat(64) }); await settle();
    expect(page.data()).toBeUndefined();
    expect(access().phase).toBe('pending');
    setReadable(false); await settle();
    expect(access().phase).toBe('denied');
  });

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

  it('cancels old requests immediately and ignores late denial during transport replacement', async () => {
    requests.fetch.mockResolvedValue({ scope_id: '8'.repeat(64) });
    const [connection, setConnection] = createSignal('first');
    const access = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment: () => 'request-fence', readable: () => true, locked: () => false, connection }); });
    const page = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: access }, () => 'requests', decode); });
    await settle(); await page.refresh(async () => ['previous']);
    let deny!: (reason: unknown) => void;
    const old = page.refresh(() => new Promise<string[]>((_resolve, reject) => { deny = reject; }));
    const cancelled = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await settle(); setConnection('replacement'); await settle();
    await cancelled;
    await page.refresh(async () => ['current']);
    deny(new LocalApiError({ status: 403, message: 'obsolete denial' })); await settle();
    expect(page.data()).toEqual(['current']);
    expect(access().phase).toBe('ready');
  });

  it('retains the confirmed owner after a scope lookup failure and retries explicitly', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    requests.fetch.mockResolvedValueOnce({ scope_id: '7'.repeat(64) }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ scope_id: '7'.repeat(64) });
    const [connection, setConnection] = createSignal('first');
    const access = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment: () => 'lookup-failure', readable: () => true, locked: () => false, connection }); });
    const page = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: access }, () => 'list', decode); });
    await settle(); await page.refresh(async () => ['visible']);
    const owner = page.identity();
    setConnection('replacement'); await settle();
    expect(page.data()).toEqual(['visible']);
    expect(page.identity()).toBe(owner);
    expect(page.ready()).toBe(false);
    access().retry?.(); await settle();
    expect(page.ready()).toBe(true);
    expect(page.identity()).toBe(owner);
    warning.mockRestore();
  });

  it('keeps a live-only owner for the authentication lifetime even when scope lookup recovers', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    requests.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ scope_id: '6'.repeat(64) });
    const [connection, setConnection] = createSignal('first');
    const access = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment: () => 'volatile-owner', readable: () => true, locked: () => false, connection }); });
    const first = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: access }, () => 'list', decode); });
    const second = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: access }, () => 'list', decode); });
    await settle(); await first.refresh(async () => ['live']);
    const owner = first.identity();
    expect(second.data()).toEqual(['live']);
    setConnection('replacement'); await settle();
    expect(first.data()).toEqual(['live']);
    expect(first.identity()).toBe(owner);
    expect(access().scope).toBeUndefined();
    warning.mockRestore();
  });

  it('revokes presentation immediately for an explicit authentication boundary', async () => {
    requests.fetch.mockResolvedValueOnce({ scope_id: '5'.repeat(64) }).mockReturnValue(new Promise(() => {}));
    const [authentication, setAuthentication] = createSignal(0);
    const access = createRoot(dispose => { cleanups.push(dispose); return createEnvResourceCacheAccess({ environment: () => 'auth-boundary', readable: () => true, locked: () => false, connection: () => 'transport', authentication }); });
    const page = createRoot(dispose => { cleanups.push(dispose); return createEnvCachedResource({ resourceCacheAccess: access }, () => 'list', decode); });
    await settle(); await page.refresh(async () => ['private']);
    setAuthentication(1); await settle();
    expect(page.data()).toBeUndefined();
    expect(page.ready()).toBe(false);
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
    slow.resolve(['late-alice']); await expect(old).rejects.toMatchObject({ name: 'AbortError' });
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
  it('retains transport revalidation content and clears it when a different user is confirmed', async () => {
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
    expect(scope().phase).toBe('revalidating');
    expect(page.data()).toEqual(['alice']);
    next.resolve({ scope_id: 'd'.repeat(64) }); await settle();
    expect(scope().scope).toBe('d'.repeat(64));
    expect(page.data()).toBeUndefined();
  });
});
