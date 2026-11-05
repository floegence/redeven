import '../../index.css';
import '../flower-feature.css';
import { render } from 'solid-js/web';
import { onCleanup } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { FlowerSurface, createFlowerComposerDraftCoordinator } from '../../../../../flower_ui/src';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import { PluginCreationWorkspace } from './PluginCreationWorkspace';
import { canvasFlowerAdapter } from '../../styles/tessiven-flower.test-support';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY); });

it.each([897, 390])('keeps a real embedded composer usable at %ipx without a conversation rail', async width => {
  await page.viewport(width, 800);
  host = document.createElement('div');
  host.style.cssText = 'height:720px;width:100%;min-width:0';
  document.body.append(host);
  dispose = render(() => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const adapter = canvasFlowerAdapter();
    onCleanup(() => coordinator.dispose());
    return <FloeConfigProvider><LayoutProvider><FlowerSurface adapter={adapter} draftCoordinator={coordinator}
      embeddedConversation={{ scope: 'plugin-layout', render: parts => <div style={{ display: 'flex', 'flex-direction': 'column', 'min-width': 0, height: '100%' }}>
        <div style={{ flex: 1, 'min-height': 0 }}>{parts.conversation}</div>{parts.composer}
      </div> }} notify={() => {}} /></LayoutProvider></FloeConfigProvider>;
  }, host);
  await expect.element(page.getByRole('textbox')).toBeVisible();
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  const rect = composer.getBoundingClientRect();
  expect(rect.width).toBeGreaterThan(Math.min(width - 80, 650));
  expect(rect.right).toBeLessThanOrEqual(width);
  expect(host.querySelector('.flower-component-rail-resizer')).toBeNull();
  await page.getByRole('textbox').fill('Create a focused task timer');
  await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});

it.each([
  { width: 1280, theme: 'light' },
  { width: 1280, theme: 'dark' },
  { width: 390, theme: 'light' },
  { width: 390, theme: 'dark' },
  { width: 1280, theme: 'light', locale: 'zh-CN' },
  { width: 390, theme: 'dark', locale: 'zh-CN' },
  { width: 320, theme: 'light', locale: 'zh-CN' },
])('integrates the actual Flower composer in the $width px $theme $locale workspace', async ({ width, theme, locale }) => {
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale ?? 'en-US');
  await page.viewport(width, 800);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
  host = document.createElement('div');
  host.style.cssText = 'height:800px;width:100%;min-width:0';
  document.body.append(host);
  dispose = render(() => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const adapter = canvasFlowerAdapter();
    onCleanup(() => coordinator.dispose());
    return <FloeConfigProvider><LayoutProvider><I18nProvider><PluginCreationWorkspace
      draftCoordinator={coordinator} draftID="new" visible canManage onBack={() => {}} onSaved={() => {}} onInstalled={() => {}}
      renderFlower={options => <div class="ai-readiness-boundary h-full min-h-0" data-embedded="true">
        <div class="h-full min-h-0" data-ai-readiness-content>
          <FlowerSurface adapter={adapter} draftCoordinator={coordinator} embeddedConversation={options.embeddedConversation} notify={() => {}} />
        </div>
      </div>}
    /></I18nProvider></LayoutProvider></FloeConfigProvider>;
  }, host);
  await expect.element(page.getByRole('textbox')).toBeVisible();
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  const main = host.querySelector<HTMLElement>('.plugin-creation-main')!;
  const rect = composer.getBoundingClientRect();
  expect(rect.width).toBeGreaterThan(Math.min(300, width - 40));
  expect(rect.right).toBeLessThanOrEqual(main.getBoundingClientRect().right);
  expect(host.querySelectorAll('textarea')).toHaveLength(1);
  // The real EnvAIPage readiness boundary intentionally passes through canvas
  // input. This page must opt its complete embedded interaction region back in.
  expect(getComputedStyle(host.querySelector('.plugin-creation-submit-intents')!).pointerEvents).toBe('auto');
  expect(host.scrollWidth).toBeLessThanOrEqual(width);
  if (locale === 'zh-CN') {
    await expect.element(page.getByRole('button', { name: '返回插件中心', exact: true })).toBeVisible();
    await expect.element(page.getByPlaceholder('告诉 Flower 你希望插件实现什么功能…')).toBeVisible();
  }
  const toolbar = host.querySelector<HTMLElement>('.plugin-creation-toolbar')!;
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
  await page.screenshot({ path: `__screenshots__/workspace-${width}-${theme}${locale ? '-'+locale : ''}.png` });
  document.documentElement.classList.remove(theme);
});
