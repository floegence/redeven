// @vitest-environment jsdom
import { defaultFloeMessages } from '@floegence/floe-webapp-core';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from './localeMeta';
import { loadEnvAppDictionary } from './locales';

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
describe('published Floe control localization', () => {
  it.each(SUPPORTED_LOCALES)('provides an explicit complete %s catalog with matching placeholders', async locale => {
    const dictionary = await loadEnvAppDictionary(locale);
    expect(Object.keys(dictionary.floeControls).sort()).toEqual(Object.keys(defaultFloeMessages).sort());
    for (const key of Object.keys(defaultFloeMessages) as (keyof typeof defaultFloeMessages)[]) {
      expect(dictionary.floeControls[key].trim()).not.toBe('');
      expect(placeholders(dictionary.floeControls[key])).toEqual(placeholders(defaultFloeMessages[key]));
    }
  });
  it('keeps Traditional Chinese terms independently translated', async () => {
    const dictionary = await loadEnvAppDictionary('zh-TW');
    expect(dictionary.floeControls.searchPlaceholder).toBe('搜尋…');
    expect(dictionary.floeControls.selectAll).toBe('選取所有列');
  });
});
