import { For, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';

import { SettingsPill } from '../pages/settings/SettingsPrimitives';
import {
  diagnosticsEventKey,
  diagnosticsExportFilename,
  type DiagnosticsEvent,
  type DiagnosticsSummaryItem,
} from '../services/diagnosticsApi';
import { PersistentFloatingWindow } from '../widgets/PersistentFloatingWindow';
import type { DebugConsoleController, DebugConsoleTrace } from './createDebugConsoleController';

type DebugConsoleTab = 'requests' | 'traces' | 'ui' | 'runtime' | 'export';
type SemanticTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error' | 'info';

type KeyValueItem = Readonly<{
  label: string;
  value: string;
  mono?: boolean;
}>;

type MetricItem = Readonly<{
  label: string;
  value: string;
  note?: string;
  tone?: SemanticTone;
  emphasized?: boolean;
}>;

type TabDescriptor = Readonly<{
  value: DebugConsoleTab;
  label: string;
  description: string;
  count?: string;
  tone?: SemanticTone;
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
    ? 'group min-w-[9.75rem] cursor-pointer rounded-md border px-3 py-2.5 text-left shadow-[0_14px_30px_-26px_rgba(15,23,42,0.45)] transition-all'
    : 'group min-w-[9.75rem] cursor-pointer rounded-md border border-border/70 bg-background px-3 py-2.5 text-left transition-all hover:border-border hover:bg-muted/[0.14]';
}

function listRowClass(active: boolean): string {
  return active
    ? 'group w-full cursor-pointer border-b border-border/70 bg-background text-left shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)] transition-colors'
    : 'group w-full cursor-pointer border-b border-border/50 bg-background text-left transition-colors hover:bg-muted/[0.12]';
}

function semanticAccent(tone: SemanticTone): string {
  switch (tone) {
    case 'primary':
      return 'var(--primary)';
    case 'success':
      return 'var(--success)';
    case 'warning':
      return 'var(--warning)';
    case 'error':
      return 'var(--error)';
    case 'info':
      return 'var(--info)';
    case 'neutral':
    default:
      return 'var(--muted-foreground)';
  }
}

function semanticSummaryCardStyle(tone: SemanticTone, emphasized = false): JSX.CSSProperties {
  const accent = semanticAccent(tone);
  const borderMix = emphasized ? '26%' : '18%';
  const bgMix = emphasized ? '14%' : '8%';
  return {
    'border-color': `color-mix(in srgb, ${accent} ${borderMix}, var(--border))`,
    background: `linear-gradient(180deg, color-mix(in srgb, ${accent} ${bgMix}, var(--card)) 0%, var(--card) 100%)`,
    'box-shadow': `inset 0 1px 0 color-mix(in srgb, ${accent} ${emphasized ? '34%' : '20%'}, transparent), 0 18px 32px -30px rgba(15,23,42,0.35)`,
  };
}

function semanticInteractiveStyle(tone: SemanticTone, emphasis: 'soft' | 'strong' = 'soft'): JSX.CSSProperties {
  const accent = semanticAccent(tone);
  const borderMix = emphasis === 'strong' ? '30%' : '20%';
  const bgMix = emphasis === 'strong' ? '15%' : '8%';
  return {
    'border-color': `color-mix(in srgb, ${accent} ${borderMix}, var(--border))`,
    'background-color': `color-mix(in srgb, ${accent} ${bgMix}, var(--card))`,
    'box-shadow': `inset 3px 0 0 0 ${accent}, 0 16px 28px -28px rgba(15,23,42,0.4)`,
  };
}

function semanticBadgeStyle(tone: SemanticTone, active = false): JSX.CSSProperties {
  const accent = semanticAccent(tone);
  return {
    'border-color': `color-mix(in srgb, ${accent} ${active ? '30%' : '18%'}, var(--border))`,
    'background-color': `color-mix(in srgb, ${accent} ${active ? '16%' : '8%'}, var(--card))`,
    color: `color-mix(in srgb, ${accent} 72%, var(--foreground))`,
  };
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

function StatusDot(props: Readonly<{ tone: 'default' | 'success' | 'warning' | 'danger' }>) {
  const toneClass = () => {
    switch (props.tone) {
      case 'success':
        return 'bg-emerald-500';
      case 'warning':
        return 'bg-amber-500';
      case 'danger':
        return 'bg-red-500';
      case 'default':
      default:
        return 'bg-slate-400';
    }
  };

  return <span class={`inline-block h-2 w-2 rounded-full ${toneClass()}`} aria-hidden="true" />;
}

function MetricStrip(props: Readonly<{ items: readonly MetricItem[]; columnsClass?: string }>) {
  return (
    <div class={`grid gap-2 ${props.columnsClass ?? 'sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6'}`}>
      <For each={props.items}>
        {(item) => (
          <div class="cursor-default rounded-md border px-3 py-2.5 select-none" style={semanticSummaryCardStyle(item.tone ?? 'neutral', item.emphasized)}>
            <div class="text-[8px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{item.label}</div>
            <div class="mt-1.5 text-[12px] font-semibold tabular-nums text-foreground">{item.value}</div>
            <Show when={compact(item.note)}>
              <div class="mt-1.5 text-[9px] leading-4 text-muted-foreground">{item.note}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function DefinitionList(props: Readonly<{ items: readonly KeyValueItem[] }>) {
  return (
    <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
      <For each={props.items}>
        {(item, index) => (
          <div class={`grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-3 py-2 text-[10px] ${index() === 0 ? '' : 'border-t border-border/60'}`}>
            <div class="text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{item.label}</div>
            <div class={`${item.mono ? 'font-mono text-[9px] break-all' : 'break-words'} text-foreground`}>{item.value}</div>
          </div>
        )}
      </For>
    </div>
  );
}

function SectionShell(props: Readonly<{ title: string; description?: string; action?: JSX.Element; children: JSX.Element }>) {
  return (
    <section class="space-y-2.5">
      <div class="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="text-[11px] font-semibold text-foreground">{props.title}</div>
          <Show when={props.description}>
            <div class="mt-0.5 text-[9px] leading-[1rem] text-muted-foreground">{props.description}</div>
          </Show>
        </div>
        <Show when={props.action}>
          <div class="flex-shrink-0">{props.action}</div>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

function EmptyState(props: Readonly<{ title: string; message: string }>) {
  return (
    <div class="flex h-full min-h-[12rem] flex-1 items-center justify-center px-6 py-10">
      <div class="max-w-sm text-center">
        <div class="text-[11px] font-semibold text-foreground">{props.title}</div>
        <div class="mt-2 text-[10px] leading-5 text-muted-foreground">{props.message}</div>
      </div>
    </div>
  );
}

function TableShell(props: Readonly<{ children: JSX.Element }>) {
  return <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-none bg-background">{props.children}</div>;
}

function TableHeaderRow(props: Readonly<{ gridClass: string; columns: readonly string[] }>) {
  return (
    <div class={`grid ${props.gridClass} gap-3 border-b border-border/70 bg-muted/[0.08] px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground`}>
      <For each={props.columns}>{(column) => <div>{column}</div>}</For>
    </div>
  );
}

function InspectorShell(props: Readonly<{ children: JSX.Element }>) {
  return <div class="min-h-[18rem] border-t border-border/70 bg-muted/[0.05] xl:min-h-0 xl:border-l xl:border-t-0">{props.children}</div>;
}

function MonoBlock(props: Readonly<{ value: string }>) {
  return (
    <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
      <pre class="max-h-[20rem] overflow-auto px-3 py-3 font-mono text-[9px] leading-5 text-foreground">{props.value}</pre>
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

function slowSummaryTitle(item: DiagnosticsSummaryItem): string {
  return [compact(item.method), compact(item.path) || compact(item.kind) || compact(item.scope)].filter(Boolean).join(' ');
}

function eventTone(event: DiagnosticsEvent): SemanticTone {
  if (typeof event.status_code === 'number' && event.status_code >= 400) {
    return 'error';
  }
  if (event.slow) {
    return 'warning';
  }
  if (compact(event.source) === 'desktop') {
    return 'info';
  }
  return 'primary';
}

function traceTone(trace: DebugConsoleTrace): SemanticTone {
  if (trace.slow) {
    return 'warning';
  }
  if (trace.sources.includes('desktop')) {
    return 'info';
  }
  return 'primary';
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

  const captureStatus = createMemo(() => {
    const cutoff = compact(props.controller.captureCutoffAt());
    if (cutoff) {
      return {
        value: formatTimestamp(cutoff),
        note: 'Counters and buffers were reset by Clear',
      };
    }
    return {
      value: 'Continuous',
      note: 'Clear starts a new local capture window',
    };
  });

  const headerMetrics = createMemo<MetricItem[]>(() => [
    {
      label: 'Events',
      value: String(props.controller.stats().total_events),
      note: `${props.controller.stats().agent_events} agent · ${props.controller.stats().desktop_events} desktop`,
      tone: 'info',
    },
    {
      label: 'Traces',
      value: String(props.controller.stats().trace_count),
      note: `${props.controller.stats().slow_events} slow markers`,
      tone: 'primary',
    },
    {
      label: 'Runtime',
      value: props.controller.runtimeEnabled() ? 'Active' : 'Inactive',
      note: props.controller.streamConnected() ? 'Streaming + auto-sync' : 'Auto-sync snapshot mode',
      tone: props.controller.runtimeEnabled() ? 'success' : 'warning',
      emphasized: true,
    },
    {
      label: 'UI Metrics',
      value: props.controller.collectUIMetrics() ? 'On' : 'Off',
      note: props.controller.collectUIMetrics() ? 'Renderer instrumentation enabled' : 'Local probes paused',
      tone: props.controller.collectUIMetrics() ? 'success' : 'neutral',
    },
    {
      label: 'Last Event',
      value: formatTimestamp(props.controller.lastEventAt()),
      note: compact(props.controller.stateDir()) || 'State directory unavailable',
      tone: compact(props.controller.lastEventAt()) ? 'primary' : 'neutral',
    },
    {
      label: 'Capture',
      value: captureStatus().value,
      note: captureStatus().note,
      tone: compact(props.controller.captureCutoffAt()) ? 'warning' : 'neutral',
    },
  ]);

  const tabDescriptors = createMemo<TabDescriptor[]>(() => [
    {
      value: 'requests',
      label: 'Requests',
      description: 'Gateway and desktop request activity',
      count: String(filteredEvents().length),
      tone: 'info',
    },
    {
      value: 'traces',
      label: 'Traces',
      description: 'Grouped request timelines',
      count: String(filteredTraces().length),
      tone: 'primary',
    },
    {
      value: 'ui',
      label: 'UI Performance',
      description: 'Renderer-only frame and layout signals',
      count: String(props.controller.performanceSnapshot().recent_events.length),
      tone: 'success',
    },
    {
      value: 'runtime',
      label: 'Runtime',
      description: 'Collector state and slow summary',
      count: String(props.controller.stats().slow_events),
      tone: 'warning',
    },
    {
      value: 'export',
      label: 'Export',
      description: 'Portable debug bundle preview',
      tone: 'neutral',
    },
  ]);

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
          class="fixed bottom-4 right-4 z-[145] inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/80 bg-background/96 px-3 py-2 text-left shadow-[0_20px_36px_-30px_rgba(15,23,42,0.5)] backdrop-blur transition-colors hover:border-primary/25"
          onClick={props.controller.restore}
          style={semanticInteractiveStyle(props.controller.streamConnected() ? 'success' : 'warning', 'strong')}
        >
          <StatusDot tone={props.controller.streamConnected() ? 'success' : 'warning'} />
          <span class="text-[9px] font-semibold uppercase tracking-[0.14em] text-foreground">Debug Console</span>
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
          defaultSize={{ width: 1120, height: 720 }}
          minSize={{ width: 760, height: 520 }}
          class="debug-console-window border-border/80 shadow-[0_38px_92px_-56px_rgba(15,23,42,0.56)]"
          contentClass="!p-0"
          zIndex={145}
          footer={(
            <div class="flex w-full min-w-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-[9px] text-muted-foreground">
                <span class="inline-flex items-center gap-1.5">
                  <StatusDot tone={props.controller.runtimeEnabled() ? 'success' : 'warning'} />
                  {props.controller.runtimeEnabled() ? 'Runtime collector active' : 'Runtime collector inactive'}
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <StatusDot tone={props.controller.streamConnected() ? 'success' : 'default'} />
                  {props.controller.streamConnected() ? 'Streaming updates' : 'Snapshot only'}
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <StatusDot tone={props.controller.collectUIMetrics() ? 'success' : 'default'} />
                  {props.controller.collectUIMetrics() ? 'UI metrics collecting' : 'UI metrics paused'}
                </span>
                <span>Last snapshot: {formatTimestamp(props.controller.lastSnapshotAt())}</span>
                <span>Capture: {captureStatus().value}</span>
              </div>
              <div class="text-[9px] text-muted-foreground">Live requests refresh automatically. Use Clear to start a fresh local capture window.</div>
            </div>
          )}
        >
          <div class="flex h-full min-h-0 flex-col bg-background text-[10px]">
            <div class="border-b border-border/70 bg-muted/[0.08] px-4 py-3">
              <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Live Diagnostics Console</span>
                    <SettingsPill tone={props.controller.streamConnected() ? 'success' : 'default'}>
                      {props.controller.streamConnected() ? 'Streaming' : 'Snapshot'}
                    </SettingsPill>
                    <SettingsPill>{'Auto-sync 1s'}</SettingsPill>
                  </div>
                  <div class="mt-1 text-[12px] font-semibold text-foreground">Gateway requests, desktop transport, and UI rendering signals in one persistent operator console</div>
                  <div class="mt-1 max-w-3xl text-[10px] leading-5 text-muted-foreground">
                    Mounted above page-level loading so diagnostics stay readable while the rest of the app is reconnecting or rerendering.
                  </div>
                </div>

                <div class="flex w-full flex-col gap-2 xl:w-[24rem]">
                  <div>
                    <label class="mb-1 block text-[8px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Search</label>
                    <input
                      value={query()}
                      onInput={(event) => setQuery(event.currentTarget.value)}
                      class="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-[10px] text-foreground outline-none transition-colors focus:border-primary/35 focus:ring-2 focus:ring-primary/10"
                      placeholder="Filter by path, trace id, message, source..."
                      aria-label="Search diagnostics"
                    />
                  </div>
                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <Button size="sm" variant="outline" class="cursor-pointer text-[10px]" onClick={() => void props.controller.clear()}>
                      Clear
                    </Button>
                    <Button size="sm" variant="secondary" class="cursor-pointer text-[10px]" onClick={() => void exportBundle()} disabled={props.controller.exporting()}>
                      {props.controller.exporting() ? 'Exporting...' : 'Export'}
                    </Button>
                    <Button size="sm" variant="ghost" class="cursor-pointer text-[10px]" onClick={props.controller.minimize}>
                      Minimize
                    </Button>
                  </div>
                </div>
              </div>

              <div class="mt-3">
                <MetricStrip items={headerMetrics()} />
              </div>

              <Show when={combinedError()}>
                <div class="mt-3 rounded-md border px-3 py-2 text-[9px] leading-5 text-amber-900" style={semanticInteractiveStyle('warning', 'strong')}>
                  {combinedError()}
                </div>
              </Show>
            </div>

            <div class="border-b border-border/70 bg-background px-4 py-2.5">
              <div class="flex flex-wrap gap-2" role="tablist" aria-orientation="horizontal">
                <For each={tabDescriptors()}>
                  {(descriptor) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab() === descriptor.value}
                      class={tabButtonClass(tab() === descriptor.value)}
                      onClick={() => setTab(descriptor.value)}
                      style={tab() === descriptor.value ? semanticInteractiveStyle(descriptor.tone ?? 'primary', 'strong') : undefined}
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class={`text-[10px] font-semibold ${tab() === descriptor.value ? 'text-foreground' : 'text-foreground/90'}`}>{descriptor.label}</div>
                          <div class="mt-0.5 text-[9px] leading-[1rem] text-muted-foreground">{descriptor.description}</div>
                        </div>
                        <Show when={compact(descriptor.count)}>
                          <span class="rounded-md border px-1.5 py-0.5 text-[8px] font-semibold tabular-nums" style={semanticBadgeStyle(descriptor.tone ?? 'neutral', tab() === descriptor.value)}>
                            {descriptor.count}
                          </span>
                        </Show>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>

            <main class="min-h-0 flex-1">
                <Show when={!props.controller.loading()} fallback={<EmptyState title="Loading debug console" message="Fetching settings and the latest diagnostics snapshot." />}>
                  <Show when={tab() === 'requests'}>
                    <div class="flex h-full min-h-0 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-1">
                      <section class="min-h-0 flex-1">
                        <TableShell>
                          <div class="border-b border-border/70 px-4 py-3">
                            <div class="text-[11px] font-semibold text-foreground">Request stream</div>
                            <div class="mt-1 text-[9px] leading-[1rem] text-muted-foreground">A dense chronological view of gateway and desktop requests with trace correlation and live updates.</div>
                          </div>
                          <Show
                            when={filteredEvents().length > 0}
                            fallback={<EmptyState title="No request events yet" message="Once gateway or desktop requests flow through this session, they will appear here with trace ids, timing, and scoped metadata." />}
                          >
                            <div class="min-h-0 flex-1 overflow-auto">
                              <div class="min-w-[46rem]">
                                <TableHeaderRow
                                  gridClass="grid-cols-[minmax(0,2.2fr)_7rem_8rem_5rem_6rem]"
                                  columns={['Request', 'Source', 'Trace', 'Status', 'Duration']}
                                />
                                <For each={filteredEvents()}>
                                  {(event) => {
                                    const key = diagnosticsEventKey(event);
                                    return (
                                      <button
                                        type="button"
                                        class={listRowClass(selectedEventKey() === key)}
                                        onClick={() => setSelectedEventKey(key)}
                                        style={selectedEventKey() === key ? semanticInteractiveStyle(eventTone(event), 'strong') : undefined}
                                      >
                                        <div class="grid grid-cols-[minmax(0,2.2fr)_7rem_8rem_5rem_6rem] gap-3 px-3 py-2.5 text-[10px]">
                                          <div class="min-w-0">
                                            <div class="truncate font-medium text-foreground">{eventTitle(event)}</div>
                                            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                                              <span>{formatTimestamp(event.created_at)}</span>
                                              <span>{compact(event.scope) || '-'}</span>
                                              <Show when={compact(event.message)}>
                                                <span class="truncate">{compact(event.message)}</span>
                                              </Show>
                                            </div>
                                          </div>
                                            <div class="flex items-start pt-0.5">
                                              {renderEventBadge(event)}
                                            </div>
                                          <div class="truncate font-mono text-[9px] text-muted-foreground">{compact(event.trace_id) || '-'}</div>
                                          <div class="tabular-nums text-foreground">{typeof event.status_code === 'number' ? event.status_code : '-'}</div>
                                          <div class="tabular-nums text-foreground">{formatDuration(event.duration_ms)}</div>
                                        </div>
                                      </button>
                                    );
                                  }}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </TableShell>
                      </section>

                      <InspectorShell>
                        <div class="h-full overflow-auto px-4 py-4">
                          <Show when={selectedEvent()} fallback={<EmptyState title="Select a request" message="Choose a request row to inspect its trace id, message, and payload details." />}>
                            {(event) => (
                              <div class="space-y-4">
                                <SectionShell title="Overview" description={compact(event().message) || 'No extra message was attached to this event.'}>
                                  <div class="space-y-3">
                                    <div class="flex flex-wrap items-center gap-2">
                                      <div class="text-[11px] font-semibold text-foreground">{eventTitle(event())}</div>
                                      {renderEventBadge(event())}
                                    </div>
                                    <DefinitionList items={detailItemsForEvent(event())} />
                                  </div>
                                </SectionShell>

                                <SectionShell title="Detail JSON" description="Structured payload captured for this event.">
                                  <MonoBlock value={prettyJSON(event().detail)} />
                                </SectionShell>
                              </div>
                            )}
                          </Show>
                        </div>
                      </InspectorShell>
                    </div>
                  </Show>

                  <Show when={tab() === 'traces'}>
                    <div class="flex h-full min-h-0 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:grid-rows-1">
                      <section class="min-h-0 flex-1">
                        <TableShell>
                          <div class="border-b border-border/70 px-4 py-3">
                            <div class="text-[11px] font-semibold text-foreground">Trace groups</div>
                            <div class="mt-1 text-[9px] leading-[1rem] text-muted-foreground">Events grouped by trace id so you can follow one request across scopes without scanning the entire feed.</div>
                          </div>
                          <Show
                            when={filteredTraces().length > 0}
                            fallback={<EmptyState title="No traces yet" message="Traces appear when multiple diagnostics events share the same trace id across the desktop, gateway, and local UI surfaces." />}
                          >
                            <div class="min-h-0 flex-1 overflow-auto">
                              <div class="min-w-[46rem]">
                                <TableHeaderRow
                                  gridClass="grid-cols-[minmax(0,2.4fr)_9rem_5rem_6rem_8rem]"
                                  columns={['Trace', 'Sources', 'Events', 'Max', 'Last Seen']}
                                />
                                <For each={filteredTraces()}>
                                  {(trace) => (
                                    <button
                                      type="button"
                                      class={listRowClass(selectedTraceKey() === trace.key)}
                                      onClick={() => setSelectedTraceKey(trace.key)}
                                      style={selectedTraceKey() === trace.key ? semanticInteractiveStyle(traceTone(trace), 'strong') : undefined}
                                    >
                                      <div class="grid grid-cols-[minmax(0,2.4fr)_9rem_5rem_6rem_8rem] gap-3 px-3 py-2.5 text-[10px]">
                                        <div class="min-w-0">
                                          <div class="truncate font-medium text-foreground">{trace.title}</div>
                                          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                                            <span class="font-mono">{compact(trace.trace_id) || 'generated group'}</span>
                                            <span>{trace.scopes.join(', ') || '-'}</span>
                                          </div>
                                        </div>
                                        <div class="truncate text-muted-foreground">{trace.sources.join(', ') || '-'}</div>
                                        <div class="tabular-nums text-foreground">{trace.events.length}</div>
                                        <div class="tabular-nums text-foreground">{formatDuration(trace.max_duration_ms)}</div>
                                        <div class="text-muted-foreground">{formatTimestamp(trace.last_seen_at)}</div>
                                      </div>
                                    </button>
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </TableShell>
                      </section>

                      <InspectorShell>
                        <div class="h-full overflow-auto px-4 py-4">
                          <Show when={selectedTrace()} fallback={<EmptyState title="Select a trace" message="Choose a grouped trace to inspect the full request lifecycle and participating scopes." />}>
                            {(trace) => (
                              <div class="space-y-4">
                                <SectionShell
                                  title="Trace overview"
                                  description={`Sources: ${trace().sources.join(', ') || '-'} · Scopes: ${trace().scopes.join(', ') || '-'}`}
                                >
                                  <div class="space-y-3">
                                    <div class="flex flex-wrap items-center gap-2">
                                      <div class="text-[11px] font-semibold text-foreground">{trace().title}</div>
                                      <SettingsPill tone={trace().slow ? 'warning' : 'default'}>
                                        {trace().slow ? 'Slow trace' : 'Trace'}
                                      </SettingsPill>
                                    </div>
                                    <DefinitionList items={detailItemsForTrace(trace())} />
                                  </div>
                                </SectionShell>

                                <SectionShell title="Timeline" description="Ordered events within the selected trace.">
                                  <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
                                    <For each={trace().events}>
                                      {(event, index) => (
                                        <div class={`px-3 py-3 ${index() === 0 ? '' : 'border-t border-border/60'}`}>
                                          <div class="flex items-start justify-between gap-3">
                                            <div class="min-w-0">
                                              <div class="truncate text-[10px] font-medium text-foreground">{eventTitle(event)}</div>
                                              <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                                                <span>{formatTimestamp(event.created_at)}</span>
                                                <span>{compact(event.scope) || '-'}</span>
                                                <span>{formatDuration(event.duration_ms)}</span>
                                              </div>
                                              <Show when={compact(event.message)}>
                                                <div class="mt-2 text-[9px] leading-5 text-muted-foreground">{compact(event.message)}</div>
                                              </Show>
                                            </div>
                                            <div class="shrink-0">{renderEventBadge(event)}</div>
                                          </div>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </SectionShell>
                              </div>
                            )}
                          </Show>
                        </div>
                      </InspectorShell>
                    </div>
                  </Show>

                  <Show when={tab() === 'ui'}>
                    <div class="h-full overflow-auto px-4 py-4">
                      <div class="space-y-4">
                        <MetricStrip
                          columnsClass="sm:grid-cols-2 xl:grid-cols-4"
                          items={[
                            {
                              label: 'FPS',
                              value: String(Math.round(props.controller.performanceSnapshot().fps.current || 0)),
                              note: `Avg ${props.controller.performanceSnapshot().fps.average || 0} · Low ${props.controller.performanceSnapshot().fps.low || 0}`,
                            },
                            {
                              label: 'Long Tasks',
                              value: String(props.controller.performanceSnapshot().long_tasks.count),
                              note: `Max ${formatDuration(props.controller.performanceSnapshot().long_tasks.max_duration_ms)}`,
                            },
                            {
                              label: 'Layout Shift',
                              value: String(props.controller.performanceSnapshot().layout_shift.total_score || 0),
                              note: `Peaks ${props.controller.performanceSnapshot().layout_shift.max_score || 0}`,
                            },
                            {
                              label: 'JS Heap',
                              value: formatBytes(props.controller.performanceSnapshot().memory?.used_js_heap_size),
                              note: `Total ${formatBytes(props.controller.performanceSnapshot().memory?.total_js_heap_size)}`,
                            },
                          ]}
                        />

                        <div class="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                          <div class="space-y-4">
                            <SectionShell title="Navigation and paints" description="Browser timing data captured from the current renderer session.">
                              <DefinitionList
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
                            </SectionShell>

                            <SectionShell title="Instrumentation support" description="Capabilities currently available in this browser process.">
                              <DefinitionList
                                items={[
                                  { label: 'Long tasks', value: props.controller.performanceSnapshot().supported.longtask ? 'Supported' : 'Unavailable' },
                                  { label: 'Layout shift', value: props.controller.performanceSnapshot().supported.layout_shift ? 'Supported' : 'Unavailable' },
                                  { label: 'Paint timing', value: props.controller.performanceSnapshot().supported.paint ? 'Supported' : 'Unavailable' },
                                  { label: 'Navigation timing', value: props.controller.performanceSnapshot().supported.navigation ? 'Supported' : 'Unavailable' },
                                  { label: 'Memory', value: props.controller.performanceSnapshot().supported.memory ? 'Supported' : 'Unavailable' },
                                ]}
                              />
                            </SectionShell>
                          </div>

                          <SectionShell title="Recent UI events" description="A local ring buffer for frame drops, long tasks, and layout spikes.">
                            <Show
                              when={props.controller.performanceSnapshot().recent_events.length > 0}
                              fallback={<EmptyState title="No UI spikes recorded" message="When frame drops, long tasks, or layout shifts happen, they will show up here with a small local event log." />}
                            >
                              <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
                                <For each={props.controller.performanceSnapshot().recent_events}>
                                  {(event, index) => (
                                    <div class={`px-3 py-3 ${index() === 0 ? '' : 'border-t border-border/60'}`}>
                                      <div class="flex items-start justify-between gap-3">
                                        <div class="min-w-0">
                                          <div class="truncate text-[10px] font-medium text-foreground">{eventTitle(event)}</div>
                                          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                                            <span>{formatTimestamp(event.created_at)}</span>
                                            <span>{formatDuration(event.duration_ms)}</span>
                                          </div>
                                          <div class="mt-2 text-[9px] leading-5 text-muted-foreground">{compact(event.message) || '-'}</div>
                                        </div>
                                        <div class="shrink-0">{renderEventBadge(event)}</div>
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </SectionShell>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <Show when={tab() === 'runtime'}>
                    <div class="h-full overflow-auto px-4 py-4">
                      <div class="space-y-4">
                        <MetricStrip
                          columnsClass="sm:grid-cols-2 xl:grid-cols-5"
                          items={[
                            { label: 'Events', value: String(props.controller.stats().total_events) },
                            { label: 'Agent', value: String(props.controller.stats().agent_events) },
                            { label: 'Desktop', value: String(props.controller.stats().desktop_events) },
                            { label: 'Slow', value: String(props.controller.stats().slow_events) },
                            { label: 'Traces', value: String(props.controller.stats().trace_count) },
                          ]}
                        />

                        <div class="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                          <SectionShell title="Collector state" description="Persisted settings, runtime enablement, and current storage location.">
                            <DefinitionList
                              items={[
                                { label: 'Configured', value: props.controller.enabled() ? 'Enabled' : 'Disabled' },
                                { label: 'Runtime collector', value: props.controller.runtimeEnabled() ? 'Active' : 'Inactive' },
                                { label: 'Stream', value: props.controller.streamConnected() ? 'Connected' : 'Disconnected' },
                                { label: 'UI metrics', value: props.controller.collectUIMetrics() ? 'Enabled' : 'Disabled' },
                                { label: 'State dir', value: compact(props.controller.stateDir()) || '-', mono: true },
                                { label: 'Last snapshot', value: formatTimestamp(props.controller.lastSnapshotAt()) },
                              ]}
                            />
                          </SectionShell>

                          <SectionShell title="Slow summary" description="Aggregated hotspots from the live in-memory diagnostics buffer.">
                            <Show
                              when={props.controller.slowSummary().length > 0}
                              fallback={<EmptyState title="No slow hotspots" message="Slow summaries populate from the same live event buffer shown in the Requests tab." />}
                            >
                              <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
                                <TableHeaderRow
                                  gridClass="grid-cols-[minmax(0,2fr)_4rem_4rem_6rem_6rem]"
                                  columns={['Signature', 'Seen', 'Slow', 'Avg', 'Max']}
                                />
                                <For each={props.controller.slowSummary()}>
                                  {(item) => (
                                    <div class="border-b border-border/50 px-3 py-2.5 last:border-b-0">
                                      <div class="grid grid-cols-[minmax(0,2fr)_4rem_4rem_6rem_6rem] gap-3 text-[10px]">
                                        <div class="min-w-0">
                                          <div class="truncate font-medium text-foreground">{slowSummaryTitle(item)}</div>
                                          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                                            <span>{compact(item.scope) || '-'}</span>
                                            <span>{formatTimestamp(item.last_seen_at)}</span>
                                          </div>
                                        </div>
                                        <div class="tabular-nums text-foreground">{item.count}</div>
                                        <div class="tabular-nums text-foreground">{item.slow_count}</div>
                                        <div class="tabular-nums text-foreground">{formatDuration(item.avg_duration_ms)}</div>
                                        <div class="tabular-nums text-foreground">{formatDuration(item.max_duration_ms)}</div>
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </SectionShell>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <Show when={tab() === 'export'}>
                    <div class="h-full overflow-auto px-4 py-4">
                      <div class="space-y-4">
                        <div class="grid gap-4 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]">
                          <div class="space-y-4">
                            <SectionShell title="Bundle contents" description="Portable diagnostics you can attach to reviews, incident threads, or local debugging notes.">
                              <DefinitionList
                                items={[
                                  { label: 'Last export', value: formatTimestamp(props.controller.lastExportAt()) },
                                  { label: 'Server events', value: String(props.controller.serverEvents().length) },
                                  { label: 'Trace groups', value: String(props.controller.traces().length) },
                                  { label: 'UI events', value: String(props.controller.performanceSnapshot().recent_events.length) },
                                ]}
                              />
                            </SectionShell>

                            <SectionShell title="Included sources" description="The export merges persisted diagnostics with browser-local performance data.">
                              <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
                                <div class="border-b border-border/60 px-3 py-2.5 text-xs">
                                  <div class="font-medium text-foreground">Backend diagnostics</div>
                                  <div class="mt-1 text-[9px] leading-5 text-muted-foreground">Snapshot summary, agent event list, desktop event list, and runtime state directory.</div>
                                </div>
                                <div class="border-b border-border/60 px-3 py-2.5 text-xs">
                                  <div class="font-medium text-foreground">Current settings</div>
                                  <div class="mt-1 text-[9px] leading-5 text-muted-foreground">
                                    <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">debug_console.enabled</code>
                                    {' and '}
                                    <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">collect_ui_metrics</code>
                                    {' at export time.'}
                                  </div>
                                </div>
                                <div class="px-3 py-2.5 text-xs">
                                  <div class="font-medium text-foreground">UI performance snapshot</div>
                                  <div class="mt-1 text-[9px] leading-5 text-muted-foreground">Renderer-local FPS, long-task, layout-shift, paint, navigation, memory, and recent UI event data.</div>
                                </div>
                              </div>
                            </SectionShell>
                          </div>

                          <SectionShell title="Bundle preview" description="High-level JSON preview of the current export payload.">
                            <MonoBlock value={prettyJSON({
                              runtime_enabled: props.controller.runtimeEnabled(),
                              stream_connected: props.controller.streamConnected(),
                              ui_metrics_enabled: props.controller.collectUIMetrics(),
                              stats: props.controller.stats(),
                              state_dir: props.controller.stateDir() || undefined,
                            })}
                            />
                          </SectionShell>
                        </div>

                        <div class="flex items-center justify-end">
                          <Button variant="default" class="cursor-pointer text-[10px]" onClick={() => void exportBundle()} disabled={props.controller.exporting()}>
                            {props.controller.exporting() ? 'Exporting...' : 'Download debug bundle'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Show>
                </Show>
              </main>
          </div>
        </PersistentFloatingWindow>
      </Show>
    </>
  );
}
