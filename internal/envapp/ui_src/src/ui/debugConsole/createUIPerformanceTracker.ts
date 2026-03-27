import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';

import type { DiagnosticsEvent } from '../services/diagnosticsApi';

const FPS_SAMPLE_WINDOW_MS = 1000;
const MEMORY_SAMPLE_INTERVAL_MS = 5000;
const MAX_UI_EVENTS = 80;

type PerformanceMemory = Readonly<{
  used_js_heap_size: number;
  total_js_heap_size: number;
  js_heap_size_limit: number;
}>;

export type UIPerformanceSnapshot = Readonly<{
  collecting: boolean;
  supported: Readonly<{
    longtask: boolean;
    layout_shift: boolean;
    paint: boolean;
    navigation: boolean;
    memory: boolean;
  }>;
  fps: Readonly<{
    current: number;
    average: number;
    low: number;
    samples: number;
  }>;
  long_tasks: Readonly<{
    count: number;
    total_duration_ms: number;
    max_duration_ms: number;
  }>;
  layout_shift: Readonly<{
    count: number;
    total_score: number;
    max_score: number;
  }>;
  paints: Readonly<{
    first_paint_ms?: number;
    first_contentful_paint_ms?: number;
  }>;
  navigation: Readonly<{
    type?: string;
    dom_content_loaded_ms?: number;
    load_event_ms?: number;
    response_end_ms?: number;
  }>;
  memory?: PerformanceMemory;
  recent_events: DiagnosticsEvent[];
}>;

type LayoutShiftEntry = PerformanceEntry & {
  value?: number;
  hadRecentInput?: boolean;
};

type CreateUIPerformanceTrackerArgs = Readonly<{
  enabled: Accessor<boolean>;
}>;

function round2(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function clampRecentEvents(events: DiagnosticsEvent[]): DiagnosticsEvent[] {
  return events.slice(0, MAX_UI_EVENTS);
}

function readSupportedEntryTypes(): string[] {
  if (typeof PerformanceObserver === 'undefined') {
    return [];
  }
  const entryTypes = (PerformanceObserver as typeof PerformanceObserver & {
    supportedEntryTypes?: string[];
  }).supportedEntryTypes;
  return Array.isArray(entryTypes) ? entryTypes : [];
}

function readPerformanceMemory(): PerformanceMemory | undefined {
  if (typeof performance === 'undefined') {
    return undefined;
  }
  const candidate = (performance as Performance & {
    memory?: {
      usedJSHeapSize?: number;
      totalJSHeapSize?: number;
      jsHeapSizeLimit?: number;
    };
  }).memory;
  if (!candidate) {
    return undefined;
  }
  const used = Number(candidate.usedJSHeapSize ?? 0);
  const total = Number(candidate.totalJSHeapSize ?? 0);
  const limit = Number(candidate.jsHeapSizeLimit ?? 0);
  if (!Number.isFinite(used) || !Number.isFinite(total) || !Number.isFinite(limit)) {
    return undefined;
  }
  return {
    used_js_heap_size: Math.max(0, Math.round(used)),
    total_js_heap_size: Math.max(0, Math.round(total)),
    js_heap_size_limit: Math.max(0, Math.round(limit)),
  };
}

function buildInitialSnapshot(): UIPerformanceSnapshot {
  const supportedEntryTypes = readSupportedEntryTypes();
  return {
    collecting: false,
    supported: {
      longtask: supportedEntryTypes.includes('longtask'),
      layout_shift: supportedEntryTypes.includes('layout-shift'),
      paint: supportedEntryTypes.includes('paint'),
      navigation: typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function',
      memory: readPerformanceMemory() != null,
    },
    fps: {
      current: 0,
      average: 0,
      low: 0,
      samples: 0,
    },
    long_tasks: {
      count: 0,
      total_duration_ms: 0,
      max_duration_ms: 0,
    },
    layout_shift: {
      count: 0,
      total_score: 0,
      max_score: 0,
    },
    paints: {},
    navigation: {},
    recent_events: [],
  };
}

function createUIEvent(args: Readonly<{
  kind: string;
  message: string;
  durationMs?: number;
  detail?: Record<string, unknown>;
}>): DiagnosticsEvent {
  return {
    created_at: new Date().toISOString(),
    source: 'ui',
    scope: 'ui_performance',
    kind: String(args.kind ?? '').trim(),
    duration_ms: typeof args.durationMs === 'number' ? Math.round(args.durationMs) : undefined,
    slow: typeof args.durationMs === 'number' ? args.durationMs >= 50 : false,
    message: String(args.message ?? '').trim(),
    detail: args.detail,
  };
}

export function createUIPerformanceTracker(args: CreateUIPerformanceTrackerArgs) {
  const [snapshot, setSnapshot] = createSignal<UIPerformanceSnapshot>(buildInitialSnapshot());

  const appendEvent = (event: DiagnosticsEvent) => {
    setSnapshot((current) => ({
      ...current,
      recent_events: clampRecentEvents([event, ...current.recent_events]),
    }));
  };

  const reset = () => {
    setSnapshot(buildInitialSnapshot());
  };

  const applyStaticEntries = () => {
    if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
      return;
    }

    const nextNavigation: {
      type?: string;
      dom_content_loaded_ms?: number;
      load_event_ms?: number;
      response_end_ms?: number;
    } = {};
    const navEntries = performance.getEntriesByType('navigation') as PerformanceEntry[];
    if (navEntries.length > 0) {
      const nav = navEntries[0] as PerformanceEntry & {
        type?: string;
        domContentLoadedEventEnd?: number;
        loadEventEnd?: number;
        responseEnd?: number;
      };
      nextNavigation.type = String(nav.type ?? '').trim() || undefined;
      if (typeof nav.domContentLoadedEventEnd === 'number') {
        nextNavigation.dom_content_loaded_ms = round2(nav.domContentLoadedEventEnd);
      }
      if (typeof nav.loadEventEnd === 'number') {
        nextNavigation.load_event_ms = round2(nav.loadEventEnd);
      }
      if (typeof nav.responseEnd === 'number') {
        nextNavigation.response_end_ms = round2(nav.responseEnd);
      }
    }

    const paints = performance.getEntriesByType('paint');
    const nextPaints: {
      first_paint_ms?: number;
      first_contentful_paint_ms?: number;
    } = {};
    for (const entry of paints) {
      if (entry.name === 'first-paint') {
        nextPaints.first_paint_ms = round2(entry.startTime);
      }
      if (entry.name === 'first-contentful-paint') {
        nextPaints.first_contentful_paint_ms = round2(entry.startTime);
      }
    }

    setSnapshot((current) => ({
      ...current,
      navigation: nextNavigation,
      paints: nextPaints,
      memory: readPerformanceMemory(),
    }));
  };

  createEffect(() => {
    if (!args.enabled()) {
      reset();
      return;
    }
    if (typeof window === 'undefined') {
      reset();
      return;
    }

    reset();
    setSnapshot((current) => ({
      ...current,
      collecting: true,
      memory: readPerformanceMemory(),
    }));
    applyStaticEntries();

    let disposed = false;
    let animationFrame = 0;
    let memoryTimer: number | null = null;
    let fpsWindowStartedAt = 0;
    let fpsWindowFrames = 0;

    const handleFPSFrame = (timestamp: number) => {
      if (disposed) {
        return;
      }
      if (fpsWindowStartedAt === 0) {
        fpsWindowStartedAt = timestamp;
      }
      fpsWindowFrames += 1;
      const elapsed = timestamp - fpsWindowStartedAt;
      if (elapsed >= FPS_SAMPLE_WINDOW_MS) {
        const fps = (fpsWindowFrames * 1000) / elapsed;
        setSnapshot((current) => {
          const nextSamples = current.fps.samples + 1;
          const nextAverage = nextSamples <= 1
            ? fps
            : ((current.fps.average * current.fps.samples) + fps) / nextSamples;
          const nextLow = current.fps.low > 0 ? Math.min(current.fps.low, fps) : fps;
          return {
            ...current,
            fps: {
              current: round2(fps),
              average: round2(nextAverage),
              low: round2(nextLow),
              samples: nextSamples,
            },
          };
        });
        if (fps < 45) {
          appendEvent(createUIEvent({
            kind: 'fps_drop',
            message: `Rendering throughput dropped to ${Math.round(fps)} fps.`,
            detail: {
              fps: round2(fps),
            },
          }));
        }
        fpsWindowFrames = 0;
        fpsWindowStartedAt = timestamp;
      }
      animationFrame = window.requestAnimationFrame(handleFPSFrame);
    };
    animationFrame = window.requestAnimationFrame(handleFPSFrame);

    memoryTimer = window.setInterval(() => {
      const memory = readPerformanceMemory();
      if (!memory) {
        return;
      }
      setSnapshot((current) => ({
        ...current,
        memory,
      }));
    }, MEMORY_SAMPLE_INTERVAL_MS);

    const observers: PerformanceObserver[] = [];
    const observeEntries = (entryType: string, handler: (entries: readonly PerformanceEntry[]) => void) => {
      if (typeof PerformanceObserver === 'undefined') {
        return;
      }
      try {
        const observer = new PerformanceObserver((list) => handler(list.getEntries()));
        observer.observe({ type: entryType, buffered: true });
        observers.push(observer);
      } catch {
        // Ignore unsupported entry types.
      }
    };

    observeEntries('longtask', (entries) => {
      for (const entry of entries) {
        setSnapshot((current) => ({
          ...current,
          long_tasks: {
            count: current.long_tasks.count + 1,
            total_duration_ms: round2(current.long_tasks.total_duration_ms + entry.duration),
            max_duration_ms: round2(Math.max(current.long_tasks.max_duration_ms, entry.duration)),
          },
        }));
        appendEvent(createUIEvent({
          kind: 'longtask',
          message: `Long task blocked the main thread for ${Math.round(entry.duration)} ms.`,
          durationMs: entry.duration,
          detail: {
            entry_type: entry.entryType,
            name: entry.name,
          },
        }));
      }
    });

    observeEntries('layout-shift', (entries) => {
      for (const entry of entries as LayoutShiftEntry[]) {
        const value = Number(entry.value ?? 0);
        if (!Number.isFinite(value) || value <= 0 || entry.hadRecentInput) {
          continue;
        }
        setSnapshot((current) => ({
          ...current,
          layout_shift: {
            count: current.layout_shift.count + 1,
            total_score: round2(current.layout_shift.total_score + value),
            max_score: round2(Math.max(current.layout_shift.max_score, value)),
          },
        }));
        if (value >= 0.05) {
          appendEvent(createUIEvent({
            kind: 'layout_shift',
            message: `Unexpected layout shift scored ${round2(value)}.`,
            detail: {
              score: round2(value),
            },
          }));
        }
      }
    });

    observeEntries('paint', (entries) => {
      setSnapshot((current) => {
        const nextPaints = { ...current.paints };
        for (const entry of entries) {
          if (entry.name === 'first-paint') {
            nextPaints.first_paint_ms = round2(entry.startTime);
          }
          if (entry.name === 'first-contentful-paint') {
            nextPaints.first_contentful_paint_ms = round2(entry.startTime);
          }
        }
        return {
          ...current,
          paints: nextPaints,
        };
      });
    });

    onCleanup(() => {
      disposed = true;
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (memoryTimer != null) {
        window.clearInterval(memoryTimer);
      }
      for (const observer of observers) {
        observer.disconnect();
      }
    });
  });

  return {
    snapshot,
    clear: reset,
  };
}
