// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerSettingsSurface } from '../../../../flower_ui/src/settings/FlowerSettingsSurface';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';
import type { FlowerSettingsDraft, FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); });

it.each([false, true])('discloses provider API requests before enabling automatic model updates; save fails: %s', async (fails) => {
  const [snapshot, setSnapshot] = createSignal(settingsSnapshot());
  const save = vi.fn(async (auto_update_model_catalog: boolean) => {
    if (fails) throw new Error('Could not save the setting.');
    setSnapshot(previous => ({ ...previous, defaults: { ...previous.defaults, auto_update_model_catalog } }));
    return snapshot();
  });
  host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerSettingsSurface snapshot={snapshot()} copy={DEFAULT_FLOWER_SURFACE_COPY.settings}
    onSaveDefaultPermission={async () => snapshot()} onSaveModelProfile={async () => snapshot()}
    onSaveAutoUpdateModelCatalog={save} />, host);
  const toggle = host.querySelector<HTMLButtonElement>('.flower-settings-model-catalog-update-section [role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toContain('providers’ APIs');
  expect(host.textContent).toContain('Automatic updates are off by default.');
  expect(save).not.toHaveBeenCalled();
  toggle.click();
  await waitFor(() => !toggle.disabled);
  expect(save).toHaveBeenCalledWith(true);
  expect(toggle.getAttribute('aria-checked')).toBe(String(!fails));
  if (fails) {
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save the setting.');
  } else {
    toggle.click();
    await waitFor(() => !toggle.disabled);
    expect(save).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  }
});

it('saves a new Anthropic connection while preserving a retained ChatGPT account without plan permission', async () => {
  const base = settingsSnapshot(false);
  const savedChatGPT = { ...base.model_profile!.providers[0], auth_method: 'chatgpt' as const, account_id: 'chatgpt_account' };
  const initial: FlowerSettingsSnapshot = {
    ...base,
    model_profile: { ...base.model_profile!, providers: [savedChatGPT] },
    chatgpt_accounts: {
      openai: { account_id: 'chatgpt_account', email: 'person@example.com', state: 'plan_permission_required', welcome_acknowledged: true },
    },
  };
  const [snapshot, setSnapshot] = createSignal(initial);
  const savedDrafts: FlowerSettingsDraft[] = [];
  const save = vi.fn(async (draft: FlowerSettingsDraft) => {
    savedDrafts.push(draft);
    const anthropicID = draft.model_profile.providers.find(provider => provider.type === 'anthropic')!.id;
    const saved: FlowerSettingsSnapshot = {
      ...snapshot(),
      model_profile: draft.model_profile,
      provider_secrets: [
        ...snapshot().provider_secrets.filter(secret => secret.provider_id !== anthropicID),
        { provider_id: anthropicID, provider_api_key_configured: true, web_search_api_key_configured: false },
      ],
    };
    setSnapshot(saved);
    return saved;
  });
  host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerSettingsSurface snapshot={snapshot()} copy={DEFAULT_FLOWER_SURFACE_COPY.settings}
    onSaveDefaultPermission={async () => snapshot()} onSaveModelProfile={save} />, host);

  host.querySelector<HTMLButtonElement>('.flower-settings-provider-add')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-provider-dialog')));
  document.querySelector<HTMLButtonElement>('button[aria-controls="flower-provider-type-anthropic"]')!.click();
  const apiKey = document.querySelector<HTMLInputElement>('.flower-provider-dialog input[type="password"]')!;
  apiKey.value = 'anthropic-test-key';
  apiKey.dispatchEvent(new Event('input', { bubbles: true }));
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(DEFAULT_FLOWER_SURFACE_COPY.settings.dialog.saveProvider))!.click();

  await waitFor(() => savedDrafts.length === 1);
  expect(savedDrafts[0].model_profile.providers).toHaveLength(2);
  expect(savedDrafts[0].model_profile.providers[0]).toMatchObject({ id: 'openai', auth_method: 'chatgpt', account_id: 'chatgpt_account' });
  expect(savedDrafts[0].model_profile.providers[1]).toMatchObject({ type: 'anthropic', provider_api_key: 'anthropic-test-key' });
  expect(snapshot().chatgpt_accounts?.openai.state).toBe('plan_permission_required');
});
