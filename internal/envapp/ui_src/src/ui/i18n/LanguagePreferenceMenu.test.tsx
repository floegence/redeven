// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider, useI18n } from './I18nProvider';
import { LOCALE_OPTIONS } from './localeMeta';
import { LanguagePreferenceMenu } from './LanguagePreferenceMenu';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from './storageKey';
import type { RedevenLanguageSnapshot } from './resolveLocale';

vi.mock('@floegence/floe-webapp-core', async original => ({
  ...await original<object>(),
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Check: (props: { class?: string }) => <span data-icon="check" class={props.class} />,
  Globe: (props: { class?: string }) => <span data-icon="globe" class={props.class} />,
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function CurrentFilesTitle() {
  const i18n = useI18n();
  return <span data-testid="current-files-title">{i18n.t('files.title')}</span>;
}

describe('LanguagePreferenceMenu', () => {
  let host: HTMLDivElement;
  let dispose: () => void;

  it('changes language inside the persistent tools page without a floating menu', async () => {
    dispose = render(() => <I18nProvider><LanguagePreferenceMenu variant="inline" /></I18nProvider>, host);
    await flushAsync();
    expect(host.querySelector('[data-envapp-language-trigger]')).toBeNull();
    const option = host.querySelector<HTMLButtonElement>('[data-envapp-language-option="zh-TW"]')!;
    option.click();
    await vi.waitFor(() => expect(document.documentElement.lang).toBe('zh-TW'));
    expect(host.querySelector('[data-envapp-language-menu="inline"]')).not.toBeNull();
    expect(host.querySelector('[data-envapp-language-option="zh-TW"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps inline language keyboard navigation within the shared options', async () => {
    dispose = render(() => <I18nProvider><LanguagePreferenceMenu variant="inline" /></I18nProvider>, host);
    await flushAsync();
    const menu = host.querySelector<HTMLElement>('[data-envapp-language-menu="inline"]')!;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[data-envapp-language-option]'));
    items[0]!.focus();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(items.at(-1));
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    menu.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(false);
    expect(menu.isConnected).toBe(true);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    delete window.redevenDesktopLanguage;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    dispose?.();
    host.remove();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
    document.title = '';
    delete window.redevenDesktopLanguage;
  });

  it('renders the browser-owned language menu and persists the selected locale locally', async () => {
    const notify = { success: vi.fn() };

    dispose = render(() => (
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

    const options = Array.from(document.querySelectorAll('[data-envapp-language-option]')) as HTMLButtonElement[];
    expect(document.querySelector('[data-envapp-language-menu="topbar"]')).toBeTruthy();
    expect(options).toHaveLength(LOCALE_OPTIONS.length + 1);
    expect(document.querySelector('[data-envapp-language-option="system"]')?.textContent).toContain('System default');
    expect(document.querySelector('[data-envapp-language-option="zh-CN"]')?.textContent).toContain('简体中文 / Simplified Chinese');
    expect(document.querySelector('[data-envapp-language-option="system"]')?.getAttribute('aria-checked')).toBe('true');

    (document.querySelector('[data-envapp-language-option="zh-CN"]') as HTMLButtonElement | null)?.click();
    await vi.waitFor(() => {
      expect(document.documentElement.lang).toBe('zh-CN');
    });

    expect(window.localStorage.getItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY)).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.querySelector('[data-envapp-language-menu="topbar"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(notify.success).toHaveBeenCalledTimes(1);
    expect(`${notify.success.mock.calls[0]?.[0] ?? ''} ${notify.success.mock.calls[0]?.[1] ?? ''}`).toContain('简体中文');

    trigger?.click();
    await flushAsync();
    expect(document.querySelector('[data-envapp-language-option="zh-CN"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('opens from shell requests and closes with Escape while returning focus', async () => {
    const [openSeq, setOpenSeq] = createSignal(0);

    dispose = render(() => (
      <I18nProvider>
        <LanguagePreferenceMenu variant="access_gate" openRequestSeq={openSeq} />
      </I18nProvider>
    ), host);
    await flushAsync();

    setOpenSeq(1);
    await flushAsync();

    const trigger = host.querySelector('[data-envapp-language-trigger="access_gate"]') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    expect(document.querySelector('[data-envapp-language-menu="access_gate"]')).toBeTruthy();
    expect(document.activeElement?.getAttribute('data-envapp-language-option')).toBe('system');

    const menu = document.querySelector('[data-envapp-language-menu="access_gate"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();

    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await flushAsync();
    expect(document.activeElement?.getAttribute('data-envapp-language-option')).toBe('en-US');

    menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushAsync();

    expect(document.querySelector('[data-envapp-language-menu="access_gate"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not mount English UI while an initial non-English catalog is loading', async () => {
    window.localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, 'zh-CN');

    dispose = render(() => (
      <I18nProvider>
        <CurrentFilesTitle />
      </I18nProvider>
    ), host);

    expect(host.querySelector('[data-testid="current-files-title"]')).toBeNull();
    expect(host.textContent).not.toContain('Files');

    await vi.waitFor(() => {
      expect(host.querySelector('[data-testid="current-files-title"]')?.textContent).toBe('文件');
      expect(document.documentElement.lang).toBe('zh-CN');
    });
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

    dispose = render(() => (
      <I18nProvider>
        <LanguagePreferenceMenu variant="topbar" />
      </I18nProvider>
    ), host);
    await vi.waitFor(() => {
      expect(document.documentElement.lang).toBe('zh-TW');
    });

    expect(host.querySelector('[data-envapp-language-trigger]')).toBeNull();
    expect(window.localStorage.getItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY)).toBeNull();
    expect(setPreference).not.toHaveBeenCalled();
  });
});
