import { defaultFloeMessages } from '@floegence/floe-webapp-core';
import { Input, Pagination } from '@floegence/floe-webapp-core/ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { DESKTOP_I18N_DICTIONARIES, REDEVEN_SUPPORTED_LOCALES, type RedevenLocale } from '../shared/i18n';
import { DesktopFloeLocaleProvider } from './DesktopFloeLocaleProvider';

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe('Desktop published Floe localization', () => {
  it.each(REDEVEN_SUPPORTED_LOCALES)('provides the complete %s control catalog', locale => {
    const messages = DESKTOP_I18N_DICTIONARIES[locale].floeControls;
    expect(Object.keys(messages).sort()).toEqual(Object.keys(defaultFloeMessages).sort());
    for (const key of Object.keys(defaultFloeMessages) as (keyof typeof defaultFloeMessages)[]) {
      expect(messages[key].trim()).not.toBe('');
      expect(placeholders(messages[key])).toEqual(placeholders(defaultFloeMessages[key]));
    }
  });

  it('updates published control labels while preserving mounted input state', () => {
    const [locale, setLocale] = createSignal<RedevenLocale>('en-US');
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <DesktopFloeLocaleProvider locale={locale()}>
      <Input aria-label="Project" />
      <Pagination page={1} totalPages={3} onChange={() => undefined} />
    </DesktopFloeLocaleProvider>, host);
    try {
      const input = host.querySelector('input')!;
      input.value = 'Retained project';
      input.focus();
      expect(host.querySelector('[aria-label="Next page"]')).not.toBeNull();
      setLocale('zh-TW');
      expect(host.querySelector('[aria-label="下一頁"]')).not.toBeNull();
      expect(host.querySelector('input')).toBe(input);
      expect(input.value).toBe('Retained project');
      expect(document.activeElement).toBe(input);
      setLocale('ja-JP');
      expect(host.querySelector('[aria-label="次のページ"]')).not.toBeNull();
    } finally {
      dispose();
      host.remove();
    }
  });
});
