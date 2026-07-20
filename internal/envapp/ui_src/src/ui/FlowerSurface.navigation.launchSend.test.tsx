// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
  FlowerRouterDecision,
  FlowerSettingsSnapshot,
  FlowerTurnLaunchReceipt,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { flowerTurnAdmissionUncertainFailure } from '../../../../flower_ui/src/flowerTurnAdmission';
import {
  adapter,
  decision,
  deferred,
  flush,
  flowerSurfaceNotifications,
  inputRequest,
  launchReceipt,
  activityItem,
  activityTimeline,
  liveBootstrap,
  modelIOStatus,
  mutableSettingsAdapter,
  renderSurfaceWithAdapter,
  settingsSnapshot,
  subagentSummary,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function selectedThreadReady(root: ParentNode, threadID: string): boolean {
  const surface = root.querySelector('#redeven-flower-surface');
  return surface?.getAttribute('data-flower-selected-thread-id') === threadID
    && surface?.getAttribute('data-flower-selected-thread-loading') === 'false';
}

function withCanonicalUserTurnID<T extends { readonly messages: readonly { readonly id: string }[] }>(threadValue: T, userEntryID: string, turnID: string): T {
  return {
    ...threadValue,
    messages: threadValue.messages.map((message) => (
      message.id === userEntryID ? { ...message, turn_id: turnID } : message
    )),
  } as T;
}

function layoutRect(width: number, height = 22): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function installComposerControlLayoutHarness(input: {
  availableWidth: number;
  itemWidths?: Partial<Record<string, number>>;
  moreWidth?: number;
}) {
  const records: Array<{ callback: ResizeObserverCallback; elements: Element[] }> = [];
  vi.stubGlobal('ResizeObserver', class {
    private readonly record: { callback: ResizeObserverCallback; elements: Element[] };

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, elements: [] };
      records.push(this.record);
    }

    observe(element: Element) {
      this.record.elements.push(element);
    }

    unobserve(element: Element) {
      this.record.elements = this.record.elements.filter((item) => item !== element);
    }

    disconnect() {
      this.record.elements = [];
    }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function composerControlRect(this: HTMLElement) {
    if (this.classList.contains('flower-composer-controls-viewport')) {
      return layoutRect(input.availableWidth);
    }
    const itemID = this.getAttribute('data-flower-composer-control-measure');
    if (itemID) {
      return layoutRect(input.itemWidths?.[itemID] ?? 80);
    }
    if (this.getAttribute('data-flower-composer-more-measure') === 'true') {
      return layoutRect(input.moreWidth ?? 30);
    }
    return layoutRect(0);
  });

  return {
    trigger() {
      for (const record of records) {
        record.callback(
          record.elements.map((target) => ({ target }) as ResizeObserverEntry),
          {} as ResizeObserver,
        );
      }
    },
  };
}

const DESKTOP_MODEL_ID = `desktop:model_${'c'.repeat(64)}`;

function dualSourceSnapshot(input: Readonly<{
  remoteReady?: boolean;
  desktopReady?: boolean;
  remoteCurrentModelID?: string;
}> = {}): FlowerSettingsSnapshot {
  const base = settingsSnapshot(input.remoteReady ?? true);
  return {
    ...base,
    model_profile: {
      ...base.model_profile!,
      current_model_id: input.remoteCurrentModelID ?? 'openai/gpt-5.2',
      providers: [{
        ...base.model_profile!.providers[0],
        models: [
          ...base.model_profile!.providers[0].models,
          { model_name: 'gpt-5.4', context_window: 400000, input_modalities: ['text'] },
        ],
      }],
    },
    model_source: input.desktopReady ?? true
      ? {
          kind: 'desktop_model_source',
          state: 'ready',
          current_model_id: DESKTOP_MODEL_ID,
          label: 'Desktop',
          models: [{
            id: DESKTOP_MODEL_ID,
            label: 'Desktop / Local Model',
            context_window: 200000,
            input_modalities: ['text'],
          }],
        }
      : {
          kind: 'desktop_model_source',
          state: 'error',
          label: 'Desktop',
          diagnostic_message: 'Desktop model bridge binding failed.',
        },
  };
}

describe('FlowerSurface navigation launch/send', () => {
  it('groups remote and Desktop models while keeping Desktop selection session scoped', async () => {
    const snapshot = dualSourceSnapshot();
    const persistDefaultModel = vi.fn(async () => snapshot);
    const launchTurn = vi.fn(async (input: { model_id?: string; turn_id?: string }) => (
      launchReceipt('thread-desktop-session-draft', input.turn_id ?? 'turn-desktop-session')
    ));
    const surfaceAdapter = {
      ...adapter(true),
      runtime: {
        ...adapter(true).runtime,
        display_name: 'Demo Env',
      },
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel,
      launchTurn,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('gpt-5.2') ?? false);
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-model-menu-group-label').length === 2);
    expect(Array.from(runtime.querySelectorAll('.flower-model-menu-group-label')).map((label) => label.textContent?.trim())).toEqual([
      'Demo Env',
      'Desktop',
    ]);
    expect(Array.from(runtime.querySelectorAll('[data-model-source]')).map((item) => item.getAttribute('data-model-source'))).toEqual([
      'model_profile',
      'model_profile',
      'desktop_model_source',
    ]);

    const desktopOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('Desktop / Local Model')) as HTMLButtonElement;
    desktopOption.click();
    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('Desktop / Local Model') ?? false);
    expect(persistDefaultModel).not.toHaveBeenCalled();

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'use Desktop for this window';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      model_id: DESKTOP_MODEL_ID,
    }));

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .some((item) => item.textContent?.includes('Desktop / Local Model')));
    expect(persistDefaultModel).not.toHaveBeenCalled();

    const remounted = renderSurfaceWithAdapter(surfaceAdapter);
    await waitFor(() => remounted.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('gpt-5.2') ?? false);
    expect(remounted.querySelector('.flower-model-reasoning-model-trigger')?.textContent).not.toContain('Desktop / Local Model');
  });

  it('persists remote selections as the next Env default', async () => {
    let snapshot = dualSourceSnapshot();
    const persistDefaultModel = vi.fn(async (modelID: string) => {
      snapshot = {
        ...snapshot,
        model_profile: {
          ...snapshot.model_profile!,
          current_model_id: modelID,
        },
      };
      return snapshot;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel,
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const remoteOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('gpt-5.4')) as HTMLButtonElement;
    remoteOption.click();

    await waitFor(() => persistDefaultModel.mock.calls.length === 1);
    expect(persistDefaultModel).toHaveBeenCalledWith('openai/gpt-5.4');
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('gpt-5.4');

    const remounted = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel,
    });
    await waitFor(() => remounted.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('gpt-5.4') ?? false);
  });

  it('patches Desktop onto an existing thread without changing the remote default', async () => {
    const snapshot = dualSourceSnapshot();
    let selectedThread = thread({
      thread_id: 'thread-desktop-isolated',
      title: 'Desktop isolated',
      model_id: 'openai/gpt-5.2',
    });
    const setThreadModel = vi.fn(async (_threadID: string, modelID: string) => {
      selectedThread = { ...selectedThread, model_id: modelID };
      return liveBootstrap(selectedThread);
    });
    const persistDefaultModel = vi.fn(async () => snapshot);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => [selectedThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedThread)),
      setThreadModel,
      persistDefaultModel,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-desktop-isolated"] button')));
    (runtime.querySelector('[data-thread-id="thread-desktop-isolated"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-desktop-isolated'));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const desktopOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('Desktop / Local Model')) as HTMLButtonElement;
    desktopOption.click();

    await waitFor(() => setThreadModel.mock.calls.length === 1);
    expect(setThreadModel).toHaveBeenCalledWith('thread-desktop-isolated', DESKTOP_MODEL_ID);
    expect(persistDefaultModel).not.toHaveBeenCalled();
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('Desktop / Local Model');

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await waitFor(() => {
      const trigger = runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger');
      return Boolean(trigger && !trigger.disabled && trigger.textContent?.includes('gpt-5.2'));
    });
    (runtime.querySelector('[data-thread-id="thread-desktop-isolated"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('Desktop / Local Model') ?? false);
  });

  it('keeps model switching available when the selected source is unavailable', async () => {
    const snapshot = dualSourceSnapshot({ remoteReady: false, desktopReady: true });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel: vi.fn(async () => snapshot),
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    expect(runtime.querySelector('.flower-model-reasoning-warning')).toBeTruthy();
    expect((runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).disabled).toBe(false);
    expect((runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(runtime.querySelector('.flower-setup-inline')).toBeNull();
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const desktopOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('Desktop / Local Model')) as HTMLButtonElement;
    desktopOption.click();
    await waitFor(() => runtime.querySelector('.flower-model-reasoning-warning') === null);
  });

  it('keeps the remote default ready when the optional Desktop source is unavailable', async () => {
    const snapshot = dualSourceSnapshot({ remoteReady: true, desktopReady: false });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel: vi.fn(async () => snapshot),
    });

    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent?.includes('gpt-5.2') ?? false);
    expect(runtime.querySelector('.flower-model-reasoning-warning')).toBeNull();
    expect(runtime.querySelector('.flower-setup-inline')).toBeNull();
    expect((runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses only the compact setup footer when no source has a usable model', async () => {
    const snapshot = dualSourceSnapshot({ remoteReady: false, desktopReady: false });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel: vi.fn(async () => snapshot),
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-source-status-footer')));
    expect(runtime.querySelector('.flower-empty-state')).toBeTruthy();
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
    expect(runtime.querySelector('.flower-model-reasoning-control')).toBeNull();
  });

  it('refreshes only the settings snapshot and preserves the composer session', async () => {
    const readySnapshot = dualSourceSnapshot({ remoteReady: false, desktopReady: true });
    const initialSnapshot: FlowerSettingsSnapshot = {
      ...readySnapshot,
      model_source: {
        kind: 'desktop_model_source',
        state: 'empty',
        label: 'Desktop',
      },
    };
    let currentSnapshot = initialSnapshot;
    const loadSettings = vi.fn(async () => currentSnapshot);
    const listThreads = vi.fn(async () => []);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings,
      listThreads,
      modelSourceRecovery: {
        describe: () => 'Desktop has no usable model.',
        localSettings: { label: 'Local Flower settings', run: vi.fn(async () => undefined) },
        runtimeSettings: { label: 'Runtime settings', run: vi.fn(async () => undefined) },
        connectionCenter: { label: 'Connection center', run: vi.fn(async () => undefined) },
      },
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-source-status')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'keep this draft';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    currentSnapshot = readySnapshot;
    (runtime.querySelector('.flower-model-source-status-refresh') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-trigger')));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .some((item) => item.textContent?.includes('Desktop / Local Model')));
    expect(textarea.value).toBe('keep this draft');
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(loadSettings).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing_keys', 'local_settings'],
    ['empty', 'local_settings'],
    ['unsupported', 'runtime_settings'],
    ['unbound', 'connection_center'],
    ['connecting', 'connection_center'],
    ['expired', 'connection_center'],
    ['error', 'connection_center'],
  ] as const)('routes Desktop source state %s to %s', async (state, expectedAction) => {
    const localSettings = vi.fn(async () => undefined);
    const runtimeSettings = vi.fn(async () => undefined);
    const connectionCenter = vi.fn(async () => undefined);
    const source = state === 'missing_keys'
      ? { kind: 'desktop_model_source' as const, state, label: 'Desktop' as const, missing_key_provider_ids: ['openai'] }
      : state === 'error'
        ? { kind: 'desktop_model_source' as const, state, label: 'Desktop' as const, diagnostic_message: 'Binding failed.' }
        : { kind: 'desktop_model_source' as const, state, label: 'Desktop' as const };
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: vi.fn(async () => ({
        defaults: { permission_type: 'approval_required' as const },
        model_profile: null,
        provider_secrets: [],
        model_source: source,
      })),
      listThreads: vi.fn(async () => []),
      modelSourceRecovery: {
        describe: () => `Desktop source is ${state}.`,
        localSettings: { label: 'Local Flower settings', run: localSettings },
        runtimeSettings: { label: 'Runtime settings', run: runtimeSettings },
        connectionCenter: { label: 'Connection center', run: connectionCenter },
      },
    });

    await waitFor(() => runtime.querySelector('.flower-model-source-status')?.getAttribute('data-state') === state);
    const message = runtime.querySelector('.flower-model-source-status-message') as HTMLElement;
    expect(message.title).toBe(message.textContent);
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
    (runtime.querySelector(`[data-model-source-action="${expectedAction}"]`) as HTMLButtonElement).click();

    await waitFor(() => localSettings.mock.calls.length + runtimeSettings.mock.calls.length + connectionCenter.mock.calls.length === 1);
    expect(localSettings).toHaveBeenCalledTimes(expectedAction === 'local_settings' ? 1 : 0);
    expect(runtimeSettings).toHaveBeenCalledTimes(expectedAction === 'runtime_settings' ? 1 : 0);
    expect(connectionCenter).toHaveBeenCalledTimes(expectedAction === 'connection_center' ? 1 : 0);
  });

  it('keeps an unavailable thread model as a disabled ungrouped snapshot option', async () => {
    const snapshot = dualSourceSnapshot();
    const unavailableModelID = `desktop:model_${'d'.repeat(64)}`;
    const staleThread = thread({ thread_id: 'thread-stale-model', model_id: unavailableModelID });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => snapshot),
      listThreads: vi.fn(async () => [staleThread]),
      loadThread: vi.fn(async () => liveBootstrap(staleThread)),
      setThreadModel: vi.fn(async () => liveBootstrap(staleThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-model"] button')));
    (runtime.querySelector('[data-thread-id="thread-stale-model"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-stale-model'));
    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-model-source="thread_snapshot"]')));

    const staleOption = runtime.querySelector('[data-model-source="thread_snapshot"]') as HTMLButtonElement;
    expect(staleOption.disabled).toBe(true);
    expect(staleOption.closest('[data-model-source-group]')).toBeNull();
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain(unavailableModelID);
  });

  it('patches an existing thread permission from the composer footer', async () => {
    const baseThread = thread({
      thread_id: 'thread-permission-existing',
      title: 'Permission existing',
      permission_type: 'approval_required',
    });
    const updatedThread = {
      ...baseThread,
      permission_type: 'full_access' as const,
      updated_at_ms: baseThread.updated_at_ms + 1,
    };
    const setThreadPermissionType = vi.fn(async () => liveBootstrap(updatedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [baseThread]),
      loadThread: vi.fn(async () => liveBootstrap(baseThread)),
      setThreadPermissionType,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-permission-existing"] button')));
    (runtime.querySelector('[data-thread-id="thread-permission-existing"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-permission-existing'));
    await waitFor(() => Boolean(runtime.querySelector('button.flower-permission-trigger[data-permission-type="approval_required"]')));

    const trigger = runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    trigger.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]') as HTMLButtonElement).click();
    await waitFor(() => setThreadPermissionType.mock.calls.length === 1);

    expect(setThreadPermissionType).toHaveBeenCalledWith('thread-permission-existing', 'full_access');
    await waitFor(() => runtime.querySelector('button.flower-permission-trigger')?.getAttribute('data-permission-type') === 'full_access');
  });

  it('does not reselect a thread when a permission patch resolves after switching away', async () => {
    const baseThread = thread({
      thread_id: 'thread-permission-slow-source',
      title: 'Permission slow source',
      permission_type: 'approval_required',
    });
    const targetThread = thread({
      thread_id: 'thread-permission-switch-target',
      title: 'Permission switch target',
      permission_type: 'approval_required',
      messages: [{
        id: 'm-permission-switch-target',
        role: 'assistant',
        content: 'Target thread remains selected.',
        status: 'complete',
        created_at_ms: 5,
      }],
    });
    const updatedThread = {
      ...baseThread,
      permission_type: 'full_access' as const,
      updated_at_ms: baseThread.updated_at_ms + 1,
    };
    const permissionPatch = deferred<FlowerLiveBootstrap>();
    const setThreadPermissionType = vi.fn(async () => permissionPatch.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [targetThread, baseThread]),
      loadThread: vi.fn(async (threadID: string) => liveBootstrap(threadID === targetThread.thread_id ? targetThread : baseThread)),
      setThreadPermissionType,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-permission-slow-source"] button')));
    (runtime.querySelector('[data-thread-id="thread-permission-slow-source"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-permission-slow-source'));
    (runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]') as HTMLButtonElement).click();
    await waitFor(() => setThreadPermissionType.mock.calls.length === 1);

    (runtime.querySelector('[data-thread-id="thread-permission-switch-target"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-permission-switch-target'));

    permissionPatch.resolve(liveBootstrap(updatedThread));
    await flush();

    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-permission-switch-target');
    expect(runtime.textContent).toContain('Target thread remains selected.');
    expect(runtime.querySelector('button.flower-permission-trigger')?.getAttribute('data-permission-type')).toBe('approval_required');
  });

  it('keeps the permission selector available while a thread is running', async () => {
    const runningThread = thread({
      thread_id: 'thread-permission-running',
      title: 'Permission running',
      status: 'running',
      active_run_id: 'run-permission-running',
      permission_type: 'approval_required',
      model_io_status: modelIOStatus({ run_id: 'run-permission-running' }),
    });
    const updatedThread = {
      ...runningThread,
      permission_type: 'readonly' as const,
      updated_at_ms: runningThread.updated_at_ms + 1,
    };
    const setThreadPermissionType = vi.fn(async () => liveBootstrap(updatedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      setThreadPermissionType,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-permission-running"] button')));
    (runtime.querySelector('[data-thread-id="thread-permission-running"] button') as HTMLButtonElement).click();
    await waitFor(() => {
      const trigger = runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement | null;
      return !!trigger && trigger.getAttribute('data-permission-type') === 'approval_required' && !trigger.disabled;
    });

    (runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="readonly"]') as HTMLButtonElement).click();
    await waitFor(() => setThreadPermissionType.mock.calls.length === 1);

    expect(setThreadPermissionType).toHaveBeenCalledWith('thread-permission-running', 'readonly');
  });

  it('rolls back a failed thread permission patch', async () => {
    const baseThread = thread({
      thread_id: 'thread-permission-failed',
      title: 'Permission failed',
      permission_type: 'approval_required',
    });
    const setThreadPermissionType = vi.fn(async () => {
      throw new Error('permission denied');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [baseThread]),
      loadThread: vi.fn(async () => liveBootstrap(baseThread)),
      setThreadPermissionType,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-permission-failed"] button')));
    (runtime.querySelector('[data-thread-id="thread-permission-failed"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('button.flower-permission-trigger[data-permission-type="approval_required"]')));

    (runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]') as HTMLButtonElement).click();
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message === 'permission denied'));

    expect(runtime.querySelector('button.flower-permission-trigger')?.getAttribute('data-permission-type')).toBe('approval_required');
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Flower could not save permission.',
      message: 'permission denied',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
  });

  it('sends the local permission draft when launching a new thread', async () => {
    const launchedThread = thread({
      thread_id: 'thread-permission-new',
      title: 'Permission new',
      permission_type: 'full_access',
      messages: [
        {
          id: 'm-permission-new-user',
          role: 'user',
          content: 'start with full access',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(launchedThread.thread_id, input.turn_id ?? 'turn-permission-new'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async () => liveBootstrap(launchedThread)),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('button.flower-permission-trigger[data-permission-type="approval_required"]')));
    (runtime.querySelector('button.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-menu')));
    (runtime.querySelector('.flower-permission-menu-item[data-permission-type="full_access"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('button.flower-permission-trigger')?.getAttribute('data-permission-type') === 'full_access');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start with full access';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'start with full access',
      permission_type: 'full_access',
    }));
  });

  it('selects a working directory before launching a new thread', async () => {
    const launchedThread = thread({
      thread_id: 'thread-working-dir-new',
      title: 'Working dir new',
      working_dir: '/Users/alice/redeven',
      messages: [
        {
          id: 'm-working-dir-user',
          role: 'user',
          content: 'start in redeven',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const getWorkingDirectoryPathContext = vi.fn(async () => ({
      agentHomePathAbs: '/Users/alice',
      homePathAbs: '/Users/alice',
      defaultRootId: 'home',
      roots: [
        {
          id: 'home',
          label: 'Home',
          pathAbs: '/Users/alice',
          kind: 'home',
          permissions: { read: true, write: true },
        },
      ],
    }));
    const listWorkingDirectoryEntries = vi.fn(async (input: { path: string; showHidden?: boolean }) => {
      if (input.path === '/Users/alice') {
        return [
          {
            name: 'redeven',
            path: '/Users/alice/redeven',
            isDirectory: true,
            modifiedAt: 1,
          },
        ];
      }
      return [];
    });
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(launchedThread.thread_id, input.turn_id ?? 'turn-working-dir-new'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async () => liveBootstrap(launchedThread)),
      getWorkingDirectoryPathContext,
      listWorkingDirectoryEntries,
      launchTurn,
    });

    await waitFor(() => runtime.querySelector('.flower-composer-footer .flower-working-dir-chip')?.textContent?.includes('alice') === true);
    expect(runtime.querySelector('.flower-chat-header .flower-working-dir-chip')).toBeNull();
    expect(runtime.querySelector('[data-flower-composer-more-panel="true"]')).toBeNull();
    const chip = runtime.querySelector('.flower-composer-footer .flower-working-dir-chip') as HTMLButtonElement;
    expect(chip.getAttribute('title')).toContain('/Users/alice');
    chip.click();

    await waitFor(() => Boolean(runtime.querySelector('[data-directory-picker-entry="/redeven"]')));
    (runtime.querySelector('[data-directory-picker-entry="/redeven"]') as HTMLButtonElement).click();
    (runtime.querySelector('[data-directory-picker-confirm="true"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-composer-footer .flower-working-dir-chip')?.textContent?.includes('redeven') === true);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start in redeven';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'start in redeven',
      working_dir: '/Users/alice/redeven',
    }));
    expect(listWorkingDirectoryEntries).toHaveBeenCalledWith({
      path: '/Users/alice',
      showHidden: false,
    });
  });

  it('keeps composer controls inline when footer space is sufficient', async () => {
    const layout = installComposerControlLayoutHarness({
      availableWidth: 720,
      itemWidths: {
        working_dir: 118,
        permission: 94,
        model_reasoning: 248,
      },
      moreWidth: 30,
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      getWorkingDirectoryPathContext: vi.fn(async () => ({
        agentHomePathAbs: '/Users/alice',
        homePathAbs: '/Users/alice',
        defaultRootId: 'home',
        roots: [],
      })),
      listWorkingDirectoryEntries: vi.fn(async () => []),
    });

    layout.trigger();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-controls="true"]')));
    expect(runtime.querySelector('.flower-chat-header .flower-working-dir-chip')).toBeNull();
    expect(runtime.querySelector('[data-flower-composer-inline-item="working_dir"] .flower-working-dir-chip')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-inline-item="permission"] .flower-permission-trigger')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-inline-item="model_reasoning"] .flower-model-reasoning-control')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-more-panel="true"]')).toBeNull();
    expect(runtime.querySelector('button.flower-composer-more-button')).toBeNull();
  });

  it('hides reasoning for models without reasoning support and omits stale reasoning on launch', async () => {
    let currentSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(true),
      model_profile: {
        ...settingsSnapshot(true).model_profile!,
        current_model_id: 'openai/gpt-5.2',
        providers: [{
          ...settingsSnapshot(true).model_profile!.providers[0],
          models: [
            {
              model_name: 'gpt-5.2',
              context_window: 400000,
              input_modalities: ['text'],
              reasoning_capability: {
                supported_levels: ['low', 'medium', 'high'],
                default_level: 'medium',
              },
              default_reasoning_selection: { level: 'medium' },
            },
            {
              model_name: 'plain-text',
              context_window: 200000,
              input_modalities: ['text'],
            },
          ],
        }],
      },
    };
    const launchedThread = thread({
      thread_id: 'thread-no-reasoning-launch',
      title: 'No reasoning launch',
      model_id: 'openai/plain-text',
    });
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(launchedThread.thread_id, input.turn_id ?? 'turn-model-capability'));
    const surfaceAdapter = {
      ...adapter(true),
      loadSettings: vi.fn(async () => currentSnapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel: vi.fn(async (modelID: string) => {
        currentSnapshot = {
          ...currentSnapshot,
          model_profile: {
            ...currentSnapshot.model_profile!,
            current_model_id: modelID,
          },
        };
        return currentSnapshot;
      }),
      launchTurn,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);
    const modelReasoningControl = () => runtime.querySelector('[data-flower-composer-control="model_reasoning"]') as HTMLElement | null;

    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'true');
    expect(runtime.querySelector('.flower-reasoning-control-segment')).toBeTruthy();

    (runtime.querySelector('.flower-reasoning-segment-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-reasoning-menu')));
    const highOption = Array.from(runtime.querySelectorAll('.flower-reasoning-menu-item'))
      .find((button) => button.textContent?.trim() === 'High') as HTMLButtonElement | undefined;
    highOption?.click();
    await waitFor(() => runtime.querySelector('.flower-reasoning-segment-button')?.textContent?.includes('High') === true);

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const plainOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('plain-text')) as HTMLButtonElement | undefined;
    plainOption?.click();

    await waitFor(() => surfaceAdapter.persistDefaultModel.mock.calls.length === 1);
    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'false');
    expect(surfaceAdapter.persistDefaultModel).toHaveBeenCalledWith('openai/plain-text');
    expect(runtime.querySelector('.flower-reasoning-control-segment')).toBeNull();

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'launch without reasoning';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'launch without reasoning',
      model_id: 'openai/plain-text',
    }));
    const launchInput = launchTurn.mock.calls[0]?.[0];
    expect(launchInput).not.toHaveProperty('reasoning_selection');
  });

  it('selects opaque Desktop models and reasoning before launching a new thread', async () => {
    const deepSeekModelID = `desktop:model_${'3'.repeat(64)}`;
    const plainModelID = `desktop:model_${'4'.repeat(64)}`;
    let currentSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(false),
      model_profile: null,
      provider_secrets: [],
      model_source: {
        kind: 'desktop_model_source',
        state: 'ready',
        current_model_id: deepSeekModelID,
        label: 'Desktop',
        models: [
          {
            id: deepSeekModelID,
            label: 'Desktop / DeepSeek / deepseek-v4-pro',
            context_window: 950000,
            max_output_tokens: 384000,
            input_modalities: ['text'],
            reasoning_capability: {
              kind: 'effort',
              supported_levels: ['high', 'max'],
              default_level: 'high',
              wire_shape: 'deepseek_reasoning_effort',
            },
          },
          {
            id: plainModelID,
            label: 'Desktop / Plain',
            context_window: 128000,
            max_output_tokens: 4096,
            input_modalities: ['text'],
          },
        ],
      },
    };
    const launchedThread = thread({
      thread_id: 'thread-desktop-source-launch',
      title: 'Desktop source launch',
      model_id: deepSeekModelID,
      reasoning_selection: { level: 'high' },
    });
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(launchedThread.thread_id, input.turn_id ?? 'turn-reasoning'));
    const persistDefaultModel = vi.fn(async () => currentSnapshot);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: vi.fn(async () => currentSnapshot),
      listThreads: vi.fn(async () => []),
      persistDefaultModel,
      launchTurn,
    });
    const modelReasoningControl = () => runtime.querySelector('[data-flower-composer-control="model_reasoning"]') as HTMLElement | null;

    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'true');
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('deepseek-v4-pro');
    expect(runtime.querySelector('.flower-reasoning-segment-button')?.textContent).toContain('High');

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-model-menu-item').length === 2);
    expect(Array.from(runtime.querySelectorAll('.flower-model-menu-item')).map((item) => item.textContent)).toEqual([
      expect.stringContaining('deepseek-v4-pro'),
      expect.stringContaining('Desktop / Plain'),
    ]);
    const plainOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('Desktop / Plain')) as HTMLButtonElement | undefined;
    plainOption?.click();
    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'false');
    expect(persistDefaultModel).not.toHaveBeenCalled();

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const deepSeekOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('deepseek-v4-pro')) as HTMLButtonElement | undefined;
    deepSeekOption?.click();
    await waitFor(() => modelReasoningControl()?.getAttribute('data-has-reasoning') === 'true');
    expect(persistDefaultModel).not.toHaveBeenCalled();
    expect(runtime.querySelector('.flower-reasoning-segment-button')?.textContent).toContain('High');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'launch through desktop source';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'launch through desktop source',
      model_id: deepSeekModelID,
      reasoning_selection: { level: 'high' },
    }));
  });

  it('writes a selected thread model as the next new-thread default', async () => {
    let selectedModelThread = thread({
      thread_id: 'thread-model-default',
      title: 'Model default',
      model_id: 'openai/gpt-5.2',
    });
    let currentSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(true),
      model_profile: {
        ...settingsSnapshot(true).model_profile!,
        providers: [{
          ...settingsSnapshot(true).model_profile!.providers[0],
          models: [
            ...settingsSnapshot(true).model_profile!.providers[0].models,
            { model_name: 'gpt-5.4', context_window: 400000, input_modalities: ['text'] },
          ],
        }],
      },
    };
    const surfaceAdapter = {
      ...mutableSettingsAdapter(true),
      loadSettings: vi.fn(async () => currentSnapshot),
      listThreads: vi.fn(async () => [selectedModelThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedModelThread)),
      setThreadModel: vi.fn(async (_threadID: string, modelID: string) => {
        selectedModelThread = {
          ...selectedModelThread,
          model_id: modelID,
        };
        return liveBootstrap(selectedModelThread);
      }),
      persistDefaultModel: vi.fn(async (modelID: string) => {
        currentSnapshot = {
          ...currentSnapshot,
          model_profile: {
            ...currentSnapshot.model_profile!,
            current_model_id: modelID,
          },
        };
        return currentSnapshot;
      }),
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-model-default"] button')));
    (runtime.querySelector('[data-thread-id="thread-model-default"] button') as HTMLButtonElement).click();
    await waitFor(() => {
      const trigger = runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger');
      return Boolean(trigger && !trigger.disabled && trigger.textContent?.includes('gpt-5.2'));
    });

    runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const nextModelOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('gpt-5.4')) as HTMLButtonElement | undefined;
    nextModelOption?.click();

    await waitFor(() => surfaceAdapter.persistDefaultModel.mock.calls.length === 1);
    expect(surfaceAdapter.setThreadModel).toHaveBeenCalledWith('thread-model-default', 'openai/gpt-5.4');
    expect(surfaceAdapter.persistDefaultModel).toHaveBeenCalledWith('openai/gpt-5.4');
    expect(surfaceAdapter.setThreadModel.mock.invocationCallOrder[0]).toBeLessThan(surfaceAdapter.persistDefaultModel.mock.invocationCallOrder[0]);
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('OpenAI / gpt-5.4');
  });

  it('keeps the selected thread model and toasts when updating the future default fails', async () => {
    let selectedModelThread = thread({
      thread_id: 'thread-model-default-fails',
      title: 'Model default failure',
      model_id: 'openai/gpt-5.2',
    });
    const currentSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(true),
      model_profile: {
        ...settingsSnapshot(true).model_profile!,
        current_model_id: 'openai/gpt-5.2',
        providers: [{
          ...settingsSnapshot(true).model_profile!.providers[0],
          models: [
            ...settingsSnapshot(true).model_profile!.providers[0].models,
            { model_name: 'gpt-5.4', context_window: 400000, input_modalities: ['text'] },
          ],
        }],
      },
    };
    const surfaceAdapter = {
      ...mutableSettingsAdapter(true),
      loadSettings: vi.fn(async () => currentSnapshot),
      listThreads: vi.fn(async () => [selectedModelThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedModelThread)),
      setThreadModel: vi.fn(async (_threadID: string, modelID: string) => {
        selectedModelThread = {
          ...selectedModelThread,
          model_id: modelID,
        };
        return liveBootstrap(selectedModelThread);
      }),
      persistDefaultModel: vi.fn(async () => {
        throw new Error('default save failed');
      }),
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-model-default-fails"] button')));
    (runtime.querySelector('[data-thread-id="thread-model-default-fails"] button') as HTMLButtonElement).click();
    await waitFor(() => {
      const trigger = runtime.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger');
      return Boolean(trigger && !trigger.disabled && trigger.textContent?.includes('gpt-5.2'));
    });

    (runtime.querySelector('.flower-model-reasoning-model-trigger') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-menu')));
    const nextModelOption = Array.from(runtime.querySelectorAll('.flower-model-menu-item'))
      .find((button) => button.textContent?.includes('gpt-5.4')) as HTMLButtonElement | undefined;
    nextModelOption?.click();

    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes('default save failed')));
    expect(surfaceAdapter.setThreadModel).toHaveBeenCalledWith('thread-model-default-fails', 'openai/gpt-5.4');
    expect(surfaceAdapter.persistDefaultModel).toHaveBeenCalledWith('openai/gpt-5.4');
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Default model was not updated.',
      message: 'default save failed',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
    expect(runtime.querySelector('.flower-model-reasoning-model-trigger')?.textContent).toContain('OpenAI / gpt-5.4');
  });

  it('moves overflowing composer controls into the More panel without changing working directory launch behavior', async () => {
    const layout = installComposerControlLayoutHarness({
      availableWidth: 230,
      itemWidths: {
        working_dir: 122,
        permission: 90,
        model_reasoning: 248,
      },
      moreWidth: 30,
    });
    const launchedThread = thread({
      thread_id: 'thread-working-dir-overflow',
      title: 'Working dir overflow',
      working_dir: '/Users/alice/redeven',
      messages: [
        {
          id: 'm-working-dir-overflow-user',
          role: 'user',
          content: 'start in overflow redeven',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const getWorkingDirectoryPathContext = vi.fn(async () => ({
      agentHomePathAbs: '/Users/alice',
      homePathAbs: '/Users/alice',
      defaultRootId: 'home',
      roots: [],
    }));
    const listWorkingDirectoryEntries = vi.fn(async (input: { path: string; showHidden?: boolean }) => {
      if (input.path === '/Users/alice') {
        return [{
          name: 'redeven',
          path: '/Users/alice/redeven',
          isDirectory: true,
          modifiedAt: 1,
        }];
      }
      return [];
    });
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(launchedThread.thread_id, input.turn_id ?? 'turn-working-dir-overflow'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async () => liveBootstrap(launchedThread)),
      getWorkingDirectoryPathContext,
      listWorkingDirectoryEntries,
      launchTurn,
    });

    layout.trigger();

    await waitFor(() => Boolean(runtime.querySelector('button.flower-composer-more-button')));
    expect(runtime.querySelector('[data-flower-composer-inline-item="permission"] .flower-permission-trigger')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-composer-inline-item="working_dir"]')).toBeNull();
    (runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-more-panel="true"]')));
    expect(runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip')).toBeTruthy();

    (runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-directory-picker-entry="/redeven"]')));
    (runtime.querySelector('[data-directory-picker-entry="/redeven"]') as HTMLButtonElement).click();
    (runtime.querySelector('[data-directory-picker-confirm="true"]') as HTMLButtonElement).click();
    await waitFor(() => !runtime.querySelector('[data-flower-composer-more-panel="true"]'));
    (runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip')?.textContent?.includes('redeven') === true);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start in overflow redeven';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'start in overflow redeven',
      working_dir: '/Users/alice/redeven',
    }));
  });

  it('closes the composer More panel with Escape and outside pointer input', async () => {
    const layout = installComposerControlLayoutHarness({
      availableWidth: 180,
      itemWidths: {
        working_dir: 122,
        permission: 90,
        model_reasoning: 248,
      },
      moreWidth: 30,
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      getWorkingDirectoryPathContext: vi.fn(async () => ({
        agentHomePathAbs: '/Users/alice',
        homePathAbs: '/Users/alice',
        defaultRootId: 'home',
        roots: [],
      })),
      listWorkingDirectoryEntries: vi.fn(async () => []),
    });

    layout.trigger();

    await waitFor(() => Boolean(runtime.querySelector('button.flower-composer-more-button')));
    const moreButton = runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement;
    moreButton.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-more-panel="true"]')));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelector('[data-flower-composer-more-panel="true"]') === null);

    moreButton.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-more-panel="true"]')));
    document.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    await waitFor(() => runtime.querySelector('[data-flower-composer-more-panel="true"]') === null);
  });

  it('copies an existing thread working directory from the composer footer chip', async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const launchTurn = vi.fn(async (input: { thread_id?: string; turn_id?: string }) => launchReceipt(input.thread_id ?? 'thread-1', input.turn_id ?? 'turn-copy-workdir'));
    const existingThread = thread({
      thread_id: 'thread-existing-workdir',
      title: 'Existing working dir',
      working_dir: '/Users/alice/redeven',
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [existingThread]),
      loadThread: vi.fn(async () => liveBootstrap(existingThread)),
      getWorkingDirectoryPathContext: vi.fn(async () => {
        throw new Error('picker should not open for existing threads');
      }),
      listWorkingDirectoryEntries: vi.fn(async () => []),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-existing-workdir"] button')));
    (runtime.querySelector('[data-thread-id="thread-existing-workdir"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-composer-footer .flower-working-dir-chip')?.textContent?.includes('redeven') === true);
    expect(runtime.querySelector('.flower-chat-header .flower-working-dir-chip')).toBeNull();

    const chip = runtime.querySelector('.flower-composer-footer .flower-working-dir-chip') as HTMLButtonElement;
    expect(chip.getAttribute('title')).toContain('/Users/alice/redeven');
    chip.click();
    await waitFor(() => writeText.mock.calls.length === 1);

    expect(writeText).toHaveBeenCalledWith('/Users/alice/redeven');
    expect(runtime.querySelector('[data-directory-picker="true"]')).toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('copies an existing thread working directory from the composer More panel without opening the picker', async () => {
    const layout = installComposerControlLayoutHarness({
      availableWidth: 180,
      itemWidths: {
        working_dir: 122,
        permission: 90,
        model_reasoning: 248,
      },
      moreWidth: 30,
    });
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const launchTurn = vi.fn(async (input: { thread_id?: string; turn_id?: string }) => launchReceipt(input.thread_id ?? 'thread-1', input.turn_id ?? 'turn-copy-workdir-overflow'));
    const existingThread = thread({
      thread_id: 'thread-existing-workdir-overflow',
      title: 'Existing working dir overflow',
      working_dir: '/Users/alice/redeven',
    });
    const getWorkingDirectoryPathContext = vi.fn(async () => {
      throw new Error('picker should not open for existing threads');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [existingThread]),
      loadThread: vi.fn(async () => liveBootstrap(existingThread)),
      getWorkingDirectoryPathContext,
      listWorkingDirectoryEntries: vi.fn(async () => []),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-existing-workdir-overflow"] button')));
    (runtime.querySelector('[data-thread-id="thread-existing-workdir-overflow"] button') as HTMLButtonElement).click();
    layout.trigger();
    await waitFor(() => Boolean(runtime.querySelector('button.flower-composer-more-button')));

    (runtime.querySelector('button.flower-composer-more-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip')));
    (runtime.querySelector('[data-flower-composer-more-item="working_dir"] .flower-working-dir-chip') as HTMLButtonElement).click();
    await waitFor(() => writeText.mock.calls.length === 1);

    expect(writeText).toHaveBeenCalledWith('/Users/alice/redeven');
    expect(runtime.querySelector('[data-directory-picker="true"]')).toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('stops a running selected thread from the composer when the draft is empty', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop',
      title: 'Running stop',
      status: 'running',
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
    });
    const stopThread = vi.fn(async () => liveBootstrap(stoppedThread));
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(stoppedThread.thread_id, input.turn_id ?? 'turn-stopped'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-stop'));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Stop' && !button.disabled;
    });

    const stopButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    const stopIcon = stopButton.querySelector('svg');
    const stopIconRect = stopIcon?.querySelector('rect');
    expect(stopButton.className).toContain('flower-composer-submit');
    expect(stopButton.className).toContain('rounded-full');
    expect(stopIcon?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(stopIconRect?.getAttribute('x')).toBe('6');
    expect(stopIconRect?.getAttribute('y')).toBe('6');
    expect(stopIconRect?.getAttribute('width')).toBe('12');
    expect(stopIconRect?.getAttribute('height')).toBe('12');
    expect(stopIconRect?.getAttribute('stroke')).toBe('none');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    stopButton.click();
    await waitFor(() => stopThread.mock.calls.length > 0);

    expect(stopThread).toHaveBeenCalledWith('thread-running-stop');
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('prevents duplicate stop clicks while thread stop is in flight', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-once',
      title: 'Running stop once',
      status: 'running',
    });
    const stoppedThread = thread({
      ...runningThread,
      status: 'canceled',
      model_io_status: null,
    });
    const stopDeferred = deferred<FlowerLiveBootstrap>();
    const stopThread = vi.fn(() => stopDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop-once"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop-once"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-stop-once'));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Stop' && !button.disabled;
    });

    const stopButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    stopButton.click();
    stopButton.click();
    await waitFor(() => stopThread.mock.calls.length === 1);

    expect(stopThread).toHaveBeenCalledTimes(1);
    stopDeferred.resolve(liveBootstrap(stoppedThread));
    await waitFor(() => stopButton.disabled);
  });

  it('queues a non-empty composer draft on a running selected thread without stopping it', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-queue',
      title: 'Running send queue',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-running-send' }),
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      queued_turn_count: 1,
      messages: [
        ...runningThread.messages,
        {
          id: 'm-running-send-user',
          role: 'user',
          content: 'continue while running',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(launchedThread.thread_id, input.turn_id ?? 'turn-running'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-queue"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-queue"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-send-queue'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue while running';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-running-send-queue',
      prompt: 'continue while running',
    }));
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('continue while running');
  });

  it('compacts a running selected thread without stopping or launching a new turn', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-compact',
      title: 'Running compact',
      status: 'running',
      active_run_id: 'run-compact',
      model_io_status: modelIOStatus({ run_id: 'run-compact' }),
      messages: [
        {
          id: 'm-compact-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-assistant',
          role: 'assistant',
          content: 'working',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'working' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(runningThread, 3));
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(runningThread.thread_id, input.turn_id ?? 'turn-compaction-running'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-compact"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-compact"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-compact'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-running-compact',
      active_run_id: 'run-compact',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');
  });

  it('does not execute compact from Enter before chat setup is ready', async () => {
    const selected = thread({
      thread_id: 'thread-compact-needs-setup',
      title: 'Compact needs setup',
      status: 'idle',
      messages: [
        {
          id: 'm-compact-needs-setup-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(selected));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
      compactThreadContext,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-needs-setup"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-needs-setup"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-needs-setup'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(runtime.querySelector('.flower-settings-surface')));
    expect(compactThreadContext).not.toHaveBeenCalled();
  });

  it('executes compact from the slash menu, scrolls the transcript, and shows an immediate compaction divider', async () => {
    const compactingThread = thread({
      thread_id: 'thread-running-compact-menu',
      title: 'Running compact menu',
      status: 'running',
      active_run_id: 'run-compact-menu',
      model_io_status: modelIOStatus({ run_id: 'run-compact-menu' }),
      messages: [
        {
          id: 'm-compact-menu-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-menu-assistant',
          role: 'assistant',
          content: 'working',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'working' }],
        },
      ],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const compactThreadContext = vi.fn(() => compactDeferred.promise);
    const stopThread = vi.fn(async () => liveBootstrap({ ...compactingThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(compactingThread.thread_id, input.turn_id ?? 'turn-compacting'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(compactingThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-compact-menu"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-compact-menu"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-compact-menu'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLElement;
    let scrollTop = 0;
    Object.defineProperty(transcript, 'clientHeight', { configurable: true, value: 180 });
    Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 920 });
    Object.defineProperty(transcript, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Number(value);
      },
    });

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/com';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-command-menu')));

    (runtime.querySelector('.flower-composer-command-item') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacting"]')));
    await waitFor(() => scrollTop === 740);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-running-compact-menu',
      active_run_id: 'run-compact-menu',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');

    const timelineNodes = Array.from(runtime.querySelectorAll('[data-flower-message-id], .flower-compaction-divider'));
    expect(timelineNodes.map((node) => (
      node instanceof HTMLElement && node.hasAttribute('data-flower-message-id')
        ? node.getAttribute('data-flower-message-id')
        : `divider:${(node as HTMLElement).getAttribute('data-flower-compaction-status')}`
    ))).toEqual([
      'm-compact-menu-user',
      'm-compact-menu-assistant',
      'divider:compacting',
      'm-compact-menu-assistant',
    ]);

    compactDeferred.resolve(liveBootstrap({
      ...compactingThread,
      timeline_decorations: [{
        decoration_id: 'local-context-compaction-thread-running-compact-menu',
        kind: 'context_compaction',
        ordinal: 999,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-menu-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-menu-real',
          phase: 'start',
          status: 'compacting',
          updated_at_ms: Date.now() + 1_000,
        },
      }],
    }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
  });

  it('executes the selected slash command from keyboard Enter without completing first', async () => {
    const runningThread = thread({
      thread_id: 'thread-compact-keyboard-suggest',
      title: 'Compact keyboard suggest',
      status: 'running',
      active_run_id: 'run-compact-keyboard',
      model_io_status: modelIOStatus({ run_id: 'run-compact-keyboard' }),
      messages: [{
        id: 'm-compact-keyboard-user',
        role: 'user',
        content: 'inspect the repository',
        status: 'complete',
        created_at_ms: 10,
      }],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const compactThreadContext = vi.fn(() => compactDeferred.promise);
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(runningThread.thread_id, input.turn_id ?? 'turn-running-queued'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      compactThreadContext,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-keyboard-suggest"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-keyboard-suggest"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-keyboard-suggest'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/com';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-command-menu')));
    const menu = runtime.querySelector('.flower-composer-command-menu') as HTMLElement;
    const option = runtime.querySelector('.flower-composer-command-item') as HTMLButtonElement;
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(menu.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(textarea.getAttribute('aria-controls')).toBe(menu.id);
    expect(textarea.getAttribute('aria-expanded')).toBe('true');
    expect(textarea.getAttribute('aria-activedescendant')).toBe(option.id);

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
    expect(textarea.value).toBe('');
    expect(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacting"]')).not.toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();

    compactDeferred.resolve(liveBootstrap(runningThread));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
  });

  it('stops polling once a real compaction decoration replaces the local pending divider', async () => {
    const idleThread = thread({
      thread_id: 'thread-compact-pending-clears',
      title: 'Compact pending clears',
      status: 'success',
      messages: [
        {
          id: 'm-compact-pending-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-pending-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
    });
    const realCompactionThread = thread({
      ...idleThread,
      context_compactions: [{
        operation_id: 'compact-pending-real',
        phase: 'complete',
        status: 'compacted',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 1,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-pending-real',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-pending-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-pending-real',
          phase: 'complete',
          status: 'compacted',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 1,
        },
      }],
    });
    const listThreadLiveEvents = vi.fn(async () => ({
      stream_generation: 1,
      events: [],
      next_cursor: 1,
      retained_from_seq: 1,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [idleThread]),
      loadThread: vi.fn(async () => liveBootstrap(idleThread)),
      compactThreadContext: vi.fn(async () => liveBootstrap(realCompactionThread, 2)),
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-pending-clears"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-pending-clears"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-pending-clears'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacted"]')));
    expect(runtime.querySelectorAll('.flower-compaction-divider')).toHaveLength(1);
    const callsAfterRealDecoration = listThreadLiveEvents.mock.calls.length;
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(listThreadLiveEvents).toHaveBeenCalledTimes(callsAfterRealDecoration);
  });

  it('emits a debug event when selected thread live polling times out', async () => {
    vi.useFakeTimers();
    const runningThread = thread({
      thread_id: 'thread-live-timeout-debug',
      title: 'Live timeout debug',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-live-timeout-debug' }),
      messages: [
        {
          id: 'm-live-timeout-user',
          role: 'user',
          content: 'watch live timeout',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const liveRequest = deferred<FlowerLiveEventsResponse>();
    const timeouts: unknown[] = [];
    const onTimeout = (event: Event) => {
      timeouts.push((event as CustomEvent).detail);
    };
    window.addEventListener('redeven:flower-live-events-timeout', onTimeout);
    try {
      const runtime = renderSurfaceWithAdapter({
        ...adapter(true),
        listThreads: vi.fn(async () => [runningThread]),
        loadThread: vi.fn(async () => liveBootstrap(runningThread, 7)),
        listThreadLiveEvents: vi.fn(() => liveRequest.promise),
      });

      await vi.waitFor(() => {
        expect(runtime.querySelector('[data-thread-id="thread-live-timeout-debug"] button')).toBeTruthy();
      });
      (runtime.querySelector('[data-thread-id="thread-live-timeout-debug"] button') as HTMLButtonElement).click();
      await vi.waitFor(() => {
        expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await vi.waitFor(() => {
        expect(timeouts).toHaveLength(1);
      });

      expect(timeouts[0]).toMatchObject({
        thread_id: 'thread-live-timeout-debug',
        cursor: 0,
        stream_generation: 1,
      });
    } finally {
      window.removeEventListener('redeven:flower-live-events-timeout', onTimeout);
    }
  });

  it('keeps a new pending compact divider when the selected thread already has historical compactions', async () => {
    const historicalCompactionThread = thread({
      thread_id: 'thread-compact-pending-history',
      title: 'Compact pending history',
      status: 'success',
      messages: [
        {
          id: 'm-compact-history-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-history-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
      context_compactions: [{
        operation_id: 'compact-history-old',
        phase: 'complete',
        status: 'compacted',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 1,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-history-old',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-history-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-history-old',
          phase: 'complete',
          status: 'compacted',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 1,
        },
      }],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [historicalCompactionThread]),
      loadThread: vi.fn(async () => liveBootstrap(historicalCompactionThread)),
      compactThreadContext: vi.fn(() => compactDeferred.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-pending-history"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-pending-history"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-pending-history'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelectorAll('.flower-compaction-divider').length === 2);
    expect(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacted"]')).toBeTruthy();
    expect(runtime.querySelector('.flower-compaction-divider[data-flower-compaction-status="compacting"]')).toBeTruthy();
  });

  it('replaces a local compact divider when slash compact returns an already-running idle compaction', async () => {
    const alreadyCompactingThread = thread({
      thread_id: 'thread-compact-already-running',
      title: 'Compact already running',
      status: 'success',
      messages: [
        {
          id: 'm-compact-already-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-compact-already-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'done' }],
        },
      ],
      context_compactions: [{
        operation_id: 'compact-already-running',
        phase: 'start',
        status: 'compacting',
        trigger: 'manual',
        reason: 'manual',
        updated_at_ms: 30,
      }],
      timeline_decorations: [{
        decoration_id: 'context-compaction:compact-already-running',
        kind: 'context_compaction',
        ordinal: 1,
        anchor: {
          target_kind: 'message',
          message_id: 'm-compact-already-assistant',
          edge: 'after',
        },
        compaction: {
          operation_id: 'compact-already-running',
          phase: 'start',
          status: 'compacting',
          trigger: 'manual',
          reason: 'manual',
          updated_at_ms: 30,
        },
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [alreadyCompactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(alreadyCompactingThread)),
      compactThreadContext: vi.fn(async () => liveBootstrap(alreadyCompactingThread, 2)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-compact-already-running"] button')));
    (runtime.querySelector('[data-thread-id="thread-compact-already-running"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-compact-already-running'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelectorAll('.flower-compaction-divider[data-flower-compaction-status="compacting"]').length === 1);
    expect(runtime.querySelector('[data-flower-decoration-id="context-compaction:compact-already-running"]')).toBeTruthy();
  });

  it('allows a normal send while an idle compact request is still pending', async () => {
    const compactingThread = thread({
      thread_id: 'thread-idle-compact-pending-send',
      title: 'Idle compact pending send',
      status: 'success',
      messages: [
        {
          id: 'm-idle-compact-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-idle-compact-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const compactDeferred = deferred<FlowerLiveBootstrap>();
    const compactThreadContext = vi.fn(() => compactDeferred.promise);
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => (
      launchReceipt(compactingThread.thread_id, input.turn_id ?? 'turn-idle-compact', 'queued')
    ));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(compactingThread)),
      compactThreadContext,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-idle-compact-pending-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-idle-compact-pending-send"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-idle-compact-pending-send'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Compact context' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => compactThreadContext.mock.calls.length === 1);
    await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');

    textarea.value = 'continue after compact starts';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-idle-compact-pending-send',
      prompt: 'continue after compact starts',
    }));
    await waitFor(() => runtime.querySelector('[data-flower-pending-turn]')?.textContent?.includes('continue after compact starts') ?? false);
    expect(runtime.querySelector('[data-flower-pending-turn]')?.getAttribute('data-flower-pending-turn-state')).toBe('queued');
    expect(runtime.querySelector('[data-flower-message-id="m-idle-compact-user"]')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-id="continue after compact starts"]')).toBeNull();
    expect(compactThreadContext).toHaveBeenCalledTimes(1);
  });

  it('keeps multiple queued pending sends visible while idle compaction is still pending', async () => {
    const compactingThread = thread({
      thread_id: 'thread-idle-compact-multi-pending',
      title: 'Idle compact multi pending',
      status: 'success',
      messages: [
        {
          id: 'm-idle-compact-multi-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-idle-compact-multi-assistant',
          role: 'assistant',
          content: 'done',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const pendingMessages: string[] = [];
    const launchTurn = vi
      .fn(async (input) => {
        const turnID = input.turn_id ?? '';
        pendingMessages.push(turnID);
        return launchReceipt(compactingThread.thread_id, turnID, 'queued');
      });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [compactingThread]),
      loadThread: vi.fn(async () => liveBootstrap(compactingThread)),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-idle-compact-multi-pending"] button')));
    (runtime.querySelector('[data-thread-id="thread-idle-compact-multi-pending"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-idle-compact-multi-pending'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(50_000);
    try {
      const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
      for (const prompt of ['repeat queued follow-up', 'repeat queued follow-up']) {
        textarea.value = prompt;
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
        await waitFor(() => {
          const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
          return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
        });
        (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
        await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement).value === '');
      }
    } finally {
      nowSpy.mockRestore();
    }

    await waitFor(() => launchTurn.mock.calls.length === 2);
    await waitFor(() => runtime.querySelectorAll('[data-flower-pending-turn]').length === 2);
    const pendingText = Array.from(runtime.querySelectorAll('[data-flower-pending-turn]')).map((node) => node.textContent ?? '').join('\n');
    expect((pendingText.match(/repeat queued follow-up/g) ?? []).length).toBe(2);
    expect(pendingMessages).toHaveLength(2);
    expect(pendingMessages[0]).toMatch(/^client_/);
    expect(pendingMessages[1]).toMatch(/^client_/);
    expect(pendingMessages[0]).not.toBe(pendingMessages[1]);
  });

  it('compacts a waiting-approval selected thread with the active run guard', async () => {
    const waitingApprovalThread = thread({
      thread_id: 'thread-waiting-approval-compact',
      title: 'Waiting approval compact',
      status: 'waiting_approval',
      active_run_id: 'run-waiting-approval-compact',
      model_io_status: null,
      messages: [
        {
          id: 'm-approval-user',
          role: 'user',
          content: 'inspect the repository',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-approval-assistant',
          role: 'assistant',
          content: 'I need to run a command.',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'I need to run a command.' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(waitingApprovalThread, 3));
    const stopThread = vi.fn(async () => liveBootstrap({ ...waitingApprovalThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(waitingApprovalThread.thread_id, input.turn_id ?? 'turn-waiting-approval'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingApprovalThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingApprovalThread)),
      compactThreadContext,
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-approval-compact"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-approval-compact"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-waiting-approval-compact'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '/compact';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => compactThreadContext.mock.calls.length === 1);

    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread-waiting-approval-compact',
      active_run_id: 'run-waiting-approval-compact',
    });
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('disables composer commands when the selected thread status is read-only', async () => {
    const readOnlyThread = thread({
      thread_id: 'thread-read-only-status',
      title: 'Read-only status',
      status: 'read_only',
      messages: [
        {
          id: 'm-read-only',
          role: 'assistant',
          content: 'This thread is archived.',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'This thread is archived.' }],
        },
      ],
    });
    const compactThreadContext = vi.fn(async () => liveBootstrap(readOnlyThread));
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(readOnlyThread.thread_id, input.turn_id ?? 'turn-read-only'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [readOnlyThread]),
      loadThread: vi.fn(async () => liveBootstrap(readOnlyThread)),
      compactThreadContext,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-read-only-status"] button')));
    (runtime.querySelector('[data-thread-id="thread-read-only-status"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-read-only-status'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-readonly-chip')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(textarea.getAttribute('placeholder')).toContain('Read only');
    const submitButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    submitButton.click();
    await waitFor(() => true, 20);
    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
  });

  it('uses Enter to send a draft on a running selected thread without stopping it', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-enter-send',
      title: 'Running Enter send',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(runningThread.thread_id, input.turn_id ?? 'turn-running-send'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-enter-send'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'send with enter while running';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-running-enter-send',
      prompt: 'send with enter while running',
    }));
  });

  it('keeps old agent activity before the queued user message when Enter sends on a running thread', async () => {
    const oldActivity = activityTimeline({
      thread_id: 'thread-running-enter-send-activity-order',
      run_id: 'run-first',
      turn_id: 'm-first-assistant',
      status: 'running',
      items: [activityItem({
        item_id: 'tool-first-terminal',
        tool_id: 'tool-first-terminal',
        tool_name: 'terminal.exec',
        status: 'running',
        renderer: 'terminal',
        label: 'printf ENTER_A_BEGIN; sleep 30; printf ENTER_A_DONE',
        payload: { command: 'printf ENTER_A_BEGIN; sleep 30; printf ENTER_A_DONE' },
      })],
    });
    const runningThread = thread({
      thread_id: 'thread-running-enter-send-activity-order',
      title: 'Running Enter activity order',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [oldActivity],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          role: 'assistant',
          content: 'ENTER_B_DONE',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: 'ENTER_B_DONE' }],
        },
      ],
    });
    let loadedAfterLaunch = false;
    let admittedTurnID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch
        ? withCanonicalUserTurnID(launchedThread, 'm-second-user', admittedTurnID)
        : runningThread)),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        admittedTurnID = input.turn_id ?? 'turn-second-request';
        return launchReceipt(launchedThread.thread_id, admittedTurnID);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send-activity-order"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send-activity-order"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-enter-send-activity-order'));
    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-first-assistant"]')?.textContent?.includes('printf ENTER_A_BEGIN') ?? false);

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

	await waitFor(() => runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent?.includes('ENTER_B_DONE') ?? false);
	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]).toBe('m-second-user');
	expect(ids[3]).toBe('m-second-assistant');
	const secondUserText = runtime.querySelector(`[data-flower-message-id="${ids[2]}"]`)?.textContent ?? '';
    const secondAssistantText = runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent ?? '';
    expect(secondUserText).toContain('second request');
    expect(secondAssistantText).toContain('ENTER_B_DONE');
    expect(secondAssistantText).not.toContain('ENTER_A_DONE');
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('ignores stale live poll snapshots that return after Enter sends on a running thread', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-enter-send-stale-poll',
      title: 'Running stale poll',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          role: 'assistant',
          content: 'partial',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'partial' }],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: '' }],
        },
      ],
    });
    const stalePoll = deferred<FlowerLiveEventsResponse>();
    let loadedAfterLaunch = false;
    let admittedTurnID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch
        ? withCanonicalUserTurnID(launchedThread, 'm-second-user', admittedTurnID)
        : runningThread, loadedAfterLaunch ? 3 : 1)),
      listThreadLiveEvents: vi.fn(() => stalePoll.promise),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        admittedTurnID = input.turn_id ?? 'turn-second-request';
        return launchReceipt(launchedThread.thread_id, admittedTurnID);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-enter-send-stale-poll"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-enter-send-stale-poll"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-enter-send-stale-poll'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    stalePoll.resolve({
      events: [{
        schema_version: 1,
        seq: 2,
        endpoint_id: 'test-runtime',
        thread_id: 'thread-running-enter-send-stale-poll',
        run_id: 'run-first',
        at_unix_ms: 50,
        kind: 'timeline.replaced',
        payload: { messages: runningThread.messages, stream_generation: 1, snapshot_through_seq: 2 },
      }],
      stream_generation: 1,
      next_cursor: 2,
      retained_from_seq: 1,
      has_more: false,
    });
    await waitFor(() => {
      const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
      return ids.includes('m-second-assistant');
    });

	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]?.startsWith('pending:')).toBe(false);
	expect(ids[3]).toBe('m-second-assistant');
	expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
	expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('keeps a repeated prompt pending until a new canonical user message arrives', async () => {
    const existingThread = thread({
      thread_id: 'thread-repeat-pending',
      title: 'Repeat pending',
      status: 'idle',
      messages: [
        {
          id: 'm-old-continue',
          role: 'user',
          content: 'continue',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const launchedThread = thread({
      ...existingThread,
      status: 'running',
      messages: existingThread.messages,
      model_io_status: modelIOStatus({ run_id: 'run-repeat' }),
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [existingThread]),
      loadThread: vi.fn(async () => liveBootstrap(existingThread)),
      launchTurn: vi.fn(async (input) => launchReceipt(launchedThread.thread_id, input.turn_id ?? 'turn-repeat-pending')),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-repeat-pending"] button')));
    (runtime.querySelector('[data-thread-id="thread-repeat-pending"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-repeat-pending'));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-pending-turn]')));

    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('m-old-continue');
    expect(ids[1]?.startsWith('pending:client_')).toBe(true);
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('continue');
  });

  it('renders a pending user turn before assistant streaming when live events arrive first', async () => {
    const selected = thread({
      thread_id: 'thread-pending-before-assistant',
      title: 'Pending before assistant',
      status: 'idle',
      messages: [],
    });
    const launchedThread = thread({
      ...selected,
      status: 'running',
      messages: [],
      model_io_status: modelIOStatus({ run_id: 'run-pending-before-assistant' }),
    });
    let pollCount = 0;
    let acceptedTurnID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
      launchTurn: vi.fn(async (input) => {
        acceptedTurnID = input.turn_id ?? 'turn-pending-before-assistant';
        return launchReceipt(launchedThread.thread_id, acceptedTurnID);
      }),
      listThreadLiveEvents: vi.fn(async () => {
        pollCount += 1;
        if (pollCount === 1) {
          return {
            stream_generation: 1,
            next_cursor: 1,
            retained_from_seq: 1,
            has_more: false,
            events: [],
          } satisfies FlowerLiveEventsResponse;
        }
        return {
          stream_generation: 1,
          next_cursor: 4,
          retained_from_seq: 1,
          has_more: false,
          events: pollCount === 2
            ? [
                {
                  schema_version: 1,
                  seq: 2,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  turn_id: acceptedTurnID,
                  at_unix_ms: 2000,
                  kind: 'message.started',
                  payload: {
                    message_id: 'm-assistant-first',
                    role: 'assistant',
                    status: 'streaming',
                    created_at_ms: 2000,
                  },
                },
                {
                  schema_version: 1,
                  seq: 3,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  turn_id: acceptedTurnID,
                  at_unix_ms: 2001,
                  kind: 'message.block_started',
                  payload: {
                    message_id: 'm-assistant-first',
                    block_index: 0,
                    block_type: 'markdown',
                  },
                },
                {
                  schema_version: 1,
                  seq: 4,
                  endpoint_id: 'test-runtime',
                  thread_id: 'thread-pending-before-assistant',
                  run_id: 'run-pending-before-assistant',
                  turn_id: acceptedTurnID,
                  at_unix_ms: 2002,
                  kind: 'message.block_delta',
                  payload: {
                    message_id: 'm-assistant-first',
                    block_index: 0,
                    delta: 'working',
                  },
                },
              ]
            : [],
        } satisfies FlowerLiveEventsResponse;
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-pending-before-assistant"] button')));
    (runtime.querySelector('[data-thread-id="thread-pending-before-assistant"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-pending-before-assistant'));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start work';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="m-assistant-first"]')));

    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    const pendingIndex = ids.findIndex((id) => id?.startsWith('pending:client_'));
    const assistantIndex = ids.indexOf('m-assistant-first');
    expect(pendingIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(pendingIndex).toBeLessThan(assistantIndex);
  });

  it('ignores stale bootstrap reloads that return after sending on a running thread', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-stale-bootstrap',
      title: 'Running stale bootstrap',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [
        {
          id: 'm-first-user',
          turn_id: 'turn-first-request',
          role: 'user',
          content: 'first request',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-first-assistant',
          turn_id: 'turn-first-request',
          role: 'assistant',
          content: 'partial old answer',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'partial old answer' }],
        },
      ],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          turn_id: 'turn-second-request',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          turn_id: 'turn-second-request',
          role: 'assistant',
          content: 'new answer',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
          blocks: [{ type: 'markdown', content: 'new answer' }],
        },
      ],
    });
    const staleLoad = deferred<FlowerLiveBootstrap>();
    let loadCalls = 0;
    let admittedTurnID = '';
    let canonicalThread = launchedThread;
    let canonicalSummaryReady = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [{
        ...runningThread,
        updated_at_ms: canonicalSummaryReady ? 3 : runningThread.updated_at_ms,
      }]),
      loadThread: vi.fn(async () => {
        loadCalls += 1;
        if (loadCalls === 1) {
          return liveBootstrap(runningThread, 1);
        }
        if (loadCalls === 2) {
          return staleLoad.promise;
        }
        return liveBootstrap(canonicalThread, 3);
      }),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }, 2)),
      launchTurn: vi.fn(async (input) => {
        admittedTurnID = input.turn_id ?? 'turn-second-request';
        return launchReceipt(launchedThread.thread_id, admittedTurnID);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-stale-bootstrap"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-stale-bootstrap"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-send-stale-bootstrap'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => loadCalls === 2 && admittedTurnID !== '');
    canonicalThread = {
      ...withCanonicalUserTurnID(launchedThread, 'm-second-user', admittedTurnID),
      messages: launchedThread.messages.map((message) => (
        message.id === 'm-second-user' || message.id === 'm-second-assistant'
          ? { ...message, turn_id: admittedTurnID }
          : message
      )),
    };
    canonicalSummaryReady = true;
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => loadCalls >= 3);
    await waitFor(() => runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent?.includes('new answer') ?? false);
    staleLoad.resolve(liveBootstrap(runningThread, 2));
    await waitFor(() => {
      const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
      return ids.length === 4;
    });

	const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
	expect(ids).toHaveLength(4);
	expect(ids[0]).toBe('m-first-user');
	expect(ids[1]).toBe('m-first-assistant');
	expect(ids[2]).toBe('m-second-user');
	expect(ids[3]).toBe('m-second-assistant');
	expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
	expect(runtime.querySelector('[data-flower-message-id="m-second-assistant"]')?.textContent).toContain('new answer');
	expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });

  it('renders the context meter before submit and opens its tooltip on focus', async () => {
    const idleThread = thread({
      thread_id: 'thread-context-meter',
      title: 'Context meter',
      status: 'idle',
      context_usage: {
        run_id: '',
        phase: 'provider_usage',
        input_tokens: 42500,
        context_window_tokens: 100000,
        threshold_tokens: 80000,
        used_ratio: 0.425,
        threshold_ratio: 0.8,
        pressure_status: 'stable',
        updated_at_ms: 42,
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [idleThread]),
      loadThread: vi.fn(async () => liveBootstrap(idleThread, 1)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-context-meter"] button')));
    (runtime.querySelector('[data-thread-id="thread-context-meter"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-context-meter'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-submit')));

    const actions = runtime.querySelector('.flower-composer-actions') as HTMLElement;
    const indicator = actions.querySelector('.flower-composer-context-indicator') as HTMLElement | null;
    const progress = actions.querySelector('.flower-composer-context-progress') as HTMLElement | null;
    const submit = actions.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
    const tooltip = actions.querySelector('.flower-composer-context-tooltip') as HTMLElement | null;
    expect(indicator).toBeTruthy();
    expect(progress?.getAttribute('role')).toBe('progressbar');
    expect(progress?.getAttribute('aria-valuenow')).toBe('43');
    expect(submit).toBeTruthy();
    expect(indicator!.compareDocumentPosition(submit!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tooltip?.getAttribute('aria-hidden')).toBe('true');

    progress!.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    await waitFor(() => tooltip?.getAttribute('data-open') === 'true');
    expect(progress?.getAttribute('aria-describedby')).toBe(tooltip?.id);
    progress!.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await waitFor(() => tooltip?.getAttribute('aria-hidden') === 'true');
  });

  it('keeps the composer draft when running send fails', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-stop-fails',
      title: 'Running send fails',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => {
      throw new Error('Send failed.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-stop-fails"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-stop-fails"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-stop-fails'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'do not lose this draft';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes('Send failed.')));

    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Flower could not send.',
      message: 'Send failed.',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('do not lose this draft');
    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledTimes(1);
  });

  it('keeps the composer draft when running send fails without stopping first', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-fails',
      title: 'Running send fails',
      status: 'running',
    });
    const stopThread = vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' }));
    const launchTurn = vi.fn(async () => {
      throw new Error('Send failed.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread)),
      stopThread,
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-fails"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-fails"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-send-fails'));
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'keep this draft after send fails';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => flowerSurfaceNotifications().some((notice) => notice.message.includes('Send failed.')));

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Flower could not send.',
      message: 'Send failed.',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('keep this draft after send fails');
  });

  it('presents provider stream interruptions without blaming Flower orchestration', async () => {
    const interruptedThread = thread({
      thread_id: 'thread-provider-stream-interrupted',
      title: 'Provider stream interruption',
      status: 'failed',
      error: {
        code: 'provider_stream_interrupted',
        message: 'unexpected EOF',
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [interruptedThread]),
      loadThread: vi.fn(async () => liveBootstrap(interruptedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-provider-stream-interrupted"] button')));
    (runtime.querySelector('[data-thread-id="thread-provider-stream-interrupted"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-error-card').length > 0);

    const cardText = runtime.querySelector('.flower-error-card')?.textContent ?? '';
    expect(cardText).toContain('The selected AI provider ended the response stream unexpectedly.');
    expect(cardText).not.toContain('orchestration engine');
    expect(runtime.querySelector('.flower-error-actions button')?.textContent).toContain('Open settings');
  });

  it('continues a failed thread and shows closed subagents as terminal', async () => {
    const failedThread = thread({
      thread_id: 'thread-failed-continue',
      title: 'Failed continue',
      status: 'failed',
      messages: [
        {
          id: 'm-failed-parent',
          role: 'assistant',
          content: '',
          status: 'error',
          created_at_ms: 20,
          blocks: [
            activityTimeline({
              thread_id: 'thread-failed-continue',
              run_id: 'run-failed-parent',
              turn_id: 'm-failed-parent',
              status: 'error',
              severity: 'error',
              items: [activityItem({
                item_id: 'tool-subagents-stale-running',
                tool_id: 'tool-subagents-stale-running',
                tool_name: 'subagents',
                renderer: 'structured',
                label: 'subagents',
                status: 'running',
                payload: {
                  action: 'spawn',
                  items: [{
                    thread_id: 'thread-child-closed',
                    task_name: 'Review failed parent',
                    status: 'running',
                  }],
                },
              })],
            }),
          ],
        },
      ],
      subagents: [subagentSummary({
        parent_thread_id: 'thread-failed-continue',
        thread_id: 'thread-child-closed',
        task_name: 'Review failed parent',
        status: 'closed',
        can_close: false,
        can_interrupt: false,
        updated_at_ms: 240,
      })],
    });
    const continuedThread = {
      ...failedThread,
      status: 'running' as const,
      messages: [
        ...failedThread.messages,
        {
          id: 'm-failed-continue-user',
          role: 'user' as const,
          content: 'continue from failed parent',
          status: 'sending' as const,
          created_at_ms: 260,
        },
      ],
    };
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(continuedThread.thread_id, input.turn_id ?? 'turn-continued'));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failedThread]),
      loadThread: vi.fn(async () => liveBootstrap(failedThread)),
      launchTurn,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-failed-continue"] button')));
    (runtime.querySelector('[data-thread-id="thread-failed-continue"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-failed-continue'));

    const subagentsButton = runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement;
    subagentsButton.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-subagent-dropdown-row')));
    expect(runtime.querySelector('.flower-subagent-dropdown-row')?.getAttribute('data-flower-subagent-status')).toBe('canceled');

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    textarea.value = 'continue from failed parent';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return button?.getAttribute('aria-label') === 'Send' && !button.disabled;
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-failed-continue',
      prompt: 'continue from failed parent',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
  });

  it('keeps waiting_user threads on Continue instead of stop or send', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-user-continue',
      title: 'Waiting user continue',
      status: 'waiting_user',
      input_request: inputRequest({
        questions: [{
          id: 'details',
          header: 'Details',
          question: 'What should Flower do next?',
          response_mode: 'write',
        }],
      }),
    });
    const stopThread = vi.fn(async () => liveBootstrap(waitingThread));
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(waitingThread.thread_id, input.turn_id ?? 'turn-waiting'));
    const submitInput = vi.fn(async () => liveBootstrap({ ...waitingThread, status: 'running', input_request: null }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
      stopThread,
      launchTurn,
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-user-continue"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-user-continue"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-waiting-user-continue'));
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'answer the waiting prompt';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-continue') as HTMLButtonElement | null;
      return Boolean(button && button.textContent?.includes('Continue') && !button.disabled);
    });
    expect(runtime.querySelector('.flower-composer-submit')).toBeNull();
    (runtime.querySelector('.flower-composer-continue') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length > 0);

    expect(stopThread).not.toHaveBeenCalled();
    expect(launchTurn).not.toHaveBeenCalled();
    expect(submitInput).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-waiting-user-continue',
      answers: {
        details: { text: 'answer the waiting prompt' },
      },
    }));
  });

  it('loads the canonical thread after sending so completed assistant replies appear', async () => {
    const sentThread = thread({
      thread_id: 'thread-new',
      title: 'Flower verification',
      status: 'running',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          content: 'verify Flower',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const completeThread = thread({
      thread_id: 'thread-new',
      title: 'Flower verification',
      status: 'success',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          content: 'verify Flower',
          status: 'complete',
          created_at_ms: 10,
        },
        {
          id: 'm-assistant',
          role: 'assistant',
          content: 'Flower verification is complete.',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
    });
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => launchReceipt(sentThread.thread_id, input.turn_id ?? 'turn-sent'));
    const loadThread = vi.fn(async () => liveBootstrap(completeThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'verify Flower';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    const send = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    send.click();
    await waitFor(() => launchTurn.mock.calls.length > 0);
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('Flower verification is complete.') ?? false);

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: undefined,
      prompt: 'verify Flower',
    }));
    expect(loadThread).toHaveBeenCalledWith('thread-new');
    expect(runtime.textContent).toContain('Flower verification is complete.');
  });

  it('shows a local pending send row while waiting for the canonical timeline', async () => {
    const sendDeferred = deferred<FlowerTurnLaunchReceipt>();
    let launchTurnID = 'turn-user-canonical';
    const launchTurn = vi.fn((input) => {
      launchTurnID = input.turn_id ?? launchTurnID;
      return sendDeferred.promise;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async (threadID: string) => {
        if (threadID === 'thread-canonical-send') {
          return liveBootstrap(thread({
            thread_id: 'thread-canonical-send',
            title: 'Canonical send',
            status: 'running',
            model_io_status: modelIOStatus({ run_id: 'run-1' }),
            messages: [{
              id: 'entry-user-canonical',
              turn_id: launchTurnID,
              role: 'user',
              content: 'inspect the running turn',
              status: 'complete',
              created_at_ms: 10,
            }, {
              id: 'm-assistant-canonical',
              turn_id: launchTurnID,
              role: 'assistant',
              content: '',
              status: 'streaming',
              active_cursor: true,
              created_at_ms: 20,
            }],
          }));
        }
        throw new Error(`unexpected loadThread: ${threadID}`);
      }),
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'inspect the running turn';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length > 0);

    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('inspect the running turn');
    expect(runtime.querySelector('[data-flower-pending-turn]')?.getAttribute('data-flower-pending-turn-state')).toBe('sending');
    expect(runtime.querySelector('[data-flower-message-id="entry-user-canonical"]')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');

    sendDeferred.resolve(launchReceipt('thread-canonical-send', launchTurnID));
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="entry-user-canonical"]')));
    expect(runtime.textContent).toContain('inspect the running turn');
    expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
  });

  it('replaces the pending row by TurnID when timeline.replaced publishes a distinct user entry id', async () => {
    const initialThread = thread({
      thread_id: 'thread-live-canonical-send',
      title: 'Live canonical send',
      status: 'idle',
      messages: [],
    });
    const replacement = deferred<FlowerLiveEventsResponse>();
    let loadedAfterLaunch = false;
    let acceptedTurnID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [initialThread]),
      loadThread: vi.fn(async () => liveBootstrap(loadedAfterLaunch ? {
        ...initialThread,
        status: 'running',
        model_io_status: modelIOStatus({ run_id: 'run-live-canonical-send' }),
      } : initialThread, 1)),
      listThreadLiveEvents: vi.fn(() => replacement.promise),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        acceptedTurnID = input.turn_id ?? 'turn-live-canonical-send';
        return launchReceipt(initialThread.thread_id, acceptedTurnID);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-live-canonical-send"] button')));
    (runtime.querySelector('[data-thread-id="thread-live-canonical-send"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, initialThread.thread_id));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'replace this pending row';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => acceptedTurnID !== '' && Boolean(runtime.querySelector('[data-flower-pending-turn]')));

    replacement.resolve({
      events: [{
        schema_version: 1,
        seq: 2,
        endpoint_id: 'test-runtime',
        thread_id: initialThread.thread_id,
        run_id: 'run-live-canonical-send',
        at_unix_ms: 20,
        kind: 'timeline.replaced',
        payload: {
          stream_generation: 1,
          snapshot_through_seq: 2,
          messages: [{
            id: 'entry-user-live-canonical',
            turn_id: acceptedTurnID,
            role: 'user',
            content: 'replace this pending row',
            status: 'complete',
            created_at_ms: 10,
          }, {
            id: 'assistant-live-canonical',
            turn_id: acceptedTurnID,
            role: 'assistant',
            content: '',
            status: 'streaming',
            active_cursor: true,
            created_at_ms: 20,
          }],
          thread_patch: { run_status: 'running' },
        },
      }],
      stream_generation: 1,
      next_cursor: 2,
      retained_from_seq: 1,
      has_more: false,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="entry-user-live-canonical"]')));
    expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
    expect(runtime.querySelectorAll('[data-flower-message-role="user"]')).toHaveLength(1);
  });

  it('keeps the accepted pending turn and cleared draft when the post-receipt refresh fails', async () => {
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => (
      launchReceipt('thread-refresh-failed-after-send', input.turn_id ?? 'turn-refresh-failed')
    ));
    const loadThread = vi.fn(async () => {
      throw new Error('Canonical refresh failed.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'send exactly once';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelector('.flower-error-message')?.textContent === 'Canonical refresh failed.');
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(loadThread.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(loadThread).toHaveBeenCalledWith('thread-refresh-failed-after-send');
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('send exactly once');
    expect(runtime.querySelector('[data-flower-pending-turn]')?.getAttribute('data-flower-pending-turn-state')).toBe('sending');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(flowerSurfaceNotifications()).not.toContainEqual(expect.objectContaining({
      title: 'Flower could not send.',
    }));
  });

  it('keeps one exact pending turn when admission succeeds but the receipt response is lost', async () => {
    const reloadDeferred = deferred<FlowerLiveBootstrap>();
    let proposedTurnID = '';
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => {
      proposedTurnID = input.turn_id ?? '';
      throw flowerTurnAdmissionUncertainFailure(
        new Error('Admission response was lost.'),
        'thread-admission-uncertain',
        proposedTurnID,
      );
    });
    const loadThread = vi.fn(() => reloadDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'reconcile this exact turn';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => launchTurn.mock.calls.length === 1 && loadThread.mock.calls.length >= 1);
    expect(proposedTurnID).not.toBe('');
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('reconcile this exact turn');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(flowerSurfaceNotifications()).not.toContainEqual(expect.objectContaining({
      title: 'Flower could not send.',
    }));

    const canonicalThread = thread({
      thread_id: 'thread-admission-uncertain',
      title: 'Admission uncertain',
      status: 'running',
      messages: [{
        id: 'entry-user-after-uncertain-receipt',
        turn_id: proposedTurnID,
        role: 'user',
        content: 'reconcile this exact turn',
        status: 'complete',
        created_at_ms: 10,
      }],
    });
    reloadDeferred.resolve(liveBootstrap(canonicalThread, 1));

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="entry-user-after-uncertain-receipt"]')));
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
    expect(runtime.querySelectorAll('[data-flower-message-role="user"]')).toHaveLength(1);
  });

  it('shows the accepted run preparing status after the post-receipt refresh', async () => {
    const acceptedThread = thread({
      thread_id: 'thread-accepted-preparing',
      title: 'Accepted preparing',
      status: 'running',
      model_io_status: modelIOStatus({
        phase: 'preparing',
        run_id: 'run-accepted-preparing',
      }),
      messages: [{
        id: 'm-accepted-user',
        turn_id: 'turn-accepted',
        role: 'user',
        content: 'start the model request',
        status: 'complete',
        created_at_ms: 10,
      }, {
        id: 'm-accepted-assistant',
        turn_id: 'turn-accepted',
        role: 'assistant',
        content: '',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 20,
      }],
    });
    const reloadDeferred = deferred<FlowerLiveBootstrap>();
    let acceptedTurnID = 'turn-accepted';
    const launchTurn = vi.fn(async (input: { turn_id?: string }) => {
      acceptedTurnID = input.turn_id ?? acceptedTurnID;
      return launchReceipt(acceptedThread.thread_id, acceptedTurnID);
    });
    const loadThread = vi.fn(() => reloadDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'start the model request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => launchTurn.mock.calls.length === 1 && loadThread.mock.calls.length >= 1);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('start the model request');
    reloadDeferred.resolve(liveBootstrap({
      ...acceptedThread,
      messages: acceptedThread.messages.map((message) => ({ ...message, turn_id: acceptedTurnID })),
    }, 1));
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: undefined,
      prompt: 'start the model request',
    }));
    expect(loadThread).toHaveBeenCalledWith('thread-accepted-preparing');
    expect(runtime.querySelector('.flower-model-status-text')?.textContent).toBe('Preparing model request...');
    expect(runtime.querySelector('.flower-model-status-text')?.getAttribute('data-text')).toBe('Preparing model request');
    expect(runtime.querySelector('.flower-model-status-indicator')?.getAttribute('data-model-io-phase')).toBe('preparing');
    expect(runtime.querySelector('[data-flower-message-id] .flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelector('.flower-chat-transcript .flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
  });

  it('does not synthesize timeline rows while the handler is still resolving', async () => {
    const handlerDeferred = deferred<FlowerRouterDecision>();
    const sendDeferred = deferred<FlowerTurnLaunchReceipt>();
    let routeTurnID = '';
    const launchTurn = vi.fn((input) => {
      routeTurnID = input.turn_id ?? 'turn-route-settled';
      return sendDeferred.promise;
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread: vi.fn(async (threadID: string) => {
        if (threadID === 'thread-route-settled') {
          return liveBootstrap(thread({
            thread_id: 'thread-route-settled',
            title: 'Route settled',
            status: 'running',
            messages: [{
              id: 'm-route-settled-user',
              turn_id: routeTurnID,
              role: 'user',
              content: 'show before route settles',
              status: 'complete',
              created_at_ms: 10,
            }],
          }));
        }
        throw new Error(`unexpected loadThread: ${threadID}`);
      }),
      resolveHandler: vi.fn(() => handlerDeferred.promise),
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'show before route settles';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.querySelector('[data-flower-pending-turn]')?.textContent).toContain('show before route settles');
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(launchTurn).not.toHaveBeenCalled();

    handlerDeferred.resolve(decision());
    await waitFor(() => launchTurn.mock.calls.length > 0);
    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'show before route settles',
    }));
    sendDeferred.resolve(launchReceipt('thread-route-settled', routeTurnID));
    await waitFor(() => runtime.textContent?.includes('show before route settles') ?? false);
  });

  it('renders running queued send messages in canonical timeline order', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-send-order',
      title: 'Running send order',
      status: 'running',
      model_io_status: modelIOStatus({ run_id: 'run-1' }),
      messages: [{
        id: 'm-first-user',
        turn_id: 'turn-first-request',
        role: 'user',
        content: 'first request',
        status: 'complete',
        created_at_ms: 10,
      }, {
        id: 'm-first-assistant',
        turn_id: 'turn-first-request',
        role: 'assistant',
        content: 'partial old answer',
        status: 'streaming',
        active_cursor: true,
        created_at_ms: 20,
      }],
    });
    const launchedThread = thread({
      ...runningThread,
      status: 'running',
      messages: [
        ...(runningThread.messages ?? []),
        {
          id: 'm-second-user',
          turn_id: 'turn-second-request',
          role: 'user',
          content: 'second request',
          status: 'complete',
          created_at_ms: 30,
        },
        {
          id: 'm-second-assistant',
          turn_id: 'turn-second-request',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 40,
        },
      ],
    });
    let loadedAfterLaunch = false;
    let admittedTurnID = '';
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => {
        if (!loadedAfterLaunch) return liveBootstrap(runningThread);
        const canonical = withCanonicalUserTurnID(launchedThread, 'm-second-user', admittedTurnID);
        return liveBootstrap({
          ...canonical,
          queued_turn_count: 1,
          queued_turns: [{
            turn_id: admittedTurnID,
            prompt: 'second request',
            created_at_ms: 30,
          }],
          messages: canonical.messages.map((message) => (
            message.id === 'm-second-assistant' ? { ...message, turn_id: admittedTurnID } : message
          )),
        });
      }),
      stopThread: vi.fn(async () => liveBootstrap({ ...runningThread, status: 'canceled' })),
      launchTurn: vi.fn(async (input) => {
        loadedAfterLaunch = true;
        admittedTurnID = input.turn_id ?? 'turn-second-request';
        return launchReceipt(launchedThread.thread_id, admittedTurnID, 'queued');
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-send-order"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-send-order"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadReady(runtime, 'thread-running-send-order'));
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'second request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));
    const ids = Array.from(runtime.querySelectorAll('[data-flower-message-id]')).map((node) => node.getAttribute('data-flower-message-id'));
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe('m-first-user');
    expect(ids[1]).toBe('m-first-assistant');
    expect(ids[2]).toBe('m-second-user');
    expect(ids[3]).toBe('m-second-assistant');
    expect(runtime.querySelector('[data-flower-pending-turn]')).toBeNull();
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
  });
});
