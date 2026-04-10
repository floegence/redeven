// @vitest-environment jsdom

import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDebugConsoleController } from './createDebugConsoleController';
import type { DiagnosticsEvent } from '../services/diagnosticsApi';

const VISIBLE_KEY = 'redeven:debug-console:visible';
const MINIMIZED_KEY = 'redeven:debug-console:minimized';

function tick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function installStorageBridge() {
  const store = new Map<string, string>();
  window.redevenDesktopStateStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(String(key), String(value));
    },
    removeItem: (key) => {
      store.delete(String(key));
    },
    keys: () => Array.from(store.keys()),
  };
  return store;
}

function setConsoleVisible(visible: boolean, minimized = false) {
  window.redevenDesktopStateStorage?.setItem(VISIBLE_KEY, visible ? 'true' : 'false');
  window.redevenDesktopStateStorage?.setItem(MINIMIZED_KEY, minimized ? 'true' : 'false');
}

function buildSnapshot(events: DiagnosticsEvent[], enabled = true) {
  return {
    enabled,
    state_dir: '/tmp/redeven',
    recent_events: events,
    slow_summary: [],
    stats: {
      total_events: events.length,
      agent_events: events.filter((event) => event.source === 'agent').length,
      desktop_events: events.filter((event) => event.source === 'desktop' || event.source === 'browser').length,
      slow_events: 0,
      trace_count: new Set(events.map((event) => String(event.trace_id ?? '')).filter(Boolean)).size,
    },
  };
}

function buildPerformanceSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    collecting: false,
    supported: {
      longtask: false,
      layout_shift: false,
      paint: false,
      navigation: false,
      memory: false,
      mutation_observer: true,
      interaction_latency: true,
    },
    fps: { current: 0, average: 0, low: 0, samples: 0 },
    frame_timing: { long_frame_count: 0, max_frame_ms: 0, last_frame_ms: 0 },
    interactions: { count: 0, max_paint_delay_ms: 0 },
    dom_activity: {
      mutation_batches: 0,
      mutation_records: 0,
      nodes_added: 0,
      nodes_removed: 0,
      attributes_changed: 0,
      text_changed: 0,
      max_batch_records: 0,
    },
    long_tasks: { count: 0, total_duration_ms: 0, max_duration_ms: 0 },
    layout_shift: { count: 0, total_score: 0, max_score: 0 },
    paints: {},
    navigation: {},
    recent_events: [],
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  delete window.redevenDesktopStateStorage;
  vi.useRealTimers();
});

describe('createDebugConsoleController', () => {
  it('loads snapshot data and merges streamed events while open', async () => {
    installStorageBridge();
    setConsoleVisible(true);

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
        protocolStatus,
        fetchSnapshot: vi.fn(async () => buildSnapshot([
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
        ])),
        connectStream,
        createPerformanceTracker: () => ({
          snapshot: () => buildPerformanceSnapshot({
            collecting: true,
            fps: { current: 60, average: 58, low: 48, samples: 3 },
            supported: {
              longtask: true,
              layout_shift: true,
              paint: true,
              navigation: true,
              memory: false,
              mutation_observer: true,
              interaction_latency: true,
            },
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
    expect(controller.uiMetricsCollecting()).toBe(true);
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

  it('stays hidden until the frontend shows the console', async () => {
    installStorageBridge();
    setConsoleVisible(false);

    const [protocolStatus] = createSignal('connected');
    const fetchSnapshot = vi.fn(async () => buildSnapshot([
      {
        created_at: '2026-03-27T10:00:01Z',
        source: 'agent',
        scope: 'gateway_api',
        kind: 'request',
        trace_id: 'trace-1',
        method: 'GET',
        path: '/_redeven_proxy/api/settings',
      },
    ]));

    let trackerArgs!: Readonly<{ enabled: () => boolean; detailed: () => boolean }>;
    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        protocolStatus,
        fetchSnapshot,
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: (args) => {
          trackerArgs = args;
          return {
            snapshot: () => buildPerformanceSnapshot({
              collecting: args.enabled(),
            }),
            clear: vi.fn(),
          };
        },
      });
      return disposeRoot;
    });

    await tick();

    expect(controller.enabled()).toBe(false);
    expect(controller.collectUIMetrics()).toBe(false);
    expect(controller.uiMetricsCollecting()).toBe(false);
    expect(controller.open()).toBe(false);
    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(trackerArgs.enabled()).toBe(false);
    expect(trackerArgs.detailed()).toBe(false);

    controller.show();
    await tick();
    await tick();

    expect(controller.enabled()).toBe(true);
    expect(controller.collectUIMetrics()).toBe(true);
    expect(controller.uiMetricsCollecting()).toBe(true);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(trackerArgs.enabled()).toBe(true);
    expect(trackerArgs.detailed()).toBe(true);

    dispose();
  });

  it('keeps the console enabled but stops collection while minimized', async () => {
    installStorageBridge();
    setConsoleVisible(true, true);

    const [protocolStatus] = createSignal('connected');
    const fetchSnapshot = vi.fn(async () => buildSnapshot([
      {
        created_at: '2026-03-27T10:00:01Z',
        source: 'agent',
        scope: 'gateway_api',
        kind: 'request',
        trace_id: 'trace-1',
        method: 'GET',
        path: '/_redeven_proxy/api/settings',
      },
    ]));
    const connectStream = vi.fn(async ({ signal }) => {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const setClientCaptureEnabled = vi.fn();

    let trackerArgs!: Readonly<{ enabled: () => boolean; detailed: () => boolean }>;
    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        protocolStatus,
        fetchSnapshot,
        connectStream,
        setClientCaptureEnabled,
        createPerformanceTracker: (args) => {
          trackerArgs = args;
          return {
            snapshot: () => buildPerformanceSnapshot({
              collecting: args.enabled(),
            }),
            clear: vi.fn(),
          };
        },
      });
      return disposeRoot;
    });

    await tick();
    await tick();

    expect(controller.enabled()).toBe(true);
    expect(controller.open()).toBe(false);
    expect(controller.collectUIMetrics()).toBe(false);
    expect(controller.uiMetricsCollecting()).toBe(false);
    expect(fetchSnapshot).not.toHaveBeenCalled();
    expect(connectStream).not.toHaveBeenCalled();
    expect(trackerArgs.enabled()).toBe(false);
    expect(trackerArgs.detailed()).toBe(false);
    expect(setClientCaptureEnabled).toHaveBeenCalledWith(false);

    controller.restore();
    await tick();
    await tick();

    expect(controller.open()).toBe(true);
    expect(controller.collectUIMetrics()).toBe(true);
    expect(controller.uiMetricsCollecting()).toBe(true);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(connectStream).toHaveBeenCalledTimes(1);
    expect(trackerArgs.enabled()).toBe(true);
    expect(trackerArgs.detailed()).toBe(true);
    expect(setClientCaptureEnabled).toHaveBeenLastCalledWith(true);

    dispose();
  });

  it('stops auto-refresh and browser capture after minimize', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T10:00:00Z'));
    installStorageBridge();
    setConsoleVisible(true);

    const [protocolStatus] = createSignal('connected');
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValue(buildSnapshot([
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
      ]));
    const setClientCaptureEnabled = vi.fn();

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        protocolStatus,
        fetchSnapshot,
        setClientCaptureEnabled,
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => buildPerformanceSnapshot({ collecting: true }),
          clear: vi.fn(),
        }),
      });
      return disposeRoot;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(setClientCaptureEnabled).toHaveBeenLastCalledWith(true);

    controller.minimize();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(controller.enabled()).toBe(true);
    expect(controller.open()).toBe(false);
    expect(controller.collectUIMetrics()).toBe(false);
    expect(controller.uiMetricsCollecting()).toBe(false);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(setClientCaptureEnabled).toHaveBeenLastCalledWith(false);

    dispose();
  });

  it('auto-refreshes snapshot data without requiring a manual refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T10:00:00Z'));
    installStorageBridge();
    setConsoleVisible(true);

    const [protocolStatus] = createSignal('connected');
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(buildSnapshot([
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
      ]))
      .mockResolvedValueOnce(buildSnapshot([
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
      ]));

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        protocolStatus,
        fetchSnapshot,
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => buildPerformanceSnapshot({
            collecting: true,
            fps: { current: 60, average: 60, low: 60, samples: 1 },
            supported: {
              longtask: true,
              layout_shift: true,
              paint: true,
              navigation: true,
              memory: false,
              mutation_observer: true,
              interaction_latency: true,
            },
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

  it('merges browser-captured request events in real time', async () => {
    installStorageBridge();
    setConsoleVisible(true);

    const [protocolStatus] = createSignal('connected');
    const listeners = new Set<(event: DiagnosticsEvent) => void>();
    const installClientCapture = vi.fn();
    const setClientCaptureEnabled = vi.fn();

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        protocolStatus,
        fetchSnapshot: vi.fn(async () => buildSnapshot([])),
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => buildPerformanceSnapshot({ collecting: true }),
          clear: vi.fn(),
        }),
        installClientCapture,
        setClientCaptureEnabled,
        subscribeClientEvents: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      });
      return disposeRoot;
    });

    await tick();
    await tick();

    expect(installClientCapture).toHaveBeenCalledTimes(1);
    expect(setClientCaptureEnabled).toHaveBeenCalledWith(true);
    expect(controller.serverEvents()).toHaveLength(0);

    const emit = [...listeners][0];
    expect(emit).toBeTruthy();
    emit?.({
      created_at: '2026-03-27T10:00:05Z',
      source: 'browser',
      scope: 'gateway_api',
      kind: 'completed',
      trace_id: 'http-000001',
      method: 'POST',
      path: 'http://localhost/_redeven_proxy/api/ai/threads',
      status_code: 200,
      duration_ms: 26,
      detail: {
        transport: 'browser_fetch',
        request: {
          url: 'http://localhost/_redeven_proxy/api/ai/threads',
          content_type: 'application/json',
          payload_kind: 'json',
          payload: {
            title: 'Investigate diagnostics',
          },
        },
        response: {
          status: 200,
          status_text: 'OK',
          content_type: 'application/json',
          payload_kind: 'json',
          payload: {
            thread: {
              id: 'thread_1',
            },
          },
        },
      },
    } as DiagnosticsEvent);

    expect(controller.serverEvents()).toHaveLength(1);
    expect(controller.serverEvents()[0]?.source).toBe('browser');
    expect((controller.serverEvents()[0]?.detail as any)?.request?.payload?.title).toBe('Investigate diagnostics');
    expect((controller.serverEvents()[0]?.detail as any)?.response?.payload?.thread?.id).toBe('thread_1');

    dispose();
    expect(setClientCaptureEnabled).toHaveBeenLastCalledWith(false);
  });

  it('clears the local capture window and resumes from later snapshots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T10:00:00Z'));
    installStorageBridge();
    setConsoleVisible(true);

    const [protocolStatus] = createSignal('connected');
    const trackerClear = vi.fn();
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce(buildSnapshot([
        {
          created_at: '2026-03-27T10:00:00Z',
          source: 'agent',
          scope: 'gateway_api',
          kind: 'request',
          trace_id: 'trace-1',
          method: 'GET',
          path: '/_redeven_proxy/api/settings',
          status_code: 200,
          duration_ms: 14,
        },
      ]))
      .mockResolvedValueOnce(buildSnapshot([
        {
          created_at: '2026-03-27T10:00:01Z',
          source: 'desktop',
          scope: 'desktop_http',
          kind: 'completed',
          trace_id: 'trace-2',
          method: 'POST',
          path: '/_redeven_proxy/api/chat/send',
          status_code: 200,
          duration_ms: 22,
        },
      ]));

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        protocolStatus,
        fetchSnapshot,
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => buildPerformanceSnapshot({
            collecting: true,
            fps: { current: 60, average: 58, low: 48, samples: 3 },
            supported: {
              longtask: true,
              layout_shift: true,
              paint: true,
              navigation: true,
              memory: false,
              mutation_observer: true,
              interaction_latency: true,
            },
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
    expect(controller.serverEvents()).toHaveLength(1);
    expect(controller.serverEvents()[0]?.path).toBe('/_redeven_proxy/api/chat/send');
    expect(controller.stats().total_events).toBe(1);
    expect(controller.captureCutoffAt()).toBe('2026-03-27T10:00:00.000Z');

    await vi.advanceTimersByTimeAsync(1_000);

    expect(controller.serverEvents()).toHaveLength(1);
    expect(controller.serverEvents()[0]?.path).toBe('/_redeven_proxy/api/chat/send');

    dispose();
  });

  it('closes the console locally without saving backend settings', async () => {
    installStorageBridge();
    setConsoleVisible(true);

    const [protocolStatus] = createSignal('connected');
    const trackerClear = vi.fn();

    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        protocolStatus,
        fetchSnapshot: vi.fn(async () => buildSnapshot([
          {
            created_at: '2026-03-27T10:00:01Z',
            source: 'agent',
            scope: 'gateway_api',
            kind: 'request',
            method: 'GET',
            path: '/_redeven_proxy/api/settings',
          },
        ])),
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => buildPerformanceSnapshot({
            collecting: true,
            fps: { current: 60, average: 58, low: 48, samples: 3 },
            supported: {
              longtask: true,
              layout_shift: true,
              paint: true,
              navigation: true,
              memory: false,
              mutation_observer: true,
              interaction_latency: true,
            },
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

    await controller.closeConsole();

    expect(controller.enabled()).toBe(false);
    expect(controller.open()).toBe(false);
    expect(controller.collectUIMetrics()).toBe(false);
    expect(controller.uiMetricsCollecting()).toBe(false);
    expect(window.redevenDesktopStateStorage?.getItem(VISIBLE_KEY)).toBe('false');
    expect(controller.serverEvents()).toHaveLength(1);
    expect(trackerClear).toHaveBeenCalled();

    dispose();
  });

  it('can stay forced-open for detached windows without minimize persistence', async () => {
    const store = installStorageBridge();
    setConsoleVisible(false, true);

    const [protocolStatus] = createSignal('connected');
    let controller!: ReturnType<typeof createDebugConsoleController>;
    const dispose = createRoot((disposeRoot) => {
      controller = createDebugConsoleController({
        protocolStatus,
        initialVisible: true,
        persistUIState: false,
        allowMinimize: false,
        fetchSnapshot: vi.fn(async () => buildSnapshot([])),
        connectStream: vi.fn(async ({ signal }) => {
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }),
        createPerformanceTracker: () => ({
          snapshot: () => buildPerformanceSnapshot(),
          clear: vi.fn(),
        }),
      });
      return disposeRoot;
    });

    await tick();

    expect(controller.enabled()).toBe(true);
    expect(controller.open()).toBe(true);
    controller.minimize();
    expect(controller.minimized()).toBe(false);
    expect(store.get(VISIBLE_KEY)).toBe('false');
    expect(store.get(MINIMIZED_KEY)).toBe('true');

    dispose();
  });
});
