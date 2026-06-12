// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowerSurface } from '../../../../flower_ui/src';
import type {
  FlowerInputRequest,
  FlowerRouterDecision,
  FlowerSettingsDraft,
  FlowerSurfaceAdapter,
  FlowerSettingsSnapshot,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = (props: any) => <span data-icon class={props.class} />;
  return {
    AlertTriangle: Icon,
    Bot: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    Clock: Icon,
    Code: Icon,
    Copy: Icon,
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
      enabled: configured,
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
    target_cache: {
      version: 1,
      entries: [],
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
    source_label: 'This host',
    target_labels: [],
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
    route: 'flower_host',
    reason_code: 'host_available',
    selected_handler: {
      handler_id: 'host',
      handler_kind: 'global',
      display_name: 'This host',
      carrier_kind: 'desktop',
      state: 'online',
      selection_source: 'router_default',
      supports_thread_kinds: ['chat'],
      allowed_target_ids: [],
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
    host_presence: {
      schema_version: 1,
      host_id: 'host',
      host_kind: 'global',
      carrier_kind: 'desktop',
      display_name: 'This host',
      state: 'online',
      endpoint: { visibility: 'local' },
      capabilities: ['chat'],
      last_seen_at_unix_ms: 1,
    },
    allowed_actions: ['start_thread'],
    ui_chips: [{ kind: 'host', label: 'Using Flower Host', tone: 'normal' }],
    blocker: null,
    created_at_unix_ms: 1,
  };
}

function blockedDecision(): FlowerRouterDecision {
  return {
    ...decision(),
    decision_id: 'decision-blocked',
    route: 'blocked',
    reason_code: 'host_not_configured',
    selected_handler: null,
    available_handlers: [],
    ui_chips: [{ kind: 'host', label: 'Flower needs setup', tone: 'warning' }],
    blocker: {
      code: 'host_not_configured',
      message: 'Configure Flower before chatting.',
    },
  };
}

function adapter(configured = true): FlowerSurfaceAdapter {
  return {
    host: {
      host_id: 'host',
      host_kind: 'global',
      carrier_kind: 'desktop',
      display_name: 'This host',
      subtitle: 'Global host',
    },
    loadSettings: vi.fn(async () => settingsSnapshot(configured)),
    saveSettings: vi.fn(async () => settingsSnapshot(configured)),
    listThreads: vi.fn(async () => [
      thread(),
      thread({ thread_id: 'thread-2', title: 'Review branch', updated_at_ms: 3 }),
    ]),
    resolveHandler: vi.fn(async () => decision()),
    sendMessage: vi.fn(async () => thread()),
    submitInput: vi.fn(async () => thread({ status: 'running' })),
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

function renderSurface(configured = true): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(() => <FlowerSurface adapter={adapter(configured)} />, host);
  return host;
}

function renderSurfaceWithAdapter(surfaceAdapter: FlowerSurfaceAdapter): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(() => <FlowerSurface adapter={surfaceAdapter} />, host);
  return host;
}

function threadOrder(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[data-thread-id]'))
    .map((node) => node.getAttribute('data-thread-id') ?? '');
}

describe('FlowerSurface navigation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns from settings to the chat panel with an icon-only control', async () => {
    const host = renderSurface();
    await flush();

    (host.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();
    expect(host.querySelector('.flower-host-chat-shell')).toBeNull();

    const back = host.querySelector('button[aria-label="Back to chat"]') as HTMLButtonElement | null;
    expect(back).toBeTruthy();
    expect(back?.textContent?.trim()).toBe('');

    back?.click();
    await flush();

    expect(host.querySelector('.flower-host-chat-shell')).toBeTruthy();
  });

  it('lets the single flower entry start a new chat from settings', async () => {
    const host = renderSurface();
    await flush();

    (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await flush();
    (host.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    const newChat = host.querySelector('button[aria-label="New chat"]') as HTMLButtonElement | null;
    expect(newChat?.textContent).toContain('New chat');
    newChat?.click();
    await flush();

    expect(host.querySelector('.flower-host-chat-shell')).toBeTruthy();
    expect(host.querySelector('.flower-host-chat-header-title')?.textContent).toBe('Ask Flower');
    expect(host.querySelector('.flower-host-thread-card-active')).toBeNull();
  });

  it('selects a thread from settings and returns to chat', async () => {
    const host = renderSurface();
    await flush();

    (host.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await flush();

    expect(host.querySelector('.flower-host-chat-shell')).toBeTruthy();
    expect(host.querySelector('.flower-host-chat-header-title')?.textContent).toBe('Deploy plan');
  });

  it('keeps enable guidance beside the disabled notice and only shows saved feedback briefly', async () => {
    const surfaceAdapter = mutableSettingsAdapter(false);
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <FlowerSurface adapter={surfaceAdapter} />, host);
    await flush();

    (host.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    expect(host.querySelector('.flower-settings-title-feedback')?.textContent).toBe('');
    expect(host.querySelector('.flower-settings-disabled-guide')?.textContent).toContain('Flower is disabled on this host.');
    expect(host.querySelector('.flower-settings-disabled-guide')?.textContent).toContain('Enable');
    expect(host.textContent).not.toContain('Flower is enabled on this host');
    expect(host.querySelector('.flower-settings-current-model')).toBeNull();

    const enableButton = Array.from(host.querySelectorAll('.flower-settings-disabled-guide button'))
      .find((button) => button.textContent?.includes('Enable')) as HTMLButtonElement | undefined;
    enableButton?.click();
    await wait(850);
    await flush();

    expect(surfaceAdapter.saveSettings).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.flower-settings-disabled-guide')).toBeNull();
    expect(host.textContent).not.toContain('Flower is enabled on this host');
    expect(host.querySelector('.flower-settings-title-feedback')?.textContent).toContain('Disable Flower');
    expect(host.querySelector('.flower-settings-title-feedback')?.textContent).toContain('Saved');

    await wait(1850);
    await flush();

    expect(host.querySelector('.flower-settings-title-feedback')?.textContent).toBe('Disable Flower');
  }, 5000);

  it('opens provider setup instead of enabling a disabled Flower with no model', async () => {
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
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <FlowerSurface adapter={{
      ...surfaceAdapter,
      loadSettings: vi.fn(async () => emptySnapshot),
      saveSettings: vi.fn(async () => emptySnapshot),
    }} />, host);
    await flush();

    (host.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();

    expect(host.querySelector('.flower-settings-disabled-guide')?.textContent).toContain('Set up Flower');
    (Array.from(host.querySelectorAll('.flower-settings-disabled-guide button'))
      .find((button) => button.textContent?.includes('Set up Flower')) as HTMLButtonElement).click();
    await flush();

    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Provider type');
  });

  it('guides setup from new chat when the provider is not ready', async () => {
    const host = renderSurface(false);
    await flush();

    (host.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
    await flush();
    const newChat = host.querySelector('button[aria-label="New chat"]') as HTMLButtonElement | null;
    expect(newChat?.textContent).toContain('New chat');
    newChat?.click();
    await flush();

    expect(host.querySelector('.flower-host-chat-shell')).toBeTruthy();
    expect(host.querySelector('.flower-host-chat-header-title')?.textContent).toBe('Ask Flower');
    expect(host.querySelector('.flower-host-setup-guide')?.textContent).toContain('Set up Flower');
    expect(host.querySelector('.flower-host-setup-guide')?.textContent).toContain('Choose a provider, model, and API key once.');
    expect(host.querySelector('.flower-host-handler-error')).toBeNull();
    expect(host.textContent).not.toContain('Flower handler unavailable');

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    textarea!.value = 'hello';
    textarea!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();

    expect(host.querySelector('.flower-host-chat-shell')).toBeNull();
    expect(host.querySelector('button[aria-label="Back to chat"]')).toBeTruthy();
  });

  it('shows handler errors near the composer instead of pretending a host is selected', async () => {
    const failingAdapter = {
      ...adapter(true),
      resolveHandler: vi.fn(async () => blockedDecision()),
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <FlowerSurface adapter={failingAdapter} />, host);
    await flush();

    expect(host.querySelector('.flower-host-handler-chip')?.textContent).toContain('Flower handler unavailable');
    expect(host.querySelector('.flower-host-handler-error-card')?.textContent).toContain('Configure Flower before chatting.');
    expect(host.querySelector('.flower-host-handler-retry')?.textContent).toContain('Retry');
    expect((Array.from(host.querySelectorAll('.flower-host-composer button')) as HTMLButtonElement[])
      .some((button) => button.textContent?.includes('Send') && button.disabled)).toBe(true);
  });

  it('switches handlers before the first message and keeps the selected thread decision-free', async () => {
    const secondDecision: FlowerRouterDecision = {
      ...decision(),
      decision_id: 'decision-2',
      selected_handler: {
        ...decision().selected_handler!,
        handler_id: 'host-2',
        display_name: 'Lab Flower',
        selection_source: 'user_selected',
      },
      available_handlers: [
        decision().selected_handler!,
        {
          ...decision().selected_handler!,
          handler_id: 'host-2',
          display_name: 'Lab Flower',
        },
      ],
      handler_selection: {
        can_switch: true,
        requires_user_visible_confirmation: true,
      },
    };
    const resolveHandler = vi.fn(async (input?: any) => (input?.requested_handler_id === 'host-2' ? secondDecision : {
      ...decision(),
      available_handlers: secondDecision.available_handlers,
      handler_selection: secondDecision.handler_selection,
    }));
    const sendMessage = vi.fn(async () => thread());
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <FlowerSurface adapter={{
      ...adapter(true),
      resolveHandler,
      sendMessage,
    }} />, host);
    await flush();

    const selector = host.querySelector('.flower-host-handler-picker select') as HTMLSelectElement;
    selector.value = 'host-2';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(resolveHandler).toHaveBeenCalledWith(expect.objectContaining({ requested_handler_id: 'host-2' }));

    (host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await flush();
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
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
    const sendMessage = vi.fn(async () => sentThread);
    const loadThread = vi.fn(async () => completeThread);
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <FlowerSurface adapter={{
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      loadThread,
      sendMessage,
    }} />, host);
    await waitFor(() => Boolean(host.querySelector('textarea')));

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'verify Flower';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => (Array.from(host.querySelectorAll('.flower-host-composer button')) as HTMLButtonElement[])
      .some((button) => button.textContent?.includes('Send') && !button.disabled));
    const send = (Array.from(host.querySelectorAll('.flower-host-composer button')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Send') && !button.disabled) as HTMLButtonElement;
    send.click();
    await waitFor(() => sendMessage.mock.calls.length > 0);
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => host.textContent?.includes('Flower verification is complete.') ?? false);

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: undefined,
      prompt: 'verify Flower',
    }));
    expect(loadThread).toHaveBeenCalledWith('thread-new');
    expect(host.textContent).toContain('Flower verification is complete.');
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
    const loadThread = vi.fn(async () => ({
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [olderThread, newerThread]),
      loadThread,
    });

    await waitFor(() => threadOrder(host).length === 2);
    expect(threadOrder(host)).toEqual(['thread-newer', 'thread-older']);

    (host.querySelector('[data-thread-id="thread-older"] button') as HTMLButtonElement).click();
    await waitFor(() => loadThread.mock.calls.length > 0);
    await waitFor(() => host.textContent?.includes('Still in the older thread.') ?? false);

    expect(threadOrder(host)).toEqual(['thread-newer', 'thread-older']);
    expect(host.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id')).toBe('thread-older');
    expect(host.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-status')).toBe('idle');
    expect(host.querySelector('[data-thread-id="thread-older"]')?.getAttribute('data-flower-thread-active')).toBe('true');
    expect(host.querySelector('[data-thread-id="thread-older"]')?.getAttribute('data-flower-thread-status')).toBe('idle');
  });

  it('uses thread id as a stable tie breaker when conversations share a creation time', async () => {
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [
        thread({ thread_id: 'thread-c', title: 'C', created_at_ms: 4_000 }),
        thread({ thread_id: 'thread-a', title: 'A', created_at_ms: 4_000 }),
        thread({ thread_id: 'thread-b', title: 'B', created_at_ms: 4_000 }),
      ]),
    });

    await waitFor(() => threadOrder(host).length === 3);

    expect(threadOrder(host)).toEqual(['thread-a', 'thread-b', 'thread-c']);
  });

  it('opens thread actions from the keyboard and supports menu roving focus', async () => {
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      forkThread: vi.fn(async () => thread({ thread_id: 'thread-fork' })),
      renameThread: vi.fn(async () => thread()),
      setThreadPinned: vi.fn(async () => thread({ pinned_at_ms: 10 })),
    });
    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-1"] button')));

    const rowButton = host.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement;
    rowButton.focus();
    rowButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await flush();

    const menu = host.querySelector('[role="menu"]') as HTMLElement | null;
    expect(menu).toBeTruthy();
    const items = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
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
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(rowButton);
  });

  it('disables fork for threads that are still running or waiting', async () => {
    const forkThread = vi.fn(async () => thread({ thread_id: 'thread-fork' }));
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [
        thread({ thread_id: 'thread-running', title: 'Running', status: 'running' }),
        thread({ thread_id: 'thread-waiting', title: 'Waiting', status: 'waiting_user' }),
      ]),
      forkThread,
    });
    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-running"]')));

    (host.querySelector('[data-thread-id="thread-running"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    const runningFork = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Fork')) as HTMLButtonElement;
    expect(runningFork.disabled).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    (host.querySelector('[data-thread-id="thread-waiting"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    const waitingFork = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [thread({ working_dir: '/workspace/redeven' })]),
    });
    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-1"]')));

    (host.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    (Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Copy thread id')) as HTMLButtonElement).click();
    await flush();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(host.textContent).toContain('Copied thread id.');
    expect(document.activeElement).toBe(host.querySelector('[data-thread-id="thread-1"] button'));
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      renameThread,
    });
    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-1"]')));

    (host.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    await flush();
    (Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Rename')) as HTMLButtonElement).click();
    await flush();
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
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
    expect(host.querySelector('.flower-host-thread-action-error')).toBeNull();
  });

  it('disables all thread actions while a fork action is pending', async () => {
    const forkControl: { resolve?: (thread: FlowerThreadSnapshot) => void } = {};
    const forkThread = vi.fn(() => new Promise<FlowerThreadSnapshot>((resolve) => {
      forkControl.resolve = resolve;
    }));
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      forkThread,
    });
    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-1"]')));

    const openForkMenu = async () => {
      (host.querySelector('[data-thread-id="thread-1"]') as HTMLElement)
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      await flush();
      return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((item) => item.textContent?.includes('Fork') || item.textContent?.includes('Working')) as HTMLButtonElement;
    };
    (await openForkMenu()).click();
    await flush();
    const pendingFork = await openForkMenu();

    expect(forkThread).toHaveBeenCalledTimes(1);
    expect(pendingFork.disabled).toBe(true);
    expect(pendingFork.textContent).toContain('Working');

    (host.querySelector('[data-thread-id="thread-2"]') as HTMLElement)
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    await flush();
    const secondThreadItems = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(secondThreadItems.length).toBeGreaterThan(0);
    expect(secondThreadItems.every((item) => item.disabled)).toBe(true);
    secondThreadItems.find((item) => item.textContent?.includes('Fork'))?.click();
    await flush();
    expect(forkThread).toHaveBeenCalledTimes(1);

    const completeFork = forkControl.resolve;
    if (!completeFork) throw new Error('fork promise did not start');
    completeFork(thread({ thread_id: 'thread-fork' }));
    await waitFor(() => forkThread.mock.calls.length === 1);
  });

  it('preserves loaded selected-thread details while a summary-only list refresh is waiting for detail reload', async () => {
    const detailedThread = thread({
      thread_id: 'thread-detail',
      title: 'Detailed thread',
      created_at_ms: 3_000,
      updated_at_ms: 3_100,
      status: 'running',
      tool_activity: [
        {
          tool_id: 'tool-read',
          tool_name: 'file.read',
          status: 'running',
          summary: 'Read file: AGENTS.md',
        },
      ],
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
        },
      ],
    });
    const summaryOnlyThread = {
      ...detailedThread,
      updated_at_ms: 3_500,
      messages: [],
      tool_activity: undefined,
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [detailedThread];
    let delayedDetailReloadStarted = false;
    const loadThread = vi.fn(() => {
      if (loadThread.mock.calls.length === 1) {
        return Promise.resolve(detailedThread);
      }
      delayedDetailReloadStarted = true;
      return new Promise<FlowerThreadSnapshot>(() => undefined);
    });
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-detail"] button')));
    (host.querySelector('[data-thread-id="thread-detail"] button') as HTMLButtonElement).click();
    await waitFor(() => host.textContent?.includes('Loaded detail stays visible.') ?? false);

    listSnapshot = [summaryOnlyThread];
    (host.querySelector('.flower-host-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => delayedDetailReloadStarted);

    expect(host.textContent).toContain('Loaded detail stays visible.');
    expect(host.textContent).toContain('Read file: AGENTS.md');
    expect(host.querySelector('.flower-host-tool-activity')).toBeTruthy();
    expect(host.querySelector('.flower-host-error-card')?.textContent).toContain('Provider returned a structured failure.');
  });

  it('renders structured input requests and blocks the normal composer while Flower waits', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-input',
      title: 'Waiting input',
      created_at_ms: 3_800,
      updated_at_ms: 3_900,
      status: 'waiting_user',
      input_request: inputRequest(),
      tool_activity: [
        {
          tool_id: 'tool-ask-user',
          tool_name: 'ask_user',
          status: 'waiting',
          summary: 'Waiting for deployment target',
        },
      ],
      messages: [
        {
          id: 'm-waiting-input',
          role: 'assistant',
          content: 'I need one choice before continuing.',
          status: 'complete',
          created_at_ms: 3_900,
        },
      ],
    });
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => waitingThread),
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-waiting-input"] button')));
    (host.querySelector('[data-thread-id="thread-waiting-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('[data-flower-input-request-card]')));

    expect(host.querySelector('[data-flower-input-request-card]')?.textContent).toContain('Flower needs your input');
    expect(host.querySelector('[data-flower-input-request-card]')?.textContent).toContain('Choose the deployment target before Flower continues.');
    expect(host.querySelector('[data-flower-input-request-card]')?.textContent).toContain('Where should Flower deploy this change?');
    expect(host.querySelector('[data-flower-input-request-card]')?.textContent).toContain('Staging');
    expect(host.querySelector('[data-flower-input-request-card]')?.textContent).toContain('Production');
    expect(host.querySelector('.flower-host-tool-activity')?.textContent).toContain('ask_user');
    expect(host.querySelector('.flower-host-streaming-cursor')).toBeNull();
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
    expect((host.querySelector('textarea') as HTMLTextAreaElement).placeholder).toBe('Answer the prompt above to continue this conversation.');
    expect((Array.from(host.querySelectorAll('.flower-host-composer button')) as HTMLButtonElement[])
      .some((button) => button.textContent?.includes('Send') && button.disabled)).toBe(true);
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
    const submitInput = vi.fn(async () => continuedThread);
    const loadThread = vi.fn(async () => (loadThread.mock.calls.length === 1 ? waitingThread : continuedThread));
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread,
      submitInput,
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-submit-input"] button')));
    (host.querySelector('[data-thread-id="thread-submit-input"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('[data-flower-input-request-card]')));

    (Array.from(host.querySelectorAll('.flower-host-input-request-choice')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Staging'))?.click();
    await flush();
    (host.querySelector('.flower-host-input-request-submit') as HTMLButtonElement).click();
    await waitFor(() => submitInput.mock.calls.length > 0);
    await waitFor(() => host.textContent?.includes('Continuing with staging.') ?? false);

    expect(submitInput).toHaveBeenCalledWith({
      thread_id: 'thread-submit-input',
      prompt_id: 'prompt-ask-user',
      answers: {
        target: {
          choice_id: 'staging',
        },
      },
    });
    expect(host.querySelector('[data-flower-input-request-card]')).toBeNull();
    expect(host.textContent).toContain('Continuing with staging.');
  });

  it('shows structured input submission failures inside the input card without losing the answer', async () => {
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => waitingThread),
      submitInput,
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-input-error"] button')));
    (host.querySelector('[data-thread-id="thread-input-error"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('[data-flower-input-request-card]')));

    (Array.from(host.querySelectorAll('.flower-host-input-request-choice')) as HTMLButtonElement[])
      .find((button) => button.textContent?.includes('Production'))?.click();
    await flush();
    (host.querySelector('.flower-host-input-request-submit') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('.flower-host-input-request-error')));

    expect(host.querySelector('.flower-host-input-request-error')?.textContent).toContain('Flower is no longer waiting for that input.');
    expect(host.querySelector('.flower-host-input-request-submit')?.textContent).toContain('Retry');
    expect(host.querySelector('.flower-host-input-request-choice-selected')?.textContent).toContain('Production');
  });

  it('preserves waiting input cards while a summary-only list refresh is waiting for detail reload', async () => {
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
      messages: [],
      tool_activity: undefined,
      input_request: undefined,
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [detailedThread];
    let delayedDetailReloadStarted = false;
    const loadThread = vi.fn(() => {
      if (loadThread.mock.calls.length === 1) {
        return Promise.resolve(detailedThread);
      }
      delayedDetailReloadStarted = true;
      return new Promise<FlowerThreadSnapshot>(() => undefined);
    });
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-waiting-summary-refresh"] button')));
    (host.querySelector('[data-thread-id="thread-waiting-summary-refresh"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('[data-flower-input-request-card]')));

    listSnapshot = [summaryOnlyThread];
    (host.querySelector('.flower-host-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => delayedDetailReloadStarted);

    expect(host.querySelector('[data-flower-input-request-card]')?.textContent).toContain('Where should Flower deploy this change?');
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
      tool_activity: undefined,
      error: undefined,
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [selectedThread, detailedThread];
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread: vi.fn(async () => selectedThread),
    });

    await waitFor(() => host.textContent?.includes('Background preview remains available.') ?? false);

    (host.querySelector('[data-thread-id="thread-selected"] button') as HTMLButtonElement).click();
    await waitFor(() => host.querySelector('.flower-host-thread-card-active')?.getAttribute('data-thread-id') === 'thread-selected');
    listSnapshot = [selectedThread, summaryOnlyBackground];
    (host.querySelector('.flower-host-thread-refresh-button') as HTMLButtonElement).click();
    await flush();

    expect(host.textContent).toContain('Background preview remains available.');
  });

  it('shows a loading state instead of the empty state while first-loading a summary-only thread', async () => {
    const summaryThread = thread({
      thread_id: 'thread-summary-only',
      title: 'Summary only',
      created_at_ms: 4_800,
      updated_at_ms: 4_900,
      messages: [],
      tool_activity: undefined,
      error: undefined,
    });
    let loadStarted = false;
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [summaryThread]),
      loadThread: vi.fn(() => {
        loadStarted = true;
        return new Promise<FlowerThreadSnapshot>(() => undefined);
      }),
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-summary-only"] button')));
    (host.querySelector('[data-thread-id="thread-summary-only"] button') as HTMLButtonElement).click();
    await waitFor(() => loadStarted && Boolean(host.querySelector('.flower-host-thread-loading')));

    expect(host.querySelector('.flower-host-thread-loading')?.textContent).toContain('Loading conversation...');
    expect(host.textContent).not.toContain('Flower can work from this host');
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [streamingThread]),
      loadThread: vi.fn(async () => streamingThread),
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-streaming"] button')));
    (host.querySelector('[data-thread-id="thread-streaming"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('.flower-host-streaming-cursor')));

    expect(host.querySelector('.flower-host-transcript-stack')).toBeTruthy();
    expect(host.querySelector('.flower-host-message-bubble-streaming')?.textContent).toContain('Streaming partial answer');
    expect(host.querySelector('.flower-host-streaming-cursor')).toBeTruthy();
    expect(host.textContent).toContain('Streaming partial answer');
  });

  it('shows every Flower tool activity item without dropping tool names', async () => {
    const toolNames = [
      'file.read',
      'file.edit',
      'file.write',
      'apply_patch',
      'terminal.exec',
      'task_complete',
      'ask_user',
      'exit_plan_mode',
      'write_todos',
    ] as const;
    const toolsThread = thread({
      thread_id: 'thread-tools',
      title: 'Tool activity',
      created_at_ms: 6_000,
      updated_at_ms: 6_500,
      status: 'running',
      tool_activity: toolNames.map((toolName, index) => ({
        tool_id: `tool-${index}`,
        tool_name: toolName,
        status: index % 3 === 0 ? 'running' : index % 3 === 1 ? 'success' : 'waiting',
        summary: `Used ${toolName}`,
        requires_approval: toolName === 'file.write',
        approval_state: toolName === 'file.write' ? 'approved' : undefined,
      })),
      messages: [
        {
          id: 'm-tools',
          role: 'assistant',
          content: 'I am using tools.',
          status: 'complete',
          created_at_ms: 6_500,
        },
      ],
    });
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [toolsThread]),
      loadThread: vi.fn(async () => toolsThread),
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-tools"] button')));
    (host.querySelector('[data-thread-id="thread-tools"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('.flower-host-tool-activity')));

    expect(host.querySelector('.flower-host-tool-activity-heading')?.textContent).toContain('Tool activity');
    expect(host.querySelectorAll('.flower-host-tool-activity-item')).toHaveLength(toolNames.length);
    for (const toolName of toolNames) {
      expect(host.textContent).toContain(toolName);
      expect(host.textContent).toContain(`Used ${toolName}`);
    }
    expect(host.querySelector('.flower-host-tool-activity-item')?.getAttribute('aria-label')).toContain('file.read');
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failedThread]),
      loadThread: vi.fn(async () => failedThread),
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-failed"] button')));
    (host.querySelector('[data-thread-id="thread-failed"] button') as HTMLButtonElement).click();
    await waitFor(() => host.querySelectorAll('.flower-host-error-card').length > 0);

    expect(host.querySelector('.flower-host-message-bubble-error')?.textContent).toContain('Message failed');
    expect(host.querySelectorAll('.flower-host-error-card')).toHaveLength(1);
    expect(host.querySelector('.flower-host-error-card')?.textContent).toContain('Flower could not finish this reply.');
    expect(host.querySelector('.flower-host-error-card')?.textContent).toContain('Run failed: provider rejected request.');
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread: vi.fn(async () => visibleThread),
    });

    await waitFor(() => host.textContent?.includes('Flower waiting input request is incomplete.') ?? false);

    (host.querySelector('.flower-host-thread-refresh-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-after-list-recovery"] button')));

    expect(host.textContent).not.toContain('Flower could not load.');
    expect(host.textContent).not.toContain('Flower waiting input request is incomplete.');
    expect(host.querySelectorAll('.flower-host-error-card')).toHaveLength(0);
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failedThread]),
      loadThread: vi.fn(async () => failedThread),
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-empty-failure"] button')));
    (host.querySelector('[data-thread-id="thread-empty-failure"] button') as HTMLButtonElement).click();
    await waitFor(() => host.querySelectorAll('.flower-host-error-card').length > 0);

    expect(host.querySelector('.flower-host-message-bubble-error')).toBeNull();
    expect(host.querySelectorAll('.flower-host-error-card')).toHaveLength(1);
    expect(host.querySelector('.flower-host-error-card')?.textContent).toContain('Run failed before any assistant text was produced.');
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
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failedThread]),
      loadThread: vi.fn(async () => failedThread),
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-message-only-failure"] button')));
    (host.querySelector('[data-thread-id="thread-message-only-failure"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('.flower-host-message-bubble-error')));

    expect(host.querySelector('.flower-host-message-bubble-error')?.textContent).toContain('Message failed');
    expect(host.querySelector('.flower-host-message-bubble-error')?.textContent).toContain('This message failed before Flower produced visible text.');
    expect(host.querySelectorAll('.flower-host-error-card')).toHaveLength(0);
  });
});
