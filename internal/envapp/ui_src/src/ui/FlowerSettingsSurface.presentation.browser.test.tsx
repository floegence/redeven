import '../index.css';
import './flower-feature.css';

import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerSettingsSurface } from '../../../../flower_ui/src/settings/FlowerSettingsSurface';
import type { FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
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
      providers: [{ id: 'deepseek', type: 'deepseek', models: [
        { model_name: 'deepseek-v4-flash-vision-exp', display_name: 'DeepSeek V4 Flash Vision Exp', context_window: 1_000_000, max_output_tokens: 384_000, input_modalities: ['text', 'image'], reasoning_capability: { kind: 'effort', supported_levels: ['low', 'high', 'max'], default_level: 'high', disable_supported: true } },
        { model_name: 'deepseek-v4-pro', input_modalities: ['text'] },
        { model_name: 'deepseek-v4-flash', input_modalities: ['text'] },
      ] }],
    },
    provider_secrets: [{ provider_id: 'deepseek', provider_api_key_configured: true, web_search_api_key_configured: false }],
  };
}

async function mount(locale: RedevenLocale = 'en-US', width = 1000) {
  await page.viewport(1280, 960);
  const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
  const copy = createLocalizedFlowerSurfaceCopy({ locale,
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
  });
  const [snapshot, setSnapshot] = createSignal(settings());
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
  dispose = render(() => <FloeProvider><FlowerSettingsSurface snapshot={snapshot()} copy={copy.settings} computerCopy={copy.computer}
    onSaveDefaultPermission={savePermission} onSaveComputerUseEnabled={saveComputer}
    onSaveModelProfile={async draft => { const next = { ...snapshot(), ...draft }; setSnapshot(next); return next; }}
    onOpenComputerSettings={openComputerSettings}
  /></FloeProvider>, host);
  return { copy, savePermission, saveComputer, openComputerSettings };
}

for (const [locale, dark, width] of [
  ['en-US', false, 1000], ['zh-CN', false, 1000], ['zh-CN', true, 1200],
  ['en-US', false, 320], ['de-DE', true, 390], ['zh-TW', true, 544],
] as const) {
  it(`keeps ${locale} settings readable in a ${width}px ${dark ? 'dark' : 'light'} container`, async () => {
    const { copy, openComputerSettings } = await mount(locale, width);
    document.documentElement.classList.toggle('dark', dark);
    const frame = host.querySelector<HTMLElement>('.flower-settings-frame')!;
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
    expect(getComputedStyle(frame.querySelector('.flower-settings-title')!).fontSize).toBe('25px');
    expect(getComputedStyle(frame.querySelector('.flower-settings-title')!).fontWeight).toBe('600');
    expect(getComputedStyle(frame.querySelector('.flower-settings-subsection-description')!).fontSize).toBe('12px');
    expect(getComputedStyle(frame.querySelector('.flower-settings-model-select')!).fontSize).toBe('12px');
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
    const currentModel = frame.querySelector<HTMLElement>('.flower-settings-current-model')!;
    const modelField = currentModel.querySelector<HTMLElement>('.flower-settings-model-field')!;
    expect(modelField.scrollWidth).toBeLessThanOrEqual(modelField.clientWidth);
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
    }
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
  const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
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
