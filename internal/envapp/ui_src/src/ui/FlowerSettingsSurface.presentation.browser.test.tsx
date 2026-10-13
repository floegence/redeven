import '../index.css';
import './flower-feature.css';

import { FloeProvider, useTheme, builtInShellThemePresets } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerSettingsSurface } from '../../../../flower_ui/src/settings/FlowerSettingsSurface';
import type { FlowerSettingsDraft, FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';
import type { RedevenLocale } from './i18n/localeMeta';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.classList.remove('dark'); });

function settings(): FlowerSettingsSnapshot {
  return {
    defaults: { permission_type: 'approval_required', computer_use_enabled: true },
    model_profile: {
      schema_version: 1,
      current_model_id: 'deepseek/deepseek-v4-flash-vision-exp',
      providers: [{ id: 'deepseek', type: 'deepseek', base_url: 'https://api.deepseek.com', models: [
        { model_name: 'deepseek-v4-flash-vision-exp', display_name: 'DeepSeek V4 Flash Vision Exp', context_window: 1_000_000, max_output_tokens: 384_000, input_modalities: ['text', 'image'], reasoning_capability: { kind: 'effort', supported_levels: ['low', 'high', 'max'], default_level: 'high', disable_supported: true } },
        { model_name: 'deepseek-v4-pro', input_modalities: ['text'] },
        { model_name: 'deepseek-v4-flash', input_modalities: ['text'] },
      ] }, { id: 'local', type: 'ollama', name: 'Ollama Qwen 3.8 27B', base_url: 'http://127.0.0.1:11434/v1', models: [
        { model_name: 'qwen3.8:27b', context_window: 128_000, input_modalities: ['text'] },
      ] }],
    },
    provider_secrets: [{ provider_id: 'deepseek', provider_api_key_configured: true, web_search_api_key_configured: false }],
  };
}

async function mount(locale: RedevenLocale = 'en-US', width = 1000, dark = false, initial = settings()) {
  await page.viewport(1280, 960);
  const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
  const copy = createLocalizedFlowerSurfaceCopy({ locale,
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
  });
  const [snapshot, setSnapshot] = createSignal(initial);
  const savePermission = vi.fn(async (permission_type: FlowerSettingsSnapshot['defaults']['permission_type']) => {
    const next = { ...snapshot(), defaults: { ...snapshot().defaults, permission_type } };
    setSnapshot(next); return next;
  });
  const saveComputer = vi.fn(async (computer_use_enabled: boolean) => {
    const next = { ...snapshot(), defaults: { ...snapshot().defaults, computer_use_enabled } };
    setSnapshot(next); return next;
  });
  host = document.createElement('div');
  Object.assign(host.style, { width: `${width}px`, height: '940px' });
  document.body.append(host);
  const openComputerSettings = vi.fn();
  const saveModel = vi.fn(async (draft: FlowerSettingsDraft) => {
    const next = { ...snapshot(), ...draft }; setSnapshot(next); return next;
  });
  function SettingsTheme() {
    const theme = useTheme();
    onMount(() => theme.selectShellTheme(dark ? 'dark' : 'light', dark ? 'porcelain-dark' : 'porcelain-light'));
    return null;
  }
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><SettingsTheme /><FlowerSettingsSurface snapshot={snapshot()} copy={copy.settings} computerCopy={copy.computer}
    onSaveDefaultPermission={savePermission} onSaveComputerUseEnabled={saveComputer}
    onSaveModelProfile={saveModel}
    onOpenComputerSettings={openComputerSettings}
  /></FloeProvider>, host);
  return { copy, savePermission, saveComputer, saveModel, openComputerSettings };
}

it('shows a compact model summary and opens model selection only from its edit action', async () => {
  const { saveModel } = await mount();
  const currentModel = host.querySelector<HTMLElement>('.flower-settings-current-model')!;
  expect(currentModel.querySelector('.flower-settings-model-select')).toBeNull();
  expect(currentModel.textContent).toContain('DeepSeek V4 Flash Vision Exp');
  expect(currentModel.querySelector('.flower-settings-model-group')!.getBoundingClientRect().height).toBeLessThan(150);
  const edit = currentModel.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!;
  await userEvent.click(edit);
  const select = currentModel.querySelector<HTMLButtonElement>('.flower-settings-model-select')!;
  expect(select).not.toBeNull();
  await userEvent.click(select);
  await userEvent.click(page.getByRole('menuitem', { name: 'DeepSeek / deepseek-v4-pro', exact: true }));
  await expect.poll(() => saveModel.mock.calls.length).toBe(1);
  expect(saveModel.mock.calls[0][0].model_profile?.current_model_id).toBe('deepseek/deepseek-v4-pro');
  expect(currentModel.querySelector('.flower-settings-model-select')).toBeNull();
  expect(currentModel.textContent).toContain('deepseek-v4-pro');
  expect(document.activeElement).toBe(edit);
});

it('balances provider identity, readiness, and actions across a compact row', async () => {
  await mount();
  const row = host.querySelector<HTMLElement>('.flower-settings-provider-card')!;
  const identity = row.querySelector<HTMLElement>('.flower-settings-provider-body')!;
  const status = row.querySelector<HTMLElement>('.flower-settings-provider-status')!;
  const actions = row.querySelector<HTMLElement>('.flower-settings-provider-actions')!;
  expect(row.getBoundingClientRect().height).toBeLessThan(100);
  expect(status.getBoundingClientRect().left).toBeGreaterThan(identity.getBoundingClientRect().right);
  expect(actions.getBoundingClientRect().left).toBeGreaterThan(status.getBoundingClientRect().right);
  expect(Math.abs(status.getBoundingClientRect().top - identity.getBoundingClientRect().top)).toBeLessThan(20);
  const statuses = [...host.querySelectorAll<HTMLElement>('.flower-settings-provider-status')];
  expect(new Set(statuses.map(item => item.getBoundingClientRect().left)).size).toBe(1);
});

it('closes model editing by keyboard without saving and keeps default reasoning editable', async () => {
  const { copy, saveModel } = await mount();
  const edit = host.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!;
  edit.focus();
  await userEvent.keyboard('{Enter}');
  expect(host.querySelector('.flower-settings-model-select')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(host.querySelector('.flower-settings-model-select')).toBeNull();
  expect(document.activeElement).toBe(edit);
  expect(saveModel).not.toHaveBeenCalled();
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-reasoning button')!);
  await userEvent.click(page.getByRole('menuitemradio', { name: copy.settings.reasoningControl.max, exact: true }));
  await expect.poll(() => saveModel.mock.calls.length).toBe(1);
  const profile = saveModel.mock.calls[0][0].model_profile!;
  expect(profile.current_model_id).toBe('deepseek/deepseek-v4-flash-vision-exp');
  expect(profile.providers[0].models[0].default_reasoning_selection).toEqual({ level: 'max' });
});

for (const [locale, dark, width] of [
  ['en-US', false, 1000], ['zh-CN', false, 1000], ['zh-CN', true, 1200],
  ['en-US', false, 320], ['de-DE', true, 390], ['zh-TW', true, 544],
] as const) {
  it(`keeps ${locale} settings readable in a ${width}px ${dark ? 'dark' : 'light'} container`, async () => {
    const { copy, openComputerSettings } = await mount(locale, width, dark);
    const frame = host.querySelector<HTMLElement>('.flower-settings-frame')!;
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    expect(getComputedStyle(frame.querySelector('.flower-settings-title')!).fontSize).toBe('25px');
    expect(getComputedStyle(frame.querySelector('.flower-settings-title')!).fontWeight).toBe('600');
    expect(getComputedStyle(frame.querySelector('.flower-settings-subsection-description')!).fontSize).toBe('12px');
    expect(frame.querySelector('.flower-settings-model-select')).toBeNull();
    const sections = [...frame.querySelectorAll<HTMLElement>(':scope > section')];
    expect(sections).toHaveLength(4);
    for (let index = 0; index < sections.length; index++) {
      expect(sections[index].scrollWidth).toBeLessThanOrEqual(sections[index].clientWidth);
      expect(getComputedStyle(sections[index]).borderRadius).toBe('0px');
      if (index > 0) expect(parseFloat(getComputedStyle(sections[index]).paddingTop)).toBeGreaterThanOrEqual(20);
    }
    for (const control of frame.querySelectorAll<HTMLElement>('.flower-settings-policy-card, .flower-settings-provider-card')) {
      expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth);
    }
    for (const control of frame.querySelectorAll<HTMLElement>('.flower-settings-policy-card')) {
      const description = document.getElementById(control.getAttribute('aria-describedby')!);
      expect(description).not.toBeNull();
      expect(control.contains(description)).toBe(false);
      expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    }
    const currentModel = frame.querySelector<HTMLElement>('.flower-settings-current-model')!;
    const modelField = currentModel.querySelector<HTMLElement>('.flower-settings-model-field')!;
    expect(modelField.scrollWidth).toBeLessThanOrEqual(modelField.clientWidth);
    if (width >= 1000) {
      const identity = modelField.querySelector<HTMLElement>('.flower-settings-model-identity')!;
      const edit = modelField.querySelector<HTMLElement>('.flower-settings-model-edit')!;
      expect(edit.getBoundingClientRect().left).toBeGreaterThan(identity.getBoundingClientRect().right);
      const stats = [...currentModel.querySelectorAll<HTMLElement>('.flower-settings-model-stat')];
      expect(stats).toHaveLength(4);
      const widths = stats.map(stat => stat.getBoundingClientRect().width);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
      expect(Math.abs(stats[3].getBoundingClientRect().right - currentModel.querySelector('.flower-settings-model-metadata')!.getBoundingClientRect().right)).toBeLessThan(2);
    }
    expect(currentModel.textContent).toContain(copy.settings.dialog.contextWindow);
    expect(currentModel.textContent).toContain(copy.settings.dialog.maxOutput);
    const permission = frame.querySelector<HTMLElement>('[role="radiogroup"]')!;
    const columns = getComputedStyle(permission).gridTemplateColumns.split(' ');
    expect(columns.length).toBe(1);
    const thumb = frame.querySelector<HTMLElement>('.flower-settings-toggle-thumb')!;
    expect(getComputedStyle(thumb).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(thumb).backgroundColor).not.toBe(getComputedStyle(thumb.parentElement!).backgroundColor);
    const providerDetails = frame.querySelector<HTMLDetailsElement>('.flower-settings-provider-details')!;
    providerDetails.querySelector('summary')!.click();
    expect(providerDetails.open).toBe(true);
    expect(providerDetails.scrollWidth).toBeLessThanOrEqual(providerDetails.clientWidth);
    providerDetails.querySelector('summary')!.click();
    const computer = [...frame.querySelectorAll<HTMLButtonElement>('.flower-settings-computer-use-section button')].find(button => button.textContent === copy.computer.title)!;
    expect(computer.querySelector('input')).toBeNull();
    computer.click();
    expect(openComputerSettings).toHaveBeenCalledTimes(1);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') {
      await page.screenshot({ element: frame, path: `__screenshots__/flower-settings-${locale}-${width}.png` });
      const surface = frame.parentElement!;
      surface.scrollTop = surface.scrollHeight;
      await page.screenshot({ element: surface, path: `__screenshots__/flower-settings-bottom-${locale}-${width}.png` });
    }
    const edit = currentModel.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!;
    await userEvent.click(edit);
    const selector = currentModel.querySelector<HTMLElement>('.flower-settings-model-select')!;
    expect(getComputedStyle(selector).fontSize).toBe('12px');
    expect(modelField.scrollWidth).toBeLessThanOrEqual(modelField.clientWidth);
    expect(document.activeElement).toBe(selector);
    await userEvent.click(edit);
    expect(currentModel.querySelector('.flower-settings-model-select')).toBeNull();
  });
}

it('aligns section headings separately from controls and discloses provider detail on demand', async () => {
  const { copy } = await mount();
  const sections = [...host.querySelectorAll<HTMLElement>('.flower-settings-frame > section')];
  expect(sections.map(section => section.getAttribute('aria-label'))).toEqual([
    copy.settings.currentModel, copy.settings.providersTitle, copy.settings.defaultPermissionTitle, copy.settings.computerUseTitle,
  ]);
  const contentEdges = sections.map(section => {
    const heading = section.querySelector<HTMLElement>('.flower-settings-subsection-header')!;
    const content = section.querySelector<HTMLElement>('.flower-settings-section-content')!;
    expect(content.getBoundingClientRect().top - heading.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(11);
    expect(content.getBoundingClientRect().left).toBe(heading.getBoundingClientRect().left);
    expect(parseFloat(getComputedStyle(section).paddingTop)).toBeGreaterThanOrEqual(20);
    return content.getBoundingClientRect().left;
  });
  expect(new Set(contentEdges).size).toBe(1);
  const details = host.querySelector<HTMLDetailsElement>('.flower-settings-provider-details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')?.textContent).toContain('3');
  const summary = details.querySelector('summary')!;
  summary.focus();
  await userEvent.keyboard('{Enter}');
  expect(details.open).toBe(true);
  expect(details.textContent).toContain('deepseek-v4-flash-vision-exp');
  expect(details.textContent).toContain(copy.settings.web);
  await userEvent.keyboard('{Enter}');
  expect(details.open).toBe(false);
});

it('saves permission by keyboard and restores the computer switch after a failed save', async () => {
  const { savePermission, saveComputer } = await mount();
  const selected = host.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')!;
  selected.focus();
  await userEvent.keyboard('{ArrowLeft}');
  await expect.poll(() => savePermission.mock.calls.length).toBe(1);
  expect(savePermission).toHaveBeenCalledWith('readonly');
  expect(document.activeElement?.getAttribute('aria-checked')).toBe('true');
  const toggle = host.querySelector<HTMLButtonElement>('.flower-settings-computer-group [role="switch"]')!;
  saveComputer.mockRejectedValueOnce(new Error('Unable to save computer preference'));
  toggle.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => host.querySelector('[role="alert"]')?.textContent).toContain('Unable to save computer preference');
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(toggle.disabled).toBe(false);
  toggle.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false');
  expect(saveComputer).toHaveBeenLastCalledWith(false);
});

it('keeps the independently portaled provider dialog on the Flower reading scale', async () => {
  await mount();
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-provider-add')!);
  await expect.poll(() => document.querySelector('.flower-provider-dialog')).not.toBeNull();
  const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
  expect(getComputedStyle(dialog.querySelector('[data-floe-dialog-header] h2')!).fontSize).toBe('16px');
  expect(getComputedStyle(dialog.querySelector('.flower-settings-subsection-description')!).fontSize).toBe('12px');
  for (const copy of dialog.querySelectorAll('.flower-body-copy')) {
    expect(getComputedStyle(copy).fontSize).toBe('12px');
  }
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
});

it('persists provider switches, preserves the disabled default, and excludes its models from editing', async () => {
  const { copy, saveModel } = await mount();
  const toggle = () => host.querySelector<HTMLButtonElement>('.flower-settings-provider-toggle')!;
  toggle().focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => toggle().getAttribute('aria-checked')).toBe('false');
  expect(document.activeElement).toBe(toggle());
  expect(saveModel.mock.calls[0][0].model_profile?.providers[0].enabled).toBe(false);
  expect(saveModel.mock.calls[0][0].model_profile?.current_model_id).toBe('deepseek/deepseek-v4-flash-vision-exp');
  expect(host.querySelector('.flower-settings-model-name')?.textContent).toBe('DeepSeek V4 Flash Vision Exp');
  expect(host.textContent).toContain(copy.settings.currentProviderDisabled);
  const statuses = [...host.querySelectorAll('.flower-settings-provider-status')];
  expect(statuses[0].textContent).toBe(copy.settings.providerDisabled);
  expect(statuses[1].textContent).toBe(copy.settings.ready);
  expect(statuses.some(status => status.textContent?.includes(copy.settings.apiKey))).toBe(false);
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!);
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-model-select')!);
  await expect.element(page.getByRole('menuitem', { name: 'DeepSeek / deepseek-v4-pro', exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole('menuitem', { name: 'Ollama Qwen 3.8 27B / qwen3.8:27b', exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}{Escape}');
  await userEvent.click(toggle());
  await expect.poll(() => toggle().getAttribute('aria-checked')).toBe('true');
  expect(saveModel.mock.lastCall?.[0].model_profile?.providers[0].enabled).toBe(true);
  expect(host.textContent).not.toContain(copy.settings.currentProviderDisabled);
});

it('rolls back a failed provider switch and permits retry without changing credentials', async () => {
  const { saveModel } = await mount();
  saveModel.mockRejectedValueOnce(new Error('Unable to save provider state'));
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-provider-toggle')!);
  await expect.poll(() => host.textContent).toContain('Unable to save provider state');
  expect(host.querySelector('.flower-settings-provider-toggle')?.getAttribute('aria-checked')).toBe('true');
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-provider-toggle')!);
  await expect.poll(() => host.querySelector('.flower-settings-provider-toggle')?.getAttribute('aria-checked')).toBe('false');
  expect(saveModel.mock.lastCall?.[0].model_profile?.providers[0].provider_api_key).toBeUndefined();
  expect(saveModel.mock.lastCall?.[0].model_profile?.providers[0].web_search_api_key).toBeUndefined();
});

it('keeps an all-disabled profile visible and requires credentials before re-enabling', async () => {
  const initial = settings();
  const disabled = { ...initial, provider_secrets: [], model_profile: { ...initial.model_profile!, providers: initial.model_profile!.providers.map(provider => ({ ...provider, enabled: false })) } };
  const { copy, saveModel } = await mount('en-US', 1000, false, disabled);
  expect(host.querySelector('.flower-settings-model-name')?.textContent).toBe('DeepSeek V4 Flash Vision Exp');
  expect(host.querySelector<HTMLButtonElement>('.flower-settings-model-edit')?.disabled).toBe(true);
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-provider-toggle')!);
  await expect.poll(() => host.textContent).toContain(copy.settings.needsKey);
  expect(saveModel).not.toHaveBeenCalled();
  expect(host.querySelector('.flower-settings-provider-toggle')?.getAttribute('aria-checked')).toBe('false');
});
