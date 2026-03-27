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
      detail: {
        transport: 'browser_fetch',
        request: {
          url: 'http://localhost/_redeven_proxy/api/settings?tab=debug',
          content_type: 'application/json',
          payload_kind: 'json',
          payload: {
            debug_console: {
              enabled: true,
            },
          },
        },
        response: {
          status: 200,
          status_text: 'OK',
          content_type: 'application/json',
          payload_kind: 'json',
          payload: {
            settings: {
              debug_console: {
                enabled: true,
              },
            },
          },
        },
      },
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
  const [performanceSnapshot, setPerformanceSnapshot] = createSignal({
    collecting: true,
    supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false, mutation_observer: true, interaction_latency: true },
    fps: { current: 60, average: 58, low: 48, samples: 3 },
    frame_timing: { long_frame_count: 2, max_frame_ms: 78, last_frame_ms: 22 },
    interactions: { count: 3, last_type: 'pointerdown', last_paint_delay_ms: 18, max_paint_delay_ms: 42 },
    dom_activity: {
      mutation_batches: 4,
      mutation_records: 27,
      nodes_added: 6,
      nodes_removed: 2,
      attributes_changed: 11,
      text_changed: 8,
      max_batch_records: 14,
      last_mutation_at: '2026-03-27T10:00:03Z',
    },
    long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
    layout_shift: { count: 0, total_score: 0, max_score: 0 },
    paints: {},
    navigation: {},
    recent_events: [],
  });

  const controller = {
    enabled: () => true,
    open: () => true,
    minimized: () => false,
    show: vi.fn(),
    restore: vi.fn(),
    minimize: vi.fn(),
    loading: () => false,
    refreshing: () => false,
    runtimeEnabled: () => true,
    collectUIMetrics: () => true,
    uiMetricsCollecting: () => true,
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
    closeConsole: vi.fn(async () => undefined),
    resetRuntimeState: vi.fn(),
    exportBundle: vi.fn(async () => ({
      exported_at: '2026-03-27T10:00:05Z',
      ui_state: { visible: true, minimized: false },
      runtime: {
        diagnostics_enabled: true,
        ui_metrics_enabled: true,
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
        supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false, mutation_observer: true, interaction_latency: true },
        fps: { current: 60, average: 58, low: 48, samples: 3 },
        frame_timing: { long_frame_count: 2, max_frame_ms: 78, last_frame_ms: 22 },
        interactions: { count: 3, last_type: 'pointerdown', last_paint_delay_ms: 18, max_paint_delay_ms: 42 },
        dom_activity: {
          mutation_batches: 4,
          mutation_records: 27,
          nodes_added: 6,
          nodes_removed: 2,
          attributes_changed: 11,
          text_changed: 8,
          max_batch_records: 14,
          last_mutation_at: '2026-03-27T10:00:03Z',
        },
        long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
        layout_shift: { count: 0, total_score: 0, max_score: 0 },
        paints: {},
        navigation: {},
        recent_events: [],
      },
    })),
    ...overrides,
  };

  return {
    controller,
    setPerformanceSnapshot,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('DebugConsoleWindow', () => {
  it('renders the request details inside the floating window', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { controller } = createController();

    render(() => <DebugConsoleWindow controller={controller} />, host);

    expect(host.textContent).toContain('Debug Console');
    expect(host.textContent).toContain('GET http://localhost/_redeven_proxy/api/settings?tab=debug');
    expect(host.textContent).toContain('gateway request completed');
    expect(host.textContent).toContain('Request payload');
    expect(host.textContent).toContain('Response payload');
    expect(host.textContent).toContain('Clear');
    expect(host.textContent).not.toContain('Refresh');
    expect(host.textContent).toContain('Close Console');
    expect(host.textContent).toContain('Static CSS, JS, document loads, and diagnostics self-requests are excluded');

    const uiTab = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('UI Performance'));
    expect(uiTab).toBeTruthy();
    uiTab?.click();

    expect(host.textContent).toContain('Renderer probes');
  });

  it('invokes clear from the header action', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const clear = vi.fn(async () => undefined);
    const { controller } = createController({ clear });

    render(() => <DebugConsoleWindow controller={controller} />, host);

    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Clear'));
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('invokes close console from the header action', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const closeConsole = vi.fn(async () => undefined);
    const { controller } = createController({ closeConsole });

    render(() => <DebugConsoleWindow controller={controller} />, host);

    const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Close Console'));
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(closeConsole).toHaveBeenCalledTimes(1);
  });

  it('shows a restore pill when minimized', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { controller } = createController({ open: () => false, minimized: () => true });

    render(() => <DebugConsoleWindow controller={controller} />, host);

    expect(host.textContent).toContain('Debug Console');
    expect(host.textContent).toContain('Live');
  });

  it('keeps tab nodes stable across unrelated UI performance updates', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const { controller, setPerformanceSnapshot } = createController();

    render(() => <DebugConsoleWindow controller={controller} />, host);

    const uiTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent?.includes('UI Performance'));
    const tracesTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent?.includes('Traces'));
    expect(uiTab).toBeTruthy();
    expect(tracesTab).toBeTruthy();

    uiTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(uiTab?.getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain('Renderer probes');

    const tracesTabBefore = tracesTab;
    const uiTabBefore = uiTab;

    setPerformanceSnapshot((current) => ({
      ...current,
      fps: {
        ...current.fps,
        current: 57,
        average: 57,
      },
      frame_timing: {
        ...current.frame_timing,
        last_frame_ms: 19,
      },
    }));

    await Promise.resolve();

    const uiTabAfter = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent?.includes('UI Performance'));
    const tracesTabAfter = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((candidate) => candidate.textContent?.includes('Traces'));

    expect(uiTabAfter).toBe(uiTabBefore);
    expect(tracesTabAfter).toBe(tracesTabBefore);
    expect(uiTabAfter?.getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain('Renderer probes');
  });
});
