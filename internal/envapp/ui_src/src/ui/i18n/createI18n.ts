import type { RedevenLocale } from './localeMeta';
import { enUS, type EnvAppTranslationKey, type EnvAppTranslationShape } from './locales';
import type { PluralMessage, RichTextPart, TranslationParams } from './dictionaryTypes';

export type I18nHelpers = Readonly<{
  t: (key: EnvAppTranslationKey, params?: TranslationParams) => string;
  tn: (key: EnvAppTranslationKey, count: number, params?: TranslationParams) => string;
  rich: (key: EnvAppTranslationKey, params?: TranslationParams) => readonly RichTextPart[];
  formatDateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  formatRelativeTime: (value: Date | number | string) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPluralMessage(value: unknown): value is PluralMessage {
  return isRecord(value) && typeof value.other === 'string';
}

function resolvePath(dictionary: EnvAppTranslationShape, key: EnvAppTranslationKey): unknown {
  return key.split('.').reduce<unknown>((current, segment) => (
    isRecord(current) ? current[segment] : undefined
  ), dictionary);
}

function interpolate(message: string, params: TranslationParams = {}): string {
  return message.replace(/\{([A-Za-z0-9_]+)\}/g, (token, name: string) => {
    const value = params[name];
    if (value === undefined) {
      return token;
    }
    return String(value);
  });
}

function coerceDate(value: Date | number | string): Date {
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
}

export function createI18nHelpers(
  locale: RedevenLocale,
  dictionary: EnvAppTranslationShape,
  fallbackDictionary: EnvAppTranslationShape = enUS,
): I18nHelpers {
  const pluralRules = new Intl.PluralRules(locale);

  const messageForKey = (key: EnvAppTranslationKey): unknown => {
    const value = resolvePath(dictionary, key);
    if (value !== undefined) {
      return value;
    }
    return resolvePath(fallbackDictionary, key);
  };

  const t = (key: EnvAppTranslationKey, params?: TranslationParams): string => {
    const value = messageForKey(key);
    if (typeof value === 'string') {
      return interpolate(value, params);
    }
    if (isPluralMessage(value)) {
      return interpolate(value.other, params);
    }
    return key;
  };

  const tn = (key: EnvAppTranslationKey, count: number, params: TranslationParams = {}): string => {
    const value = messageForKey(key);
    const mergedParams = { ...params, count };
    if (!isPluralMessage(value)) {
      return t(key, mergedParams);
    }

    const category = pluralRules.select(count);
    return interpolate(value[category] ?? value.other, mergedParams);
  };

  const rich = (key: EnvAppTranslationKey, params?: TranslationParams): readonly RichTextPart[] => {
    const value = messageForKey(key);
    if (Array.isArray(value)) {
      return value.map((part) => part.type === 'text'
        ? { ...part, value: interpolate(part.value, params) }
        : part);
    }
    return [{ type: 'text', value: t(key, params) }];
  };

  const formatDateTime = (value: Date | number | string, options?: Intl.DateTimeFormatOptions): string => (
    new Intl.DateTimeFormat(locale, options).format(coerceDate(value))
  );

  const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string => (
    new Intl.NumberFormat(locale, options).format(value)
  );

  const formatRelativeTime = (value: Date | number | string): string => {
    const target = coerceDate(value).getTime();
    const diffSeconds = Math.round((target - Date.now()) / 1000);
    const absSeconds = Math.abs(diffSeconds);
    const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (absSeconds < 60) {
      return formatter.format(diffSeconds, 'second');
    }
    const diffMinutes = Math.round(diffSeconds / 60);
    if (Math.abs(diffMinutes) < 60) {
      return formatter.format(diffMinutes, 'minute');
    }
    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) {
      return formatter.format(diffHours, 'hour');
    }
    return formatter.format(Math.round(diffHours / 24), 'day');
  };

  return { t, tn, rich, formatDateTime, formatRelativeTime, formatNumber };
}
