export const SUPPORTED_LOCALES = [
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'de-DE',
  'fr-FR',
  'es-ES',
  'pt-BR',
  'ru-RU',
] as const;

export type RedevenLocale = typeof SUPPORTED_LOCALES[number];
export type RedevenLocalePreference = 'system' | RedevenLocale;
export type TextDirection = 'ltr';
export type SystemLocalePreference = 'system';

export type LocaleMeta = Readonly<{
  id: RedevenLocale;
  nativeName: string;
  englishName: string;
  htmlLang: string;
  textDirection: TextDirection;
}>;

export const DEFAULT_LOCALE: RedevenLocale = 'en-US';
export const SYSTEM_LOCALE_PREFERENCE: SystemLocalePreference = 'system';

export const LOCALE_META: Readonly<Record<RedevenLocale, LocaleMeta>> = {
  'en-US': {
    id: 'en-US',
    nativeName: 'English',
    englishName: 'English',
    htmlLang: 'en-US',
    textDirection: 'ltr',
  },
  'zh-CN': {
    id: 'zh-CN',
    nativeName: '简体中文',
    englishName: 'Simplified Chinese',
    htmlLang: 'zh-CN',
    textDirection: 'ltr',
  },
  'zh-TW': {
    id: 'zh-TW',
    nativeName: '繁體中文',
    englishName: 'Traditional Chinese',
    htmlLang: 'zh-TW',
    textDirection: 'ltr',
  },
  'ja-JP': {
    id: 'ja-JP',
    nativeName: '日本語',
    englishName: 'Japanese',
    htmlLang: 'ja-JP',
    textDirection: 'ltr',
  },
  'ko-KR': {
    id: 'ko-KR',
    nativeName: '한국어',
    englishName: 'Korean',
    htmlLang: 'ko-KR',
    textDirection: 'ltr',
  },
  'de-DE': {
    id: 'de-DE',
    nativeName: 'Deutsch',
    englishName: 'German',
    htmlLang: 'de-DE',
    textDirection: 'ltr',
  },
  'fr-FR': {
    id: 'fr-FR',
    nativeName: 'Français',
    englishName: 'French',
    htmlLang: 'fr-FR',
    textDirection: 'ltr',
  },
  'es-ES': {
    id: 'es-ES',
    nativeName: 'Español',
    englishName: 'Spanish',
    htmlLang: 'es-ES',
    textDirection: 'ltr',
  },
  'pt-BR': {
    id: 'pt-BR',
    nativeName: 'Português do Brasil',
    englishName: 'Brazilian Portuguese',
    htmlLang: 'pt-BR',
    textDirection: 'ltr',
  },
  'ru-RU': {
    id: 'ru-RU',
    nativeName: 'Русский',
    englishName: 'Russian',
    htmlLang: 'ru-RU',
    textDirection: 'ltr',
  },
};

export const LOCALE_OPTIONS = SUPPORTED_LOCALES.map((id) => LOCALE_META[id]);
const SUPPORTED_LOCALE_BY_LOWERCASE = new Map<string, RedevenLocale>(
  SUPPORTED_LOCALES.map((locale) => [locale.toLowerCase(), locale]),
);

export function isRedevenLocale(value: unknown): value is RedevenLocale {
  return SUPPORTED_LOCALES.includes(value as RedevenLocale);
}

export function normalizeLocalePreference(value: unknown): RedevenLocalePreference {
  const candidate = String(value ?? '').trim();
  if (candidate === SYSTEM_LOCALE_PREFERENCE) {
    return SYSTEM_LOCALE_PREFERENCE;
  }
  return SUPPORTED_LOCALE_BY_LOWERCASE.get(candidate.toLowerCase()) ?? SYSTEM_LOCALE_PREFERENCE;
}

export function localeDisplayName(locale: RedevenLocale): string {
  const meta = LOCALE_META[locale];
  return meta.nativeName === meta.englishName
    ? meta.nativeName
    : `${meta.nativeName} / ${meta.englishName}`;
}
