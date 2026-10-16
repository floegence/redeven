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

async function mount(options: { missingProvider?: boolean; code?: string } = {}) {
  const failed = thread({ messages: [
    { id: 'accepted-user', role: 'user', content: 'continue', status: 'error', created_at_ms: 1 },
    { id: 'accepted-assistant', role: 'assistant', content: 'I will inspect the runtime.', status: 'error', created_at_ms: 2 },
  ], status: 'failed', error: { code: options.code ?? 'provider_request_rejected', message: 'private protocol error', detail: '{"provider":"unknown","code":"provider_request_rejected","response_shape":"empty"}' } });
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
  const loadThread = vi.fn(async (id: string) => liveBootstrap(id === other.thread_id ? other : failed));
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), loadSettings, loadModelDirectory: vi.fn(async () => snapshot.model_directory!),
    saveModelProfile, retryThread, listThreads: vi.fn(async () => [failed, other]), loadThread },
  { get focusThreadRequest() { return focusThreadRequest(); } });
  surface.style.cssText = 'width:100%;height:850px;position:relative;';
  await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
  const configure = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent === copy.settings.dialog.catalog.searchConfigure)!;
  return { surface, configure, saveModelProfile, retryThread, snapshot, setFocusThreadRequest, loadSettings, loadThread };
}

it('opens the current provider and model and returns to the failed chat on cancel', async () => {
  const { surface, configure, retryThread } = await mount();
  await userEvent.click(configure());
  await expect.element(page.getByRole('dialog', { name: copy.settings.dialog.editTitle, exact: true })).toBeVisible();
  expect(document.querySelector('[data-flower-model-search]')).not.toBeNull();
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
  await waitFor(() => !document.querySelector('.flower-provider-dialog') && Boolean(surface.querySelector('.flower-error-card')));
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
  await waitFor(() => document.querySelector('.flower-provider-dialog')?.textContent?.includes('settings save unavailable') === true);
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
  await waitFor(() => !document.querySelector('.flower-provider-dialog') && Boolean(surface.querySelector('.flower-error-card')));
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
  await userEvent.click(page.getByRole('dialog', { name: copy.settings.dialog.editTitle, exact: true }).getByRole('button', { name: copy.settings.dialog.catalog.settingsCloseSaving, exact: true }));
  await waitFor(() => !document.querySelector('.flower-provider-dialog') && Boolean(surface.querySelector('.flower-error-card')));
  expect(surface.querySelector('.flower-composer-submit')).not.toBeNull();
  await userEvent.click(configure());
  await expect.element(page.getByRole('dialog', { name: copy.settings.dialog.editTitle, exact: true })).toBeVisible();
  saving.resolve(snapshot);
  await waitFor(() => !(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }).element() as HTMLButtonElement).disabled);
  await expect.element(page.getByRole('dialog', { name: copy.settings.dialog.editTitle, exact: true })).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
  await waitFor(() => !document.querySelector('.flower-provider-dialog'));
});

it('keeps the new chat selected when a provider save finishes after navigation', async () => {
  const { surface, configure, saveModelProfile, snapshot, setFocusThreadRequest } = await mount();
  const saving = deferred<typeof snapshot>();
  saveModelProfile.mockImplementationOnce(() => saving.promise);
  await userEvent.click(configure());
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }));
  await waitFor(() => saveModelProfile.mock.calls.length === 1);
  setFocusThreadRequest({ request_id: 'other-chat', thread_id: 'thread-2' });
  await waitFor(() => !document.querySelector('.flower-provider-dialog') && surface.textContent?.includes('Other chat') === true);
  saving.resolve(snapshot);
  await waitFor(() => document.querySelector('[data-flower-panel=settings]')?.hasAttribute('hidden') === true);
  expect(surface.querySelector('.flower-error-card')).toBeNull();
  expect(surface.querySelector('.flower-composer-submit')).not.toBeNull();
});

it('retains back navigation when the failed provider has been removed', async () => {
  const { surface, configure } = await mount({ missingProvider: true });
  await userEvent.click(configure());
  await waitFor(() => document.querySelector('.flower-settings-dialog')?.textContent?.includes(copy.settings.dialog.providerRemoved) === true);
  expect(document.querySelector('.flower-provider-dialog')).toBeNull();
  await userEvent.click(page.getByRole('button', { name: copy.computer.close, exact: true }));
  await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
});

it('refreshes canonical settings before opening recovery after an uncertain save', async () => {
  const { configure, loadSettings, snapshot } = await mount();
  const reload = deferred<typeof snapshot>();
  loadSettings.mockImplementationOnce(() => reload.promise);
  await userEvent.click(configure());
  expect(document.querySelector('.flower-provider-dialog')).toBeNull();
  reload.resolve(snapshot);
  await expect.element(page.getByRole('dialog', { name: copy.settings.dialog.editTitle, exact: true })).toBeVisible();
  expect(loadSettings).toHaveBeenLastCalledWith(true);
});


for (const width of [1100, 420]) {
  it('offers historical engine recovery after canonical confirmation at width ' + width, async () => {
    await page.viewport(width, 900);
    const { surface, retryThread } = await mount({ code: 'floret_engine_failed' });
    expect(surface.querySelectorAll('.flower-error-card')).toHaveLength(1);
    expect(surface.querySelector('.flower-message-bubble-error')).toBeNull();
    expect(surface.querySelector('.flower-message-error-kicker')).toBeNull();
    await expect.element(page.getByText('continue', { exact: true })).toBeVisible();
    await expect.element(page.getByText('I will inspect the runtime.', { exact: true })).toBeVisible();
    const retry = page.getByRole('button', { name: copy.chat.retryReply, exact: true });
    await expect.element(retry).toBeVisible();
    const rect = retry.element().getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(width);
    await userEvent.click(retry);
    await waitFor(() => retryThread.mock.calls.length === 1 && !surface.querySelector('.flower-error-card'));
  });
}

it('does not offer retry for an unknown effect outcome', async () => {
  const { surface, retryThread } = await mount({ code: 'floret_effect_outcome_unknown' });
  expect([...surface.querySelectorAll('button')].some(button => button.textContent === copy.chat.retryReply)).toBe(false);
  expect(retryThread).not.toHaveBeenCalled();
});


it('releases failed canonical preflight and refuses a newly unknown effect', async () => {
  const { surface, retryThread, loadThread } = await mount({ code: 'floret_engine_failed' });
  loadThread.mockRejectedValueOnce(new Error('canonical detail unavailable'));
  const retry = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent === copy.chat.retryReply)!;
  retry().click();
  await waitFor(() => !retry().disabled && surface.textContent?.includes(copy.chat.threadLoadErrorTitle) === true);
  expect(retryThread).not.toHaveBeenCalled();
  loadThread.mockResolvedValueOnce(liveBootstrap(thread({ status: 'failed', error: { code: 'floret_effect_outcome_unknown', message: 'unconfirmed operation' } }), 3));
  retry().click();
  await waitFor(() => ![...surface.querySelectorAll('button')].some(button => button.textContent === copy.chat.retryReply));
  expect(retryThread).not.toHaveBeenCalled();
});

it('releases a timed out retry, ignores its late result, and confirms canonical state before recovery', async () => {
  const { surface, retryThread, loadThread, setFocusThreadRequest } = await mount({ code: 'floret_engine_failed' });
  const pending = deferred<ReturnType<typeof liveBootstrap>>();
  retryThread.mockImplementationOnce(() => pending.promise);
  let expire!: () => void;
  const nativeSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
    if (timeout === 120_000) expire = () => (handler as () => void)();
    return nativeSetTimeout(handler, timeout, ...args);
  });
  const retry = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent === copy.chat.retryReply)!;
  retry().click();
  await waitFor(() => retryThread.mock.calls.length === 1 && Boolean(expire));
  expire();
  await waitFor(() => !retry().disabled);
  pending.resolve(liveBootstrap(thread({ status: 'idle', error: undefined }), 5));
  await Promise.resolve();
  expect(surface.querySelector('.flower-error-card')).not.toBeNull();
  loadThread.mockResolvedValueOnce(liveBootstrap(thread({ status: 'running', error: undefined }), 6));
  retry().click();
  await waitFor(() => !surface.querySelector('.flower-error-card'));
  expect(retryThread).toHaveBeenCalledTimes(1);
  setFocusThreadRequest({ request_id: 'after-timeout', thread_id: 'thread-2' });
  await waitFor(() => surface.textContent?.includes('Other chat') === true);
});


it('does not dispatch recovery when navigation supersedes canonical preflight', async () => {
  const { surface, retryThread, loadThread, setFocusThreadRequest } = await mount({ code: 'floret_engine_failed' });
  const preflight = deferred<ReturnType<typeof liveBootstrap>>();
  loadThread.mockImplementationOnce(() => preflight.promise);
  const reads = loadThread.mock.calls.length;
  await userEvent.click(page.getByRole('button', { name: copy.chat.retryReply, exact: true }));
  await waitFor(() => loadThread.mock.calls.length > reads);
  setFocusThreadRequest({ request_id: 'leave-preflight', thread_id: 'thread-2' });
  await waitFor(() => surface.textContent?.includes('Other chat') === true);
  preflight.resolve(liveBootstrap(thread({ status: 'failed', error: { code: 'floret_engine_failed', message: 'late failure' } }), 9));
  await Promise.resolve();
  expect(retryThread).not.toHaveBeenCalled();
  expect(surface.querySelector('.flower-error-card')).toBeNull();
  expect(surface.textContent).toContain('Other chat');
});
