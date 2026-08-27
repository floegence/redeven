// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeHarness = vi.hoisted(() => ({
  status: (() => 'connected') as () => string,
  ping: vi.fn(),
  monitor: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ status: runtimeHarness.status }),
}));

vi.mock('./protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    sys: { ping: runtimeHarness.ping },
    monitor: { getSysMonitor: runtimeHarness.monitor },
  }),
}));

import {
  EnvironmentRuntimeStatusTooltip,
  type EnvironmentRuntimeConnectionStatus,
} from './EnvironmentRuntimeStatusTooltip';

function makeRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function openTooltip(host: HTMLElement): Promise<HTMLElement> {
  const trigger = host.querySelector<HTMLElement>('[data-environment-runtime-trigger]')!;
  const anchor = host.querySelector<HTMLElement>('[data-redeven-tooltip-anchor]')!;
  trigger.dispatchEvent(new MouseEvent('mouseenter'));
  anchor.dispatchEvent(new MouseEvent('mouseenter'));
  await flushPromises();
  vi.advanceTimersByTime(179);
  await flushPromises();
  expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  vi.advanceTimersByTime(1);
  await flushPromises();
  vi.advanceTimersByTime(0);
  await flushPromises();
  return document.body.querySelector<HTMLElement>('[role="tooltip"]')!;
}

describe('EnvironmentRuntimeStatusTooltip', () => {
  let host: HTMLDivElement;
  let setProtocolStatus: (value: string) => void;
  let setConnectionStatus: (value: EnvironmentRuntimeConnectionStatus) => void;
  let connectionStatus: () => EnvironmentRuntimeConnectionStatus;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-27T08:00:00.000Z'));
    const [protocolStatus, updateProtocolStatus] = createSignal('connected');
    [connectionStatus, setConnectionStatus] = createSignal<EnvironmentRuntimeConnectionStatus>('connected');
    setProtocolStatus = updateProtocolStatus;
    runtimeHarness.status = protocolStatus;
    runtimeHarness.ping.mockReset().mockResolvedValue({
      serverTimeMs: Date.now(),
      version: 'v2.4.0',
      processStartedAtMs: Date.now() - 3_600_000,
      runtimeService: { runtimeVersion: 'v2.4.1' },
    });
    let metricSample = 0;
    runtimeHarness.monitor.mockReset().mockImplementation(async () => {
      const sample = metricSample;
      metricSample += 1;
      return {
        cpuUsage: 12.34 + sample,
        memoryUsedBytes: (8 + sample) * 1024 * 1024 * 1024,
        memoryTotalBytes: 16 * 1024 * 1024 * 1024,
        timestampMs: Date.now() + sample,
      };
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
      const element = this as HTMLElement;
      if (element.hasAttribute('data-redeven-tooltip-anchor')) return makeRect(16, 730, 220, 24);
      if (element.getAttribute('role') === 'tooltip') return makeRect(0, 0, 320, 210);
      return makeRect(0, 0, 0, 0);
    });
    vi.stubGlobal('requestAnimationFrame', (((callback: FrameRequestCallback) => window.setTimeout(() => callback(16), 0)) as unknown as typeof requestAnimationFrame));
    vi.stubGlobal('cancelAnimationFrame', (((handle: number) => window.clearTimeout(handle)) as unknown as typeof cancelAnimationFrame));
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  function mount(props: Readonly<{ canRead?: boolean | null; mobile?: boolean }> = {}) {
    return render(() => (
      <EnvironmentRuntimeStatusTooltip
        identity={{ source: 'local_runtime', displayName: 'Local Environment', displayID: 'env_local' }}
        connectionStatus={connectionStatus()}
        connectionLabel={connectionStatus() === 'connected' ? 'Connected' : 'Connecting'}
        runtimeSnapshot={{
          serverTimeMs: Date.now(),
          version: 'v2.4.0',
          processStartedAtMs: Date.now() - 3_600_000,
          runtimeService: {
            runtimeVersion: 'v2.4.1',
            remoteEnabled: false,
            compatibility: 'compatible',
            activeWorkload: { terminalCount: 0, sessionCount: 0, taskCount: 0, portForwardCount: 0 },
          },
        }}
        runtimeSnapshotLoading={false}
        canRead={props.canRead ?? true}
        mobile={props.mobile ?? false}
      />
    ), host);
  }

  it('warms the cached metrics before hover, reuses the existing runtime snapshot, and stops polling after leave', async () => {
    const dispose = mount();
    try {
      await flushPromises();
      expect(runtimeHarness.ping).not.toHaveBeenCalled();
      expect(runtimeHarness.monitor).toHaveBeenCalledTimes(1);

      const tooltip = await openTooltip(host);
      expect(tooltip).toBeTruthy();
      expect(tooltip.getAttribute('data-placement')).toBe('top');
      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('v2.4.1');
      expect(tooltip.querySelector('[data-runtime-started]')?.textContent).toContain('1 hour ago');
      expect(tooltip.querySelector('[data-environment-cpu]')?.textContent).toBe('12.3%');
      expect(tooltip.querySelector('[data-environment-memory]')?.textContent).toBe('8 GB');
      expect(runtimeHarness.ping).not.toHaveBeenCalled();
      expect(runtimeHarness.monitor).toHaveBeenCalledTimes(1);
      expect(tooltip.querySelector('[data-environment-sparkline="cpu"]')?.getAttribute('data-sample-count')).toBe('1');
      expect(tooltip.querySelector('[data-environment-sparkline="memory"]')?.getAttribute('data-sample-count')).toBe('1');

      const trigger = host.querySelector<HTMLElement>('[data-environment-runtime-trigger]')!;
      trigger.click();
      await flushPromises();
      expect(document.body.querySelector('[role="tooltip"]')).toBe(tooltip);

      vi.advanceTimersByTime(2_000);
      await flushPromises();
      expect(runtimeHarness.ping).not.toHaveBeenCalled();
      expect(runtimeHarness.monitor).toHaveBeenCalledTimes(2);
      expect(tooltip.querySelector('[data-environment-sparkline="cpu"]')?.getAttribute('data-sample-count')).toBe('2');
      expect(tooltip.querySelector('[data-environment-sparkline="cpu"] .environment-runtime-sparkline-line')?.getAttribute('d')).toContain('L');

      const anchor = host.querySelector<HTMLElement>('[data-redeven-tooltip-anchor]')!;
      trigger.dispatchEvent(new MouseEvent('mouseleave'));
      anchor.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(4_000);
      await flushPromises();
      expect(runtimeHarness.monitor).toHaveBeenCalledTimes(2);
      expect(trigger.getAttribute('role')).toBeNull();
    } finally {
      dispose();
    }
  });

  it('supports keyboard focus and stops polling after focus leaves', async () => {
    const dispose = mount();
    try {
      const trigger = host.querySelector<HTMLElement>('[data-environment-runtime-trigger]')!;
      trigger.focus();
      await flushPromises();
      vi.advanceTimersByTime(180);
      await flushPromises();
      expect(document.body.querySelector('[role="tooltip"]')).toBeTruthy();
      expect(runtimeHarness.monitor).toHaveBeenCalledTimes(1);

      trigger.blur();
      await flushPromises();
      vi.advanceTimersByTime(4_000);
      await flushPromises();
      expect(runtimeHarness.monitor).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('keeps ping details visible and uses quiet static skeletons when metrics fail', async () => {
    runtimeHarness.monitor.mockRejectedValue(new Error('system monitor unavailable'));
    const dispose = mount();
    try {
      const tooltip = await openTooltip(host);
      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('v2.4.1');
      expect(tooltip.querySelector('[data-environment-cpu]')?.textContent).toBe('');
      expect(tooltip.querySelector('[data-environment-memory]')?.textContent).toBe('');
      expect(tooltip.querySelector('[data-environment-cpu] [data-loading]')?.getAttribute('data-loading')).toBe('false');
      expect(tooltip.querySelector('[data-environment-sparkline="cpu"] [data-loading]')?.getAttribute('data-loading')).toBe('false');
      expect(tooltip.textContent).not.toContain('Unavailable');
      expect(tooltip.textContent).not.toContain('temporarily');
    } finally {
      dispose();
    }
  });

  it('does not request environment metrics without read permission', async () => {
    const dispose = mount({ canRead: false });
    try {
      const tooltip = await openTooltip(host);
      expect(runtimeHarness.ping).not.toHaveBeenCalled();
      expect(runtimeHarness.monitor).not.toHaveBeenCalled();
      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('v2.4.1');
      expect(tooltip.querySelector('[data-environment-cpu]')?.textContent).toBe('');
      expect(tooltip.querySelector('[data-environment-cpu] [data-loading]')?.getAttribute('data-loading')).toBe('false');
      expect(tooltip.textContent).not.toContain('permission');
      vi.advanceTimersByTime(4_000);
      await flushPromises();
      expect(runtimeHarness.ping).not.toHaveBeenCalled();
      expect(runtimeHarness.monitor).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('retains the last valid environment metrics when a refresh fails', async () => {
    runtimeHarness.monitor
      .mockResolvedValueOnce({
        cpuUsage: 31.25,
        memoryUsedBytes: 6 * 1024 * 1024 * 1024,
        memoryTotalBytes: 16 * 1024 * 1024 * 1024,
        timestampMs: Date.now(),
      })
      .mockRejectedValueOnce(new Error('refresh failed'));
    const dispose = mount();
    try {
      const tooltip = await openTooltip(host);
      expect(tooltip.querySelector('[data-environment-cpu]')?.textContent).toBe('31.3%');
      expect(tooltip.querySelector('[data-environment-memory]')?.textContent).toBe('6 GB');

      vi.advanceTimersByTime(2_000);
      await flushPromises();

      expect(runtimeHarness.monitor).toHaveBeenCalledTimes(2);
      expect(tooltip.querySelector('[data-environment-cpu]')?.textContent).toBe('31.3%');
      expect(tooltip.querySelector('[data-environment-memory]')?.textContent).toBe('6 GB');
      expect(tooltip.querySelector('[data-environment-sparkline="cpu"]')?.getAttribute('data-sample-count')).toBe('1');
    } finally {
      dispose();
    }
  });

  it('ignores late metric responses after the connection changes', async () => {
    let resolveMetrics!: (value: unknown) => void;
    runtimeHarness.monitor.mockReturnValue(new Promise((resolve) => { resolveMetrics = resolve; }));
    const dispose = mount();
    try {
      const tooltip = await openTooltip(host);
      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('v2.4.1');
      expect(tooltip.querySelector('[data-environment-cpu]')?.textContent).toBe('');
      expect(tooltip.querySelector('[data-environment-cpu] [data-loading]')?.getAttribute('data-loading')).toBe('true');

      setProtocolStatus('connecting');
      setConnectionStatus('connecting');
      await flushPromises();
      resolveMetrics({
        cpuUsage: 88,
        memoryUsedBytes: 12 * 1024 * 1024 * 1024,
        memoryTotalBytes: 16 * 1024 * 1024 * 1024,
        timestampMs: Date.now(),
      });
      await flushPromises();

      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('');
      expect(tooltip.querySelector('[data-runtime-version] [data-loading]')?.getAttribute('data-loading')).toBe('false');
      expect(tooltip.querySelector('[data-environment-cpu]')?.textContent).toBe('');
      expect(tooltip.textContent).toContain('Connecting');
      expect(tooltip.textContent).not.toContain('88%');
    } finally {
      dispose();
    }
  });

  it('keeps the compact mobile identity non-focusable and never starts requests', async () => {
    const dispose = mount({ mobile: true });
    try {
      const trigger = host.querySelector<HTMLElement>('[data-environment-runtime-trigger]')!;
      const anchor = host.querySelector<HTMLElement>('[data-redeven-tooltip-anchor]')!;
      expect(trigger.getAttribute('tabindex')).toBeNull();
      expect(anchor.getAttribute('data-redeven-tooltip-disabled')).toBe('true');

      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      anchor.dispatchEvent(new MouseEvent('mouseenter'));
      vi.advanceTimersByTime(4_000);
      await flushPromises();
      expect(runtimeHarness.ping).not.toHaveBeenCalled();
      expect(runtimeHarness.monitor).not.toHaveBeenCalled();
      expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      dispose();
    }
  });
});
