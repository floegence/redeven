// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWebServiceBrowserDocumentURL } from '../main/webServiceBrowserDocument';
import { desktopSemanticPaletteForShellTheme, desktopWindowThemeSnapshotForShellTheme } from '../main/desktopTheme';
import { desktopRendererThemeSnapshot, DESKTOP_THEME_GET_SNAPSHOT_CHANNEL, DESKTOP_THEME_UPDATED_CHANNEL } from '../shared/desktopThemeIPC';
import { resolveDesktopWindowChromeSnapshot } from '../shared/windowChromePlatform';
import { DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL, DESKTOP_WINDOW_CHROME_UPDATED_CHANNEL } from '../shared/windowChromeIPC';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';
import { DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL } from '../shared/desktopWebServiceBrowserIPC';

const { listeners, invoke, sendSync, expose } = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
  invoke: vi.fn(), sendSync: vi.fn(), expose: vi.fn(),
}));
vi.mock('electron', () => ({
  ipcRenderer: { on: (channel: string, listener: (event: unknown, payload: unknown) => void) => listeners.set(channel, listener), invoke, sendSync },
  contextBridge: { exposeInMainWorld: expose },
}));

const copy = {
  locale: 'en-US', title: 'Web Service', addressLabel: 'Web Service address', addressPlaceholder: 'Enter an address or path',
  backLabel: 'Back', forwardLabel: 'Forward', reloadLabel: 'Reload', stopLabel: 'Stop', navigateLabel: 'Go',
  developerToolsLabel: 'Developer tools', openExternalLabel: 'Open in browser', secureRouteLabel: 'Protected route',
};
const theme: DesktopThemeSnapshot = {
  source: 'dark', resolvedTheme: 'dark', shellThemes: { version: 1, light: 'mist', dark: 'forest' }, activeShellTheme: 'forest',
  window: desktopWindowThemeSnapshotForShellTheme('forest'), semantic: desktopSemanticPaletteForShellTheme('forest'),
};
const state = { address: 'http://localhost:3000/', title: 'Example', loading: false, can_go_back: true, can_go_forward: false,
  devtools_open: false, open_external_available: true, open_external_unavailable_reason: '', error_message: '' };

async function bootstrap() {
  await import('./webServiceBrowser');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await Promise.resolve();
}

describe('Web Service toolbar theme continuity', () => {
  beforeEach(() => {
    vi.resetModules();
    listeners.clear(); invoke.mockReset(); sendSync.mockReset(); expose.mockReset();
    const html = decodeURIComponent(buildWebServiceBrowserDocumentURL(copy, theme).split(',').slice(1).join(','));
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.documentElement.innerHTML = parsed.documentElement.innerHTML;
    document.documentElement.dataset.floeShellTheme = 'forest';
    invoke.mockResolvedValue(state);
    sendSync.mockImplementation((channel: string) => channel === DESKTOP_THEME_GET_SNAPSHOT_CHANNEL
      ? desktopRendererThemeSnapshot(theme)
      : channel === DESKTOP_WINDOW_CHROME_GET_SNAPSHOT_CHANNEL ? resolveDesktopWindowChromeSnapshot('darwin') : null);
  });

  it('updates a live preset without replacing the address draft, selection, focus, or browser state', async () => {
    await bootstrap();
    const input = document.getElementById('browser-address') as HTMLInputElement;
    input.focus(); input.value = 'http://localhost:3000/unfinished'; input.setSelectionRange(9, 16);
    const next = { ...theme, activeShellTheme: 'ember', shellThemes: { ...theme.shellThemes, dark: 'ember' }, window: desktopWindowThemeSnapshotForShellTheme('ember') };
    expect(listeners.has(DESKTOP_THEME_UPDATED_CHANNEL)).toBe(true);
    listeners.get(DESKTOP_THEME_UPDATED_CHANNEL)?.({}, desktopRendererThemeSnapshot(next));
    expect(document.documentElement.dataset.floeShellTheme).toBe('ember');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.getElementById('browser-address')).toBe(input);
    expect(input.value).toBe('http://localhost:3000/unfinished');
    expect([input.selectionStart, input.selectionEnd]).toEqual([9, 16]);
    expect(document.activeElement).toBe(input);
    listeners.get(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL)?.({}, { ...state, title: 'Renamed' });
    expect(input.value).toBe('http://localhost:3000/unfinished');
    expect(document.getElementById('browser-title')?.textContent).toBe('Renamed - Web Service');
    expect(document.title).toBe('Renamed - Web Service');
    expect(expose).not.toHaveBeenCalled();
  });

  it('applies initial and fullscreen window safe areas and ignores invalid theme updates', async () => {
    await bootstrap();
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-titlebar-start-inset')).toBe('84px');
    listeners.get(DESKTOP_WINDOW_CHROME_UPDATED_CHANNEL)?.({}, resolveDesktopWindowChromeSnapshot('darwin', { fullScreen: true }));
    expect(document.documentElement.style.getPropertyValue('--redeven-desktop-titlebar-start-inset')).toBe('16px');
    listeners.get(DESKTOP_THEME_UPDATED_CHANNEL)?.({}, { ...desktopRendererThemeSnapshot(theme), activeShellTheme: 'unknown' });
    expect(document.documentElement.dataset.floeShellTheme).toBe('forest');
  });

  it('keeps navigation, Escape, loading, and developer tools usable after a theme update', async () => {
    await bootstrap();
    listeners.get(DESKTOP_THEME_UPDATED_CHANNEL)?.({}, desktopRendererThemeSnapshot(theme));
    const input = document.getElementById('browser-address') as HTMLInputElement;
    input.focus(); input.value = '/draft';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.value).toBe(state.address);
    expect(document.activeElement).not.toBe(input);
    invoke.mockResolvedValue({ ok: true });
    input.focus(); input.value = '/settings';
    document.getElementById('browser-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('redeven-desktop:web-service-browser-action', { action: 'navigate', address: '/settings' });
    listeners.get(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL)?.({}, { ...state, loading: true, devtools_open: true });
    expect(document.getElementById('browser-progress')?.dataset.loading).toBe('true');
    expect(document.getElementById('browser-reload')?.getAttribute('aria-label')).toBe('Stop');
    expect(document.getElementById('browser-devtools')?.getAttribute('aria-pressed')).toBe('true');
    document.getElementById('browser-reload')?.click();
    document.getElementById('browser-devtools')?.click();
    expect(invoke).toHaveBeenCalledWith('redeven-desktop:web-service-browser-action', { action: 'stop' });
    expect(invoke).toHaveBeenCalledWith('redeven-desktop:web-service-browser-action', { action: 'toggle_devtools' });
  });


  it('retains an unfinished address across window blur and background page state updates', async () => {
    await bootstrap();
    const input = document.getElementById('browser-address') as HTMLInputElement;
    input.focus(); input.value = '/unfinished'; input.blur();
    listeners.get(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL)?.({}, { ...state, title: 'Background page update' });
    expect(input.value).toBe('/unfinished');
    input.focus(); input.value = ''; input.blur();
    listeners.get(DESKTOP_WEB_SERVICE_BROWSER_STATE_UPDATED_CHANNEL)?.({}, { ...state, address: 'http://localhost:3000/next' });
    expect(input.value).toBe('http://localhost:3000/next');
  });

});
