import { For, Index, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
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

type DebugConsoleTabDefinition = Readonly<{
  value: DebugConsoleTab;
  label: string;
  description: string;
  tone?: SemanticTone;
  hasCount?: boolean;
}>;

const DEBUG_CONSOLE_TABS: readonly DebugConsoleTabDefinition[] = [
  {
    value: 'requests',
    label: 'Requests',
    description: 'Redeven API and RPC activity',
    tone: 'info',
    hasCount: true,
  },
  {
    value: 'traces',
    label: 'Traces',
    description: 'Grouped API and RPC timelines',
    tone: 'primary',
    hasCount: true,
  },
  {
    value: 'ui',
    label: 'UI Performance',
    description: 'Renderer-only frame and layout signals',
    tone: 'success',
    hasCount: true,
  },
  {
    value: 'runtime',
    label: 'Runtime',
    description: 'Collector state and slow summary',
    tone: 'warning',
    hasCount: true,
  },
  {
    value: 'export',
    label: 'Export',
    description: 'Portable debug bundle preview',
    tone: 'neutral',
  },
] as const;

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
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type EventDebugDetail = Readonly<{
  transport?: string;
  operation?: string;
  type_id?: number;
  request?: Readonly<{
    url?: string;
    path?: string;
    query?: string;
    headers?: Record<string, unknown>;
    payload?: unknown;
    payload_kind?: string;
    payload_summary?: string;
    content_type?: string;
    truncated?: boolean;
    size_bytes?: number;
  }>;
  response?: Readonly<{
    ok?: boolean;
    status?: number;
    status_text?: string;
    headers?: Record<string, unknown>;
    payload?: unknown;
    payload_kind?: string;
    payload_summary?: string;
    content_type?: string;
    truncated?: boolean;
    size_bytes?: number;
    error_message?: string;
  }>;
}>;

function eventDebugDetail(event: DiagnosticsEvent): EventDebugDetail {
  if (!event.detail || typeof event.detail !== 'object') {
    return {};
  }
  return event.detail as EventDebugDetail;
}

function eventRequestDetail(event: DiagnosticsEvent): EventDebugDetail['request'] {
  return eventDebugDetail(event).request;
}

function eventResponseDetail(event: DiagnosticsEvent): EventDebugDetail['response'] {
  return eventDebugDetail(event).response;
}

function eventTransport(event: DiagnosticsEvent): string {
  return compact(eventDebugDetail(event).transport);
}

function eventOperation(event: DiagnosticsEvent): string {
  return compact(eventDebugDetail(event).operation);
}

function eventRequestURL(event: DiagnosticsEvent): string {
  return compact(eventRequestDetail(event)?.url)
    || compact(event.path)
    || compact(eventRequestDetail(event)?.path)
    || eventOperation(event)
    || compact(event.kind)
    || compact(event.scope);
}

function eventFailureMessage(event: DiagnosticsEvent): string {
  return compact(eventResponseDetail(event)?.error_message) || compact(event.message);
}

function eventFailed(event: DiagnosticsEvent): boolean {
  return (typeof event.status_code === 'number' && event.status_code >= 400)
    || compact(event.kind).toLowerCase().includes('failed')
    || compact(eventResponseDetail(event)?.error_message).length > 0;
}

function eventStatusLabel(event: DiagnosticsEvent): string {
  if (typeof event.status_code === 'number' && event.status_code > 0) {
    return String(event.status_code);
  }
  return eventFailed(event) ? 'Failed' : '-';
}

function eventTitle(event: DiagnosticsEvent): string {
  const method = compact(event.method);
  const path = eventRequestURL(event);
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

function dangerTextStyle(): JSX.CSSProperties {
  return {
    color: 'color-mix(in srgb, var(--error) 82%, rgb(76 5 25))',
  };
}

function mergeStyles(...styles: Array<JSX.CSSProperties | undefined>): JSX.CSSProperties | undefined {
  const next: JSX.CSSProperties = {};
  for (const style of styles) {
    if (!style) {
      continue;
    }
    Object.assign(next, style);
  }
  return Object.keys(next).length > 0 ? next : undefined;
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
  const request = eventRequestDetail(event);
  const response = eventResponseDetail(event);
  return [
    { label: 'URL / Operation', value: eventRequestURL(event) || '-', mono: true },
    { label: 'Transport', value: eventTransport(event) || compact(event.scope) || '-' },
    { label: 'Source', value: compact(event.source) || 'unknown' },
    { label: 'Scope', value: compact(event.scope) || '-' },
    { label: 'Kind', value: compact(event.kind) || '-' },
    { label: 'Trace ID', value: compact(event.trace_id) || '-', mono: true },
    { label: 'Status', value: eventStatusLabel(event) },
    { label: 'Status text', value: compact(response?.status_text) || '-' },
    { label: 'Duration', value: formatDuration(event.duration_ms) },
    { label: 'Request type', value: compact(request?.payload_kind) || '-' },
    { label: 'Response type', value: compact(response?.payload_kind) || '-' },
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

function hasValue(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  if (typeof value === 'string') {
    return compact(value).length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

function requestPayloadPreview(event: DiagnosticsEvent): unknown {
  const request = eventRequestDetail(event);
  if (hasValue(request?.payload)) {
    return request?.payload;
  }
  if (hasValue(request?.payload_summary)) {
    return request?.payload_summary;
  }
  return null;
}

function responsePayloadPreview(event: DiagnosticsEvent): unknown {
  const response = eventResponseDetail(event);
  if (hasValue(response?.payload)) {
    return response?.payload;
  }
  if (hasValue(response?.payload_summary)) {
    return response?.payload_summary;
  }
  if (hasValue(response?.error_message)) {
    return { error_message: response?.error_message };
  }
  return null;
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
  if (eventFailed(event)) {
    return <SettingsPill tone="danger">{eventStatusLabel(event)}</SettingsPill>;
  }
  if (event.slow) {
    return <SettingsPill tone="warning">Slow</SettingsPill>;
  }
  if (compact(event.source) === 'browser') {
    return <SettingsPill tone="success">Browser</SettingsPill>;
  }
  return <SettingsPill>{compact(event.source) || 'event'}</SettingsPill>;
}

function slowSummaryTitle(item: DiagnosticsSummaryItem): string {
  return [compact(item.method), compact(item.path) || compact(item.kind) || compact(item.scope)].filter(Boolean).join(' ');
}

function eventTone(event: DiagnosticsEvent): SemanticTone {
  if (eventFailed(event)) {
    return 'error';
  }
  if (event.slow) {
    return 'warning';
  }
  if (compact(event.source) === 'browser') {
    return 'success';
  }
  if (compact(event.source) === 'desktop') {
    return 'info';
  }
  return 'primary';
}

function traceTone(trace: DebugConsoleTrace): SemanticTone {
  if (trace.events.some((event) => eventFailed(event))) {
    return 'error';
  }
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
  const requestTabCount = createMemo(() => filteredEvents().length);
  const traceTabCount = createMemo(() => filteredTraces().length);
  const uiEventTabCount = createMemo(() => props.controller.performanceSnapshot().recent_events.length);
  const runtimeTabCount = createMemo(() => props.controller.stats().slow_events);

  const combinedError = createMemo(() => {
    return [props.controller.snapshotError(), props.controller.streamError()]
      .map((value) => compact(value))
      .filter(Boolean)
      .join(' · ');
  });

  const tabCountLabel = (value: DebugConsoleTab): string | undefined => {
    switch (value) {
      case 'requests':
        return String(requestTabCount());
      case 'traces':
        return String(traceTabCount());
      case 'ui':
        return String(uiEventTabCount());
      case 'runtime':
        return String(runtimeTabCount());
      case 'export':
      default:
        return undefined;
    }
  };

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
                  {props.controller.runtimeEnabled() ? 'Diagnostics active' : 'Diagnostics unavailable'}
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <StatusDot tone={props.controller.streamConnected() ? 'success' : 'default'} />
                  {props.controller.streamConnected() ? 'Streaming updates' : 'Snapshot only'}
                </span>
                <span class="inline-flex items-center gap-1.5">
                  <StatusDot tone={props.controller.uiMetricsCollecting() ? 'success' : 'default'} />
                  {props.controller.uiMetricsCollecting() ? 'UI probes active' : 'UI probes paused'}
                </span>
                <span>Last snapshot: {formatTimestamp(props.controller.lastSnapshotAt())}</span>
              </div>
              <div class="text-[9px] text-muted-foreground">Focused on Redeven API/RPC traffic. Static assets are excluded. Clear resets the current local capture window.</div>
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
                    <SettingsPill>{'RPC / API only'}</SettingsPill>
                  </div>
                  <div class="mt-1 text-[12px] font-semibold text-foreground">Track Redeven API and RPC request chains without mixing in browser asset noise</div>
                  <div class="mt-1 max-w-3xl text-[10px] leading-5 text-muted-foreground">
                    Static CSS, JS, document loads, and diagnostics self-requests are excluded so the console stays focused on real operations and their request / response timing.
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
                    <Button size="sm" variant="secondary" class="cursor-pointer text-[10px]" onClick={() => void props.controller.closeConsole()}>
                      Close Console
                    </Button>
                    <Button size="sm" variant="ghost" class="cursor-pointer text-[10px]" onClick={props.controller.minimize}>
                      Minimize
                    </Button>
                  </div>
                </div>
              </div>

              <Show when={combinedError()}>
                <div class="mt-3 rounded-md border px-3 py-2 text-[9px] leading-5 text-amber-900" style={semanticInteractiveStyle('warning', 'strong')}>
                  {combinedError()}
                </div>
              </Show>
            </div>

            <div class="border-b border-border/70 bg-background px-4 py-2.5">
              <div class="flex flex-wrap gap-2" role="tablist" aria-orientation="horizontal">
                <Index each={DEBUG_CONSOLE_TABS}>
                  {(descriptor) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab() === descriptor().value}
                      class={tabButtonClass(tab() === descriptor().value)}
                      onClick={() => setTab(descriptor().value)}
                      style={tab() === descriptor().value ? semanticInteractiveStyle(descriptor().tone ?? 'primary', 'strong') : undefined}
                    >
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <div class={`text-[10px] font-semibold ${tab() === descriptor().value ? 'text-foreground' : 'text-foreground/90'}`}>{descriptor().label}</div>
                          <div class="mt-0.5 text-[9px] leading-[1rem] text-muted-foreground">{descriptor().description}</div>
                        </div>
                        <Show when={descriptor().hasCount}>
                          <span class="rounded-md border px-1.5 py-0.5 text-[8px] font-semibold tabular-nums" style={semanticBadgeStyle(descriptor().tone ?? 'neutral', tab() === descriptor().value)}>
                            {tabCountLabel(descriptor().value)}
                          </span>
                        </Show>
                      </div>
                    </button>
                  )}
                </Index>
              </div>
            </div>

            <main class="min-h-0 flex-1">
                <Show when={!props.controller.loading()} fallback={<EmptyState title="Loading debug console" message="Fetching the latest diagnostics snapshot." />}>
                  <Show when={tab() === 'requests'}>
                    <div class="flex h-full min-h-0 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-1">
                      <section class="min-h-0 flex-1">
                        <TableShell>
                          <div class="border-b border-border/70 px-4 py-3">
                            <div class="text-[11px] font-semibold text-foreground">Request stream</div>
                            <div class="mt-1 text-[9px] leading-[1rem] text-muted-foreground">A chronological view of Redeven API and RPC calls with trace correlation, request timing, and live updates. Static assets are filtered out.</div>
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
                                    const selected = () => selectedEventKey() === key;
                                    return (
                                      <button
                                        type="button"
                                        class={listRowClass(selected())}
                                        onClick={() => setSelectedEventKey(key)}
                                        style={mergeStyles(
                                          selected() ? semanticInteractiveStyle(eventTone(event), 'strong') : undefined,
                                          eventFailed(event) ? dangerTextStyle() : undefined,
                                        )}
                                      >
                                        <div class="grid grid-cols-[minmax(0,2.2fr)_7rem_8rem_5rem_6rem] gap-3 px-3 py-2.5 text-[10px]">
                                          <div class="min-w-0">
                                            <div class="whitespace-normal break-all font-medium leading-[1rem]">{eventTitle(event)}</div>
                                            <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                                              <span>{formatTimestamp(event.created_at)}</span>
                                              <span>{eventTransport(event) || compact(event.scope) || '-'}</span>
                                              <Show when={compact(eventOperation(event))}>
                                                <span class="font-mono">{eventOperation(event)}</span>
                                              </Show>
                                              <Show when={compact(event.message)}>
                                                <span class={`${eventFailed(event) ? 'font-medium' : ''} whitespace-normal break-words`}>{eventFailureMessage(event)}</span>
                                              </Show>
                                            </div>
                                          </div>
                                          <div class="flex items-start pt-0.5">
                                            {renderEventBadge(event)}
                                          </div>
                                          <div class="truncate font-mono text-[9px] text-muted-foreground">{compact(event.trace_id) || '-'}</div>
                                          <div class={`tabular-nums ${eventFailed(event) ? 'font-semibold' : ''}`}>{eventStatusLabel(event)}</div>
                                          <div class={`tabular-nums ${eventFailed(event) ? 'font-semibold' : ''}`}>{formatDuration(event.duration_ms)}</div>
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
                                <SectionShell title="Overview" description={eventFailureMessage(event()) || 'No extra message was attached to this event.'}>
                                  <div class="space-y-3">
                                    <div class="flex flex-wrap items-center gap-2">
                                      <div class={`text-[11px] font-semibold ${eventFailed(event()) ? '' : 'text-foreground'}`} style={eventFailed(event()) ? dangerTextStyle() : undefined}>
                                        {eventTitle(event())}
                                      </div>
                                      {renderEventBadge(event())}
                                    </div>
                                    <DefinitionList items={detailItemsForEvent(event())} />
                                  </div>
                                </SectionShell>

                                <SectionShell title="Request payload" description="Captured request URL, headers, and payload sent from the browser or RPC layer.">
                                  <Show
                                    when={requestPayloadPreview(event()) != null}
                                    fallback={<EmptyState title="No request payload" message="This event did not carry a request body, or the payload was not serializable." />}
                                  >
                                    <div class="space-y-3">
                                      <DefinitionList
                                        items={[
                                          { label: 'URL', value: eventRequestURL(event()) || '-', mono: true },
                                          { label: 'Content type', value: compact(eventRequestDetail(event())?.content_type) || '-' },
                                          { label: 'Body type', value: compact(eventRequestDetail(event())?.payload_kind) || '-' },
                                        ]}
                                      />
                                      <MonoBlock value={prettyJSON(requestPayloadPreview(event()))} />
                                    </div>
                                  </Show>
                                </SectionShell>

                                <SectionShell title="Response payload" description="Captured response body, status, and any client-side failure message.">
                                  <Show
                                    when={responsePayloadPreview(event()) != null}
                                    fallback={<EmptyState title="No response payload" message="This event did not return a body, or the response was streamed without a terminal payload." />}
                                  >
                                    <div class="space-y-3">
                                      <DefinitionList
                                        items={[
                                          { label: 'Status', value: eventStatusLabel(event()) },
                                          { label: 'Status text', value: compact(eventResponseDetail(event())?.status_text) || '-' },
                                          { label: 'Content type', value: compact(eventResponseDetail(event())?.content_type) || '-' },
                                          { label: 'Body type', value: compact(eventResponseDetail(event())?.payload_kind) || '-' },
                                        ]}
                                      />
                                      <MonoBlock value={prettyJSON(responsePayloadPreview(event()))} />
                                    </div>
                                  </Show>
                                </SectionShell>

                                <SectionShell title="Raw event detail" description="Full normalized event detail for low-level inspection and copy/paste debugging.">
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
                                          <div class="whitespace-normal break-all font-medium text-foreground">{trace.title}</div>
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
                                              <div class={`whitespace-normal break-all text-[10px] font-medium ${eventFailed(event) ? '' : 'text-foreground'}`} style={eventFailed(event) ? dangerTextStyle() : undefined}>
                                                {eventTitle(event)}
                                              </div>
                                              <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground">
                                                <span>{formatTimestamp(event.created_at)}</span>
                                                <span>{compact(event.scope) || '-'}</span>
                                                <span>{formatDuration(event.duration_ms)}</span>
                                              </div>
                                              <Show when={compact(event.message)}>
                                                <div class={`mt-2 text-[9px] leading-5 ${eventFailed(event) ? '' : 'text-muted-foreground'}`} style={eventFailed(event) ? dangerTextStyle() : undefined}>
                                                  {eventFailureMessage(event)}
                                                </div>
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
                        <Show when={!props.controller.collectUIMetrics()}>
                          <div class="rounded-md border border-border/70 bg-muted/[0.08] px-3 py-2.5 text-[9px] leading-5 text-muted-foreground">
                            Core renderer probes stay live while Debug Console is open. Enable <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">collect_ui_metrics</code> in Settings to add browser-native long-task, layout-shift, paint, navigation, and memory capture to this panel and exported bundles.
                          </div>
                        </Show>

                        <MetricStrip
                          columnsClass="sm:grid-cols-2 xl:grid-cols-5"
                          items={[
                            {
                              label: 'FPS',
                              value: String(Math.round(props.controller.performanceSnapshot().fps.current || 0)),
                              note: `Avg ${props.controller.performanceSnapshot().fps.average || 0} · Low ${props.controller.performanceSnapshot().fps.low || 0}`,
                            },
                            {
                              label: 'Long Frames',
                              value: String(props.controller.performanceSnapshot().frame_timing.long_frame_count),
                              note: `Max gap ${formatDuration(props.controller.performanceSnapshot().frame_timing.max_frame_ms)}`,
                            },
                            {
                              label: 'Input Delay',
                              value: formatDuration(props.controller.performanceSnapshot().interactions.last_paint_delay_ms),
                              note: `Max ${formatDuration(props.controller.performanceSnapshot().interactions.max_paint_delay_ms)}`,
                            },
                            {
                              label: 'DOM Mutations',
                              value: String(props.controller.performanceSnapshot().dom_activity.mutation_records),
                              note: `Batches ${props.controller.performanceSnapshot().dom_activity.mutation_batches}`,
                            },
                            {
                              label: 'Long Tasks',
                              value: props.controller.collectUIMetrics() ? String(props.controller.performanceSnapshot().long_tasks.count) : 'Off',
                              note: props.controller.collectUIMetrics()
                                ? `Max ${formatDuration(props.controller.performanceSnapshot().long_tasks.max_duration_ms)}`
                                : 'Advanced browser metrics optional',
                            },
                          ]}
                        />

                        <div class="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                          <div class="space-y-4">
                            <SectionShell title="Renderer probes" description="Always-on local probes for frame timing, interaction-to-paint delay, and DOM churn.">
                              <DefinitionList
                                items={[
                                  { label: 'Collecting', value: props.controller.performanceSnapshot().collecting ? 'Yes' : 'No' },
                                  { label: 'FPS samples', value: String(props.controller.performanceSnapshot().fps.samples) },
                                  { label: 'Last frame gap', value: formatDuration(props.controller.performanceSnapshot().frame_timing.last_frame_ms) },
                                  { label: 'Max frame gap', value: formatDuration(props.controller.performanceSnapshot().frame_timing.max_frame_ms) },
                                  { label: 'Interactions', value: String(props.controller.performanceSnapshot().interactions.count) },
                                  { label: 'Last input', value: compact(props.controller.performanceSnapshot().interactions.last_type) || '-' },
                                  { label: 'Last input delay', value: formatDuration(props.controller.performanceSnapshot().interactions.last_paint_delay_ms) },
                                  { label: 'Mutation batches', value: String(props.controller.performanceSnapshot().dom_activity.mutation_batches) },
                                  { label: 'Mutation records', value: String(props.controller.performanceSnapshot().dom_activity.mutation_records) },
                                  { label: 'Nodes added', value: String(props.controller.performanceSnapshot().dom_activity.nodes_added) },
                                  { label: 'Nodes removed', value: String(props.controller.performanceSnapshot().dom_activity.nodes_removed) },
                                  { label: 'Last mutation', value: formatTimestamp(props.controller.performanceSnapshot().dom_activity.last_mutation_at) },
                                ]}
                              />
                            </SectionShell>

                            <SectionShell
                              title="Navigation and paints"
                              description={props.controller.collectUIMetrics()
                                ? 'Browser timing data captured from the current renderer session.'
                                : 'Enable collect_ui_metrics to capture browser-native paint, navigation, and memory timing in this panel.'}
                            >
                              <DefinitionList
                                items={[
                                  { label: 'First paint', value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().paints.first_paint_ms) : 'Off' },
                                  { label: 'First contentful paint', value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().paints.first_contentful_paint_ms) : 'Off' },
                                  { label: 'Navigation type', value: props.controller.collectUIMetrics() ? (compact(props.controller.performanceSnapshot().navigation.type) || '-') : 'Off' },
                                  { label: 'DOMContentLoaded', value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().navigation.dom_content_loaded_ms) : 'Off' },
                                  { label: 'Load event', value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().navigation.load_event_ms) : 'Off' },
                                  { label: 'Response end', value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().navigation.response_end_ms) : 'Off' },
                                  { label: 'JS heap used', value: props.controller.collectUIMetrics() ? formatBytes(props.controller.performanceSnapshot().memory?.used_js_heap_size) : 'Off' },
                                  { label: 'JS heap total', value: props.controller.collectUIMetrics() ? formatBytes(props.controller.performanceSnapshot().memory?.total_js_heap_size) : 'Off' },
                                ]}
                              />
                            </SectionShell>

                            <SectionShell
                              title="Instrumentation support"
                              description={props.controller.collectUIMetrics()
                                ? 'Capabilities currently available in this browser process.'
                                : 'Capabilities shown below are available in this browser, but advanced capture is currently optional.'}
                            >
                              <DefinitionList
                                items={[
                                  { label: 'Long tasks', value: props.controller.performanceSnapshot().supported.longtask ? 'Supported' : 'Unavailable' },
                                  { label: 'Layout shift', value: props.controller.performanceSnapshot().supported.layout_shift ? 'Supported' : 'Unavailable' },
                                  { label: 'Paint timing', value: props.controller.performanceSnapshot().supported.paint ? 'Supported' : 'Unavailable' },
                                  { label: 'Navigation timing', value: props.controller.performanceSnapshot().supported.navigation ? 'Supported' : 'Unavailable' },
                                  { label: 'Memory', value: props.controller.performanceSnapshot().supported.memory ? 'Supported' : 'Unavailable' },
                                  { label: 'Mutation observer', value: props.controller.performanceSnapshot().supported.mutation_observer ? 'Supported' : 'Unavailable' },
                                  { label: 'Interaction latency', value: props.controller.performanceSnapshot().supported.interaction_latency ? 'Supported' : 'Unavailable' },
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
                                          <div class="whitespace-normal break-all text-[10px] font-medium text-foreground">{eventTitle(event)}</div>
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
                          <SectionShell title="Collector state" description="Frontend console visibility, diagnostics runtime, and current storage location.">
                            <DefinitionList
                              items={[
                                { label: 'Console visible', value: props.controller.enabled() ? 'Yes' : 'No' },
                                { label: 'Diagnostics runtime', value: props.controller.runtimeEnabled() ? 'Active' : 'Inactive' },
                                { label: 'Stream', value: props.controller.streamConnected() ? 'Connected' : 'Disconnected' },
                                { label: 'UI probes', value: props.controller.uiMetricsCollecting() ? 'Active' : 'Inactive' },
                                { label: 'Advanced UI metrics', value: props.controller.collectUIMetrics() ? 'Enabled' : 'Optional' },
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

                            <SectionShell
                              title="Included sources"
                              description={props.controller.collectUIMetrics()
                                ? 'The export merges persisted diagnostics with browser-local performance data.'
                                : 'Core request diagnostics are always exported. Advanced browser-native UI timings join the bundle only when collect_ui_metrics is enabled.'}
                            >
                              <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
                                <div class="border-b border-border/60 px-3 py-2.5 text-xs">
                                  <div class="font-medium text-foreground">Backend diagnostics</div>
                                  <div class="mt-1 text-[9px] leading-5 text-muted-foreground">Snapshot summary, agent event list, desktop event list, and runtime state directory.</div>
                                </div>
                                <div class="border-b border-border/60 px-3 py-2.5 text-xs">
                                  <div class="font-medium text-foreground">Current UI state</div>
                                  <div class="mt-1 text-[9px] leading-5 text-muted-foreground">
                                    <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">visible</code>
                                    {' and '}
                                    <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">minimized</code>
                                    {' flags from the current frontend console state. UI metrics are collected automatically while the console is visible.'}
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
                              console_visible: props.controller.enabled(),
                              diagnostics_enabled: props.controller.runtimeEnabled(),
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
