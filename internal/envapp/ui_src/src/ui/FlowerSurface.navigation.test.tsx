// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowerSurface } from '../../../../flower_ui/src';
import type {
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerInputRequest,
  FlowerRouterDecision,
  FlowerSettingsDraft,
  FlowerSurfaceAdapter,
  FlowerSurfaceDraftIntent,
  FlowerSettingsSnapshot,
  FlowerThreadReadStatus,
  FlowerLiveBootstrap,
  FlowerLiveEventsResponse,
  FlowerThreadSnapshot,
  FlowerActivityStatus,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = (props: any) => <span data-icon class={props.class} />;
  return {
    AlertTriangle: Icon,
    ArrowUp: Icon,
    Bot: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    Clock: Icon,
    Code: Icon,
    Copy: Icon,
    FileText: Icon,
    Folder: Icon,
    FolderOpen: Icon,
    GitBranch: Icon,
    GripVertical: Icon,
    MoreHorizontal: Icon,
    Pencil: Icon,
    Pin: Icon,
    Plus: Icon,
    Refresh: Icon,
    Search: Icon,
    Send: Icon,
    Settings: Icon,
    Shield: Icon,
    Sparkles: Icon,
    Terminal: Icon,
    Trash: Icon,
    X: Icon,
    Zap: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => {
    const Icon = props.icon;
    return (
      <button
        type="button"
        class={props.class}
        aria-label={props['aria-label']}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        <Show when={Icon}>
          <Icon />
        </Show>
        {props.children}
      </button>
    );
  },
  Checkbox: (props: any) => (
    <input
      type="checkbox"
      checked={!!props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)}
    />
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div role="dialog">{props.children}</div>
    </Show>
  ),
  Input: (props: any) => (
    <input
      class={props.class}
      value={props.value}
      placeholder={props.placeholder}
      onInput={props.onInput}
      disabled={props.disabled}
    />
  ),
  ProcessingIndicator: (props: any) => <span class={props.class}>{props.children}</span>,
  Select: (props: any) => (
    <select
      class={props.class}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.((event.currentTarget as HTMLSelectElement).value)}
    >
      {(props.options ?? []).map((option: any) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retiredHandlerUnavailableCopy(): string {
  return ['Flower handler', 'unavailable'].join(' ');
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await wait(10);
    await flush();
    if (condition()) return;
  }
  throw new Error('Timed out waiting for FlowerSurface condition.');
}

function settingsSnapshot(configured = true): FlowerSettingsSnapshot {
  return {
    config: {
      schema_version: 1,
      current_model_id: 'openai/gpt-5.2',
      execution_policy: {
        require_user_approval: true,
        block_dangerous_commands: true,
      },
      terminal_exec_policy: {
        default_timeout_ms: 120000,
        max_timeout_ms: 600000,
      },
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          models: [
            {
              model_name: 'gpt-5.2',
              context_window: 400000,
              input_modalities: ['text'],
            },
          ],
        },
      ],
    },
    provider_secrets: [
      {
        provider_id: 'openai',
        provider_api_key_configured: configured,
        web_search_api_key_configured: false,
      },
    ],
  };
}

function readStatus(isUnread = false, revision = 2, status = 'idle'): FlowerThreadReadStatus {
  const signature = `status:${status}\u001factivity:${revision}`;
  return {
    is_unread: isUnread,
    snapshot: {
      activity_revision: revision,
      last_message_at_unix_ms: revision,
      activity_signature: signature,
    },
    read_state: {
      last_seen_activity_revision: isUnread ? Math.max(0, revision - 1) : revision,
      last_read_message_at_unix_ms: isUnread ? Math.max(0, revision - 1) : revision,
      last_seen_activity_signature: isUnread ? `status:${status}\u001factivity:${Math.max(0, revision - 1)}` : signature,
    },
  };
}

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-1',
    title: 'Deploy plan',
    model_id: 'openai/gpt-5.2',
    working_dir: '/workspace/redeven',
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'idle',
    source_label: 'Local Environment',
    target_labels: [],
    read_status: readStatus(false),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Plan deploy',
        status: 'complete',
        created_at_ms: 1,
      },
    ],
    ...overrides,
  };
}

function liveBootstrap(threadValue: FlowerThreadSnapshot, cursor = 0): FlowerLiveBootstrap {
  return {
    schema_version: 1,
    endpoint_id: 'test-runtime',
    thread_id: threadValue.thread_id,
    cursor,
    retained_from_seq: 1,
    thread: threadValue,
    transcript_messages: threadValue.messages,
    live_state: {
      thread_patch: {},
      message_order: [],
      messages: {},
      runs: {},
      approval_actions: {},
      input_requests: {},
    },
    read_status: threadValue.read_status,
    generated_at_ms: Math.max(Date.now(), threadValue.updated_at_ms),
  };
}

function activityItem(overrides: Partial<FlowerActivityItem> = {}): FlowerActivityItem {
  return {
    item_id: 'tool-terminal',
    tool_id: 'tool-terminal',
    tool_name: 'terminal.exec',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    needs_attention: false,
    requires_approval: false,
    ...overrides,
  };
}

function activityTimeline(args: {
  run_id?: string;
  turn_id?: string;
  status?: FlowerActivityStatus;
  severity?: 'quiet' | 'normal' | 'warning' | 'error' | 'blocking';
  needs_attention?: boolean;
  items: readonly FlowerActivityItem[];
  file_actions?: FlowerActivityTimelineBlock['file_actions'];
}): FlowerActivityTimelineBlock {
  const status = args.status ?? 'success';
  const severity = args.severity ?? (status === 'success' ? 'quiet' : status === 'error' ? 'error' : 'normal');
  const counts: {
    pending?: number;
    running?: number;
    waiting?: number;
    success?: number;
    error?: number;
    canceled?: number;
    approval?: number;
  } = {};
  for (const item of args.items) {
    if (item.status === 'pending') counts.pending = (counts.pending ?? 0) + 1;
    if (item.status === 'running') counts.running = (counts.running ?? 0) + 1;
    if (item.status === 'waiting') counts.waiting = (counts.waiting ?? 0) + 1;
    if (item.status === 'success') counts.success = (counts.success ?? 0) + 1;
    if (item.status === 'error') counts.error = (counts.error ?? 0) + 1;
    if (item.status === 'canceled') counts.canceled = (counts.canceled ?? 0) + 1;
    if (item.requires_approval) counts.approval = (counts.approval ?? 0) + 1;
  }
  return {
    type: 'activity-timeline' as const,
    schema_version: 1,
    run_id: args.run_id ?? 'run-1',
    turn_id: args.turn_id ?? 'm-1',
    summary: {
      status,
      severity,
      needs_attention: args.needs_attention ?? args.items.some((item) => item.needs_attention),
      total_items: args.items.length,
      counts,
    },
    items: args.items,
    ...(args.file_actions ? { file_actions: args.file_actions } : {}),
  };
}

function inputRequest(overrides: Partial<FlowerInputRequest> = {}): FlowerInputRequest {
  return {
    prompt_id: 'prompt-ask-user',
    message_id: 'message-ask-user',
    tool_id: 'tool-ask-user',
    tool_name: 'ask_user',
    reason_code: 'needs_user_choice',
    public_summary: 'Choose the deployment target before Flower continues.',
    questions: [
      {
        id: 'target',
        header: 'Deployment target',
        question: 'Where should Flower deploy this change?',
        response_mode: 'select',
        choices: [
          {
            choice_id: 'staging',
            label: 'Staging',
            description: 'Use the safe validation environment.',
            kind: 'select',
          },
          {
            choice_id: 'production',
            label: 'Production',
            description: 'Use the live environment.',
            kind: 'select',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function decision(): FlowerRouterDecision {
  return {
    decision_id: 'decision-1',
    decision_revision: 1,
    route: 'env_local',
    reason_code: 'runtime_available',
    selected_handler: {
      handler_id: 'local-environment',
      handler_kind: 'env_local',
      display_name: 'Local Environment',
      carrier_kind: 'runtime',
      state: 'online',
      selection_source: 'router_default',
      supports_thread_kinds: ['chat'],
    },
    available_handlers: [],
    unavailable_handlers: [],
    handler_selection: {
      can_switch: false,
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'flower_surface',
    },
    runtime_presence: {
      schema_version: 1,
      runtime_id: 'local-environment',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Local Environment',
      state: 'online',
      endpoint: { visibility: 'local' },
      capabilities: ['chat'],
      last_seen_at_unix_ms: 1,
    },
    allowed_actions: ['start_thread'],
    ui_chips: [{ kind: 'runtime', label: 'Using Local AI Profile', tone: 'normal' }],
    blocker: null,
    created_at_unix_ms: 1,
  };
}

function blockedDecision(): FlowerRouterDecision {
  return {
    ...decision(),
    decision_id: 'decision-blocked',
    route: 'blocked',
    reason_code: 'runtime_not_configured',
    selected_handler: null,
    available_handlers: [],
    ui_chips: [{ kind: 'runtime', label: 'Flower needs setup', tone: 'warning' }],
    blocker: {
      code: 'runtime_not_configured',
      message: 'Configure Flower before chatting.',
    },
  };
}

function adapter(configured = true): FlowerSurfaceAdapter {
  return {
    runtime: {
      runtime_id: 'runtime',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Local Environment',
      subtitle: 'Global runtime',
    },
    loadSettings: vi.fn(async () => settingsSnapshot(configured)),
    saveSettings: vi.fn(async () => settingsSnapshot(configured)),
    listThreads: vi.fn(async () => [
      thread(),
      thread({ thread_id: 'thread-2', title: 'Review branch', updated_at_ms: 3 }),
    ]),
    loadThread: vi.fn(async (threadID: string) => liveBootstrap(thread({ thread_id: threadID }))),
    listThreadLiveEvents: vi.fn(async () => ({ events: [], next_cursor: 0, retained_from_seq: 1 })),
    markThreadRead: vi.fn(async (threadID: string, snapshot) => liveBootstrap(thread({
      thread_id: threadID,
      read_status: {
        is_unread: false,
        snapshot,
        read_state: {
          last_seen_activity_revision: snapshot.activity_revision,
          last_read_message_at_unix_ms: snapshot.last_message_at_unix_ms,
          last_seen_activity_signature: snapshot.activity_signature,
          ...(snapshot.waiting_prompt_id ? { last_seen_waiting_prompt_id: snapshot.waiting_prompt_id } : {}),
        },
      },
    }))),
    resolveHandler: vi.fn(async () => decision()),
    sendMessage: vi.fn(async () => liveBootstrap(thread())),
    submitInput: vi.fn(async () => liveBootstrap(thread({ status: 'running' }))),
    submitApproval: vi.fn(async () => undefined),
  };
}

function mutableSettingsAdapter(configured = true): FlowerSurfaceAdapter & Readonly<{
  saveSettings: ReturnType<typeof vi.fn>;
}> {
  let snapshot = settingsSnapshot(configured);
  return {
    ...adapter(configured),
    loadSettings: vi.fn(async () => snapshot),
    saveSettings: vi.fn(async (draft: FlowerSettingsDraft) => {
      snapshot = {
        ...snapshot,
        config: {
          ...draft.config,
          providers: draft.config.providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            type: provider.type,
            base_url: provider.base_url,
            web_search: provider.web_search,
            models: provider.models,
          })),
        },
      };
      return snapshot;
    }),
  };
}

function threadOrder(runtime: HTMLElement): string[] {
  return Array.from(runtime.querySelectorAll('[data-thread-id]'))
    .map((node) => node.getAttribute('data-thread-id') ?? '');
}

describe('FlowerSurface navigation', () => {
  const disposers: Array<() => void> = [];

  const mountFlowerSurface = (surfaceAdapter: FlowerSurfaceAdapter): HTMLDivElement => {
    const runtime = document.createElement('div');
    document.body.appendChild(runtime);
    disposers.push(render(() => <FlowerSurface adapter={surfaceAdapter} />, runtime));
    return runtime;
  };

  function renderSurface(configured = true): HTMLDivElement {
    return mountFlowerSurface(adapter(configured));
  }

  function renderSurfaceWithAdapter(surfaceAdapter: FlowerSurfaceAdapter): HTMLDivElement {
    return mountFlowerSurface(surfaceAdapter);
  }

  function renderSurfaceWithDraftIntent(
    surfaceAdapter: FlowerSurfaceAdapter,
    draftIntent: FlowerSurfaceDraftIntent,
  ): HTMLDivElement {
    const runtime = document.createElement('div');
    document.body.appendChild(runtime);
    disposers.push(render(() => <FlowerSurface adapter={surfaceAdapter} draftIntent={draftIntent} />, runtime));
    return runtime;
  }

  afterEach(() => {
    while (disposers.length > 0) {
      disposers.pop()?.();
    }
    document.body.innerHTML = '';
  });

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
    await flush();
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

  it('prefills a shared Flower draft intent and sends its context action through the adapter', async () => {
    const contextAction = {
      schema_version: 2,
      action_id: 'assistant.ask.flower',
      target: { target_id: 'local-environment', locality: 'auto' },
      source: { surface: 'monitoring' },
      context: [],
      presentation: { label: 'Local Environment', priority: 100 },
    };
    const sentThread = thread({
      thread_id: 'thread-context-action',
      title: 'Context action',
      status: 'running',
      messages: [
        {
          id: 'm-context-user',
          role: 'user',
          content: 'From Desktop Environment: Local Environment\n\nCheck readiness',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const sendMessage = vi.fn(async () => liveBootstrap(sentThread));
    const runtime = renderSurfaceWithDraftIntent({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      sendMessage,
    }, {
      id: 'desktop-local-environment',
      prompt: 'From Desktop Environment: Local Environment\n\nCheck readiness',
      context_action: contextAction,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('From Desktop Environment: Local Environment\n\nCheck readiness');

    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => sendMessage.mock.calls.length > 0);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'From Desktop Environment: Local Environment\n\nCheck readiness',
      context_action: contextAction,
    }));
  });

  it('selects a thread from settings and returns to chat', async () => {
    const runtime = renderSurface();
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await flush();

    expect(runtime.querySelector('.flower-chat-shell')).toBeTruthy();
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Deploy plan');
  });

  it('shows the Local AI Profile editor without a separate Flower enable switch', async () => {
    const surfaceAdapter = mutableSettingsAdapter(false);
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    expect(runtime.querySelector('.flower-settings-title-feedback')?.textContent).toBe('');
    expect(runtime.querySelector('.flower-settings-current-model')).toBeTruthy();
    expect(runtime.textContent).toContain('Configure models and execution policy for the Local AI Profile.');

    const approvalButton = Array.from(runtime.querySelectorAll('.flower-settings-policy-card'))
      .find((button) => button.textContent?.includes('User approval')) as HTMLButtonElement | undefined;
    approvalButton?.click();
    await wait(850);
    await flush();

    expect(surfaceAdapter.saveSettings).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('.flower-settings-title-feedback')?.textContent).toContain('Saved');
  }, 5000);

  it('opens provider setup from settings when no model is configured', async () => {
    const surfaceAdapter = mutableSettingsAdapter(false);
    const emptySnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(false),
      config: {
        ...settingsSnapshot(false).config,
        current_model_id: '',
        providers: [],
      },
      provider_secrets: [],
    };
    const runtime = renderSurfaceWithAdapter({
      ...surfaceAdapter,
      loadSettings: vi.fn(async () => emptySnapshot),
      saveSettings: vi.fn(async () => emptySnapshot),
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

  it('uses Desktop Model Source readiness without exposing a second provider editor', async () => {
    const sendMessage = vi.fn(async () => liveBootstrap(thread()));
    const desktopSourceSnapshot: FlowerSettingsSnapshot = {
      ...settingsSnapshot(false),
      config: {
        ...settingsSnapshot(false).config,
        current_model_id: 'desktop:gpt-5.2',
      },
      provider_secrets: [],
      model_source: {
        kind: 'desktop_model_source',
        ready: true,
        label: 'Local AI Profile',
        model_count: 1,
      },
    };
    const saveSettings = vi.fn(async () => desktopSourceSnapshot);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(false),
      loadSettings: vi.fn(async () => desktopSourceSnapshot),
      saveSettings,
      sendMessage,
    });
    await flush();

    (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    expect(runtime.textContent).toContain('Local AI Profile on this Mac');
    expect(runtime.textContent).toContain('Open Local Environment Settings on this Mac to change providers, models, or keys.');
    expect(runtime.querySelector('.flower-settings-current-model')).toBeNull();
    expect(runtime.querySelector('.flower-settings-policy-card')).toBeNull();
    expect(runtime.querySelector('.flower-settings-providers-section')).toBeNull();
    expect(runtime.querySelector('.flower-settings-terminal-section')).toBeNull();
    expect(runtime.textContent).not.toContain('Add provider');
    expect(runtime.textContent).not.toContain('OpenAI');
    expect(runtime.textContent).not.toContain('gpt-5.2');
    expect(runtime.textContent).not.toContain('User approval');
    expect(runtime.textContent).not.toContain('Terminal execution limits');
    await wait(850);
    await flush();
    expect(saveSettings).not.toHaveBeenCalled();

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await flush();
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement | null;
    textarea!.value = 'hello from desktop source';
    textarea!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('.flower-setup-guide')).toBeNull();
  });

  it('guides setup from new chat when the provider is not ready', async () => {
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
    expect(runtime.querySelector('.flower-setup-guide')?.textContent).toContain('Set up Flower');
    expect(runtime.querySelector('.flower-setup-guide')?.textContent).toContain('Choose a provider, model, and API key once.');
    expect(runtime.querySelector('.flower-handler-error')).toBeNull();
    expect(runtime.textContent).not.toContain(retiredHandlerUnavailableCopy());

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement | null;
    textarea!.value = 'hello';
    textarea!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();

    expect(runtime.querySelector('.flower-chat-shell')).toBeNull();
    expect(runtime.querySelector('button[aria-label="Back to chat"]')).toBeTruthy();
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

    expect(runtime.querySelector('.flower-model-selection')?.textContent).toContain('Model');
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
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-chip')));

    expect(runtime.querySelector('.flower-model-selection')?.textContent).toContain('Model');
    expect(runtime.querySelector('.flower-model-chip')?.textContent).toContain('OpenAI / gpt-5.2');
    expect(runtime.querySelector('.flower-handler-error-card')).toBeNull();
    expect(runtime.textContent).not.toContain(retiredHandlerUnavailableCopy());

    handler.resolve(decision());
    await flush();
    expect(runtime.textContent).not.toContain('Using Local AI Profile');
    expect(runtime.querySelector('.flower-model-chip')?.textContent).toContain('OpenAI / gpt-5.2');
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
        config: {
          ...settingsSnapshot(true).config,
          providers: [{
            ...settingsSnapshot(true).config.providers[0],
            models: [
              ...settingsSnapshot(true).config.providers[0].models,
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
    await waitFor(() => runtime.querySelector('.flower-model-chip')?.textContent?.includes('gpt-5.4-mini') ?? false);

    expect(runtime.querySelector('.flower-model-chip')?.textContent).toContain('OpenAI / gpt-5.4-mini');
    expect(runtime.querySelector('.flower-model-chip')?.textContent).not.toContain('gpt-5.2');
  });

  it('shows handler blockers near the composer without pretending a runtime is selected', async () => {
    const failingAdapter = {
      ...adapter(true),
      resolveHandler: vi.fn(async () => blockedDecision()),
    };
    const runtime = renderSurfaceWithAdapter(failingAdapter);
    await flush();

    expect(runtime.querySelector('.flower-model-chip')?.textContent).toContain('OpenAI / gpt-5.2');
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

    expect(runtime.querySelector('.flower-model-chip')?.textContent).toContain('OpenAI / gpt-5.2');
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
    const sendMessage = vi.fn(async () => liveBootstrap(thread()));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      resolveHandler,
      sendMessage,
    });
    await flush();

    expect(runtime.querySelector('.flower-model-selection')?.textContent).toContain('Model');
    expect(runtime.querySelector('.flower-model-chip')?.textContent).toContain('OpenAI / gpt-5.2');

    (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await flush();
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'continue';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-1',
      prompt: 'continue',
      decision: null,
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
    const sendMessage = vi.fn(async () => liveBootstrap(sentThread));
    const loadThread = vi.fn(async () => liveBootstrap(completeThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      sendMessage,
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
    await waitFor(() => sendMessage.mock.calls.length > 0);
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('Flower verification is complete.') ?? false);

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: undefined,
      prompt: 'verify Flower',
    }));
    expect(loadThread).toHaveBeenCalledWith('thread-new');
    expect(runtime.textContent).toContain('Flower verification is complete.');
  });

  it('shows a streaming assistant placeholder immediately after send when the running thread has not streamed yet', async () => {
    const sentThread = thread({
      thread_id: 'thread-streaming-placeholder',
      title: 'Flower placeholder',
      status: 'running',
      messages: [
        {
          id: 'm-user',
          role: 'user',
          content: 'show the placeholder',
          status: 'complete',
          created_at_ms: 10,
        },
      ],
    });
    const loadThreadDeferred = deferred<FlowerLiveBootstrap>();
    const loadThread = vi.fn(() => loadThreadDeferred.promise);
    const sendMessage = vi.fn(async () => liveBootstrap(sentThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      sendMessage,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));

    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'show the placeholder';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const button = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-role="user"]')));
    await waitFor(() => Boolean(runtime.querySelector('.flower-streaming-cursor')), 2500);

    expect(runtime.textContent).toContain('show the placeholder');
    expect(runtime.querySelector('.flower-streaming-cursor')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-plain')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-framed')).toBeNull();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(loadThread).toHaveBeenCalled();
  });

  it('shows the submitted user message and streaming cursor while send is still in flight', async () => {
    const sendDeferred = deferred<FlowerLiveBootstrap>();
    const sendMessage = vi.fn(() => sendDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      sendMessage,
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
    await waitFor(() => sendMessage.mock.calls.length > 0);

    expect(runtime.textContent).toContain('inspect the running turn');
    expect(runtime.querySelector('[data-flower-message-role="user"][data-flower-message-status="sending"]')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"][data-flower-message-status="streaming"] .flower-streaming-cursor')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-framed')).toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows the submitted user message immediately while the handler is still resolving', async () => {
    const handlerDeferred = deferred<FlowerRouterDecision>();
    const sendDeferred = deferred<FlowerLiveBootstrap>();
    const sendMessage = vi.fn(() => sendDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      resolveHandler: vi.fn(() => handlerDeferred.promise),
      sendMessage,
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

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-role="user"][data-flower-message-status="sending"]')));
    expect(runtime.textContent).toContain('show before route settles');
    expect(runtime.querySelector('[data-flower-message-role="assistant"][data-flower-message-status="streaming"] .flower-streaming-cursor')).toBeTruthy();
    expect(sendMessage).not.toHaveBeenCalled();

    handlerDeferred.resolve(decision());
    await waitFor(() => sendMessage.mock.calls.length > 0);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'show before route settles',
    }));
  });

  it('keeps the pending turn visible after a new thread is accepted before messages catch up', async () => {
    const acceptedThread = thread({
      thread_id: 'thread-accepted-without-messages',
      title: 'Accepted pending',
      status: 'running',
      messages: [],
    });
    const loadThreadDeferred = deferred<FlowerLiveBootstrap>();
    const sendMessage = vi.fn(async () => liveBootstrap(acceptedThread));
    const loadThread = vi.fn(() => loadThreadDeferred.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      sendMessage,
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

    await waitFor(() => sendMessage.mock.calls.length > 0);
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('follow the accepted thread') ?? false);
    expect(runtime.textContent).toContain('follow the accepted thread');
    expect(runtime.querySelector('[data-flower-message-role="user"][data-flower-message-status="complete"]')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"][data-flower-message-status="streaming"] .flower-streaming-cursor')).toBeTruthy();
    expect(loadThread).toHaveBeenCalledWith('thread-accepted-without-messages');
  });

  it('renders file activity actions and unified patch lines inline', async () => {
    const previewFile = vi.fn(async () => {});
    const browseFolder = vi.fn(async () => {});
    const activityThread = thread({
      thread_id: 'thread-file-activity',
      title: 'File activity',
      messages: [
        {
          id: 'm-file',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 20,
          blocks: [
            {
              type: 'markdown',
              content: 'I will edit the file.',
            },
            activityTimeline({
              file_actions: {
                edit_app: {
                  action_id: 'edit_app',
                  display_name: 'app.ts',
                  can_preview: true,
                  can_browse_directory: true,
                },
              },
              items: [activityItem({
                item_id: 'tool-write',
                tool_id: 'tool-write',
                tool_name: 'file.write',
                renderer: 'file',
                label: 'app.ts#dcbdf9b8c27f',
                payload: {
                  operation: 'write',
                  display_name: 'app.ts',
                  file_action_id: 'edit_app',
                  change_type: 'update',
                  additions: 1,
                  deletions: 1,
                  unified_diff: [
                    '--- a/src/app.ts',
                    '+++ b/src/app.ts',
                    '@@ -1,1 +1,1 @@',
                    '-const value = 1;',
                    '+const value = 2;',
                  ].join('\n'),
                },
              })],
            }),
            {
              type: 'markdown',
              content: 'Done.',
            },
          ],
        },
      ],
    });
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [activityThread]),
      loadThread: vi.fn(async () => liveBootstrap(activityThread)),
      openFilePreview: previewFile,
      openFileBrowser: browseFolder,
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-file-activity"] button')));
    (host.querySelector('[data-thread-id="thread-file-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('[data-flower-activity-item-id="tool-write"]')));

    expect(host.textContent).toContain('I will edit the file.');
    expect(host.textContent).toContain('Done.');
    expect(host.textContent).not.toContain('#dcbdf9b8c27f');
    expect(host.querySelectorAll('.flower-activity-inline-line > .flower-activity-file-actions button')).toHaveLength(2);
    const preview = host.querySelector('button[aria-label="Preview app.ts"]') as HTMLButtonElement | null;
    const browser = host.querySelector('button[aria-label="Browse folder for app.ts"]') as HTMLButtonElement | null;
    expect(preview?.disabled).toBe(false);
    expect(browser?.disabled).toBe(false);

    const toggle = host.querySelector('[data-flower-activity-item-id="tool-write"] .flower-activity-inline-button') as HTMLButtonElement;
    toggle.click();
    await waitFor(() => Boolean(host.querySelector('.flower-activity-file-diff-line-del')));
    expect(host.querySelector('.flower-activity-file-diff-line-del')?.textContent).toContain('-const value = 1;');
    expect(host.querySelector('.flower-activity-file-diff-line-add')?.textContent).toContain('+const value = 2;');

    preview?.click();
    browser?.click();
    expect(previewFile).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-file-activity',
      message_id: 'm-file',
      block_index: 1,
      item_id: 'tool-write',
      action_id: 'edit_app',
    }));
    expect(browseFolder).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-file-activity',
      message_id: 'm-file',
      block_index: 1,
      item_id: 'tool-write',
      action_id: 'edit_app',
    }));
  });

  it('keeps the left thread list ordered by creation time when a selected thread refreshes', async () => {
    const olderThread = thread({
      thread_id: 'thread-older',
      title: 'Older but active',
      created_at_ms: 1_000,
      updated_at_ms: 50_000,
    });
    const newerThread = thread({
      thread_id: 'thread-newer',
      title: 'Newer conversation',
      created_at_ms: 2_000,
      updated_at_ms: 3_000,
    });
    const loadThread = vi.fn(async () => liveBootstrap({
      ...olderThread,
      updated_at_ms: 90_000,
      messages: [
        ...olderThread.messages,
        {
          id: 'm-older-assistant',
          role: 'assistant' as const,
          content: 'Still in the older thread.',
          status: 'complete' as const,
          created_at_ms: 90_000,
        },
      ],
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [olderThread, newerThread]),
      loadThread,
    });

    await waitFor(() => threadOrder(runtime).length === 2);
    expect(threadOrder(runtime)).toEqual(['thread-newer', 'thread-older']);

    (runtime.querySelector('[data-thread-id="thread-older"] button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('Still in the older thread.') ?? false);

    expect(threadOrder(runtime)).toEqual(['thread-newer', 'thread-older']);
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-older');
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-status')).toBe('idle');
    expect(runtime.querySelector('[data-thread-id="thread-older"]')?.getAttribute('data-flower-thread-active')).toBe('true');
    expect(runtime.querySelector('[data-thread-id="thread-older"]')?.getAttribute('data-flower-thread-status')).toBe('idle');
  });

  it('clears the unread sidebar dot immediately when a thread is selected', async () => {
    const unreadThread = thread({
      thread_id: 'thread-unread',
      title: 'Unread thread',
      read_status: readStatus(true, 3, 'success'),
    });
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => liveBootstrap({
      ...unreadThread,
      read_status: {
        is_unread: false,
        snapshot,
        read_state: {
          last_seen_activity_revision: snapshot.activity_revision,
          last_read_message_at_unix_ms: snapshot.last_message_at_unix_ms,
          last_seen_activity_signature: snapshot.activity_signature,
        },
      },
    }));
    const loadThread = vi.fn(async () => liveBootstrap({
      ...unreadThread,
      read_status: readStatus(false, 3, 'success'),
      messages: [
        ...unreadThread.messages,
        {
          id: 'm-unread-assistant',
          role: 'assistant' as const,
          content: 'Fresh result.',
          status: 'complete' as const,
          created_at_ms: 3,
        },
      ],
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [unreadThread]),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-unread"]')?.getAttribute('data-flower-thread-unread') === 'true');
    expect(runtime.querySelector('[data-thread-id="thread-unread"] .flower-thread-status-dot')).toBeTruthy();

    (runtime.querySelector('[data-thread-id="thread-unread"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-unread"]')?.getAttribute('data-flower-thread-unread') === 'false');
    await waitFor(() => markThreadRead.mock.calls.length > 0);

    expect(markThreadRead.mock.calls[0]?.[0]).toBe('thread-unread');
    expect(markThreadRead.mock.calls[0]?.[1]).toMatchObject(unreadThread.read_status.snapshot);
    expect(loadThread).toHaveBeenCalledWith('thread-unread');
    expect(runtime.textContent).toContain('Fresh result.');
  });

  it('keeps the running wave indicator stable across selected thread detail refreshes', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-wave',
      title: 'Running wave',
      status: 'running',
      read_status: readStatus(true, 5_000, 'running'),
      updated_at_ms: 5_000,
      messages: [
        {
          id: 'm-running',
          role: 'assistant',
          content: 'Working...',
          status: 'streaming',
          created_at_ms: 5_000,
          blocks: [{ type: 'markdown', content: 'Working...' }],
        },
      ],
    });
    const firstDetail = {
      ...runningThread,
      read_status: readStatus(false, 5_000, 'running'),
    };
    let liveUpdateReady = false;
    const listThreads = vi.fn(async () => [runningThread]);
    const loadThread = vi.fn(async () => liveBootstrap(firstDetail, 1));
    const listThreadLiveEvents = vi.fn(async () => {
      if (!liveUpdateReady) return { events: [], next_cursor: 1, retained_from_seq: 1 };
      return {
        events: [{
          schema_version: 1,
          seq: 2,
          endpoint_id: 'test-runtime',
          thread_id: 'thread-running-wave',
          run_id: 'run-running-wave',
          at_unix_ms: 5_800,
          kind: 'message.block_delta' as const,
          payload: {
            message_id: 'm-running',
            block_index: 0,
            delta: ' still flowing',
          },
        }],
        next_cursor: 2,
        retained_from_seq: 1,
      };
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-wave"] button')));
    const cardBeforeClick = runtime.querySelector('[data-thread-id="thread-running-wave"]') as HTMLElement;
    expect(cardBeforeClick.getAttribute('data-flower-thread-status')).toBe('running');
    expect(cardBeforeClick.getAttribute('data-flower-thread-unread')).toBe('false');
    expect(cardBeforeClick.getAttribute('data-flower-thread-indicator')).toBe('wave');
    const waveBeforeClick = cardBeforeClick.querySelector('.flower-thread-wave');
    expect(waveBeforeClick).toBeTruthy();

    (cardBeforeClick.querySelector('button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length > 0);
    const waveAfterSelect = runtime.querySelector('[data-thread-id="thread-running-wave"] .flower-thread-wave');
    expect(waveAfterSelect).toBeTruthy();
    expect(waveAfterSelect).toBe(waveBeforeClick);
    expect(runtime.querySelector('[data-thread-id="thread-running-wave"]')?.getAttribute('data-flower-thread-unread')).toBe('false');

    liveUpdateReady = true;
    await waitFor(() => runtime.textContent?.includes('Working... still flowing') ?? false, 2500);
    expect(runtime.querySelector('[data-thread-id="thread-running-wave"] .flower-thread-wave')).toBe(waveAfterSelect);
    expect(runtime.textContent).toContain('Working... still flowing');
  });

  it('lets a new selected thread fetch live events even while the previous thread request is still pending', async () => {
    const firstThread = thread({
      thread_id: 'thread-live-first',
      title: 'First live',
      status: 'running',
      updated_at_ms: 5_000,
      messages: [{
        id: 'm-first',
        role: 'assistant',
        content: 'First',
        status: 'streaming',
        created_at_ms: 5_000,
      }],
    });
    const secondThread = thread({
      thread_id: 'thread-live-second',
      title: 'Second live',
      status: 'running',
      updated_at_ms: 5_100,
      messages: [{
        id: 'm-second',
        role: 'assistant',
        content: 'Second',
        status: 'streaming',
        created_at_ms: 5_100,
      }],
    });
    const firstLive = deferred<FlowerLiveEventsResponse>();
    const secondLive = deferred<FlowerLiveEventsResponse>();
    const listSummary = (value: FlowerThreadSnapshot): FlowerThreadSnapshot => ({
      ...value,
      messages: [],
      input_request: undefined,
      error: undefined,
    });
    const listThreads = vi.fn(async () => [listSummary(firstThread), listSummary(secondThread)]);
    const loadThread = vi.fn(async (threadID: string) => liveBootstrap(threadID === 'thread-live-first' ? firstThread : secondThread, 1));
    const listThreadLiveEvents = vi.fn(async (threadID: string) => {
      if (threadID === 'thread-live-first') return firstLive.promise;
      if (threadID === 'thread-live-second') return secondLive.promise;
      throw new Error(`unexpected thread ${threadID}`);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-live-first"] button')));
    (runtime.querySelector('[data-thread-id="thread-live-first"] button') as HTMLButtonElement).click();
    await waitFor(() => listThreadLiveEvents.mock.calls.some((call) => call[0] === 'thread-live-first'));

    (runtime.querySelector('[data-thread-id="thread-live-second"] button') as HTMLButtonElement).click();
    await waitFor(() => listThreadLiveEvents.mock.calls.some((call) => call[0] === 'thread-live-second'));

    expect(runtime.querySelector('[data-thread-id="thread-live-second"]')?.getAttribute('data-flower-thread-status')).toBe('running');

    firstLive.resolve({ events: [], next_cursor: 1, retained_from_seq: 1 });
    secondLive.resolve({ events: [], next_cursor: 1, retained_from_seq: 1 });
  });

  it('persists read state when a selected running thread receives unread detail refreshes', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-read',
      title: 'Running read persistence',
      status: 'running',
      read_status: readStatus(false, 6_000, 'running'),
      updated_at_ms: 6_000,
      messages: [
        {
          id: 'm-running-read',
          role: 'assistant',
          content: 'Working...',
          status: 'streaming',
          created_at_ms: 6_000,
        },
      ],
    });
    const unreadDetail = {
      ...runningThread,
      read_status: readStatus(true, 6_500, 'running'),
      updated_at_ms: 6_500,
      messages: [
        {
          id: 'm-running-read',
          role: 'assistant' as const,
          content: 'Fresh selected update',
          status: 'streaming' as const,
          created_at_ms: 6_500,
        },
      ],
    };
    let detailHasFreshUnread = false;
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => liveBootstrap({
      ...(detailHasFreshUnread ? unreadDetail : runningThread),
      read_status: {
        is_unread: false,
        snapshot,
        read_state: {
          last_seen_activity_revision: snapshot.activity_revision,
          last_read_message_at_unix_ms: snapshot.last_message_at_unix_ms,
          last_seen_activity_signature: snapshot.activity_signature,
        },
      },
    }));
    const loadThread = vi.fn(async () => liveBootstrap(detailHasFreshUnread ? unreadDetail : runningThread));
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-read"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-read"] button') as HTMLButtonElement).click();

    detailHasFreshUnread = true;
    listSnapshot = [unreadDetail];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length >= 1, 2500);

    expect(runtime.querySelector('[data-thread-id="thread-running-read"]')?.getAttribute('data-flower-thread-unread')).toBe('false');
    expect(runtime.textContent).toContain('Fresh selected update');
  });

  it('keeps the selected running wave node stable when a fresh unread snapshot arrives', async () => {
    const runningThread = thread({
      thread_id: 'thread-selected-live-snapshot',
      title: 'Selected live bootstrap',
      status: 'running',
      read_status: readStatus(false, 10_000, 'running'),
      updated_at_ms: 10_000,
      messages: [
        {
          id: 'm-live-a',
          role: 'assistant',
          content: 'Working...',
          status: 'streaming',
          created_at_ms: 10_000,
        },
      ],
    });
    const freshUnreadDetail = {
      ...runningThread,
      read_status: readStatus(true, 10_500, 'running'),
      updated_at_ms: 10_500,
      messages: [
        {
          id: 'm-live-a',
          role: 'assistant' as const,
          content: 'Working with fresh output',
          status: 'streaming' as const,
          created_at_ms: 10_500,
        },
      ],
    };
    let detailIsFresh = false;
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const loadThread = vi.fn(async () => liveBootstrap(detailIsFresh ? freshUnreadDetail : runningThread));
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => liveBootstrap({
      ...freshUnreadDetail,
      read_status: readStatus(false, snapshot.activity_revision, 'running'),
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"] button')));
    (runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"]')?.getAttribute('data-flower-thread-indicator') === 'wave');
    const waveBeforeFreshSnapshot = runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"] .flower-thread-wave');

    detailIsFresh = true;
    listSnapshot = [freshUnreadDetail];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();

    await waitFor(() => runtime.textContent?.includes('Working with fresh output') ?? false);
    await waitFor(() => markThreadRead.mock.calls.length > 0);
    expect(runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"] .flower-thread-wave')).toBe(waveBeforeFreshSnapshot);
    expect(runtime.querySelector('[data-thread-id="thread-selected-live-snapshot"]')?.getAttribute('data-flower-thread-unread')).toBe('false');
  });

  it('queues a final read persistence when unread detail arrives before an in-flight mark-read completes', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-final-read',
      title: 'Final read persistence',
      status: 'running',
      read_status: readStatus(true, 8_000, 'running'),
      updated_at_ms: 8_000,
      messages: [
        {
          id: 'm-running-final',
          role: 'assistant',
          content: 'Working...',
          status: 'streaming',
          created_at_ms: 8_000,
        },
      ],
    });
    const finalUnreadDetail = {
      ...runningThread,
      status: 'success' as const,
      read_status: readStatus(true, 8_500, 'success'),
      updated_at_ms: 8_500,
      messages: [
        {
          id: 'm-running-final',
          role: 'assistant' as const,
          content: 'Final selected update',
          status: 'complete' as const,
          created_at_ms: 8_500,
        },
      ],
    };
    const firstRead = deferred<FlowerLiveBootstrap>();
    const markThreadRead = vi.fn(async () => {
      if (markThreadRead.mock.calls.length === 1) {
        return firstRead.promise;
      }
      return liveBootstrap({
        ...finalUnreadDetail,
        read_status: readStatus(false, 8_500, 'success'),
      });
    });
    let detailHasFinalUnread = false;
    const loadThread = vi.fn(async () => liveBootstrap(detailHasFinalUnread ? finalUnreadDetail : runningThread));
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-final-read"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-final-read"] button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length === 1);
    detailHasFinalUnread = true;
    listSnapshot = [finalUnreadDetail];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Final selected update') ?? false, 2500);
    expect(runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-status')).toBe('success');
    expect(runtime.querySelector('[data-thread-id="thread-running-final-read"]')?.getAttribute('data-flower-thread-indicator')).toBe('none');
    expect(runtime.querySelector('[data-thread-id="thread-running-final-read"]')?.getAttribute('data-flower-thread-unread')).toBe('false');
    expect(markThreadRead).toHaveBeenCalledTimes(1);

    firstRead.resolve(liveBootstrap({
      ...runningThread,
      read_status: readStatus(false, 8_000, 'running'),
    }));
    await waitFor(() => markThreadRead.mock.calls.length >= 2);

    expect(runtime.querySelector('[data-thread-id="thread-running-final-read"]')?.getAttribute('data-flower-thread-unread')).toBe('false');
  });

  it('persists a queued final read even after the user leaves the thread', async () => {
    const runningThread = thread({
      thread_id: 'thread-running-final-after-leave',
      title: 'Final read after leave',
      status: 'running',
      read_status: readStatus(true, 11_000, 'running'),
      updated_at_ms: 11_000,
      messages: [
        {
          id: 'm-running-leave',
          role: 'assistant',
          content: 'Working before leave',
          status: 'streaming',
          created_at_ms: 11_000,
        },
      ],
    });
    const finalUnreadDetail = {
      ...runningThread,
      status: 'success' as const,
      read_status: readStatus(true, 11_500, 'success'),
      updated_at_ms: 11_500,
      messages: [
        {
          id: 'm-running-leave',
          role: 'assistant' as const,
          content: 'Final before leaving',
          status: 'complete' as const,
          created_at_ms: 11_500,
        },
      ],
    };
    const firstRead = deferred<FlowerLiveBootstrap>();
    const markThreadRead = vi.fn(async (_threadID: string, snapshot) => {
      if (markThreadRead.mock.calls.length === 1) {
        return firstRead.promise;
      }
      return liveBootstrap({
        ...finalUnreadDetail,
        read_status: readStatus(false, snapshot.activity_revision, 'success'),
      });
    });
    let detailHasFinalUnread = false;
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread: vi.fn(async () => liveBootstrap(detailHasFinalUnread ? finalUnreadDetail : runningThread)),
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running-final-after-leave"] button')));
    (runtime.querySelector('[data-thread-id="thread-running-final-after-leave"] button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length === 1);

    detailHasFinalUnread = true;
    listSnapshot = [finalUnreadDetail];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Final before leaving') ?? false);

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    firstRead.resolve(liveBootstrap({
      ...runningThread,
      read_status: readStatus(false, 11_000, 'running'),
    }));
    await waitFor(() => markThreadRead.mock.calls.length >= 2);

    expect(markThreadRead.mock.calls[1]?.[0]).toBe('thread-running-final-after-leave');
    expect(markThreadRead.mock.calls[1]?.[1]).toMatchObject(finalUnreadDetail.read_status.snapshot);
  });

  it('keeps a clicked thread visually read across stale list refreshes until a newer version arrives', async () => {
    const unreadThread = thread({
      thread_id: 'thread-refresh-race',
      title: 'Refresh race',
      updated_at_ms: 7_000,
      read_status: readStatus(true, 7_000, 'success'),
    });
    const newerUnreadThread = {
      ...unreadThread,
      updated_at_ms: 7_500,
      read_status: readStatus(true, 7_500, 'success'),
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [unreadThread];
    const markThreadRead = vi.fn(() => new Promise<FlowerLiveBootstrap>(() => undefined));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread: vi.fn(async () => liveBootstrap({ ...unreadThread, read_status: readStatus(false, 7_000, 'success') })),
      markThreadRead,
    });

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread') === 'true');
    (runtime.querySelector('[data-thread-id="thread-refresh-race"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread') === 'false');

    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await flush();
    expect(runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread')).toBe('false');

    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await flush();
    listSnapshot = [newerUnreadThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-refresh-race"]')?.getAttribute('data-flower-thread-unread') === 'true');
  });

  it('keeps target labels searchable without rendering them as sidebar badges', async () => {
    const runningThread = thread({
      thread_id: 'thread-stable-wave-labels',
      title: 'Stable wave labels',
      status: 'running',
      target_labels: ['Hidden target'],
    });
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stable-wave-labels"]')));
    expect(runtime.textContent).not.toContain('Hidden target');

    listSnapshot = [{
      ...runningThread,
      target_labels: ['Updated target'],
    }];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await flush();

    expect(runtime.textContent).not.toContain('Updated target');
    const search = runtime.querySelector('.flower-thread-search-input') as HTMLInputElement;
    search.value = 'updated target';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stable-wave-labels"]')));
  });

  it('restores the unread dot when mark-read persistence fails', async () => {
    const unreadThread = thread({
      thread_id: 'thread-mark-read-error',
      title: 'Unread failure',
      read_status: readStatus(true, 9_000, 'success'),
    });
    const markThreadRead = vi.fn(async () => {
      throw new Error('read state unavailable');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [unreadThread]),
      loadThread: vi.fn(async () => liveBootstrap(unreadThread)),
      markThreadRead,
    });

    await waitFor(() => runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-unread') === 'true');
    (runtime.querySelector('[data-thread-id="thread-mark-read-error"] button') as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length > 0);

    expect(runtime.querySelector('[data-thread-id="thread-mark-read-error"]')?.getAttribute('data-flower-thread-unread')).toBe('true');
    expect(runtime.querySelector('.flower-thread-action-error')?.textContent).toContain('read state unavailable');
  });

  it('uses thread id as a stable tie breaker when conversations share a creation time', async () => {
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [
        thread({ thread_id: 'thread-c', title: 'C', created_at_ms: 4_000 }),
        thread({ thread_id: 'thread-a', title: 'A', created_at_ms: 4_000 }),
        thread({ thread_id: 'thread-b', title: 'B', created_at_ms: 4_000 }),
      ]),
    });

    await waitFor(() => threadOrder(runtime).length === 3);

    expect(threadOrder(runtime)).toEqual(['thread-a', 'thread-b', 'thread-c']);
  });

  it('opens thread actions from the keyboard and supports menu roving focus', async () => {
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      forkThread: vi.fn(async () => liveBootstrap(thread({ thread_id: 'thread-fork' }))),
      renameThread: vi.fn(async () => liveBootstrap(thread())),
      setThreadPinned: vi.fn(async () => liveBootstrap(thread({ pinned_at_ms: 10 }))),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"] button')));

    const rowButton = runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement;
    rowButton.focus();
    rowButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await flush();

    const menu = runtime.querySelector('[role="menu"]') as HTMLElement | null;
    expect(menu).toBeTruthy();
    const items = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items.map((item) => item.textContent?.trim())).toContain('Copy thread id');
    expect(document.activeElement).toBe(items[0]);

    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    await flush();
    expect(document.activeElement).toBe(items[items.length - 1]);
    items[items.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(runtime.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(rowButton);
  });

  it('disables fork for threads that are still running or waiting', async () => {
    const forkThread = vi.fn(async () => liveBootstrap(thread({ thread_id: 'thread-fork' })));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [
        thread({ thread_id: 'thread-running', title: 'Running', status: 'running' }),
        thread({ thread_id: 'thread-waiting', title: 'Waiting', status: 'waiting_user' }),
      ]),
      forkThread,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-running"]')));

    (runtime.querySelector('[data-thread-id="thread-running"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    const runningFork = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Fork')) as HTMLButtonElement;
    expect(runningFork.disabled).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    (runtime.querySelector('[data-thread-id="thread-waiting"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    const waitingFork = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Fork')) as HTMLButtonElement;
    expect(waitingFork.disabled).toBe(true);
    expect(forkThread).not.toHaveBeenCalled();
  });

  it('copies thread metadata with fallback clipboard feedback', async () => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => true),
    });
    const execCommand = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    const clipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [thread({ working_dir: '/workspace/redeven' })]),
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"]')));

    (runtime.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    (Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Copy thread id')) as HTMLButtonElement).click();
    await flush();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(runtime.textContent).toContain('Copied thread id.');
    expect(document.activeElement).toBe(runtime.querySelector('[data-thread-id="thread-1"] button'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
    execCommand.mockRestore();
  });

  it('shows rename failures inside the modal dialog', async () => {
    const renameThread = vi.fn(async () => {
      throw new Error('title too long');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      renameThread,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"]')));

    (runtime.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    (Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Rename')) as HTMLButtonElement).click();
    await flush();
    const dialog = runtime.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain('Rename conversation');
    const input = dialog.querySelector('input') as HTMLInputElement;
    input.value = 'A title that fails';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    (Array.from(dialog.querySelectorAll('button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Save'))?.click();
    await flush();

    expect(renameThread).toHaveBeenCalled();
    expect(dialog.textContent).toContain('title too long');
    expect(runtime.querySelector('.flower-thread-action-error')).toBeNull();
  });

  it('disables all thread actions while a fork action is pending', async () => {
    const forkControl: { resolve?: (thread: FlowerLiveBootstrap) => void } = {};
    const forkThread = vi.fn(() => new Promise<FlowerLiveBootstrap>((resolve) => {
      forkControl.resolve = resolve;
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      forkThread,
    });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"]')));

    const openForkMenu = async () => {
      (runtime.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      await flush();
      return Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes('Fork') || item.textContent?.includes('Working')) as HTMLButtonElement;
    };
    (await openForkMenu()).click();
    await flush();
    const pendingFork = await openForkMenu();

    expect(forkThread).toHaveBeenCalledTimes(1);
    expect(pendingFork.disabled).toBe(true);
    expect(pendingFork.textContent).toContain('Working');

    (runtime.querySelector('[data-thread-id="thread-2"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await flush();
    const secondThreadItems = Array.from(runtime.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(secondThreadItems.length).toBeGreaterThan(0);
    expect(secondThreadItems.every((item) => item.disabled)).toBe(true);
    secondThreadItems.find((item) => item.textContent?.includes('Fork'))?.click();
    await flush();
    expect(forkThread).toHaveBeenCalledTimes(1);

    const completeFork = forkControl.resolve;
    if (!completeFork) throw new Error('fork promise did not start');
    completeFork(liveBootstrap(thread({ thread_id: 'thread-fork' })));
    await waitFor(() => forkThread.mock.calls.length === 1);
  });

  it('preserves loaded selected-thread details while a summary-only list refresh is waiting for detail reload', async () => {
    const detailedThread = thread({
      thread_id: 'thread-detail',
      title: 'Detailed thread',
      created_at_ms: 3_000,
      updated_at_ms: 3_100,
      status: 'running',
      error: {
        code: 'failed',
        message: 'Provider returned a structured failure.',
      },
      messages: [
        {
          id: 'm-detail',
          role: 'assistant',
          content: 'Loaded detail stays visible.',
          status: 'complete',
          created_at_ms: 3_100,
          blocks: [
            { type: 'markdown', content: 'Loaded detail stays visible.' },
            activityTimeline({
              status: 'running',
              severity: 'normal',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-read',
                tool_id: 'tool-read',
                tool_name: 'file.read',
                status: 'running',
                severity: 'normal',
                needs_attention: true,
                metadata: { target: 'AGENTS.md' },
              })],
            }),
          ],
        },
      ],
    });
    const summaryOnlyThread = {
      ...detailedThread,
      updated_at_ms: 3_500,
      messages: [],
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [detailedThread];
    let delayedDetailReloadStarted = false;
    const loadThread = vi.fn(() => {
      if (loadThread.mock.calls.length === 1) {
        return Promise.resolve(liveBootstrap(detailedThread));
      }
      delayedDetailReloadStarted = true;
      return new Promise<FlowerLiveBootstrap>(() => undefined);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-detail"] button')));
    (runtime.querySelector('[data-thread-id="thread-detail"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Loaded detail stays visible.') ?? false);

    listSnapshot = [summaryOnlyThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => delayedDetailReloadStarted);

    expect(runtime.textContent).toContain('Loaded detail stays visible.');
    expect(runtime.textContent).toContain('file.read');
    expect(runtime.querySelector('.flower-activity-inline')).toBeTruthy();
    expect(runtime.querySelector('.flower-error-card')?.textContent).toContain('Provider returned a structured failure.');
  });

  it('keeps background terminal refreshes when selected detail polling mutates the list', async () => {
    const selectedInitial = thread({
      thread_id: 'thread-selected-live',
      title: 'Selected live',
      created_at_ms: 4_000,
      updated_at_ms: 4_100,
      status: 'running',
      read_status: readStatus(false, 410, 'running'),
    });
    const selectedDetail = {
      ...selectedInitial,
      updated_at_ms: 4_200,
      read_status: readStatus(false, 420, 'running'),
      messages: [
        {
          id: 'm-selected-live',
          role: 'assistant' as const,
          content: 'Selected detail refreshed.',
          status: 'streaming' as const,
          created_at_ms: 4_200,
        },
      ],
    };
    const backgroundRunning = thread({
      thread_id: 'thread-background-live',
      title: 'Background live',
      created_at_ms: 3_000,
      updated_at_ms: 3_100,
      status: 'running',
      read_status: readStatus(false, 310, 'running'),
      messages: [],
    });
    const backgroundDone = {
      ...backgroundRunning,
      updated_at_ms: 3_200,
      status: 'success' as const,
      read_status: readStatus(true, 320, 'success'),
    };
    let listCalls = 0;
    const listThreads = vi.fn(() => {
      listCalls += 1;
      if (listCalls === 1) return Promise.resolve([selectedInitial, backgroundRunning]);
      return Promise.resolve([selectedDetail, backgroundDone]);
    });
    let loadCalls = 0;
    const loadThread = vi.fn(async (threadID: string) => {
      loadCalls += 1;
      const detail = threadID === 'thread-selected-live'
        ? { ...selectedDetail, updated_at_ms: selectedDetail.updated_at_ms + loadCalls }
        : backgroundRunning;
      return liveBootstrap(detail);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-selected-live"] button')));
    (runtime.querySelector('[data-thread-id="thread-selected-live"] button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length >= 1);
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => listCalls >= 2);

    await wait(1250);
    await flush();
    expect(loadThread.mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => runtime.querySelector('[data-thread-id="thread-background-live"]')?.getAttribute('data-flower-thread-indicator') === 'dot');
    expect(runtime.querySelector('[data-thread-id="thread-background-live"]')?.getAttribute('data-flower-thread-unread')).toBe('true');
  });

  it('renders structured input requests in the composer while Flower waits', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-input',
      title: 'Waiting input',
      created_at_ms: 3_800,
      updated_at_ms: 3_900,
      status: 'waiting_user',
      input_request: inputRequest(),
      messages: [
        {
          id: 'm-waiting-input',
          role: 'assistant',
          content: 'I need one choice before continuing.',
          status: 'complete',
          created_at_ms: 3_900,
          blocks: [
            { type: 'markdown', content: 'I need one choice before continuing.' },
            activityTimeline({
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-ask-user',
                tool_id: 'tool-ask-user',
                tool_name: 'ask_user',
                kind: 'control',
                label: 'Requested input',
                description: 'Choose the deployment target before Flower continues.',
                renderer: 'question',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                attention_reasons: ['waiting'],
                payload: {
                  reason_code: 'needs_user_choice',
                  required_from_user: ['deployment_target'],
                  questions: [{
                    id: 'deployment_target',
                    header: 'Deployment target',
                    question: 'Where should Flower deploy this change?',
                  }],
                  contains_secret: false,
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Waiting for your reply');
    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Choose the deployment target before Flower continues.');
    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Where should Flower deploy this change?');
    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Staging');
    expect(runtime.querySelector('[data-flower-input-request-prompt]')?.textContent).toContain('Production');
    expect(runtime.querySelector('.flower-activity-inline')?.textContent).toContain('Requested input');
    expect(runtime.querySelector('.flower-streaming-cursor')).toBeNull();
    expect(runtime.querySelectorAll('textarea')).toHaveLength(1);
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).placeholder).toBe('Choose an option to continue.');
    expect((Array.from(runtime.querySelectorAll('.flower-composer button')) as HTMLButtonElement[])
      .some((button) => button.textContent?.includes('Continue') && button.disabled)).toBe(true);
  });

  it('uses the bottom composer password field for secret structured input', async () => {
    const secretInputRequest = inputRequest({
      contains_secret: true,
      public_summary: 'Provide the deployment token before Flower continues.',
      questions: [
        {
          id: 'deploy_token',
          header: 'Deployment token',
          question: 'Paste the deployment token.',
          is_secret: true,
          response_mode: 'write',
          write_placeholder: 'Deployment token',
        },
      ],
    });
    const waitingThread = thread({
      thread_id: 'thread-secret-input',
      title: 'Secret input',
      created_at_ms: 3_820,
      updated_at_ms: 3_920,
      status: 'waiting_user',
      input_request: secretInputRequest,
    });
    const continuedThread = thread({
      thread_id: 'thread-secret-input',
      title: 'Secret input',
      created_at_ms: 3_820,
      updated_at_ms: 4_020,
      status: 'running',
      input_request: null,
    });
    const submitInput = vi.fn(async () => liveBootstrap(continuedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-secret-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-secret-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer input[type="password"]')));

    expect(runtime.querySelectorAll('.flower-composer input[type="password"]')).toHaveLength(1);
    expect(runtime.querySelector('.flower-composer textarea')).toBeNull();

    const password = runtime.querySelector('.flower-composer input[type="password"]') as HTMLInputElement;
    expect(password.placeholder).toBe('Deployment token');
    password.value = 'secret-token';
    password.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await flush();
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length > 0);

    expect(submitInput).toHaveBeenCalledWith({
      thread_id: 'thread-secret-input',
      prompt_id: 'prompt-ask-user',
      answers: {
        deploy_token: {
          text: 'secret-token',
        },
      },
    });
  });

  it('submits selected structured input through the adapter and keeps the same thread', async () => {
    const waitingThread = thread({
      thread_id: 'thread-submit-input',
      title: 'Submit input',
      created_at_ms: 3_850,
      updated_at_ms: 3_950,
      status: 'waiting_user',
      input_request: inputRequest(),
      messages: [
        {
          id: 'm-submit-input',
          role: 'assistant',
          content: 'Choose a target.',
          status: 'complete',
          created_at_ms: 3_950,
        },
      ],
    });
    const continuedThread = thread({
      thread_id: 'thread-submit-input',
      title: 'Submit input',
      created_at_ms: 3_850,
      updated_at_ms: 4_100,
      status: 'running',
      input_request: null,
      messages: [
        ...waitingThread.messages,
        {
          id: 'm-continued',
          role: 'assistant',
          content: 'Continuing with staging.',
          status: 'complete',
          created_at_ms: 4_100,
        },
      ],
    });
    const submitInput = vi.fn(async () => liveBootstrap(continuedThread));
    const loadThread = vi.fn(async () => liveBootstrap(loadThread.mock.calls.length === 1 ? waitingThread : continuedThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread,
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-submit-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-submit-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    (Array.from(runtime.querySelectorAll('.flower-input-request-choice')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Staging'))?.click();
    await flush();
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length > 0);
    await waitFor(() => runtime.textContent?.includes('Continuing with staging.') ?? false);

    expect(submitInput).toHaveBeenCalledWith({
      thread_id: 'thread-submit-input',
      prompt_id: 'prompt-ask-user',
      answers: {
        target: {
          choice_id: 'staging',
        },
      },
    });
    expect(runtime.querySelector('[data-flower-input-request-prompt]')).toBeNull();
    expect(runtime.textContent).toContain('Continuing with staging.');
  });

  it('shows structured input submission failures in the composer without losing the answer', async () => {
    const waitingThread = thread({
      thread_id: 'thread-input-error',
      title: 'Input error',
      created_at_ms: 3_860,
      updated_at_ms: 3_960,
      status: 'waiting_user',
      input_request: inputRequest(),
    });
    const submitInput = vi.fn(async () => {
      throw new Error('Flower is no longer waiting for that input.');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-input-error"] button')));
    (runtime.querySelector('[data-thread-id="thread-input-error"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    (Array.from(runtime.querySelectorAll('.flower-input-request-choice')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Production'))?.click();
    await flush();
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-error')));

    expect(runtime.querySelector('.flower-composer-error')?.textContent).toContain('Flower is no longer waiting for that input.');
    expect(runtime.querySelector('.flower-composer-submit')?.textContent).toContain('Retry');
    expect(runtime.querySelector('.flower-input-request-choice-selected')?.textContent).toContain('Production');
  });

  it('clears waiting prompts when a summary-only refresh reports a terminal thread', async () => {
    const detailedThread = thread({
      thread_id: 'thread-waiting-summary-refresh',
      title: 'Waiting survives refresh',
      created_at_ms: 3_870,
      updated_at_ms: 3_970,
      status: 'waiting_user',
      input_request: inputRequest(),
    });
    const summaryOnlyThread = {
      ...detailedThread,
      updated_at_ms: 4_200,
      status: 'success' as const,
      messages: [],
      input_request: undefined,
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [detailedThread];
    let delayedDetailReloadStarted = false;
    const loadThread = vi.fn(() => {
      if (loadThread.mock.calls.length === 1) {
        return Promise.resolve(liveBootstrap(detailedThread));
      }
      delayedDetailReloadStarted = true;
      return new Promise<FlowerLiveBootstrap>(() => undefined);
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-summary-refresh"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-summary-refresh"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-input-request-prompt]')));

    listSnapshot = [summaryOnlyThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => delayedDetailReloadStarted);

    expect(runtime.querySelector('[data-flower-input-request-prompt]')).toBeNull();
  });

  it('ignores stale input requests when the thread is no longer waiting for user input', async () => {
    const staleThread = thread({
      thread_id: 'thread-stale-input',
      title: 'Stale input',
      created_at_ms: 3_890,
      updated_at_ms: 3_990,
      status: 'success',
      input_request: inputRequest(),
      messages: [
        {
          id: 'm-stale',
          role: 'assistant',
          content: 'This should behave like a normal thread.',
          status: 'complete',
          created_at_ms: 3_990,
        },
      ],
    });
    const sendMessage = vi.fn(async () => liveBootstrap(staleThread));
    const submitInput = vi.fn(async () => liveBootstrap(staleThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [staleThread]),
      loadThread: vi.fn(async () => liveBootstrap(staleThread)),
      sendMessage,
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-input"] button')));
    (runtime.querySelector('[data-thread-id="thread-stale-input"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('This should behave like a normal thread.') ?? false);

    expect(runtime.querySelector('[data-flower-input-request-prompt]')).toBeNull();
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
    textarea.value = 'Hello';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => sendMessage.mock.calls.length > 0);
    expect(submitInput).not.toHaveBeenCalled();
  });

  it('preserves loaded details for non-selected threads during summary-only list refreshes', async () => {
    const detailedThread = thread({
      thread_id: 'thread-background',
      title: 'Background detail',
      created_at_ms: 4_000,
      updated_at_ms: 4_100,
      messages: [
        {
          id: 'm-background',
          role: 'assistant',
          content: 'Background preview remains available.',
          status: 'complete',
          created_at_ms: 4_100,
        },
      ],
    });
    const selectedThread = thread({
      thread_id: 'thread-selected',
      title: 'Selected thread',
      created_at_ms: 5_000,
      updated_at_ms: 5_100,
    });
    const summaryOnlyBackground = {
      ...detailedThread,
      updated_at_ms: 4_500,
      messages: [],
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [selectedThread, detailedThread];
    let backgroundReloadStarted = false;
    const loadThread = vi.fn((threadID: string) => {
      if (threadID === 'thread-background') {
        backgroundReloadStarted = true;
        return new Promise<FlowerLiveBootstrap>(() => undefined);
      }
      return Promise.resolve(liveBootstrap(selectedThread));
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => threadOrder(runtime).includes('thread-background'));

    (runtime.querySelector('[data-thread-id="thread-selected"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-thread-card-active')?.getAttribute('data-thread-id') === 'thread-selected');
    listSnapshot = [selectedThread, summaryOnlyBackground];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();
    await flush();
    (runtime.querySelector('[data-thread-id="thread-background"] button') as HTMLButtonElement).click();
    await waitFor(() => backgroundReloadStarted);

    expect(runtime.textContent).toContain('Background preview remains available.');
  });

  it('shows a loading state instead of the empty state while first-loading a summary-only thread', async () => {
    const summaryThread = thread({
      thread_id: 'thread-summary-only',
      title: 'Summary only',
      created_at_ms: 4_800,
      updated_at_ms: 4_900,
      messages: [],
      error: undefined,
    });
    let loadStarted = false;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [summaryThread]),
      loadThread: vi.fn(() => {
        loadStarted = true;
        return new Promise<FlowerLiveBootstrap>(() => undefined);
      }),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-summary-only"] button')));
    (runtime.querySelector('[data-thread-id="thread-summary-only"] button') as HTMLButtonElement).click();
    await waitFor(() => loadStarted && Boolean(runtime.querySelector('.flower-thread-loading')));

    expect(runtime.querySelector('.flower-thread-loading')?.textContent).toContain('Loading conversation...');
    expect(runtime.querySelector('.flower-thread-loading-panel')).toBeTruthy();
    expect(runtime.querySelector('.flower-thread-loading-indicator')).toBeTruthy();
    expect(runtime.querySelector('.flower-thread-loading-line')).toBeNull();
    expect(runtime.textContent).not.toContain('Flower can work from this runtime');
  });

  it('renders streaming assistant output with a flowing cursor and a wide transcript stack', async () => {
    const streamingThread = thread({
      thread_id: 'thread-streaming',
      title: 'Streaming answer',
      created_at_ms: 5_000,
      updated_at_ms: 5_200,
      status: 'running',
      messages: [
        {
          id: 'm-user-streaming',
          role: 'user',
          content: 'Stream this',
          status: 'complete',
          created_at_ms: 5_000,
        },
        {
          id: 'm-assistant-streaming',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 5_200,
          blocks: [
            { type: 'thinking', content: 'Checking the workspace.' },
            { type: 'markdown', content: 'Streaming partial answer' },
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [streamingThread]),
      loadThread: vi.fn(async () => liveBootstrap(streamingThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-streaming"] button')));
    (runtime.querySelector('[data-thread-id="thread-streaming"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-streaming-cursor')));

    expect(runtime.querySelector('.flower-transcript-stack')).toBeTruthy();
    expect(runtime.querySelector('.flower-message-bubble-streaming')?.textContent).toContain('Streaming partial answer');
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-block-stack-assistant')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-plain')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-framed')).toBeNull();
    expect(runtime.querySelector('[data-flower-message-role="user"] .flower-message-bubble-framed')).toBeTruthy();
    expect(runtime.querySelector('.flower-streaming-cursor')).toBeTruthy();
    expect(runtime.textContent).toContain('Streaming partial answer');
  });

  it('shows completed Flower activity inline between assistant text blocks', async () => {
    const tool_names = [
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'write_todos',
      'task_complete',
    ] as const;
    const toolsThread = thread({
      thread_id: 'thread-tools',
      title: 'Tool activity',
      created_at_ms: 6_000,
      updated_at_ms: 6_500,
      status: 'success',
      messages: [
        {
          id: 'm-tools',
          role: 'assistant',
          content: 'I will check the workspace.\n\nI finished the answer after the audit trail.',
          status: 'complete',
          created_at_ms: 6_500,
          blocks: [
            { type: 'markdown', content: 'I will check the workspace.' },
            activityTimeline({
              run_id: 'run-tools',
              turn_id: 'm-tools',
              items: tool_names.map((tool_name, index) => activityItem({
                item_id: `item-${index}`,
                tool_id: `tool-${index}`,
                tool_name,
                kind: tool_name === 'task_complete' ? 'control' : 'tool',
                status: 'success',
                severity: 'quiet',
                ...(tool_name === 'terminal.exec'
                  ? {
                      label: `npm run check:${index}`,
                      renderer: 'terminal',
                      payload: { command: `npm run check:${index}`, exit_code: 0 },
                    }
                  : tool_name === 'write_todos'
                    ? {
                        label: 'Update todos',
                        renderer: 'todos',
                        payload: { todos: [{ content: 'Verify inline activity', status: 'completed' }] },
                      }
                    : {
                        label: 'task_complete',
                        renderer: 'completion',
                        payload: { result: 'done' },
                      }),
              })),
            }),
            { type: 'markdown', content: 'I finished the answer after the audit trail.' },
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [toolsThread]),
      loadThread: vi.fn(async () => liveBootstrap(toolsThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-tools"] button')));
    (runtime.querySelector('[data-thread-id="thread-tools"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-activity-inline')));

    const transcriptText = runtime.textContent ?? '';
    expect(transcriptText.indexOf('I will check the workspace.')).toBeLessThan(transcriptText.indexOf('npm run check:0'));
    expect(transcriptText.indexOf('npm run check:0')).toBeLessThan(transcriptText.indexOf('I finished the answer after the audit trail.'));
    expect(runtime.querySelector('.flower-tool-activity')).toBeNull();
    expect(runtime.querySelector('.flower-todo-snapshot')).toBeNull();
    expect(runtime.textContent).not.toContain('3 / 3 completed');
    expect(runtime.textContent).not.toContain('Draft final answer');
    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(tool_names.length);
    expect(runtime.textContent).not.toContain('terminal.execterminal.exec');
    expect(runtime.textContent).toContain('Update todos');
    expect(runtime.textContent).toContain('completed 1');
    expect(runtime.textContent).toContain('task_complete');
    expect(runtime.querySelector('.flower-activity-inline-row')?.getAttribute('aria-label')).toContain('terminal.exec');
  });

  it('renders approval controls inside the matching tool activity row', async () => {
    const approveThread = thread({
      thread_id: 'thread-inline-approval',
      title: 'Inline approval',
      created_at_ms: 6_800,
      updated_at_ms: 6_900,
      status: 'waiting_approval',
      approval_actions: [{
        action_id: 'appr-terminal',
        run_id: 'run-inline-approval',
        tool_id: 'tool-needs-approval',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 6_850,
        can_approve: true,
        expected_seq: 12,
        summary: {
          label: 'terminal.exec',
          description: 'Review this command before it runs.',
          effects: ['shell'],
        },
      }],
      messages: [
        {
          id: 'm-inline-approval',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 6_900,
          blocks: [
            activityTimeline({
              run_id: 'run-inline-approval',
              turn_id: 'm-inline-approval',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'approval-item',
                tool_id: 'tool-needs-approval',
                tool_name: 'terminal.exec',
                kind: 'approval',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                requires_approval: true,
                approval_state: 'requested',
                label: 'pwd; sleep 15; date',
                renderer: 'terminal',
                payload: { command: 'pwd; sleep 15; date' },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approveThread]),
      loadThread: vi.fn(async () => ({
        ...liveBootstrap({
          ...approveThread,
          approval_actions: [],
        }, 12),
        live_state: {
          ...liveBootstrap(approveThread, 12).live_state,
          approval_actions: {
            'appr-terminal': approveThread.approval_actions![0]!,
          },
        },
      })),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-inline-approval"] button')));
    (runtime.querySelector('[data-thread-id="thread-inline-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="approval-item"] .flower-approval-card')));

    const row = runtime.querySelector('[data-flower-activity-item-id="approval-item"]') as HTMLElement | null;
    expect(row?.textContent).toContain('pwd; sleep 15; date');
    expect(row?.querySelector('[data-flower-approval-action-id="appr-terminal"]')).toBeTruthy();
    expect(row?.textContent).toContain('Approve');
    expect(runtime.querySelector('.flower-transcript-stack > .flower-approval-stack')).toBeNull();
  });

  it('refreshes canonical thread state when an approval decision is stale', async () => {
    const pendingThread = thread({
      thread_id: 'thread-stale-approval',
      title: 'Stale approval',
      status: 'waiting_approval',
      approval_actions: [{
        action_id: 'appr-stale',
        run_id: 'run-stale-approval',
        tool_id: 'tool-stale-approval',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        requested_at_ms: 7_100,
        can_approve: true,
        expected_seq: 12,
        summary: {
          label: 'terminal.exec',
          description: 'Review this command before it runs.',
          effects: ['shell'],
        },
      }],
      messages: [
        {
          id: 'm-stale-approval',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 7_100,
          blocks: [
            activityTimeline({
              run_id: 'run-stale-approval',
              turn_id: 'm-stale-approval',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'stale-approval-item',
                tool_id: 'tool-stale-approval',
                tool_name: 'terminal.exec',
                kind: 'approval',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                requires_approval: true,
                approval_state: 'requested',
                label: 'npm test',
                renderer: 'terminal',
                payload: { command: 'npm test' },
              })],
            }),
          ],
        },
      ],
    });
    const resolvedThread = {
      ...pendingThread,
      status: 'running' as const,
      approval_actions: [],
      messages: pendingThread.messages.map((message) => ({
        ...message,
        blocks: message.blocks?.map((block) => block.type === 'activity-timeline'
          ? {
              ...block,
              summary: {
                ...block.summary,
                status: 'running' as const,
                needs_attention: false,
                attention_reasons: [],
                counts: { running: 1, approval: 1 },
              },
              items: block.items.map((item) => ({
                ...item,
                status: 'running' as const,
                needs_attention: false,
                approval_state: 'approved' as const,
              })),
            }
          : block),
      })),
    };
    const loadThread = vi.fn(async () => {
      if (loadThread.mock.calls.length <= 1) {
        return {
          ...liveBootstrap({
            ...pendingThread,
            approval_actions: [],
          }, 13),
          live_state: {
            ...liveBootstrap(pendingThread, 13).live_state,
            approval_actions: {
              'appr-stale': pendingThread.approval_actions![0]!,
            },
          },
        };
      }
      return liveBootstrap({
        ...resolvedThread,
        approval_actions: [],
      }, 13);
    });
    const submitApproval = vi.fn(async () => {
      throw new Error('approval no longer pending');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [pendingThread]),
      loadThread,
      submitApproval,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-approval"] button')));
    (runtime.querySelector('[data-thread-id="thread-stale-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-approval-action-id="appr-stale"]')));
    const approve = Array.from(runtime.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Approve');
    expect(approve).toBeTruthy();
    approve?.click();

    await waitFor(() => submitApproval.mock.calls.length === 1);
    await waitFor(() => loadThread.mock.calls.length >= 2);
    expect(runtime.textContent).toContain('approval no longer pending');
    await waitFor(() => runtime.querySelector('[data-flower-approval-action-id="appr-stale"]') === null);
  });

  it('hides approval-only terminal noise while keeping command and output details visible', async () => {
    const terminalThread = thread({
      thread_id: 'thread-terminal-output',
      title: 'Terminal output',
      created_at_ms: 6_600,
      updated_at_ms: 6_700,
      status: 'success',
      messages: [
        {
          id: 'm-terminal-output',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 6_700,
          blocks: [
            activityTimeline({
              run_id: 'run-terminal-output',
              turn_id: 'm-terminal-output',
              items: [
                activityItem({
                  item_id: 'approval-only',
                  tool_id: 'approval-only',
                  tool_name: 'terminal.exec',
                  kind: 'approval',
                  requires_approval: true,
                  approval_state: 'approved',
                }),
                activityItem({
                  item_id: 'terminal-real',
                  tool_id: 'terminal-real',
                  tool_name: 'terminal.exec',
                  label: 'terminal.exec',
                  renderer: 'terminal',
                  payload: {
                    command: 'curl -s https://example.com',
                    exit_code: 0,
                    stdout: 'example response',
                    stderr: '',
                  },
                }),
              ],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [terminalThread]),
      loadThread: vi.fn(async () => liveBootstrap(terminalThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-terminal-output"] button')));
    (runtime.querySelector('[data-thread-id="thread-terminal-output"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-inline-row').length === 1);

    expect(runtime.querySelector('[data-flower-activity-item-id="approval-only"]')).toBeNull();
    expect(runtime.querySelector('[data-flower-activity-item-id="terminal-real"]')).toBeTruthy();
    expect(runtime.textContent).toContain('curl -s https://example.com');
    (runtime.querySelector('[data-flower-activity-item-id="terminal-real"] .flower-activity-inline-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('example response') ?? false);
    expect(runtime.textContent).toContain('example response');
    expect(runtime.textContent).not.toContain('approvalapproved');
  });

  it('refreshes inline activity when message block fields change in place', async () => {
    const runningActivity = activityTimeline({
      run_id: 'run-refresh-block',
      turn_id: 'm-refresh-block',
      status: 'running',
      severity: 'normal',
      needs_attention: true,
      items: [activityItem({
        item_id: 'tool-refresh',
        tool_id: 'tool-refresh',
        tool_name: 'terminal.exec',
        status: 'running',
        severity: 'normal',
        needs_attention: true,
        started_at_unix_ms: 6_000,
        label: 'npm test',
        renderer: 'terminal',
        payload: { command: 'npm test' },
      })],
    });
    const completeActivity = activityTimeline({
      run_id: 'run-refresh-block',
      turn_id: 'm-refresh-block',
      status: 'success',
      severity: 'quiet',
      needs_attention: false,
      items: [activityItem({
        item_id: 'tool-refresh',
        tool_id: 'tool-refresh',
        tool_name: 'terminal.exec',
        status: 'success',
        severity: 'quiet',
        needs_attention: false,
        started_at_unix_ms: 6_000,
        ended_at_unix_ms: 7_250,
        label: 'npm test',
        renderer: 'terminal',
        payload: { command: 'npm test', exit_code: 0 },
      })],
    });
    const runningThread = thread({
      thread_id: 'thread-refresh-block',
      title: 'Refresh block',
      created_at_ms: 6_000,
      updated_at_ms: 6_100,
      status: 'idle',
      messages: [
        {
          id: 'm-refresh-block',
          role: 'assistant',
          content: 'Running tests.',
          status: 'complete',
          created_at_ms: 6_100,
          blocks: [
            { type: 'markdown', content: 'Running tests.' },
            runningActivity,
          ],
        },
      ],
    });
    const completeThread = {
      ...runningThread,
      updated_at_ms: 6_200,
      status: 'success' as const,
      messages: [
        {
          id: 'm-refresh-block',
          role: 'assistant' as const,
          content: 'Running tests.\n\nTests passed.',
          status: 'complete' as const,
          created_at_ms: 6_100,
          blocks: [
            { type: 'markdown' as const, content: 'Running tests.' },
            completeActivity,
            { type: 'markdown' as const, content: 'Tests passed.' },
          ],
        },
      ],
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const loadThread = vi.fn(async () => liveBootstrap(loadThread.mock.calls.length === 1 ? runningThread : completeThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-refresh-block"] button')));
    (runtime.querySelector('[data-thread-id="thread-refresh-block"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'running');

    listSnapshot = [completeThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'success');
    expect(runtime.textContent).toContain('Done');
    expect(runtime.textContent).toContain('1s');
    expect(runtime.textContent).toContain('Tests passed.');
    expect(loadThread.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps waiting activity visible even if a timeline summary is marked digest', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-activity',
      title: 'Waiting activity',
      created_at_ms: 6_700,
      updated_at_ms: 6_900,
      status: 'waiting_user',
      messages: [
        {
          id: 'm-waiting',
          role: 'assistant',
          content: 'I need one choice.',
          status: 'complete',
          created_at_ms: 6_900,
          blocks: [
            { type: 'markdown', content: 'I need one choice.' },
            activityTimeline({
              run_id: 'run-waiting',
              turn_id: 'm-waiting',
              status: 'success',
              severity: 'quiet',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-ask',
                tool_id: 'tool-ask',
                tool_name: 'ask_user',
                kind: 'control',
                label: 'Requested input',
                description: 'Choose a target before continuing.',
                renderer: 'question',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                attention_reasons: ['waiting'],
                payload: {
                  reason_code: 'needs_user_choice',
                  required_from_user: ['target'],
                  questions: [{
                    id: 'target',
                    header: 'Target',
                    question: 'Choose a target before continuing.',
                  }],
                  contains_secret: false,
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-activity"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Requested input') ?? false);

    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(1);
    expect(runtime.querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    {
      name: 'running',
      status: 'running' as FlowerActivityStatus,
      severity: 'normal' as const,
    },
    {
      name: 'error',
      status: 'error' as FlowerActivityStatus,
      severity: 'error' as const,
      description: 'stderr includes a failing test.',
    },
    {
      name: 'approval',
      status: 'pending' as FlowerActivityStatus,
      severity: 'blocking' as const,
      requires_approval: true,
      approval_state: 'requested' as const,
    },
  ])('keeps $name activity visible even if a timeline summary is marked digest', async (scenario) => {
    const attentionThread = thread({
      thread_id: `thread-${scenario.name}-activity`,
      title: `${scenario.name} activity`,
      created_at_ms: 6_910,
      updated_at_ms: 6_950,
      status: scenario.status === 'running' ? 'running' : scenario.status === 'error' ? 'failed' : 'waiting_user',
      messages: [
        {
          id: `m-${scenario.name}`,
          role: 'assistant',
          content: `Working on ${scenario.name}.`,
          status: scenario.status === 'error' ? 'error' : 'complete',
          created_at_ms: 6_950,
          blocks: [
            { type: 'markdown', content: `Working on ${scenario.name}.` },
            activityTimeline({
              run_id: `run-${scenario.name}`,
              turn_id: `m-${scenario.name}`,
              status: 'success',
              severity: 'quiet',
              needs_attention: true,
              items: [activityItem({
                item_id: `item-${scenario.name}`,
                tool_id: `tool-${scenario.name}`,
                tool_name: scenario.requires_approval ? 'terminal.exec' : 'shell.exec',
                kind: 'tool',
                label: `npm run check:${scenario.name}`,
                renderer: 'terminal',
                status: scenario.status,
                severity: scenario.severity,
                needs_attention: true,
                requires_approval: scenario.requires_approval ?? false,
                approval_state: scenario.approval_state,
                description: scenario.description,
                payload: {
                  command: `npm run check:${scenario.name}`,
                  ...(scenario.description ? { stderr: scenario.description } : {}),
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [attentionThread]),
      loadThread: vi.fn(async () => liveBootstrap(attentionThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="thread-${scenario.name}-activity"] button`)));
    (runtime.querySelector(`[data-thread-id="thread-${scenario.name}-activity"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-inline-row').length === 1);

    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(1);
    expect(runtime.querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
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
