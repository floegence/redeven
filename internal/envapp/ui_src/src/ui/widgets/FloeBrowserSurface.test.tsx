// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@floegence/flowersec-core';
import { englishMessages } from '@floegence/floebrowser/viewer';
import type { BrowserWindowOptions } from '../services/browserWindow';

const state = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock('../services/browserWindow', () => ({ createBrowserWindow: (options: BrowserWindowOptions) => { state.open(options); return { close: state.close }; } }));
import { browserSourceMessages } from '../i18n/browserSourceMessages';
import type { BrowserSourceService } from '../services/browserSourceContract';
import { FloeBrowserSurface } from './FloeBrowserSurface';
import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import { createBrowserWorkspaceController } from '../services/browserWorkspaceController';

const sources = { service: { management: {} } as BrowserSourceService, messages: browserSourceMessages({ t: (key: string) => key } as never), current: { label: 'Default', request: { managed_profile_id: 'browser-main' } }, select: async () => undefined };

describe('FloeBrowserSurface', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.clearAllMocks(); });
  it('lends the existing session to one scoped document and retires only that view', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const session = {} as Session;
    dispose = render(() => <FloeBrowserSurface sources={sources} onOpenWindow={async () => undefined} session={session}
      view={{ generation: 'fixture-generation', id: 'browser-view-fixture', protocol_version: 22, media_wire_version: 1, initial_target: 'source' }}
      title="Remote Browser" locale="en-US" messages={englishMessages}
      copy={{ unavailable: 'Source unavailable', connecting: 'Connecting' }} onReconnect={() => undefined} />, container);
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
    const frame = container.querySelector('iframe')!;
    const options = state.open.mock.calls[0]![0] as BrowserWindowOptions;
    expect(options.session).toBe(session);
    expect(options.configuration.sources?.current).toEqual(sources.current);
    expect(options.configuration.openWindow).toBe(true);
    expect(options.sources?.select).toBe(sources.select);
    expect(options.child()).toBe(frame.contentWindow);
    expect(new URL(frame.src).pathname).toBe('/_redeven_proxy/env/browser/');
    expect(new URL(frame.src).hash).toBe(`#${options.configuration.nonce}`);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-downloads');
    dispose(); dispose = undefined;
    expect(state.close).toHaveBeenCalledTimes(1);
  });
  it('ignores callbacks from a document retired by presentation refresh', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const descriptor = { generation: 'generation', id: 'browser-view-first', protocol_version: 22, media_wire_version: 1, initial_target: 'source' };
    const [view, setView] = createSignal(descriptor);
    const failure = vi.fn(), reconnect = vi.fn(), tabs = vi.fn(), interaction = vi.fn();
    dispose = render(() => <FloeBrowserSurface sources={sources} onOpenWindow={async () => undefined} session={{} as Session} view={view()} title="Remote Browser" locale="en-US" messages={englishMessages}
      copy={{ unavailable: 'Unavailable', connecting: 'Connecting' }} onReconnect={reconnect} onFailure={failure} onTabs={tabs} onInteraction={interaction} />, container);
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledOnce());
    const old = state.open.mock.calls[0]![0] as BrowserWindowOptions;
    setView({ ...descriptor, id: 'browser-view-next' });
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledTimes(2));
    old.onInteraction?.(); old.onStatus?.('disconnected'); old.onFailure?.('BROWSER_SERVICE_FAILED'); old.onReconnect(); old.onTabs?.({ active: 'old', tabs: [] });
    expect(interaction).not.toHaveBeenCalled(); expect(failure).not.toHaveBeenCalled(); expect(reconnect).not.toHaveBeenCalled(); expect(tabs).not.toHaveBeenCalled();
    const current = state.open.mock.calls[1]![0] as BrowserWindowOptions;
    current.onInteraction?.();
    expect(interaction).toHaveBeenCalledOnce();
    current.onStatus?.('live');
    expect(container.textContent).not.toContain('Connecting');
    current.onFailure?.('BROWSER_SERVICE_FAILED');
    expect(failure).toHaveBeenCalledExactlyOnceWith('BROWSER_SERVICE_FAILED');
    dispose(); dispose = undefined; current.onInteraction?.();
    expect(interaction).toHaveBeenCalledOnce();
  });
  it('keeps the current document alive while its source-selection request is pending', async () => {
    const descriptor = (id: string) => ({ generation: 'generation', id, profile_id: id === 'browser-view-first' ? 'browser-main' : 'profile-next', protocol_version: 22, media_wire_version: 1, initial_target: id + '-tab' });
    const request = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true, data: descriptor('browser-view-first') }));
    const unbind = await bindTestSessionHTTP(request);
    const service = { management: { loadBrowserInstallation: async () => ({ enabled: true, state: 'installed' }) } } as unknown as BrowserSourceService;
    const controller = createBrowserWorkspaceController(service, sources.current);
    const session = {} as Session;
    controller.setSession(session);
    await controller.open(sources.current);
    const [workspace, setWorkspace] = createSignal(controller.snapshot());
    const unsubscribe = controller.subscribe(setWorkspace);
    const container = document.createElement('div'); document.body.append(container);
    try {
      dispose = render(() => <Show when={workspace().view}><FloeBrowserSurface sources={{ ...sources, service, current: workspace().selection, select: controller.open }}
        onOpenWindow={async () => undefined} session={session} view={workspace().view!} title="Remote Browser" locale="en-US" messages={englishMessages}
        copy={{ unavailable: 'Unavailable', connecting: 'Connecting' }} onReconnect={() => undefined} /></Show>, container);
      await vi.waitFor(() => expect(state.open).toHaveBeenCalledOnce());
      const current = state.open.mock.calls[0]![0] as BrowserWindowOptions;
      const lifetime = new AbortController();
      state.close.mockImplementationOnce(() => lifetime.abort());
      let complete!: (response: Response) => void;
      request.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
      const selection = current.sources!.select({ label: 'Next', request: { managed_profile_id: 'profile-next' } }, lifetime.signal);
      void selection.catch(() => undefined);
      expect(state.open).toHaveBeenCalledOnce();
      expect(state.close).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(complete).toBeDefined());
      complete(Response.json({ ok: true, data: descriptor('browser-view-next') }));
      await selection;
      await vi.waitFor(() => expect(state.open).toHaveBeenCalledTimes(2));
      expect(controller.snapshot().view?.id).toBe('browser-view-next');
      expect(state.close).toHaveBeenCalledOnce();
      expect(request.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([path]) => String(path))).toEqual(['/_redeven_proxy/api/browser/views/browser-view-first']);
    } finally { dispose?.(); dispose = undefined; unsubscribe(); controller.close(); unbind(); }
  });
});
