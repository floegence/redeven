// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvContext } from '../pages/EnvContext';
import { CodexPage } from './CodexPage';

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
  useNotification: () => notification,
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = () => <span />;
  return {
    Code: Icon,
    FileText: Icon,
    Pencil: Icon,
    Refresh: Icon,
    Terminal: Icon,
    Trash: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => <div>{props.label}</div>,
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

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('CodexPage', () => {
  it('shows setup guidance and opens the dedicated Codex settings section when disabled', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      enabled: false,
      ready: false,
      approval_policy: 'on_request',
      sandbox_mode: 'workspace_write',
      agent_home_dir: '/workspace',
    });
    listCodexThreadsMock.mockResolvedValue([]);

    const openSettings = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

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
          openSettings,
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
        <CodexPage />
      </EnvContext.Provider>
    ), host);

    await flushAsync();

    expect(host.textContent).toContain('Codex is disabled');
    expect(host.textContent).toContain('Open Codex Settings');

    const button = Array.from(host.querySelectorAll('button')).find((node) => node.textContent?.includes('Open Codex Settings'));
    if (!button) {
      throw new Error('Open Codex Settings button not found');
    }
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openSettings).toHaveBeenCalledWith('codex');
  });
});
