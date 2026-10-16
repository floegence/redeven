import '../../index.css';

import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileBrowserSurfaceContext } from './FileBrowserSurfaceContext';
import { FileBrowserSurfaceHost } from './FileBrowserSurfaceHost';
import { createFileBrowserSurfaceController } from './createFileBrowserSurfaceController';

const browserLifecycle = vi.hoisted(() => ({ mounts: 0, disposals: 0 }));
const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' | null }) => Promise<void>;
};

vi.mock('./RemoteFileBrowser', () => ({
  RemoteFileBrowser: (props: { initialPathOverride?: string }) => {
    browserLifecycle.mounts += 1;
    onCleanup(() => { browserLifecycle.disposals += 1; });
    return <div data-testid="remote-file-browser" data-path={props.initialPathOverride}>Files content</div>;
  },
}));

let dispose: (() => void) | undefined;

beforeEach(async () => {
  browserLifecycle.mounts = 0;
  browserLifecycle.disposals = 0;
  await page.viewport(1440, 900);
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark');
  window.localStorage.clear();
  await media.emulateMediaPreferences({ reducedMotion: null });
});

function mountBrowser() {
  const controller = createFileBrowserSurfaceController();
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => (
    <FloeConfigProvider><LayoutProvider>
      <FileBrowserSurfaceContext.Provider value={{
        controller,
        openBrowser: async (params) => { controller.openSurface(params); },
        closeBrowser: controller.closeSurface,
      }}>
        <FileBrowserSurfaceHost />
      </FileBrowserSurfaceContext.Provider>
    </LayoutProvider></FloeConfigProvider>
  ), host);
  return controller;
}

const geometry = () => document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]');
const browser = () => document.querySelector<HTMLElement>('[data-testid="remote-file-browser"]');

async function waitForOpen() {
  await expect.poll(() => geometry()?.dataset.floatingPresence).toBe('open');
}

describe('FileBrowserSurfaceHost exit continuity', () => {
  it.each([
    ['light', 'no-preference'],
    ['dark', 'no-preference'],
    ['light', 'reduce'],
    ['dark', 'reduce'],
  ] as const)('retains the live content and title until exit ends in %s with %s motion', async (theme, reducedMotion) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    await media.emulateMediaPreferences({ reducedMotion });
    const controller = mountBrowser();
    expect(browserLifecycle.mounts).toBe(0);
    controller.openSurface({ path: '/workspace/project', title: 'Project files', persistenceKey: 'project-files' });
    await waitForOpen();
    const window = geometry()!;
    const content = browser()!;
    expect(content).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();

    expect(controller.open()).toBe(false);
    expect(controller.surface()).toBeNull();
    expect(window.dataset.floatingPresence).toBe('exiting');
    expect(window.inert).toBe(true);
    expect(window.getAttribute('aria-hidden')).toBe('true');
    expect(browser()).toBe(content);
    expect(window.querySelector('h2')?.textContent).toBe('Project files');
    expect(browserLifecycle.mounts).toBe(1);
    expect(browserLifecycle.disposals).toBe(0);

    const exitStarted = performance.now();
    while (geometry() && performance.now() - exitStarted < 1000) {
      expect(browser()).toBe(content);
      expect(window.querySelector('h2')?.textContent).toBe('Project files');
      expect(browserLifecycle.disposals).toBe(0);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    expect(geometry()).toBeNull();
    expect(browser()).toBeNull();
    expect(browserLifecycle.disposals).toBe(1);

    controller.openSurface({ path: '/workspace/project', title: 'Project files reopened' });
    await waitForOpen();
    expect(browser()).not.toBe(content);
    expect(browserLifecycle.mounts).toBe(2);
    expect(geometry()?.querySelector('h2')?.textContent).toBe('Project files reopened');
  });

  it('replaces an exiting request once and does not dispose a rapidly reopened window', async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const controller = mountBrowser();
    controller.openSurface({ path: '/workspace/first', title: 'First files' });
    await waitForOpen();
    const window = geometry()!;
    const content = browser()!;
    controller.closeSurface();
    expect(browser()).toBe(content);
    controller.openSurface({ path: '/workspace/second', title: 'Second files' });
    await waitForOpen();
    expect(geometry()).toBe(window);
    expect(browser()?.dataset.path).toBe('/workspace/second');
    expect(window.querySelector('h2')?.textContent).toBe('Second files');
    expect(browserLifecycle.mounts).toBe(2);
    expect(browserLifecycle.disposals).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(geometry()).toBe(window);
    expect(browserLifecycle.disposals).toBe(1);
    controller.closeSurface();
    await expect.poll(geometry).toBeNull();
    expect(browserLifecycle.disposals).toBe(2);
  });
});
