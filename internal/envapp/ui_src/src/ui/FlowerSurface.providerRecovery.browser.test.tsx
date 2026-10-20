import '../index.css';
import './flower-feature.css';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';
import type { FlowerLiveStreamConnectInput, FlowerLiveStreamEnvelope, FlowerSettingsDraft, FlowerSettingsSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, flush, disposeRenderedSurface, flowerSurfaceNotifications, liveBootstrap, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, settingsSnapshot, subagentSummary, subagentDetail, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const copy = DEFAULT_FLOWER_SURFACE_COPY;
beforeEach(() => page.viewport(1100, 900));
afterEach(() => vi.restoreAllMocks());

it.each(['resolve', 'reject'])('ignores correction retry %s after navigation without touching the new target', async outcome => {
  const state = await mount({ code: 'floret_tool_argument_correction_exhausted' });
  const pending = deferred<void>();
  state.retryThread.mockImplementationOnce(() => pending.promise);
  await userEvent.click(page.getByRole('button', { name: copy.chat.retryReply, exact: true }));
  await waitFor(() => state.retryThread.mock.calls.length === 1);
  state.setFocusThreadRequest({ request_id: 'leave-pending-retry', thread_id: 'thread-2' });
  await waitFor(() => state.surface.textContent?.includes('Other chat') === true);
  const reads = state.loadThread.mock.calls.length;
  const notices = flowerSurfaceNotifications().length;
  if (outcome === 'resolve') pending.resolve();
  else pending.reject(new Error('superseded retry failure'));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(state.loadThread.mock.calls.length).toBe(reads);
  expect(flowerSurfaceNotifications().length).toBe(notices);
  expect(state.surface.textContent).toContain('Other chat');
  expect(state.surface.querySelector('.flower-error-card')).toBeNull();
});

it.each(['resolve', 'reject'])('ignores correction retry %s after the conversation window closes', async outcome => {
  const failed = thread({ status: 'failed', error: { code: 'floret_tool_argument_correction_exhausted', message: 'stopped' } });
  const pending = deferred<void>();
  const retryThread = vi.fn(() => pending.promise);
  const loadThread = vi.fn(async () => liveBootstrap(failed));
  const surface = renderSurfaceWithDraftCoordinator({ ...adapter(), retryThread, loadThread, listThreads: async () => [failed] },
    createFlowerComposerDraftCoordinator(), { focusThreadRequest: { request_id: 'closing-correction', thread_id: failed.thread_id } });
  await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
  await userEvent.click(page.getByRole('button', { name: copy.chat.retryReply, exact: true }));
  await waitFor(() => retryThread.mock.calls.length === 1);
  disposeRenderedSurface(surface);
  const reads = loadThread.mock.calls.length;
  const notices = flowerSurfaceNotifications().length;
  if (outcome === 'resolve') pending.resolve();
  else pending.reject(new Error('closed conversation retry'));
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(loadThread.mock.calls.length).toBe(reads);
  expect(flowerSurfaceNotifications().length).toBe(notices);
  expect(surface.children).toHaveLength(0);
});

async function mountChildProviderRecovery(code = 'provider_missing_key') {
  const child = subagentSummary({ status: 'failed', can_interrupt: false });
  const parent = thread({ thread_id: child.parent_thread_id, title: 'Parent provider chat', subagents: [child] });
  const failed = thread({ thread_id: child.thread_id, title: child.title, model_id: 'child-provider/child-model', status: 'failed', error: { code, message: 'missing key' } });
  const initial = settingsSnapshot();
  const snapshot: FlowerSettingsSnapshot = { ...initial, provider_secrets: [...initial.provider_secrets, { provider_id: 'child-provider', provider_api_key_configured: true, web_search_api_key_configured: false }], model_profile: { ...initial.model_profile!, providers: [
    ...initial.model_profile!.providers,
    { id: 'child-provider', name: 'Child Provider', type: 'openai', models: [{ model_name: 'child-model', context_window: 128000, input_modalities: ['text'] }] },
  ] } };
  const base = adapter();
  const loadThread = vi.fn(async (id: string) => liveBootstrap(id === parent.thread_id ? parent : failed));
  const loadSubagentDetail = vi.fn(async () => subagentDetail({ summary: child, current: runtimeCurrentView(failed, 7) }));
  const surface = renderSurfaceWithAdapterProps({ ...base, loadSettings: async () => snapshot, loadThread, listThreads: async () => [parent],
    loadSubagentDetail },
  { focusThreadRequest: { request_id: 'child-provider', thread_id: parent.thread_id } });
  await waitFor(() => surface.querySelector('button[aria-controls="flower-subagents-dropdown"]') !== null);
  surface.querySelector<HTMLButtonElement>('button[aria-controls="flower-subagents-dropdown"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-flower-subagent-disclosure]')?.click();
  await waitFor(() => document.querySelector('[data-flower-subagent-row]') !== null);
  document.querySelector<HTMLButtonElement>('[data-flower-subagent-row]')!.click();
  await waitFor(() => document.querySelector('.flower-subagent-detail-window .flower-run-error') !== null);
  const configure = () => [...document.querySelectorAll<HTMLButtonElement>('.flower-subagent-detail-window .flower-run-error button')].find(button => button.textContent === (code === 'floret_tool_argument_correction_exhausted' ? copy.chat.runErrorActions.configureCurrentModel : copy.settings.dialog.catalog.searchConfigure))!;
  return { surface, child, parent, failed, loadThread, loadSubagentDetail, configure, base };
}

it.each(['provider_missing_key', 'floret_tool_argument_correction_exhausted'])('configures the failed child for %s and retains an explicit return to its parent', async code => {
  const state = await mountChildProviderRecovery(code);
  await userEvent.click(state.configure());
  await waitFor(() => document.querySelector('.flower-provider-dialog') !== null);
  expect(state.loadThread).toHaveBeenCalledWith(state.child.thread_id, expect.any(AbortSignal));
  expect(document.querySelector('.flower-provider-dialog')?.textContent).toContain('Child Provider');
  await waitFor(() => document.querySelector<HTMLInputElement>('.flower-provider-dialog input[placeholder="model-name"]')?.value === 'child-model');
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
  await waitFor(() => !document.querySelector('.flower-provider-dialog') && Boolean(state.surface.querySelector('.flower-run-error')));
  expect(state.surface.textContent).toContain(state.child.title);
  const returnToParent = [...state.surface.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === copy.chat.subagentReturnParent)!;
  expect(returnToParent).toBeDefined();
  returnToParent.click();
  await waitFor(() => state.surface.textContent?.includes(state.parent.title) === true);
  expect(state.base.retryThread).not.toHaveBeenCalled();
});

it('ignores a late child settings read after returning to the parent', async () => {
  const state = await mountChildProviderRecovery();
  const pending = deferred<ReturnType<typeof liveBootstrap>>();
  state.loadThread.mockImplementationOnce(() => pending.promise);
  state.configure().click();
  await waitFor(() => state.loadThread.mock.calls.some(call => call[0] === state.child.thread_id));
  const returnToParent = [...state.surface.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === copy.chat.subagentReturnParent)!;
  expect(returnToParent).toBeDefined();
  returnToParent.click();
  await waitFor(() => state.surface.textContent?.includes(state.parent.title) === true);
  pending.resolve(liveBootstrap(state.failed));
  await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('.flower-provider-dialog')).toBeNull();
  expect(state.surface.textContent).toContain(state.parent.title);
});

async function mount(options: { missingProvider?: boolean; code?: string; deepseek?: boolean; disconnectable?: boolean } = {}) {
  const failed = thread({ messages: [
    { id: 'accepted-user', role: 'user', content: 'continue', status: 'error', created_at_ms: 1 },
    { id: 'accepted-assistant', role: 'assistant', content: 'I will inspect the runtime.', status: 'error', created_at_ms: 2 },
  ], status: 'failed', error: { code: options.code ?? 'provider_request_rejected', message: 'private protocol error', detail: '{"provider":"unknown","code":"provider_request_rejected","response_shape":"empty"}' } });
  const initial = settingsSnapshot();
  const provider = { ...initial.model_profile!.providers[0], ...(options.deepseek ? { type: 'deepseek' as const, base_url: 'https://api.deepseek.com' } : {}), web_search: { enabled: false, source: 'native' as const } };
  const policy = { editable: true, default_enabled: true, default_model_enabled: true, default_fetch_source: 'direct' as const, enabled: false, source: 'native' as const, supported_sources: ['native'] as const };
  const snapshot: FlowerSettingsSnapshot = { ...initial, model_profile: { ...initial.model_profile!, providers: options.missingProvider ? [] : [provider] }, model_directory: {
    current_model_id: 'openai/gpt-5.2', models: [{ id: 'openai/gpt-5.2', label: 'OpenAI', source: 'runtime_config' as const, state: 'ready' as const, provider_id: 'openai', model_name: 'gpt-5.2' }],
    sources: [{ id: 'openai', kind: 'runtime_config' as const, state: 'ready' as const }], search_policies: { openai: policy }, provider_search_policies: { openai: policy },
  } };
  const saveModelProfile = vi.fn(async (draft: FlowerSettingsDraft): Promise<FlowerSettingsSnapshot> => ({ ...snapshot, model_profile: draft.model_profile }));
  let current = liveBootstrap(failed);
  const retryThread = vi.fn(async () => { current = liveBootstrap(thread({ status: 'idle', error: undefined }), 2); });
  const [focusThreadRequest, setFocusThreadRequest] = createSignal({ request_id: 'provider-recovery', thread_id: failed.thread_id });
  const other = thread({ thread_id: 'thread-2', title: 'Other chat' });
  const disconnected = deferred<void>();
  const connectLiveStream = options.disconnectable ? async function* (input: FlowerLiveStreamConnectInput): AsyncIterable<FlowerLiveStreamEnvelope> {
    yield { schema_version: 1, kind: 'ready', summaries: [failed, other] };
    await Promise.race([disconnected.promise, new Promise<void>(resolve => input.signal.addEventListener('abort', () => resolve(), { once: true }))]);
    if (!input.signal.aborted) throw Object.assign(new Error('connection permission changed'), { status: 403 });
  } : undefined;
  const loadSettings = vi.fn(async () => snapshot);
  const loadThread = vi.fn(async (id: string) => id === other.thread_id ? liveBootstrap(other) : current);
  const [canMutate, setCanMutate] = createSignal(true);
  const surface = renderSurfaceWithAdapterProps({ ...adapter(), ...(connectLiveStream ? { connectLiveStream } : {}), loadSettings, loadModelDirectory: vi.fn(async () => snapshot.model_directory!),
    get canMutate() { return canMutate(); },
    saveModelProfile, retryThread, listThreads: vi.fn(async () => [failed, other]), loadThread },
  { get focusThreadRequest() { return focusThreadRequest(); } });
  surface.style.cssText = 'width:100%;height:850px;position:relative;';
  await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
  const configure = () => [...surface.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent === (options.code === 'floret_tool_argument_correction_exhausted' ? copy.chat.runErrorActions.configureCurrentModel : copy.settings.dialog.catalog.searchConfigure))!;
  return { surface, configure, saveModelProfile, retryThread, snapshot, setFocusThreadRequest, setCanMutate, loadSettings, loadThread, disconnect: () => disconnected.resolve() };
}

it.each(['resolve', 'reject'])('releases a correction retry %s after disconnect and ignores the superseded response', async outcome => {
  const state = await mount({ code: 'floret_tool_argument_correction_exhausted', disconnectable: true });
  const pending = deferred<void>();
  state.retryThread.mockImplementationOnce(() => pending.promise);
  const retry = () => [...state.surface.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent === copy.chat.retryReply)!;
  retry().click();
  await waitFor(() => state.retryThread.mock.calls.length === 1);
  state.disconnect();
  await waitFor(() => state.surface.querySelector('[data-flower-sync-state=failed]') !== null);
  const reads = state.loadThread.mock.calls.length;
  const notices = flowerSurfaceNotifications().length;
  if (outcome === 'resolve') pending.resolve();
  else pending.reject(new Error('superseded disconnected retry'));
  await waitFor(() => !retry().disabled);
  expect(state.loadThread.mock.calls.length).toBe(reads);
  expect(flowerSurfaceNotifications().length).toBe(notices);
  expect(state.surface.querySelector('.flower-error-card')).not.toBeNull();
  expect(state.retryThread).toHaveBeenCalledTimes(1);
});

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

it.each(['provider_request_rejected', 'provider_stream_interrupted', 'provider_request_failed', 'floret_tool_argument_correction_exhausted'])('retains a failed save for %s, saves once on repeated clicks, then retries manually with the saved preference', async (code) => {
  const { surface, configure, saveModelProfile, retryThread, snapshot } = await mount({ code });
  saveModelProfile.mockRejectedValueOnce(new Error('settings save unavailable'));
  await userEvent.click(configure());
  await waitFor(() => Boolean(document.querySelector('[data-flower-provider-search] input')));
  await userEvent.click(document.querySelector('[data-flower-provider-search] label')!);
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
  const pending = deferred<void>();
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
  await userEvent.click(document.querySelector('.flower-provider-dialog button[data-flower-skip-discovery]')!);
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
  expect(loadSettings).toHaveBeenLastCalledWith(true, expect.any(AbortSignal));
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

it.each(['floret_engine_failed', 'provider_stream_interrupted', 'provider_request_failed', 'floret_tool_argument_correction_exhausted'])('releases a timed out %s retry, ignores its late result, and confirms canonical state before recovery', async (code) => {
  const { surface, retryThread, loadThread, setFocusThreadRequest } = await mount({ code });
  const pending = deferred<void>();
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
  pending.resolve();
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

it('keeps an unknown provider failure actionable without guessing rejection', async () => {
  const { surface, retryThread } = await mount({ code: 'provider_request_failed' });
  await waitFor(() => Boolean(surface.querySelector('.flower-error-card')));
  expect(surface.querySelector('.flower-error-message')?.textContent).toBe(copy.chat.runErrors.providerRequestFailed);
  expect(surface.querySelector('.flower-error-actions')?.textContent).toContain(copy.settings.dialog.catalog.searchConfigure);
  expect(retryThread).not.toHaveBeenCalled();
});

it('retains the DeepSeek page reader after a failed save and allows cancel and retry', async () => {
  const { configure, saveModelProfile, snapshot, retryThread } = await mount({ deepseek: true });
  saveModelProfile.mockRejectedValueOnce(new Error('settings save unavailable'));
  await userEvent.click(configure());
  await waitFor(() => Boolean(document.querySelector('[data-flower-provider-fetch] [data-floe-dropdown-trigger]')));
  await userEvent.click(document.querySelector('[data-flower-provider-fetch] [data-floe-dropdown-trigger]')!);
  await userEvent.click(page.getByRole('menuitem', { name: copy.settings.dialog.catalog.fetchDeepSeek, exact: true }));
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }));
  await waitFor(() => document.querySelector('.flower-provider-dialog')?.textContent?.includes('settings save unavailable') === true);
  expect(saveModelProfile.mock.calls[0][0].model_profile!.providers[0].web_fetch).toEqual({ source: 'deepseek' });
  expect(retryThread).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.saveProvider, exact: true }));
  await waitFor(() => !document.querySelector('.flower-provider-dialog'));
  expect(saveModelProfile.mock.calls[1][0].model_profile!.providers[0].web_fetch).toEqual({ source: 'deepseek' });
  expect(snapshot.model_profile!.providers[0].web_fetch).toBeUndefined();
  await userEvent.click(configure());
  await expect.element(page.getByRole('dialog', { name: copy.settings.dialog.editTitle, exact: true })).toBeVisible();
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
  await waitFor(() => !document.querySelector('.flower-provider-dialog'));
});


it.each([390, 1100])('keeps correction recovery accessible at width %s without replaying work', async width => {
  await page.viewport(width, 900);
  const { surface, configure, retryThread } = await mount({ code: 'floret_tool_argument_correction_exhausted' });
  const card = surface.querySelector<HTMLElement>('.flower-error-card')!;
  expect(surface.querySelectorAll('.flower-error-card')).toHaveLength(1);
  expect(card.querySelector('.flower-error-message')?.textContent).toBe(copy.chat.runErrors.toolArgumentCorrectionExhausted);
  expect(surface.textContent).toContain('I will inspect the runtime.');
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
  await page.screenshot({ element: surface, path: '__screenshots__/tool-correction-recovery-' + width + '.png' });
  configure().focus();
  expect(document.activeElement).toBe(configure());
  await userEvent.keyboard('{Enter}');
  await waitFor(() => document.querySelector('.flower-provider-dialog') !== null);
  await userEvent.click(page.getByRole('button', { name: copy.settings.dialog.discard, exact: true }));
  await waitFor(() => !document.querySelector('.flower-provider-dialog') && Boolean(surface.querySelector('.flower-error-card')));
  expect(retryThread).not.toHaveBeenCalled();
});

it('retries a failed child explicitly without resuming its parent or admitting child input', async () => {
  const state = await mountChildProviderRecovery('floret_tool_argument_correction_exhausted');
  expect(state.child.can_send_input).toBe(false);
  const retry = [...document.querySelectorAll<HTMLButtonElement>('.flower-subagent-detail-window .flower-run-error button')].find(button => button.textContent === copy.chat.retryReply)!;
  expect(retry.disabled).toBe(false);
  const reads = state.loadSubagentDetail.mock.calls.length;
  await userEvent.click(retry);
  await waitFor(() => vi.mocked(state.base.retryThread).mock.calls.length === 1 && !retry.disabled);
  expect(state.base.retryThread).toHaveBeenCalledWith(state.child.thread_id);
  expect(state.loadSubagentDetail.mock.calls.length).toBeGreaterThan(reads);
  expect(state.base.launchTurn).not.toHaveBeenCalled();
  expect(state.surface.textContent).toContain(state.parent.title);
});

it('releases correction preflight when mutation permission is revoked and permits explicit recovery after restoration', async () => {
  const state = await mount({ code: 'floret_tool_argument_correction_exhausted' });
  const preflight = deferred<ReturnType<typeof liveBootstrap>>();
  state.loadThread.mockImplementationOnce(() => preflight.promise);
  const reads = state.loadThread.mock.calls.length;
  const retry = () => [...state.surface.querySelectorAll<HTMLButtonElement>('.flower-error-card button')].find(button => button.textContent === copy.chat.retryReply)!;
  retry().click();
  await waitFor(() => state.loadThread.mock.calls.length > reads);
  state.setCanMutate(false);
  const failed = liveBootstrap(thread({ status: 'failed', error: { code: 'floret_tool_argument_correction_exhausted', message: 'stopped' } }), 9);
  preflight.resolve(failed);
  await flush();
  expect(state.retryThread).not.toHaveBeenCalled();
  expect(state.configure().disabled).toBe(true);
  state.setCanMutate(true);
  await waitFor(() => !retry().disabled && !state.configure().disabled);
  const recovered = liveBootstrap(thread({ status: 'idle', error: undefined }), 10);
  state.loadThread.mockResolvedValue(failed);
  state.retryThread.mockImplementationOnce(async () => { state.loadThread.mockResolvedValue(recovered); });
  await userEvent.click(retry());
  await waitFor(() => state.retryThread.mock.calls.length === 1 && !state.surface.querySelector('.flower-error-card'));
});

it('refuses correction retry when canonical preflight makes the root conversation read-only', async () => {
  const state = await mount({ code: 'floret_tool_argument_correction_exhausted' });
  state.loadThread.mockResolvedValueOnce(liveBootstrap(thread({ status: 'failed', read_only_reason: 'Conversation access is read-only.',
    error: { code: 'floret_tool_argument_correction_exhausted', message: 'stopped' } }), 9));
  const retry = page.getByRole('button', { name: copy.chat.retryReply, exact: true });
  await userEvent.click(retry);
  await expect.element(retry).toBeDisabled();
  expect(state.retryThread).not.toHaveBeenCalled();
  state.setFocusThreadRequest({ request_id: 'leave-read-only-correction', thread_id: 'thread-2' });
  await waitFor(() => state.surface.textContent?.includes('Other chat') === true);
  expect(state.surface.querySelector('.flower-error-card')).toBeNull();
});
