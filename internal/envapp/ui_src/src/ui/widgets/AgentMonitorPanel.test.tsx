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
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
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

  it('renders direct transport for sessions without tunnel endpoint URL', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(makeSnapshot(1));
    rpcMocks.sessions.listActiveSessions.mockResolvedValue({
      sessions: [{
        channelId: 'ch-direct',
        userPublicID: 'user_1',
        userEmail: 'user@example.com',
        floeApp: 'com.floegence.redeven.agent',
        codeSpaceID: '',
        sessionKind: 'local_access_resume',
        tunnelUrl: '',
        createdAtUnixMs: 1,
        connectedAtUnixMs: 2,
        canRead: true,
        canWrite: true,
        canExecute: true,
      }],
    });

    render(() => <AgentMonitorPanel variant="deck" />, host);
    await flushPanel();

    expect(host.textContent).toContain('Transport');
    expect(host.textContent).toContain('Direct (no tunnel)');
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

  it('applies semantic severity tones to CPU and memory cells', async () => {
    const gibibyte = 1024 ** 3;

    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1, [
        { pid: 101, name: 'idle', cpuPercent: 9.4, memoryBytes: 512 * 1024 * 1024, username: 'system' },
        { pid: 102, name: 'worker', cpuPercent: 33.3, memoryBytes: 2 * gibibyte, username: 'alice' },
        { pid: 103, name: 'compiler', cpuPercent: 78.8, memoryBytes: 12 * gibibyte, username: 'bob' },
        { pid: 104, name: 'render', cpuPercent: 132.1, memoryBytes: 256 * 1024 * 1024, username: 'carol' },
      ]),
    );

    render(() => <AgentMonitorPanel variant="deck" />, host);
    await flushPanel();

    const getProcessRow = (name: string) => Array.from(host.querySelectorAll('tbody tr')).find((row) => row.textContent?.includes(name)) as HTMLTableRowElement | undefined;

    const idleRow = getProcessRow('idle');
    const workerRow = getProcessRow('worker');
    const compilerRow = getProcessRow('compiler');
    const renderRow = getProcessRow('render');

    expect(idleRow?.querySelector('[data-monitor-metric="cpu"]')?.getAttribute('data-monitor-metric-tone')).toBe('muted');
    expect(idleRow?.querySelector('[data-monitor-metric="cpu"]')?.className).toContain('text-muted-foreground');
    expect(idleRow?.querySelector('[data-monitor-metric="memory"]')?.getAttribute('data-monitor-metric-tone')).toBe('muted');
    expect(idleRow?.querySelector('[data-monitor-metric="memory"]')?.className).toContain('text-muted-foreground');

    expect(workerRow?.querySelector('[data-monitor-metric="cpu"]')?.getAttribute('data-monitor-metric-tone')).toBe('success');
    expect(workerRow?.querySelector('[data-monitor-metric="cpu"]')?.className).toContain('text-success');
    expect(workerRow?.querySelector('[data-monitor-metric="memory"]')?.getAttribute('data-monitor-metric-tone')).toBe('success');
    expect(workerRow?.querySelector('[data-monitor-metric="memory"]')?.className).toContain('text-success');

    expect(compilerRow?.querySelector('[data-monitor-metric="cpu"]')?.getAttribute('data-monitor-metric-tone')).toBe('warning');
    expect(compilerRow?.querySelector('[data-monitor-metric="cpu"]')?.className).toContain('text-warning');
    expect(compilerRow?.querySelector('[data-monitor-metric="memory"]')?.getAttribute('data-monitor-metric-tone')).toBe('warning');
    expect(compilerRow?.querySelector('[data-monitor-metric="memory"]')?.className).toContain('text-warning');

    expect(renderRow?.querySelector('[data-monitor-metric="cpu"]')?.getAttribute('data-monitor-metric-tone')).toBe('error');
    expect(renderRow?.querySelector('[data-monitor-metric="cpu"]')?.className).toContain('text-error');
    expect(renderRow?.querySelector('[data-monitor-metric="memory"]')?.getAttribute('data-monitor-metric-tone')).toBe('muted');
    expect(renderRow?.querySelector('[data-monitor-metric="memory"]')?.className).toContain('text-muted-foreground');
  });
});
