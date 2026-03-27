import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';

import { SettingsPill } from '../pages/settings/SettingsPrimitives';
import {
  diagnosticsEventKey,
  diagnosticsExportFilename,
  type DiagnosticsEvent,
} from '../services/diagnosticsApi';
import { PersistentFloatingWindow } from '../widgets/PersistentFloatingWindow';
import type { DebugConsoleController, DebugConsoleTrace } from './createDebugConsoleController';

type DebugConsoleTab = 'requests' | 'traces' | 'ui' | 'runtime' | 'export';

type KeyValueItem = Readonly<{
  label: string;
  value: string;
  mono?: boolean;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function formatTimestamp(value: string | undefined): string {
  const input = compact(value);
  if (!input) {
    return '-';
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${Math.round(value)} ms`;
}

function formatBytes(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-';
  }
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(value)} B`;
}

function prettyJSON(value: unknown): string {
  if (value == null) {
    return '{}';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function eventTitle(event: DiagnosticsEvent): string {
  const method = compact(event.method);
  const path = compact(event.path);
  const kind = compact(event.kind);
  const scope = compact(event.scope);
  return [method, path || kind || scope].filter(Boolean).join(' ');
}

function queryIncludes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function eventMatchesQuery(event: DiagnosticsEvent, query: string): boolean {
  if (!query) {
    return true;
  }
  const detail = event.detail ? prettyJSON(event.detail) : '';
  return [
    eventTitle(event),
    compact(event.source),
    compact(event.scope),
    compact(event.message),
    compact(event.trace_id),
    detail,
  ].some((value) => queryIncludes(value, query));
}

function traceMatchesQuery(trace: DebugConsoleTrace, query: string): boolean {
  if (!query) {
    return true;
  }
  return [
    trace.title,
    compact(trace.trace_id),
    trace.scopes.join(' '),
    trace.sources.join(' '),
    ...trace.events.map((event) => compact(event.message)),
  ].some((value) => queryIncludes(value, query));
}

function tabButtonClass(active: boolean): string {
  return active
    ? 'rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary'
    : 'rounded-full border border-border/70 bg-background px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground';
}

function listRowClass(active: boolean): string {
  return active
    ? 'rounded-xl border border-primary/25 bg-primary/8 p-3 text-left shadow-sm'
    : 'rounded-xl border border-border/70 bg-background/80 p-3 text-left transition-colors hover:border-border hover:bg-muted/30';
}

function detailItemsForEvent(event: DiagnosticsEvent | null): KeyValueItem[] {
  if (!event) {
    return [];
  }
  return [
    { label: 'Source', value: compact(event.source) || 'unknown' },
    { label: 'Scope', value: compact(event.scope) || '-' },
    { label: 'Kind', value: compact(event.kind) || '-' },
    { label: 'Trace ID', value: compact(event.trace_id) || '-', mono: true },
    { label: 'Status', value: typeof event.status_code === 'number' ? String(event.status_code) : '-' },
    { label: 'Duration', value: formatDuration(event.duration_ms) },
    { label: 'When', value: formatTimestamp(event.created_at) },
  ];
}

function detailItemsForTrace(trace: DebugConsoleTrace | null): KeyValueItem[] {
  if (!trace) {
    return [];
  }
  return [
    { label: 'Trace ID', value: compact(trace.trace_id) || '(generated group)', mono: true },
    { label: 'Events', value: String(trace.events.length) },
    { label: 'Status', value: typeof trace.status_code === 'number' ? String(trace.status_code) : '-' },
    { label: 'Max duration', value: formatDuration(trace.max_duration_ms) },
    { label: 'Total duration', value: formatDuration(trace.total_duration_ms) },
    { label: 'First seen', value: formatTimestamp(trace.first_seen_at) },
    { label: 'Last seen', value: formatTimestamp(trace.last_seen_at) },
  ];
}

function KeyValueGrid(props: Readonly<{ items: readonly KeyValueItem[] }>) {
  return (
    <div class="grid gap-2 sm:grid-cols-2">
      <For each={props.items}>
        {(item) => (
          <div class="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{item.label}</div>
            <div class={`mt-1 text-xs text-foreground ${item.mono ? 'font-mono break-all' : 'break-words'}`}>{item.value}</div>
          </div>
        )}
      </For>
    </div>
  );
}

function DebugConsoleEmptyState(props: Readonly<{ title: string; message: string }>) {
  return (
    <div class="flex h-full min-h-[14rem] items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/12 px-6 py-10 text-center">
      <div class="max-w-sm space-y-2">
        <div class="text-sm font-semibold text-foreground">{props.title}</div>
        <div class="text-xs leading-5 text-muted-foreground">{props.message}</div>
      </div>
    </div>
  );
}

function renderEventBadge(event: DiagnosticsEvent) {
  if (event.slow) {
    return <SettingsPill tone="warning">Slow</SettingsPill>;
  }
  if (typeof event.status_code === 'number' && event.status_code >= 400) {
    return <SettingsPill tone="danger">HTTP {event.status_code}</SettingsPill>;
  }
  return <SettingsPill>{compact(event.source) || 'event'}</SettingsPill>;
}

export function DebugConsoleWindow(props: Readonly<{ controller: DebugConsoleController }>) {
  const [tab, setTab] = createSignal<DebugConsoleTab>('requests');
  const [query, setQuery] = createSignal('');
  const [selectedEventKey, setSelectedEventKey] = createSignal('');
  const [selectedTraceKey, setSelectedTraceKey] = createSignal('');

  const filteredEvents = createMemo(() => {
    const normalizedQuery = compact(query());
    return props.controller.serverEvents().filter((event) => eventMatchesQuery(event, normalizedQuery));
  });
  const filteredTraces = createMemo(() => {
    const normalizedQuery = compact(query());
    return props.controller.traces().filter((trace) => traceMatchesQuery(trace, normalizedQuery));
  });

  createEffect(() => {
    const events = filteredEvents();
    if (events.length === 0) {
      setSelectedEventKey('');
      return;
    }
    const current = compact(selectedEventKey());
    if (!current || !events.some((event) => diagnosticsEventKey(event) === current)) {
      setSelectedEventKey(diagnosticsEventKey(events[0]));
    }
  });

  createEffect(() => {
    const traceList = filteredTraces();
    if (traceList.length === 0) {
      setSelectedTraceKey('');
      return;
    }
    const current = compact(selectedTraceKey());
    if (!current || !traceList.some((trace) => trace.key === current)) {
      setSelectedTraceKey(traceList[0].key);
    }
  });

  const selectedEvent = createMemo(() => filteredEvents().find((event) => diagnosticsEventKey(event) === compact(selectedEventKey())) ?? null);
  const selectedTrace = createMemo(() => filteredTraces().find((trace) => trace.key === compact(selectedTraceKey())) ?? null);

  const combinedError = createMemo(() => {
    return [props.controller.settingsError(), props.controller.snapshotError(), props.controller.streamError()]
      .map((value) => compact(value))
      .filter(Boolean)
      .join(' · ');
  });

  const exportBundle = async () => {
    const bundle = await props.controller.exportBundle();
    const href = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = diagnosticsExportFilename(compact(bundle.exported_at) || new Date().toISOString()).replace('redeven-diagnostics', 'redeven-debug-console');
    anchor.click();
    URL.revokeObjectURL(href);
  };

  return (
    <>
      <Show when={props.controller.enabled() && props.controller.minimized()}>
        <button
          type="button"
          class="fixed bottom-4 right-4 z-[145] flex items-center gap-2 rounded-full border border-border/80 bg-background/96 px-3 py-2 shadow-[0_22px_40px_-26px_rgba(15,23,42,0.45)] backdrop-blur transition-colors hover:border-primary/30 hover:text-primary"
          onClick={props.controller.restore}
        >
          <span class="text-[11px] font-semibold uppercase tracking-[0.12em]">Debug Console</span>
          <SettingsPill tone={props.controller.streamConnected() ? 'success' : 'warning'}>
            {props.controller.streamConnected() ? 'Live' : 'Idle'}
          </SettingsPill>
        </button>
      </Show>

      <Show when={props.controller.enabled() && props.controller.open()}>
        <PersistentFloatingWindow
          open
          onOpenChange={(next) => {
            if (!next) {
              props.controller.minimize();
            }
          }}
          title="Debug Console"
          persistenceKey="debug-console-window"
          defaultPosition={{ x: 48, y: 76 }}
          defaultSize={{ width: 1080, height: 720 }}
          minSize={{ width: 720, height: 480 }}
          class="debug-console-window border-border/70 shadow-[0_36px_90px_-48px_rgba(15,23,42,0.5)]"
          contentClass="!p-0"
          zIndex={145}
          footer={(
            <div class="flex w-full min-w-0 items-center justify-between gap-3">
              <div class="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <SettingsPill tone={props.controller.runtimeEnabled() ? 'success' : 'warning'}>
                  {props.controller.runtimeEnabled() ? 'Runtime on' : 'Runtime off'}
                </SettingsPill>
                <SettingsPill tone={props.controller.streamConnected() ? 'success' : 'default'}>
                  {props.controller.streamConnected() ? 'Streaming' : 'Snapshot only'}
                </SettingsPill>
                <SettingsPill tone={props.controller.collectUIMetrics() ? 'success' : 'default'}>
                  {props.controller.collectUIMetrics() ? 'UI metrics on' : 'UI metrics off'}
                </SettingsPill>
                <span>Last event: {formatTimestamp(props.controller.lastEventAt())}</span>
              </div>
              <div class="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void props.controller.refresh()} disabled={props.controller.refreshing()}>
                  {props.controller.refreshing() ? 'Refreshing...' : 'Refresh'}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void exportBundle()} disabled={props.controller.exporting()}>
                  {props.controller.exporting() ? 'Exporting...' : 'Export'}
                </Button>
                <Button size="sm" variant="ghost" onClick={props.controller.minimize}>
                  Minimize
                </Button>
              </div>
            </div>
          )}
        >
          <div class="flex h-full min-h-0 flex-col bg-background">
            <div class="border-b border-border/70 px-4 py-3">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="space-y-1">
                  <div class="text-sm font-semibold text-foreground">Operator diagnostics for gateway, desktop, and UI rendering</div>
                  <div class="text-xs leading-5 text-muted-foreground">
                    The console floats above page-local loading layers and updates live while the debug console setting is enabled.
                  </div>
                </div>
                <div class="min-w-[15rem] lg:w-[20rem]">
                  <input
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    class="w-full rounded-lg border border-border/70 bg-muted/18 px-3 py-2 text-xs text-foreground outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                    placeholder="Filter by path, trace id, message, source..."
                  />
                </div>
              </div>

              <div class="mt-3 flex flex-wrap items-center gap-2">
                <For each={[
                  ['requests', 'Requests'],
                  ['traces', 'Traces'],
                  ['ui', 'UI Performance'],
                  ['runtime', 'Runtime'],
                  ['export', 'Export'],
                ] as const}>
                  {([value, label]) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab() === value}
                      class={tabButtonClass(tab() === value)}
                      onClick={() => setTab(value)}
                    >
                      {label}
                    </button>
                  )}
                </For>
              </div>

              <Show when={combinedError()}>
                <div class="mt-3 rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {combinedError()}
                </div>
              </Show>
            </div>

            <div class="flex-1 min-h-0 overflow-hidden px-4 py-4">
              <Show when={!props.controller.loading()} fallback={<DebugConsoleEmptyState title="Loading debug console" message="Fetching settings and the latest diagnostics snapshot." />}>
                <Show when={tab() === 'requests'}>
                  <Show
                    when={filteredEvents().length > 0}
                    fallback={<DebugConsoleEmptyState title="No request events yet" message="Once gateway or desktop requests flow through this session, they will appear here with trace ids, timing, and scoped metadata." />}
                  >
                    <div class="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
                      <div class="min-h-0 overflow-y-auto pr-1">
                        <div class="space-y-2">
                          <For each={filteredEvents()}>
                            {(event) => {
                              const key = diagnosticsEventKey(event);
                              return (
                                <button type="button" class={listRowClass(selectedEventKey() === key)} onClick={() => setSelectedEventKey(key)}>
                                  <div class="flex items-start justify-between gap-3">
                                    <div class="min-w-0 space-y-1">
                                      <div class="truncate text-sm font-medium text-foreground">{eventTitle(event)}</div>
                                      <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                        <span class="font-mono">{compact(event.scope) || '-'}</span>
                                        <span>{formatTimestamp(event.created_at)}</span>
                                        <span>{formatDuration(event.duration_ms)}</span>
                                        <span>Trace {compact(event.trace_id) || 'none'}</span>
                                      </div>
                                    </div>
                                    <div class="shrink-0">{renderEventBadge(event)}</div>
                                  </div>
                                  <Show when={compact(event.message)}>
                                    <div class="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{compact(event.message)}</div>
                                  </Show>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      </div>

                      <div class="min-h-0 overflow-y-auto rounded-2xl border border-border/70 bg-muted/10 p-4">
                        <Show when={selectedEvent()} fallback={<DebugConsoleEmptyState title="Select an event" message="Choose a request event from the left to inspect its trace id, metadata, and payload details." />}>
                          {(event) => (
                            <div class="space-y-4">
                              <div>
                                <div class="text-sm font-semibold text-foreground">{eventTitle(event())}</div>
                                <div class="mt-1 text-xs leading-5 text-muted-foreground">
                                  {compact(event().message) || 'No extra message was attached to this event.'}
                                </div>
                              </div>
                              <KeyValueGrid items={detailItemsForEvent(event())} />
                              <div>
                                <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Detail JSON</div>
                                <pre class="mt-2 max-h-[18rem] overflow-auto rounded-xl border border-border/70 bg-background px-3 py-3 text-[11px] leading-5 text-foreground">{prettyJSON(event().detail)}</pre>
                              </div>
                            </div>
                          )}
                        </Show>
                      </div>
                    </div>
                  </Show>
                </Show>

                <Show when={tab() === 'traces'}>
                  <Show
                    when={filteredTraces().length > 0}
                    fallback={<DebugConsoleEmptyState title="No traces yet" message="Traces appear when multiple diagnostics events share the same trace id across the desktop, gateway, and local UI surfaces." />}
                  >
                    <div class="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.95fr)]">
                      <div class="min-h-0 overflow-y-auto pr-1">
                        <div class="space-y-2">
                          <For each={filteredTraces()}>
                            {(trace) => (
                              <button type="button" class={listRowClass(selectedTraceKey() === trace.key)} onClick={() => setSelectedTraceKey(trace.key)}>
                                <div class="flex items-start justify-between gap-3">
                                  <div class="min-w-0 space-y-1">
                                    <div class="truncate text-sm font-medium text-foreground">{trace.title}</div>
                                    <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                      <span>Events {trace.events.length}</span>
                                      <span>{formatDuration(trace.max_duration_ms)}</span>
                                      <span>{compact(trace.trace_id) || 'generated group'}</span>
                                    </div>
                                  </div>
                                  <SettingsPill tone={trace.slow ? 'warning' : 'default'}>
                                    {trace.slow ? 'Slow trace' : 'Trace'}
                                  </SettingsPill>
                                </div>
                              </button>
                            )}
                          </For>
                        </div>
                      </div>

                      <div class="min-h-0 overflow-y-auto rounded-2xl border border-border/70 bg-muted/10 p-4">
                        <Show when={selectedTrace()} fallback={<DebugConsoleEmptyState title="Select a trace" message="Choose a grouped trace to inspect the full request lifecycle and participating scopes." />}>
                          {(trace) => (
                            <div class="space-y-4">
                              <div>
                                <div class="text-sm font-semibold text-foreground">{trace().title}</div>
                                <div class="mt-1 text-xs leading-5 text-muted-foreground">
                                  Sources: {trace().sources.join(', ') || '-'} · Scopes: {trace().scopes.join(', ') || '-'}
                                </div>
                              </div>
                              <KeyValueGrid items={detailItemsForTrace(trace())} />
                              <div class="space-y-2">
                                <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Timeline</div>
                                <For each={trace().events}>
                                  {(event) => (
                                    <div class="rounded-xl border border-border/70 bg-background/90 px-3 py-2">
                                      <div class="flex items-start justify-between gap-3">
                                        <div class="space-y-1">
                                          <div class="text-sm font-medium text-foreground">{eventTitle(event)}</div>
                                          <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                            <span class="font-mono">{compact(event.scope) || '-'}</span>
                                            <span>{formatTimestamp(event.created_at)}</span>
                                            <span>{formatDuration(event.duration_ms)}</span>
                                          </div>
                                        </div>
                                        {renderEventBadge(event)}
                                      </div>
                                      <Show when={compact(event.message)}>
                                        <div class="mt-2 text-[11px] leading-5 text-muted-foreground">{compact(event.message)}</div>
                                      </Show>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </div>
                          )}
                        </Show>
                      </div>
                    </div>
                  </Show>
                </Show>

                <Show when={tab() === 'ui'}>
                  <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
                    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div class="rounded-2xl border border-border/70 bg-muted/12 p-4">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">FPS</div>
                        <div class="mt-2 text-2xl font-semibold text-foreground">{Math.round(props.controller.performanceSnapshot().fps.current || 0)}</div>
                        <div class="mt-1 text-[11px] text-muted-foreground">Avg {props.controller.performanceSnapshot().fps.average || 0} · Low {props.controller.performanceSnapshot().fps.low || 0}</div>
                      </div>
                      <div class="rounded-2xl border border-border/70 bg-muted/12 p-4">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Long Tasks</div>
                        <div class="mt-2 text-2xl font-semibold text-foreground">{props.controller.performanceSnapshot().long_tasks.count}</div>
                        <div class="mt-1 text-[11px] text-muted-foreground">Max {formatDuration(props.controller.performanceSnapshot().long_tasks.max_duration_ms)}</div>
                      </div>
                      <div class="rounded-2xl border border-border/70 bg-muted/12 p-4">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Layout Shift</div>
                        <div class="mt-2 text-2xl font-semibold text-foreground">{props.controller.performanceSnapshot().layout_shift.total_score || 0}</div>
                        <div class="mt-1 text-[11px] text-muted-foreground">Peaks {props.controller.performanceSnapshot().layout_shift.max_score || 0}</div>
                      </div>
                      <div class="rounded-2xl border border-border/70 bg-muted/12 p-4">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">JS Heap</div>
                        <div class="mt-2 text-2xl font-semibold text-foreground">
                          {formatBytes(props.controller.performanceSnapshot().memory?.used_js_heap_size)}
                        </div>
                        <div class="mt-1 text-[11px] text-muted-foreground">
                          Total {formatBytes(props.controller.performanceSnapshot().memory?.total_js_heap_size)}
                        </div>
                      </div>
                    </div>

                    <KeyValueGrid
                      items={[
                        { label: 'Collecting', value: props.controller.performanceSnapshot().collecting ? 'Yes' : 'No' },
                        { label: 'FPS samples', value: String(props.controller.performanceSnapshot().fps.samples) },
                        { label: 'First paint', value: formatDuration(props.controller.performanceSnapshot().paints.first_paint_ms) },
                        { label: 'First contentful paint', value: formatDuration(props.controller.performanceSnapshot().paints.first_contentful_paint_ms) },
                        { label: 'Navigation type', value: compact(props.controller.performanceSnapshot().navigation.type) || '-' },
                        { label: 'DOMContentLoaded', value: formatDuration(props.controller.performanceSnapshot().navigation.dom_content_loaded_ms) },
                        { label: 'Load event', value: formatDuration(props.controller.performanceSnapshot().navigation.load_event_ms) },
                        { label: 'Response end', value: formatDuration(props.controller.performanceSnapshot().navigation.response_end_ms) },
                      ]}
                    />

                    <Show
                      when={props.controller.performanceSnapshot().recent_events.length > 0}
                      fallback={<DebugConsoleEmptyState title="No UI spikes recorded" message="When frame drops, long tasks, or layout shifts happen, they will show up here with a small local event log." />}
                    >
                      <div class="space-y-2">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Recent UI events</div>
                        <For each={props.controller.performanceSnapshot().recent_events}>
                          {(event) => (
                            <div class="rounded-xl border border-border/70 bg-background/90 px-3 py-2">
                              <div class="flex items-start justify-between gap-3">
                                <div class="space-y-1">
                                  <div class="text-sm font-medium text-foreground">{eventTitle(event)}</div>
                                  <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                    <span>{formatTimestamp(event.created_at)}</span>
                                    <span>{formatDuration(event.duration_ms)}</span>
                                  </div>
                                </div>
                                {renderEventBadge(event)}
                              </div>
                              <div class="mt-2 text-[11px] leading-5 text-muted-foreground">{compact(event.message) || '-'}</div>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>

                <Show when={tab() === 'runtime'}>
                  <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
                    <KeyValueGrid
                      items={[
                        { label: 'Configured', value: props.controller.enabled() ? 'Enabled' : 'Disabled' },
                        { label: 'Runtime collector', value: props.controller.runtimeEnabled() ? 'Active' : 'Inactive' },
                        { label: 'Stream', value: props.controller.streamConnected() ? 'Connected' : 'Disconnected' },
                        { label: 'UI metrics', value: props.controller.collectUIMetrics() ? 'Enabled' : 'Disabled' },
                        { label: 'State dir', value: compact(props.controller.stateDir()) || '-', mono: true },
                        { label: 'Last snapshot', value: formatTimestamp(props.controller.lastSnapshotAt()) },
                      ]}
                    />

                    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <For each={[
                        ['Events', String(props.controller.stats().total_events)],
                        ['Agent', String(props.controller.stats().agent_events)],
                        ['Desktop', String(props.controller.stats().desktop_events)],
                        ['Slow', String(props.controller.stats().slow_events)],
                        ['Traces', String(props.controller.stats().trace_count)],
                      ] as const}>
                        {([label, value]) => (
                          <div class="rounded-2xl border border-border/70 bg-muted/12 p-4">
                            <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
                            <div class="mt-2 text-2xl font-semibold text-foreground">{value}</div>
                          </div>
                        )}
                      </For>
                    </div>

                    <Show
                      when={props.controller.slowSummary().length > 0}
                      fallback={<DebugConsoleEmptyState title="No slow hotspots" message="Slow summaries populate from the same live event buffer shown in the Requests tab." />}
                    >
                      <div class="space-y-2">
                        <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Slow summary</div>
                        <div class="grid gap-2">
                          <For each={props.controller.slowSummary()}>
                            {(item) => (
                              <div class="rounded-xl border border-border/70 bg-background/90 px-3 py-2">
                                <div class="flex items-start justify-between gap-3">
                                  <div class="space-y-1">
                                    <div class="text-sm font-medium text-foreground">{[compact(item.method), compact(item.path) || compact(item.kind) || compact(item.scope)].filter(Boolean).join(' ')}</div>
                                    <div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                      <span>{item.scope}</span>
                                      <span>Count {item.count}</span>
                                      <span>Slow {item.slow_count}</span>
                                      <span>Avg {formatDuration(item.avg_duration_ms)}</span>
                                      <span>Max {formatDuration(item.max_duration_ms)}</span>
                                    </div>
                                  </div>
                                  <SettingsPill tone={item.slow_count > 0 ? 'warning' : 'default'}>
                                    {typeof item.last_status_code === 'number' ? `HTTP ${item.last_status_code}` : 'Summary'}
                                  </SettingsPill>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>
                  </div>
                </Show>

                <Show when={tab() === 'export'}>
                  <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
                    <div class="rounded-2xl border border-border/70 bg-muted/12 p-4">
                      <div class="text-sm font-semibold text-foreground">Portable diagnostics bundle</div>
                      <div class="mt-1 text-xs leading-5 text-muted-foreground">
                        Export includes the backend diagnostics snapshot, full agent and desktop event lists, current debug-console settings, and the local UI rendering snapshot collected in this browser session.
                      </div>
                    </div>

                    <KeyValueGrid
                      items={[
                        { label: 'Last export', value: formatTimestamp(props.controller.lastExportAt()) },
                        { label: 'Server events in memory', value: String(props.controller.serverEvents().length) },
                        { label: 'Trace groups in memory', value: String(props.controller.traces().length) },
                        { label: 'UI events in memory', value: String(props.controller.performanceSnapshot().recent_events.length) },
                      ]}
                    />

                    <div class="rounded-2xl border border-border/70 bg-background px-4 py-4">
                      <div class="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Bundle preview</div>
                      <pre class="mt-3 max-h-[18rem] overflow-auto rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-[11px] leading-5 text-foreground">{prettyJSON({
                        runtime_enabled: props.controller.runtimeEnabled(),
                        stream_connected: props.controller.streamConnected(),
                        ui_metrics_enabled: props.controller.collectUIMetrics(),
                        stats: props.controller.stats(),
                        state_dir: props.controller.stateDir() || undefined,
                      })}</pre>
                    </div>

                    <div class="flex items-center justify-end">
                      <Button variant="default" onClick={() => void exportBundle()} disabled={props.controller.exporting()}>
                        {props.controller.exporting() ? 'Exporting...' : 'Download debug bundle'}
                      </Button>
                    </div>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </PersistentFloatingWindow>
      </Show>
    </>
  );
}
