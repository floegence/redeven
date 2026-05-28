import {
  DEFAULT_LOCALE,
  isRedevenLocale,
  normalizeLocalePreference,
  type RedevenLocale,
  type RedevenLocalePreference,
} from './localeMeta';

export type LocaleResolutionSource = 'explicit' | 'system' | 'fallback';

export type RedevenLanguageSnapshot = Readonly<{
  preference: RedevenLocalePreference;
  resolved_locale: RedevenLocale;
  source: LocaleResolutionSource;
  system_candidates: readonly string[];
}>;

export type ResolveLocaleInput = Readonly<{
  preference?: unknown;
  systemCandidates?: readonly string[];
}>;

const LOCALE_ALIASES: Readonly<Record<string, RedevenLocale>> = {
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-US',
  'zh': 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  'zh-sg': 'zh-CN',
  'zh-tw': 'zh-TW',
  'zh-hant': 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-mo': 'zh-TW',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
  ko: 'ko-KR',
  'ko-kr': 'ko-KR',
  de: 'de-DE',
  'de-de': 'de-DE',
  'de-at': 'de-DE',
  'de-ch': 'de-DE',
  fr: 'fr-FR',
  'fr-fr': 'fr-FR',
  'fr-ca': 'fr-FR',
  'fr-be': 'fr-FR',
  es: 'es-ES',
  'es-es': 'es-ES',
  'es-mx': 'es-ES',
  'es-419': 'es-ES',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  'pt-pt': 'pt-BR',
  ru: 'ru-RU',
  'ru-ru': 'ru-RU',
};

function normalizeCandidate(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase();
}

export function matchSupportedLocale(candidate: unknown): RedevenLocale | null {
  const normalized = normalizeCandidate(candidate);
  if (!normalized) {
    return null;
  }
  const exact = LOCALE_ALIASES[normalized];
  if (exact) {
    return exact;
  }

  const parts = normalized.split('-').filter(Boolean);
  const language = parts[0] ?? '';
  if (language === 'zh') {
    if (parts.includes('hant') || parts.includes('tw') || parts.includes('hk') || parts.includes('mo')) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }
  return LOCALE_ALIASES[language] ?? null;
}

export function readBrowserLanguageCandidates(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }

  const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
  const primary = typeof navigator.language === 'string' ? navigator.language : '';
  return [...languages, primary].filter((candidate): candidate is string => candidate.trim() !== '');
}

export function resolveLocalePreference(input: ResolveLocaleInput = {}): RedevenLanguageSnapshot {
  const preference = normalizeLocalePreference(input.preference);
  const systemCandidates = [...(input.systemCandidates ?? [])];

  if (isRedevenLocale(preference)) {
    return {
      preference,
      resolved_locale: preference,
      source: 'explicit',
      system_candidates: systemCandidates,
    };
  }

  const resolved = systemCandidates
    .map((candidate) => matchSupportedLocale(candidate))
    .find((candidate): candidate is RedevenLocale => candidate !== null);

  return {
    preference,
    resolved_locale: resolved ?? DEFAULT_LOCALE,
    source: resolved ? 'system' : 'fallback',
    system_candidates: systemCandidates,
  };
}
