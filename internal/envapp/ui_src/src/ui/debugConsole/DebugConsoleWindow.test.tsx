// @vitest-environment jsdom

import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DebugConsoleWindow } from './DebugConsoleWindow';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

vi.mock('../widgets/PersistentFloatingWindow', () => ({
  PersistentFloatingWindow: (props: any) => (
    <Show when={props.open}>
      <div data-testid="floating-window">
        <div>{props.title}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    </Show>
  ),
}));

vi.mock('../pages/settings/SettingsPrimitives', () => ({
  SettingsPill: (props: any) => <span>{props.children}</span>,
}));

function createController(overrides: Record<string, unknown> = {}) {
  const [serverEvents] = createSignal([
    {
      created_at: '2026-03-27T10:00:02Z',
      source: 'agent',
      scope: 'gateway_api',
      kind: 'request',
      trace_id: 'trace-1',
      method: 'GET',
      path: '/_redeven_proxy/api/settings',
      status_code: 200,
      duration_ms: 16,
      message: 'gateway request completed',
      detail: { local_ui: true },
    },
  ]);
  const [traces] = createSignal([
    {
      key: 'trace-1',
      trace_id: 'trace-1',
      title: 'GET /_redeven_proxy/api/settings',
      status_code: 200,
      max_duration_ms: 16,
      total_duration_ms: 16,
      slow: false,
      first_seen_at: '2026-03-27T10:00:02Z',
      last_seen_at: '2026-03-27T10:00:02Z',
      scopes: ['gateway_api'],
      sources: ['agent'],
      events: serverEvents(),
    },
  ]);
  const [performanceSnapshot] = createSignal({
    collecting: true,
    fps: { current: 60, average: 58, low: 48, samples: 3 },
    long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
    layout_shift: { count: 0, total_score: 0, max_score: 0 },
    paints: {},
    navigation: {},
    recent_events: [],
    supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false },
  });

  return {
    settingsLoaded: () => true,
    configured: () => ({ enabled: true, collect_ui_metrics: true }),
    enabled: () => true,
    open: () => true,
    minimized: () => false,
    restore: vi.fn(),
    minimize: vi.fn(),
    loading: () => false,
    refreshing: () => false,
    runtimeEnabled: () => true,
    collectUIMetrics: () => true,
    settingsError: () => null,
    snapshotError: () => null,
    streamConnected: () => true,
    streamError: () => null,
    stateDir: () => '/tmp/redeven',
    lastSnapshotAt: () => '2026-03-27T10:00:03Z',
    lastEventAt: () => serverEvents()[0]?.created_at ?? '',
    captureCutoffAt: () => '',
    serverEvents,
    stats: () => ({ total_events: 1, agent_events: 1, desktop_events: 0, slow_events: 0, trace_count: 1 }),
    slowSummary: () => [],
    traces,
    performanceSnapshot,
    exporting: () => false,
    lastExportAt: () => '',
    refresh: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    exiting: () => false,
    exitConsole: vi.fn(async () => undefined),
    exportBundle: vi.fn(async () => ({
      exported_at: '2026-03-27T10:00:05Z',
      settings: { enabled: true, collect_ui_metrics: true },
      runtime: {
        configured_enabled: true,
        runtime_enabled: true,
        collect_ui_metrics: true,
        stream_connected: true,
        state_dir: '/tmp/redeven',
      },
      diagnostics: {
        enabled: true,
        state_dir: '/tmp/redeven',
        exported_at: '2026-03-27T10:00:05Z',
        snapshot: {
          recent_events: [],
          slow_summary: [],
          stats: { total_events: 1, agent_events: 1, desktop_events: 0, slow_events: 0, trace_count: 1 },
        },
        agent_events: [],
        desktop_events: [],
      },
      ui_performance: {
        collecting: true,
        fps: { current: 60, average: 58, low: 48, samples: 3 },
        long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
        layout_shift: { count: 0, total_score: 0, max_score: 0 },
        paints: {},
        navigation: {},
        recent_events: [],
        supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false },
      },
    })),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DebugConsoleWindow', () => {
  it('renders the request details inside the floating window', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = createController();

    render(() => <DebugConsoleWindow controller={controller} />, host);

    expect(host.textContent).toContain('Debug Console');
    expect(host.textContent).toContain('GET /_redeven_proxy/api/settings');
    expect(host.textContent).toContain('gateway request completed');
    expect(host.textContent).toContain('Detail JSON');
    expect(host.textContent).toContain('Clear');
    expect(host.textContent).not.toContain('Refresh');
    expect(host.textContent).toContain('Exit Debug Mode');
    expect(host.textContent).toContain('Static CSS, JS, document loads, and diagnostics self-requests are excluded');
    expect(host.textContent).not.toContain('Continuous');
  });

  it('invokes clear from the header action', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const clear = vi.fn(async () => undefined);
    const controller = createController({ clear });

    render(() => <DebugConsoleWindow controller={controller} />, host);

    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Clear'));
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('invokes exit debug mode from the header action', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const exitConsole = vi.fn(async () => undefined);
    const controller = createController({ exitConsole });

    render(() => <DebugConsoleWindow controller={controller} />, host);

    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Exit Debug Mode'));
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(exitConsole).toHaveBeenCalledTimes(1);
  });

  it('shows a restore pill when minimized', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const controller = createController({ open: () => false, minimized: () => true });

    render(() => <DebugConsoleWindow controller={controller} />, host);

    expect(host.textContent).toContain('Debug Console');
    expect(host.textContent).toContain('Live');
  });
});
