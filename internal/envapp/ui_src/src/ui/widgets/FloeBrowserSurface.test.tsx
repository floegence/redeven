// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@floegence/flowersec-core';
import { englishMessages } from '@floegence/floebrowser/viewer';
import type { BrowserWindowOptions } from '../services/browserWindow';

const state = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock('../services/browserWindow', () => ({ createBrowserWindow: (options: BrowserWindowOptions) => { state.open(options); return { close: state.close }; } }));
import { FloeBrowserSurface } from './FloeBrowserSurface';

describe('FloeBrowserSurface', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.clearAllMocks(); });
  it('lends the existing session to one scoped document and retires only that view', async () => {
    const container = document.createElement('div'); document.body.append(container);
    const session = {} as Session;
    dispose = render(() => <FloeBrowserSurface session={session}
      view={{ generation: 'fixture-generation', id: 'browser-view-fixture', protocol_version: 22, media_wire_version: 1, initial_target: 'source' }}
      title="Remote Browser" locale="en-US" messages={englishMessages}
      copy={{ unavailable: 'Source unavailable', connecting: 'Connecting' }} onReconnect={() => undefined} />, container);
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
    const frame = container.querySelector('iframe')!;
    const options = state.open.mock.calls[0]![0] as BrowserWindowOptions;
    expect(options.session).toBe(session);
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
    const failure = vi.fn(), reconnect = vi.fn(), tabs = vi.fn();
    dispose = render(() => <FloeBrowserSurface session={{} as Session} view={view()} title="Remote Browser" locale="en-US" messages={englishMessages}
      copy={{ unavailable: 'Unavailable', connecting: 'Connecting' }} onReconnect={reconnect} onFailure={failure} onTabs={tabs} />, container);
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledOnce());
    const old = state.open.mock.calls[0]![0] as BrowserWindowOptions;
    setView({ ...descriptor, id: 'browser-view-next' });
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledTimes(2));
    old.onStatus?.('disconnected'); old.onFailure?.('BROWSER_SERVICE_FAILED'); old.onReconnect(); old.onTabs?.({ active: 'old', tabs: [] });
    expect(failure).not.toHaveBeenCalled(); expect(reconnect).not.toHaveBeenCalled(); expect(tabs).not.toHaveBeenCalled();
    const current = state.open.mock.calls[1]![0] as BrowserWindowOptions;
    current.onStatus?.('live');
    expect(container.textContent).not.toContain('Connecting');
    current.onFailure?.('BROWSER_SERVICE_FAILED');
    expect(failure).toHaveBeenCalledExactlyOnceWith('BROWSER_SERVICE_FAILED');
  });
});
