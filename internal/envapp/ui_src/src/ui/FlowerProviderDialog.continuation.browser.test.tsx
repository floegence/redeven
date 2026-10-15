import desktopCSS from '../../../../../desktop/src/welcome/index.css?inline';
import envCSS from '../index.css?inline';
import flowerCSS from './flower-feature.css?inline';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerProviderDialog } from '../../../../flower_ui/src/settings/FlowerProviderDialog';
import { FlowerSettingsSurface } from '../../../../flower_ui/src/settings/FlowerSettingsSurface';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerProviderDraft, FlowerSettingsDraft, FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const copy = DEFAULT_FLOWER_SURFACE_COPY.settings.dialog;
let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let style: HTMLStyleElement;
afterEach(() => { dispose?.(); host?.remove(); style?.remove(); localStorage.clear(); });

async function setup(surface: 'desktop' | 'env') {
  await page.viewport(surface === 'desktop' ? 1280 : 390, 900);
  style = document.createElement('style');
  style.textContent = surface === 'desktop' ? desktopCSS : envCSS + flowerCSS;
  document.head.append(style);
  host = document.createElement('div'); host.className = 'flower-surface'; document.body.append(host);
}
const checkbox = () => page.getByRole('checkbox', { name: copy.responsesContinuation, exact: true });

for (const surface of ['desktop', 'env'] as const) {
  it(`clears continuation across authentication and provider changes and discards cancelled edits (${surface})`, async () => {
    await setup(surface);
    const [open, setOpen] = createSignal(true);
    const [provider, setProvider] = createSignal<FlowerProviderDraft>({ id: 'openai', type: 'openai', models: [] });
    const confirm = vi.fn<(draft: FlowerProviderDraft) => void>();
    dispose = render(() => <FloeProvider><FlowerProviderDialog open={open()} mode="edit" allowTypeChange provider={provider()}
      chatGPTAvailable chatGPTAuth={async () => ({})} loadChatGPTAccounts={async () => ({ accounts: {}, saved_accounts: [] })}
      keyConfigured webSearchKeyConfigured={false} onOpenChange={setOpen} onConfirm={confirm} /></FloeProvider>, host);
    await expect.element(checkbox()).not.toBeChecked();
    expect(checkbox().element().getAttribute('aria-description')).toBe(copy.responsesContinuationDescription);
    await userEvent.click(page.getByText(copy.responsesContinuation, { exact: true }));
    await expect.element(checkbox()).toBeChecked();
    await userEvent.click(page.getByRole('button', { name: copy.chatGPT.account, exact: true }));
    await expect.element(checkbox()).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: copy.apiKey, exact: true }));
    await expect.element(checkbox()).not.toBeChecked();
    await userEvent.click(page.getByText(copy.responsesContinuation, { exact: true }));
    await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-anthropic]')!);
    await expect.element(checkbox()).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    expect(confirm.mock.calls.at(-1)![0].responses_continuation).toBeUndefined();
    await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
    await expect.element(checkbox()).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: copy.apiKey, exact: true }));
    await expect.element(checkbox()).not.toBeChecked();
    await userEvent.click(page.getByText(copy.responsesContinuation, { exact: true }));
    await userEvent.click(page.getByRole('button', { name: copy.discard, exact: true }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    setOpen(true);
    await expect.element(checkbox()).not.toBeChecked();
    setOpen(false);
    setProvider({ id: 'saved', type: 'openai', responses_continuation: true, models: [] });
    setOpen(true);
    await expect.element(checkbox()).toBeChecked();
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    expect(confirm.mock.calls.at(-1)![0].responses_continuation).toBe(true);
  });

  it(`retains the continuation draft after save failure and allows retry, reopen and close (${surface})`, async () => {
    await setup(surface);
    const initial: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' },
      model_profile: { schema_version: 1, current_model_id: 'openai/gpt-5-mini', providers: [
        { id: 'openai', type: 'openai', models: [{ model_name: 'gpt-5-mini', context_window: 128000 }] },
      ] }, provider_secrets: [{ provider_id: 'openai', provider_api_key_configured: true, web_search_api_key_configured: false }] };
    const [snapshot, setSnapshot] = createSignal(initial);
    let fail = true;
    const save = vi.fn(async (draft: FlowerSettingsDraft) => {
      if (fail) throw new Error('Could not save the connection.');
      const saved = { ...snapshot(), model_profile: draft.model_profile };
      setSnapshot(saved); return saved;
    });
    dispose = render(() => <FloeProvider><FlowerSettingsSurface snapshot={snapshot()}
      onSaveDefaultPermission={async () => snapshot()} onSaveModelProfile={save} /></FloeProvider>, host);
    const edit = () => page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.settings.editProvider, exact: true });
    await userEvent.click(edit());
    await userEvent.click(page.getByText(copy.responsesContinuation, { exact: true }));
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    await expect.element(page.getByText('Could not save the connection.', { exact: true })).toBeVisible();
    await expect.element(checkbox()).toBeChecked();
    expect(save.mock.calls[0][0].model_profile.providers[0].responses_continuation).toBe(true);
    await userEvent.click(page.getByText(copy.responsesContinuation, { exact: true }));
    await userEvent.click(page.getByText(copy.responsesContinuation, { exact: true }));
    fail = false;
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(edit());
    await expect.element(checkbox()).toBeChecked();
    fail = true;
    await userEvent.click(page.getByText(copy.responsesContinuation, { exact: true }));
    await userEvent.click(page.getByRole('button', { name: copy.saveProvider, exact: true }));
    await expect.element(page.getByText('Could not save the connection.', { exact: true })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: copy.discard, exact: true }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(edit());
    await expect.element(checkbox()).toBeChecked();
  });
}
