import { describe, expect, it } from 'vitest';
import { browserText, englishMessages } from '@floegence/floebrowser/viewer';
import { browserMessages } from './browserMessages';
import { SUPPORTED_LOCALES } from './localeMeta';
import { createTestI18nHelpers } from './locales/testDictionaries';

describe('browser component translations', () => {
  it('supplies the complete released catalog and preserves interpolation in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = browserMessages(createTestI18nHelpers(locale));
      expect(Object.keys(messages)).toEqual(Object.keys(englishMessages));
      expect(() => browserText(messages)).not.toThrow();
      expect(browserText(messages)('tabs.closeNamed', { title: 'source-title' })).toContain('source-title');
    }
  });

  it('documents each identical spelling without allowing generic English fallback', () => {
    // These are native same-spelling media nouns, not untranslated UI concepts.
    const nativeSpellings = new Set(['de-DE:media.audio', 'de-DE:media.video', 'fr-FR:media.audio', 'es-ES:media.audio']);
    const observed = new Set<string>();
    for (const locale of SUPPORTED_LOCALES.filter(locale => locale !== 'en-US')) {
      for (const [key, value] of Object.entries(browserMessages(createTestI18nHelpers(locale)))) {
        if (value !== englishMessages[key as keyof typeof englishMessages]) continue;
        // This message is only a numeric placeholder and its percent symbol.
        if (key === 'zoom.percent') continue;
        const identity = `${locale}:${key}`;
        expect(nativeSpellings.has(identity), identity).toBe(true);
        observed.add(identity);
      }
    }
    expect(observed).toEqual(nativeSpellings);
  });
});
