// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Session } from '@floegence/flowersec-core';
import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import type { BrowserSourceService } from './browserSourceContract';
import { createBrowserWorkspaceController, type BrowserWorkspaceController } from './browserWorkspaceController';

let unbind: (() => void) | undefined;
let controller: BrowserWorkspaceController | undefined;
afterEach(() => { controller?.close(); unbind?.(); controller = undefined; });
const selection = { request: { managed_profile_id: 'browser-main' }, label: 'Default' };
const view = (id: string) => ({ id, workspace_id: 'workspace', generation: 'fixture-generation', profile_id: 'browser-main', initial_target: 'tab', protocol_version: 26, media_wire_version: 1 });
async function fixture(installed = true) {
  const request = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true, data: view('browser-view-first') }));
  unbind = await bindTestSessionHTTP(request);
  const load = vi.fn(async () => ({ enabled: true, state: installed ? 'installed' : 'not_installed', launch: { state: installed ? 'ready' : 'installation_required' } }));
  const service = { management: { loadBrowserInstallation: load } } as unknown as BrowserSourceService;
  controller = createBrowserWorkspaceController(service, selection);
  controller.setSession({} as Session);
  return { controller, request, load };
}

it('requires setup before admission and never starts an installation itself', async () => {
  const { controller, request } = await fixture(false);
  await expect(controller.open(selection)).rejects.toMatchObject({ code: 'BROWSER_INSTALL_REQUIRED' });
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', failure: 'BROWSER_INSTALL_REQUIRED' });
  expect(request).not.toHaveBeenCalled();
});

it('keeps the existing page when a replacement source cannot be opened', async () => {
  const { controller, request } = await fixture();
  await controller.open(selection);
  request.mockResolvedValueOnce(Response.json({ ok: false, error_code: 'BROWSER_SOURCE_UNAVAILABLE' }, { status: 409 }));
  await expect(controller.open({ request: { workspace_id: 'missing' }, label: 'Missing' })).rejects.toThrow();
  expect(controller.snapshot().view?.id).toBe('browser-view-first');
  expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
});

it('retires a superseded late view without replacing or deleting the current view', async () => {
  const { controller, request } = await fixture();
  let late!: (value: Response) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { late = resolve; }));
  const first = controller.open(selection).catch(() => undefined);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  request.mockResolvedValueOnce(Response.json({ ok: true, data: view('browser-view-current') }));
  await controller.open(selection);
  late(Response.json({ ok: true, data: view('browser-view-late') }));
  await first;
  expect(controller.snapshot().view?.id).toBe('browser-view-current');
  expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([path]) => String(path))).toEqual(['/_redeven_proxy/api/browser/views/browser-view-late']);
});

it('reopens the same workspace with this window’s selected native tab', async () => {
  const { controller, request } = await fixture();
  await controller.open(selection);
  controller.selectTarget('second-tab');
  expect(controller.currentRequest()).toEqual({ workspace_id: 'workspace', initial_target: 'second-tab' });
  request.mockResolvedValueOnce(Response.json({ ok: true, data: view('browser-view-next') }));
  await controller.reconnect();
  expect(String(request.mock.calls[2]![0])).toBe('/_redeven_proxy/api/browser/workspace');
  expect(JSON.parse(String(request.mock.calls[2]![1]?.body))).toEqual({ workspace_id: 'workspace', initial_target: 'second-tab' });
  controller.close(); controller.close();
  expect(() => controller.currentRequest()).toThrow('BROWSER_SOURCE_UNAVAILABLE');
  expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(2);
});

it('does not let a late fault inspection overwrite a replacement Session', async () => {
  const { controller, request } = await fixture();
  await controller.open(selection);
  let resolve!: (response: Response) => void;
  request.mockImplementation((path, init) => {
    if (String(path).endsWith('/environment')) return new Promise(done => { resolve = done; });
    return Promise.resolve(Response.json({ ok: true, data: init?.method === 'DELETE' ? null : view('browser-view-next') }));
  });
  const failure = controller.fail();
  await vi.waitFor(() => expect(resolve).toBeDefined());
  controller.setSession(undefined);
  controller.setSession({} as Session);
  await controller.reconnect();
  resolve(Response.json({ ok: true, data: { browser_service: { state: 'failed', generation: 'retired' } } }));
  await failure;
  expect(controller.snapshot()).toMatchObject({ phase: 'live', view: { id: 'browser-view-next' } });
});

it.each(['carrier', 'session'])('retains the latest selected tab after a %s disconnect', async (cause) => {
  const { controller, request } = await fixture();
  await controller.open(selection);
  controller.selectTarget('latest-native-tab');
  request.mockImplementation(async (path) => Response.json({ ok: true, data: String(path).endsWith('/environment')
    ? { browser_service: { state: 'ready', generation: 'fixture-generation' } } : view('browser-view-reconnected') }));
  if (cause === 'carrier') await controller.fail();
  else { controller.setSession(undefined); controller.setSession({} as Session); }
  await controller.reconnect();
  const opens = request.mock.calls.filter(([path]) => String(path).endsWith('/workspace'));
  expect(JSON.parse(String(opens.at(-1)?.[1]?.body))).toEqual({ workspace_id: 'workspace', initial_target: 'latest-native-tab' });
});

it('retries opening a personal profile without creating or navigating a native tab', async () => {
  const { controller, request } = await fixture();
  request.mockResolvedValueOnce(Response.json({ ok: false, error_code: 'BROWSER_OUTCOME_UNKNOWN' }, { status: 409 }));
  await expect(controller.open({ label: 'Personal', request: { connection: { extension_profile_id: 'personal' } } })).rejects.toThrow();
  await controller.reconnect();
  const opens = request.mock.calls.filter(([path]) => String(path).endsWith('/workspace'));
  expect(opens).toHaveLength(2);
  expect(opens.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { connection: { extension_profile_id: 'personal' } }, { connection: { extension_profile_id: 'personal' } },
  ]);
});

it('restores the preceding notice when the user cancels the current selection', async () => {
  const { controller, request, load } = await fixture(false);
  await expect(controller.open(selection)).rejects.toThrow();
  const before = controller.snapshot();
  load.mockResolvedValueOnce({ enabled: true, state: 'installed', launch: { state: 'ready' as const } });
  let resolve!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const abort = new AbortController();
  const open = controller.open(selection, abort.signal).catch(() => undefined);
  await vi.waitFor(() => expect(resolve).toBeDefined());
  abort.abort();
  resolve(Response.json({ ok: true, data: view('browser-view-abandoned') }));
  await open;
  expect(controller.snapshot()).toEqual(before);
  expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(1);
});

it('shows source selection on first use without starting a browser', async () => {
  const request = vi.fn(async (_path: RequestInfo | URL) => Response.json({ ok: true, data: { preference: null } }));
  unbind = await bindTestSessionHTTP(request);
  controller = createBrowserWorkspaceController({ management: {} } as BrowserSourceService);
  controller.setSession({} as Session);
  await controller.reconnect();
  expect(controller.snapshot()).toMatchObject({ phase: 'selecting', failure: undefined });
  expect(controller.snapshot().selection).toBeUndefined();
  expect(request).toHaveBeenCalledOnce();
  expect(String(request.mock.calls[0]?.[0])).toBe('/_redeven_proxy/api/browser/preference');
});

it('keeps a remembered but unavailable source distinct from first use', async () => {
  unbind = await bindTestSessionHTTP(async () => Response.json({ ok: true, data: { preference: { profile_id: 'retired-profile', installation_id: 'personal-browser' } } }));
  controller = createBrowserWorkspaceController({ management: {} } as BrowserSourceService);
  controller.setSession({} as Session);
  await controller.reconnect();
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', failure: 'BROWSER_SOURCE_UNAVAILABLE' });
});

it('does not persist a superseded source selection', async () => {
  const { controller, request } = await fixture();
  let resolve!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const abandoned = controller.open(selection).catch(() => undefined);
  await vi.waitFor(() => expect(resolve).toBeDefined());
  await controller.open(selection);
  resolve(Response.json({ ok: true, data: view('browser-view-abandoned') }));
  await abandoned;
  const saved = request.mock.calls.filter(([path]) => String(path).endsWith('/preference'));
  expect(saved).toHaveLength(1);
  expect(JSON.parse(String(saved[0]![1]?.body))).toEqual({ view_id: 'browser-view-first' });
});

it('owns preference failure presentation and cancels obsolete reads on session replacement', async () => {
  const request = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit): Promise<Response> => { throw new Error('Offline'); });
  unbind = await bindTestSessionHTTP(request);
  controller = createBrowserWorkspaceController({ management: {} } as BrowserSourceService);
  controller.setSession({} as Session);
  await expect(controller.reconnect()).rejects.toThrow('Offline');
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', failure: 'BROWSER_OPEN_FAILED' });
  let reject!: (error: Error) => void;
  request.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const obsolete = controller.reconnect().catch(() => undefined);
  const signal = request.mock.calls.at(-1)?.[1]?.signal;
  controller.setSession({} as Session);
  expect(signal?.aborted).toBe(true);
  const current = controller.snapshot();
  reject(new Error('Old request failed'));
  await obsolete;
  expect(controller.snapshot()).toEqual(current);
});
