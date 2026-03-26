// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvContext } from '../pages/EnvContext';
import { CodexPage } from './CodexPage';
import { CodexProvider } from './CodexProvider';

const fetchCodexStatusMock = vi.fn();
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
        goTab: () => undefined,
        filesSidebarOpen: () => false,
        setFilesSidebarOpen: () => undefined,
        toggleFilesSidebar: () => undefined,
        settingsSeq: () => 1,
        bumpSettingsSeq: () => undefined,
        openSettings: () => undefined,
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
    expect(host.querySelector('button[aria-label="Create chat and send"]')).not.toBeNull();
    expect(host.querySelector('img')).not.toBeNull();
  });

  it('renders the conversation shell, transcript rows, and runtime flags for the active Codex thread', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
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
      pending_requests: [],
      last_event_seq: 0,
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
    expect(host.textContent).toContain('Codex page polish review');
    expect(host.textContent).toContain('src/ui/codex/CodexPage.tsx');
    expect(host.textContent).toContain('Command evidence');
    expect(host.textContent).toContain('finalizing');
    expect(host.textContent).toContain('Prompt ideas');
    expect(host.textContent).not.toContain('Review recent changes');
    expect(host.textContent).not.toContain('Options');
    expect(host.textContent).not.toContain('Review brief');
    expect(host.textContent).not.toContain('Review response');
    expect(host.textContent).not.toContain('Dedicated Codex review shell with isolated thread state.');
    expect(host.textContent).not.toContain('Host ready');
    expect(host.textContent).not.toContain('Updated');
    expect(host.textContent).not.toContain('Responses');
    expect(host.textContent).toContain('/workspace/ui');
    expect(host.querySelector('.codex-chat-input-meta-rail')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Send to Codex"]')).not.toBeNull();
    expect(host.querySelector('.codex-page-toolbar')).toBeNull();
    expect(host.querySelector('.codex-chat-working-dir-chip')?.getAttribute('title')).toBe('/workspace/ui');
    expect(host.querySelector('button[aria-label="Refresh Codex thread"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Archive Codex thread"]')).not.toBeNull();

    const promptIdeasButton = Array.from(host.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Prompt ideas'),
    );
    if (!promptIdeasButton) {
      throw new Error('Prompt ideas button not found');
    }
    promptIdeasButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await flushAsync();

    expect(host.textContent).toContain('Review recent changes');
  });

  it('renders pending request cards inside the Codex dock support lane', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
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
      last_event_seq: 0,
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
      pending_requests: [],
      last_event_seq: 4,
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

  it('applies a composer preset into the Codex textarea', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    listCodexThreadsMock.mockResolvedValue([]);
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderPage(host);

    await flushAsync();
    await flushAsync();

    const promptIdeasButton = Array.from(host.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Prompt ideas'),
    );
    if (!promptIdeasButton) {
      throw new Error('Prompt ideas button not found');
    }
    promptIdeasButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await flushAsync();

    const preset = Array.from(host.querySelectorAll('button')).find((node) =>
      node.textContent?.includes('Review recent changes'),
    );
    if (!preset) {
      throw new Error('Review recent changes preset not found');
    }
    preset.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await flushAsync();

    const textarea = host.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toContain('Review the latest file changes');
  });
});
