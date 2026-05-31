// @vitest-environment jsdom

import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FlowerSurface } from '../../../../flower_ui/src';
import type { FlowerSurfaceAdapter, FlowerSettingsSnapshot, FlowerThreadSnapshot } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

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

function settingsSnapshot(configured = true): FlowerSettingsSnapshot {
  return {
    config: {
      schema_version: 1,
      enabled: true,
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
    sendMessage: vi.fn(async () => thread()),
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

  it('keeps new chat in the composer when the provider is not ready', async () => {
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
    expect(host.textContent).toContain('Flower needs a provider, model, and required provider keys before this host can start a chat.');
    expect((host.querySelector('.flower-host-composer button') as HTMLButtonElement | null)?.disabled).toBe(true);

    const textarea = host.querySelector('textarea') as HTMLTextAreaElement | null;
    textarea!.value = 'hello';
    textarea!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    textarea!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await flush();

    expect(host.querySelector('.flower-host-chat-shell')).toBeTruthy();
    expect(host.querySelector('.flower-component-main > div[aria-hidden="true"] button[aria-label="Back to chat"]')).toBeTruthy();
    expect(host.textContent).toContain('Configure a provider and model before starting a Flower chat.');
  });
});
