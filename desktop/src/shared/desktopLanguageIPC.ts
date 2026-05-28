import {
  normalizeRedevenLocale,
  normalizeRedevenLocalePreference,
  normalizeRedevenSystemCandidates,
  type RedevenLanguageSnapshot,
  type RedevenLanguageSnapshotSource,
} from './i18n/desktopLanguage';

export const DESKTOP_LANGUAGE_GET_SNAPSHOT_CHANNEL = 'redeven-desktop:language-get-snapshot';
export const DESKTOP_LANGUAGE_SET_PREFERENCE_CHANNEL = 'redeven-desktop:language-set-preference';
export const DESKTOP_LANGUAGE_UPDATED_CHANNEL = 'redeven-desktop:language-updated';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeSnapshotSource(value: unknown): RedevenLanguageSnapshotSource | '' {
  const source = compact(value);
  if (source === 'explicit' || source === 'system' || source === 'fallback') {
    return source;
  }
  return '';
}

export function normalizeDesktopLanguageSnapshot(value: unknown): RedevenLanguageSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<RedevenLanguageSnapshot>;
  const preference = normalizeRedevenLocalePreference(candidate.preference, 'system');
  const resolvedLocale = normalizeRedevenLocale(candidate.resolved_locale);
  const source = normalizeSnapshotSource(candidate.source);
  if (!resolvedLocale || !source) {
    return null;
  }

  if (source === 'explicit' && preference !== resolvedLocale) {
    return null;
  }

  if (source !== 'explicit' && preference !== 'system') {
    return null;
  }

  return {
    preference,
    resolved_locale: resolvedLocale,
    source,
    system_candidates: normalizeRedevenSystemCandidates(candidate.system_candidates),
  };
}
