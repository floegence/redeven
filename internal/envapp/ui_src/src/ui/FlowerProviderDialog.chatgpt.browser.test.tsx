import '../index.css';
import './flower-feature.css';

import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import type { FlowerChatGPTAuth, FlowerProviderDraft } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';
import type { RedevenLocale } from './i18n/localeMeta';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.classList.remove('dark'); });

async function mount(local: boolean, locale: RedevenLocale, width: number, dark: boolean, provider?: FlowerProviderDraft, auth?: FlowerChatGPTAuth) {
  await page.viewport(width, 900);
  const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
  const copy = createLocalizedFlowerSurfaceCopy({ locale,
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
  }).settings.dialog;
  const [open, setOpen] = createSignal(true);
  const [binding, setBinding] = createSignal('verified-local-channel');
  host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
  function Theme() { const theme = useTheme(); onMount(() => theme.selectShellTheme(dark ? 'dark' : 'light', dark ? 'porcelain-dark' : 'porcelain-light')); return null; }
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><Theme /><FlowerProviderDialog
    open={open()} mode={provider ? 'edit' : 'create'} provider={provider ?? { id: 'openai', type: 'openai', models: [] }}
    copy={copy} chatGPTAvailable={local} chatGPTBindingID={binding()} chatGPTAccount={provider?.chatgpt_account}
    chatGPTAuth={auth ?? vi.fn(async () => ({ id: 'attempt', state: 'waiting' }))}
    onDiscoverModels={async () => ({ models: [{ model_name: 'gpt-6.1-sol', context_window: 1050000, input_modalities: ['text', 'image'] }] })}
    keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={vi.fn()} /></FloeProvider>, host);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  if (!provider) await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
  await expect.poll(() => document.querySelector('[role=dialog]')!.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
  return { copy, setOpen, setBinding, open };
}

for (const [local, locale, width, dark] of [
  [true, 'en-US', 1280, false], [true, 'zh-CN', 390, true], [true, 'de-DE', 320, true],
  [false, 'zh-CN', 1280, true], [false, 'ru-RU', 320, false],
] as const) {
  it(`keeps ${local ? 'local' : 'remote'} authentication clear in ${locale} at ${width}px`, async () => {
    const { copy } = await mount(local, locale, width, dark);
    const tab = page.getByRole('button', { name: copy.chatGPT.account, exact: true });
    if (local) {
      await expect.element(tab).toBeEnabled();
      await expect.element(page.getByRole('button', { name: copy.chatGPT.continue, exact: true })).toBeVisible();
      expect(document.querySelector('input[type=password]')).toBeNull();
    } else {
      await expect.element(tab).toBeDisabled();
      await expect.element(page.getByText(copy.chatGPT.localOnly, { exact: true })).toBeVisible();
      expect(document.body.textContent).not.toContain(copy.chatGPT.continue);
      (page.getByRole('button', { name: copy.apiKey, exact: true }).element() as HTMLButtonElement).focus();
      const disabled = tab.element() as HTMLButtonElement;
      disabled.focus(); await userEvent.keyboard('{Enter}');
      expect(document.activeElement === disabled).toBe(false);
      expect(document.querySelector('input[type=password]')).not.toBeNull();
    }
    const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
    const panel = document.getElementById('flower-provider-type-openai')!;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    const overflowing = [...panel.querySelectorAll<HTMLElement>('*')].filter(element => element.getBoundingClientRect().right > panel.getBoundingClientRect().right).map(element => [element.tagName, element.className, element.textContent?.slice(0, 70)]);
    expect(panel.scrollWidth, JSON.stringify(overflowing)).toBeLessThanOrEqual(panel.clientWidth);
    for (const button of panel.querySelectorAll('button')) {
      if (!button.getClientRects().length) continue;
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    }
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-chatgpt-${local ? 'local' : 'remote'}-${locale}-${width}.png` });
  });
}

it('keeps draft selection, search and focus when a verified replacement account arrives', async () => {
  let finish!: (result: Awaited<ReturnType<FlowerChatGPTAuth>>) => void;
  const auth = vi.fn<FlowerChatGPTAuth>(async action => action === 'start' ? { id: 'new-attempt', state: 'waiting' } : action === 'status' ? new Promise(resolve => { finish = resolve; }) : {});
  const draft: FlowerProviderDraft = { id: 'openai', type: 'openai', auth_method: 'chatgpt', account_id: 'old', chatgpt_account: { account_id: 'old', email: 'old@example.com', state: 'ready', welcome_acknowledged: true }, models: [{ model_name: 'gpt-6.1-sol', context_window: 1050000 }], model_selection: { selected_models: ['gpt-6.1-sol'] } };
  const { copy, setOpen } = await mount(true, 'en-US', 1280, false, draft, auth);
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.account, exact: true }));
  await expect.element(page.getByText('old@example.com', { exact: true })).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.changeAccount, exact: true }));
  await expect.poll(() => auth.mock.calls.some(([action]) => action === 'status')).toBe(true);
  const search = document.querySelector<HTMLInputElement>('input[placeholder="' + copy.catalog.search + '"]')!;
  await userEvent.fill(search, 'gpt'); search.focus();
  finish({ id: 'new-attempt', state: 'ready', account: { account_id: 'new', email: 'new@example.com', state: 'ready', welcome_acknowledged: false } });
  await expect.element(page.getByText('new@example.com', { exact: true })).toBeVisible();
  expect(search.value).toBe('gpt'); expect(document.activeElement).toBe(search);
  expect(document.querySelector<HTMLInputElement>('input[aria-label="GPT-6.1 Sol"]')?.checked ?? document.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(true);
  expect(document.body.textContent).toContain(copy.chatGPT.welcome);
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.welcomeConfirm, exact: true }));
  expect(document.body.textContent).not.toContain(copy.chatGPT.welcomeTitle);
  setOpen(false);
  await expect.poll(() => auth.mock.calls.some(([action, request]) => action === 'cancel' && request.attempt_id === 'new-attempt')).toBe(true);
});

it('closes the old environment draft and cancels authorization when its trusted binding changes', async () => {
  let finish!: (result: Awaited<ReturnType<FlowerChatGPTAuth>>) => void;
  const auth = vi.fn<FlowerChatGPTAuth>(async action => action === 'start' ? { id: 'old-attempt', state: 'waiting' } : action === 'status' ? new Promise(resolve => { finish = resolve; }) : {});
  const { copy, setBinding, open } = await mount(true, 'en-US', 1280, false, undefined, auth);
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.continue, exact: true }));
  await expect.poll(() => auth.mock.calls.some(([action]) => action === 'status')).toBe(true);
  setBinding('another-environment');
  await expect.poll(open).toBe(false);
  await expect.poll(() => auth.mock.calls.some(([action, request]) => action === 'cancel' && request.attempt_id === 'old-attempt')).toBe(true);
  finish({ id: 'old-attempt', state: 'ready', account: { account_id: 'old', email: 'stale@example.com', state: 'ready', welcome_acknowledged: false } });
  expect(document.body.textContent).not.toContain('stale@example.com');
});
