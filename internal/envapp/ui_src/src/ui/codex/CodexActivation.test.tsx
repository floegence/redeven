// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CodexPage } from './CodexPage';
import { CodexProvider } from './CodexProvider';

const fetchCodexStatusMock = vi.fn();
const fetchCodexCapabilitiesMock = vi.fn();
const listCodexThreadsMock = vi.fn();
const deferredAfterPaintQueue: Array<() => void> = [];
const viewActivationState = {
  active: true,
  seq: 1,
};

vi.mock('@floegence/floe-webapp-core', () => ({
  deferAfterPaint: (fn: () => void) => {
    deferredAfterPaintQueue.push(fn);
  },
  useNotification: () => ({
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
  useViewActivation: () => ({
    id: 'codex',
    active: () => viewActivationState.active,
    activationSeq: () => viewActivationState.seq,
  }),
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => <div>{props.message}</div>,
}));

vi.mock('../pages/EnvContext', () => ({
  useEnvContext: () => ({
    settingsSeq: () => 1,
  }),
}));

vi.mock('./CodexPageShell', () => ({
  CodexPageShell: () => <div data-testid="codex-shell" />,
}));

vi.mock('./api', () => ({
  CodexGatewayError: class CodexGatewayError extends Error {
    errorCode = '';
    status = 400;
  },
  archiveCodexThread: vi.fn(),
  connectCodexEventStream: vi.fn(async () => undefined),
  fetchCodexCapabilities: (...args: any[]) => fetchCodexCapabilitiesMock(...args),
  fetchCodexStatus: (...args: any[]) => fetchCodexStatusMock(...args),
  forkCodexThread: vi.fn(),
  interruptCodexTurn: vi.fn(),
  listCodexThreads: (...args: any[]) => listCodexThreadsMock(...args),
  markCodexThreadRead: vi.fn(async () => ({
    is_unread: false,
    snapshot: {
      updated_at_unix_s: 0,
    },
    read_state: {
      last_read_updated_at_unix_s: 0,
    },
  })),
  openCodexThread: vi.fn(),
  respondToCodexRequest: vi.fn(),
  startCodexReview: vi.fn(),
  startCodexThread: vi.fn(),
  startCodexTurn: vi.fn(),
  steerCodexTurn: vi.fn(),
}));

function flushAsync(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function flushAfterPaint(): void {
  const queue = deferredAfterPaintQueue.splice(0, deferredAfterPaintQueue.length);
  queue.forEach((callback) => callback());
}

afterEach(() => {
  document.body.innerHTML = '';
  deferredAfterPaintQueue.splice(0, deferredAfterPaintQueue.length);
  fetchCodexStatusMock.mockReset();
  fetchCodexCapabilitiesMock.mockReset();
  listCodexThreadsMock.mockReset();
  viewActivationState.active = true;
  viewActivationState.seq = 1;
});

describe('Codex after-paint activation gating', () => {
  it('waits until after paint before loading status and thread data', async () => {
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });
    fetchCodexCapabilitiesMock.mockResolvedValue({
      models: [],
      effective_config: {
        cwd: '/workspace',
      },
      requirements: null,
    });
    listCodexThreadsMock.mockResolvedValue([]);

    const host = document.createElement('div');
    document.body.append(host);

    const dispose = render(() => (
      <CodexProvider>
        <CodexPage />
      </CodexProvider>
    ), host);

    try {
      await flushAsync();
      expect(fetchCodexStatusMock).not.toHaveBeenCalled();
      expect(listCodexThreadsMock).not.toHaveBeenCalled();

      flushAfterPaint();
      await flushAsync();
      await flushAsync();

      expect(fetchCodexStatusMock).toHaveBeenCalledTimes(1);
      expect(listCodexThreadsMock).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('keeps the provider idle while the Codex view is inactive', async () => {
    viewActivationState.active = false;
    fetchCodexStatusMock.mockResolvedValue({
      available: true,
      ready: true,
      binary_path: '/usr/local/bin/codex',
      agent_home_dir: '/workspace',
    });

    const host = document.createElement('div');
    document.body.append(host);

    const dispose = render(() => (
      <CodexProvider>
        <CodexPage />
      </CodexProvider>
    ), host);

    try {
      await flushAsync();
      flushAfterPaint();
      await flushAsync();

      expect(fetchCodexStatusMock).not.toHaveBeenCalled();
      expect(listCodexThreadsMock).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });
});
