// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installCenterEntryActivity } from './centerEntryActivity';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('reads expiry without extending it and ignores programmatic input', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response('{}'));
  vi.stubGlobal('fetch', fetcher);
  const expired = vi.fn();
  const dispose = installCenterEntryActivity(expired);
  await vi.advanceTimersByTimeAsync(0);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
  document.dispatchEvent(new MouseEvent('pointerdown'));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(call => call[0] === '/__center/session')).toBe(true);
  dispose();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(expired).not.toHaveBeenCalled();
});
it('disconnects exactly once after server revocation', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
  const expired = vi.fn();
  const dispose = installCenterEntryActivity(expired);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(expired).toHaveBeenCalledTimes(1);
  dispose();
});

it('warns once near expiry without renewing the session', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({ data: { device: { expires_at: Date.now() + 240_000 } } })));
  vi.stubGlobal('fetch', fetcher);
  const expiring = vi.fn();
  const dispose = installCenterEntryActivity(vi.fn(), expiring);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(expiring).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.every(call => call[0] === '/__center/session')).toBe(true);
  dispose();
});
