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
    Code: Icon,
    FileText: Icon,
    Refresh: Icon,
    Terminal: Icon,
    Trash: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: () => null,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
  Input: (props: any) => (
    <input
      value={props.value ?? ''}
      placeholder={props.placeholder}
      onInput={(event) => props.onInput?.(event)}
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
  it('drives the active thread shown in the main Codex page', async () => {
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
            items: [
              {
                id: `${threadID}_item_1`,
                type: 'agentMessage',
                text: threadID === 'thread_1' ? 'Gateway note' : 'Polish note',
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

    expect(host.textContent).toContain('Backend audit');

    const target = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('UI polish'));
    if (!target) {
      throw new Error('UI polish thread button not found');
    }
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await flushAsync();
    await flushAsync();

    expect(openCodexThreadMock).toHaveBeenCalledWith('thread_2');
    expect(host.textContent).toContain('Align the Codex shell with floe-webapp');
    expect(host.textContent).toContain('UI polish');
  });
});
