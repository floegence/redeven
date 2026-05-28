import { readUIStorageItem, writeUIStorageItem } from '../services/uiStorage';
import { normalizeLocalePreference, type RedevenLocalePreference } from './localeMeta';
import { readBrowserLanguageCandidates } from './resolveLocale';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from './storageKey';

export function readStoredLanguagePreference(): RedevenLocalePreference {
  return normalizeLocalePreference(readUIStorageItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY));
}

export function writeStoredLanguagePreference(preference: RedevenLocalePreference): void {
  writeUIStorageItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, normalizeLocalePreference(preference));
}

export function readStandaloneSystemLanguageCandidates(): readonly string[] {
  return readBrowserLanguageCandidates();
}
