// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeHarness = vi.hoisted(() => ({
  status: (() => 'connected') as () => string,
  ping: vi.fn(),
  metrics: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ status: runtimeHarness.status }),
}));

vi.mock('./protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    sys: { ping: runtimeHarness.ping },
    monitor: { getRuntimeProcessMetrics: runtimeHarness.metrics },
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
    runtimeHarness.metrics.mockReset().mockImplementation(async () => {
      const sample = metricSample;
      metricSample += 1;
      return {
        cpuPercent: 12.34 + sample,
        memoryBytes: (128 + sample) * 1024 * 1024,
        sampledAtMs: Date.now() + sample,
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
        connectionLabel="Connected"
        canRead={props.canRead ?? true}
        mobile={props.mobile ?? false}
      />
    ), host);
  }

  it('loads on hover, formats details, refreshes metrics only, and stops after leave', async () => {
    const dispose = mount();
    try {
      expect(runtimeHarness.ping).not.toHaveBeenCalled();
      expect(runtimeHarness.metrics).not.toHaveBeenCalled();

      const tooltip = await openTooltip(host);
      expect(tooltip).toBeTruthy();
      expect(tooltip.getAttribute('data-placement')).toBe('top');
      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('v2.4.1');
      expect(tooltip.querySelector('[data-runtime-started]')?.textContent).toContain('1 hour ago');
      expect(tooltip.querySelector('[data-runtime-cpu]')?.textContent).toBe('12.3%');
      expect(tooltip.querySelector('[data-runtime-memory]')?.textContent).toBe('128 MB');
      expect(runtimeHarness.ping).toHaveBeenCalledTimes(1);
      expect(runtimeHarness.metrics).toHaveBeenCalledTimes(1);
      expect(tooltip.querySelector('[data-runtime-sparkline="cpu"]')?.getAttribute('data-sample-count')).toBe('1');
      expect(tooltip.querySelector('[data-runtime-sparkline="memory"]')?.getAttribute('data-sample-count')).toBe('1');

      const trigger = host.querySelector<HTMLElement>('[data-environment-runtime-trigger]')!;
      trigger.click();
      await flushPromises();
      expect(document.body.querySelector('[role="tooltip"]')).toBe(tooltip);

      vi.advanceTimersByTime(2_000);
      await flushPromises();
      expect(runtimeHarness.ping).toHaveBeenCalledTimes(1);
      expect(runtimeHarness.metrics).toHaveBeenCalledTimes(2);
      expect(tooltip.querySelector('[data-runtime-sparkline="cpu"]')?.getAttribute('data-sample-count')).toBe('2');
      expect(tooltip.querySelector('[data-runtime-sparkline="cpu"] .environment-runtime-sparkline-line')?.getAttribute('d')).toContain('L');

      const anchor = host.querySelector<HTMLElement>('[data-redeven-tooltip-anchor]')!;
      trigger.dispatchEvent(new MouseEvent('mouseleave'));
      anchor.dispatchEvent(new MouseEvent('mouseleave'));
      vi.advanceTimersByTime(4_000);
      await flushPromises();
      expect(runtimeHarness.metrics).toHaveBeenCalledTimes(2);
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
      expect(runtimeHarness.metrics).toHaveBeenCalledTimes(1);

      trigger.blur();
      await flushPromises();
      vi.advanceTimersByTime(4_000);
      await flushPromises();
      expect(runtimeHarness.metrics).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
    }
  });

  it('keeps ping details visible when metrics fail and explains the local degradation', async () => {
    runtimeHarness.metrics.mockRejectedValue(new Error('runtime process metrics unavailable'));
    const dispose = mount();
    try {
      const tooltip = await openTooltip(host);
      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('v2.4.1');
      expect(tooltip.textContent).toContain('Runtime usage is temporarily unavailable.');
      expect(tooltip.querySelector('[data-runtime-cpu]')?.textContent).toBe('Unavailable');
    } finally {
      dispose();
    }
  });

  it('does not request metrics without read permission', async () => {
    const dispose = mount({ canRead: false });
    try {
      const tooltip = await openTooltip(host);
      expect(runtimeHarness.ping).toHaveBeenCalledTimes(1);
      expect(runtimeHarness.metrics).not.toHaveBeenCalled();
      expect(tooltip.textContent).toContain('Read permission is required to view usage.');
    } finally {
      dispose();
    }
  });

  it('ignores late responses after the connection changes', async () => {
    let resolvePing!: (value: unknown) => void;
    runtimeHarness.ping.mockReturnValue(new Promise((resolve) => { resolvePing = resolve; }));
    const dispose = mount();
    try {
      const tooltip = await openTooltip(host);
      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('Loading...');

      setProtocolStatus('connecting');
      setConnectionStatus('connecting');
      await flushPromises();
      resolvePing({ serverTimeMs: Date.now(), version: 'stale-version', processStartedAtMs: Date.now() });
      await flushPromises();

      expect(tooltip.querySelector('[data-runtime-version]')?.textContent).toBe('Unavailable');
      expect(tooltip.textContent).toContain('Connect to the Runtime to load details.');
      expect(tooltip.textContent).not.toContain('stale-version');
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
      expect(runtimeHarness.metrics).not.toHaveBeenCalled();
      expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
    } finally {
      dispose();
    }
  });
});
