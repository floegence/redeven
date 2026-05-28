import { describe, expect, it } from 'vitest';
import {
  createDesktopI18n,
  DESKTOP_I18N_DICTIONARIES,
  localePreferenceDisplayName,
  REDEVEN_LOCALE_META,
  REDEVEN_LOCALE_PREFERENCES,
  REDEVEN_SUPPORTED_LOCALES,
  resolveRedevenLocale,
  SYSTEM_LOCALE_PREFERENCE,
  validateDesktopDictionary,
  validateDictionaryProtectedTerms,
  flattenDictionaryMessages,
  type DesktopTranslationShape,
} from './index';
import { isPluralMessage } from './messageTypes';
import { enUS } from './locales/en-US';

describe('Desktop shared i18n locale metadata', () => {
  it('defines ten real locales plus the system preference in stable order', () => {
    expect(REDEVEN_SUPPORTED_LOCALES).toEqual([
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
    ]);
    expect(REDEVEN_LOCALE_PREFERENCES).toEqual([
      SYSTEM_LOCALE_PREFERENCE,
      ...REDEVEN_SUPPORTED_LOCALES,
    ]);
  });

  it('keeps metadata complete and displayable for every locale', () => {
    for (const locale of REDEVEN_SUPPORTED_LOCALES) {
      const meta = REDEVEN_LOCALE_META[locale];
      expect(meta.locale).toBe(locale);
      expect(meta.html_lang).toBe(locale);
      expect(meta.direction).toBe('ltr');
      expect(meta.native_name.length).toBeGreaterThan(0);
      expect(meta.english_name.length).toBeGreaterThan(0);
    }

    expect(localePreferenceDisplayName('system')).toBe('System default');
    expect(localePreferenceDisplayName('zh-CN')).toBe('简体中文 / Simplified Chinese');
    expect(localePreferenceDisplayName('en-US')).toBe('English');
  });
});

describe('Desktop shared i18n resolver', () => {
  it.each([
    ['en', 'en-US'],
    ['en-US', 'en-US'],
    ['en-GB', 'en-US'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['ja', 'ja-JP'],
    ['ja-JP', 'ja-JP'],
    ['ko', 'ko-KR'],
    ['ko-KR', 'ko-KR'],
    ['de', 'de-DE'],
    ['de-AT', 'de-DE'],
    ['de-CH', 'de-DE'],
    ['fr', 'fr-FR'],
    ['fr-CA', 'fr-FR'],
    ['fr-BE', 'fr-FR'],
    ['es', 'es-ES'],
    ['es-MX', 'es-ES'],
    ['es-419', 'es-ES'],
    ['pt', 'pt-BR'],
    ['pt-BR', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    ['ru', 'ru-RU'],
    ['ru-RU', 'ru-RU'],
  ] as const)('maps system candidate %s to %s', (candidate, expected) => {
    expect(resolveRedevenLocale('system', [candidate])).toMatchObject({
      preference: 'system',
      resolved_locale: expected,
      source: 'system',
    });
  });

  it('uses explicit supported preferences before system candidates', () => {
    expect(resolveRedevenLocale('fr-FR', ['zh-CN'])).toMatchObject({
      preference: 'fr-FR',
      resolved_locale: 'fr-FR',
      source: 'explicit',
    });
  });

  it('normalizes invalid stored preferences to system and falls back to en-US', () => {
    expect(resolveRedevenLocale('bogus', ['und'])).toEqual({
      preference: 'system',
      resolved_locale: 'en-US',
      source: 'fallback',
      system_candidates: ['und'],
    });
    expect(resolveRedevenLocale('', [])).toMatchObject({
      preference: 'system',
      resolved_locale: 'en-US',
      source: 'fallback',
    });
  });
});

describe('Desktop shared i18n dictionaries', () => {
  it('keep every locale shape, placeholder, and protected term aligned with en-US', () => {
    for (const locale of REDEVEN_SUPPORTED_LOCALES) {
      expect(validateDesktopDictionary(locale, enUS, DESKTOP_I18N_DICTIONARIES[locale])).toEqual([]);
    }
  });

  it('keeps non-English dictionaries assignable to a widened message shape', () => {
    const zhCN: DesktopTranslationShape = DESKTOP_I18N_DICTIONARIES['zh-CN'];
    expect(zhCN.common.open).toBe('打开');
  });

  it('keeps ru-RU plural messages wired for Russian plural categories', () => {
    for (const row of flattenDictionaryMessages(DESKTOP_I18N_DICTIONARIES['ru-RU'])) {
      if (!isPluralMessage(row.value)) {
        continue;
      }
      expect(row.value.forms, row.path).toHaveProperty('one');
      expect(row.value.forms, row.path).toHaveProperty('few');
      expect(row.value.forms, row.path).toHaveProperty('many');
      expect(row.value.forms, row.path).toHaveProperty('other');
    }
  });

  it('reports protected terms that are removed from translated messages', () => {
    const unsafe = {
      ...enUS,
      desktop: {
        ...enUS.desktop,
        openLocalEnvironment: 'Open local workspace',
      },
    } satisfies DesktopTranslationShape;

    expect(validateDictionaryProtectedTerms('xx-TEST', enUS, unsafe)).toContainEqual({
      locale: 'xx-TEST',
      path: 'desktop.openLocalEnvironment',
      message: 'Protected term "Local Environment" must remain unchanged.',
    });
  });
});

describe('Desktop shared i18n helpers', () => {
  it('translates string messages and preserves missing placeholders for callers to notice', () => {
    const i18n = createDesktopI18n('zh-CN');
    expect(i18n.t('language.updatedMessage', { language: '简体中文' })).toBe('语言已更新为 简体中文。');
    expect(i18n.t('language.updatedMessage')).toBe('语言已更新为 {language}。');
    expect(i18n.t('commandPalette.changeLanguageTitle')).toBe('更改语言');
    expect(i18n.t('shell.commandSearchPlaceholder')).toBe('搜索 Desktop 命令...');
  });

  it('uses Intl.PluralRules with locale-specific forms', () => {
    const en = createDesktopI18n('en-US');
    expect(en.tn('plural.environmentCount', 1)).toBe('1 environment');
    expect(en.tn('plural.environmentCount', 2)).toBe('2 environments');

    const ru = createDesktopI18n('ru-RU');
    expect(ru.tn('plural.environmentCount', 1)).toBe('1 окружение');
    expect(ru.tn('plural.environmentCount', 2)).toBe('2 окружения');
    expect(ru.tn('plural.environmentCount', 5)).toBe('5 окружений');
  });

  it('formats dates, numbers, and relative times through Intl for the resolved locale', () => {
    const i18n = createDesktopI18n('de-DE');
    expect(i18n.formatNumber(1234.5)).toBe(new Intl.NumberFormat('de-DE').format(1234.5));
    expect(i18n.formatDateTime(new Date('2026-05-27T12:00:00Z'), { timeZone: 'UTC', dateStyle: 'medium' }))
      .toBe(new Intl.DateTimeFormat('de-DE', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date('2026-05-27T12:00:00Z')));
    expect(i18n.formatRelativeTime('2026-05-26T12:00:00Z', {
      now: '2026-05-27T12:00:00Z',
      unit: 'day',
      numeric: 'always',
    })).toBe(new Intl.RelativeTimeFormat('de-DE', { numeric: 'always', style: 'long' }).format(-1, 'day'));
  });
});
