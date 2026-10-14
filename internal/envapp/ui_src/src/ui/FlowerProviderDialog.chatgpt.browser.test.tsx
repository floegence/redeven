import '../index.css';
import './flower-feature.css';

import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import type { FlowerChatGPTAuth, FlowerChatGPTAccount, FlowerProviderDraft, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createI18nHelpers } from './i18n/createI18n';
import { loadEnvAppDictionary, type EnvAppTranslationKey } from './i18n/locales';
import type { RedevenLocale } from './i18n/localeMeta';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.classList.remove('dark'); });

async function mount(local: boolean, locale: RedevenLocale, width: number, dark: boolean, provider?: FlowerProviderDraft, auth?: FlowerChatGPTAuth, mode?: 'create' | 'edit', loadAccounts?: FlowerSurfaceAdapter['loadChatGPTAccounts']) {
  await page.viewport(width, 900);
  const i18n = createI18nHelpers(locale, await loadEnvAppDictionary(locale));
  const copy = createLocalizedFlowerSurfaceCopy({ locale,
    t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
    tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
  }).settings.dialog;
  const onConfirm = vi.fn();
  const [open, setOpen] = createSignal(true);
  const [account, setAccount] = createSignal(provider?.chatgpt_account);
  const [registry, setRegistry] = createSignal<readonly FlowerChatGPTAccount[] | undefined>();
  const [binding, setBinding] = createSignal('verified-local-channel');
  host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
  function Theme() { const theme = useTheme(); onMount(() => theme.selectShellTheme(dark ? 'dark' : 'light', dark ? 'porcelain-dark' : 'porcelain-light')); return null; }
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><Theme /><FlowerProviderDialog
    open={open()} mode={mode ?? (provider ? 'edit' : 'create')} provider={provider ?? { id: 'openai', type: 'openai', models: [] }}
    copy={copy} chatGPTAvailable={local} chatGPTBindingID={binding()} chatGPTAccount={account()} chatGPTAccounts={registry()}
    loadChatGPTAccounts={loadAccounts}
    chatGPTAuth={auth ?? vi.fn(async () => ({ id: 'attempt', state: 'waiting' }))}
    onDiscoverModels={async () => ({ models: provider?.catalog_models ?? [{ model_name: 'gpt-6.1-sol', context_window: 1050000, input_modalities: ['text', 'image'] }] })}
    keyConfigured={false} webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={onConfirm} /></FloeProvider>, host);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  if (!provider || mode === 'create') await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
  await expect.poll(() => document.querySelector('[role=dialog]')!.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
  return { copy, setOpen, setBinding, setAccount, setRegistry, open, onConfirm };
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
    expect(panel.querySelector('.flower-provider-models')).toBeNull();
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

it('does not render a ChatGPT login panel for an existing remote account binding', async () => {
  const provider: FlowerProviderDraft = {
    id: 'openai',
    type: 'openai',
    auth_method: 'chatgpt',
    account_id: 'saved-account',
    chatgpt_account: { account_id: 'saved-account', email: 'person@example.com', state: 'ready', welcome_acknowledged: true },
    models: [{ model_name: 'gpt-6.1-sol' }],
  };
  const { copy } = await mount(false, 'en-US', 1280, false, provider, undefined, 'edit');
  const accountTab = page.getByRole('button', { name: copy.chatGPT.account, exact: true });
  await expect.element(accountTab).toBeDisabled();
  await expect.element(page.getByText(copy.chatGPT.localOnly, { exact: true })).toBeVisible();
  expect(document.querySelector('.flower-provider-account')).toBeNull();
  expect(document.body.textContent).not.toContain(copy.chatGPT.continue);
});

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

for (const dark of [false, true]) {
  it(`keeps the provider picker independent of a populated catalog and preserves selection through authentication and search (${dark ? 'dark' : 'light'})`, async () => {
    const models = [
      { model_name: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', context_window: 1050000, max_output_tokens: 128000, input_modalities: ['text', 'image'], web_search: { status: 'available', reason: 'catalog_supported' } as const },
      { model_name: 'gpt-6-sol', display_name: 'GPT-6 Sol', context_window: 1050000, max_output_tokens: 128000, input_modalities: ['text', 'image'] },
      { model_name: 'gpt-6-luna', display_name: 'GPT-6 Luna', context_window: 1050000, max_output_tokens: 128000, input_modalities: ['text', 'image'] },
    ];
    const draft: FlowerProviderDraft = { id: 'openai', type: 'openai', auth_method: 'chatgpt', account_id: 'saved',
      chatgpt_account: { account_id: 'saved', email: 'person@example.com', state: 'ready', welcome_acknowledged: true },
      models: [models[0]], catalog_models: models, model_selection: { selected_models: [models[0].model_name] } };
    const { copy } = await mount(true, 'zh-CN', 1280, dark, draft, undefined, 'create');
    await expect.element(page.getByRole('checkbox', { name: 'GPT-6.1 Sol', exact: true })).toBeChecked();
    const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
    const picker = dialog.querySelector<HTMLElement>('.flower-provider-picker')!;
    const editor = dialog.querySelector<HTMLElement>('.flower-provider-editor')!;
    expect(picker.getBoundingClientRect().right).toBeLessThanOrEqual(editor.getBoundingClientRect().left);
    expect(dialog.scrollWidth).toBe(dialog.clientWidth);
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-provider-connected-${dark ? 'dark' : 'light'}.png` });
    await userEvent.click(page.getByRole('button', { name: copy.apiKey, exact: true }));
    await userEvent.fill(page.getByPlaceholder(copy.pasteAPIKey), 'test-provider-key');
    const search = page.getByRole('textbox', { name: copy.catalog.search, exact: true });
    await userEvent.fill(search, 'gpt-6.1');
    await expect.element(page.getByRole('checkbox', { name: 'GPT-6.1 Sol', exact: true })).toBeChecked();
    const pickerRect = picker.getBoundingClientRect();
    await userEvent.fill(search, 'no-matching-model');
    await expect.element(page.getByText(copy.catalog.empty, { exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: copy.saveProvider, exact: true })).toBeEnabled();
    expect(picker.getBoundingClientRect().top).toBe(pickerRect.top);
    await userEvent.fill(search, '');
    if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: `__screenshots__/flower-provider-api-${dark ? 'dark' : 'light'}.png` });
  });
}


it('updates account facts without replacing the model selection or search', async () => {
  const draft: FlowerProviderDraft = { id: 'openai', type: 'openai', name: 'Saved name', catalog_models: [{ model_name: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol' }], model_selection: { selected_models: ['gpt-6.1-sol'] }, auth_method: 'chatgpt', account_id: 'saved', chatgpt_account: { account_id: 'saved', email: 'person@example.com', state: 'ready', welcome_acknowledged: true }, models: [{ model_name: 'gpt-6.1-sol' }] };
  const { copy, setAccount } = await mount(true, 'en-US', 390, true, draft);
  const search = page.getByRole('textbox', { name: copy.catalog.search, exact: true });
  await userEvent.fill(search, 'gpt');
  (search.element() as HTMLInputElement).focus();
  setAccount({ ...draft.chatgpt_account!, state: 'temporarily_unavailable', error_code: 'rate_limited' });
  await expect.element(page.getByText(copy.chatGPT.temporarilyUnavailable, { exact: true })).toBeVisible();
  expect((document.querySelector<HTMLInputElement>('input[type=checkbox]')!).checked).toBe(true);
  expect((search.element() as HTMLInputElement).value).toBe('gpt');
  expect(document.activeElement).toBe(search.element());
  const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
});

it('confirms shared task impact and disables repeated sign-out while Runtime completes it', async () => {
  let finish!: (result: Awaited<ReturnType<FlowerChatGPTAuth>>) => void;
  const auth = vi.fn<FlowerChatGPTAuth>(async action => action === 'sign-out' ? new Promise(resolve => { finish = resolve; }) : {});
  const draft: FlowerProviderDraft = { id: 'openai', type: 'openai', auth_method: 'chatgpt', account_id: 'saved', chatgpt_account: { account_id: 'saved', email: 'person@example.com', state: 'ready', welcome_acknowledged: true, binding_count: 2, active_task_count: 1 }, models: [{ model_name: 'gpt-6.1-sol' }] };
  const { copy } = await mount(true, 'en-US', 390, false, draft, auth);
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.signOut, exact: true }));
  await expect.element(page.getByText(copy.chatGPT.signOutImpact(2, 1), { exact: true })).toBeVisible();
  expect(auth.mock.calls).toHaveLength(0);
  await userEvent.click(page.getByRole('dialog', { name: copy.chatGPT.signOut, exact: true }).getByRole('button', { name: copy.chatGPT.signOut, exact: true }));
  await expect.poll(() => auth.mock.calls.length).toBe(1);
  await expect.element(page.getByRole('button', { name: copy.chatGPT.signingOut, exact: true })).toBeDisabled();
  finish({ local_cleanup_complete: true, revocation_confirmed: false });
  await expect.element(page.getByText(copy.chatGPT.revocationUnconfirmed, { exact: true }).first()).toBeVisible();
  await expect.element(page.getByRole('link', { name: copy.chatGPT.disconnectApps, exact: true })).toHaveAttribute('href', 'https://chatgpt.com/#settings');
});

for (const [locale, width] of [['zh-CN', 390], ['de-DE', 320]] as const) {
it(`selects a saved signed-out registration without registering a new client and distinguishes equal emails (${locale})`, async () => {
  const saved = [
    { account_id: 'chatgpt_11111111', email: 'same@example.com', state: 'signed_out' as const, welcome_acknowledged: true },
    { account_id: 'chatgpt_22222222', email: 'same@example.com', state: 'ready' as const, welcome_acknowledged: true },
  ];
  const auth = vi.fn<FlowerChatGPTAuth>(async action => action === 'start' ? { id: 'saved-attempt', state: 'waiting' } : {});
  const { copy } = await mount(true, locale, width, true, undefined, auth, undefined, async () => ({ accounts: {}, saved_accounts: saved }));
  const picker = page.getByRole('button', { name: copy.chatGPT.savedAccounts, exact: true });
  await expect.element(picker).toBeEnabled();
  await userEvent.click(picker);
  await expect.element(page.getByRole('menuitem', { name: /11111111/ })).toBeVisible();
  await expect.element(page.getByRole('menuitem', { name: /22222222/ })).toBeVisible();
  await userEvent.click(page.getByRole('menuitem', { name: /11111111/ }));
  expect(auth).not.toHaveBeenCalled();
  await expect.element(page.getByRole('button', { name: copy.chatGPT.reauthorize, exact: true })).toBeVisible();
  await expect.poll(() => document.querySelector('[role=menu]') === null).toBe(true);
  await expect.poll(() => document.querySelector('[role=dialog]')!.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
  const panel = document.getElementById('flower-provider-type-openai')!;
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: document.querySelector<HTMLElement>('.flower-provider-dialog')!, path: `__screenshots__/flower-chatgpt-saved-${locale}-${width}.png` });
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.reauthorize, exact: true }));
  expect(auth.mock.calls[0][1]).toMatchObject({ account_id: saved[0].account_id });
  expect(auth.mock.calls[0][1].previous_attempt_id).toBeUndefined();
});
}

it('retries a failed initial exchange with its attempt registration and permits immediate sign-out of identity-only login', async () => {
  let starts = 0;
  const auth = vi.fn<FlowerChatGPTAuth>(async (action) => {
    if (action === 'start') return { id: `attempt-${++starts}`, state: 'waiting' };
    if (action === 'status') return starts === 1 ? { state: 'failed', error_code: 'invalid_grant' } : { state: 'ready', account: { account_id: 'saved-new', email: 'new@example.com', state: 'plan_permission_required', welcome_acknowledged: false } };
    if (action === 'sign-out') return { local_cleanup_complete: true, revocation_confirmed: true };
    return {};
  });
  const { copy } = await mount(true, 'en-US', 1280, false, undefined, auth);
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.continue, exact: true }));
  await expect.element(page.getByRole('alert')).toHaveTextContent(copy.chatGPT.signInFailed);
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.continue, exact: true }));
  const startsCalls = auth.mock.calls.filter(([action]) => action === 'start');
  expect(startsCalls[1][1]).toMatchObject({ previous_attempt_id: 'attempt-1', scope_id: startsCalls[0][1].scope_id });
  await expect.element(page.getByRole('button', { name: copy.chatGPT.signOut, exact: true })).toBeVisible();
  await expect.element(page.getByRole('alert')).toHaveTextContent(copy.chatGPT.planPermission);
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.signOut, exact: true }));
  expect(auth.mock.calls.find(([action]) => action === 'sign-out')?.[1].account_id).toBe('saved-new');
});

it('observes canonical renewal and logout of a newly saved unbound account without losing model choices', async () => {
  const saved: FlowerChatGPTAccount = { account_id: 'unbound', email: 'saved@example.com', state: 'ready', welcome_acknowledged: true, binding_count: 0 };
  const draft: FlowerProviderDraft = { id: 'openai', type: 'openai', auth_method: 'chatgpt', account_id: saved.account_id, chatgpt_account: saved, models: [{ model_name: 'gpt-6.1-sol', context_window: 1050000 }], model_selection: { selected_models: ['gpt-6.1-sol'] } };
  const { copy, setRegistry } = await mount(true, 'de-DE', 320, true, draft, undefined, undefined, async () => ({ accounts: {}, saved_accounts: [saved] }));
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.account, exact: true }));
  await expect.element(page.getByText(copy.chatGPT.savedSignIn, { exact: true })).toBeVisible();
  setRegistry([{ ...saved, state: 'renewing' }]);
  await expect.element(page.getByText(copy.chatGPT.renewing, { exact: true })).toBeVisible();
  setRegistry([{ ...saved, state: 'signed_out', revocation_confirmed: true }]);
  await expect.element(page.getByText(copy.chatGPT.signedOut, { exact: true })).toBeVisible();
  expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
  const panel = document.getElementById('flower-provider-type-openai')!;
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
});

it('reports unconfirmed cleanup of a failed new sign-in without claiming the existing account was signed out', async () => {
  const auth = vi.fn<FlowerChatGPTAuth>(async action => action === 'start' ? { id: 'rejected', state: 'waiting' } : action === 'status' ? { state: 'failed', error_code: 'revocation_unconfirmed' } : {});
  const draft: FlowerProviderDraft = { id: 'openai', type: 'openai', auth_method: 'chatgpt', account_id: 'existing', chatgpt_account: { account_id: 'existing', email: 'existing@example.com', state: 'ready', welcome_acknowledged: true }, models: [{ model_name: 'gpt-6.1-sol', context_window: 1050000 }] };
  const { copy } = await mount(true, 'en-US', 1280, false, draft, auth);
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.account, exact: true }));
  await userEvent.click(page.getByRole('button', { name: copy.chatGPT.changeAccount, exact: true }));
  await expect.element(page.getByRole('alert')).toHaveTextContent(copy.chatGPT.signInCleanupUnconfirmed);
  await expect.element(page.getByRole('link', { name: copy.chatGPT.disconnectApps })).toBeVisible();
  await expect.element(page.getByText(copy.chatGPT.connected, { exact: true })).toBeVisible();
  expect(document.body.textContent).not.toContain(copy.chatGPT.revocationUnconfirmed);
});
