import { afterEach, expect, it, vi } from 'vitest';
import { prepareCenterPluginOrigin } from './pluginWebOrigin';

afterEach(() => vi.unstubAllGlobals());

it('prepares the exact origin and removes it when the surface closes', async () => {
  const parentOrigin = 'https://env.example.test';
  vi.stubGlobal('window', { location: { origin: parentOrigin } });
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const origin = `https://${'a'.repeat(48)}.example.test`;
  await prepareCenterPluginOrigin({ origin, parentOrigin, signal: controller.signal });
  expect(fetcher.mock.calls[0]).toEqual(['/__center/plugin-origins', expect.objectContaining({ method: 'POST', body: JSON.stringify({ origin }) })]);
  controller.abort();
  expect(fetcher.mock.calls[1]).toEqual(['/__center/plugin-origins', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ origin }), keepalive: true })]);
});

it('cleans up a route prepared after its surface has already closed', async () => {
  const parentOrigin = 'https://env.example.test';
  vi.stubGlobal('window', { location: { origin: parentOrigin } });
  let finish!: (response: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const pending = prepareCenterPluginOrigin({ origin: `https://${'a'.repeat(48)}.example.test`, parentOrigin, signal: controller.signal });
  controller.abort();
  finish(new Response(JSON.stringify({ ok: true })));
  await expect(pending).rejects.toThrow();
  expect(fetcher.mock.calls[1][1].method).toBe('DELETE');
});

it('rejects a foreign route before sending parent credentials', async () => {
  const parentOrigin = 'https://env.example.test';
  vi.stubGlobal('window', { location: { origin: parentOrigin } });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(prepareCenterPluginOrigin({ origin: `https://${'a'.repeat(48)}.evil.test`, parentOrigin, signal: new AbortController().signal })).rejects.toThrow('CENTER_INVALID_TARGET');
  expect(fetcher).not.toHaveBeenCalled();
});
