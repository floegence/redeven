// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileBrowserSurfaceContext } from './FileBrowserSurfaceContext';
import { FileBrowserSurfaceHost } from './FileBrowserSurfaceHost';
import { createFileBrowserSurfaceController } from './createFileBrowserSurfaceController';

const remoteBrowserState = vi.hoisted(() => ({
  mountCount: 0,
}));

vi.mock('./PersistentFloatingWindow', () => ({
  PersistentFloatingWindow: (props: any) => (
    <Show when={props.open}>
      {(
        <div
          ref={(node) => props.surfaceRef?.(node)}
          tabIndex={-1}
          data-testid="floating-window"
          data-persistence-key={props.persistenceKey}
          data-stack-id={String(props.stackId ?? '')}
        >
          <div data-testid="floating-window-title">{String(props.title ?? '')}</div>
          {props.children}
        </div>
      )}
    </Show>
  ),
}));

vi.mock('./RemoteFileBrowser', () => ({
  RemoteFileBrowser: (props: any) => {
    remoteBrowserState.mountCount += 1;
    return (
      <div
        data-testid="remote-file-browser"
        data-mount-id={String(remoteBrowserState.mountCount)}
        data-path={props.initialPathOverride}
        data-home-path={props.homePathOverride ?? ''}
        data-state-scope={props.stateScope}
      />
    );
  },
}));

afterEach(() => {
  document.body.innerHTML = '';
  remoteBrowserState.mountCount = 0;
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('FileBrowserSurfaceHost', () => {
  it('focuses each explicit open and restores a connected visible origin on close', async () => {
    const controller = createFileBrowserSurfaceController();
    const host = document.createElement('div');
    const origin = document.createElement('button');
    document.body.append(origin, host);
    origin.getClientRects = () => [origin.getBoundingClientRect()] as unknown as DOMRectList;
    const dispose = render(() => (
      <FileBrowserSurfaceContext.Provider value={{ controller, openBrowser: async (params) => { controller.openSurface(params); }, closeBrowser: controller.closeSurface }}>
        <FileBrowserSurfaceHost />
      </FileBrowserSurfaceContext.Provider>
    ), host);
    try {
      origin.focus();
      controller.openSurface({ path: '/workspace' });
      await flush();
      const window = host.querySelector('[data-testid="floating-window"]');
      expect(document.activeElement).toBe(window);
      origin.focus();
      controller.openSurface({ path: '/workspace/another' });
      await flush();
      expect(host.querySelector('[data-testid="floating-window"]')).toBe(window);
      expect(document.activeElement).toBe(window);
      controller.closeSurface();
      await flush();
      expect(document.activeElement).toBe(origin);
    } finally { dispose(); }
  });

  it('renders the requested browser surface and remounts on a new open request', async () => {
    let requestSeq = 0;
    const controller = createFileBrowserSurfaceController({
      createRequestId: () => `req-${++requestSeq}`,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <FileBrowserSurfaceContext.Provider
        value={{
          controller,
          openBrowser: async (params) => {
            controller.openSurface(params);
          },
          closeBrowser: controller.closeSurface,
        }}
      >
        <FileBrowserSurfaceHost />
      </FileBrowserSurfaceContext.Provider>
    ), host);

    controller.openSurface({
      path: '/workspace',
      homePath: '/Users/demo',
      stateScope: 'browser-a',
      persistenceKey: 'browser-a',
      title: 'Browser A',
    });
    await flush();

    const firstBrowser = host.querySelector('[data-testid="remote-file-browser"]') as HTMLDivElement | null;
    const floatingWindow = host.querySelector('[data-testid="floating-window"]') as HTMLDivElement | null;
    expect(floatingWindow?.getAttribute('data-stack-id')).toBe('file-browser');
    expect(firstBrowser?.getAttribute('data-mount-id')).toBe('1');
    expect(firstBrowser?.getAttribute('data-path')).toBe('/workspace');
    expect(firstBrowser?.getAttribute('data-home-path')).toBe('/Users/demo');
    expect(firstBrowser?.getAttribute('data-state-scope')).toBe('browser-a');

    controller.openSurface({
      path: '/workspace/src',
      homePath: '/Users/demo',
      stateScope: 'browser-b',
      persistenceKey: 'browser-b',
      title: 'Browser B',
    });
    await flush();

    const secondBrowser = host.querySelector('[data-testid="remote-file-browser"]') as HTMLDivElement | null;
    expect(secondBrowser?.getAttribute('data-mount-id')).toBe('2');
    expect(secondBrowser?.getAttribute('data-path')).toBe('/workspace/src');
    expect(secondBrowser?.getAttribute('data-state-scope')).toBe('browser-b');
  });
});
