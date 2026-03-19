import { describe, expect, it, vi } from 'vitest';

describe('terminalPreferences defaults', () => {
  it('initializes new users with dark theme and Monaco font', async () => {
    vi.resetModules();
    const {
      DEFAULT_TERMINAL_FONT_FAMILY_ID,
      DEFAULT_TERMINAL_THEME,
      TERMINAL_FONT_FAMILY_PERSIST_KEY,
      TERMINAL_THEME_PERSIST_KEY,
      ensureTerminalPreferencesInitialized,
      useTerminalPreferences,
    } = await import('./terminalPreferences');

    const loadSpy = vi.fn();
    const debouncedSave = vi.fn();
    const persist = {
      key(key: string): string {
        return key;
      },
      load<T>(_key: string, fallback: T): T {
        loadSpy(_key, fallback);
        return fallback;
      },
      save: vi.fn(),
      debouncedSave,
      remove: vi.fn(),
      clearAll: vi.fn(),
    };

    ensureTerminalPreferencesInitialized(persist);

    const prefs = useTerminalPreferences();
    expect(loadSpy).toHaveBeenCalledWith(TERMINAL_THEME_PERSIST_KEY, DEFAULT_TERMINAL_THEME);
    expect(loadSpy).toHaveBeenCalledWith(TERMINAL_FONT_FAMILY_PERSIST_KEY, DEFAULT_TERMINAL_FONT_FAMILY_ID);
    expect(prefs.userTheme()).toBe(DEFAULT_TERMINAL_THEME);
    expect(prefs.fontFamilyId()).toBe(DEFAULT_TERMINAL_FONT_FAMILY_ID);
  });
});
