// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvContext } from '../pages/EnvContext';
import { CodexPage } from './CodexPage';
import { CodexProvider } from './CodexProvider';
import { CodexSidebar } from './CodexSidebar';

const fetchCodexStatusMock = vi.fn();
const fetchCodexCapabilitiesMock = vi.fn();
const listCodexThreadsMock = vi.fn();
const openCodexThreadMock = vi.fn();
const startCodexThreadMock = vi.fn();
const startCodexTurnMock = vi.fn();
const archiveCodexThreadMock = vi.fn();
const respondToCodexRequestMock = vi.fn();
const connectCodexEventStreamMock = vi.fn();
const notification = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...classes: Array<string | undefined | null | false>) => classes.filter(Boolean).join(' '),
  useLayout: () => ({
    sidebarActiveTab: () => 'codex',
  }),
  useNotification: () => notification,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Activity: Icon,
    Code: Icon,
    FileText: Icon,
    Folder: Icon,
    Refresh: Icon,
    Send: Icon,
    Terminal: Icon,
    Trash: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => null,
}));

vi.mock('../chat/blocks/MarkdownBlock', () => ({
  MarkdownBlock: (props: any) => <div class={props.class}>{props.content}</div>,
}));

vi.mock('../chat/blocks/ShellBlock', () => ({
  ShellBlock: (props: any) => <div class={props.class}>{props.command}{props.output}</div>,
}));

vi.mock('../chat/blocks/ThinkingBlock', () => ({
  ThinkingBlock: (props: any) => <div class={props.class}>{props.content}</div>,
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  SidebarContent: (props: any) => <div data-testid="sidebar-content" class={props.class}>{props.children}</div>,
  SidebarItemList: (props: any) => <div class={props.class}>{props.children}</div>,
  SidebarSection: (props: any) => (
    <section class={props.class}>
      {props.title ? <div>{props.title}</div> : null}
      {props.actions}
      {props.children}
    </section>
  ),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type={props.type ?? 'button'}
      class={props.class}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props['aria-label']}
      title={props.title}
    >
      {props.children}
    </button>
  ),
  Card: (props: any) => <div class={props.class}>{props.children}</div>,
  CardContent: (props: any) => <div class={props.class}>{props.children}</div>,
  CardDescription: (props: any) => <p class={props.class}>{props.children}</p>,
  CardFooter: (props: any) => <div class={props.class}>{props.children}</div>,
  CardHeader: (props: any) => <div class={props.class}>{props.children}</div>,
  CardTitle: (props: any) => <div class={props.class}>{props.children}</div>,
  Input: (props: any) => (
    <input
      type={props.type}
      class={props.class}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      onInput={(event) => props.onInput?.(event)}
    />
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
  Select: (props: any) => (
    <select
      class={props.class}
      value={props.value ?? ''}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.(event.currentTarget.value)}
      aria-label={props['aria-label']}
    >
      <option value="">{props.placeholder ?? ''}</option>
      {(props.options ?? []).map((option: any) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
  Textarea: (props: any) => (
    <textarea
      class={props.class}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      rows={props.rows}
      onInput={(event) => props.onInput?.(event)}
      onKeyDown={(event) => props.onKeyDown?.(event)}
      onCompositionStart={(event) => props.onCompositionStart?.(event)}
      onCompositionEnd={(event) => props.onCompositionEnd?.(event)}
    />
  ),
}));

vi.mock('./api', () => ({
  fetchCodexStatus: (...args: any[]) => fetchCodexStatusMock(...args),
  fetchCodexCapabilities: (...args: any[]) => fetchCodexCapabilitiesMock(...args),
  listCodexThreads: (...args: any[]) => listCodexThreadsMock(...args),
  openCodexThread: (...args: any[]) => openCodexThreadMock(...args),
  startCodexThread: (...args: any[]) => startCodexThreadMock(...args),
  startCodexTurn: (...args: any[]) => startCodexTurnMock(...args),
  archiveCodexThread: (...args: any[]) => archiveCodexThreadMock(...args),
  respondToCodexRequest: (...args: any[]) => respondToCodexRequestMock(...args),
  connectCodexEventStream: (...args: any[]) => connectCodexEventStreamMock(...args),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderSurface(host: HTMLDivElement) {
  render(() => (
    <EnvContext.Provider
      value={{
        env_id: () => 'env_1',
        env: (() => null) as any,
        localRuntime: () => null,
        connect: async () => undefined,
        connecting: () => false,
        connectError: () => null,
        connectionOverlayVisible: () => false,
        connectionOverlayMessage: () => '',
        goTab: () => undefined,
        filesSidebarOpen: () => false,
        setFilesSidebarOpen: () => undefined,
        toggleFilesSidebar: () => undefined,
        settingsSeq: () => 1,
        bumpSettingsSeq: () => undefined,
        openSettings: () => undefined,
        openDebugConsole: () => undefined,
        settingsFocusSeq: () => 0,
        settingsFocusSection: () => null,
        askFlowerIntentSeq: () => 0,
        askFlowerIntent: () => null,
        injectAskFlowerIntent: () => undefined,
        openAskFlowerComposer: () => undefined,
        openTerminalInDirectoryRequestSeq: () => 0,
        openTerminalInDirectoryRequest: () => null,
        openTerminalInDirectory: () => undefined,
        consumeOpenTerminalInDirectoryRequest: () => undefined,
        aiThreadFocusSeq: () => 0,
        aiThreadFocusId: () => null,
        focusAIThread: () => undefined,
      }}
    >
      <CodexProvider>
        <div>
          <CodexSidebar />
          <CodexPage />
        </div>
      </CodexProvider>
    </EnvContext.Provider>
  ), host);
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('CodexSidebar', () => {
  it('drives the active conversation shown in the Codex chat shell', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supported_reasoning_efforts: ['medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request', 'never'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Backend audit',
        preview: 'Review the gateway wiring',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'idle',
        cwd: '/workspace',
      },
      {
        id: 'thread_2',
        name: 'UI polish',
        preview: 'Align the Codex shell with floe-webapp',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 3,
        updated_at_unix_s: 4,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockImplementation(async (threadID: string) => ({
      thread: {
        id: threadID,
        name: threadID === 'thread_1' ? 'Backend audit' : 'UI polish',
        preview: threadID === 'thread_1' ? 'Review the gateway wiring' : 'Align the Codex shell with floe-webapp',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 4,
        status: threadID === 'thread_1' ? 'idle' : 'running',
        cwd: threadID === 'thread_1' ? '/workspace' : '/workspace/ui',
        turns: [
          {
            id: `${threadID}_turn_1`,
            status: 'completed',
            items: threadID === 'thread_1'
              ? [
                  {
                    id: `${threadID}_item_1`,
                    type: 'agentMessage',
                    text: 'Gateway note',
                  },
                ]
              : [
                  {
                    id: `${threadID}_item_1`,
                    type: 'agentMessage',
                    text: 'Polish note',
                  },
                  {
                    id: `${threadID}_item_2`,
                    type: 'fileChange',
                    changes: [
                      {
                        path: 'src/ui/codex/CodexSidebar.tsx',
                        kind: 'update',
                        diff: '+ navigator polish',
                      },
                    ],
                  },
                ],
          },
        ],
      },
      runtime_config: {
        cwd: threadID === 'thread_1' ? '/workspace' : '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: threadID === 'thread_1' ? 'idle' : 'running',
      active_status_flags: [],
    }));
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderSurface(host);

    await flushAsync();
    await flushAsync();

    expect(host.querySelector('[data-codex-surface="sidebar-summary"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-codex-surface="thread-card"]').length).toBe(2);
    expect(host.textContent).toContain('New Chat');
    expect(host.textContent).toContain('Conversations');
    expect(host.textContent).toContain('Host ready');
    expect(host.textContent).toContain('Backend audit');
    expect(host.textContent).toContain('Review the gateway wiring');
    expect(host.textContent).not.toContain('Dedicated Codex chat shell with host-native runtime and independent thread state');
    expect(host.textContent).not.toContain('/usr/local/bin/codex');

    const target = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('UI polish'));
    if (!target) {
      throw new Error('UI polish thread button not found');
    }
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await flushAsync();
    await flushAsync();

    expect(openCodexThreadMock).toHaveBeenCalledWith('thread_2');
    expect(host.textContent).toContain('UI polish');
    expect(host.textContent).toContain('Polish note');
    expect(host.textContent).toContain('src/ui/codex/CodexSidebar.tsx');
    expect(host.textContent).not.toContain('Prompt ideas');
    expect(host.textContent).not.toContain('Review recent changes');
    expect(host.textContent).toContain('GPT-5.4');
    expect(host.querySelector('.codex-page-header-context')).toBeNull();
    expect(host.querySelector('button[aria-label="Send to Codex"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('UI polish');
  });

  it('keeps a newly started thread selected before the sidebar list refetch catches up', async () => {
    let streamOnEvent: ((event: any) => void) | null = null;
    const existingThread = {
      id: 'thread_1',
      name: 'Existing thread',
      preview: 'Inspect the current gateway wiring',
      ephemeral: false,
      model_provider: 'gpt-5.4',
      created_at_unix_s: 1,
      updated_at_unix_s: 2,
      status: 'idle',
      cwd: '/workspace',
    };
    const existingDetail = {
      thread: {
        ...existingThread,
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'idle',
      active_status_flags: [],
    };
    const freshDetail = {
      thread: {
        id: 'thread_new',
        name: 'Fresh thread',
        preview: 'Create a new Codex thread',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 10,
        updated_at_unix_s: 11,
        status: 'active',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'active',
      active_status_flags: [],
    };

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supported_reasoning_efforts: ['medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([existingThread]);
    openCodexThreadMock.mockImplementation(async (threadID: string) => (
      threadID === 'thread_new' ? freshDetail : existingDetail
    ));
    startCodexThreadMock.mockResolvedValue(freshDetail);
    startCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockImplementation(async (args: any) => {
      streamOnEvent = args.onEvent;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderSurface(host);

    await flushAsync();
    await flushAsync();

    const newChatButton = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('New Chat'));
    if (!newChatButton) {
      throw new Error('New Chat button not found');
    }
    newChatButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    const composer = host.querySelector('textarea[placeholder^="Ask Codex"]') as HTMLTextAreaElement | null;
    if (!composer) {
      throw new Error('composer textarea not found');
    }
    composer.value = 'Create a new Codex thread';
    composer.dispatchEvent(new Event('input', { bubbles: true }));

    const sendButton = host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null;
    if (!sendButton) {
      throw new Error('send button not found');
    }
    sendButton.click();

    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(startCodexThreadMock).toHaveBeenCalledTimes(1);
    expect(startCodexTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      threadID: 'thread_new',
      inputText: 'Create a new Codex thread',
    }));
    expect(host.textContent).toContain('Fresh thread');
    expect(host.textContent).toContain('Create a new Codex thread');
    expect(host.querySelector('[data-codex-working-state="true"]')).not.toBeNull();
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('Fresh thread');
    expect(host.querySelectorAll('[data-codex-surface="thread-card"]').length).toBe(2);

    if (!streamOnEvent) {
      throw new Error('stream callback not captured');
    }
    const emitStreamEvent = streamOnEvent as (event: any) => void;
    emitStreamEvent({
      seq: 1,
      type: 'thread_name_updated',
      thread_id: 'thread_new',
      thread_name: 'Codex renamed thread',
    });
    await flushAsync();

    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('Codex renamed thread');
  });

  it('shows a loading state instead of stale transcript content when switching to an uncached thread', async () => {
    const thread2Detail = deferred<any>();

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supported_reasoning_efforts: ['medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Backend audit',
        preview: 'Review the gateway wiring',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'idle',
        cwd: '/workspace',
      },
      {
        id: 'thread_2',
        name: 'UI polish',
        preview: 'Align the Codex shell with floe-webapp',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 3,
        updated_at_unix_s: 4,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockImplementation((threadID: string) => {
      if (threadID === 'thread_2') {
        return thread2Detail.promise;
      }
      return Promise.resolve({
        thread: {
          id: 'thread_1',
          name: 'Backend audit',
          preview: 'Review the gateway wiring',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'idle',
          cwd: '/workspace',
          turns: [{
            id: 'thread_1_turn_1',
            status: 'completed',
            items: [
              {
                id: 'thread_1_item_1',
                type: 'agentMessage',
                text: 'Gateway note',
              },
            ],
          }],
        },
        runtime_config: {
          cwd: '/workspace',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 0,
        active_status: 'idle',
        active_status_flags: [],
      });
    });
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderSurface(host);

    await flushAsync();
    await flushAsync();

    expect(host.textContent).toContain('Gateway note');

    const target = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('UI polish'));
    if (!target) {
      throw new Error('UI polish thread button not found');
    }
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await flushAsync();

    expect(host.querySelector('[data-codex-surface="loading-state"]')).not.toBeNull();
    expect(host.textContent).toContain('Loading the selected Codex thread.');
    expect(host.textContent).not.toContain('Gateway note');

    thread2Detail.resolve({
      thread: {
        id: 'thread_2',
        name: 'UI polish',
        preview: 'Align the Codex shell with floe-webapp',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 3,
        updated_at_unix_s: 4,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [{
          id: 'thread_2_turn_1',
          status: 'completed',
          items: [
            {
              id: 'thread_2_item_1',
              type: 'agentMessage',
              text: 'Polish note',
            },
          ],
        }],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    });

    await flushAsync();
    await flushAsync();

    expect(host.textContent).toContain('Polish note');
    expect(host.textContent).not.toContain('Gateway note');
  });

  it('ignores out-of-order bootstrap responses when switching threads quickly', async () => {
    const thread2Detail = deferred<any>();
    const thread3Detail = deferred<any>();

    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [
        {
          id: 'gpt-5.4',
          display_name: 'GPT-5.4',
          supported_reasoning_efforts: ['medium', 'high'],
        },
      ],
      effective_config: {
        cwd: '/workspace',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Backend audit',
        preview: 'Review the gateway wiring',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'idle',
        cwd: '/workspace',
      },
      {
        id: 'thread_2',
        name: 'UI polish',
        preview: 'Align the Codex shell with floe-webapp',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 3,
        updated_at_unix_s: 4,
        status: 'running',
        cwd: '/workspace/ui',
      },
      {
        id: 'thread_3',
        name: 'Release notes',
        preview: 'Summarize the latest release work',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 5,
        updated_at_unix_s: 6,
        status: 'running',
        cwd: '/workspace/release',
      },
    ]);
    openCodexThreadMock.mockImplementation((threadID: string) => {
      if (threadID === 'thread_2') return thread2Detail.promise;
      if (threadID === 'thread_3') return thread3Detail.promise;
      return Promise.resolve({
        thread: {
          id: 'thread_1',
          name: 'Backend audit',
          preview: 'Review the gateway wiring',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 2,
          status: 'idle',
          cwd: '/workspace',
          turns: [{
            id: 'thread_1_turn_1',
            status: 'completed',
            items: [
              {
                id: 'thread_1_item_1',
                type: 'agentMessage',
                text: 'Gateway note',
              },
            ],
          }],
        },
        runtime_config: {
          cwd: '/workspace',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 0,
        active_status: 'idle',
        active_status_flags: [],
      });
    });
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderSurface(host);

    await flushAsync();
    await flushAsync();

    const thread2Button = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('UI polish'));
    const thread3Button = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Release notes'));
    if (!thread2Button || !thread3Button) {
      throw new Error('thread buttons not found');
    }

    thread2Button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();
    thread3Button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.querySelector('[data-codex-surface="loading-state"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Gateway note');

    thread2Detail.resolve({
      thread: {
        id: 'thread_2',
        name: 'UI polish',
        preview: 'Align the Codex shell with floe-webapp',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 3,
        updated_at_unix_s: 4,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [{
          id: 'thread_2_turn_1',
          status: 'completed',
          items: [
            {
              id: 'thread_2_item_1',
              type: 'agentMessage',
              text: 'Polish note',
            },
          ],
        }],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    });

    await flushAsync();
    await flushAsync();

    expect(host.querySelector('[data-codex-surface="loading-state"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Polish note');

    thread3Detail.resolve({
      thread: {
        id: 'thread_3',
        name: 'Release notes',
        preview: 'Summarize the latest release work',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 5,
        updated_at_unix_s: 6,
        status: 'running',
        cwd: '/workspace/release',
        turns: [{
          id: 'thread_3_turn_1',
          status: 'completed',
          items: [
            {
              id: 'thread_3_item_1',
              type: 'agentMessage',
              text: 'Release note summary',
            },
          ],
        }],
      },
      runtime_config: {
        cwd: '/workspace/release',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: [],
    });

    await flushAsync();
    await flushAsync();

    expect(host.textContent).toContain('Release note summary');
    expect(host.textContent).not.toContain('Polish note');
    expect(host.querySelector('[aria-current="page"]')?.textContent).toContain('Release notes');
  });
});
