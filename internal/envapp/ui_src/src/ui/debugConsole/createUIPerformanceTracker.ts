import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';

import type { DiagnosticsEvent } from '../services/diagnosticsApi';

const FPS_SAMPLE_WINDOW_MS = 1000;
const MEMORY_SAMPLE_INTERVAL_MS = 5000;
const MAX_UI_EVENTS = 80;
const DEBUG_CONSOLE_ROOT_SELECTOR = '.debug-console-window, [data-redeven-debug-console-root="true"]';

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
    mutation_observer: boolean;
    interaction_latency: boolean;
  }>;
  fps: Readonly<{
    current: number;
    average: number;
    low: number;
    samples: number;
  }>;
  frame_timing: Readonly<{
    long_frame_count: number;
    max_frame_ms: number;
    last_frame_ms: number;
  }>;
  interactions: Readonly<{
    count: number;
    last_type?: string;
    last_paint_delay_ms?: number;
    max_paint_delay_ms: number;
  }>;
  dom_activity: Readonly<{
    mutation_batches: number;
    mutation_records: number;
    nodes_added: number;
    nodes_removed: number;
    attributes_changed: number;
    text_changed: number;
    max_batch_records: number;
    last_mutation_at?: string;
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
  detailed?: Accessor<boolean>;
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

function debugConsoleHostForNode(node: Node | null): Element | null {
  if (!node || typeof Element === 'undefined') {
    return null;
  }
  if (node instanceof Element) {
    return node.closest(DEBUG_CONSOLE_ROOT_SELECTOR);
  }
  return node.parentElement?.closest(DEBUG_CONSOLE_ROOT_SELECTOR) ?? null;
}

function filterDebugConsoleMutations(records: readonly MutationRecord[]): MutationRecord[] {
  return records.filter((record) => {
    if (debugConsoleHostForNode(record.target)) {
      return false;
    }

    const affectedNodes = [...record.addedNodes, ...record.removedNodes];
    if (affectedNodes.length === 0) {
      return true;
    }

    return affectedNodes.some((node) => !debugConsoleHostForNode(node));
  });
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
      mutation_observer: typeof MutationObserver !== 'undefined',
      interaction_latency: typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function',
    },
    fps: {
      current: 0,
      average: 0,
      low: 0,
      samples: 0,
    },
    frame_timing: {
      long_frame_count: 0,
      max_frame_ms: 0,
      last_frame_ms: 0,
    },
    interactions: {
      count: 0,
      max_paint_delay_ms: 0,
    },
    dom_activity: {
      mutation_batches: 0,
      mutation_records: 0,
      nodes_added: 0,
      nodes_removed: 0,
      attributes_changed: 0,
      text_changed: 0,
      max_batch_records: 0,
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
    const liveEnabled = args.enabled();
    const detailedEnabled = args.detailed ? args.detailed() : liveEnabled;
    if (!liveEnabled) {
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
      memory: detailedEnabled ? readPerformanceMemory() : undefined,
    }));
    if (detailedEnabled) {
      applyStaticEntries();
    }

    let disposed = false;
    let animationFrame = 0;
    let memoryTimer: number | null = null;
    let fpsWindowStartedAt = 0;
    let fpsWindowFrames = 0;
    let previousFrameTimestamp = 0;

    const handleFPSFrame = (timestamp: number) => {
      if (disposed) {
        return;
      }
      if (previousFrameTimestamp > 0) {
        const frameDuration = timestamp - previousFrameTimestamp;
        setSnapshot((current) => ({
          ...current,
          frame_timing: {
            long_frame_count: current.frame_timing.long_frame_count + (frameDuration >= 34 ? 1 : 0),
            max_frame_ms: round2(Math.max(current.frame_timing.max_frame_ms, frameDuration)),
            last_frame_ms: round2(frameDuration),
          },
        }));
        if (frameDuration >= 50) {
          appendEvent(createUIEvent({
            kind: 'frame_gap',
            message: `Renderer frame gap reached ${Math.round(frameDuration)} ms.`,
            durationMs: frameDuration,
            detail: {
              frame_ms: round2(frameDuration),
            },
          }));
        }
      }
      previousFrameTimestamp = timestamp;
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

    if (detailedEnabled) {
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
    }

    const recordInteraction = (type: string) => {
      const interactionStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
      window.requestAnimationFrame(() => {
        const finishedAt = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        const delayMs = Math.max(0, finishedAt - interactionStartedAt);
        setSnapshot((current) => ({
          ...current,
          interactions: {
            count: current.interactions.count + 1,
            last_type: type,
            last_paint_delay_ms: round2(delayMs),
            max_paint_delay_ms: round2(Math.max(current.interactions.max_paint_delay_ms, delayMs)),
          },
        }));
        if (delayMs >= 50) {
          appendEvent(createUIEvent({
            kind: 'interaction_delay',
            message: `${type} interaction needed ${Math.round(delayMs)} ms to reach the next paint.`,
            durationMs: delayMs,
            detail: {
              interaction_type: type,
              delay_ms: round2(delayMs),
            },
          }));
        }
      });
    };

    const handlePointerDown = () => recordInteraction('pointerdown');
    const handleKeyDown = () => recordInteraction('keydown');
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);

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

    if (detailedEnabled) {
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
    }

    const mutationTarget = document.body ?? document.documentElement;
    const mutationObserver = typeof MutationObserver !== 'undefined' && mutationTarget
      ? new MutationObserver((records) => {
          const filteredRecords = filterDebugConsoleMutations(records);
          if (filteredRecords.length === 0) {
            return;
          }
          let nodesAdded = 0;
          let nodesRemoved = 0;
          let attributesChanged = 0;
          let textChanged = 0;
          for (const record of filteredRecords) {
            nodesAdded += record.addedNodes?.length ?? 0;
            nodesRemoved += record.removedNodes?.length ?? 0;
            if (record.type === 'attributes') {
              attributesChanged += 1;
            }
            if (record.type === 'characterData') {
              textChanged += 1;
            }
          }
          setSnapshot((current) => ({
            ...current,
            dom_activity: {
              mutation_batches: current.dom_activity.mutation_batches + 1,
              mutation_records: current.dom_activity.mutation_records + filteredRecords.length,
              nodes_added: current.dom_activity.nodes_added + nodesAdded,
              nodes_removed: current.dom_activity.nodes_removed + nodesRemoved,
              attributes_changed: current.dom_activity.attributes_changed + attributesChanged,
              text_changed: current.dom_activity.text_changed + textChanged,
              max_batch_records: Math.max(current.dom_activity.max_batch_records, filteredRecords.length),
              last_mutation_at: new Date().toISOString(),
            },
          }));
          if (filteredRecords.length >= 24 || nodesAdded + nodesRemoved >= 32) {
            appendEvent(createUIEvent({
              kind: 'dom_burst',
              message: `DOM activity spiked with ${filteredRecords.length} mutation records.`,
              detail: {
                mutation_records: filteredRecords.length,
                nodes_added: nodesAdded,
                nodes_removed: nodesRemoved,
                attributes_changed: attributesChanged,
                text_changed: textChanged,
              },
            }));
          }
        })
      : null;
    mutationObserver?.observe(mutationTarget, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
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
      mutationObserver?.disconnect();
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    });
  });

  return {
    snapshot,
    clear: reset,
  };
}
