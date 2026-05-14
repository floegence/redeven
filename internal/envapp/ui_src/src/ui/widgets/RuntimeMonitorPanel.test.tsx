// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeMonitorPanel } from './RuntimeMonitorPanel';

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

const clipboardMocks = vi.hoisted(() => ({
  writeText: vi.fn(),
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
  SurfaceFloatingLayer: (props: any) => {
    const { children, layerRef, position, class: className, style, ...rest } = props;
    return (
      <div
        ref={layerRef}
        class={className}
        style={{
          ...(style ?? {}),
          left: `${position?.x ?? 0}px`,
          top: `${position?.y ?? 0}px`,
        }}
        data-floe-local-interaction-surface="true"
        {...rest}
      >
        {children}
      </div>
    );
  },
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

describe('RuntimeMonitorPanel', () => {
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
    clipboardMocks.writeText.mockReset();
    clipboardMocks.writeText.mockResolvedValue(undefined);
    envContextMocks.openAskFlowerComposer.mockReset();

    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardMocks.writeText,
      },
    });

    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    vi.useRealTimers();
  });

  it('scopes runtime monitor styles on the panel root', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(makeSnapshot(1));

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
    await flushPanel();

    expect(host.firstElementChild?.className).toContain('runtime-monitor-panel');
  });

  it('prevents overlapping polling requests while coalescing a trailing refresh', async () => {
    const first = createDeferred<ReturnType<typeof makeSnapshot>>();

    rpcMocks.monitor.getSysMonitor
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(makeSnapshot(2));

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
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

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
    await flushPanel();

    expect(host.textContent).toContain('Transport');
    expect(host.textContent).toContain('Direct (no tunnel)');
  });

  it('hides current env app RPC and legacy proxy sessions by default', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(makeSnapshot(1));
    rpcMocks.sessions.listActiveSessions.mockResolvedValue({
      sessions: [
        {
          channelId: 'ch-env-rpc',
          userPublicID: 'user_env',
          userEmail: 'env@example.com',
          floeApp: 'com.floegence.redeven.agent',
          codeSpaceID: 'env-ui',
          sessionKind: 'envapp_rpc',
          tunnelUrl: '',
          createdAtUnixMs: 1,
          connectedAtUnixMs: 3,
          canRead: true,
          canWrite: false,
          canExecute: true,
        },
        {
          channelId: 'ch-env-proxy',
          userPublicID: 'user_env',
          userEmail: 'env@example.com',
          floeApp: 'com.floegence.redeven.agent',
          codeSpaceID: 'env-ui',
          sessionKind: 'envapp_proxy',
          tunnelUrl: '',
          createdAtUnixMs: 1,
          connectedAtUnixMs: 2,
          canRead: true,
          canWrite: false,
          canExecute: true,
        },
        {
          channelId: 'ch-code',
          userPublicID: 'user_code',
          userEmail: 'code@example.com',
          floeApp: 'com.floegence.redeven.code',
          codeSpaceID: 'code-1',
          sessionKind: 'codeapp',
          tunnelUrl: '',
          createdAtUnixMs: 1,
          connectedAtUnixMs: 1,
          canRead: true,
          canWrite: true,
          canExecute: true,
        },
      ],
    });

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
    await flushPanel();

    expect(host.textContent).toContain('Show internal (2)');
    expect(host.textContent).toContain('ch-code');
    expect(host.textContent).not.toContain('ch-env-rpc');
    expect(host.textContent).not.toContain('ch-env-proxy');

    const showInternalButton = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Show internal')
    );
    expect(showInternalButton).toBeTruthy();
    showInternalButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPanel();

    expect(host.textContent).toContain('ch-env-rpc');
    expect(host.textContent).toContain('ch-env-proxy');
  });

  it('kills a process from the row context menu and refreshes monitoring', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1, [
        { pid: 4242, name: 'node', cpuPercent: 87.3, memoryBytes: 268_435_456, username: 'alice' },
      ]),
    );

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
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

  it('keeps the workbench process context menu inside the local surface host', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1, [
        { pid: 4242, name: 'node', cpuPercent: 87.3, memoryBytes: 268_435_456, username: 'alice' },
      ]),
    );

    render(() => (
      <div data-floe-dialog-surface-host="true">
        <RuntimeMonitorPanel variant="workbench" />
      </div>
    ), host);
    await flushPanel();

    const surfaceHost = host.querySelector('[data-floe-dialog-surface-host="true"]') as HTMLDivElement | null;
    const processRow = host.querySelector('tbody tr') as HTMLTableRowElement | null;
    expect(surfaceHost).toBeTruthy();
    expect(processRow).toBeTruthy();

    processRow?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 56,
    }));
    await flushPanel();

    const menu = surfaceHost?.querySelector('[role="menu"]') as HTMLDivElement | null;
    const askFlowerButton = Array.from(menu?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('Ask Flower')
    ) as HTMLButtonElement | undefined;
    expect(menu).toBeTruthy();
    expect(menu?.getAttribute('data-floe-local-interaction-surface')).toBe('true');
    expect(askFlowerButton).toBeTruthy();
  });

  it('shows a persistent selected state when a process row is clicked', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1, [
        { pid: 1001, name: 'node', cpuPercent: 20.1, memoryBytes: 134_217_728, username: 'alice' },
        { pid: 1002, name: 'vite', cpuPercent: 15.4, memoryBytes: 67_108_864, username: 'bob' },
      ]),
    );

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
    await flushPanel();

    const processRows = Array.from(
      host.querySelectorAll('tr[data-monitor-process-selected]'),
    ) as HTMLTableRowElement[];
    expect(processRows).toHaveLength(2);

    processRows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPanel();

    let selectedRows = Array.from(
      host.querySelectorAll('tr[data-monitor-process-selected]'),
    ) as HTMLTableRowElement[];

    expect(selectedRows[0]?.getAttribute('data-monitor-process-selected')).toBe('true');
    expect(selectedRows[1]?.getAttribute('data-monitor-process-selected')).toBe('false');

    selectedRows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPanel();

    selectedRows = Array.from(
      host.querySelectorAll('tr[data-monitor-process-selected]'),
    ) as HTMLTableRowElement[];

    expect(selectedRows[0]?.getAttribute('data-monitor-process-selected')).toBe('false');
    expect(selectedRows[1]?.getAttribute('data-monitor-process-selected')).toBe('true');
  });

  it('renders Ask Flower before the destructive Kill action in the row context menu', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1, [
        { pid: 4242, name: 'node', cpuPercent: 87.3, memoryBytes: 268_435_456, username: 'alice' },
      ]),
    );

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
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
    expect(menuButtons).toHaveLength(4);
    expect(menuButtons[0]?.textContent).toContain('Ask Flower');
    expect(menuButtons[1]?.textContent).toContain('Copy name');
    expect(menuButtons[2]?.textContent).toContain('Copy PID');
    expect(menuButtons[3]?.textContent).toContain('Kill');
    expect(menuButtons[3]?.className).toContain('text-destructive');
    expect(menu?.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it('copies process name and pid from the row context menu', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1, [
        { pid: 4242, name: 'node', cpuPercent: 87.3, memoryBytes: 268_435_456, username: 'alice' },
      ]),
    );

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
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

    const copyNameButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Copy name'));
    expect(copyNameButton).toBeTruthy();
    copyNameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPanel();

    expect(clipboardMocks.writeText).toHaveBeenNthCalledWith(1, 'node');
    expect(notificationMocks.success).toHaveBeenNthCalledWith(1, 'Copied', 'Process name copied to clipboard');

    processRow?.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 44,
      clientY: 60,
    }));
    await flushPanel();

    const copyPidButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Copy PID'));
    expect(copyPidButton).toBeTruthy();
    copyPidButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPanel();

    expect(clipboardMocks.writeText).toHaveBeenNthCalledWith(2, '4242');
    expect(notificationMocks.success).toHaveBeenNthCalledWith(2, 'Copied', 'Process PID copied to clipboard');
  });

  it('opens Ask Flower from the row context menu with process snapshot context', async () => {
    rpcMocks.monitor.getSysMonitor.mockResolvedValue(
      makeSnapshot(1_710_000_000_000, [
        { pid: 313, name: 'python', cpuPercent: 42.5, memoryBytes: 134_217_728, username: 'bob' },
      ]),
    );

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
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

    render(() => <RuntimeMonitorPanel variant="deck" />, host);
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
