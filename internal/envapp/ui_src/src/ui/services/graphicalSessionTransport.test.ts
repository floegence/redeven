import { afterEach, expect, it, vi } from 'vitest';
import { bindSessionHTTP } from './sessionHTTP';
import { listHostApplications } from './hostApplicationsApi';
import { createRemoteDesktop, getRemoteDesktopStatus } from './remoteDesktopApi';
import { openWebServiceRoute } from './webServiceWindows';

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

it('opens a graphical window without touching its forward over raw HTTP', async () => {
  const network = vi.fn(() => { throw new Error('Unexpected raw network request'); });
  vi.stubGlobal('fetch', network);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} })));
  release = bindSessionHTTP({ fetch, events() { throw new Error('Unexpected event stream'); } });
  const assign = vi.fn();
  await openWebServiceRoute({ kind: 'local_proxy', url: '/pf/one/_redeven_desktop/', label: 'Local proxy' }, 'one', 'http://127.0.0.1:1', 'unified_proxy', '/_redeven_desktop/', false, () => {}, {
    missingEnvContext: 'Missing environment', opening: 'Opening', openingLocalProxy: 'Opening proxy', requestingEntryTicket: 'Getting ticket', updating: 'Updating', desktopWindowFailed: 'Window failed', popupBlocked: 'Popup blocked',
  }, { location: { assign } } as unknown as Window, 'desktop');
  expect(fetch).toHaveBeenCalledWith('/_redeven_proxy/api/forwards/one/touch', expect.objectContaining({ method: 'POST' }));
  expect(assign).toHaveBeenCalledWith('/pf/one/_redeven_desktop/');
  expect(network).not.toHaveBeenCalled();
});
