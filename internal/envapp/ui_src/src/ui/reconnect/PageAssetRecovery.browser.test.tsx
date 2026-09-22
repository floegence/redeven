import '../../index.css';
import { createSignal, lazy, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { LayoutProvider } from '@floegence/floe-webapp-core';
import { ActivityAppsMain } from '@floegence/floe-webapp-core/app';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { I18nProvider } from '../i18n';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { ActivityPageLoading } from '../primitives/ActivityPageLoading';
import { PageAssetRecoveryNotice, PageLoadError } from './PageAssetRecovery';

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  document.body.innerHTML = '';
  writeStoredLanguagePreference('en-US');
});

function mount(content: () => JSX.Element) {
  const host = document.createElement('div');
  host.style.cssText = 'height: 500px; width: 100%; display: flex; flex-direction: column';
  document.body.append(host);
  disposers.push(render(() => <I18nProvider>{content()}</I18nProvider>, host));
  return host;
}

async function capture(name: string) {
  if (import.meta.env.VITE_PAGE_ASSET_RECOVERY_SCREENSHOTS === '1') {
    await page.screenshot({ path: `__screenshots__/page-assets-${name}.png` });
  } else {
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  }
}

describe('page asset recovery presentation', () => {
  it('replaces a failed page with an action while preserving another page draft', async () => {
    writeStoredLanguagePreference('en-US');
    const [active, setActive] = createSignal('warm');
    const [ready, setReady] = createSignal(false);
    const reload = vi.fn();
    const Broken = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    mount(() => <>
      <button onClick={() => setActive('warm')}>Draft page</button>
      <button onClick={() => setActive('broken')}>Open failed page</button>
      <LayoutProvider><ActivityAppsMain class="flex-1" activeId={active}
        renderFallback={() => <ActivityPageLoading />}
        renderError={() => <PageLoadError ready={ready()} onReload={reload} />}
        views={[
          { id: 'warm', render: () => <input aria-label="Draft" /> },
          { id: 'broken', render: () => <Broken /> },
        ]} /></LayoutProvider>
    </>);
    await page.getByRole('textbox', { name: 'Draft' }).fill('Retain my unsaved work');
    await page.getByRole('button', { name: 'Open failed page' }).click();
    await expect.element(page.getByRole('alert')).toHaveTextContent('This page could not open');
    await expect.element(page.getByRole('button', { name: 'Waiting for connection…' })).toBeDisabled();
    expect(reload).not.toHaveBeenCalled();
    await capture('failed');
    await page.getByRole('button', { name: 'Draft page' }).click();
    await expect.element(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Retain my unsaved work');
    setReady(true);
    await page.getByRole('button', { name: 'Open failed page' }).click();
    await page.getByRole('button', { name: 'Reload app' }).click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('announces an update in Chinese without reloading or blocking current work', async () => {
    writeStoredLanguagePreference('zh-CN');
    const reload = vi.fn();
    mount(() => <>
      <PageAssetRecoveryNotice reason="updated" ready onReload={reload} />
      <input aria-label="Draft" />
    </>);
    await expect.element(page.getByRole('status')).toHaveTextContent('Redeven 已更新');
    await page.getByRole('textbox').fill('尚未保存的内容');
    expect(reload).not.toHaveBeenCalled();
    await expect.element(page.getByRole('textbox')).toHaveValue('尚未保存的内容');
    const button = page.getByRole('button', { name: '重新加载应用' });
    await capture('updated-zh');
    await button.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps a narrow update notice inside the viewport', async () => {
    await page.viewport(360, 700);
    writeStoredLanguagePreference('de-DE');
    const host = mount(() => <PageAssetRecoveryNotice reason="updated" ready />);
    await expect.element(page.getByRole('status')).toHaveTextContent('Redeven wurde aktualisiert');
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    const button = host.querySelector('button')!;
    expect(getComputedStyle(button).cursor).toBe('pointer');
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
    await capture('mobile-de');
  });
});
