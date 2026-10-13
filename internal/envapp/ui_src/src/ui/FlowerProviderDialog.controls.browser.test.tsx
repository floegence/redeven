import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { providerDefaultsFixture } from '../../../../flower_ui/testing/providerCatalogFixture';
import type { FlowerChatGPTAuth, FlowerChatGPTAccount } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';
import { SUPPORTED_LOCALES, type RedevenLocale } from './i18n/localeMeta';

const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
let dispose: (() => void) | undefined;
let host: HTMLElement;
let style: HTMLStyleElement;
const media = commands as unknown as { emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
afterEach(async () => { dispose?.(); host?.remove(); style?.remove(); localStorage.clear(); await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); });

async function mount(surface: 'desktop' | 'env', theme = 'porcelain-light', auth?: FlowerChatGPTAuth, width = 1280, locale: RedevenLocale = 'en-US', account?: FlowerChatGPTAccount) {
  await page.viewport(width, 900);
  const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
  const localizedCopy = createLocalizedFlowerSurfaceCopy({ locale,
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
  }).settings.dialog;
  style = document.createElement('style');
  style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS;
  document.head.append(style);
  host = document.createElement('div'); document.body.append(host);
  function Theme() {
    const themeContext = useTheme();
    onMount(() => themeContext.selectShellTheme(theme.includes('dark') ? 'dark' : 'light', theme));
    return null;
  }
  const models = [
    { model_name: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', context_window: 1050000, max_output_tokens: 128000, input_modalities: ['text', 'image'] },
    { model_name: 'gpt-6-sol', display_name: 'GPT-6 Sol', context_window: 1050000, max_output_tokens: 128000, input_modalities: ['text', 'image'] },
    { model_name: 'gpt-6-luna', display_name: 'GPT-6 Luna', context_window: 1050000, max_output_tokens: 128000, input_modalities: ['text', 'image'] },
  ];
  const discover = vi.fn(async () => ({ models }));
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets, defaultSurfaceStyle: 'soft-neumorphic' } }}><Theme /><FlowerProviderDialog
    open mode="create" copy={localizedCopy} providerDefaults={providerDefaultsFixture} provider={{ id: 'openai', type: 'openai', models: account ? [models[0]] : [], ...(account ? { auth_method: 'chatgpt' as const, account_id: account.account_id, catalog_models: models } : {}) }} chatGPTAvailable chatGPTBindingID="local" chatGPTAccount={account}
    chatGPTAuth={auth ?? vi.fn(async () => ({ id: 'attempt', state: 'waiting' }))} onDiscoverModels={discover}
    keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} /></FloeProvider>, host);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
  await expect.poll(() => document.querySelector('[role=dialog]')!.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
  return { discover, copy: localizedCopy, dialog: document.querySelector<HTMLElement>('.flower-provider-dialog')! };
}

function color(value: string) {
  const context = document.createElement('canvas').getContext('2d')!;
  context.fillStyle = value; context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => channel / 255);
}
function contrast(left: string, right: string) {
  const luminance = (value: string) => color(value).reduce((sum, channel, index) => sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(left), b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const surface of ['desktop', 'env'] as const) {
  it(`presents a compact connected account and aligns first-use confirmation with its notice in ${surface}`, async () => {
    const { dialog, copy: localized } = await mount(surface, 'porcelain-light', undefined, 1280, 'zh-CN', {
      account_id: 'verified', email: 'person@example.com', state: 'ready', welcome_acknowledged: false,
    });
    const account = dialog.querySelector<HTMLElement>('.flower-provider-account')!;
    const notice = dialog.querySelector<HTMLElement>('.flower-provider-account-welcome')!;
    const confirm = page.getByRole('button', { name: localized.chatGPT.welcomeConfirm, exact: true }).element() as HTMLButtonElement;
    const identity = account.querySelector<HTMLElement>('.flower-provider-account-heading')!;
    const actions = account.querySelector<HTMLElement>('.flower-provider-account-actions')!;
    expect(account.getBoundingClientRect().height).toBeLessThan(160);
    expect(account.contains(notice)).toBe(false);
    expect(notice.getAttribute('role')).toBe('note');
    expect(notice.querySelector('h4')).toBeNull();
    expect(Math.abs(confirm.getBoundingClientRect().right - notice.getBoundingClientRect().right)).toBeLessThanOrEqual(17);
    expect(actions.getBoundingClientRect().left).toBeCloseTo(identity.getBoundingClientRect().left, 0);
    expect(actions.getBoundingClientRect().height).toBeLessThanOrEqual(48);
    const primary = account.querySelector<HTMLButtonElement>('.flower-provider-account-primary')!;
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-connected-${surface}-notice-zh-CN.png` });
    confirm.focus(); confirm.click();
    expect(document.activeElement).toBe(primary);
    const viewport = dialog.querySelector<HTMLElement>('.flower-provider-account-notice')!;
    expect(viewport.getAttribute('aria-hidden')).toBe('true');
    expect(viewport.inert).toBe(true);
    expect(viewport.getAnimations().some(animation => animation.playState === 'running')).toBe(true);
    await expect.poll(() => dialog.querySelector('.flower-provider-account-welcome')).toBeNull();
    expect(account.getBoundingClientRect().height).toBeLessThan(160);
    expect(account.querySelector('.flower-provider-account-primary')).toBe(primary);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-connected-${surface}-summary-zh-CN.png` });
  });

  it(`acknowledges the plan notice with the keyboard and skips collapse motion when reduced motion is enabled in ${surface}`, async () => {
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    const { dialog, copy: localized } = await mount(surface, 'porcelain-light', undefined, 1280, 'en-US', {
      account_id: 'verified', email: 'person@example.com', state: 'ready', welcome_acknowledged: false,
    });
    const primary = dialog.querySelector<HTMLButtonElement>('.flower-provider-account-primary')!;
    const confirm = page.getByRole('button', { name: localized.chatGPT.welcomeConfirm, exact: true }).element() as HTMLButtonElement;
    confirm.focus();
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(primary);
    expect(dialog.querySelector('.flower-provider-account-welcome')).toBeNull();
    expect(dialog.querySelector('.flower-provider-account-notice')).toBeNull();
    expect(dialog.getAnimations({ subtree: true }).some(animation => animation.playState === 'running')).toBe(false);
  });

  for (const locale of SUPPORTED_LOCALES) it(`keeps connected account actions and confirmation readable at 390px in ${surface} ${locale}`, async () => {
    const { dialog, copy: localized } = await mount(surface, 'porcelain-dark', undefined, 390, locale, {
      account_id: 'verified', email: 'a.long.account.name@example.com', state: 'ready', welcome_acknowledged: false,
    });
    const account = dialog.querySelector<HTMLElement>('.flower-provider-account')!;
    const notice = dialog.querySelector<HTMLElement>('.flower-provider-account-welcome')!;
    for (const element of [account, notice, ...account.querySelectorAll<HTMLElement>('button, a'), notice.querySelector<HTMLButtonElement>('button')!]) {
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
      expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(dialog.getBoundingClientRect().right);
    }
    expect(notice.querySelector('p')?.textContent).toBe(localized.chatGPT.welcome);
    const primary = account.querySelector<HTMLButtonElement>('.flower-provider-account-primary')!;
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && locale === 'zh-CN') await page.screenshot({ element: dialog, path: `__screenshots__/flower-connected-${surface}-narrow-dark-zh-CN.png` });
    await userEvent.click(page.getByRole('button', { name: localized.chatGPT.welcomeConfirm, exact: true }));
    expect(document.activeElement).toBe(primary);
    await expect.poll(() => dialog.querySelector('.flower-provider-account-welcome')).toBeNull();
    expect(dialog.querySelector('.flower-provider-account-primary')).toBe(primary);
  });

  it(`groups ChatGPT sign-in identity, guidance and its primary action in ${surface}`, async () => {
    const { dialog, copy: localized } = await mount(surface);
    const panel = dialog.querySelector<HTMLElement>('.flower-provider-account')!;
    expect(panel.dataset.state).toBe('idle');
    expect(panel.querySelector('h4')).not.toBeNull();
    expect(panel.querySelector('.flower-provider-account-description')?.textContent).toBe(localized.chatGPT.planPermission);
    const primary = panel.querySelector<HTMLButtonElement>('.flower-provider-account-primary')!;
    expect(primary).not.toBeNull();
    expect(primary.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    expect(panel.getBoundingClientRect().width).toBeGreaterThan(primary.getBoundingClientRect().width);
  });

  it(`presents each authorization stage and keeps confirmation and cancellation focus usable in ${surface}`, async () => {
    type Result = Awaited<ReturnType<FlowerChatGPTAuth>>;
    let start!: (result: Result) => void;
    let status!: (result: Result) => void;
    const auth = vi.fn<FlowerChatGPTAuth>(async action => action === 'start' ? new Promise(resolve => { start = resolve; }) : action === 'status' ? new Promise(resolve => { status = resolve; }) : {});
    const { dialog, copy: localized, discover } = await mount(surface, 'porcelain-light', auth, 1280, 'zh-CN');
    const panel = dialog.querySelector<HTMLElement>('.flower-provider-account')!;
    const primary = panel.querySelector<HTMLButtonElement>('.flower-provider-account-primary')!;
    const screenshot = async (state: string) => {
      await expect.poll(() => !['opening', 'closing'].includes(dialog.querySelector<HTMLElement>('.flower-provider-account-notice')?.dataset.state ?? '')).toBe(true);
      if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-auth-${surface}-${state}-zh-CN.png` });
    };
    await screenshot('idle');
    await userEvent.click(primary);
    expect(panel.dataset.state).toBe('preparing');
    expect(panel.querySelector('h4')?.textContent).toBe(localized.chatGPT.preparing);
    expect(primary.disabled).toBe(true);
    await expect.poll(() => document.activeElement?.textContent).toBe(localized.chatGPT.cancel);
    await screenshot('preparing');
    start({ id: 'attempt', state: 'waiting' });
    await expect.poll(() => panel.dataset.state).toBe('waiting');
    expect(panel.querySelector('.flower-provider-account-description')?.textContent).toBe(localized.chatGPT.waitingDescription);
    await screenshot('waiting');
    await expect.poll(() => typeof status).toBe('function');
    const firstStatus = status;
    status({ id: 'attempt', state: 'verifying' });
    await expect.poll(() => panel.dataset.state).toBe('verifying');
    await screenshot('verifying');
    await expect.poll(() => status !== firstStatus).toBe(true);
    status({ id: 'attempt', state: 'ready', account: { account_id: 'verified', email: 'person@example.com', state: 'ready', welcome_acknowledged: false } });
    await expect.poll(() => panel.dataset.state).toBe('connected');
    expect(panel.querySelector('h4')?.textContent).toBe('person@example.com');
    expect(primary).toBe(panel.querySelector('.flower-provider-account-primary'));
    expect(discover).toHaveBeenCalledTimes(1);
    await screenshot('confirmation');
    await userEvent.click(page.getByRole('button', { name: localized.chatGPT.welcomeConfirm, exact: true }));
    expect(document.activeElement).toBe(primary);
    await expect.poll(() => dialog.querySelector('.flower-provider-account-welcome')).toBeNull();
    await screenshot('connected');
    await userEvent.click(primary);
    await expect.poll(() => document.activeElement?.textContent).toBe(localized.chatGPT.cancel);
    await userEvent.click(page.getByRole('button', { name: localized.chatGPT.cancel, exact: true }));
    expect(document.activeElement).toBe(primary);
    expect(primary.disabled).toBe(false);
    const canceledStart = start;
    canceledStart({ id: 'canceled', state: 'waiting' });
    await expect.poll(() => auth.mock.calls.some(([action, input]) => action === 'cancel' && input.attempt_id === 'canceled')).toBe(true);
    expect(panel.dataset.state).toBe('connected');
  });

  it(`keeps failure and retry in the same connection panel in ${surface}`, async () => {
    const auth = vi.fn<FlowerChatGPTAuth>(async action => action === 'start' ? { id: 'attempt', state: 'waiting' } : action === 'status' ? { state: 'failed' } : {});
    const { dialog, copy: localized, discover } = await mount(surface, 'porcelain-light', auth, 1280, 'zh-CN');
    const panel = dialog.querySelector<HTMLElement>('.flower-provider-account')!;
    const primary = panel.querySelector<HTMLButtonElement>('.flower-provider-account-primary')!;
    await userEvent.click(primary);
    await expect.poll(() => panel.dataset.state).toBe('failed');
    expect(panel.querySelector('[role=alert]')?.textContent).toBe(localized.chatGPT.signInFailed);
    expect(document.activeElement).toBe(primary);
    expect(primary.disabled).toBe(false);
    expect(dialog.querySelector('.flower-provider-models')).toBeNull();
    expect(discover).not.toHaveBeenCalled();
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-auth-${surface}-failed-zh-CN.png` });
    await userEvent.click(primary);
    await expect.poll(() => auth.mock.calls.filter(([action]) => action === 'start').length).toBe(2);
  });

  for (const locale of SUPPORTED_LOCALES) it(`keeps account guidance and actions inside a narrow ${surface} dialog in ${locale}`, async () => {
    const { dialog } = await mount(surface, 'porcelain-dark', undefined, 390, locale);
    const panel = dialog.querySelector<HTMLElement>('.flower-provider-account')!;
    const primary = panel.querySelector<HTMLButtonElement>('.flower-provider-account-primary')!;
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    expect(primary.scrollWidth).toBeLessThanOrEqual(primary.clientWidth);
    await userEvent.click(primary);
    await expect.poll(() => panel.dataset.state).toBe('waiting');
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    expect(primary.scrollWidth).toBeLessThanOrEqual(primary.clientWidth);
    for (const button of panel.querySelectorAll('button')) expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1' && locale === 'zh-CN') await page.screenshot({ element: dialog, path: `__screenshots__/flower-auth-${surface}-waiting-narrow-zh-CN.png` });
  });

  it(`aligns every brand and provider label in ${surface}, including span-based SVG brands`, async () => {
    await mount(surface);
    const rows = [...document.querySelectorAll<HTMLButtonElement>('.flower-provider-picker-options > button')];
    const labels = rows.map(row => [...row.children].find(child => child.tagName === 'SPAN' && !child.hasAttribute('data-flower-provider-brand') && !child.querySelector('[data-flower-provider-brand]') && child.textContent!.trim())!);
    const lefts = labels.map(label => label.getBoundingClientRect().left);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThan(1);
    for (const row of rows) {
      const brand = row.querySelector('[data-flower-provider-brand]')!.getBoundingClientRect();
      expect(brand.width).toBeCloseTo(20, 0);
      expect(brand.height).toBeCloseTo(20, 0);
    }
  });

  for (const theme of surface === 'desktop' ? ['porcelain-light', 'porcelain-dark', 'hc-light', 'hc-dark'] : ['porcelain-light', 'porcelain-dark']) {
    it(`makes authentication selection unmistakable in ${surface} ${theme}`, async () => {
      const { dialog } = await mount(surface, theme);
      const account = page.getByRole('button', { name: copy.chatGPT.account, exact: true }).element() as HTMLButtonElement;
      const key = page.getByRole('button', { name: copy.apiKey, exact: true }).element() as HTMLButtonElement;
      const selected = getComputedStyle(account), unselected = getComputedStyle(key);
      expect(contrast(selected.color, selected.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(selected.backgroundColor, unselected.backgroundColor)).toBeGreaterThanOrEqual(3);
      await userEvent.click(key);
      await expect.poll(() => key.getAttribute('aria-pressed')).toBe('true');
      await expect.poll(() => contrast(getComputedStyle(key).backgroundColor, getComputedStyle(account).backgroundColor)).toBeGreaterThanOrEqual(3);
      expect(document.activeElement).toBe(key);
      await expect.poll(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
      if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-controls-${surface}-${theme}.png` });
    });
  }

  it(`reveals the catalog only after authorization is ready and keeps repeated selection stable in ${surface}`, async () => {
    let finish!: (result: Awaited<ReturnType<FlowerChatGPTAuth>>) => void;
    const auth = vi.fn<FlowerChatGPTAuth>(async action => action === 'start' ? { id: 'attempt', state: 'waiting' } : action === 'status' ? new Promise(resolve => { finish = resolve; }) : {});
    const { dialog, discover } = await mount(surface, 'porcelain-light', auth);
    expect(dialog.querySelector('.flower-provider-models')).toBeNull();
    const provider = document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!;
    const editor = dialog.querySelector('.flower-provider-editor');
    await userEvent.click(provider);
    expect(dialog.querySelector('.flower-provider-editor')).toBe(editor);
    await expect.element(page.getByRole('button', { name: copy.chatGPT.continue, exact: true })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: copy.chatGPT.continue, exact: true }));
    await expect.poll(() => typeof finish).toBe('function');
    expect(dialog.querySelector('.flower-provider-models')).toBeNull();
    expect(discover).not.toHaveBeenCalled();
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-controls-${surface}-waiting.png` });
    finish({ id: 'attempt', state: 'ready', account: { account_id: 'account', email: 'person@example.com', state: 'ready', welcome_acknowledged: true } });
    await expect.element(page.getByRole('checkbox', { name: 'GPT-6.1 Sol', exact: true })).toBeVisible();
    expect(discover).toHaveBeenCalledTimes(1);
    const checkbox = document.querySelector('input[type=checkbox]');
    await userEvent.click(checkbox!.closest('label')!);
    await userEvent.click(page.getByRole('button', { name: copy.chatGPT.account, exact: true }));
    expect(dialog.querySelector('input[type=checkbox]')).toBe(checkbox);
    expect(auth.mock.calls.some(([action]) => action === 'cancel')).toBe(false);
    await expect.poll(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-controls-${surface}-ready.png` });
  });
}

for (const [surface, width, theme] of [['desktop', 1280, 'porcelain-light'], ['desktop', 390, 'porcelain-dark'], ['env', 390, 'porcelain-light']] as const) {
  it(`guides API credential entry and retains deliberate selection in ${surface} at ${width}px`, async () => {
    const { dialog, copy: localized } = await mount(surface, theme, undefined, width, 'zh-CN');
    const key = page.getByRole('button', { name: localized.apiKey, exact: true });
    await userEvent.click(key);
    expect(dialog.querySelector('.flower-provider-models')).toBeNull();
    await userEvent.fill(page.getByPlaceholder(localized.pasteAPIKey), 'test-key');
    const checkbox = dialog.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    await userEvent.click(checkbox.closest('label')!);
    const picker = dialog.querySelector<HTMLElement>('.flower-provider-picker')!;
    const rect = picker.getBoundingClientRect();
    await userEvent.click(key);
    expect(dialog.querySelector('input[type=checkbox]')).toBe(checkbox);
    expect(checkbox.checked).toBe(true);
    expect(picker.getBoundingClientRect().top).toBe(rect.top);
    expect(dialog.scrollWidth).toBe(dialog.clientWidth);
    const editor = dialog.querySelector<HTMLElement>('.flower-provider-editor')!;
    expect(editor.scrollWidth).toBe(editor.clientWidth);
    await expect.poll(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-controls-${surface}-${width}-zh-CN.png` });
    await userEvent.fill(page.getByPlaceholder(localized.pasteAPIKey), '');
    expect(dialog.querySelector('.flower-provider-models')).toBeNull();
    await userEvent.fill(page.getByPlaceholder(localized.pasteAPIKey), 'test-key');
    expect(dialog.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-anthropic]')!);
    expect(dialog.querySelector<HTMLInputElement>('input[type=password]')!.value).toBe('');
    expect(dialog.querySelector('.flower-provider-models')).toBeNull();
  });
}
