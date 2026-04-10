import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';

import {
  connectDiagnosticsStream,
  diagnosticsEventKey,
  exportDiagnostics,
  getDiagnostics,
  type DiagnosticsEvent,
  type DiagnosticsExportView,
  type DiagnosticsStats,
  type DiagnosticsSummaryItem,
} from '../services/diagnosticsApi';
import {
  installDebugConsoleBrowserCapture,
  setDebugConsoleCaptureEnabled,
  subscribeDebugConsoleClientEvents,
} from '../services/debugConsoleCapture';
import { readUIStorageItem, writeUIStorageItem } from '../services/uiStorage';
import { createUIPerformanceTracker, type UIPerformanceSnapshot } from './createUIPerformanceTracker';

const DEBUG_CONSOLE_VISIBLE_STORAGE_KEY = 'redeven:debug-console:visible';
const DEBUG_CONSOLE_MINIMIZED_STORAGE_KEY = 'redeven:debug-console:minimized';
const MAX_SERVER_EVENTS = 320;
const STREAM_RETRY_DELAY_MS = 1500;
const SNAPSHOT_POLL_INTERVAL_MS = 1000;

export type DebugConsoleTrace = Readonly<{
  key: string;
  trace_id?: string;
  title: string;
  status_code?: number;
  max_duration_ms: number;
  total_duration_ms: number;
  slow: boolean;
  first_seen_at: string;
  last_seen_at: string;
  scopes: string[];
  sources: string[];
  events: DiagnosticsEvent[];
}>;

export type DebugConsoleUIState = Readonly<{
  visible: boolean;
  minimized: boolean;
}>;

export type DebugConsoleExportBundle = Readonly<{
  exported_at: string;
  ui_state: DebugConsoleUIState;
  runtime: Readonly<{
    diagnostics_enabled: boolean;
    ui_metrics_enabled: boolean;
    stream_connected: boolean;
    stream_error?: string;
    state_dir?: string;
    last_snapshot_at?: string;
    capture_window_started_at?: string;
  }>;
  diagnostics: DiagnosticsExportView;
  ui_performance: UIPerformanceSnapshot;
}>;

type UIPerformanceTrackerHandle = Readonly<{
  snapshot: Accessor<UIPerformanceSnapshot>;
  clear: () => void;
}>;

type CreateDebugConsoleControllerArgs = Readonly<{
  protocolStatus: Accessor<string>;
  uiEnabled?: Accessor<boolean>;
  initialVisible?: boolean;
  persistUIState?: boolean;
  allowMinimize?: boolean;
  fetchSnapshot?: (limit?: number) => Promise<Awaited<ReturnType<typeof getDiagnostics>>>;
  exportSnapshot?: (limit?: number) => Promise<DiagnosticsExportView>;
  connectStream?: typeof connectDiagnosticsStream;
  createPerformanceTracker?: (args: Readonly<{ enabled: Accessor<boolean>; detailed: Accessor<boolean> }>) => UIPerformanceTrackerHandle;
  installClientCapture?: () => void;
  setClientCaptureEnabled?: (enabled: boolean) => void;
  subscribeClientEvents?: (listener: (event: DiagnosticsEvent) => void) => () => void;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function toUnixMs(value: string | undefined): number {
  const stamp = Date.parse(compact(value));
  return Number.isFinite(stamp) ? stamp : 0;
}

function readStoredMinimized(): boolean {
  return compact(readUIStorageItem(DEBUG_CONSOLE_MINIMIZED_STORAGE_KEY)).toLowerCase() === 'true';
}

function readStoredVisible(): boolean {
  return compact(readUIStorageItem(DEBUG_CONSOLE_VISIBLE_STORAGE_KEY)).toLowerCase() === 'true';
}

function sortEventsNewestFirst(events: readonly DiagnosticsEvent[]): DiagnosticsEvent[] {
  return [...events].sort((left, right) => {
    const diff = toUnixMs(right.created_at) - toUnixMs(left.created_at);
    if (diff !== 0) {
      return diff;
    }
    return diagnosticsEventKey(right).localeCompare(diagnosticsEventKey(left));
  });
}

function dedupeEventsNewestFirst(events: readonly DiagnosticsEvent[], maxEvents: number): DiagnosticsEvent[] {
  const next = sortEventsNewestFirst(events);
  const seen = new Set<string>();
  const deduped: DiagnosticsEvent[] = [];
  for (const event of next) {
    const key = diagnosticsEventKey(event);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
    if (deduped.length >= maxEvents) {
      break;
    }
  }
  return deduped;
}

function mergeServerEvents(existing: readonly DiagnosticsEvent[], incoming: readonly DiagnosticsEvent[]): DiagnosticsEvent[] {
  return dedupeEventsNewestFirst([...incoming, ...existing], MAX_SERVER_EVENTS);
}

function filterEventsSince(events: readonly DiagnosticsEvent[], cutoffMs: number): DiagnosticsEvent[] {
  if (!Number.isFinite(cutoffMs) || cutoffMs <= 0) {
    return [...events];
  }
  return events.filter((event) => {
    const stamp = toUnixMs(event.created_at);
    return stamp > 0 && stamp >= cutoffMs;
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = compact(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function eventDisplayTitle(event: DiagnosticsEvent): string {
  const method = compact(event.method);
  const path = compact(event.path);
  const kind = compact(event.kind);
  const scope = compact(event.scope);
  return [method, path || kind || scope].filter(Boolean).join(' ');
}

function buildStats(events: readonly DiagnosticsEvent[]): DiagnosticsStats {
  const traceIDs = new Set<string>();
  let agentEvents = 0;
  let desktopEvents = 0;
  let slowEvents = 0;
  for (const event of events) {
    if (compact(event.trace_id)) {
      traceIDs.add(compact(event.trace_id));
    }
    if (compact(event.source) === 'agent') {
      agentEvents += 1;
    } else if (compact(event.source) === 'desktop') {
      desktopEvents += 1;
    }
    if (event.slow) {
      slowEvents += 1;
    }
  }
  return {
    total_events: events.length,
    agent_events: agentEvents,
    desktop_events: desktopEvents,
    slow_events: slowEvents,
    trace_count: traceIDs.size,
  };
}

function buildSlowSummary(events: readonly DiagnosticsEvent[], limit = 12): DiagnosticsSummaryItem[] {
  const grouped = new Map<string, DiagnosticsSummaryItem>();
  for (const event of events) {
    const scope = compact(event.scope);
    const kind = compact(event.kind);
    const method = compact(event.method);
    const path = compact(event.path);
    const key = JSON.stringify({ scope, kind, method, path });
    const duration = typeof event.duration_ms === 'number' ? event.duration_ms : 0;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        scope,
        kind: kind || undefined,
        method: method || undefined,
        path: path || undefined,
        count: 1,
        slow_count: event.slow ? 1 : 0,
        max_duration_ms: duration,
        avg_duration_ms: duration,
        last_status_code: typeof event.status_code === 'number' ? event.status_code : undefined,
        last_seen_at: compact(event.created_at) || undefined,
      });
      continue;
    }
    const nextCount = current.count + 1;
    grouped.set(key, {
      ...current,
      count: nextCount,
      slow_count: current.slow_count + (event.slow ? 1 : 0),
      max_duration_ms: Math.max(current.max_duration_ms, duration),
      avg_duration_ms: Math.round(((current.avg_duration_ms * current.count) + duration) / nextCount),
      last_status_code: typeof event.status_code === 'number' ? event.status_code : current.last_status_code,
      last_seen_at: compact(event.created_at) || current.last_seen_at,
    });
  }
  return [...grouped.values()]
    .sort((left, right) => {
      if (right.slow_count !== left.slow_count) {
        return right.slow_count - left.slow_count;
      }
      if (right.max_duration_ms !== left.max_duration_ms) {
        return right.max_duration_ms - left.max_duration_ms;
      }
      return right.count - left.count;
    })
    .slice(0, limit);
}

function buildTraceGroups(events: readonly DiagnosticsEvent[]): DebugConsoleTrace[] {
  const grouped = new Map<string, DiagnosticsEvent[]>();
  for (const event of events) {
    const traceID = compact(event.trace_id);
    const key = traceID || diagnosticsEventKey(event);
    const current = grouped.get(key);
    if (current) {
      current.push(event);
    } else {
      grouped.set(key, [event]);
    }
  }
  return [...grouped.entries()]
    .map(([key, traceEvents]) => {
      const ordered = [...traceEvents].sort((left, right) => toUnixMs(left.created_at) - toUnixMs(right.created_at));
      const newest = ordered[ordered.length - 1];
      const oldest = ordered[0];
      const statusEvent = [...ordered].reverse().find((event) => typeof event.status_code === 'number');
      return {
        key,
        trace_id: compact(newest?.trace_id) || undefined,
        title: eventDisplayTitle(newest),
        status_code: typeof statusEvent?.status_code === 'number' ? statusEvent.status_code : undefined,
        max_duration_ms: ordered.reduce((max, event) => Math.max(max, typeof event.duration_ms === 'number' ? event.duration_ms : 0), 0),
        total_duration_ms: ordered.reduce((sum, event) => sum + (typeof event.duration_ms === 'number' ? event.duration_ms : 0), 0),
        slow: ordered.some((event) => event.slow),
        first_seen_at: compact(oldest?.created_at),
        last_seen_at: compact(newest?.created_at),
        scopes: uniqueStrings(ordered.map((event) => compact(event.scope))),
        sources: uniqueStrings(ordered.map((event) => compact(event.source))),
        events: ordered,
      } satisfies DebugConsoleTrace;
    })
    .sort((left, right) => toUnixMs(right.last_seen_at) - toUnixMs(left.last_seen_at));
}

function waitWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitBeforeRetry(signal: AbortSignal): Promise<void> {
  return waitWithSignal(STREAM_RETRY_DELAY_MS, signal);
}

export function createDebugConsoleController(args: CreateDebugConsoleControllerArgs) {
  const fetchSnapshot = args.fetchSnapshot ?? getDiagnostics;
  const exportSnapshot = args.exportSnapshot ?? exportDiagnostics;
  const connectStream = args.connectStream ?? connectDiagnosticsStream;
  const performanceTrackerFactory = args.createPerformanceTracker ?? createUIPerformanceTracker;
  const installClientCapture = args.installClientCapture ?? installDebugConsoleBrowserCapture;
  const setClientCaptureEnabled = args.setClientCaptureEnabled ?? setDebugConsoleCaptureEnabled;
  const subscribeClientEvents = args.subscribeClientEvents ?? subscribeDebugConsoleClientEvents;
  const uiEnabled = args.uiEnabled ?? (() => true);
  const persistUIState = args.persistUIState !== false;
  const allowMinimize = args.allowMinimize !== false;

  const [visible, setVisible] = createSignal(args.initialVisible ?? readStoredVisible());
  const [loading, setLoading] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [runtimeEnabled, setRuntimeEnabled] = createSignal(false);
  const [stateDir, setStateDir] = createSignal('');
  const [lastSnapshotAt, setLastSnapshotAt] = createSignal('');
  const [snapshotError, setSnapshotError] = createSignal<string | null>(null);
  const [serverEvents, setServerEvents] = createSignal<DiagnosticsEvent[]>([]);
  const [streamConnected, setStreamConnected] = createSignal(false);
  const [streamError, setStreamError] = createSignal<string | null>(null);
  const [exporting, setExporting] = createSignal(false);
  const [lastExportAt, setLastExportAt] = createSignal('');
  const [minimized, setMinimized] = createSignal(allowMinimize ? readStoredMinimized() : false);
  const [captureCutoffMs, setCaptureCutoffMs] = createSignal(0);
  const [captureCutoffAt, setCaptureCutoffAt] = createSignal('');

  const enabled = createMemo(() => visible() && uiEnabled());
  const open = createMemo(() => enabled() && (!allowMinimize || !minimized()));
  const collectUIMetrics = createMemo(() => open());
  const uiMetricsCollecting = createMemo(() => open());
  const stats = createMemo(() => buildStats(serverEvents()));
  const slowSummary = createMemo(() => buildSlowSummary(serverEvents()));
  const traces = createMemo(() => buildTraceGroups(serverEvents()));

  const performanceTracker = performanceTrackerFactory({
    enabled: () => uiMetricsCollecting(),
    detailed: () => uiMetricsCollecting() && collectUIMetrics(),
  });
  const lastEventAt = createMemo(() => compact(serverEvents()[0]?.created_at) || compact(performanceTracker.snapshot().recent_events[0]?.created_at));
  let refreshGeneration = 0;

  installClientCapture();

  createEffect(() => {
    setClientCaptureEnabled(open());
  });

  onCleanup(() => {
    setClientCaptureEnabled(false);
  });

  createEffect(() => {
    const unsubscribe = subscribeClientEvents((event) => {
      if (!open()) {
        return;
      }
      const cutoffMs = captureCutoffMs();
      if (cutoffMs > 0 && toUnixMs(event.created_at) < cutoffMs) {
        return;
      }
      setServerEvents((current) => mergeServerEvents(current, [event]));
    });
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    if (!persistUIState) {
      return;
    }
    writeUIStorageItem(DEBUG_CONSOLE_VISIBLE_STORAGE_KEY, visible() ? 'true' : 'false');
  });

  createEffect(() => {
    if (!persistUIState || !allowMinimize) {
      return;
    }
    writeUIStorageItem(DEBUG_CONSOLE_MINIMIZED_STORAGE_KEY, minimized() ? 'true' : 'false');
  });

  const show = () => {
    setVisible(true);
    if (allowMinimize) {
      setMinimized(false);
    }
  };

  const restore = () => {
    setVisible(true);
    if (allowMinimize) {
      setMinimized(false);
    }
  };

  const minimize = () => {
    if (!allowMinimize || !enabled()) {
      return;
    }
    setMinimized(true);
  };

  const resetRuntimeState = () => {
    refreshGeneration += 1;
    setRuntimeEnabled(false);
    setStateDir('');
    setLastSnapshotAt('');
    setSnapshotError(null);
    setServerEvents([]);
    setStreamConnected(false);
    setStreamError(null);
    setCaptureCutoffMs(0);
    setCaptureCutoffAt('');
    performanceTracker.clear();
  };

  const refresh = async (options?: { silent?: boolean; initial?: boolean }): Promise<void> => {
    if (!open()) {
      return;
    }
    if (compact(args.protocolStatus()) !== 'connected') {
      return;
    }
    const generation = ++refreshGeneration;
    if (options?.initial) {
      setLoading(true);
      setSnapshotError(null);
    } else if (options?.silent) {
      setSnapshotError(null);
    } else {
      setRefreshing(true);
      setSnapshotError(null);
    }
    try {
      const snapshot = await fetchSnapshot(200);
      if (generation !== refreshGeneration || !open()) {
        return;
      }
      const nextEvents = filterEventsSince(snapshot.recent_events ?? [], captureCutoffMs());
      setRuntimeEnabled(snapshot.enabled === true);
      setStateDir(compact(snapshot.state_dir));
      setLastSnapshotAt(new Date().toISOString());
      setServerEvents((current) => mergeServerEvents(current, nextEvents));
      setSnapshotError(null);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : String(error));
    } finally {
      if (options?.initial) {
        setLoading(false);
      } else if (!options?.silent) {
        setRefreshing(false);
      }
    }
  };

  createEffect(() => {
    const active = open() && compact(args.protocolStatus()) === 'connected';
    if (!active) {
      setLoading(false);
      setStreamConnected(false);
      setStreamError(null);
      return;
    }

    void refresh({ initial: true });

    const controller = new AbortController();
    let disposed = false;

    const runStreamLoop = async () => {
      while (!disposed && !controller.signal.aborted) {
        setStreamConnected(false);
        try {
          await connectStream({
            limit: 200,
            signal: controller.signal,
            onEvent: (payload) => {
              setStreamConnected(true);
              setStreamError(null);
              setRuntimeEnabled(true);
              setServerEvents((current) => mergeServerEvents(current, [payload.event]));
            },
          });
          if (controller.signal.aborted || disposed) {
            return;
          }
          setStreamConnected(false);
          setStreamError('Diagnostics stream closed. Reconnecting...');
        } catch (error) {
          if (controller.signal.aborted || disposed) {
            return;
          }
          setStreamConnected(false);
          setStreamError(error instanceof Error ? error.message : String(error));
        }
        try {
          await waitBeforeRetry(controller.signal);
        } catch {
          return;
        }
      }
    };

    void runStreamLoop();

    onCleanup(() => {
      disposed = true;
      controller.abort();
      setStreamConnected(false);
    });
  });

  createEffect(() => {
    const active = open() && compact(args.protocolStatus()) === 'connected';
    if (!active) {
      return;
    }

    const controller = new AbortController();
    let disposed = false;

    const runSnapshotLoop = async () => {
      while (!disposed && !controller.signal.aborted) {
        try {
          await waitWithSignal(SNAPSHOT_POLL_INTERVAL_MS, controller.signal);
        } catch {
          return;
        }
        if (disposed || controller.signal.aborted) {
          return;
        }
        await refresh({ silent: true });
      }
    };

    void runSnapshotLoop();

    onCleanup(() => {
      disposed = true;
      controller.abort();
    });
  });

  const clear = async (): Promise<void> => {
    refreshGeneration += 1;
    const nowMs = Date.now();
    setCaptureCutoffMs(nowMs);
    setCaptureCutoffAt(new Date(nowMs).toISOString());
    setServerEvents([]);
    setLastSnapshotAt('');
    setSnapshotError(null);
    performanceTracker.clear();
    await refresh({ silent: true });
  };

  const closeConsole = async (): Promise<void> => {
    if (!visible()) {
      return;
    }
    setVisible(false);
    if (allowMinimize) {
      setMinimized(false);
    }
    setLoading(false);
    setRefreshing(false);
    setStreamConnected(false);
    setStreamError(null);
    performanceTracker.clear();
  };

  const exportBundle = async (): Promise<DebugConsoleExportBundle> => {
    setExporting(true);
    try {
      const diagnostics = await exportSnapshot(1000);
      const cutoffMs = captureCutoffMs();
      const agentEvents = filterEventsSince(diagnostics.agent_events ?? [], cutoffMs);
      const desktopEvents = filterEventsSince(diagnostics.desktop_events ?? [], cutoffMs);
      const mergedEvents = dedupeEventsNewestFirst([...agentEvents, ...desktopEvents], Math.max(agentEvents.length + desktopEvents.length, 1));
      const snapshotRecentLimit = Math.max(diagnostics.snapshot?.recent_events?.length ?? 0, 1);
      const snapshotSummaryLimit = Math.max(diagnostics.snapshot?.slow_summary?.length ?? 0, 1);
      const filteredDiagnostics: DiagnosticsExportView = {
        ...diagnostics,
        agent_events: agentEvents,
        desktop_events: desktopEvents,
        snapshot: {
          ...diagnostics.snapshot,
          recent_events: mergedEvents.slice(0, snapshotRecentLimit),
          slow_summary: buildSlowSummary(mergedEvents, snapshotSummaryLimit),
          stats: buildStats(mergedEvents),
        },
      };
      setLastExportAt(filteredDiagnostics.exported_at);
      return {
        exported_at: filteredDiagnostics.exported_at,
        ui_state: {
          visible: enabled(),
          minimized: minimized(),
        },
        runtime: {
          diagnostics_enabled: runtimeEnabled(),
          ui_metrics_enabled: collectUIMetrics(),
          stream_connected: streamConnected(),
          stream_error: compact(streamError()) || undefined,
          state_dir: compact(filteredDiagnostics.state_dir) || compact(stateDir()) || undefined,
          last_snapshot_at: compact(lastSnapshotAt()) || undefined,
          capture_window_started_at: compact(captureCutoffAt()) || undefined,
        },
        diagnostics: filteredDiagnostics,
        ui_performance: performanceTracker.snapshot(),
      };
    } finally {
      setExporting(false);
    }
  };

  return {
    enabled,
    collectUIMetrics,
    uiMetricsCollecting,
    open,
    minimized,
    show,
    restore,
    minimize,
    loading,
    refreshing,
    runtimeEnabled,
    stateDir,
    lastSnapshotAt,
    snapshotError,
    streamConnected,
    streamError,
    serverEvents,
    stats,
    slowSummary,
    traces,
    lastEventAt,
    performanceSnapshot: performanceTracker.snapshot,
    exporting,
    lastExportAt,
    captureCutoffAt,
    refresh,
    clear,
    closeConsole,
    resetRuntimeState,
    exportBundle,
  };
}

export type DebugConsoleController = ReturnType<typeof createDebugConsoleController>;
