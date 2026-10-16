import '../../index.css';

import { builtInShellThemePresets, FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { commands, page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewContext } from './FilePreviewContext';
import { FilePreviewHost } from './FilePreviewHost';
import { createFilePreviewController, type FilePreviewController } from './createFilePreviewController';

const transport = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../utils/fileStreamReader', () => ({ openReadFileStreamChannel: (...args: unknown[]) => transport.read(...args) }));
vi.mock('../pages/EnvContext', () => ({ useEnvContext: () => ({ openFlowerTurnLauncher: vi.fn() }) }));
vi.mock('../downloads/DownloadContext', () => ({ useDownloadManager: () => ({ enqueue: vi.fn() }) }));
vi.mock('@floegence/floe-webapp-core', async original => ({
  ...await original<typeof import('@floegence/floe-webapp-core')>(),
  useNotification: () => ({ error: vi.fn() }),
}));

const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' | null }) => Promise<void>;
  inspectFilePreviewDismissal: () => Promise<{ brightness: number[] }>;
};
let dispose: (() => void) | undefined;
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  document.body.style.removeProperty('background');
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  window.localStorage.clear();
  vi.restoreAllMocks();
  await media.emulateMediaPreferences({ reducedMotion: null });
});

const file = { id: '/workspace/bear-cycling.html', name: 'bear-cycling.html', path: '/workspace/bear-cycling.html', type: 'file' as const };
const html = '<html><body style="background:#fff9ea;color:#332e25"><h1>Bear cycling</h1><button>Keep riding</button></body></html>';
const geometry = () => document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]');
const frame = () => document.querySelector<HTMLIFrameElement>('iframe.html-preview-frame');

function mountPreview(theme: 'light' | 'dark' = 'dark') {
  transport.read.mockReset().mockImplementation(async () => {
    const bytes = new TextEncoder().encode(html);
    return { meta: { content_len: bytes.length }, channel: {
      reader: { readExactly: async () => bytes }, close: vi.fn(async () => undefined), stream: { reset: vi.fn() },
    } };
  });
  let controller!: FilePreviewController;
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => {
    controller = createFilePreviewController({ client: () => ({} as never), rpc: () => null, canWrite: () => true });
    return <FloeConfigProvider config={{ storage: { enabled: false }, theme: {
      defaultTheme: theme, defaultSurfaceStyle: 'soft-neumorphic', shellPresets: builtInShellThemePresets,
      defaultShellPreset: { light: 'paper', dark: 'classic-dark' },
    } }}><ThemeProvider><LayoutProvider>
      <FilePreviewContext.Provider value={{ controller, openPreview: controller.openPreview, closePreview: controller.closePreview }}>
        <button data-testid="underlay-action" type="button">Underlay action</button>
        <FilePreviewHost />
      </FilePreviewContext.Provider>
    </LayoutProvider></ThemeProvider></FloeConfigProvider>;
  }, host);
  return controller;
}

async function openPreview(controller: FilePreviewController) {
  await controller.openPreview(file);
  await expect.poll(() => geometry()?.dataset.floatingPresence).toBe('open');
  await expect.poll(frame).not.toBeNull();
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

describe('File preview dismissal continuity', () => {
  it('fades the bright HTML page onto the dark background without a brighter intermediate frame', async () => {
    await page.viewport(1440, 900);
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    document.body.style.background = '#111';
    const controller = mountPreview();
    await openPreview(controller);
    const { brightness } = await media.inspectFilePreviewDismissal();
    console.info('Preview exit pixel brightness', brightness);
    expect(brightness.length).toBeGreaterThanOrEqual(3);
    expect(brightness[0]).toBeGreaterThan(230);
    expect(brightness.at(-1)).toBeLessThan(40);
    for (let index = 1; index < brightness.length; index += 1) {
      expect(brightness[index]!).toBeLessThanOrEqual(brightness[index - 1]! + 2);
    }
  });

  it('keeps repeated close handling and exit frames responsive without additional reads', async () => {
    await page.viewport(1440, 900);
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const controller = mountPreview();
    const closeMs: number[] = [];
    const frameMs: number[] = [];
    let underlayActions = 0;
    document.querySelector('[data-testid="underlay-action"]')!.addEventListener('click', () => { underlayActions += 1; });
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await openPreview(controller);
      const started = performance.now();
      controller.closePreview();
      closeMs.push(performance.now() - started);
      expect(controller.open()).toBe(false);
      document.querySelector<HTMLButtonElement>('[data-testid="underlay-action"]')!.click();
      expect(underlayActions).toBe(cycle + 1);
      let previous = performance.now();
      while (geometry() && performance.now() - started < 1000) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const current = performance.now();
        frameMs.push(current - previous);
        previous = current;
      }
      expect(geometry()).toBeNull();
      expect(controller.item()).toBeNull();
      expect(controller.bytes()).toBeNull();
      expect(transport.read).toHaveBeenCalledTimes(cycle + 1);
    }
    console.info('Preview close responsiveness', { closeMs, maximumFrameMs: Math.max(...frameMs) });
    expect(Math.max(...closeMs)).toBeLessThan(50);
    expect(Math.max(...frameMs)).toBeLessThan(50);
  });

  it('cancels exit on rapid reopen and retires only the final preview', async () => {
    await page.viewport(1440, 900);
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const controller = mountPreview();
    await openPreview(controller);
    const window = geometry()!;
    controller.closePreview();
    const next = { ...file, id: '/workspace/second.html', path: '/workspace/second.html', name: 'second.html' };
    await controller.openPreview(next);
    await expect.poll(() => geometry()?.dataset.floatingPresence).toBe('open');
    expect(geometry()).toBe(window);
    const currentFrame = frame();
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(geometry()).toBe(window);
    expect(frame()).toBe(currentFrame);
    expect(window.querySelector('h2')?.textContent).toBe(next.name);
    expect(controller.item()).toBe(next);
    controller.closePreview();
    await expect.poll(geometry).toBeNull();
    expect(controller.item()).toBeNull();
    expect(controller.bytes()).toBeNull();
  });

  it('retains the mobile dialog document until the published dialog unmounts', async () => {
    await page.viewport(390, 844);
    const controller = mountPreview();
    await controller.openPreview(file);
    await expect.poll(frame).not.toBeNull();
    const originalFrame = frame();
    controller.closePreview();
    expect(controller.open()).toBe(false);
    expect(frame()).toBe(originalFrame);
    await expect.poll(frame).toBeNull();
    expect(controller.item()).toBeNull();
    expect(controller.bytes()).toBeNull();
  });

  it.each([
    ['light', 'no-preference'], ['dark', 'no-preference'], ['light', 'reduce'], ['dark', 'reduce'],
  ] as const)('preserves the live HTML document through exit in %s with %s motion', async (theme, reducedMotion) => {
    await page.viewport(1440, 900);
    await media.emulateMediaPreferences({ reducedMotion });
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const controller = mountPreview(theme);
    await openPreview(controller);
    const window = geometry()!;
    const originalFrame = frame()!;
    const source = originalFrame.srcdoc;
    const readCount = transport.read.mock.calls.length;
    window.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
    expect(controller.open()).toBe(false);
    expect(window.dataset.floatingPresence).toBe('exiting');
    expect(window.inert).toBe(true);
    expect(frame()).toBe(originalFrame);
    expect(originalFrame.srcdoc).toBe(source);
    expect(window.querySelector('h2')?.textContent).toBe(file.name);
    const started = performance.now();
    while (geometry() && performance.now() - started < 1000) {
      expect(frame()).toBe(originalFrame);
      expect(originalFrame.srcdoc).toBe(source);
      expect(window.querySelector('h2')?.textContent).toBe(file.name);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    expect(geometry()).toBeNull();
    expect(frame()).toBeNull();
    expect(controller.item()).toBeNull();
    expect(controller.text()).toBe('');
    expect(controller.bytes()).toBeNull();
    expect(transport.read).toHaveBeenCalledTimes(readCount);
  });
});
