import '../index.css';

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

const runtimeHarness = vi.hoisted(() => ({
  ping: vi.fn(async () => ({
    serverTimeMs: Date.now(),
    version: 'v2.4.0',
    processStartedAtMs: Date.now() - 7_200_000,
    runtimeService: { runtimeVersion: 'v2.4.1' },
  })),
  metrics: vi.fn(async () => ({
    cpuPercent: 8.2,
    memoryBytes: 96 * 1024 * 1024,
    sampledAtMs: Date.now(),
  })),
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({ status: () => 'connected' }),
}));

vi.mock('./protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    sys: { ping: runtimeHarness.ping },
    monitor: { getRuntimeProcessMetrics: runtimeHarness.metrics },
  }),
}));

import { EnvironmentRuntimeStatusTooltip } from './EnvironmentRuntimeStatusTooltip';

async function waitFor<T>(read: () => T | null | undefined, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error('Timed out waiting for browser state');
}

function applyTheme(name: 'classic-light' | 'classic-dark'): void {
  const dark = name === 'classic-dark';
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
  document.documentElement.dataset.floeShellTheme = name;
}

function mountAtBottom(displayName: string) {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '8px';
  host.style.bottom = '8px';
  host.style.maxWidth = '280px';
  document.body.appendChild(host);
  const dispose = render(() => (
    <EnvironmentRuntimeStatusTooltip
      identity={{ source: 'local_runtime', displayName, displayID: 'env_local' }}
      connectionStatus="connected"
      connectionLabel="Connected"
      canRead={true}
      mobile={false}
    />
  ), host);
  return { host, dispose };
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  runtimeHarness.ping.mockClear();
  runtimeHarness.metrics.mockClear();
});

describe('Environment Runtime tooltip browser presentation', () => {
  it.each(['classic-light', 'classic-dark'] as const)('opens upward without clipping in %s', async (theme) => {
    await page.viewport(1280, 800);
    applyTheme(theme);
    const runtime = mountAtBottom('Local Environment');
    try {
      const trigger = runtime.host.querySelector<HTMLElement>('[data-environment-runtime-trigger]')!;
      await userEvent.hover(trigger);
      const tooltip = await waitFor(() => document.body.querySelector<HTMLElement>('[role="tooltip"]'));
      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const style = getComputedStyle(tooltip);

      expect(tooltip.dataset.placement).toBe('top');
      expect(tooltipRect.left).toBeGreaterThanOrEqual(8);
      expect(tooltipRect.top).toBeGreaterThanOrEqual(8);
      expect(tooltipRect.bottom).toBeLessThanOrEqual(triggerRect.top);
      expect(tooltipRect.right).toBeLessThanOrEqual(window.innerWidth - 8);
      expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(tooltip.textContent).toContain('v2.4.1');
      expect(tooltip.textContent).toContain('96 MB');
    } finally {
      runtime.dispose();
    }
  });

  it('clamps a long environment name inside a narrow desktop window', async () => {
    await page.viewport(360, 760);
    applyTheme('classic-dark');
    const runtime = mountAtBottom('Local Environment with an intentionally very long descriptive name');
    try {
      const trigger = runtime.host.querySelector<HTMLElement>('[data-environment-runtime-trigger]')!;
      await userEvent.hover(trigger);
      const tooltip = await waitFor(() => document.body.querySelector<HTMLElement>('[role="tooltip"]'));
      const tooltipRect = tooltip.getBoundingClientRect();
      const name = tooltip.querySelector<HTMLElement>('.environment-runtime-tooltip-name')!;

      expect(tooltipRect.left).toBeGreaterThanOrEqual(8);
      expect(tooltipRect.right).toBeLessThanOrEqual(352);
      expect(tooltipRect.width).toBeLessThanOrEqual(344);
      expect(getComputedStyle(name).textOverflow).toBe('ellipsis');
      expect(name.title).toContain('intentionally very long');
    } finally {
      runtime.dispose();
    }
  });
});
