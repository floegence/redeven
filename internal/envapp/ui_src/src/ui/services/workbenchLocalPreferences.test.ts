// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkbenchLocalPreferences, subscribeWorkbenchLocalPreferences, writeWorkbenchLocalPreferences, writeWorkbenchTheme } from './workbenchLocalPreferences';
import { resolveEnvAppStorageBinding } from './uiPersistence';

const key = resolveEnvAppStorageBinding({ envID: 'env-first', desktopStateStorageAvailable: false }).workbenchLocalPreferencesKey;
const secondKey = resolveEnvAppStorageBinding({ envID: 'env-second', desktopStateStorageAvailable: false }).workbenchLocalPreferencesKey;
const preference = { version: 5 as const, locked: true, theme: 'mica' as const, mode: 'annotation' as const, activeTool: 'draw' as const };
const cleanup: Array<() => void> = [];
beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); localStorage.clear(); });

describe('Workbench canonical local preferences', () => {
  it('changes the theme before a canvas mounts while preserving all existing local state', () => {
    localStorage.setItem(key, JSON.stringify(preference));
    const before = readWorkbenchLocalPreferences(key);
    writeWorkbenchTheme(key, 'aurora');
    expect(readWorkbenchLocalPreferences(key)).toEqual({ ...before, theme: 'aurora' });
    expect(Object.keys(localStorage)).toEqual([key]);
  });
  it('preserves newer HUD lock, mode and tool changes when Settings subsequently edits theme', () => {
    writeWorkbenchLocalPreferences(key, preference);
    const next = { ...readWorkbenchLocalPreferences(key), locked: false, mode: 'background' as const, activeTool: 'select' as const };
    writeWorkbenchLocalPreferences(key, next); writeWorkbenchTheme(key, 'terminal');
    expect(readWorkbenchLocalPreferences(key)).toEqual({ ...next, theme: 'terminal' });
  });
  it('does not mutate on subscribe or unsupported theme input', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    cleanup.push(subscribeWorkbenchLocalPreferences(key, vi.fn()));
    writeWorkbenchTheme(key, 'arbitrary');
    expect(setItem).not.toHaveBeenCalled(); setItem.mockRestore();
  });
  it('isolates env keys and ignores repeated state and unrelated storage events', () => {
    const first = vi.fn(), second = vi.fn();
    cleanup.push(subscribeWorkbenchLocalPreferences(key, first), subscribeWorkbenchLocalPreferences(secondKey, second));
    writeWorkbenchLocalPreferences(key, preference); expect(first).toHaveBeenCalledOnce(); expect(second).not.toHaveBeenCalled();
    writeWorkbenchLocalPreferences(key, preference); expect(first).toHaveBeenCalledOnce();
    localStorage.setItem(secondKey, JSON.stringify({ ...preference, theme: 'midnight' }));
    window.dispatchEvent(new StorageEvent('storage', { key: secondKey }));
    expect(second).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ theme: 'midnight' })); expect(first).toHaveBeenCalledOnce();
  });
  it('refreshes desktop storage on focus and disposes all observation', () => {
    const values = new Map<string, string>();
    window.redevenDesktopStateStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, keys: () => [...values.keys()] };
    try {
      const desktopKey = resolveEnvAppStorageBinding({ envID: 'env-any', desktopStateStorageAvailable: true }).workbenchLocalPreferencesKey;
      const observer = vi.fn(); const stop = subscribeWorkbenchLocalPreferences(desktopKey, observer);
      values.set(desktopKey, JSON.stringify(preference)); window.dispatchEvent(new Event('focus'));
      expect(observer).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'mica' }));
      stop(); observer.mockClear(); writeWorkbenchTheme(desktopKey, 'aurora'); window.dispatchEvent(new Event('focus')); expect(observer).not.toHaveBeenCalled();
      expect(Object.keys(localStorage)).toHaveLength(0);
    } finally { delete window.redevenDesktopStateStorage; }
  });
});
