// @vitest-environment jsdom

import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDebugConsoleController } from './createDebugConsoleController';

function tick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function buildSettings(enabled: boolean, collectUIMetrics = false) {
  return {
    config_path: '/tmp/redeven/config.json',
    connection: {
      controlplane_base_url: 'https://example.invalid',
      environment_id: 'env_123',
      agent_instance_id: 'agent_123',
      direct: {
        ws_url: 'wss://example.invalid/ws',
        channel_id: 'ch_123',
        channel_init_expire_at_unix_s: 1,
        default_suite: 1,
        e2ee_psk_set: true,
      },
    },
    runtime: {
      agent_home_dir: '/workspace',
      shell: '/bin/bash',
    },
    logging: {
      log_format: 'json',
      log_level: 'info',
    },
    debug_console: {
      enabled,
      collect_ui_metrics: collectUIMetrics,
    },
    codespaces: {
      code_server_port_min: 20000,
      code_server_port_max: 21000,
    },
    permission_policy: null,
    ai: null,
  } as const;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('createDebugConsoleController', () => {
  it('loads snapshot data and merges streamed events while enabled', async () => {
    const [settingsKey] = createSignal<number | null>(1);
    const [protocolStatus] = createSignal('connected');
    const connectStream = vi.fn(async ({ signal, onEvent }) => {
      onEvent({
        key: 'evt-2',
        event: {
          created_at: '2026-03-27T10:00:02Z',
          source: 'desktop',
          scope: 'desktop_http',
          kind: 'completed',
          trace_id: 'trace-1',
          method: 'GET',
          path: '/api/local/runtime',
          status_code: 200,
          duration_ms: 19,
        },
      });
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    });

    const trackerClear = vi.fn();

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        settingsKey,
        protocolStatus,
        fetchSettings: vi.fn(async () => buildSettings(true, true)),
        fetchSnapshot: vi.fn(async () => ({
          enabled: true,
          state_dir: '/tmp/redeven',
          recent_events: [
            {
              created_at: '2026-03-27T10:00:01Z',
              source: 'agent',
              scope: 'gateway_api',
              kind: 'request',
              trace_id: 'trace-1',
              method: 'GET',
              path: '/_redeven_proxy/api/settings',
              status_code: 200,
              duration_ms: 17,
            },
          ],
          slow_summary: [],
          stats: { total_events: 1, agent_events: 1, desktop_events: 0, slow_events: 0, trace_count: 1 },
        })),
        connectStream,
        createPerformanceTracker: () => ({
          snapshot: () => ({
            collecting: true,
            fps: { current: 60, average: 58, low: 48, samples: 3 },
            long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
            layout_shift: { count: 0, total_score: 0, max_score: 0 },
            paints: {},
            navigation: {},
            recent_events: [],
            supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false },
          }),
          clear: trackerClear,
        }),
      });
      return disposeRoot;
    });

    await tick();
    await tick();

    expect(controller.enabled()).toBe(true);
    expect(controller.collectUIMetrics()).toBe(true);
    expect(controller.open()).toBe(true);
    expect(controller.runtimeEnabled()).toBe(true);
    expect(controller.streamConnected()).toBe(true);
    expect(controller.serverEvents()).toHaveLength(2);
    expect(controller.traces()).toHaveLength(1);
    expect(controller.traces()[0]?.events).toHaveLength(2);
    expect(controller.stats().trace_count).toBe(1);
    expect(controller.stateDir()).toBe('/tmp/redeven');

    dispose();
    expect(connectStream).toHaveBeenCalledTimes(1);
  });

  it('auto-refreshes snapshot data without requiring a manual refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T10:00:00Z'));

    const [settingsKey] = createSignal<number | null>(1);
    const [protocolStatus] = createSignal('connected');
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        enabled: true,
        state_dir: '/tmp/redeven',
        recent_events: [
          {
            created_at: '2026-03-27T10:00:00Z',
            source: 'agent',
            scope: 'gateway_api',
            kind: 'request',
            trace_id: 'trace-1',
            method: 'GET',
            path: '/_redeven_proxy/api/settings',
            status_code: 200,
            duration_ms: 12,
          },
        ],
        slow_summary: [],
        stats: { total_events: 1, agent_events: 1, desktop_events: 0, slow_events: 0, trace_count: 1 },
      })
      .mockResolvedValueOnce({
        enabled: true,
        state_dir: '/tmp/redeven',
        recent_events: [
          {
            created_at: '2026-03-27T10:00:01Z',
            source: 'desktop',
            scope: 'desktop_http',
            kind: 'completed',
            trace_id: 'trace-2',
            method: 'POST',
            path: '/_redeven_proxy/api/chat/send',
            status_code: 200,
            duration_ms: 21,
          },
          {
            created_at: '2026-03-27T10:00:00Z',
            source: 'agent',
            scope: 'gateway_api',
            kind: 'request',
            trace_id: 'trace-1',
            method: 'GET',
            path: '/_redeven_proxy/api/settings',
            status_code: 200,
            duration_ms: 12,
          },
        ],
        slow_summary: [],
        stats: { total_events: 2, agent_events: 1, desktop_events: 1, slow_events: 0, trace_count: 2 },
      });

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        settingsKey,
        protocolStatus,
        fetchSettings: vi.fn(async () => buildSettings(true, false)),
        fetchSnapshot,
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => ({
            collecting: false,
            fps: { current: 0, average: 0, low: 0, samples: 0 },
            long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
            layout_shift: { count: 0, total_score: 0, max_score: 0 },
            paints: {},
            navigation: {},
            recent_events: [],
            supported: { longtask: false, layout_shift: false, paint: false, navigation: false, memory: false },
          }),
          clear: vi.fn(),
        }),
      });
      return disposeRoot;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(controller.serverEvents()).toHaveLength(1);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(controller.serverEvents()).toHaveLength(2);
    expect(controller.serverEvents()[0]?.path).toBe('/_redeven_proxy/api/chat/send');
    expect(controller.stats().desktop_events).toBe(1);

    dispose();
  });

  it('clear resets the local capture window and prevents old snapshot events from reappearing', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T10:00:00Z'));

    const [settingsKey] = createSignal<number | null>(1);
    const [protocolStatus] = createSignal('connected');
    const trackerClear = vi.fn();
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce({
        enabled: true,
        state_dir: '/tmp/redeven',
        recent_events: [
          {
            created_at: '2026-03-27T09:59:59Z',
            source: 'agent',
            scope: 'gateway_api',
            kind: 'request',
            trace_id: 'trace-1',
            method: 'GET',
            path: '/_redeven_proxy/api/settings',
            status_code: 200,
            duration_ms: 12,
          },
        ],
        slow_summary: [],
        stats: { total_events: 1, agent_events: 1, desktop_events: 0, slow_events: 0, trace_count: 1 },
      })
      .mockResolvedValueOnce({
        enabled: true,
        state_dir: '/tmp/redeven',
        recent_events: [
          {
            created_at: '2026-03-27T09:59:59Z',
            source: 'agent',
            scope: 'gateway_api',
            kind: 'request',
            trace_id: 'trace-1',
            method: 'GET',
            path: '/_redeven_proxy/api/settings',
            status_code: 200,
            duration_ms: 12,
          },
        ],
        slow_summary: [],
        stats: { total_events: 1, agent_events: 1, desktop_events: 0, slow_events: 0, trace_count: 1 },
      })
      .mockResolvedValueOnce({
        enabled: true,
        state_dir: '/tmp/redeven',
        recent_events: [
          {
            created_at: '2026-03-27T10:00:01Z',
            source: 'desktop',
            scope: 'desktop_http',
            kind: 'completed',
            trace_id: 'trace-2',
            method: 'POST',
            path: '/_redeven_proxy/api/chat/send',
            status_code: 200,
            duration_ms: 18,
          },
          {
            created_at: '2026-03-27T09:59:59Z',
            source: 'agent',
            scope: 'gateway_api',
            kind: 'request',
            trace_id: 'trace-1',
            method: 'GET',
            path: '/_redeven_proxy/api/settings',
            status_code: 200,
            duration_ms: 12,
          },
        ],
        slow_summary: [],
        stats: { total_events: 2, agent_events: 1, desktop_events: 1, slow_events: 0, trace_count: 2 },
      });

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        settingsKey,
        protocolStatus,
        fetchSettings: vi.fn(async () => buildSettings(true, true)),
        fetchSnapshot,
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => ({
            collecting: true,
            fps: { current: 60, average: 58, low: 48, samples: 3 },
            long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
            layout_shift: { count: 0, total_score: 0, max_score: 0 },
            paints: {},
            navigation: {},
            recent_events: [],
            supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false },
          }),
          clear: trackerClear,
        }),
      });
      return disposeRoot;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(controller.serverEvents()).toHaveLength(1);

    await controller.clear();

    expect(trackerClear).toHaveBeenCalled();
    expect(controller.serverEvents()).toHaveLength(0);
    expect(controller.stats().total_events).toBe(0);
    expect(controller.captureCutoffAt()).toBe('2026-03-27T10:00:00.000Z');

    await vi.advanceTimersByTimeAsync(1_000);

    expect(controller.serverEvents()).toHaveLength(1);
    expect(controller.serverEvents()[0]?.path).toBe('/_redeven_proxy/api/chat/send');
    expect(controller.serverEvents()[0]?.created_at).toBe('2026-03-27T10:00:01Z');

    dispose();
  });

  it('can exit debug console mode from the floating console actions', async () => {
    const [settingsKey] = createSignal<number | null>(1);
    const [protocolStatus] = createSignal('connected');
    const trackerClear = vi.fn();
    const saveSettings = vi.fn(async () => ({ settings: buildSettings(false, true) }));

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        settingsKey,
        protocolStatus,
        fetchSettings: vi.fn(async () => buildSettings(true, true)),
        saveSettings,
        fetchSnapshot: vi.fn(async () => ({
          enabled: true,
          state_dir: '/tmp/redeven',
          recent_events: [
            {
              created_at: '2026-03-27T10:00:01Z',
              source: 'agent',
              scope: 'gateway_api',
              kind: 'request',
              method: 'GET',
              path: '/_redeven_proxy/api/settings',
            },
          ],
          slow_summary: [],
          stats: { total_events: 1, agent_events: 1, desktop_events: 0, slow_events: 0, trace_count: 0 },
        })),
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => ({
            collecting: true,
            fps: { current: 60, average: 58, low: 48, samples: 3 },
            long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
            layout_shift: { count: 0, total_score: 0, max_score: 0 },
            paints: {},
            navigation: {},
            recent_events: [],
            supported: { longtask: true, layout_shift: true, paint: true, navigation: true, memory: false },
          }),
          clear: trackerClear,
        }),
      });
      return disposeRoot;
    });

    await tick();
    await tick();

    expect(controller.enabled()).toBe(true);
    expect(controller.serverEvents()).toHaveLength(1);

    await controller.exitConsole();

    expect(saveSettings).toHaveBeenCalledWith({
      debug_console: {
        enabled: false,
        collect_ui_metrics: true,
      },
    });
    expect(controller.enabled()).toBe(false);
    expect(controller.open()).toBe(false);
    expect(controller.serverEvents()).toHaveLength(0);
    expect(trackerClear).toHaveBeenCalled();
    expect(controller.exiting()).toBe(false);

    dispose();
  });

  it('clears runtime data when the console is disabled', async () => {
    const [settingsKey, setSettingsKey] = createSignal<number | null>(1);
    const [protocolStatus] = createSignal('connected');
    const trackerClear = vi.fn();
    const fetchSettings = vi
      .fn()
      .mockResolvedValueOnce(buildSettings(true, false))
      .mockResolvedValueOnce(buildSettings(false, false));

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        settingsKey,
        protocolStatus,
        fetchSettings,
        fetchSnapshot: vi.fn(async () => ({
          enabled: true,
          state_dir: '/tmp/redeven',
          recent_events: [
            {
              created_at: '2026-03-27T10:00:01Z',
              source: 'agent',
              scope: 'gateway_api',
              kind: 'request',
              method: 'GET',
              path: '/_redeven_proxy/api/settings',
            },
          ],
          slow_summary: [],
          stats: { total_events: 1, agent_events: 1, desktop_events: 0, slow_events: 0, trace_count: 0 },
        })),
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => ({
            collecting: false,
            fps: { current: 0, average: 0, low: 0, samples: 0 },
            long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
            layout_shift: { count: 0, total_score: 0, max_score: 0 },
            paints: {},
            navigation: {},
            recent_events: [],
            supported: { longtask: false, layout_shift: false, paint: false, navigation: false, memory: false },
          }),
          clear: trackerClear,
        }),
      });
      return disposeRoot;
    });

    await tick();
    await tick();
    expect(controller.enabled()).toBe(true);
    expect(controller.serverEvents()).toHaveLength(1);

    setSettingsKey(2);
    await tick();
    await tick();

    expect(controller.enabled()).toBe(false);
    expect(controller.serverEvents()).toHaveLength(0);
    expect(trackerClear).toHaveBeenCalled();

    dispose();
  });
});
