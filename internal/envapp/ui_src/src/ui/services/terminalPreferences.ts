import { createSignal } from 'solid-js';
import type { PersistApi } from '@floegence/floe-webapp-core';

// Terminal preferences are global: settings from any TerminalPanel should affect all terminal instances.
// We keep a module-level singleton store and persist values through Floe's PersistApi.

export const TERMINAL_THEME_PERSIST_KEY = 'terminal:theme';
export const TERMINAL_FONT_SIZE_PERSIST_KEY = 'terminal:font_size';
export const TERMINAL_FONT_FAMILY_PERSIST_KEY = 'terminal:font_family';
export const TERMINAL_MOBILE_INPUT_MODE_PERSIST_KEY = 'terminal:mobile_input_mode';

export const TERMINAL_MIN_FONT_SIZE = 10;
export const TERMINAL_MAX_FONT_SIZE = 20;
export type TerminalMobileInputMode = 'floe' | 'system';

let initialized = false;
let persistRef: PersistApi | null = null;

const clampFontSize = (value: number) => {
  if (!Number.isFinite(value)) return 12;
  return Math.max(TERMINAL_MIN_FONT_SIZE, Math.min(TERMINAL_MAX_FONT_SIZE, Math.round(value)));
};

const normalizeTerminalMobileInputMode = (value: unknown): TerminalMobileInputMode => {
  return String(value ?? '').trim() === 'system' ? 'system' : 'floe';
};

const [terminalUserTheme, setTerminalUserTheme] = createSignal<string>('system');
const [terminalFontSize, setTerminalFontSize] = createSignal<number>(12);
const [terminalFontFamilyId, setTerminalFontFamilyId] = createSignal<string>('iosevka');
const [terminalMobileInputMode, setTerminalMobileInputMode] = createSignal<TerminalMobileInputMode>('floe');

export function ensureTerminalPreferencesInitialized(persist: PersistApi) {
  if (initialized) return;
  initialized = true;
  persistRef = persist;

  const loadedTheme = persist.load<string>(TERMINAL_THEME_PERSIST_KEY, 'system');
  setTerminalUserTheme((loadedTheme ?? '').trim() || 'system');

  const loadedSize = persist.load<number>(TERMINAL_FONT_SIZE_PERSIST_KEY, 12);
  setTerminalFontSize(clampFontSize(loadedSize));

  const loadedFamily = persist.load<string>(TERMINAL_FONT_FAMILY_PERSIST_KEY, 'iosevka');
  setTerminalFontFamilyId((loadedFamily ?? '').trim() || 'iosevka');

  const loadedMobileInputMode = persist.load<TerminalMobileInputMode>(TERMINAL_MOBILE_INPUT_MODE_PERSIST_KEY, 'floe');
  setTerminalMobileInputMode(normalizeTerminalMobileInputMode(loadedMobileInputMode));
}

export function useTerminalPreferences() {
  const setUserTheme = (value: string) => {
    const next = (value ?? '').trim() || 'system';
    setTerminalUserTheme(next);
    persistRef?.debouncedSave(TERMINAL_THEME_PERSIST_KEY, next);
  };

  const setFontSize = (value: number) => {
    const next = clampFontSize(value);
    setTerminalFontSize(next);
    persistRef?.debouncedSave(TERMINAL_FONT_SIZE_PERSIST_KEY, next);
  };

  const setFontFamily = (id: string) => {
    const next = (id ?? '').trim() || 'iosevka';
    setTerminalFontFamilyId(next);
    persistRef?.debouncedSave(TERMINAL_FONT_FAMILY_PERSIST_KEY, next);
  };

  const setMobileInputMode = (value: TerminalMobileInputMode | string) => {
    const next = normalizeTerminalMobileInputMode(value);
    setTerminalMobileInputMode(next);
    persistRef?.debouncedSave(TERMINAL_MOBILE_INPUT_MODE_PERSIST_KEY, next);
  };

  return {
    userTheme: terminalUserTheme,
    fontSize: terminalFontSize,
    fontFamilyId: terminalFontFamilyId,
    mobileInputMode: terminalMobileInputMode,
    setUserTheme,
    setFontSize,
    setFontFamily,
    setMobileInputMode,
  };
}
