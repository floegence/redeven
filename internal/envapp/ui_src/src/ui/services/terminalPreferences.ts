import { createSignal } from 'solid-js';
import type { PersistApi } from '@floegence/floe-webapp-core';
import {
  DEFAULT_TERMINAL_FONT_FAMILY_ID,
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_MAX_FONT_SIZE,
  TERMINAL_MIN_FONT_SIZE,
  normalizeTerminalFontFamilyId,
  normalizeTerminalFontSize,
} from './terminalGeometry';

// Terminal preferences are global: settings from any TerminalPanel should affect all terminal instances.
// We keep a module-level singleton store and persist values through Floe's PersistApi.

export const TERMINAL_THEME_PERSIST_KEY = 'terminal:theme';
export const TERMINAL_FONT_SIZE_PERSIST_KEY = 'terminal:font_size';
export const TERMINAL_FONT_FAMILY_PERSIST_KEY = 'terminal:font_family';
export const TERMINAL_MOBILE_INPUT_MODE_PERSIST_KEY = 'terminal:mobile_input_mode';
export const TERMINAL_WORK_INDICATOR_ENABLED_PERSIST_KEY = 'terminal:work_indicator_enabled';

export type TerminalMobileInputMode = 'floe' | 'system';
export const DEFAULT_TERMINAL_THEME = 'dark';
export {
  DEFAULT_TERMINAL_FONT_FAMILY_ID,
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_MAX_FONT_SIZE,
  TERMINAL_MIN_FONT_SIZE,
};
export const DEFAULT_TERMINAL_MOBILE_INPUT_MODE: TerminalMobileInputMode = 'floe';
export const DEFAULT_TERMINAL_WORK_INDICATOR_ENABLED = true;

let initialized = false;
let persistRef: PersistApi | null = null;

const normalizeTerminalMobileInputMode = (value: unknown): TerminalMobileInputMode => {
  return String(value ?? '').trim() === 'system' ? 'system' : 'floe';
};

const normalizeTerminalWorkIndicatorEnabled = (value: unknown): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_TERMINAL_WORK_INDICATOR_ENABLED;
  }
  return !['false', '0', 'off', 'no'].includes(normalized);
};

const [terminalUserTheme, setTerminalUserTheme] = createSignal<string>(DEFAULT_TERMINAL_THEME);
const [terminalFontSize, setTerminalFontSize] = createSignal<number>(DEFAULT_TERMINAL_FONT_SIZE);
const [terminalFontFamilyId, setTerminalFontFamilyId] = createSignal<string>(DEFAULT_TERMINAL_FONT_FAMILY_ID);
const [terminalMobileInputMode, setTerminalMobileInputMode] = createSignal<TerminalMobileInputMode>(DEFAULT_TERMINAL_MOBILE_INPUT_MODE);
const [terminalWorkIndicatorEnabled, setTerminalWorkIndicatorEnabled] = createSignal<boolean>(DEFAULT_TERMINAL_WORK_INDICATOR_ENABLED);

export function ensureTerminalPreferencesInitialized(persist: PersistApi) {
  if (initialized) return;
  initialized = true;
  persistRef = persist;

  const loadedTheme = persist.load<string>(TERMINAL_THEME_PERSIST_KEY, DEFAULT_TERMINAL_THEME);
  setTerminalUserTheme((loadedTheme ?? '').trim() || DEFAULT_TERMINAL_THEME);

  const loadedSize = persist.load<number>(TERMINAL_FONT_SIZE_PERSIST_KEY, DEFAULT_TERMINAL_FONT_SIZE);
  setTerminalFontSize(normalizeTerminalFontSize(loadedSize));

  const loadedFamily = persist.load<string>(TERMINAL_FONT_FAMILY_PERSIST_KEY, DEFAULT_TERMINAL_FONT_FAMILY_ID);
  setTerminalFontFamilyId(normalizeTerminalFontFamilyId(loadedFamily));

  const loadedMobileInputMode = persist.load<TerminalMobileInputMode>(TERMINAL_MOBILE_INPUT_MODE_PERSIST_KEY, DEFAULT_TERMINAL_MOBILE_INPUT_MODE);
  setTerminalMobileInputMode(normalizeTerminalMobileInputMode(loadedMobileInputMode));

  const loadedWorkIndicatorEnabled = persist.load<boolean>(
    TERMINAL_WORK_INDICATOR_ENABLED_PERSIST_KEY,
    DEFAULT_TERMINAL_WORK_INDICATOR_ENABLED,
  );
  setTerminalWorkIndicatorEnabled(normalizeTerminalWorkIndicatorEnabled(loadedWorkIndicatorEnabled));
}

export function useTerminalPreferences() {
  const setUserTheme = (value: string) => {
    const next = (value ?? '').trim() || DEFAULT_TERMINAL_THEME;
    setTerminalUserTheme(next);
    persistRef?.debouncedSave(TERMINAL_THEME_PERSIST_KEY, next);
  };

  const setFontSize = (value: number) => {
    const next = normalizeTerminalFontSize(value);
    setTerminalFontSize(next);
    persistRef?.debouncedSave(TERMINAL_FONT_SIZE_PERSIST_KEY, next);
  };

  const setFontFamily = (id: string) => {
    const next = normalizeTerminalFontFamilyId(id);
    setTerminalFontFamilyId(next);
    persistRef?.debouncedSave(TERMINAL_FONT_FAMILY_PERSIST_KEY, next);
  };

  const setMobileInputMode = (value: TerminalMobileInputMode | string) => {
    const next = normalizeTerminalMobileInputMode(value);
    setTerminalMobileInputMode(next);
    persistRef?.debouncedSave(TERMINAL_MOBILE_INPUT_MODE_PERSIST_KEY, next);
  };

  const setWorkIndicatorEnabled = (value: boolean) => {
    const next = normalizeTerminalWorkIndicatorEnabled(value);
    setTerminalWorkIndicatorEnabled(next);
    persistRef?.debouncedSave(TERMINAL_WORK_INDICATOR_ENABLED_PERSIST_KEY, next);
  };

  return {
    userTheme: terminalUserTheme,
    fontSize: terminalFontSize,
    fontFamilyId: terminalFontFamilyId,
    mobileInputMode: terminalMobileInputMode,
    workIndicatorEnabled: terminalWorkIndicatorEnabled,
    setUserTheme,
    setFontSize,
    setFontFamily,
    setMobileInputMode,
    setWorkIndicatorEnabled,
  };
}
