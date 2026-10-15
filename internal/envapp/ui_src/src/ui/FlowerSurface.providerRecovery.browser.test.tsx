import '../index.css';
import './flower-feature.css';
import { createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerSettingsDraft, FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, flowerSurfaceNotifications, liveBootstrap, renderSurfaceWithAdapterProps, settingsSnapshot, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const copy = DEFAULT_FLOWER_SURFACE_COPY;
beforeEach(() => page.viewport(1100, 900));

async function mount(options: { missingProvider?: boolean } = {}) {
  const failed = thread({ status: 'failed', error: { code: 'provider_request_rejected', message: 'private protocol error', detail: '{"provider":"unknown","code":"provider_request_rejected","response_shape":"empty"}' } });
  const initial = settingsSnapshot();
  const provider = { ...initial.model_profile!.providers[0], web_search: { enabled: false, source: 'native' as const } };
  const policy = { editable: true, default_enabled: true, default_model_enabled: true, enabled: false, source: 'native' as const, supported_sources: ['native'] as const };
  const snapshot: FlowerSettingsSnapshot = { ...initial, model_profile: { ...initial.model_profile!, providers: options.missingProvider ? [] : [provider] }, model_directory: {
    current_model_id: 'openai/gpt-5.2', models: [{ id: 'openai/gpt-5.2', label: 'OpenAI', source: 'runtime_config' as const, state: 'ready' as const, provider_id: 'openai', model_name: 'gpt-5.2' }],
    sources: [{ id: 'openai', kind: 'runtime_config' as const, state: 'ready' as const }], search_policies: { openai: policy }, provider_search_policies: { openai: policy },
  } };
  const saveModelProfile = vi.fn(async (draft: FlowerSettingsDraft): Promise<FlowerSettingsSnapshot> => ({ ...snapshot, model_profile: draft.model_profile }));
  const retryThread = vi.fn(async () => liveBootstrap(thread({ status: 'idle', error: undefined }), 2));
  const [focusThreadRequest, setFocusThreadRequest] = createSignal({ request_id: 'provider-recovery', thread_id: failed.thread_id });
  const other = thread({ thread_id: 'thread-2', title: 'Other chat' });
  const loadSettings = vi.fn(async () => snapshot);
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: vi.fn(async () => snapshot.model_directory!),
    saveModelProfile, retryThread, listThreads: vi.fn(async () => [failed, other]), loadThread: vi.fn(async id => liveBootstrap(id === other.thread_id ? other : failed)) },
  { get focusThreadRequest() { return focusThreadRequest(); } });
  surface.style.cssText = 'width:100%;height:850px;position:relative;';
  await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
  const configure = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent === copy.settings.dialog.catalog.searchConfigure)!;
  return { surface, configure, saveModelProfile, retryThread, snapshot, setFocusThreadRequest, loadSettings };
}

it('opens the current provider and model and returns to the failed chat on cancel', async () => {
  const { surface, configure, retryThread } = await mount();
  await userEvent.click(configure());
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(document.querySelector('[data-flower-model-search]')).not.toBeNull();
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
  await waitFor(() => !document.querySelector('[role=dialog]') && Boolean(surface.querySelector('.flower-error-card')));
  expect(retryThread).not.toHaveBeenCalled();
  expect(surface.querySelector('.flower-composer-submit')).not.toBeNull();
});

it('retains a failed save, saves once on repeated clicks, then retries manually with the saved preference', async () => {
  const { surface, configure, saveModelProfile, retryThread, snapshot } = await mount();
  saveModelProfile.mockRejectedValueOnce(new Error('settings save unavailable'));
  await userEvent.click(configure());
  await waitFor(() => Boolean(document.querySelector('[data-flower-provider-search] input')));
  await userEvent.click(document.querySelector('[data-flower-provider-search] input')!);
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }));
  await waitFor(() => document.querySelector('[role=dialog]')?.textContent?.includes('settings save unavailable') === true);
  expect(retryThread).not.toHaveBeenCalled();
  const saving = deferred<typeof snapshot>();
  saveModelProfile.mockImplementationOnce(() => saving.promise);
  const save = page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }).element() as HTMLButtonElement;
  save.click(); save.click();
  await waitFor(() => saveModelProfile.mock.calls.length === 2);
  expect(save.disabled).toBe(true);
  const draft = saveModelProfile.mock.calls[1][0];
  expect(draft.model_profile!.providers[0].web_search?.enabled).toBe(true);
  saving.resolve({ ...snapshot, model_profile: draft.model_profile! });
  await waitFor(() => !document.querySelector('[role=dialog]') && Boolean(surface.querySelector('.flower-error-card')));
  expect(retryThread).not.toHaveBeenCalled();
  const pending = deferred<ReturnType<typeof liveBootstrap>>();
  retryThread.mockImplementationOnce(() => pending.promise);
  const retry = [...surface.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent === copy.chat.retryReply)!;
  retry.click(); retry.click();
  await waitFor(() => retryThread.mock.calls.length === 1);
  expect(retry.disabled).toBe(true);
  pending.reject(new Error('retry unavailable'));
  await waitFor(() => !retry.disabled);
  expect(flowerSurfaceNotifications().some(item => JSON.stringify(item).includes('retry unavailable'))).toBe(true);
  retry.click();
  await waitFor(() => retryThread.mock.calls.length === 2 && !surface.querySelector('.flower-error-card'));
});

it('can leave a pending save and ignores its late dialog completion', async () => {
  const { surface, configure, saveModelProfile, snapshot } = await mount();
  const saving = deferred<typeof snapshot>();
  saveModelProfile.mockImplementationOnce(() => saving.promise);
  await userEvent.click(configure());
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }));
  await waitFor(() => saveModelProfile.mock.calls.length === 1);
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.catalog.settingsCloseSaving, exact: true }));
  await waitFor(() => !document.querySelector('[role=dialog]') && Boolean(surface.querySelector('.flower-error-card')));
  expect(surface.querySelector('.flower-composer-submit')).not.toBeNull();
  await userEvent.click(configure());
  await expect.element(page.getByRole('dialog')).toBeVisible();
  saving.resolve(snapshot);
  await waitFor(() => !(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }).element() as HTMLButtonElement).disabled);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
  await waitFor(() => !document.querySelector('[role=dialog]'));
});

it('keeps the new chat selected when a provider save finishes after navigation', async () => {
  const { surface, configure, saveModelProfile, snapshot, setFocusThreadRequest } = await mount();
  const saving = deferred<typeof snapshot>();
  saveModelProfile.mockImplementationOnce(() => saving.promise);
  await userEvent.click(configure());
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }));
  await waitFor(() => saveModelProfile.mock.calls.length === 1);
  setFocusThreadRequest({ request_id: 'other-chat', thread_id: 'thread-2' });
  await waitFor(() => !document.querySelector('[role=dialog]') && surface.textContent?.includes('Other chat') === true);
  saving.resolve(snapshot);
  await waitFor(() => surface.querySelector('[data-flower-panel=settings]')?.hasAttribute('hidden') === true);
  expect(surface.querySelector('.flower-error-card')).toBeNull();
  expect(surface.querySelector('.flower-composer-submit')).not.toBeNull();
});

it('retains back navigation when the failed provider has been removed', async () => {
  const { surface, configure } = await mount({ missingProvider: true });
  await userEvent.click(configure());
  await waitFor(() => surface.textContent?.includes(copy.settings.dialog.providerRemoved) === true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await userEvent.click(page.getByRole('button', { name: copy.settings.backToChat, exact: true }));
  await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
});

it('refreshes canonical settings before opening recovery after an uncertain save', async () => {
  const { configure, loadSettings, snapshot } = await mount();
  const reload = deferred<typeof snapshot>();
  loadSettings.mockImplementationOnce(() => reload.promise);
  await userEvent.click(configure());
  expect(document.querySelector('[role=dialog]')).toBeNull();
  reload.resolve(snapshot);
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(loadSettings).toHaveBeenLastCalledWith(true);
});
