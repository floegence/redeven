// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowerSurface } from '../../../../flower_ui/src';
import type {
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
    Code: Icon,
    FolderOpen: Icon,
    GitBranch: Icon,
    GripVertical: Icon,
    Pencil: Icon,
    Plus: Icon,
    Refresh: Icon,
    Search: Icon,
    Send: Icon,
    Settings: Icon,
    Shield: Icon,
    Sparkles: Icon,
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
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'idle',
    source_label: 'This host',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Plan deploy',
        created_at_ms: 1,
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
    handler_selection: {
      can_switch: false,
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'flower_surface',
    },
    ui_chips: [{ kind: 'host', label: 'Using Flower Host', tone: 'normal' }],
    blocker: null,
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
    expect(host.querySelector('.flower-host-handler-error')?.textContent).toContain('Configure Flower before chatting.');
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
          created_at_ms: 10,
        },
        {
          id: 'm-assistant',
          role: 'assistant',
          content: 'Flower verification is complete.',
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
});
