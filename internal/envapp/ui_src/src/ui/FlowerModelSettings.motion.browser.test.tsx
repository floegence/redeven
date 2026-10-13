import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerModelSettings } from '../../../../flower_ui/src/settings/FlowerModelSettings';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';

let dispose: (() => void) | undefined;
let host: HTMLElement;
let style: HTMLStyleElement;
afterEach(() => { dispose?.(); host?.remove(); style?.remove(); vi.restoreAllMocks(); localStorage.clear(); });

async function mount(surface: 'desktop' | 'env', narrow = false) {
  await page.viewport(narrow ? 390 : 1280, 960);
  const i18n = createI18nHelpers('zh-CN', await loadEnvAppDictionary('zh-CN'));
  const copy = createLocalizedFlowerSurfaceCopy({ locale: 'zh-CN',
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
  }).settings;
  style = document.createElement('style'); style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS;
  document.head.append(style);
  host = document.createElement('div'); host.className = 'flower-settings-surface';
  Object.assign(host.style, { width: narrow ? '390px' : '900px', padding: '24px', background: 'var(--background)' });
  document.body.append(host);
  function Theme() {
    const theme = useTheme();
    onMount(() => theme.selectShellTheme(narrow ? 'dark' : 'light', narrow ? 'porcelain-dark' : 'porcelain-light'));
    return null;
  }
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets, defaultSurfaceStyle: 'soft-neumorphic' } }}><Theme /><div class="flower-settings-frame"><FlowerModelSettings
    copy={copy} currentModelID="deepseek/vision" providerReady={() => true}
    providers={[
      { id: 'deepseek', type: 'deepseek', models: [
        { model_name: 'vision', display_name: 'DeepSeek V4.1 Flash', context_window: 1000000, max_output_tokens: 393216, input_modalities: ['text', 'image'] },
        { model_name: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', context_window: 1000000, max_output_tokens: 393216 },
      ] },
      { id: 'local', type: 'ollama', name: 'Ollama Qwen 3.8 27B', models: [{ model_name: 'qwen3.8:27b', context_window: 128000 }] },
    ]}
    onChooseModel={vi.fn()} onChangeReasoning={vi.fn()} onAddProvider={vi.fn()} onEditProvider={vi.fn()} onRemoveProvider={vi.fn()} onToggleProvider={vi.fn()}
  /></div></FloeProvider>, host);
  const card = host.querySelector<HTMLElement>('.flower-settings-provider-card')!;
  const trigger = card.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!;
  const panel = card.querySelector<HTMLDivElement>('.flower-settings-provider-details')!;
  return { card, trigger, panel };
}

for (const surface of ['desktop', 'env'] as const) {
  for (const narrow of [false, true]) it(`keeps compact identity and aligned actions in ${surface} ${narrow ? 'narrow dark' : 'wide light'}`, async () => {
    const { card, trigger, panel } = await mount(surface, narrow);
    const title = card.querySelector('.flower-settings-provider-title')!.getBoundingClientRect();
    const disclosure = trigger.getBoundingClientRect();
    expect(disclosure.top - title.bottom).toBeLessThanOrEqual(4);
    expect(disclosure.left).toBeCloseTo(title.left, 0);
    const identity = card.querySelector('.flower-settings-provider-body')!.getBoundingClientRect();
    const actions = card.querySelector('.flower-settings-provider-actions')!.getBoundingClientRect();
    expect(Math.abs(identity.top + identity.height / 2 - actions.top - actions.height / 2)).toBeLessThan(1);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: host, path: `__screenshots__/flower-provider-density-${surface}-${narrow ? 'narrow' : 'wide'}.png` });
    await userEvent.click(trigger);
    await expect.poll(() => panel.dataset.state).toBe('open');
    expect(panel.getBoundingClientRect().width).toBeCloseTo(card.getBoundingClientRect().width, 0);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: host, path: `__screenshots__/flower-provider-density-${surface}-${narrow ? 'narrow' : 'wide'}-expanded.png` });
  });

  it(`reverses disclosure motion continuously and restores keyboard focus in ${surface}`, async () => {
    const { trigger, panel } = await mount(surface);
    trigger.click();
    await expect.poll(() => panel.getAnimations().length).toBe(1);
    const opening = panel.getAnimations()[0]; opening.pause(); opening.currentTime = 60;
    const intermediate = panel.getBoundingClientRect().height;
    const content = panel.firstElementChild!.getBoundingClientRect().height;
    expect(intermediate).toBeGreaterThan(0);
    expect(intermediate).toBeLessThan(content);
    trigger.click();
    const closing = panel.getAnimations()[0]; closing.pause(); closing.currentTime = 0;
    expect(panel.getBoundingClientRect().height).toBeCloseTo(intermediate, 0);
    expect(panel.inert).toBe(true);
    closing.currentTime = 60;
    const reversing = panel.getBoundingClientRect().height;
    trigger.click();
    await expect.poll(() => panel.getAnimations().length).toBe(1);
    const reopening = panel.getAnimations()[0]; reopening.pause(); reopening.currentTime = 0;
    expect(panel.getBoundingClientRect().height).toBeCloseTo(reversing, 0);
    reopening.finish();
    await expect.poll(() => panel.dataset.state).toBe('open');
    const table = panel.querySelector('table');
    panel.querySelector<HTMLElement>('[role=region]')!.focus();
    trigger.click();
    expect(document.activeElement).toBe(trigger);
    await expect.poll(() => panel.dataset.state).toBe('closed');
    expect(panel.getBoundingClientRect().height).toBe(0);
    trigger.focus(); await userEvent.keyboard('{Enter}');
    await expect.poll(() => panel.dataset.state).toBe('open');
    expect(panel.querySelector('table')).toBe(table);
    expect(document.activeElement).toBe(trigger);
    await userEvent.keyboard(' ');
    await expect.poll(() => panel.dataset.state).toBe('closed');
  });

  it(`settles disclosure immediately when reduced motion is requested in ${surface}`, async () => {
    const original = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation(query => query === '(prefers-reduced-motion: reduce)' ? { ...original(query), matches: true } as MediaQueryList : original(query));
    const { trigger, panel } = await mount(surface);
    trigger.click();
    expect(panel.dataset.state).toBe('open');
    expect(panel.getAnimations()).toHaveLength(0);
    expect(panel.getBoundingClientRect().height).toBeGreaterThan(0);
    trigger.click();
    expect(panel.dataset.state).toBe('closed');
    expect(panel.getBoundingClientRect().height).toBe(0);
    expect(panel.getAnimations()).toHaveLength(0);
  });
}
