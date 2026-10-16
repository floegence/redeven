import { afterEach, expect, it, vi } from 'vitest';
import { bindSessionHTTP } from './sessionHTTP';
import { getRemoteDesktopStatus } from './remoteDesktopApi';

afterEach(() => vi.restoreAllMocks());

it('bounds SSH status reads and allows a new authoritative check after timeout', async () => {
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
  let calls = 0;
  const release = bindSessionHTTP({
    fetch: async (url, init) => {
      expect(url).toBe('/_redeven_proxy/api/remote-desktop?target=ssh_physical');
      if (++calls === 1) return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')), { once: true }));
      return new Response(JSON.stringify({ ok: true, data: { control_in_use: false } }), { headers: { 'Content-Type': 'application/json' } });
    },
    events: async function* () {},
  });
  try {
    const pending = getRemoteDesktopStatus(true);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000);
    timeout.abort();
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await expect(getRemoteDesktopStatus(true)).resolves.toMatchObject({ control_in_use: false });
  } finally { release(); }
});
