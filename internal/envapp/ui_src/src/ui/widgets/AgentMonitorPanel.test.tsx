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
    killProcess: vi.fn(),
  },
  sessions: {
    listActiveSessions: vi.fn(),
  },
}));

const notificationMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const envContextMocks = vi.hoisted(() => ({
  openAskFlowerComposer: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => notificationMocks,
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
      openAskFlowerComposer: envContextMocks.openAskFlowerComposer,
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

function makeSnapshot(timestampMs: number, processes: Array<Record<string, unknown>> = []) {
  return {
    cpuUsage: 12.5,
    cpuCores: 8,
    loadAverage: [1, 0.5, 0.25],
    networkBytesReceived: 100,
    networkBytesSent: 200,
    networkSpeedReceived: 10,
    networkSpeedSent: 20,
    platform: 'darwin',
    processes,
    timestampMs,
  };
}

describe('AgentMonitorPanel', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    rpcMocks.monitor.getSysMonitor.mockReset();
    rpcMocks.monitor.killProcess.mockReset();
    rpcMocks.sessions.listActiveSessions.mockReset();
    rpcMocks.sessions.listActiveSessions.mockResolvedValue({ sessions: [] });
    rpcMocks.monitor.killProcess.mockResolvedValue({ ok: true, pid: 4242 });
    notificationMocks.success.mockReset();
    notificationMocks.error.mockReset();
    envContextMocks.openAskFlowerComposer.mockReset();

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

  it('kills a process from the row context menu and refreshes monitoring', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1, [
        { pid: 4242, name: 'node', cpuPercent: 87.3, memoryBytes: 268_435_456, username: 'alice' },
      ]),
    );

    render(() => <AgentMonitorPanel variant="deck" />, host);
    await flushPanel();

    const processRow = host.querySelector('tbody tr') as HTMLTableRowElement | null;
    expect(processRow).toBeTruthy();

    processRow?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPanel();

    const killButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Kill'));
    expect(killButton).toBeTruthy();

    killButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPanel();
    await flushPanel();

    expect(rpcMocks.monitor.killProcess).toHaveBeenCalledWith({ pid: 4242 });
    expect(notificationMocks.success).toHaveBeenCalledWith('Process killed', 'node (PID 4242) was killed.');
    expect(rpcMocks.monitor.getSysMonitor).toHaveBeenCalledTimes(2);
  });

  it('renders Ask Flower before the destructive Kill action in the row context menu', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1, [
        { pid: 4242, name: 'node', cpuPercent: 87.3, memoryBytes: 268_435_456, username: 'alice' },
      ]),
    );

    render(() => <AgentMonitorPanel variant="deck" />, host);
    await flushPanel();

    const processRow = host.querySelector('tbody tr') as HTMLTableRowElement | null;
    expect(processRow).toBeTruthy();

    processRow?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPanel();

    const menu = host.querySelector('[role="menu"]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();

    const menuButtons = Array.from(menu?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    expect(menuButtons).toHaveLength(2);
    expect(menuButtons[0]?.textContent).toContain('Ask Flower');
    expect(menuButtons[1]?.textContent).toContain('Kill');
    expect(menuButtons[1]?.className).toContain('text-destructive');
    expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it('opens Ask Flower from the row context menu with process snapshot context', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1_710_000_000_000, [
        { pid: 313, name: 'python', cpuPercent: 42.5, memoryBytes: 134_217_728, username: 'bob' },
      ]),
    );

    render(() => <AgentMonitorPanel variant="deck" />, host);
    await flushPanel();

    const processRow = host.querySelector('tbody tr') as HTMLTableRowElement | null;
    expect(processRow).toBeTruthy();

    processRow?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 32,
    }));
    await flushPanel();

    const askFlowerButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Ask Flower'));
    expect(askFlowerButton).toBeTruthy();

    askFlowerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPanel();

    expect(envContextMocks.openAskFlowerComposer).toHaveBeenCalledTimes(1);
    expect(envContextMocks.openAskFlowerComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'monitoring',
        contextItems: [
          expect.objectContaining({
            kind: 'process_snapshot',
            pid: 313,
            name: 'python',
            username: 'bob',
            cpuPercent: 42.5,
            memoryBytes: 134_217_728,
            platform: 'darwin',
            capturedAtMs: 1_710_000_000_000,
          }),
        ],
      }),
      { x: 24, y: 32 },
    );
  });
});
