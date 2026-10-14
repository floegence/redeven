import '../../../index.css';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { ErrorBoundary, Show, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { RedevenLocale } from '../../i18n/localeMeta';
import { I18nProvider } from '../../i18n';
import { writeStoredLanguagePreference } from '../../i18n/storage';
import { EnvSettingsPageCtx, type EnvSettingsPageContextValue } from './EnvSettingsPageContext';
import type { AgentSettingsResponse, AIConfig, AIModelProfile } from './types';
import { FlowerSection } from './sections/FlowerSection';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../services/localApi', async importOriginal => ({ ...await importOriginal<typeof import('../../services/localApi')>(), fetchLocalApiJSON: request }));
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); request.mockReset(); });

async function mount(width = 1000, canAdmin = true, locale: RedevenLocale = 'en-US', account = false, brave = false, options: {
  ai?: AIConfig;
  directory?: Promise<unknown>;
  enterFromOtherPage?: boolean;
  local?: boolean;
  accounts?: import('../../../../../../flower_ui/src/contracts/flowerSurfaceContracts').FlowerChatGPTAccount[];
} = {}) {
  await page.viewport(1280, 960);
  writeStoredLanguagePreference(locale);
  const [admin, setAdmin] = createSignal(canAdmin);
  let registry = options.accounts ?? [];
  const [settings, setSettings] = createSignal<AgentSettingsResponse>({
    config_path: '/config.json', connection: { access_point_origin: '', environment_id: 'environment', agent_instance_id: 'agent', direct: { artifact_provisioned: false, expires_at_unix_s: 0 } },
    logging: { log_format: 'plain', log_level: 'info' }, codespaces: { code_server_port_min: 0, code_server_port_max: 0 }, permission_policy: null,
    runtime: { agent_home_dir: '/workspace', shell: '/bin/sh' },
    ai: { current_model_id: 'deepseek/deepseek-v4-flash-vision-exp', providers: [
      { id: 'deepseek', type: brave ? 'openai_compatible' : 'deepseek', base_url: 'https://api.deepseek.com', ...(brave ? { name: 'DeepSeek', web_search: { mode: 'brave' as const } } : {}), models: [{ model_name: 'deepseek-v4-flash-vision-exp', display_name: 'DeepSeek V4 Flash Vision Exp', context_window: 1_000_000, max_output_tokens: 384_000, input_modalities: ['text', 'image'], reasoning_capability: { kind: 'effort', supported_levels: ['high', 'max'], default_level: 'high' } }] },
      { id: 'local', type: 'openai_compatible', name: 'Local model', base_url: 'http://localhost:1234/v1', models: [{ model_name: 'agent', context_window: 32768 }] },
      ...(account ? [{ id: 'account', type: 'openai' as const, auth_method: 'chatgpt' as const, account_id: 'saved-account', models: [{ model_name: 'gpt-5.5', context_window: 400000 }] }] : []),
    ] },
    ai_secrets: { provider_api_key_set: { deepseek: true }, web_search_provider_api_key_set: brave ? { deepseek: true } : {} },
    auth_capabilities: { openai_chatgpt: { available: options.local === true, binding_id: options.local ? 'verified-local-channel' : undefined } },
    chatgpt_accounts: { account: { account_id: 'saved-account', email: 'person@example.com', state: 'ready', welcome_acknowledged: true } },
  });
  const initialAI = options.ai;
  if (initialAI) setSettings(previous => ({ ...previous, ai: initialAI }));
  const [open, setOpen] = createSignal(!options.enterFromOtherPage);
  let failNextSave = false;
  const bundles: Record<string, unknown>[] = [];
  request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/chatgpt/accounts')) return { accounts: {}, saved_accounts: registry };
    if (url.endsWith('/chatgpt/start')) return { id: 'new-login', state: 'waiting' };
    if (url.endsWith('/chatgpt/status')) {
      registry = [{ account_id: 'new-account', email: 'new@example.com', state: 'ready', welcome_acknowledged: true }];
      return { id: 'new-login', state: 'ready', account: registry[0] };
    }
    if (url.endsWith('/chatgpt/cancel')) return {};
    if (url.endsWith('/ai/model_catalog')) return { models: [{ model_name: 'gpt-6.1-sol', context_window: 128000 }] };
    if (url.endsWith('/ai/models')) return options.directory ?? { models: [] };
    if (url.endsWith('/current_model')) {
      const body = JSON.parse(String(init?.body));
      if (failNextSave) { failNextSave = false; throw new Error('Model save unavailable'); }
      return { settings: { ...settings(), ai: { ...settings().ai, current_model_id: body.model_id } } };
    }
    if (url.endsWith('/provider_bundle')) {
      const body = JSON.parse(String(init?.body)); bundles.push(body);
      if (failNextSave) { failNextSave = false; throw new Error('Provider save unavailable'); }
      return { settings: { ...settings(), ai: { ...settings().ai, ...body.model_profile } } };
    }
    throw new Error(`Unexpected local request: ${url}`);
  });
  const ready = { state: 'ready', reason_code: '', retryable: false, safe_to_retry: false };
  const ctx = {
    settings, mutateSettings: setSettings, canInteract: () => true, canAdmin: admin,
    notify: { error: vi.fn(), success: vi.fn() },
    env: { env_id: () => 'environment', env: () => null, bumpSettingsSeq: vi.fn(), aiReadinessController: {
      snapshot: () => ready, loading: () => false, retryPending: () => false, busyStartedAt: () => null,
      startupElapsedMs: () => null, longStartupReadySequence: () => 0,
    } },
  } as unknown as EnvSettingsPageContextValue;
  host = document.createElement('div');
  Object.assign(host.style, { width: `${width}px`, padding: '24px', background: 'var(--background)', color: 'var(--foreground)' });
  document.body.appendChild(host);
  function Theme() { const theme = useTheme(); onMount(() => theme.selectShellTheme('light', 'porcelain-light')); return null; }
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><Theme /><I18nProvider><EnvSettingsPageCtx.Provider value={ctx}>
    <ErrorBoundary fallback={error => <div data-settings-entry-error>{String(error)}</div>}>
      <Show when={open()} fallback={<button onClick={() => setOpen(true)}>Flower settings</button>}><FlowerSection /></Show>
    </ErrorBoundary>
  </EnvSettingsPageCtx.Provider></I18nProvider></FloeProvider>, host);
  if (!options.enterFromOtherPage) await expect.poll(() => host.querySelector('.flower-settings-model-name')?.textContent).toBe('DeepSeek V4 Flash Vision Exp');
  return { settings, bundles, setAdmin, setOpen, failSave: () => { failNextSave = true; } };
}

for (const catalogFailure of [false, true]) {
  it(`opens persisted model selections before the directory ${catalogFailure ? 'fails' : 'arrives'} without losing account identity`, async () => {
    let resolveDirectory!: (value: unknown) => void;
    let rejectDirectory!: (reason: Error) => void;
    const directory = new Promise<unknown>((resolve, reject) => { resolveDirectory = resolve; rejectDirectory = reject; });
    // AIProvider.Models uses omitempty; a saved selection has no inline models.
    const ai: AIConfig = { current_model_id: 'account/gpt-6.1-sol', providers: [
      { id: 'account', type: 'openai', auth_method: 'chatgpt', account_id: 'saved-account', model_selection: {
        selected_models: ['gpt-6.1-sol', 'missing-model'], model_overrides: [{ model_name: 'gpt-6.1-sol', context_window: 64000 }],
      } },
      { id: 'deepseek', type: 'deepseek', model_selection: { selected_models: ['deepseek-v4-pro'] } },
    ] };
    const { bundles, settings } = await mount(1000, true, 'en-US', false, false, { ai, directory, enterFromOtherPage: true });
    await userEvent.click(host.querySelector<HTMLButtonElement>('button')!);
    expect(host.querySelector('[data-settings-entry-error]')?.textContent ?? '').toBe('');
    await expect.poll(() => host.querySelectorAll('.flower-settings-provider-card').length).toBe(2);
    await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!);
    const models = () => host.querySelector<HTMLElement>('.flower-settings-provider-details')!;
    expect(models().textContent).toContain('gpt-6.1-sol');
    expect(models().textContent).toContain('missing-model');
    expect(models().textContent).toContain('64,000');
    if (catalogFailure) rejectDirectory(new Error('Directory unavailable'));
    else resolveDirectory({ current_model: ai.current_model_id, directory: { sources: [], models: [],
      provider_defaults: { deepseek: [{ model_name: 'deepseek-v4-pro', context_window: 1_000_000 }] },
      provider_catalogs: { account: [{ model_name: 'gpt-6.1-sol', context_window: 128000, max_output_tokens: 16000 }] },
    } });
    await expect.poll(() => request.mock.calls.some(([url]) => url.endsWith('/ai/models'))).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(host.querySelector('[data-settings-entry-error]')).toBeNull();
    expect(models().textContent).toContain('missing-model');
    expect(models().textContent).toContain('64,000');
    if (!catalogFailure) await expect.poll(() => models().textContent).toContain('16,000');
    expect(settings().ai?.providers?.[0].account_id).toBe('saved-account');
    expect(bundles).toHaveLength(0);
  });
}

it('uses the shared compact model and provider presentation in global Env settings', async () => {
  await mount(1000, true, 'zh-CN');
  await expect.poll(() => host.textContent).toContain('输入能力');
  expect(document.querySelector('.flower-model-selection-dialog')).toBeNull();
  expect(host.querySelectorAll('.flower-settings-model-stat')).toHaveLength(4);
  expect([...host.querySelectorAll('.flower-settings-provider-status')].every(status => status.textContent === '就绪')).toBe(true);
  expect(host.querySelectorAll('.flower-settings-provider-toggle')).toHaveLength(2);
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  const details = host.querySelector<HTMLDivElement>('.flower-settings-provider-details')!;
  await userEvent.click(details.parentElement!.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!);
  await expect.poll(() => details.dataset.state).toBe('open');
  expect(details.querySelectorAll('table thead th[scope="col"]')).toHaveLength(5);
  expect(details.querySelectorAll('table tbody tr')).toHaveLength(1);
  expect(details.textContent).toContain('1,000,000');
  expect(details.textContent).toContain('384,000');
  expect(details.textContent).toContain('网页搜索');
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: host, path: '__screenshots__/flower-env-settings-zh-CN.png' });
});

it('persists enablement, retains the default and account identity, and rolls back failures', async () => {
  const { settings, bundles, failSave } = await mount(1000, true, 'en-US', true);
  const toggle = () => host.querySelector<HTMLButtonElement>('.flower-settings-provider-toggle')!;
  failSave();
  await userEvent.click(toggle());
  await expect.poll(() => bundles.length).toBe(1);
  await expect.poll(() => toggle().disabled).toBe(false);
  expect(toggle().getAttribute('aria-checked')).toBe('true');
  expect(settings().ai?.providers?.[0].enabled).toBeUndefined();
  await userEvent.click(toggle());
  await expect.poll(() => settings().ai?.providers?.[0].enabled).toBe(false);
  expect(settings().ai?.current_model_id).toBe('deepseek/deepseek-v4-flash-vision-exp');
  expect(bundles[1].auth_schema_version).toBe(1);
  const profile = bundles[1].model_profile as AIModelProfile;
  expect(profile.providers[2].auth_method).toBe('chatgpt');
  expect(profile.providers[2].account_id).toBe('saved-account');
  expect(host.textContent).toContain('The current model’s provider is disabled');
  await userEvent.click(toggle());
  await expect.poll(() => settings().ai?.providers?.[0].enabled).toBe(true);
});

it('keeps narrow global Env settings readable and disables administrative controls for readers', async () => {
  const { bundles } = await mount(340, false);
  const panel = host.querySelector<HTMLElement>('[data-flower-settings-panel="models"]')!;
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  for (const button of panel.querySelectorAll<HTMLButtonElement>('button:not(.flower-settings-provider-disclosure)')) expect(button.disabled).toBe(true);
  const details = panel.querySelector<HTMLDivElement>('.flower-settings-provider-details')!;
  await userEvent.click(details.parentElement!.querySelector<HTMLButtonElement>('.flower-settings-provider-disclosure')!);
  await expect.poll(() => details.dataset.state).toBe('open');
  expect(details.getAttribute('aria-hidden')).toBe('false');
  const scroll = details.querySelector<HTMLElement>('.flower-settings-provider-table-scroll')!;
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  expect(bundles).toHaveLength(0);
});

it('saves a changed model from the edit action and restores the previous choice on failure', async () => {
  const { settings, bundles, failSave } = await mount();
  const chooseLocal = async () => {
    await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-model-edit')!);
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(document.querySelector('.flower-model-selection-search input'));
    const search = document.querySelector<HTMLInputElement>('.flower-model-selection-search input')!;
    await userEvent.fill(search, 'Local');
    await userEvent.click(page.getByRole('option', { name: 'Local model / agent', exact: true }));
    await expect.poll(() => document.querySelector('.flower-model-selection-dialog')).toBeNull();
  };
  failSave();
  await chooseLocal();
  await expect.poll(() => host.querySelector('.flower-settings-model-name')?.textContent).toBe('DeepSeek V4 Flash Vision Exp');
  await chooseLocal();
  await expect.poll(() => settings().ai?.current_model_id).toBe('local/agent');
  expect(document.querySelector('.flower-model-selection-dialog')).toBeNull();
  expect(host.querySelector('.flower-settings-model-name')?.textContent).toBe('agent');
  expect(bundles).toHaveLength(0);
});

it('uses one searchable model list in the polished global Env provider dialog', async () => {
  const { settings } = await mount(1000, true, 'zh-CN');
  const handleRequests = request.getMockImplementation()!;
  request.mockImplementation((url: string, init?: RequestInit) => url.endsWith('/ai/model_catalog')
    ? Promise.resolve({ models: settings().ai?.providers?.[0]?.models ?? [] })
    : handleRequests(url, init));
  await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-provider-actions button:not([role="switch"])')!);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
  await expect.poll(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
  expect(dialog.scrollWidth).toBe(dialog.clientWidth);
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: '__screenshots__/flower-env-provider-connection.png' });
  const search = page.getByRole('textbox', { name: '搜索模型', exact: true });
  await userEvent.fill(search, 'deepseek-v4-flash-vision-exp');
  await expect.poll(() => dialog.querySelectorAll('.flower-provider-model-row').length).toBe(1);
  expect(dialog.scrollWidth).toBe(dialog.clientWidth);
  await userEvent.fill(search, '');
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: '__screenshots__/flower-env-provider-models.png' });
});

it('shows a saved key as dots and preserves it when a replacement draft is cleared', async () => {
  const { settings, bundles } = await mount(1000, true, 'zh-CN', false, true);
  const handleRequests = request.getMockImplementation()!;
  request.mockImplementation((url: string, init?: RequestInit) => url.endsWith('/ai/model_catalog')
    ? Promise.resolve({ models: settings().ai?.providers?.[0]?.models ?? [] }) : handleRequests(url, init));
  const openConnection = async () => {
    await userEvent.click(host.querySelector<HTMLButtonElement>('.flower-settings-provider-actions button:not([role="switch"])')!);
    await expect.element(page.getByRole('dialog')).toBeVisible();
    const dialog = document.querySelector<HTMLElement>('.flower-provider-dialog')!;
      await expect.poll(() => dialog.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')).toBe(true);
    return dialog;
  };
  const dialog = await openConnection();
  const keys = [...dialog.querySelectorAll<HTMLInputElement>('input[type=password]')];
  expect(keys).toHaveLength(2);
  for (const key of keys) {
    expect(key.placeholder).toBe('••••••••');
    expect(key.value).toBe('');
    await userEvent.click(key);
    expect(key.matches(':placeholder-shown')).toBe(true);
    await userEvent.fill(key, 'replacement-key');
    expect(key.getAttribute('aria-description')).toBe('保存后将替换现有密钥');
    expect(key.matches(':placeholder-shown')).toBe(false);
    await userEvent.fill(key, '');
    expect(key.getAttribute('aria-description')).toBe('将保留存储的密钥');
    expect(key.matches(':placeholder-shown')).toBe(true);
  }
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: dialog, path: '__screenshots__/flower-saved-key-global-env.png' });
  await userEvent.click(page.getByRole('button', { name: '保存模型提供商', exact: true }));
  await expect.poll(() => bundles.length).toBe(1);
  expect(bundles[0].provider_api_key_patches).toEqual([]);
  expect(bundles[0].web_search_provider_key_patches).toEqual([]);
  await expect.poll(() => document.querySelector('.flower-provider-dialog')).toBeNull();
  const reopened = await openConnection();
  const replacements = [...reopened.querySelectorAll<HTMLInputElement>('input[type=password]')];
  await userEvent.fill(replacements[0], 'replacement-api-key');
  await userEvent.fill(replacements[1], 'replacement-brave-key');
  if (import.meta.env.VITE_FLOWER_DESIGN_SCREENSHOTS === '1') await page.screenshot({ element: reopened, path: '__screenshots__/flower-replacement-key-global-env.png' });
  await userEvent.click(page.getByRole('button', { name: '保存模型提供商', exact: true }));
  await expect.poll(() => bundles.length).toBe(2);
  expect(bundles[1].provider_api_key_patches).toEqual([{ provider_id: 'deepseek', api_key: 'replacement-api-key' }]);
  expect(bundles[1].web_search_provider_key_patches).toEqual([{ provider_id: 'deepseek', api_key: 'replacement-brave-key' }]);
});

it('offers ChatGPT directly from Env settings and recovers login after discard, failed provider save and page reentry', async () => {
  const { bundles, failSave, setOpen } = await mount(1000, true, 'en-US', false, false, { local: true });
  await userEvent.click(page.getByRole('button', { name: 'Add provider', exact: true }));
  await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
  await expect.element(page.getByRole('button', { name: 'ChatGPT account', exact: true })).toBeEnabled();
  await userEvent.click(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }));
  await expect.element(page.getByText('new@example.com', { exact: true }).last()).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: 'Discard', exact: true }));
  await expect.element(page.getByText('new@example.com', { exact: true }).last()).toBeVisible();
  expect(bundles).toHaveLength(0);
  setOpen(false); setOpen(true);
  await expect.element(page.getByText('new@example.com', { exact: true }).last()).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: 'Continue setup', exact: true }));
  await expect.element(page.getByRole('dialog')).toBeVisible();
  // A saved registration is selected without starting another authorization.
  expect(request.mock.calls.filter(([url]) => url.endsWith('/chatgpt/start'))).toHaveLength(1);
  await userEvent.click(page.getByRole('button', { name: 'Sync model list', exact: true }));
  await userEvent.click((page.getByRole('checkbox', { name: 'gpt-6.1-sol', exact: true }).element() as HTMLInputElement).closest('label')!);
  failSave();
  await userEvent.click(page.getByRole('button', { name: 'Save provider', exact: true }));
  await expect.element(page.getByText('Provider save unavailable', { exact: true })).toBeVisible();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(bundles).toHaveLength(1);
  await new Promise(resolve => setTimeout(resolve, 800));
  expect(bundles).toHaveLength(1);
  await userEvent.click(page.getByRole('button', { name: 'Discard', exact: true }));
  await expect.element(page.getByText('new@example.com', { exact: true }).last()).toBeVisible();
});

for (const local of [false, true]) it(`protects an open ${local ? 'local account' : 'API key'} editor immediately when administration is revoked`, async () => {
  const { setAdmin, bundles } = await mount(1000, true, 'en-US', false, false, { local });
  await userEvent.click(page.getByRole('button', { name: 'Add provider', exact: true }));
  await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
  setAdmin(false);
  if (local) await expect.poll(() => document.querySelector('.flower-provider-workspace')).toBeNull();
  else {
    await expect.element(page.getByRole('button', { name: 'Save provider', exact: true })).toBeDisabled();
    expect(document.querySelector<HTMLElement>('.flower-provider-workspace')!.matches(':disabled')).toBe(true);
  }
  expect(bundles).toHaveLength(0);
});
