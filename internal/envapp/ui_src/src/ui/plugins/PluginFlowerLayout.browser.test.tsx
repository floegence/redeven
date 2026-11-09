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
  { width: 1280, theme: 'light', started: true },
  { width: 1280, theme: 'dark', locale: 'zh-CN', started: true },
  { width: 390, theme: 'dark', locale: 'zh-CN', started: true },
  { width: 320, height: 480, theme: 'light', locale: 'zh-CN', started: true },
])('integrates the actual Flower composer in the $width px $theme $locale workspace (started: $started)', async ({ width, height = 800, theme, locale, started }) => {
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale ?? 'en-US');
  await page.viewport(width, height);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
  host = document.createElement('div');
  host.style.cssText = `height:${height}px;width:100%;min-width:0`;
  document.body.append(host);
  let begin: (() => void) | undefined;
  dispose = render(() => {
    const coordinator = createFlowerComposerDraftCoordinator();
    const adapter = canvasFlowerAdapter();
    onCleanup(() => coordinator.dispose());
    return <FloeConfigProvider><LayoutProvider><I18nProvider><PluginCreationWorkspace
      draftCoordinator={coordinator} draftID="new" visible canManage onBack={() => {}} onSaved={() => {}} onInstalled={() => {}}
      renderFlower={options => {
        begin = () => { options.embeddedConversation.onSubmit?.(); };
        return <div class="ai-readiness-boundary h-full min-h-0" data-embedded="true">
        <div class="h-full min-h-0" data-ai-readiness-content>
          <FlowerSurface adapter={adapter} draftCoordinator={coordinator} embeddedConversation={options.embeddedConversation} notify={() => {}} />
        </div>
      </div>; }}
    /></I18nProvider></LayoutProvider></FloeConfigProvider>;
  }, host);
  await expect.element(page.getByRole('textbox')).toBeVisible();
  if (started) begin?.();
  const composer = host.querySelector<HTMLElement>('.flower-composer')!;
  const main = host.querySelector<HTMLElement>('.plugin-creation-main')!;
  const rect = composer.getBoundingClientRect();
  expect(rect.width).toBeGreaterThan(Math.min(started ? 260 : 300, width - 40));
  expect(rect.right).toBeLessThanOrEqual(main.getBoundingClientRect().right);
  expect(host.querySelectorAll('textarea')).toHaveLength(1);
  // The real EnvAIPage readiness boundary intentionally passes through canvas
  // input. This page must opt its complete embedded interaction region back in.
  expect(getComputedStyle(composer).pointerEvents).toBe('auto');
  expect(host.querySelector('.plugin-creation-flower-composer')!.children).toHaveLength(1);
  const background = host.querySelector<HTMLElement>(started ? '.plugin-creation-empty-preview .plugin-creation-atmosphere' : '.plugin-creation-main > .plugin-creation-atmosphere')!;
  expect(background.getAttribute('aria-hidden')).toBe('true');
  expect(getComputedStyle(background).pointerEvents).toBe('none');
  expect(host.scrollWidth).toBeLessThanOrEqual(width);
  if (locale === 'zh-CN') {
    await expect.element(page.getByRole('button', { name: '返回创建历史', exact: true })).toBeVisible();
    await expect.element(page.getByPlaceholder('告诉 Flower 你希望插件实现什么功能…')).toBeVisible();
  }
  const toolbar = host.querySelector<HTMLElement>('.plugin-creation-toolbar')!;
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
  await page.screenshot({ path: `__screenshots__/workspace-${width}-${theme}${locale ? '-'+locale : ''}${started ? '-generating' : ''}.png` });
  if (started && width === 1280) {
    const animations = host.querySelector('.plugin-creation-sculpture')!.getAnimations({ subtree: true });
    for (const animation of animations) animation.pause();
    for (const time of [0, 6000, 11000]) {
      for (const animation of animations) animation.currentTime = time;
      await page.screenshot({ path: `__screenshots__/workspace-${theme}-sculpture-${time}.png` });
    }
    for (const animation of animations) animation.play();
  }
  if (started && width < 720) {
    expect(background.dataset.active).toBe('false');
    await page.getByRole('tab', { name: locale === 'zh-CN' ? '预览' : 'Preview', exact: true }).click();
    await expect.poll(() => host.querySelector<HTMLElement>('.plugin-creation-empty-preview .plugin-creation-atmosphere')!.dataset.active).toBe('true');
    const canvas = host.querySelector<HTMLElement>('.plugin-creation-empty-preview')!;
    const composition = host.querySelector<HTMLElement>('.plugin-creation-placeholder')!.getBoundingClientRect();
    const bounds = canvas.getBoundingClientRect();
    expect(canvas.scrollWidth).toBeLessThanOrEqual(canvas.clientWidth);
    expect(composition.top).toBeGreaterThanOrEqual(bounds.top);
    expect(composition.bottom).toBeLessThanOrEqual(bounds.bottom);
    await page.screenshot({ path: `__screenshots__/workspace-${width}-${theme}-generating-preview.png` });
  }
  document.documentElement.classList.remove(theme);
});
