import '../index.css';
import './flower-feature.css';
import { FloeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it, onTestFinished, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { FlowerSurface } from '../../../../flower_ui/src/FlowerSurface';
import type { FlowerSurfaceAdapter, FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { withModelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';

const copy = DEFAULT_FLOWER_SURFACE_COPY;
function mount(dark: boolean) {
  let snapshot: FlowerSettingsSnapshot = withModelDirectoryFixture({
    defaults: { permission_type: 'approval_required' },
    model_profile: { schema_version: 1, current_model_id: 'openai/gpt-5.2', providers: [{
      id: 'openai', name: 'OpenAI', type: 'openai', models: [{ model_name: 'gpt-5.2', context_window: 400000 }],
    }] },
    provider_secrets: [{ provider_id: 'openai', provider_api_key_configured: true, web_search_api_key_configured: false }],
  });
  const unused = async (): Promise<never> => { throw new Error('Unexpected conversation mutation'); };
  const adapter: FlowerSurfaceAdapter = {
    runtime: { runtime_id: 'settings-dialog', runtime_kind: 'env_local', carrier_kind: 'runtime', display_name: 'Local Environment', subtitle: '' },
    loadSettings: async () => snapshot, loadModelDirectory: async () => snapshot.model_directory!,
    saveDefaultPermission: async permission => (snapshot = { ...snapshot, defaults: { ...snapshot.defaults, permission_type: permission } }),
    saveModelProfile: async draft => (snapshot = { ...snapshot, model_profile: draft.model_profile }),
    listThreads: async () => [], loadThread: unused, loadSubagentDetail: unused,
    markThreadRead: unused, persistDefaultModel: unused, resolveHandler: async () => ({
      decision_id: 'settings-dialog-ready', decision_revision: 1, route: 'env_local', reason_code: 'runtime_available',
      selected_handler: { handler_id: 'local', handler_kind: 'env_local', display_name: 'Local Environment', carrier_kind: 'runtime', state: 'online', selection_source: 'router_default', supports_thread_kinds: ['chat'] },
      available_handlers: [], unavailable_handlers: [], handler_selection: { can_switch: false, requires_user_visible_confirmation: true },
      decision_scope: { thread_kind: 'chat', client_surface: 'flower_surface' }, runtime_presence: { schema_version: 1, runtime_id: 'settings-dialog', runtime_kind: 'env_local', carrier_kind: 'runtime', display_name: 'Local Environment', state: 'online', endpoint: { visibility: 'local' }, capabilities: ['chat'], last_seen_at_unix_ms: 1 }, allowed_actions: ['start_thread'], ui_chips: [], blocker: null, created_at_unix_ms: 1,
    }),
    launchTurn: unused, retryThread: unused, stopThread: unused, submitInput: unused, submitApproval: unused,
  };
  const host = document.createElement('div');
  host.style.cssText = 'height:100vh;width:100%';
  document.body.append(host);
  function SettingsTheme() {
    const theme = useTheme();
    onMount(() => theme.selectShellTheme(dark ? 'dark' : 'light', dark ? 'porcelain-dark' : 'porcelain-light'));
    return null;
  }
  const dispose = render(() => <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><SettingsTheme /><FlowerSurface adapter={adapter} draftCoordinator={createFlowerComposerDraftCoordinator()} notify={vi.fn()} /></FloeProvider>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  return host;
}

it.each([{ width: 1280, dark: false }, { width: 390, dark: true }])(
  'keeps nested editors and scrolling inside settings at $width px', async ({ width, dark }) => {
    await page.viewport(width, 850);
    const previous = document.documentElement.className;
    document.documentElement.classList.toggle('dark', dark);
    onTestFinished(() => { document.documentElement.className = previous; });
    mount(dark);
    const trigger = page.getByRole('button', { name: copy.chat.settingsLabel, exact: true });
    await userEvent.click(trigger);
    const dialog = page.getByRole('dialog', { name: copy.settings.title, exact: true });
    await expect.element(dialog).toBeVisible();
    await expect.element(page.getByRole('button', { name: copy.settings.changeModel, exact: true })).toBeVisible();
    await expect.poll(() => dialog.element().getAttribute('data-floating-presence')).toBe('open');
    await expect.poll(() => Number(getComputedStyle(dialog.element()).opacity)).toBe(1);
    const bounds = dialog.element().getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.bottom).toBeLessThanOrEqual(850);
    expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
    await page.screenshot({ path: '__screenshots__/flower-settings-dialog-' + width + '.png' });
    await userEvent.click(page.getByRole('button', { name: copy.settings.changeModel, exact: true }));
    await expect.element(page.getByRole('dialog', { name: copy.settings.changeModel, exact: true })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog', { name: copy.settings.changeModel, exact: true })).not.toBeInTheDocument();
    await expect.element(dialog).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: copy.settings.editProvider, exact: true }));
    const provider = page.getByRole('dialog', { name: copy.settings.dialog.editTitle, exact: true });
    await expect.element(provider).toBeVisible();
    await userEvent.click(provider.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
    await expect.element(provider).not.toBeInTheDocument();
    await expect.element(dialog).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await expect.element(dialog).toBeVisible();
    await expect.poll(() => dialog.element().getAttribute('data-floating-presence')).toBe('open');
    const backdrop = document.querySelector<HTMLElement>('[data-floe-dialog-backdrop]')!;
    await userEvent.click(backdrop, { position: { x: 2, y: 2 } });
    await expect.element(dialog).not.toBeInTheDocument();
  },
);
