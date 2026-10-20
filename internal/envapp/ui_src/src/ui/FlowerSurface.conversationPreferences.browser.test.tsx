import '../index.css';
import './flower-feature.css';
import { createSignal } from 'solid-js';
import { page, userEvent } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { modelDirectoryFixture } from '../../../../flower_ui/testing/modelDirectoryFixture';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import type { FlowerConversationPreferencePatch, FlowerConversationPreferences, FlowerReasoningCapability } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, deferred, disposeRenderedSurface, liveBootstrap, renderSurfaceWithAdapterProps, renderSurfaceWithDraftCoordinator, settingsSnapshot, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const modelA = 'openai/gpt-5.2';
const modelB = 'openai/gpt-5.2-pro';
const capability: FlowerReasoningCapability = { kind: 'effort', supported_levels: ['high', 'max'], default_level: 'high', disable_supported: true };
const reasoningControl = (surface: HTMLElement) => surface.querySelector<HTMLElement>('[data-flower-composer-control="model_reasoning"] .flower-reasoning-control-segment');
const modelControl = (surface: HTMLElement) => surface.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger');
let fixtureID = 0;
function fixture() {
  let preferences: FlowerConversationPreferences = { revision: 1, model_id: modelA, working_dir: '/project-a', reasoning_by_model: { [modelA]: { level: 'high' }, [modelB]: { level: 'off' } } };
  const old = thread({ model_id: modelB, working_dir: '/project-b', reasoning_selection: { level: 'off' }, reasoning_capability: capability });
  const settings = () => {
    const value = settingsSnapshot();
    return { ...value, conversation_preferences: preferences, model_profile: { ...value.model_profile!, providers: value.model_profile!.providers.map(provider => ({ ...provider, models: [
      { ...provider.models[0], model_name: 'gpt-5.2', reasoning_capability: capability },
      { ...provider.models[0], model_name: 'gpt-5.2-pro', reasoning_capability: capability },
    ] })) } };
  };
  const save = vi.fn(async (patch: FlowerConversationPreferencePatch) => {
    preferences = { ...preferences, revision: preferences.revision + 1,
      ...(patch.model_id ? { model_id: patch.model_id } : {}),
      ...(patch.working_dir ? { working_dir: patch.working_dir } : {}),
      reasoning_by_model: { ...preferences.reasoning_by_model, ...(patch.reasoning ? { [patch.reasoning.model_id]: patch.reasoning.selection } : {}) },
    };
    return preferences;
  });
  const base = { ...adapter(true), runtime: { ...adapter(true).runtime, runtime_id: `preferences-${++fixtureID}` },
    loadSettings: vi.fn(async () => settings()), saveConversationPreferences: save,
    listThreads: vi.fn(async () => [old]), loadThread: vi.fn(async () => liveBootstrap(old)),
    setThreadModel: vi.fn(async () => liveBootstrap(old)),
    setThreadReasoningSelection: vi.fn(async () => liveBootstrap({ ...old, reasoning_selection: { level: 'max' as const } })),
    getWorkingDirectoryPathContext: async () => ({ agentHomePathAbs: '/home/test', homePathAbs: '/home/test', defaultRootId: 'home', roots: [{ id: 'home', label: 'Home', pathAbs: '/home/test', kind: 'home' as const, permissions: { read: true, write: true } }] }),
    listWorkingDirectoryEntries: vi.fn(async () => []),
  };
  const drafts = createFlowerComposerDraftCoordinator();
  return { base, drafts, save, preferences: () => preferences };
}
async function selectOld(surface: HTMLElement) {
  await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')));
  surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
  await waitFor(() => reasoningControl(surface)?.textContent?.includes('Off') === true);
}
async function chooseReasoning(surface: HTMLElement, label: string) {
  reasoningControl(surface)!.querySelector('button')!.click();
  const item = Array.from(reasoningControl(surface)!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find(button => button.textContent?.trim() === label);
  expect(item).toBeDefined();
  item!.click();
}
function newChat(surface: HTMLElement) {
  surface.querySelector<HTMLButtonElement>('button[aria-label="New chat"]')!.click();
}
beforeEach(async () => { await page.viewport(1280, 900); });

describe('Flower personal new-conversation preferences', () => {
  it('does not remember thread hydration and restores the remembered configuration on New', async () => {
    const f = fixture();
    const surface = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('High') === true);
    expect(surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')?.title).toContain('/project-a');
    await selectOld(surface);
    expect(f.save).not.toHaveBeenCalled();
    newChat(surface);
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('High') === true);
    expect(f.drafts.read('__new_thread__').value.model_id).toBe(modelA);
    expect(f.drafts.read('__new_thread__').value.model_id_override).toBeUndefined();
    expect(surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')?.title).toContain('/project-a');
    expect(f.save).not.toHaveBeenCalled();
  });

  it('remembers only reasoning for an old model, including same-value selection', async () => {
    const f = fixture();
    const surface = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await selectOld(surface);
    await chooseReasoning(surface, 'Off');
    await waitFor(() => f.save.mock.calls.length === 1);
    expect(f.base.setThreadReasoningSelection).not.toHaveBeenCalled();
    expect(f.save).toHaveBeenCalledWith({ reasoning: { model_id: modelB, selection: { level: 'off' } } });
    expect(f.preferences().model_id).toBe(modelA);
    expect(f.preferences().working_dir).toBe('/project-a');
    newChat(surface);
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('High') === true);
  });

  it('allows reselecting the current old-thread model without copying its directory or reasoning', async () => {
    const f = fixture();
    const surface = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await selectOld(surface);
    modelControl(surface)!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-model-menu-item[aria-selected="true"]')));
    document.querySelector<HTMLButtonElement>('.flower-model-menu-item[aria-selected="true"]')!.click();
    await waitFor(() => f.save.mock.calls.length === 1);
    expect(f.base.setThreadModel).not.toHaveBeenCalled();
    expect(f.save).toHaveBeenCalledWith({ model_id: modelB });
    expect(f.preferences().working_dir).toBe('/project-a');
    expect(f.preferences().reasoning_by_model[modelB]).toEqual({ level: 'off' });
    newChat(surface);
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('Off') === true);
    expect(f.drafts.read('__new_thread__').value.model_id).toBe(modelB);
  });

  it('remembers a new-draft selection without sending and restores it with a fresh coordinator', async () => {
    const f = fixture();
    let surface = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('High') === true);
    await chooseReasoning(surface, 'Off');
    await waitFor(() => f.save.mock.calls.length === 1);
    expect(f.save).toHaveBeenCalledWith({ reasoning: { model_id: modelA, selection: { level: 'off' } } });
    expect(f.base.launchTurn).not.toHaveBeenCalled();
    disposeRenderedSurface(surface); surface.remove();
    surface = renderSurfaceWithDraftCoordinator(f.base, createFlowerComposerDraftCoordinator());
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('Off') === true);
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it('blocks preference edits until the current settings revision is confirmed', async () => {
    const f = fixture();
    const old = await f.base.loadSettings();
    const stale = deferred<typeof old>();
    f.base.loadSettings = vi.fn().mockResolvedValueOnce(old).mockReturnValueOnce(stale.promise).mockResolvedValue(old);
    const [revision, setRevision] = createSignal(0);
    const surface = renderSurfaceWithAdapterProps({ ...f.base, loadModelDirectory: async () => modelDirectoryFixture(old) }, { settingsRevision: revision });
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('High') === true);
    setRevision(1);
    await waitFor(() => f.base.loadSettings.mock.calls.length === 2);
    expect(modelControl(surface)!.disabled).toBe(true);
    modelControl(surface)!.click();
    expect(document.querySelector('.flower-model-menu-item')).toBeNull();
    expect(f.save).not.toHaveBeenCalled();
    stale.resolve(old);
    await waitFor(() => !modelControl(surface)!.disabled);
    modelControl(surface)!.click();
    await waitFor(() => Boolean(document.querySelector('.flower-model-menu-item')));
    Array.from(document.querySelectorAll<HTMLButtonElement>('.flower-model-menu-item')).find(item => item.textContent?.includes('gpt-5.2-pro'))!.click();
    await waitFor(() => f.save.mock.calls.length === 1 && f.preferences().model_id === modelB);
    newChat(surface);
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('Off') === true);
    expect(modelControl(surface)?.textContent).toContain('gpt-5.2-pro');
    expect(f.save).toHaveBeenCalledTimes(1);
  });

  it('freezes inherited defaults while editing and uses the latest preference only for a true new chat', async () => {
    const f = fixture();
    const surface = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('High') === true);
    await userEvent.fill(surface.querySelector<HTMLTextAreaElement>('textarea')!, 'Keep editing A');
    await waitFor(() => f.drafts.read('__new_thread__').value.inherited_defaults?.model_id === modelA);
    disposeRenderedSurface(surface); surface.remove();
    await f.save({ model_id: modelB, working_dir: '/project-c' });
    const restored = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await waitFor(() => reasoningControl(restored)?.textContent?.includes('High') === true);
    expect(restored.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('Keep editing A');
    expect(modelControl(restored)?.textContent).toContain('gpt-5.2');
    expect(restored.querySelector('.flower-working-directory-select')?.getAttribute('aria-label')).toContain('/project-a');
    newChat(restored);
    await waitFor(() => reasoningControl(restored)?.textContent?.includes('Off') === true);
    expect(f.drafts.read('__new_thread__').value.model_id).toBe(modelB);
    expect(restored.querySelector('.flower-working-directory-select')?.getAttribute('aria-label')).toContain('/project-c');
  });

  it('preserves unavailable inherited reasoning in the frozen admission request instead of silently dropping it', async () => {
    const f = fixture();
    const snapshot = await f.base.loadSettings();
    f.base.loadSettings = vi.fn(async () => ({ ...snapshot, model_profile: { ...snapshot.model_profile!, providers: snapshot.model_profile!.providers.map(provider => ({ ...provider, models: provider.models.map(model => ({ ...model, reasoning_capability: { kind: 'none' } })) })) } }));
    const launch = vi.spyOn(f.base, 'launchTurn');
    const surface = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await waitFor(() => modelControl(surface)?.textContent?.includes('gpt-5.2') === true);
    await userEvent.fill(surface.querySelector<HTMLTextAreaElement>('textarea')!, 'Keep my reasoning intent');
    const submit = surface.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
    await waitFor(() => !submit.disabled);
    submit.click();
    await waitFor(() => launch.mock.calls.length === 1);
    expect(launch.mock.calls[0][0]).toMatchObject({ model_id: modelA, working_dir: '/project-a', reasoning_selection: { level: 'high' } });
    expect(f.save).not.toHaveBeenCalled();
  });

  it('remembers only a confirmed directory, not browsing or cancellation', async () => {
    const f = fixture();
    const surface = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await waitFor(() => Boolean(surface.querySelector('.flower-working-directory-select')) && Boolean(modelControl(surface)?.textContent?.includes('gpt-5.2')));
    const open = async () => {
      surface.querySelector<HTMLButtonElement>('.flower-working-directory-select')!.click();
      await waitFor(() => Boolean(document.querySelector('[role="dialog"]')));
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      const tab = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(item => item.textContent === 'Home');
      tab?.click();
      await waitFor(() => Boolean(dialog.querySelector('input[aria-label="Directory path"]')));
      return dialog;
    };
    let dialog = await open();
    await userEvent.fill(dialog.querySelector<HTMLInputElement>('input[aria-label="Directory path"]')!, '/home/test/chosen');
    Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === 'Cancel')!.click();
    await waitFor(() => !document.querySelector('[role="dialog"]'));
    expect(f.save).not.toHaveBeenCalled();
    dialog = await open();
    const confirm = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === 'Select')!;
    await waitFor(() => !confirm().disabled);
    confirm().click();
    await waitFor(() => f.save.mock.calls.length === 1);
    expect(f.save.mock.calls[0][0]).toEqual({ working_dir: '/home/test' });
    expect(f.preferences().model_id).toBe(modelA);
  });

  it('keeps a successful old-thread change when remembering fails and does not mutate the next draft', async () => {
    const f = fixture();
    const save = deferred<FlowerConversationPreferences>();
    f.base.saveConversationPreferences = vi.fn(() => save.promise);
    const surface = renderSurfaceWithDraftCoordinator(f.base, f.drafts);
    await selectOld(surface);
    await chooseReasoning(surface, 'Max');
    await waitFor(() => f.base.saveConversationPreferences.mock.calls.length === 1);
    newChat(surface);
    await userEvent.fill(surface.querySelector<HTMLTextAreaElement>('textarea')!, 'A fresh draft');
    save.reject(new Error('Cannot remember preference'));
    await waitFor(() => reasoningControl(surface)?.textContent?.includes('High') === true);
    expect(f.drafts.read('__new_thread__').value.text).toBe('A fresh draft');
    expect(f.drafts.read('__new_thread__').value.reasoning_selection).toBeUndefined();
    expect(f.base.setThreadReasoningSelection).toHaveBeenCalledTimes(1);
  });
});
