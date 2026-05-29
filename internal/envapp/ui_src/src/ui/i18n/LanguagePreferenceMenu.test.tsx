// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from './I18nProvider';
import { LOCALE_OPTIONS } from './localeMeta';
import { LanguagePreferenceMenu } from './LanguagePreferenceMenu';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from './storageKey';
import type { RedevenLanguageSnapshot } from './resolveLocale';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Check: (props: { class?: string }) => <span data-icon="check" class={props.class} />,
  Globe: (props: { class?: string }) => <span data-icon="globe" class={props.class} />,
}));

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('LanguagePreferenceMenu', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    delete window.redevenDesktopLanguage;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
    document.title = '';
    delete window.redevenDesktopLanguage;
  });

  it('renders the browser-owned language menu and persists the selected locale locally', async () => {
    const notify = { success: vi.fn() };

    render(() => (
      <I18nProvider>
        <LanguagePreferenceMenu variant="topbar" notify={notify} />
      </I18nProvider>
    ), host);
    await flushAsync();

    const trigger = host.querySelector('[data-envapp-language-trigger="topbar"]') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    expect(trigger?.className).toContain('cursor-pointer');
    expect(document.documentElement.lang).toBe('en-US');

    trigger?.click();
    await flushAsync();

    const options = Array.from(host.querySelectorAll('[data-envapp-language-option]')) as HTMLButtonElement[];
    expect(host.querySelector('[data-envapp-language-menu="topbar"]')).toBeTruthy();
    expect(options).toHaveLength(LOCALE_OPTIONS.length + 1);
    expect(host.querySelector('[data-envapp-language-option="system"]')?.textContent).toContain('System default');
    expect(host.querySelector('[data-envapp-language-option="zh-CN"]')?.textContent).toContain('简体中文 / Simplified Chinese');
    expect(host.querySelector('[data-envapp-language-option="system"]')?.getAttribute('aria-checked')).toBe('true');

    (host.querySelector('[data-envapp-language-option="zh-CN"]') as HTMLButtonElement | null)?.click();
    await flushAsync();

    expect(window.localStorage.getItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY)).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(host.querySelector('[data-envapp-language-menu="topbar"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(`${notify.success.mock.calls[0]?.[0] ?? ''} ${notify.success.mock.calls[0]?.[1] ?? ''}`).toContain('简体中文');

    trigger?.click();
    await flushAsync();
    expect(host.querySelector('[data-envapp-language-option="zh-CN"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('opens from shell requests and closes with Escape while returning focus', async () => {
    const [openSeq, setOpenSeq] = createSignal(0);

    render(() => (
      <I18nProvider>
        <LanguagePreferenceMenu variant="access_gate" openRequestSeq={openSeq} />
      </I18nProvider>
    ), host);
    await flushAsync();

    setOpenSeq(1);
    await flushAsync();

    const trigger = host.querySelector('[data-envapp-language-trigger="access_gate"]') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    expect(host.querySelector('[data-envapp-language-menu="access_gate"]')).toBeTruthy();
    expect(document.activeElement?.getAttribute('data-envapp-language-option')).toBe('system');

    const menu = host.querySelector('[data-envapp-language-menu="access_gate"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();

    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flushAsync();
    expect(document.activeElement?.getAttribute('data-envapp-language-option')).toBe('en-US');

    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushAsync();

    expect(host.querySelector('[data-envapp-language-menu="access_gate"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not render a browser language control when Desktop owns language preference', async () => {
    const snapshot: RedevenLanguageSnapshot = {
      preference: 'zh-TW',
      resolved_locale: 'zh-TW',
      source: 'explicit',
      system_candidates: ['zh-Hant'],
    };
    const setPreference = vi.fn(() => snapshot);
    window.redevenDesktopLanguage = {
      getSnapshot: () => snapshot,
      setPreference,
      subscribe: () => () => undefined,
    };

    render(() => (
      <I18nProvider>
        <LanguagePreferenceMenu variant="topbar" />
      </I18nProvider>
    ), host);
    await flushAsync();

    expect(host.querySelector('[data-envapp-language-trigger]')).toBeNull();
    expect(window.localStorage.getItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.lang).toBe('zh-TW');
    expect(setPreference).not.toHaveBeenCalled();
  });
});
