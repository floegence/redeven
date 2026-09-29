import { describe, expect, it } from 'vitest';
import { extensionI18n } from '../../../../../flower_ui/src/extensions/context';
import { extensionMessages } from '../../../../../flower_ui/src/extensions/messages';
import { skillsMessages } from '../../../../../flower_ui/src/extensions/skillsMessages';

const locales = ['en-US', 'zh-CN', 'zh-TW', 'de-DE', 'es-ES', 'fr-FR', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU'];
type Message = string | Readonly<Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }>;
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort();
describe('Flower extensions localized copy', () => {
  for (const [name, catalog] of [['center', extensionMessages], ['skills', skillsMessages]] as const) {
    it(`${name} defines explicit complete messages and aligned placeholders for every locale`, () => {
      expect(Object.keys(catalog)).toEqual(locales);
      const source = catalog['en-US'] as Record<string, Message>;
      for (const [locale, messages] of Object.entries(catalog)) {
        expect(Object.keys(messages).sort(), locale).toEqual(Object.keys(source).sort());
        for (const [key, value] of Object.entries(messages as Record<string, Message>)) {
          const reference = source[key];
          const expected = placeholders(typeof reference === 'string' ? reference : reference.other);
          for (const text of typeof value === 'string' ? [value] : Object.values(value)) {
            expect(text.trim(), `${locale}.${key}`).not.toBe('');
            expect(placeholders(text), `${locale}.${key}`).toEqual(expected);
          }
          if (typeof value !== 'string') {
            for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories) {
              expect(Object.hasOwn(value, category), `${locale}.${key}.${category}`).toBe(true);
            }
          }
        }
      }
    });
  }
  it('formats tool counts and dates using the selected language', () => {
    expect(extensionI18n().tn('tools', 1)).toBe('1 tool');
    expect(extensionI18n().tn('tools', 2)).toBe('2 tools');
    expect(extensionI18n('ru-RU').tn('tools', 2)).toBe('2 инструмента');
    expect(extensionI18n('zh-CN').t('skillsSettings.createDialogTitle')).toBe('创建技能');
    expect(extensionI18n('zh-TW').t('skillsSettings.createDialogTitle')).toBe('建立技能');
    expect(extensionI18n('zh-CN').dateTime(1780000000000)).not.toBe(extensionI18n().dateTime(1780000000000));
  });
});
