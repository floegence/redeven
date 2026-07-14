import {
  REDEVEN_SUPPORTED_LOCALES,
  type RedevenLocale,
} from './localeMeta';
import { isPluralMessage, type PluralMessage, type TranslationParams, type TranslationTree } from './messageTypes';
import { enUS, type DesktopPluralTranslationKey, type DesktopTranslationKey, type DesktopTranslationShape } from './locales/en-US';
import deDECatalog from './locales/catalogs/de-DE.json';
import esESCatalog from './locales/catalogs/es-ES.json';
import frFRCatalog from './locales/catalogs/fr-FR.json';
import jaJPCatalog from './locales/catalogs/ja-JP.json';
import koKRCatalog from './locales/catalogs/ko-KR.json';
import ptBRCatalog from './locales/catalogs/pt-BR.json';
import ruRUCatalog from './locales/catalogs/ru-RU.json';
import zhCNCatalog from './locales/catalogs/zh-CN.json';
import zhTWCatalog from './locales/catalogs/zh-TW.json';

export type {
  DesktopPluralTranslationKey,
  DesktopTranslationKey,
  DesktopTranslationShape,
  TranslationParams,
};

export type DesktopDictionaryMap = Readonly<Record<RedevenLocale, DesktopTranslationShape>>;

function desktopCatalog(value: unknown): DesktopTranslationShape {
  return value as DesktopTranslationShape;
}

const zhCN = desktopCatalog(zhCNCatalog);
const zhTW = desktopCatalog(zhTWCatalog);
const jaJP = desktopCatalog(jaJPCatalog);
const koKR = desktopCatalog(koKRCatalog);
const deDE = desktopCatalog(deDECatalog);
const frFR = desktopCatalog(frFRCatalog);
const esES = desktopCatalog(esESCatalog);
const ptBR = desktopCatalog(ptBRCatalog);
const ruRU = desktopCatalog(ruRUCatalog);

export type DesktopI18n = Readonly<{
  locale: RedevenLocale;
  t: (key: DesktopTranslationKey, params?: TranslationParams) => string;
  tn: (key: DesktopPluralTranslationKey, count: number, params?: TranslationParams) => string;
  formatDateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatRelativeTime: (value: Date | number | string, options?: DesktopRelativeTimeFormatOptions) => string;
}>;

export type DesktopRelativeTimeFormatOptions = Readonly<{
  now?: Date | number | string;
  unit?: Intl.RelativeTimeFormatUnit;
  numeric?: Intl.RelativeTimeFormatNumeric;
  style?: Intl.RelativeTimeFormatStyle;
}>;

export const DESKTOP_I18N_DICTIONARIES: DesktopDictionaryMap = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'de-DE': deDE,
  'fr-FR': frFR,
  'es-ES': esES,
  'pt-BR': ptBR,
  'ru-RU': ruRU,
};

const PLACEHOLDER_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/gu;
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

function readPath(root: TranslationTree, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function interpolate(message: string, params: TranslationParams = {}): string {
  return message.replace(PLACEHOLDER_PATTERN, (placeholder: string, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

function dateFromValue(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function millisecondsFromNow(value: Date | number | string, now: Date | number | string | undefined): number {
  return dateFromValue(value).getTime() - dateFromValue(now ?? Date.now()).getTime();
}

function chooseRelativeTime(diffMs: number, preferredUnit: Intl.RelativeTimeFormatUnit | undefined): {
  value: number;
  unit: Intl.RelativeTimeFormatUnit;
} {
  if (preferredUnit) {
    const divisor = unitToMilliseconds(preferredUnit);
    return {
      value: Math.round(diffMs / divisor),
      unit: preferredUnit,
    };
  }

  const abs = Math.abs(diffMs);
  if (abs >= YEAR_MS) {
    return { value: Math.round(diffMs / YEAR_MS), unit: 'year' };
  }
  if (abs >= MONTH_MS) {
    return { value: Math.round(diffMs / MONTH_MS), unit: 'month' };
  }
  if (abs >= DAY_MS) {
    return { value: Math.round(diffMs / DAY_MS), unit: 'day' };
  }
  if (abs >= HOUR_MS) {
    return { value: Math.round(diffMs / HOUR_MS), unit: 'hour' };
  }
  if (abs >= MINUTE_MS) {
    return { value: Math.round(diffMs / MINUTE_MS), unit: 'minute' };
  }
  return { value: Math.round(diffMs / SECOND_MS), unit: 'second' };
}

function unitToMilliseconds(unit: Intl.RelativeTimeFormatUnit): number {
  switch (unit) {
    case 'year':
    case 'years':
      return YEAR_MS;
    case 'quarter':
    case 'quarters':
      return 3 * MONTH_MS;
    case 'month':
    case 'months':
      return MONTH_MS;
    case 'week':
    case 'weeks':
      return 7 * DAY_MS;
    case 'day':
    case 'days':
      return DAY_MS;
    case 'hour':
    case 'hours':
      return HOUR_MS;
    case 'minute':
    case 'minutes':
      return MINUTE_MS;
    case 'second':
    case 'seconds':
      return SECOND_MS;
  }
}

function getStringMessage(locale: RedevenLocale, key: DesktopTranslationKey): string {
  const dictionary = DESKTOP_I18N_DICTIONARIES[locale];
  const message = readPath(dictionary, key);
  if (typeof message === 'string') {
    return message;
  }
  const fallback = readPath(enUS, key);
  return typeof fallback === 'string' ? fallback : key;
}

function getPluralMessage(locale: RedevenLocale, key: DesktopPluralTranslationKey): PluralMessage {
  const dictionary = DESKTOP_I18N_DICTIONARIES[locale];
  const message = readPath(dictionary, key);
  if (isPluralMessage(message)) {
    return message;
  }
  const fallback = readPath(enUS, key);
  return isPluralMessage(fallback)
    ? fallback
    : {
      kind: 'plural',
      forms: {
        other: `{count} ${key}`,
      },
    };
}

export function getDesktopDictionary(locale: RedevenLocale): DesktopTranslationShape {
  return DESKTOP_I18N_DICTIONARIES[locale];
}

export function createDesktopI18n(locale: RedevenLocale): DesktopI18n {
  return {
    locale,
    t(key, params) {
      return interpolate(getStringMessage(locale, key), params);
    },
    tn(key, count, params) {
      const message = getPluralMessage(locale, key);
      const pluralRule = new Intl.PluralRules(locale).select(count);
      const template = message.forms[pluralRule] ?? message.forms.other;
      return interpolate(template, {
        ...params,
        count,
      });
    },
    formatDateTime(value, options) {
      return new Intl.DateTimeFormat(locale, options).format(dateFromValue(value));
    },
    formatNumber(value, options) {
      return new Intl.NumberFormat(locale, options).format(value);
    },
    formatRelativeTime(value, options = {}) {
      const diffMs = millisecondsFromNow(value, options.now);
      const relative = chooseRelativeTime(diffMs, options.unit);
      return new Intl.RelativeTimeFormat(locale, {
        numeric: options.numeric ?? 'auto',
        style: options.style ?? 'long',
      }).format(relative.value, relative.unit);
    },
  };
}

export function listDesktopI18nLocales(): readonly RedevenLocale[] {
  return REDEVEN_SUPPORTED_LOCALES;
}
