// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerPermissionType,
  FlowerRouterDecision,
  FlowerSettingsSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  blockedDecision,
  decision,
  deferred,
  flush,
  liveBootstrap,
  mutableSettingsAdapter,
  renderSurface,
  renderSurfaceWithAdapter,
  retiredHandlerUnavailableCopy,
  settingsSnapshot,
  thread,
  wait,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('FlowerSurface navigation', () => {
  it('returns from settings to the chat panel with an icon-only control', async () => {
    const runtime = renderSurface();
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();
    expect(runtime.querySelector('.flower-chat-shell')).toBeNull();

    const back = runtime.querySelector('button[aria-label="Back to chat"]') as HTMLButtonElement | null;
    expect(back).toBeTruthy();
    expect(back?.textContent?.trim()).toBe('');

    back?.click();
    await flush();

    expect(runtime.querySelector('.flower-chat-shell')).toBeTruthy();
  });

  it('lets the single flower entry start a new chat from settings', async () => {
    const runtime = renderSurface();
    await flush();

    (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-chat-shell')));
    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    const newChat = runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement | null;
    expect(newChat?.textContent).toContain('New chat');
    newChat?.click();
    await flush();

    expect(runtime.querySelector('.flower-chat-shell')).toBeTruthy();
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Ask Flower');
    expect(runtime.querySelector('.flower-thread-card-active')).toBeNull();
  });

  it('selects a thread from settings and returns to chat', async () => {
    const runtime = renderSurface();
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-chat-header-title')?.textContent === 'Deploy plan');

    expect(runtime.querySelector('.flower-chat-shell')).toBeTruthy();
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Deploy plan');
  });

  it('explains when a reply was interrupted by a runtime restart', async () => {
    const interruptedThread = thread({
      status: 'canceled',
      error: {
        code: 'runtime_restarted',
        message: 'The local runtime restarted before this reply finished.',
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [interruptedThread]),
      loadThread: vi.fn(async () => liveBootstrap(interruptedThread)),
    });
    await flush();
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"] button')));
    (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-error-card').length > 0);

    expect(runtime.querySelector('.flower-error-card')?.textContent).toContain(
      'The local runtime restarted before this reply finished. Start a new reply when the runtime is ready.',
    );
    expect(runtime.querySelector('.flower-error-actions')).toBeNull();
  });

  it('shows the Local AI Profile editor without a separate Flower enable switch', async () => {
    const surfaceAdapter = mutableSettingsAdapter(false);
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    expect(runtime.querySelector('.flower-settings-title-feedback')?.textContent).toBe('');
    expect(runtime.querySelector('.flower-settings-current-model')).toBeTruthy();
    expect(runtime.textContent).toContain('Configure models and the default Flower permission for the Local AI Profile.');

    const fullAccessButton = Array.from(runtime.querySelectorAll('.flower-settings-policy-card'))
      .find((button) => button.textContent?.includes('Full access')) as HTMLButtonElement | undefined;
    fullAccessButton?.click();
    await wait(850);
    await flush();

    expect(surfaceAdapter.saveDefaultPermission).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('.flower-settings-title-feedback')?.textContent).toContain('Saved');
  }, 5000);

  it('coalesces rapid default permission changes to the latest selection', async () => {
    const saveDefaultPermission = vi.fn(async (permissionType: FlowerPermissionType) => ({
      ...settingsSnapshot(true),
      defaults: { permission_type: permissionType },
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      saveDefaultPermission,
    });
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();
    const permissionButtons = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-settings-policy-card'));
    permissionButtons.find((button) => button.textContent?.includes('Read-only'))?.click();
    permissionButtons.find((button) => button.textContent?.includes('Full access'))?.click();

    await wait(850);
    await flush();
    expect(saveDefaultPermission).toHaveBeenCalledTimes(1);
    expect(saveDefaultPermission).toHaveBeenCalledWith('full_access');
  }, 5000);

  it('opens provider setup from settings when no model is configured', async () => {
    const surfaceAdapter = mutableSettingsAdapter(false);
    const emptySnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(false),
      model_profile: null,
      provider_secrets: [],
    };
    const runtime = renderSurfaceWithAdapter({
      ...surfaceAdapter,
      loadSettings: vi.fn(async () => emptySnapshot),
      saveModelProfile: vi.fn(async () => emptySnapshot),
    });
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    expect(runtime.querySelector('.flower-settings-current-model')?.textContent).toContain('No model selected');
    (Array.from(runtime.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Add provider')) as HTMLButtonElement).click();
    await flush();

    expect(runtime.querySelector('[role="dialog"]')?.textContent).toContain('Provider type');
  });

  it('keeps the remote provider editor visible when Desktop models are also available', async () => {
    const launchTurn = vi.fn(async () => liveBootstrap(thread()));
    const desktopSourceSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(true),
      model_source: {
        kind: 'desktop_model_source',
        ready: true,
        current_model_id: 'desktop:gpt-5.2',
        label: 'Local AI Profile',
        model_count: 1,
        models: [{ id: 'desktop:gpt-5.2', label: 'Desktop / gpt-5.2' }],
      },
    };
    const saveDefaultPermission = vi.fn(async () => desktopSourceSnapshot);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: vi.fn(async () => desktopSourceSnapshot),
      saveDefaultPermission,
      launchTurn,
    });
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    expect(runtime.querySelector('.flower-settings-managed-source')).toBeNull();
    expect(runtime.querySelector('.flower-settings-current-model')?.textContent).toContain('OpenAI / gpt-5.2');
    expect(runtime.querySelector('.flower-settings-policy-card')).toBeTruthy();
    expect(runtime.querySelector('.flower-settings-providers-section')).toBeTruthy();
    expect(runtime.textContent).toContain('Add provider');
    expect(runtime.textContent).toContain('OpenAI');
    expect(runtime.textContent).toContain('gpt-5.2');
    await wait(850);
    await flush();
    expect(saveDefaultPermission).not.toHaveBeenCalled();

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await flush();
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement | null;
    textarea!.value = 'hello from desktop source';
    textarea!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();

    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
  });

  it('keeps the normal empty state and compact setup footer when the provider is not ready', async () => {
    const runtime = renderSurface(false);
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();
    const newChat = runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement | null;
    expect(newChat?.textContent).toContain('New chat');
    newChat?.click();
    await flush();

    expect(runtime.querySelector('.flower-chat-shell')).toBeTruthy();
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Ask Flower');
    expect(runtime.querySelector('.flower-empty-state')).toBeTruthy();
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
    expect(runtime.querySelector('.flower-setup-inline')?.textContent).toContain('Set up a model provider to start chatting.');
    expect(runtime.querySelector('.flower-handler-error')).toBeNull();
    expect(runtime.textContent).not.toContain(retiredHandlerUnavailableCopy());

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement | null;
    textarea!.value = 'hello';
    textarea!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();

    expect(runtime.querySelector('.flower-chat-shell')).toBeTruthy();
    expect(runtime.querySelector('.flower-setup-inline')).toBeTruthy();
  });

  it('shows a starting handler state before settings finish loading', async () => {
    const settings = deferred<FlowerSettingsSnapshot>();
    const resolveHandler = vi.fn(async () => decision());
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(() => settings.promise),
      resolveHandler,
    });
    await flush();

    expect(runtime.querySelector('.flower-model-chip')?.textContent).toContain('No model selected');
    expect(runtime.textContent).not.toContain(retiredHandlerUnavailableCopy());
    expect(resolveHandler).not.toHaveBeenCalled();

    settings.resolve(settingsSnapshot(true));
    await waitFor(() => resolveHandler.mock.calls.length === 1);
    expect(runtime.textContent).not.toContain(retiredHandlerUnavailableCopy());
  });

  it('keeps handler resolution pending without showing an unavailable error', async () => {
    const handler = deferred<FlowerRouterDecision>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      resolveHandler: vi.fn(() => handler.promise),
    });
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-reasoning-model-label')));

    expect(runtime.querySelector('.flower-model-reasoning-model-label')?.textContent).toContain('OpenAI / gpt-5.2');
    expect(runtime.querySelector('.flower-handler-error-card')).toBeNull();
    expect(runtime.textContent).not.toContain(retiredHandlerUnavailableCopy());

    handler.resolve(decision());
    await flush();
    expect(runtime.textContent).not.toContain('Using Local AI Profile');
    expect(runtime.querySelector('.flower-model-reasoning-model-label')?.textContent).toContain('OpenAI / gpt-5.2');
  });

  it('shows the selected thread model in the composer footer', async () => {
    const selectedModelThread = thread({
      thread_id: 'thread-selected-model',
      title: 'Selected model',
      model_id: 'openai/gpt-5.4-mini',
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => ({
        ...settingsSnapshot(true),
        model_profile: {
          ...settingsSnapshot(true).model_profile!,
          providers: [{
            ...settingsSnapshot(true).model_profile!.providers[0],
            models: [
              ...settingsSnapshot(true).model_profile!.providers[0].models,
              { model_name: 'gpt-5.4-mini', context_window: 400000, input_modalities: ['text'] },
            ],
          }],
        },
      })),
      listThreads: vi.fn(async () => [selectedModelThread]),
      loadThread: vi.fn(async () => liveBootstrap(selectedModelThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-selected-model"] button')));
    (runtime.querySelector('[data-thread-id="thread-selected-model"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('gpt-5.4-mini') ?? false);

    expect(runtime.querySelector('.flower-model-reasoning-model-label')?.textContent).toContain('OpenAI / gpt-5.4-mini');
    expect(runtime.querySelector('.flower-model-reasoning-model-label')?.textContent).not.toContain('gpt-5.2');
  });

  it('shows handler blockers near the composer without pretending a runtime is selected', async () => {
    const failingAdapter = {
      ...adapter(true),
      resolveHandler: vi.fn(async () => blockedDecision()),
    };
    const runtime = renderSurfaceWithAdapter(failingAdapter);
    await flush();

    expect(runtime.querySelector('.flower-model-reasoning-model-label')?.textContent).toContain('OpenAI / gpt-5.2');
    expect(runtime.querySelector('.flower-handler-error-card')?.textContent).toContain('Configure Flower before chatting.');
    expect(runtime.querySelector('.flower-handler-retry')?.textContent).toContain('Retry');
    expect(runtime.textContent).not.toContain(retiredHandlerUnavailableCopy());
    const sendButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
    expect(sendButton?.getAttribute('aria-label')).toBe('Send');
    expect(sendButton?.disabled).toBe(true);
  });

  it('shows startup failures as recoverable Flower start errors', async () => {
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      resolveHandler: vi.fn(async () => {
        throw new Error('Timed out waiting for Flower readiness.');
      }),
    });
    await flush();

    expect(runtime.querySelector('.flower-model-reasoning-model-label')?.textContent).toContain('OpenAI / gpt-5.2');
    expect(runtime.querySelector('.flower-handler-error-card')?.textContent).toContain('Timed out waiting for Flower readiness.');
    expect(runtime.textContent).not.toContain(retiredHandlerUnavailableCopy());
  });

  it('keeps handler choices out of the composer and keeps selected thread sends decision-free', async () => {
    const secondDecision: FlowerRouterDecision = {
      ...decision(),
      decision_id: 'decision-2',
      selected_handler: {
        ...decision().selected_handler!,
        handler_id: 'runtime-2',
        display_name: 'Lab Flower',
        selection_source: 'user_selected',
      },
      available_handlers: [
        decision().selected_handler!,
        {
          ...decision().selected_handler!,
          handler_id: 'runtime-2',
          display_name: 'Lab Flower',
        },
      ],
      handler_selection: {
        can_switch: true,
        requires_user_visible_confirmation: true,
      },
    };
    const resolveHandler = vi.fn(async (input?: any) => (input?.requested_handler_id === 'runtime-2' ? secondDecision : {
      ...decision(),
      available_handlers: secondDecision.available_handlers,
      handler_selection: secondDecision.handler_selection,
    }));
    const launchTurn = vi.fn(async () => liveBootstrap(thread()));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      resolveHandler,
      launchTurn,
    });
    await flush();

    expect(runtime.querySelector('.flower-model-reasoning-model-label')?.textContent).toContain('OpenAI / gpt-5.2');

    (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-chat-header-title')?.textContent === 'Deploy plan');
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();

    expect(launchTurn).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-1',
      prompt: 'continue',
      decision: null,
    }));
  });

  it('waits for canonical timeline messages after a new thread is accepted', async () => {
    const acceptedThread = thread({
      thread_id: 'thread-accepted-without-messages',
      title: 'Accepted pending',
      status: 'running',
      messages: [],
    });
    const caughtUpThread = thread({
      ...acceptedThread,
      messages: [{
        id: 'm-accepted-user',
        role: 'user',
        content: 'follow the accepted thread',
        status: 'complete',
        created_at_ms: 10,
      }],
    });
    const launchTurn = vi.fn(async () => liveBootstrap(acceptedThread));
    const loadThread = vi.fn(async () => liveBootstrap(caughtUpThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      launchTurn,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'follow the accepted thread';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => launchTurn.mock.calls.length > 0);
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('follow the accepted thread') ?? false);
    expect(runtime.textContent).toContain('follow the accepted thread');
    expect(runtime.querySelector('[data-flower-message-role="user"][data-flower-message-status="complete"]')).toBeTruthy();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(loadThread).toHaveBeenCalledWith('thread-accepted-without-messages');
  });

  it('renders run and message errors as structured error cards', async () => {
    const failedThread = thread({
      thread_id: 'thread-failed',
      title: 'Failed reply',
      created_at_ms: 7_000,
      updated_at_ms: 7_500,
      status: 'failed',
      error: {
        code: 'failed',
        message: 'Run failed: provider rejected request.',
      },
      messages: [
        {
          id: 'm-failed',
          role: 'assistant',
          content: 'The provider rejected this request.',
          status: 'error',
          created_at_ms: 7_500,
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failedThread]),
      loadThread: vi.fn(async () => liveBootstrap(failedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-failed"] button')));
    (runtime.querySelector('[data-thread-id="thread-failed"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-error-card').length > 0);

    expect(runtime.querySelector('.flower-message-bubble-error')?.textContent).toContain('Message failed');
    expect(runtime.querySelectorAll('.flower-error-card')).toHaveLength(1);
    expect(runtime.querySelector('.flower-error-card')?.textContent).toContain('Flower could not finish this reply.');
    expect(runtime.querySelector('.flower-error-card')?.textContent).toContain('Run failed: provider rejected request.');
  });

  it('clears global load errors after the thread list recovers', async () => {
    const visibleThread = thread({
      thread_id: 'thread-after-list-recovery',
      title: 'Recovered list',
      created_at_ms: 7_800,
      updated_at_ms: 7_900,
    });
    const listThreads = vi.fn()
      .mockRejectedValueOnce(new Error('Flower waiting input request is incomplete.'))
      .mockResolvedValueOnce([visibleThread]);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread: vi.fn(async () => liveBootstrap(visibleThread)),
    });

    await waitFor(() => runtime.textContent?.includes('Flower waiting input request is incomplete.') ?? false);

    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-after-list-recovery"] button')));

    expect(runtime.textContent).not.toContain('Flower could not load.');
    expect(runtime.textContent).not.toContain('Flower waiting input request is incomplete.');
    expect(runtime.querySelectorAll('.flower-error-card')).toHaveLength(0);
  });

  it('does not render an empty failed message bubble when the run error already explains the failure', async () => {
    const failedThread = thread({
      thread_id: 'thread-empty-failure',
      title: 'Failed empty reply',
      created_at_ms: 8_000,
      updated_at_ms: 8_500,
      status: 'failed',
      error: {
        code: 'failed',
        message: 'Run failed before any assistant text was produced.',
      },
      messages: [
        {
          id: 'm-empty-failed',
          role: 'assistant',
          content: '',
          status: 'error',
          created_at_ms: 8_500,
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failedThread]),
      loadThread: vi.fn(async () => liveBootstrap(failedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-empty-failure"] button')));
    (runtime.querySelector('[data-thread-id="thread-empty-failure"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-error-card').length > 0);

    expect(runtime.querySelector('.flower-message-bubble-error')).toBeNull();
    expect(runtime.querySelectorAll('.flower-error-card')).toHaveLength(1);
    expect(runtime.querySelector('.flower-error-card')?.textContent).toContain('Run failed before any assistant text was produced.');
  });

  it('renders an empty failed message bubble when there is no run-level error', async () => {
    const failedThread = thread({
      thread_id: 'thread-message-only-failure',
      title: 'Message failure',
      created_at_ms: 8_600,
      updated_at_ms: 8_700,
      status: 'failed',
      error: null,
      messages: [
        {
          id: 'm-message-only-failed',
          role: 'assistant',
          content: '',
          status: 'error',
          created_at_ms: 8_700,
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failedThread]),
      loadThread: vi.fn(async () => liveBootstrap(failedThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-message-only-failure"] button')));
    (runtime.querySelector('[data-thread-id="thread-message-only-failure"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-message-bubble-error')));

    expect(runtime.querySelector('.flower-message-bubble-error')?.textContent).toContain('Message failed');
    expect(runtime.querySelector('.flower-message-bubble-error')?.textContent).toContain('This message failed before Flower produced visible text.');
    expect(runtime.querySelectorAll('.flower-error-card')).toHaveLength(0);
  });
});
