// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvContext } from '../pages/EnvContext';
import { CodexPage } from './CodexPage';
import { CodexProvider } from './CodexProvider';

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
  LoadingOverlay: (props: any) => <div>{props.message}</div>,
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

function renderPage(host: HTMLDivElement) {
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
        debugConsoleEnabled: () => false,
        setDebugConsoleEnabled: () => undefined,
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
        <CodexPage />
      </CodexProvider>
    </EnvContext.Provider>
  ), host);
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('CodexPage', () => {
  it('shows host diagnostics inside the Codex chat shell when the host binary is missing', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: false,
      ready: false,
      agent_home_dir: '/workspace',
    });
    listCodexThreadsMock.mockResolvedValue([]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();

    expect(host.querySelector('[data-codex-surface="page-shell"]')).not.toBeNull();
    expect(host.textContent).toContain('Host diagnostics');
    expect(host.textContent).toContain('Install Codex on the host');
    expect(host.textContent).toContain('There is no separate in-app Codex runtime toggle to manage here');
    expect(host.textContent).toContain('Redeven does not install Codex for you');
    expect(host.querySelector('button[aria-label="Send to Codex"]')).not.toBeNull();
    expect(host.querySelector('.codex-chat-input-controls')).toBeNull();
    expect(host.querySelector('.codex-chat-input-meta')).not.toBeNull();
    expect(host.querySelector('button[title="Add attachments"]')).not.toBeNull();
    expect(host.querySelector('.codex-page-toolbar')).toBeNull();
  });

  it('renders the conversation shell, transcript rows, and runtime flags for the active Codex thread', async () => {
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
          supports_image_input: true,
          supported_reasoning_efforts: ['low', 'medium', 'high'],
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
        allowed_approval_policies: ['on-request', 'never'],
        allowed_sandbox_modes: ['workspace-write', 'danger-full-access'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Codex page polish review',
        preview: 'Align the Codex workbench with the selected review shell',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Codex page polish review',
        preview: 'Align the Codex workbench with the selected review shell',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'running',
        cwd: '/workspace/ui',
        turns: [
          {
            id: 'turn_1',
            status: 'completed',
            items: [
              {
                id: 'item_1',
                type: 'userMessage',
                text: 'Please align the Codex shell with the selected Artifact Review direction.',
              },
              {
                id: 'item_2',
                type: 'agentMessage',
                text: 'I will split the work into navigator polish, artifact hierarchy, and composer cleanup.',
              },
              {
                id: 'item_3',
                type: 'fileChange',
                changes: [
                  {
                    path: 'src/ui/codex/CodexPage.tsx',
                    kind: 'update',
                    diff: '+ review shell\n- generic shell',
                  },
                ],
              },
              {
                id: 'item_4',
                type: 'commandExecution',
                cwd: '/workspace/ui',
                command: 'pnpm test',
                status: 'completed',
                exit_code: 0,
                aggregated_output: 'PASS CodexPage.test.tsx',
              },
            ],
          },
        ],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
        reasoning_effort: 'medium',
      },
      token_usage: {
        total: {
          total_tokens: 6400,
          input_tokens: 4200,
          cached_input_tokens: 600,
          output_tokens: 1100,
          reasoning_output_tokens: 300,
        },
        last: {
          total_tokens: 1200,
          input_tokens: 800,
          cached_input_tokens: 200,
          output_tokens: 150,
          reasoning_output_tokens: 50,
        },
        model_context_window: 128000,
      },
      pending_requests: [],
      last_applied_seq: 0,
      active_status: 'running',
      active_status_flags: ['finalizing'],
    });
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    expect(host.querySelector('[data-codex-surface="transcript"]')).not.toBeNull();
    expect(host.innerHTML).not.toContain('radial-gradient(circle_at_top');
    expect(host.querySelector('.codex-page-transcript-divider')).toBeNull();
    expect(host.textContent).toContain('Codex page polish review');
    expect(host.textContent).toContain('src/ui/codex/CodexPage.tsx');
    expect(host.textContent).toContain('Command evidence');
    expect(host.textContent).toContain('Finalizing...');
    expect(host.textContent).not.toContain('Prompt ideas');
    expect(host.textContent).not.toContain('Review recent changes');
    expect(host.textContent).not.toContain('Dedicated Codex review shell with isolated thread state.');
    expect(host.textContent).not.toContain('Host ready');
    expect(host.textContent).not.toContain('Updated');
    expect(host.textContent).not.toContain('Responses');
    expect(host.textContent).toContain('GPT-5.4');
    expect(host.textContent).toContain('Effort');
    expect(host.textContent).toContain('Approval');
    expect(host.textContent).toContain('Sandbox');
    expect(host.querySelector('.codex-chat-input-controls')).toBeNull();
    expect(host.querySelector('.codex-chat-input-meta')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Send to Codex"]')).not.toBeNull();
    expect(host.querySelector('button[title="Add attachments"]')).not.toBeNull();
    expect(host.querySelector('.codex-chat-markdown-block')).not.toBeNull();
    expect(host.querySelector('.codex-page-toolbar')).toBeNull();
    expect(host.querySelector('.codex-page-header-context')).not.toBeNull();
    expect(host.textContent).toContain('95% context left');
    expect(host.querySelector('button[aria-label="Refresh Codex thread"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Archive Codex thread"]')).not.toBeNull();
    const workingDirChip = host.querySelector('button[aria-label="Edit working directory"]') as HTMLButtonElement | null;
    expect(workingDirChip?.textContent).toContain('/workspace/ui');
    workingDirChip?.click();
    await flushAsync();
    const workingDirInput = host.querySelector('input[placeholder="Use host default working directory"]') as HTMLInputElement | null;
    expect(workingDirInput?.value).toBe('/workspace/ui');
  });

  it('renders pending request cards inside the Codex dock support lane', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [],
      effective_config: {
        cwd: '/workspace/ui',
      },
      requirements: {
        allowed_approval_policies: ['on-request', 'never'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Approval queue',
        preview: 'Wait for command approval',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'waiting_approval',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Approval queue',
        preview: 'Wait for command approval',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'waiting_approval',
        cwd: '/workspace/ui',
        turns: [],
      },
      runtime_config: {
        cwd: '/workspace/ui',
        model: 'gpt-5.4',
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
      pending_requests: [
        {
          id: 'req_1',
          type: 'command_approval',
          thread_id: 'thread_1',
          turn_id: 'turn_1',
          item_id: 'item_approval',
          reason: 'Need approval to run pnpm lint',
          command: 'pnpm lint',
          cwd: '/workspace/ui',
          available_decisions: ['accept', 'decline'],
        },
      ],
      last_applied_seq: 0,
      active_status: 'waiting_approval',
      active_status_flags: [],
    });
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    expect(host.querySelector('[data-codex-surface="pending-requests"]')).not.toBeNull();
    expect(host.textContent).toContain('Pending Codex requests');
    expect(host.textContent).toContain('Need approval to run pnpm lint');
    expect(host.textContent).toContain('Approve once');
    expect(host.textContent).toContain('Decline');
  });

  it('subscribes once per loaded thread and resumes from the latest known event sequence', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [],
      effective_config: {
        cwd: '/workspace/ui',
      },
      requirements: {
        allowed_approval_policies: ['on-request'],
        allowed_sandbox_modes: ['workspace-write'],
      },
    });
    listCodexThreadsMock.mockResolvedValue([
      {
        id: 'thread_1',
        name: 'Stable stream thread',
        preview: 'Keep the Codex stream stable',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'running',
        cwd: '/workspace/ui',
      },
    ]);
    openCodexThreadMock.mockResolvedValue({
      thread: {
        id: 'thread_1',
        name: 'Stable stream thread',
        preview: 'Keep the Codex stream stable',
        ephemeral: false,
        model_provider: 'gpt-5.4',
        created_at_unix_s: 1,
        updated_at_unix_s: 10,
        status: 'running',
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
      last_applied_seq: 4,
      active_status: 'running',
      active_status_flags: [],
    });
    let delivered = false;
    connectCodexEventStreamMock.mockImplementation(async (args: { onEvent: (event: unknown) => void }) => {
      if (!delivered) {
        delivered = true;
        args.onEvent({
          seq: 5,
          type: 'agent_message_delta',
          thread_id: 'thread_1',
          item_id: 'item_live',
          delta: 'Stream update',
        });
      }
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(connectCodexEventStreamMock).toHaveBeenCalledTimes(1);
    expect(connectCodexEventStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadID: 'thread_1',
        afterSeq: 4,
      }),
    );
    expect(host.textContent).toContain('Stream update');
  });

  it('keeps the transcript pinned to the bottom while live Codex output appends', async () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    let transcriptScrollHeight = 240;
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).getAttribute('data-codex-transcript-scroll-region') === 'true'
          ? transcriptScrollHeight
          : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return (this as HTMLElement).getAttribute('data-codex-transcript-scroll-region') === 'true'
          ? 120
          : 0;
      },
    });

    try {
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
            supports_image_input: true,
            supported_reasoning_efforts: ['medium'],
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
      listCodexThreadsMock.mockResolvedValue([
        {
          id: 'thread_1',
          name: 'Pinned transcript',
          preview: 'Keep Codex transcript pinned while streaming',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'running',
          cwd: '/workspace/ui',
        },
      ]);
      openCodexThreadMock.mockResolvedValue({
        thread: {
          id: 'thread_1',
          name: 'Pinned transcript',
          preview: 'Keep Codex transcript pinned while streaming',
          ephemeral: false,
          model_provider: 'gpt-5.4',
          created_at_unix_s: 1,
          updated_at_unix_s: 10,
          status: 'running',
          cwd: '/workspace/ui',
          turns: [
            {
              id: 'turn_1',
              status: 'running',
              items: [
                {
                  id: 'item_live',
                  type: 'agentMessage',
                  text: 'Streaming output',
                  status: 'inProgress',
                },
              ],
            },
          ],
        },
        runtime_config: {
          cwd: '/workspace/ui',
          model: 'gpt-5.4',
          approval_policy: 'on-request',
          sandbox_mode: 'workspace-write',
          reasoning_effort: 'medium',
        },
        pending_requests: [],
        last_applied_seq: 4,
        active_status: 'running',
        active_status_flags: ['planning'],
      });

      let streamOnEvent: (event: unknown) => void = () => {
        throw new Error('expected event stream subscription to be registered');
      };
      connectCodexEventStreamMock.mockImplementation(async (args: { onEvent: (event: unknown) => void }) => {
        streamOnEvent = args.onEvent;
      });

      const host = document.createElement('div');
      document.body.appendChild(host);

      renderPage(host);

      await flushAsync();
      await flushAsync();

      const scrollRegion = host.querySelector('[data-codex-transcript-scroll-region="true"]') as HTMLDivElement | null;
      expect(scrollRegion).not.toBeNull();
      expect(scrollRegion?.scrollTop).toBe(transcriptScrollHeight);

      transcriptScrollHeight = 360;
      streamOnEvent({
        seq: 5,
        type: 'agent_message_delta',
        thread_id: 'thread_1',
        item_id: 'item_live',
        delta: ' keeps growing',
      });

      await flushAsync();
      await flushAsync();

      expect(scrollRegion?.scrollTop).toBe(transcriptScrollHeight);
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
      } else {
        delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
      }
    }
  });

  it('sends image attachments through the Codex-only turn contract', async () => {
    let streamOnEvent: ((event: any) => void) | null = null;
    const startedDetail = {
      thread: {
        id: 'thread_new',
        name: 'New chat',
        preview: 'Attachment review',
        ephemeral: false,
        model_provider: 'openai',
        created_at_unix_s: 1,
        updated_at_unix_s: 2,
        status: 'running',
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
      token_usage: {
        total: {
          total_tokens: 6400,
          input_tokens: 4200,
          cached_input_tokens: 600,
          output_tokens: 1100,
          reasoning_output_tokens: 300,
        },
        last: {
          total_tokens: 1200,
          input_tokens: 800,
          cached_input_tokens: 200,
          output_tokens: 150,
          reasoning_output_tokens: 50,
        },
        model_context_window: 128000,
      },
      last_applied_seq: 0,
      active_status: 'running',
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
          supports_image_input: true,
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
    listCodexThreadsMock.mockResolvedValue([]);
    startCodexThreadMock.mockResolvedValue(startedDetail);
    openCodexThreadMock.mockResolvedValue(startedDetail);
    startCodexTurnMock.mockResolvedValue(undefined);
    connectCodexEventStreamMock.mockImplementation(async (args: any) => {
      streamOnEvent = args.onEvent;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    const fileInput = host.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!fileInput) {
      throw new Error('attachment input not found');
    }
    const file = new File(['png'], 'screen.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file],
    });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));

    await flushAsync();
    await flushAsync();

    const sendButton = host.querySelector('button[aria-label="Send to Codex"]') as HTMLButtonElement | null;
    if (!sendButton) {
      throw new Error('send button not found');
    }
    sendButton.click();

    await flushAsync();
    await flushAsync();

    expect(startCodexThreadMock).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace/ui',
      model: 'gpt-5.4',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
    }));
    expect(startCodexTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      threadID: 'thread_new',
      cwd: '/workspace/ui',
      model: 'gpt-5.4',
      effort: 'medium',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
      inputs: [
        expect.objectContaining({
          type: 'image',
          name: 'screen.png',
          url: expect.stringContaining('data:image/png;base64,'),
        }),
      ],
    }));
    expect(host.textContent).toContain('Working...');
    expect(host.textContent).toContain('95% context left');
    expect(host.textContent).not.toContain('Codex is working');
    expect(host.querySelector('[data-codex-working-state="true"]')).not.toBeNull();

    if (!streamOnEvent) {
      throw new Error('stream callback not captured');
    }
    const emitStreamEvent = streamOnEvent as (event: any) => void;
    emitStreamEvent({
      seq: 1,
      type: 'thread_name_updated',
      thread_id: 'thread_new',
      thread_name: 'Thread title from Codex',
    });
    await flushAsync();

    expect(host.textContent).toContain('Thread title from Codex');
  });

});
