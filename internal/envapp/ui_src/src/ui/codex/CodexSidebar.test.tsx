// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvContext } from '../pages/EnvContext';
import { CodexPage } from './CodexPage';
import { CodexProvider } from './CodexProvider';
import { CodexSidebar } from './CodexSidebar';

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
  LoadingOverlay: () => null,
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
    <button type={props.type ?? 'button'} disabled={props.disabled} onClick={props.onClick}>
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
      pending_requests: [],
      last_event_seq: 0,
      active_status: threadID === 'thread_1' ? 'idle' : 'running',
      active_status_flags: [],
    }));
    connectCodexEventStreamMock.mockResolvedValue(undefined);

    const host = document.createElement('div');
    document.body.appendChild(host);

    renderSurface(host);

    await flushAsync();
    await flushAsync();

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
    expect(host.textContent).toContain('Review recent changes');
    expect(host.textContent).toContain('Send to Codex');
  });
});
