import { beforeEach } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import '../index.css';
import './flower-feature.css';
import './FlowerSurface.modelMenu.test.shared';
beforeEach(() => page.viewport(1280, 900));

import { expect, it, onTestFinished } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { createLocalizedFlowerSurfaceCopy, type FlowerSurfaceTranslator } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import type { FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import { SUPPORTED_LOCALES } from './i18n/localeMeta';
import type { EnvAppTranslationKey } from './i18n/locales';
import { expectSingleLineButtonLabels } from '../test/buttonLayoutAssertions';
import { adapter, renderSurfaceWithAdapter, renderSurfaceWithAdapterProps, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

it.each([390, 1280])('keeps model search and management visible at %s px', async (width) => {
  await page.viewport(width, 900);
  const base = settingsSnapshot();
  const snapshot = { ...base, model_profile: { schema_version: 1 as const, current_model_id: 'local/agent-0', providers: [{
    id: 'local', name: 'Local models', type: 'ollama' as const, models: Array.from({ length: 40 }, (_, i) => ({
      model_name: `agent-${i}`, context_window: 131072, quantization: 'Q8_0',
    })),
  }] } };
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadSettings: async () => snapshot, listThreads: async () => [] });
  surface.style.cssText = 'width:100%;height:100vh';
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('agent-0') === true);
  surface.querySelector<HTMLButtonElement>('button.flower-model-reasoning-model-trigger')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-model-menu input')));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const menu = document.querySelector<HTMLElement>('.flower-model-menu')!;
  const list = menu.querySelector<HTMLElement>('.flower-model-menu-list')!;
  const bounds = menu.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
  const composerFontSize = Number.parseFloat(getComputedStyle(surface.querySelector('textarea')!).fontSize);
  for (const action of menu.querySelectorAll('.flower-model-menu-footer button')) {
    expect(Number.parseFloat(getComputedStyle(action).fontSize)).toBeLessThan(composerFontSize);
  }
  expect([...menu.querySelectorAll('[role="status"]')].some(status => !status.textContent?.trim())).toBe(false);
  [...menu.querySelectorAll('button')].find((button) => button.textContent?.includes('Show all selected models'))!.click();
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  const footer = menu.querySelector<HTMLElement>('.flower-model-menu-footer')!.getBoundingClientRect();
  expect(footer.bottom).toBeLessThanOrEqual(menu.getBoundingClientRect().bottom);
  expect(footer.top).toBeGreaterThanOrEqual(menu.getBoundingClientRect().top);
  await page.screenshot({ element: menu, path: `__screenshots__/model-menu-${width}.png` });
});

it.each(SUPPORTED_LOCALES)('keeps the %s picker compact, readable, and keyboard usable across themed widths', async locale => {
  const i18n = createTestI18nHelpers(locale);
  const translator: FlowerSurfaceTranslator = { locale, t: (key, params) => i18n.t(key as EnvAppTranslationKey, params), tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) };
  const copy = createLocalizedFlowerSurfaceCopy(translator);
  const snapshot: FlowerSettingsSnapshot = { ...settingsSnapshot(), model_profile: { schema_version: 1, current_model_id: 'deepseek/deepseek-v4-flash', providers: [
    { id: 'deepseek', name: 'DeepSeek', type: 'deepseek' as const, models: [
      { model_name: 'deepseek-v4-flash', display_name: 'DeepSeek V4.1 Flash', context_window: 950000, max_output_tokens: 393216, input_modalities: ['text', 'image'], web_search: { status: 'available', reason: 'catalog_supported' } },
      { model_name: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', context_window: 950000, max_output_tokens: 393216, input_modalities: ['text', 'image'], web_search: { status: 'available', reason: 'catalog_supported' } },
    ] },
    { id: 'local', name: 'Ollama Qwen 3.8 27B', type: 'ollama' as const, models: [{ model_name: 'qwen3.8:27b', unavailable: true }] },
  ] }, provider_secrets: [{ provider_id: 'deepseek', provider_api_key_configured: true, web_search_api_key_configured: false }] };
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings: async () => snapshot, listThreads: async () => [] }, { copy });
  surface.style.cssText = 'width:100%;height:100vh';
  const root = document.documentElement;
  const attributes = ['class', 'style', 'data-floe-shell-theme'].map(name => [name, root.getAttribute(name)] as const);
  onTestFinished(() => { for (const [name, value] of attributes) { if (value === null) root.removeAttribute(name); else root.setAttribute(name, value); } });
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('Flash') === true);
  const trigger = surface.querySelector<HTMLButtonElement>('button.flower-model-reasoning-model-trigger')!;
  trigger.click();
  await waitFor(() => Boolean(document.querySelector('.flower-model-menu input')));
  for (const theme of ['paper', 'porcelain-dark']) {
    const preset = builtInShellThemePresets.find(preset => preset.name === theme)!;
    root.removeAttribute('style');
    root.classList.toggle('dark', preset.mode === 'dark');
    root.classList.toggle('light', preset.mode === 'light');
    root.dataset.floeShellTheme = theme;
    for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) root.style.setProperty(name, value);
    for (const width of [1280, 320]) {
      await page.viewport(width, 900);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (!surface.querySelector('button.flower-model-reasoning-model-trigger')) {
        surface.querySelector<HTMLButtonElement>('.flower-composer-more-button')!.click();
        await waitFor(() => Boolean(surface.querySelector('button.flower-model-reasoning-model-trigger')));
      }
      if (!document.querySelector('.flower-model-menu')) surface.querySelector<HTMLButtonElement>('button.flower-model-reasoning-model-trigger')!.click();
      await waitFor(() => Boolean(document.querySelector('.flower-model-menu')));
      const menu = document.querySelector<HTMLElement>('.flower-model-menu')!;
      const bounds = menu.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
      expectSingleLineButtonLabels(menu.querySelector('.flower-model-menu-footer')!);
      expect(menu.querySelectorAll('.flower-model-menu-group')).toHaveLength(2);
      const metadata = menu.querySelector('.flower-model-menu-meta')?.textContent;
      expect(metadata).toContain(copy.settings.dialog.contextSuffix);
      expect(metadata).toContain(copy.settings.dialog.outputSuffix);
      expect(metadata).toContain(copy.settings.dialog.imageInput);
      expect(menu.querySelector<HTMLButtonElement>('.flower-model-menu-item:disabled')?.textContent).toContain('qwen3.8:27b');
      const footer = menu.querySelector('.flower-model-menu-footer')!.getBoundingClientRect();
      const list = menu.querySelector('.flower-model-menu-list')!.getBoundingClientRect();
      expect(footer.top - list.bottom).toBeLessThan(16);
      await page.screenshot({ element: page.getByRole('dialog', { name: copy.settings.dialog.catalog.search }), path: `__screenshots__/model-menu-${locale}-${theme}-${width}.png` });
    }
  }
  const menu = document.querySelector<HTMLElement>('.flower-model-menu')!;
  const activeTrigger = surface.querySelector<HTMLButtonElement>('button.flower-model-reasoning-model-trigger')!;
  menu.querySelector<HTMLInputElement>('input')!.focus();
  await userEvent.keyboard('{ArrowDown}');
  const selected = menu.querySelector('.flower-model-menu-item')!;
  expect(document.activeElement).toBe(selected);
  expect(getComputedStyle(selected).outlineStyle).toBe('solid');
  expect(Number.parseFloat(getComputedStyle(selected).outlineWidth)).toBeGreaterThanOrEqual(2);
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('.flower-model-menu')).toBeNull();
  expect(document.activeElement).toBe(activeTrigger);
});
