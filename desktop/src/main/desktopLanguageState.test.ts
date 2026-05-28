import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { DesktopLanguageState } from './desktopLanguageState';
import { DESKTOP_LANGUAGE_UPDATED_CHANNEL } from '../shared/desktopLanguageIPC';
import { REDEVEN_LANGUAGE_PREFERENCE_STATE_KEY } from '../shared/i18n/desktopLanguage';

class FakeLocaleProvider {
  preferredLanguages: string[] = [];
  locale = '';

  getPreferredSystemLanguages(): string[] {
    return this.preferredLanguages;
  }

  getLocale(): string {
    return this.locale;
  }
}

class FakeWindow extends EventEmitter {
  destroyed = false;
  readonly webContents = {
    send: vi.fn(),
  };
  readonly setTitle = vi.fn();

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

function createStore(initialPreference: string | null = null) {
  const rendererStorage = new Map<string, string>();
  if (initialPreference !== null) {
    rendererStorage.set(REDEVEN_LANGUAGE_PREFERENCE_STATE_KEY, initialPreference);
  }
  return {
    getRendererItem: (key: string) => rendererStorage.get(key) ?? null,
    setRendererItem: (key: string, value: string) => {
      rendererStorage.set(key, value);
    },
    rendererStorage,
  };
}

describe('DesktopLanguageState', () => {
  it('loads the persisted explicit preference and keeps system candidates in the snapshot', () => {
    const store = createStore('ja-JP');
    const provider = new FakeLocaleProvider();
    provider.preferredLanguages = ['zh-Hans', 'en-US'];

    const state = new DesktopLanguageState(store, provider);

    expect(state.getSnapshot()).toEqual({
      preference: 'ja-JP',
      resolved_locale: 'ja-JP',
      source: 'explicit',
      system_candidates: ['zh-Hans', 'en-US'],
    });
  });

  it('resolves system mode from main-process system candidates', () => {
    const store = createStore('system');
    const provider = new FakeLocaleProvider();
    provider.preferredLanguages = ['pt-PT'];
    provider.locale = 'en-US';

    const state = new DesktopLanguageState(store, provider);

    expect(state.getSnapshot()).toEqual({
      preference: 'system',
      resolved_locale: 'pt-BR',
      source: 'system',
      system_candidates: ['pt-PT', 'en-US'],
    });
  });

  it('falls back to system mode for invalid stored values', () => {
    const store = createStore('not-a-locale');
    const provider = new FakeLocaleProvider();
    provider.preferredLanguages = ['nl-NL'];

    const state = new DesktopLanguageState(store, provider);

    expect(state.getSnapshot()).toEqual({
      preference: 'system',
      resolved_locale: 'en-US',
      source: 'fallback',
      system_candidates: ['nl-NL'],
    });
  });

  it('persists preference changes and broadcasts snapshots to registered windows without retitling sessions', () => {
    const store = createStore('system');
    const provider = new FakeLocaleProvider();
    provider.preferredLanguages = ['de-DE'];
    const onSnapshotChanged = vi.fn();
    const state = new DesktopLanguageState(store, provider, { onSnapshotChanged });
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.webContents.send.mockClear();

    const snapshot = state.setPreference('zh-TW');

    expect(store.rendererStorage.get(REDEVEN_LANGUAGE_PREFERENCE_STATE_KEY)).toBe('zh-TW');
    expect(snapshot).toEqual({
      preference: 'zh-TW',
      resolved_locale: 'zh-TW',
      source: 'explicit',
      system_candidates: ['de-DE'],
    });
    expect(win.setTitle).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(DESKTOP_LANGUAGE_UPDATED_CHANNEL, snapshot);
    expect(onSnapshotChanged).toHaveBeenCalledWith(snapshot);
  });

  it('normalizes invalid preference updates back to system mode', () => {
    const store = createStore('zh-CN');
    const provider = new FakeLocaleProvider();
    provider.preferredLanguages = ['de-DE'];
    const state = new DesktopLanguageState(store, provider);

    const snapshot = state.setPreference('not-a-locale');

    expect(store.rendererStorage.get(REDEVEN_LANGUAGE_PREFERENCE_STATE_KEY)).toBe('system');
    expect(snapshot).toMatchObject({
      preference: 'system',
      resolved_locale: 'de-DE',
      source: 'system',
    });
  });

  it('updates native window titles with the resolved language snapshot', () => {
    const store = createStore('system');
    const provider = new FakeLocaleProvider();
    provider.preferredLanguages = ['de-DE'];
    const state = new DesktopLanguageState(store, provider);
    const win = new FakeWindow();

    state.registerWindow(win as never, {
      titleForSnapshot: (snapshot) => `title:${snapshot.resolved_locale}`,
    });

    expect(win.setTitle).toHaveBeenCalledWith('title:de-DE');
    win.setTitle.mockClear();

    const snapshot = state.setPreference('fr-FR');

    expect(snapshot.resolved_locale).toBe('fr-FR');
    expect(win.setTitle).toHaveBeenCalledWith('title:fr-FR');
  });

  it('broadcasts resolved locale changes while staying in system preference mode', () => {
    const store = createStore('system');
    const provider = new FakeLocaleProvider();
    provider.preferredLanguages = ['de-DE'];
    const onSnapshotChanged = vi.fn();
    const state = new DesktopLanguageState(store, provider, { onSnapshotChanged });
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.webContents.send.mockClear();
    onSnapshotChanged.mockClear();

    provider.preferredLanguages = ['ja-JP'];
    const snapshot = state.getSnapshot();

    expect(snapshot).toEqual({
      preference: 'system',
      resolved_locale: 'ja-JP',
      source: 'system',
      system_candidates: ['ja-JP'],
    });
    expect(win.webContents.send).toHaveBeenCalledWith(DESKTOP_LANGUAGE_UPDATED_CHANNEL, snapshot);
    expect(onSnapshotChanged).toHaveBeenCalledWith(snapshot);
  });

  it('refreshes system locale changes through an explicit host refresh hook', () => {
    const store = createStore('system');
    const provider = new FakeLocaleProvider();
    provider.preferredLanguages = ['fr-FR'];
    const state = new DesktopLanguageState(store, provider);
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.webContents.send.mockClear();

    provider.preferredLanguages = ['ko-KR'];
    const snapshot = state.refreshSystemLocale();

    expect(snapshot.resolved_locale).toBe('ko-KR');
    expect(win.webContents.send).toHaveBeenCalledWith(DESKTOP_LANGUAGE_UPDATED_CHANNEL, snapshot);
  });

  it('keeps destroyed windows out of later broadcasts', () => {
    const store = createStore('system');
    const provider = new FakeLocaleProvider();
    const state = new DesktopLanguageState(store, provider);
    const win = new FakeWindow();

    state.registerWindow(win as never);
    win.webContents.send.mockClear();
    win.destroyed = true;

    state.setPreference('fr-FR');

    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
