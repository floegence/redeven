// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentMonitorPanel } from './AgentMonitorPanel';

type deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const rpcMocks = vi.hoisted(() => ({
  monitor: {
    getSysMonitor: vi.fn(),
  },
  sessions: {
    listActiveSessions: vi.fn(),
  },
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (props.visible ? <div>{props.message}</div> : null),
}));

vi.mock('@floegence/floe-webapp-core/layout', () => ({
  Panel: (props: any) => <div>{props.children}</div>,
  PanelContent: (props: any) => <div>{props.children}</div>,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  MonitoringChart: () => <div data-testid="chart" />,
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: () => ({ id: 'protocol-client' }),
    status: () => 'connected',
  }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => rpcMocks,
}));

vi.mock('../pages/EnvContext', () => {
  const envAccessor = Object.assign(
    () => ({ permissions: { can_execute: true } }),
    { state: 'ready' },
  );

  return {
    useEnvContext: () => ({
      env: envAccessor,
    }),
  };
});

vi.mock('../utils/permission', () => ({
  isPermissionDeniedError: () => false,
}));

vi.mock('./PermissionEmptyState', () => ({
  PermissionEmptyState: () => <div>Permission denied</div>,
}));

async function flushPanel() {
  await Promise.resolve();
  await Promise.resolve();
}

function makeSnapshot(timestampMs: number) {
  return {
    cpuUsage: 12.5,
    cpuCores: 8,
    loadAverage: [1, 0.5, 0.25],
    networkBytesReceived: 100,
    networkBytesSent: 200,
    networkSpeedReceived: 10,
    networkSpeedSent: 20,
    platform: 'darwin',
    processes: [],
    timestampMs,
  };
}

describe('AgentMonitorPanel', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    rpcMocks.monitor.getSysMonitor.mockReset();
    rpcMocks.sessions.listActiveSessions.mockReset();
    rpcMocks.sessions.listActiveSessions.mockResolvedValue({ sessions: [] });

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    vi.useRealTimers();
  });

  it('prevents overlapping polling requests while coalescing a trailing refresh', async () => {
    const first = createDeferred<ReturnType<typeof makeSnapshot>>();

    rpcMocks.monitor.getSysMonitor
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(makeSnapshot(2));

    render(() => <AgentMonitorPanel variant="deck" />, host);
    await flushPanel();

    expect(rpcMocks.monitor.getSysMonitor).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    await flushPanel();
    await vi.advanceTimersByTimeAsync(2000);
    await flushPanel();

    expect(rpcMocks.monitor.getSysMonitor).toHaveBeenCalledTimes(1);

    first.resolve(makeSnapshot(1));
    await flushPanel();
    await flushPanel();

    expect(rpcMocks.monitor.getSysMonitor).toHaveBeenCalledTimes(2);
  });
});
