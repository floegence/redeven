import '../index.css';
import './flower-feature.css';

import { FloeProvider, useTheme, builtInShellThemePresets } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerSettingsSurface } from '../../../../flower_ui/src/settings/FlowerSettingsSurface';
import type { FlowerSettingsDraft, FlowerSettingsSnapshot, FlowerChatGPTAuth, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';
import type { RedevenLocale } from './i18n/localeMeta';
import { backendModelsForProviderType, providerDefaultsFixture } from '../../../../flower_ui/testing/providerCatalogFixture';
import { cloneFlowerModel } from '../../../../flower_ui/src/providerModelProjection';
import { withFlowerModelDirectory } from '../../../../flower_ui/src/modelDirectory';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.classList.remove('dark'); });

it('keeps the model disclosure immediately beneath provider identity', async () => {
  await mount();
  const card = host.querySelector<HTMLElement>('.flower-settings-provider-card')!;
  const title = card.querySelector('.flower-settings-provider-title')!.getBoundingClientRect();
  const trigger = card.querySelector('.flower-settings-provider-disclosure')!.getBoundingClientRect();
  expect(trigger.top - title.bottom).toBeLessThanOrEqual(4);
  expect(trigger.left).toBeCloseTo(title.left, 0);
});

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

it('persists native provider aliases and uses them in the provider gallery and model picker', async () => {
  const { copy, saveModel } = await mount();
  await userEvent.click(page.getByRole('button', { name: copy.settings.editProvider, exact: true }).nth(0));
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.connectionName, exact: true }));
  await userEvent.fill(page.getByRole('textbox', { name: copy.settings.dialog.connectionName, exact: true }), 'Work DeepSeek');
  await userEvent.keyboard('{Enter}');
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }));
  await expect.poll(() => saveModel.mock.calls.length).toBe(1);
  expect(saveModel.mock.calls[0][0].model_profile?.providers[0]).toMatchObject({ id: 'deepseek', type: 'deepseek', name: 'Work DeepSeek' });
  await expect.poll(() => host.querySelector('.flower-settings-provider-title > span')?.textContent).toBe('Work DeepSeek');
  expect(host.querySelector('.flower-settings-model-provider')?.textContent).toBe('Work DeepSeek');
  await userEvent.click(page.getByRole('button', { name: copy.settings.changeModel, exact: true }));
  await expect.element(page.getByRole('option', { name: 'Work DeepSeek / deepseek-v4-pro', exact: true })).toBeVisible();
});

async function mount(locale: RedevenLocale = 'en-US', width = 1000, dark = false, initial = settings(), auth?: FlowerChatGPTAuth, loadAccounts?: FlowerSurfaceAdapter['loadChatGPTAccounts']) {
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
  const saveModelUpdates = vi.fn(async (auto_update_model_catalog: boolean) => {
    const next = { ...snapshot(), defaults: { ...snapshot().defaults, auto_update_model_catalog } };
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
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><SettingsTheme /><FlowerSettingsSurface snapshot={snapshot()} chatGPTAuth={auth} loadChatGPTAccounts={loadAccounts} copy={copy.settings} computerCopy={copy.computer}
    onSaveDefaultPermission={savePermission} onSaveComputerUseEnabled={saveComputer}
    onSaveAutoUpdateModelCatalog={saveModelUpdates}
    onSaveModelProfile={saveModel}
    onOpenComputerSettings={openComputerSettings}
  /></FloeProvider>, host);
  return { copy, savePermission, saveComputer, saveModel, openComputerSettings, setSnapshot, saveModelUpdates };
}

for (const dark of [false, true]) {
  it(`shows every reviewed OpenAI model after account login in the ${dark ? 'dark' : 'light'} theme`, async () => {
    const catalog = backendModelsForProviderType('openai').map(cloneFlowerModel);
    const profile = { schema_version: 1 as const, current_model_id: '', providers: [{ id: 'openai', type: 'openai' as const,
      auth_method: 'chatgpt' as const, account_id: 'test-account', models: [], model_selection: { selected_models: catalog.map(m => m.model_name),
        model_overrides: catalog.map(m => ({ model_name: m.model_name, reasoning_capability: {}, default_reasoning_selection: {} })) },
    }] };
    const snapshot: FlowerSettingsSnapshot = { ...settings(), model_profile: profile };
    const directory = { provider_defaults: providerDefaultsFixture, current_model_id: '', sources: [{ id: 'openai', kind: 'runtime_config' as const, state: 'ready' as const }],
      models: catalog.map(m => ({ id: `openai/${m.model_name}`, label: m.display_name || m.model_name, model_name: m.model_name,
        provider_id: 'openai', source: 'runtime_config' as const, state: 'ready' as const, web_search: { status: 'available' as const, reason: '' } })),
      provider_catalogs: { openai: catalog.map(m => ({ ...m, web_search: { status: 'available' as const, reason: '' } })) },
    };
    const { setSnapshot, saveModel } = await mount('zh-CN', 1000, dark, withFlowerModelDirectory(snapshot, directory));
    await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!);
    const rows = () => [...host.querySelectorAll<HTMLTableRowElement>('.flower-settings-provider-model-table tbody tr')];
    await expect.poll(() => rows().length).toBe(catalog.length);
    const checkDefaults = () => rows().forEach((row, i) => {
      expect(row.textContent).toContain(catalog[i].display_name);
      expect(row.cells[2].textContent).toBe(catalog[i].context_window!.toLocaleString('en-US'));
      expect(row.cells[3].textContent).toBe(catalog[i].max_output_tokens!.toLocaleString('en-US'));
      expect(row.querySelector('[data-web-search]')?.getAttribute('data-web-search')).toBe('available');
    });
    checkDefaults();
    expect(host.querySelectorAll('.flower-settings-provider-model-unavailable')).toHaveLength(0);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: host.querySelector('.flower-settings-providers-section')!, path: `__screenshots__/flower-openai-defaults-${dark ? 'dark' : 'light'}.png` });
    setSnapshot(withFlowerModelDirectory(snapshot, { ...directory, provider_catalogs: { openai: [] }, models: directory.models.map(m => ({ ...m, state: 'unavailable' })) }));
    await expect.poll(() => host.querySelectorAll('.flower-settings-provider-model-unavailable').length).toBe(catalog.length);
    checkDefaults();
    setSnapshot(withFlowerModelDirectory(snapshot, directory));
    await expect.poll(() => host.querySelectorAll('.flower-settings-provider-model-unavailable').length).toBe(0);
    checkDefaults();
    expect(saveModel).not.toHaveBeenCalled();
  });
}

it('opens a searchable model dialog with metadata and saves a selection', async () => {
  const { copy, saveModel } = await mount();
  const currentModel = host.querySelector<HTMLElement>('.flower-settings-current-model')!;
  expect(document.querySelector('.flower-model-selection-dialog')).toBeNull();
  expect(currentModel.textContent).toContain('DeepSeek V4 Flash Vision Exp');
  expect(currentModel.querySelector('.flower-settings-model-group')!.getBoundingClientRect().height).toBeLessThan(150);
  const edit = currentModel.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!;
  await userEvent.click(edit);
  await expect.element(page.getByRole('dialog', { name: copy.settings.changeModel })).toBeVisible();
  const dialog = document.querySelector<HTMLElement>('.flower-model-selection-dialog')!;
  const search = dialog.querySelector<HTMLInputElement>('input')!;
  await expect.poll(() => document.activeElement).toBe(search);
  expect(currentModel.textContent).toContain('DeepSeek V4 Flash Vision Exp');
  expect(dialog.querySelector('[aria-selected="true"]')?.textContent).toContain(copy.settings.currentModel);
  expect(dialog.textContent).toContain('1,000,000');
  expect(dialog.textContent).toContain('384,000');
  expect(dialog.textContent).toContain(copy.settings.imageInput);
  await userEvent.fill(search, 'DEEPSEEK pro');
  expect(dialog.querySelectorAll('[role="option"]')).toHaveLength(1);
  await userEvent.click(dialog.querySelector<HTMLButtonElement>('[data-model-id="deepseek/deepseek-v4-pro"]')!);
  await expect.poll(() => saveModel.mock.calls.length).toBe(1);
  expect(saveModel.mock.calls[0][0].model_profile?.current_model_id).toBe('deepseek/deepseek-v4-pro');
  await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
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
  await expect.element(page.getByRole('dialog', { name: copy.settings.changeModel })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
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
    expect(document.querySelector('.flower-model-selection-dialog')).toBeNull();
    const sections = [...frame.querySelectorAll<HTMLElement>(':scope > section')];
    expect(sections).toHaveLength(5);
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
    const providerDetails = frame.querySelector<HTMLDivElement>('.flower-settings-provider-details')!;
    providerDetails.parentElement!.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!.click();
    await expect.poll(() => providerDetails.dataset.state).toBe('open');
    expect(providerDetails.scrollWidth).toBeLessThanOrEqual(providerDetails.clientWidth);
    const modelTable = providerDetails.querySelector<HTMLTableElement>('table')!;
    const tableScroll = providerDetails.querySelector<HTMLElement>('.flower-settings-provider-table-scroll')!;
    expect(modelTable.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(tableScroll.clientWidth).toBeLessThanOrEqual(providerDetails.clientWidth);
    expect(modelTable.querySelector('th')?.textContent).toBe(copy.settings.dialog.modelName);
    const currentBadge = modelTable.querySelector<HTMLElement>('.flower-settings-provider-model-current')!;
    const modelHeading = modelTable.querySelector<HTMLElement>('.flower-settings-provider-model-heading')!;
    const modelName = modelHeading.querySelector<HTMLElement>('.flower-settings-provider-model-name')!;
    expect(modelHeading.contains(currentBadge)).toBe(true);
    expect(currentBadge.scrollWidth).toBeLessThanOrEqual(currentBadge.clientWidth);
    expect(currentBadge.getBoundingClientRect().height).toBeLessThanOrEqual(24);
    expect(currentBadge.querySelector('svg')).not.toBeNull();
    const nameBounds = modelName.getBoundingClientRect();
    const badgeBounds = currentBadge.getBoundingClientRect();
    expect(Math.abs(nameBounds.top + nameBounds.height / 2 - badgeBounds.top - badgeBounds.height / 2)).toBeLessThan(1);
    expect(modelName.title).toBe('DeepSeek V4 Flash Vision Exp');
    if (width >= 1000) expect(modelName.scrollWidth).toBeLessThanOrEqual(modelName.clientWidth);
    expect(badgeBounds.right).toBeLessThanOrEqual(tableScroll.getBoundingClientRect().right);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && locale === 'zh-CN') {
      await page.screenshot({ element: frame.querySelector('.flower-settings-providers-section')!, path: `__screenshots__/flower-provider-model-table${dark ? '-dark' : ''}-zh-CN.png` });
    }
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && width === 320) {
      await page.screenshot({ element: frame.querySelector('.flower-settings-providers-section')!, path: '__screenshots__/flower-provider-model-table-narrow.png' });
    }
    if (width < 760) {
      expect(tableScroll.scrollWidth).toBeGreaterThan(tableScroll.clientWidth);
      tableScroll.focus();
      await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => tableScroll.scrollLeft).toBeGreaterThan(0);
      expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
      tableScroll.blur();
      tableScroll.scrollTo({ left: 0, behavior: 'instant' });
      await expect.poll(() => tableScroll.scrollLeft).toBe(0);
    }
    providerDetails.parentElement!.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!.click();
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
    await expect.element(page.getByRole('dialog', { name: copy.settings.changeModel })).toBeVisible();
    const dialog = document.querySelector<HTMLElement>('.flower-model-selection-dialog')!;
    const search = dialog.querySelector<HTMLInputElement>('input')!;
    expect(getComputedStyle(search).fontSize).toBe('12px');
    expect(modelField.scrollWidth).toBeLessThanOrEqual(modelField.clientWidth);
    await expect.poll(() => document.activeElement).toBe(search);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && locale === 'zh-CN' && !dark) {
      await expect.poll(() => getComputedStyle(dialog).opacity).toBe('1');
      await page.screenshot({ element: dialog, path: '__screenshots__/flower-model-dialog-zh-CN.png' });
    }
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
    expect(document.activeElement).toBe(edit);
  });
}

it('aligns section headings separately from controls and discloses provider detail on demand', async () => {
  const { copy } = await mount();
  const sections = [...host.querySelectorAll<HTMLElement>('.flower-settings-frame > section')];
  expect(sections.map(section => section.getAttribute('aria-label'))).toEqual([
    copy.settings.currentModel, copy.settings.providersTitle, copy.settings.defaultPermissionTitle, copy.settings.computerUseTitle,
    copy.settings.modelCatalogAutoUpdateTitle,
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
  const details = host.querySelector<HTMLDivElement>('.flower-settings-provider-details')!;
  expect(details.dataset.state).toBe('closed');
  const summary = details.parentElement!.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!;
  expect(summary.textContent).toContain('3');
  summary.focus();
  await userEvent.keyboard('{Enter}');
  expect(summary.getAttribute('aria-expanded')).toBe('true');
  expect(details.textContent).toContain('deepseek-v4-flash-vision-exp');
  expect(details.textContent).toContain(copy.settings.dialog.webSearch);
  await userEvent.keyboard('{Enter}');
  expect(summary.getAttribute('aria-expanded')).toBe('false');
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
  expect(getComputedStyle(dialog.querySelector('.flower-provider-introduction p')!).fontSize).toBe('14px');
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
  await expect.element(page.getByRole('dialog', { name: copy.settings.changeModel })).toBeVisible();
  await expect.element(page.getByRole('option', { name: 'DeepSeek / deepseek-v4-pro', exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByRole('option', { name: 'Ollama Qwen 3.8 27B / qwen3.8:27b', exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
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


it('searches provider names and wire identities, reports empty results, and resets after dismissal', async () => {
  let initial = settings();
  initial = { ...initial, model_profile: { ...initial.model_profile!, providers: initial.model_profile!.providers.map((provider, index) => index === 1 ? { ...provider, models: [{ model_name: 'local-alias', wire_model_name: 'qwen3.8:27b', display_name: 'Local assistant', context_window: 128000 }] } : provider) } };
  const { copy, saveModel } = await mount('en-US', 1000, false, initial);
  const edit = host.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!;
  await userEvent.click(edit);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(document.querySelector('.flower-model-selection-search input'));
  const search = document.querySelector<HTMLInputElement>('.flower-model-selection-search input')!;
  await userEvent.fill(search, 'OLLAMA qwen3.8:27b');
  expect(document.querySelectorAll('.flower-model-selection-option')).toHaveLength(1);
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, isComposing: true }));
  expect(document.activeElement).toBe(search);
  expect(saveModel).not.toHaveBeenCalled();
  await userEvent.fill(search, 'missing model');
  expect(document.querySelectorAll('.flower-model-selection-option')).toHaveLength(0);
  expect(document.querySelector('.flower-model-selection-empty')?.textContent).toBe(copy.settings.dialog.catalog.empty);
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(saveModel).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole('button', { name: copy.settings.closeModelSelection }));
  await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
  expect(document.activeElement).toBe(edit);
  await userEvent.click(edit);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(document.querySelector('.flower-model-selection-search input'));
  expect(document.querySelector<HTMLInputElement>('.flower-model-selection-search input')?.value).toBe('');
  expect(document.querySelectorAll('.flower-model-selection-option')).toHaveLength(4);
  await userEvent.click(document.querySelector<HTMLElement>('[data-floe-dialog-backdrop]')!, { position: { x: 8, y: 8 } });
  await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
  expect(document.activeElement).toBe(edit);
  expect(saveModel).not.toHaveBeenCalled();
});

it('navigates the model dialog by keyboard and leaves the current selection unchanged on reselect', async () => {
  const { saveModel } = await mount();
  const edit = host.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!;
  await userEvent.click(edit);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(document.querySelector('.flower-model-selection-search input'));
  expect(document.querySelectorAll('.flower-model-selection-option[tabindex="0"]')).toHaveLength(1);
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
  expect(saveModel).not.toHaveBeenCalled();
  await userEvent.click(edit);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(document.querySelector('.flower-model-selection-search input'));
  await userEvent.keyboard('{ArrowDown}{End}');
  expect(document.activeElement?.getAttribute('data-model-id')).toBe('local/qwen3.8:27b');
  await userEvent.keyboard('{Home}{ArrowUp}');
  expect(document.activeElement?.getAttribute('data-model-id')).toBe('local/qwen3.8:27b');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => saveModel.mock.calls.length).toBe(1);
  expect(saveModel.mock.lastCall?.[0].model_profile?.current_model_id).toBe('local/qwen3.8:27b');
  await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
  expect(document.activeElement).toBe(edit);
});

it.each([360, 1000])('scrolls large model catalogs within a %ipx dialog while keeping search visible', async width => {
  let initial = settings();
  initial = { ...initial, model_profile: { ...initial.model_profile!, providers: initial.model_profile!.providers.map((provider, index) => index === 0 ? { ...provider, models: [...provider.models,
    ...Array.from({ length: 30 }, (_, index) => ({ model_name: `catalog-model-${index}`, display_name: `Catalog model ${index}`, context_window: 1000000, max_output_tokens: 128000, input_modalities: ['text', 'image'] })),
    { model_name: 'unavailable', unavailable: true }] } : provider) } };
  const { saveModel } = await mount('zh-CN', width, false, initial);
  await page.viewport(width, 720);
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(document.querySelector('.flower-model-selection-search input'));
  const dialog = document.querySelector<HTMLElement>('.flower-model-selection-dialog')!;
  const list = dialog.querySelector<HTMLElement>('.flower-model-selection-list')!;
  const search = dialog.querySelector<HTMLInputElement>('input')!;
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(720);
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && width === 360) await page.screenshot({ element: dialog, path: '__screenshots__/flower-model-dialog-narrow.png' });
  expect(dialog.querySelector('[data-model-id="deepseek/unavailable"]')).toBeNull();
  for (const row of dialog.querySelectorAll<HTMLElement>('[role="option"]')) expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  const searchTop = search.getBoundingClientRect().top;
  await userEvent.keyboard('{ArrowUp}');
  expect(document.activeElement?.getAttribute('data-model-id')).toBe('local/qwen3.8:27b');
  expect(list.scrollTop).toBeGreaterThan(0);
  expect(Math.abs(search.getBoundingClientRect().top - searchTop)).toBeLessThan(2);
  await userEvent.click(search);
  await userEvent.fill(search, 'catalog-model-29');
  expect(dialog.querySelectorAll('[role="option"]')).toHaveLength(1);
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => saveModel.mock.lastCall?.[0].model_profile?.current_model_id).toBe('deepseek/catalog-model-29');
  await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
});
it('compares each provider model in a full-width table with its own capability data', async () => {
  const snapshot = settings();
  const initial = { ...snapshot, model_profile: { ...snapshot.model_profile!, providers: snapshot.model_profile!.providers.map((provider, index) => index === 0 ? { ...provider, models: provider.models.map((model, modelIndex) => ({ ...model,
    web_search: modelIndex === 0 ? { status: 'available' as const, reason: '' } : modelIndex === 1 ? { status: 'unavailable' as const, reason: 'unsupported' } : undefined,
    unavailable: modelIndex === 2,
  })) } : provider) } };
  const { copy, saveModel } = await mount('en-US', 1000, false, initial);
  const provider = host.querySelector<HTMLElement>('.flower-settings-provider-card')!;
  const details = provider.querySelector<HTMLDivElement>('.flower-settings-provider-details')!;
  const summary = provider.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!;
  await userEvent.click(summary);
  await expect.poll(() => details.dataset.state).toBe('open');
  const table = details.querySelector<HTMLTableElement>('table')!;
  expect(table).not.toBeNull();
  expect([...table.querySelectorAll('thead th')].map(header => header.textContent)).toEqual([
    copy.settings.dialog.modelName, copy.settings.inputCapabilities, copy.settings.dialog.contextWindow, copy.settings.dialog.maxOutput, copy.settings.dialog.webSearch,
  ]);
  expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(5);
  const rows = [...table.querySelectorAll('tbody tr')];
  expect(rows).toHaveLength(3);
  expect(rows[0].querySelector('th[scope="row"]')?.textContent).toContain('DeepSeek V4 Flash Vision Exp');
  expect(rows[0].querySelector('.flower-settings-provider-model-heading .flower-settings-provider-model-current')?.textContent).toBe(copy.settings.currentModel);
  expect(rows[0].textContent).toContain(copy.settings.imageInput);
  expect(rows[0].textContent).toContain('1,000,000');
  expect(rows[0].textContent).toContain('384,000');
  expect(rows[0].textContent).toContain(copy.settings.dialog.catalog.searchAvailable);
  expect(rows[1].textContent).not.toContain(copy.settings.imageInput);
  expect(rows[1].textContent).toContain(copy.settings.dialog.catalog.searchUnsupported);
  expect(rows[1].querySelectorAll('td')[1].textContent).toBe('—');
  expect(rows[2].textContent).toContain(copy.settings.dialog.catalog.unavailableModel);
  expect(rows[2].textContent).toContain(copy.settings.dialog.catalog.searchPending);
  expect(details.getBoundingClientRect().width).toBeGreaterThan(provider.getBoundingClientRect().width * 0.95);
  expect(table.getBoundingClientRect().right).toBeGreaterThan(provider.querySelector('.flower-settings-provider-actions')!.getBoundingClientRect().left);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: host.querySelector('.flower-settings-providers-section')!, path: '__screenshots__/flower-provider-model-table.png' });
  await userEvent.click(summary);
  await expect.poll(() => details.dataset.state).toBe('closed');
  expect(summary.getAttribute('aria-expanded')).toBe('false');
  expect(details.getBoundingClientRect().height).toBeLessThan(32);
  expect(saveModel).not.toHaveBeenCalled();
});


it('confirms final account removal as a draft and preserves it through account updates', async () => {
  const initial: FlowerSettingsSnapshot = { ...settings(), auth_capabilities: { openai_chatgpt: { available: true, binding_id: 'local' } }, model_profile: { ...settings().model_profile!, providers: [{ id: 'openai', type: 'openai', auth_method: 'chatgpt', account_id: 'saved', model_selection: { selected_models: ['gpt-6.1-sol'] }, models: [{ model_name: 'gpt-6.1-sol' }] }], current_model_id: 'openai/gpt-6.1-sol' }, chatgpt_accounts: { openai: { account_id: 'saved', email: 'person@example.com', state: 'ready', welcome_acknowledged: true, active_task_count: 1 } } };
  const { copy, saveModel, setSnapshot } = await mount('zh-CN', 390, true, initial);
  await userEvent.click(page.getByRole('button', { name: copy.settings.removeProvider, exact: true }));
  const confirm = page.getByRole('dialog', { name: copy.settings.removeProvider, exact: true });
  await expect.element(confirm.getByText(copy.settings.dialog.chatGPT.removeAccountOnSaveImpact(1), { exact: true })).toBeVisible();
  await userEvent.keyboard('{Escape}');
  expect(saveModel.mock.calls).toHaveLength(0);
  await userEvent.click(page.getByRole('button', { name: copy.settings.removeProvider, exact: true }));
  await userEvent.click(confirm.getByRole('button', { name: copy.settings.removeProvider, exact: true }));
  setSnapshot({ ...initial, chatgpt_accounts: { openai: { ...initial.chatgpt_accounts!.openai, state: 'temporarily_unavailable' } } });
  expect(host.querySelectorAll('.flower-settings-provider-card')).toHaveLength(0);
  expect(saveModel.mock.calls).toHaveLength(0);
});

it('keeps saved accounts out of the overview and recovers them only inside the OpenAI editor', async () => {
  const saved = { account_id: 'saved-unbound', email: 'saved@example.com', state: 'plan_permission_required' as const, welcome_acknowledged: true };
  const auth = vi.fn<FlowerChatGPTAuth>(async () => ({}));
  const load = vi.fn(async () => ({ accounts: {}, saved_accounts: [saved] }));
  const { copy, saveModel } = await mount('zh-CN', 1000, false, { defaults: { permission_type: 'approval_required' }, model_profile: null, provider_secrets: [], auth_capabilities: { openai_chatgpt: { available: true, binding_id: 'local' } } }, auth, load);
  expect(host.textContent).not.toContain(saved.email);
  expect(load).not.toHaveBeenCalled();
  for (let reopen = 0; reopen < 2; reopen++) {
    await userEvent.click(page.getByRole('button', { name: copy.settings.addProvider, exact: true }));
    await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
    await expect.element(page.getByRole('button', { name: copy.settings.dialog.chatGPT.savedAccounts, exact: true })).toHaveTextContent(saved.email);
    await expect.element(page.getByRole('button', { name: copy.settings.dialog.chatGPT.continue, exact: true })).toBeEnabled();
    await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
    expect(host.textContent).not.toContain(saved.email);
  }
  expect(auth).not.toHaveBeenCalled();
  expect(saveModel).not.toHaveBeenCalled();
});

it('keeps account-list failure and recovery within the editor and clears it after capability loss', async () => {
  const saved = { account_id: 'unbound', email: 'local@example.com', state: 'ready' as const, welcome_acknowledged: true };
  let fail = true;
  const load = vi.fn(async () => { if (fail) throw new Error('Unavailable'); return { accounts: {}, saved_accounts: [saved] }; });
  const initial: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' }, model_profile: null, provider_secrets: [], auth_capabilities: { openai_chatgpt: { available: true, binding_id: 'local' } } };
  const { copy, setSnapshot } = await mount('en-US', 340, false, initial, vi.fn(async () => ({})), load);
  expect(load).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole('button', { name: copy.settings.addProvider, exact: true }));
  await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
  await expect.element(page.getByText(copy.settings.dialog.chatGPT.accountsUnavailable, { exact: true })).toBeVisible();
  fail = false;
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.chatGPT.retry, exact: true }));
  await expect.element(page.getByRole('button', { name: copy.settings.dialog.chatGPT.savedAccounts, exact: true })).toHaveTextContent(saved.email);
  setSnapshot({ ...initial, auth_capabilities: { openai_chatgpt: { available: false } } });
  await expect.poll(() => document.querySelector('.flower-provider-account')).toBeNull();
});

it('ignores a saved-account response when the trusted binding changes while the editor is open', async () => {
  type Accounts = Awaited<ReturnType<NonNullable<FlowerSurfaceAdapter['loadChatGPTAccounts']>>>;
  let finish!: (result: Accounts) => void;
  const load = vi.fn(() => new Promise<Accounts>(resolve => { finish = resolve; }));
  const initial: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' }, model_profile: null, provider_secrets: [], auth_capabilities: { openai_chatgpt: { available: true, binding_id: 'first' } } };
  const { copy, setSnapshot } = await mount('en-US', 1000, false, initial, vi.fn(async () => ({})), load);
  expect(load).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole('button', { name: copy.settings.addProvider, exact: true }));
  await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
  await expect.poll(() => load.mock.calls.length).toBe(1);
  const first = finish;
  setSnapshot({ ...initial, auth_capabilities: { openai_chatgpt: { available: true, binding_id: 'second' } } });
  await expect.poll(() => document.querySelector('.flower-provider-dialog')).toBeNull();
  first({ accounts: {}, saved_accounts: [{ account_id: 'old', email: 'stale@example.com', state: 'ready', welcome_acknowledged: true }] });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(host.textContent).not.toContain('stale@example.com');
});
