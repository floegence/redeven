// @vitest-environment jsdom
import { MessageChannel } from 'node:worker_threads';
import { afterEach, expect, it, vi } from 'vitest';
import type { BrowserDocumentConfiguration } from './ui/services/browserWindowProtocol';
import type { mountBrowserRecovery, mountBrowserSources } from './browserSources';

const state = vi.hoisted(() => ({
  recovery: undefined as Parameters<typeof mountBrowserRecovery>[0] | undefined,
  sources: undefined as Parameters<typeof mountBrowserSources>[0] | undefined,
  disposeSources: vi.fn(),
}));
vi.mock('@floegence/floebrowser/viewer', () => ({
  mountBrowser: vi.fn(),
  projectionPortConnection: vi.fn(() => ({})),
}));
vi.mock('./browserSources', () => ({
  mountBrowserRecovery: (configuration: Parameters<typeof mountBrowserRecovery>[0]) => { state.recovery = configuration; return vi.fn(); },
  mountBrowserSources: (configuration: Parameters<typeof mountBrowserSources>[0]) => { state.sources = configuration; return state.disposeSources; },
}));

const channels: MessageChannel[] = [];
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  for (const channel of channels.splice(0)) { channel.port1.close(); channel.port2.close(); }
  document.body.replaceChildren();
  history.replaceState(null, '', '/');
  vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules();
  state.sources = undefined; state.recovery = undefined;
});

it('keeps source-selection intent alive while a retired document reports opening and failure', async () => {
  const owner = { postMessage: vi.fn() };
  vi.stubGlobal('opener', owner);
  const nonce = 'browser-document-fixture';
  history.replaceState(null, '', `/#${nonce}`);
  await import('./browserDocument');
  const ports = Array.from({ length: 3 }, () => { const channel = new MessageChannel(); channels.push(channel); return channel; });
  const configuration = {
    type: 'redeven-browser-ports', nonce, title: 'Remote Browser', locale: 'en-US', messages: {}, theme: { tokens: {}, dark: false, surfaceStyle: '', shellTheme: '', fontFamily: 'sans-serif' },
    failure: 'BROWSER_SERVICE_FAILED',
    sources: { desktop: false, current: { label: 'Default', request: { managed_profile_id: 'browser-main' } }, messages: { product: {}, computer: {} } },
  } as BrowserDocumentConfiguration;
  window.dispatchEvent(new MessageEvent('message', { source: owner as unknown as Window, origin: location.origin, data: configuration, ports: ports.map(channel => channel.port2) as unknown as MessagePort[] }));
  await vi.waitFor(() => expect(state.recovery).toBeDefined());
  state.recovery!.chooseSource();
  await vi.waitFor(() => expect(state.sources).toBeDefined());
  const lifetime = new AbortController();
  state.disposeSources.mockImplementation(() => lifetime.abort());
  const product = ports[2]!.port1;
  const received = new Promise<{ id: number }>(resolve => { product.onmessage = event => { if (event.data.operation?.method === 'source.select') resolve(event.data); }; });
  const selecting = state.sources!.select({ label: 'Default', request: { managed_profile_id: 'browser-main' } }, lifetime.signal);
  // Keep a rejected selection visible to the assertion without an unhandled rejection.
  const result = selecting.then(() => 'selected', error => error);
  const operation = await received;
  product.postMessage({ type: 'workspace.failure', code: 'BROWSER_DISCONNECTED', phase: 'opening' });
  await vi.waitFor(() => expect(state.recovery!.state.phase).toBe('opening'));
  expect(state.disposeSources).not.toHaveBeenCalled();
  expect(lifetime.signal.aborted).toBe(false);
  product.postMessage({ type: 'workspace.failure', code: 'BROWSER_OPEN_TIMEOUT', phase: 'failed' });
  await vi.waitFor(() => expect(state.recovery!.state.failure).toBe('BROWSER_OPEN_TIMEOUT'));
  expect(state.disposeSources).not.toHaveBeenCalled();
  product.postMessage({ type: 'result', id: operation.id, ok: false, code: 'BROWSER_OPEN_TIMEOUT' });
  expect(await result).toMatchObject({ code: 'BROWSER_OPEN_TIMEOUT' });
  state.sources!.close();
  expect(state.disposeSources).toHaveBeenCalledOnce();
  expect(lifetime.signal.aborted).toBe(true);
});
