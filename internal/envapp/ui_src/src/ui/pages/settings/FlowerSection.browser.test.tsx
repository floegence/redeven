import '../../../index.css';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { RedevenLocale } from '../../i18n/localeMeta';
import { I18nProvider } from '../../i18n';
import { writeStoredLanguagePreference } from '../../i18n/storage';
import { EnvSettingsPageCtx, type EnvSettingsPageContextValue } from './EnvSettingsPageContext';
import type { AgentSettingsResponse, AIModelProfile } from './types';
import { FlowerSection } from './sections/FlowerSection';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../services/localApi', async importOriginal => ({ ...await importOriginal<typeof import('../../services/localApi')>(), fetchLocalApiJSON: request }));
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); request.mockReset(); });

async function mount(width = 1000, canAdmin = true, locale: RedevenLocale = 'en-US', account = false) {
  await page.viewport(1280, 960);
  writeStoredLanguagePreference(locale);
  const [settings, setSettings] = createSignal<AgentSettingsResponse>({
    config_path: '/config.json', connection: { access_point_origin: '', environment_id: 'environment', agent_instance_id: 'agent', direct: { artifact_provisioned: false, expires_at_unix_s: 0 } },
    logging: { log_format: 'plain', log_level: 'info' }, codespaces: { code_server_port_min: 0, code_server_port_max: 0 }, permission_policy: null,
    runtime: { agent_home_dir: '/workspace', shell: '/bin/sh' },
    ai: { current_model_id: 'deepseek/deepseek-v4-flash-vision-exp', providers: [
      { id: 'deepseek', type: 'deepseek', base_url: 'https://api.deepseek.com', models: [{ model_name: 'deepseek-v4-flash-vision-exp', display_name: 'DeepSeek V4 Flash Vision Exp', context_window: 1_000_000, max_output_tokens: 384_000, input_modalities: ['text', 'image'], reasoning_capability: { kind: 'effort', supported_levels: ['high', 'max'], default_level: 'high' } }] },
      { id: 'local', type: 'openai_compatible', name: 'Local model', base_url: 'http://localhost:1234/v1', models: [{ model_name: 'agent', context_window: 32768 }] },
      ...(account ? [{ id: 'account', type: 'openai' as const, auth_method: 'chatgpt' as const, account_id: 'saved-account', models: [{ model_name: 'gpt-5.5', context_window: 400000 }] }] : []),
    ] },
    ai_secrets: { provider_api_key_set: { deepseek: true }, web_search_provider_api_key_set: {} },
    chatgpt_accounts: { account: { account_id: 'saved-account', email: 'person@example.com', state: 'ready', welcome_acknowledged: true } },
  });
  let failNextSave = false;
  const bundles: Record<string, unknown>[] = [];
  request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/ai/models')) return { models: [] };
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
    settings, mutateSettings: setSettings, canInteract: () => true, canAdmin: () => canAdmin,
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
  dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><Theme /><I18nProvider><EnvSettingsPageCtx.Provider value={ctx}><FlowerSection /></EnvSettingsPageCtx.Provider></I18nProvider></FloeProvider>, host);
  await expect.poll(() => host.querySelector('.flower-settings-model-name')?.textContent).toBe('DeepSeek V4 Flash Vision Exp');
  return { settings, bundles, failSave: () => { failNextSave = true; } };
}

it('uses the shared compact model and provider presentation in global Env settings', async () => {
  await mount(1000, true, 'zh-CN');
  await expect.poll(() => host.textContent).toContain('输入能力');
  expect(document.querySelector('.flower-model-selection-dialog')).toBeNull();
  expect(host.querySelectorAll('.flower-settings-model-stat')).toHaveLength(4);
  expect([...host.querySelectorAll('.flower-settings-provider-status')].every(status => status.textContent === '就绪')).toBe(true);
  expect(host.querySelectorAll('.flower-settings-provider-toggle')).toHaveLength(2);
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
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
  for (const button of panel.querySelectorAll<HTMLButtonElement>('button')) expect(button.disabled).toBe(true);
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
