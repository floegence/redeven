// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import type { Session } from '@floegence/flowersec-core';
import { englishMessages } from '@floegence/floebrowser/viewer';
import type { BrowserWindowOptions } from './browserWindow';
import type { BrowserSourceMessages } from '../i18n/browserSourceMessages';
import { browserDocumentURL } from './browserWindowProtocol';
import { createBrowserWorkspaceWindows, openBrowserWorkspace } from './browserWorkspaceWindows';

const hosts = vi.hoisted(() => [] as { options: BrowserWindowOptions; close: ReturnType<typeof vi.fn>; suspend: ReturnType<typeof vi.fn> }[]);
vi.mock('./browserWindow', () => ({ createBrowserWindow: (options: BrowserWindowOptions) => {
  const host = { options, close: vi.fn(() => options.onClose?.()), suspend: vi.fn() }; hosts.push(host); return host;
} }));
vi.mock('./desktopShellBridge', () => ({ desktopShellBridgeAvailable: () => false }));
vi.mock('./browserSourceManagement', () => ({ browserSourceService: () => ({ management: { loadBrowserInstallation: async () => ({ enabled: true, state: 'installed' }) } }) }));

let release: (() => void) | undefined;
let windows: ReturnType<typeof createBrowserWorkspaceWindows> | undefined;
afterEach(() => { windows?.close(); windows = undefined; release?.(); hosts.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('creates browser views through the active Session even when local HTTP has a different identity', async () => {
  const local = vi.fn(() => Promise.reject(new Error('Synthetic local-ui identity')));
  vi.stubGlobal('fetch', local);
  const view = { generation: 'fixture-generation', id: 'browser-view-fixture', initial_target: 'first', protocol_version: 24, media_wire_version: 1 };
  const session = vi.fn(async () => Response.json({ ok: true, data: view }));
  release = await bindTestSessionHTTP(session);
  await expect(openBrowserWorkspace({ managed_profile_id: 'browser-main' }, new AbortController().signal)).resolves.toEqual(view);
  expect(session).toHaveBeenCalledOnce();
  expect(local).not.toHaveBeenCalled();
});

it('replaces the document itself when selecting another source in the same window', () => {
  const view = { generation: 'fixture-generation', id: 'browser-view-fixture', initial_target: 'first', protocol_version: 24, media_wire_version: 1 };
  const first = new URL(browserDocumentURL(view, crypto.randomUUID()), location.origin);
  const next = new URL(browserDocumentURL(view, crypto.randomUUID()), location.origin);
  first.hash = ''; next.hash = '';
  expect(first.href).not.toBe(next.href);
  expect(first.pathname).toBe('/_redeven_proxy/env/browser/');
});

it.each([
  { protocol_version: 22 },
  { protocol_version: 24 },
  { media_wire_version: 2 },
  { id: 'browser-view-../other' },
])('rejects incompatible browser documents before opening a view: %j', (invalid) => {
  const view = { generation: 'fixture-generation', id: 'browser-view-fixture', initial_target: 'first', protocol_version: 24, media_wire_version: 1 };
  expect(() => browserDocumentURL({ ...view, ...invalid }, 'fixture')).toThrow('Browser version or identity unavailable');
});

async function setupWindows() {
  let sequence = 0;
  const request = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => Response.json({ ok: true, data: init?.method === 'DELETE' ? null : {
    generation: 'generation', id: `browser-view-${++sequence}`, profile_id: 'browser-main', initial_target: 'selected-tab', protocol_version: 24, media_wire_version: 1,
  } }));
  release = await bindTestSessionHTTP(request);
  const children: { close: ReturnType<typeof vi.fn>; location: { replace: ReturnType<typeof vi.fn> }; document: { title: string; body: { textContent: string } } }[] = [];
  vi.spyOn(window, 'open').mockImplementation(() => {
    const child = { close: vi.fn(), location: { replace: vi.fn() }, document: { title: '', body: { textContent: '' } } }; children.push(child); return child as unknown as Window;
  });
  windows = createBrowserWorkspaceWindows(() => ({ title: 'Remote Browser', connecting: 'Connecting', locale: 'en-US', messages: englishMessages,
    sources: { environment: 'env_local', messages: { product: { defaultProfile: 'Default' } } as BrowserSourceMessages } }));
  windows.setSession({} as Session);
  await windows.open({ managed_profile_id: 'browser-main' });
  return { windows, children, request };
}

it('retains window shells on Session loss and closing one view preserves its peer', async () => {
  const { windows, children, request } = await setupWindows();
  await windows.open({ managed_profile_id: 'browser-main' });
  const original = hosts.slice();
  windows.setSession(undefined);
  expect(children.every(child => child.close.mock.calls.length === 0)).toBe(true);
  expect(original.every(host => host.suspend.mock.calls.length === 1)).toBe(true);
  windows.setSession({} as Session);
  await vi.waitFor(() => expect(hosts).toHaveLength(4));
  expect(children).toHaveLength(2);
  hosts[2]!.options.onClose?.();
  expect(children[0]!.close).toHaveBeenCalledOnce();
  expect(children[1]!.close).not.toHaveBeenCalled();
  expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(3);
});

it('keeps the current document when source replacement fails and ignores retired callbacks', async () => {
  const { windows, children, request } = await setupWindows();
  const original = hosts[0]!;
  request.mockResolvedValueOnce(Response.json({ ok: false, error_code: 'BROWSER_SOURCE_UNAVAILABLE' }, { status: 409 }));
  await expect(original.options.sources!.select({ label: 'Missing', request: { source_target: 'missing' } }, new AbortController().signal)).rejects.toThrow();
  expect(children[0]!.location.replace).toHaveBeenCalledOnce();
  original.options.onTabs?.({ active: 'current-tab', tabs: [] });
  windows.refreshPresentation();
  await vi.waitFor(() => expect(hosts).toHaveLength(2));
  expect(children[0]!.close).not.toHaveBeenCalled();
  original.options.onClose?.(); original.options.onFailure?.('BROWSER_SERVICE_FAILED');
  expect(children[0]!.close).not.toHaveBeenCalled();
  expect(hosts[1]!.suspend).not.toHaveBeenCalled();
  const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(posts.at(-1)![1]?.body))).toEqual({ targets: ['current-tab'] });
});

it('opens another window from the confirmed current source without replaying a source operation', async () => {
  const { children, request } = await setupWindows();
  hosts[0]!.options.onTabs?.({ active: 'latest-tab', tabs: [] });
  expect(hosts[0]!.options.configuration.openWindow).toBe(true);
  await hosts[0]!.options.onOpenWindow?.();
  expect(children).toHaveLength(2);
  const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(posts.at(-1)![1]?.body))).toEqual({ targets: ['latest-tab'] });
});
