import { afterEach, expect, it, vi } from 'vitest';
import { bindSessionHTTP } from './sessionHTTP';
import { listHostApplications } from './hostApplicationsApi';
import { createRemoteDesktop, getRemoteDesktopStatus } from './remoteDesktopApi';

let release: (() => void) | undefined;
afterEach(() => { release?.(); release = undefined; vi.unstubAllGlobals(); });

it('keeps graphical resource management inside the active Env native session', async () => {
  const network = vi.fn(() => { throw new Error('Unexpected raw network request'); });
  vi.stubGlobal('fetch', network);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { received: true } })));
  release = bindSessionHTTP({ fetch, events() { throw new Error('Unexpected event stream'); } });

  expect(await getRemoteDesktopStatus()).toEqual({ received: true });
  await listHostApplications('zh-CN');
  await createRemoteDesktop({ mode: 'view', display_id: 'one', locale: 'zh-CN', theme: 'dark', host_name: 'Test host', takeover: false });
  expect(fetch.mock.calls).toHaveLength(3);
  expect(network).not.toHaveBeenCalled();

  release();
  await expect(getRemoteDesktopStatus()).rejects.toThrow('Env session HTTP is unavailable');
  await expect(listHostApplications('zh-CN')).rejects.toThrow('Env session HTTP is unavailable');
  expect(fetch.mock.calls).toHaveLength(3);
  expect(network).not.toHaveBeenCalled();
});
