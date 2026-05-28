export const REDEVEN_DEFAULT_LOCALE = 'en-US';

export const REDEVEN_SUPPORTED_LOCALES = [
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

export type RedevenLocale = typeof REDEVEN_SUPPORTED_LOCALES[number];
export const SYSTEM_LOCALE_PREFERENCE = 'system';
export type RedevenLocalePreference = RedevenLocale | typeof SYSTEM_LOCALE_PREFERENCE;
export type RedevenTextDirection = 'ltr';

export type RedevenLocaleMeta = Readonly<{
  locale: RedevenLocale;
  native_name: string;
  english_name: string;
  html_lang: string;
  direction: RedevenTextDirection;
}>;

export const REDEVEN_LOCALE_META: Readonly<Record<RedevenLocale, RedevenLocaleMeta>> = {
  'en-US': {
    locale: 'en-US',
    native_name: 'English',
    english_name: 'English',
    html_lang: 'en-US',
    direction: 'ltr',
  },
  'zh-CN': {
    locale: 'zh-CN',
    native_name: '简体中文',
    english_name: 'Simplified Chinese',
    html_lang: 'zh-CN',
    direction: 'ltr',
  },
  'zh-TW': {
    locale: 'zh-TW',
    native_name: '繁體中文',
    english_name: 'Traditional Chinese',
    html_lang: 'zh-TW',
    direction: 'ltr',
  },
  'ja-JP': {
    locale: 'ja-JP',
    native_name: '日本語',
    english_name: 'Japanese',
    html_lang: 'ja-JP',
    direction: 'ltr',
  },
  'ko-KR': {
    locale: 'ko-KR',
    native_name: '한국어',
    english_name: 'Korean',
    html_lang: 'ko-KR',
    direction: 'ltr',
  },
  'de-DE': {
    locale: 'de-DE',
    native_name: 'Deutsch',
    english_name: 'German',
    html_lang: 'de-DE',
    direction: 'ltr',
  },
  'fr-FR': {
    locale: 'fr-FR',
    native_name: 'Français',
    english_name: 'French',
    html_lang: 'fr-FR',
    direction: 'ltr',
  },
  'es-ES': {
    locale: 'es-ES',
    native_name: 'Español',
    english_name: 'Spanish',
    html_lang: 'es-ES',
    direction: 'ltr',
  },
  'pt-BR': {
    locale: 'pt-BR',
    native_name: 'Português do Brasil',
    english_name: 'Brazilian Portuguese',
    html_lang: 'pt-BR',
    direction: 'ltr',
  },
  'ru-RU': {
    locale: 'ru-RU',
    native_name: 'Русский',
    english_name: 'Russian',
    html_lang: 'ru-RU',
    direction: 'ltr',
  },
} as const;

export const REDEVEN_LOCALE_PREFERENCES = [
  SYSTEM_LOCALE_PREFERENCE,
  ...REDEVEN_SUPPORTED_LOCALES,
] as const satisfies readonly RedevenLocalePreference[];

export function isRedevenLocale(value: unknown): value is RedevenLocale {
  return REDEVEN_SUPPORTED_LOCALES.includes(value as RedevenLocale);
}

export function localePreferenceDisplayName(preference: RedevenLocalePreference): string {
  if (preference === SYSTEM_LOCALE_PREFERENCE) {
    return 'System default';
  }

  const meta = REDEVEN_LOCALE_META[preference];
  return meta.native_name === meta.english_name
    ? meta.native_name
    : `${meta.native_name} / ${meta.english_name}`;
}
