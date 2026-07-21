import { For, Index, Show, createEffect, createMemo, createSignal, type JSX } from 'solid-js';
import { cn, createUIFirstSelection } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';

import { SettingsPill } from '../pages/settings/SettingsPrimitives';
import {
  diagnosticsEventKey,
  diagnosticsExportFilename,
  type DiagnosticsEvent,
  type DiagnosticsSummaryItem,
} from '../services/diagnosticsApi';
import { PersistentFloatingWindow } from '../widgets/PersistentFloatingWindow';
import { ENV_APP_FLOATING_LAYER, ENV_APP_FLOATING_LAYER_CLASS } from '../utils/envAppLayers';
import { useI18n, type I18nHelpers } from '../i18n';
import type { EnvAppTranslationKey } from '../i18n/locales';
import type { DebugConsoleController, DebugConsoleTrace } from './createDebugConsoleController';
import { UIFirstKeepAlivePanel } from '../primitives/UIFirstKeepAlivePanel';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';

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
  labelKey: EnvAppTranslationKey;
  descriptionKey: EnvAppTranslationKey;
  tone?: SemanticTone;
  hasCount?: boolean;
}>;

const DEBUG_CONSOLE_TABS: readonly DebugConsoleTabDefinition[] = [
  {
    value: 'requests',
    labelKey: 'debugConsole.tabs.requests.label',
    descriptionKey: 'debugConsole.tabs.requests.description',
    tone: 'info',
    hasCount: true,
  },
  {
    value: 'traces',
    labelKey: 'debugConsole.tabs.traces.label',
    descriptionKey: 'debugConsole.tabs.traces.description',
    tone: 'primary',
    hasCount: true,
  },
  {
    value: 'ui',
    labelKey: 'debugConsole.tabs.ui.label',
    descriptionKey: 'debugConsole.tabs.ui.description',
    tone: 'success',
    hasCount: true,
  },
  {
    value: 'runtime',
    labelKey: 'debugConsole.tabs.runtime.label',
    descriptionKey: 'debugConsole.tabs.runtime.description',
    tone: 'warning',
    hasCount: true,
  },
  {
    value: 'export',
    labelKey: 'debugConsole.tabs.export.label',
    descriptionKey: 'debugConsole.tabs.export.description',
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

function eventStatusLabel(event: DiagnosticsEvent, i18n: I18nHelpers): string {
  if (typeof event.status_code === 'number' && event.status_code > 0) {
    return String(event.status_code);
  }
  return eventFailed(event) ? i18n.t('debugConsole.badges.failed') : '-';
}

function eventTitle(event: DiagnosticsEvent): string {
  const method = compact(event.method);
  const path = eventRequestURL(event);
  const kind = compact(event.kind);
  const scope = compact(event.scope);
  return [method, path || kind || scope].filter(Boolean).join(' ');
}

function queryTerms(query: string): string[] {
  return compact(query).toLowerCase().split(/\s+/u).filter(Boolean);
}

function queryMatchesFields(query: string, fields: readonly string[]): boolean {
  const terms = queryTerms(query);
  if (terms.length === 0) return true;
  const haystack = fields.join('\n').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function eventMatchesQuery(event: DiagnosticsEvent, query: string): boolean {
  if (!query) {
    return true;
  }
  const detail = event.detail ? prettyJSON(event.detail) : '';
  return queryMatchesFields(query, [
    eventTitle(event),
    compact(event.source),
    compact(event.scope),
    compact(event.message),
    compact(event.trace_id),
    detail,
  ]);
}

function traceMatchesQuery(trace: DebugConsoleTrace, query: string): boolean {
  if (!query) {
    return true;
  }
  return queryMatchesFields(query, [
    trace.title,
    compact(trace.trace_id),
    trace.scopes.join(' '),
    trace.sources.join(' '),
    ...trace.events.map((event) => compact(event.message)),
    ...trace.events.map((event) => event.detail ? prettyJSON(event.detail) : ''),
  ]);
}

function tabButtonClass(active: boolean): string {
  return active
    ? 'group min-w-[9.75rem] cursor-pointer rounded-md border px-3 py-2.5 text-left shadow-[0_14px_30px_-26px_var(--redeven-shadow-color)] transition-all'
    : 'group min-w-[9.75rem] cursor-pointer rounded-md border border-border/70 bg-background px-3 py-2.5 text-left transition-all hover:border-border hover:bg-muted/[0.14]';
}

function listRowClass(active: boolean): string {
  return active
    ? 'group w-full cursor-pointer border-b border-border/70 bg-background text-left shadow-[inset_0_0_0_1px_var(--redeven-shadow-color)] transition-colors'
    : 'group w-full cursor-pointer border-b border-border/50 bg-background text-left transition-colors hover:bg-muted/[0.12]';
}

function semanticAccent(tone: SemanticTone): string {
  switch (tone) {
    case 'primary':
      return 'var(--redeven-status-primary)';
    case 'success':
      return 'var(--redeven-status-success)';
    case 'warning':
      return 'var(--redeven-status-warning)';
    case 'error':
      return 'var(--redeven-status-error)';
    case 'info':
      return 'var(--redeven-status-info)';
    case 'neutral':
    default:
      return 'var(--redeven-status-neutral)';
  }
}

function semanticSummaryCardStyle(tone: SemanticTone, emphasized = false): JSX.CSSProperties {
  const accent = semanticAccent(tone);
  const borderMix = emphasized ? '26%' : '18%';
  const bgMix = emphasized ? '14%' : '8%';
  return {
    'border-color': `color-mix(in srgb, ${accent} ${borderMix}, var(--border))`,
    background: `linear-gradient(180deg, color-mix(in srgb, ${accent} ${bgMix}, var(--card)) 0%, var(--card) 100%)`,
    'box-shadow': `inset 0 1px 0 color-mix(in srgb, ${accent} ${emphasized ? '34%' : '20%'}, transparent), 0 18px 32px -30px var(--redeven-shadow-color)`,
  };
}

function semanticInteractiveStyle(tone: SemanticTone, emphasis: 'soft' | 'strong' = 'soft'): JSX.CSSProperties {
  const accent = semanticAccent(tone);
  const borderMix = emphasis === 'strong' ? '30%' : '20%';
  const bgMix = emphasis === 'strong' ? '15%' : '8%';
  return {
    'border-color': `color-mix(in srgb, ${accent} ${borderMix}, var(--border))`,
    'background-color': `color-mix(in srgb, ${accent} ${bgMix}, var(--card))`,
    'box-shadow': `inset 3px 0 0 0 ${accent}, 0 16px 28px -28px var(--redeven-shadow-color)`,
  };
}

function dangerTextStyle(): JSX.CSSProperties {
  return {
    color: 'var(--redeven-status-error-foreground)',
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

function boolLabel(i18n: I18nHelpers, value: boolean): string {
  return i18n.t(value ? 'debugConsole.values.yes' : 'debugConsole.values.no');
}

function enabledLabel(i18n: I18nHelpers, value: boolean): string {
  return i18n.t(value ? 'debugConsole.values.enabled' : 'debugConsole.values.optional');
}

function activeLabel(i18n: I18nHelpers, value: boolean): string {
  return i18n.t(value ? 'debugConsole.values.active' : 'debugConsole.values.inactive');
}

function supportedLabel(i18n: I18nHelpers, value: boolean): string {
  return i18n.t(value ? 'debugConsole.values.supported' : 'debugConsole.values.unavailable');
}

function connectedLabel(i18n: I18nHelpers, value: boolean): string {
  return i18n.t(value ? 'debugConsole.values.connected' : 'debugConsole.values.disconnected');
}

function offLabel(i18n: I18nHelpers): string {
  return i18n.t('debugConsole.values.off');
}

function detailItemsForEvent(event: DiagnosticsEvent | null, i18n: I18nHelpers): KeyValueItem[] {
  if (!event) {
    return [];
  }
  const request = eventRequestDetail(event);
  const response = eventResponseDetail(event);
  return [
    { label: i18n.t('debugConsole.fields.urlOperation'), value: eventRequestURL(event) || '-', mono: true },
    { label: i18n.t('debugConsole.fields.transport'), value: eventTransport(event) || compact(event.scope) || '-' },
    { label: i18n.t('debugConsole.fields.source'), value: compact(event.source) || i18n.t('debugConsole.values.unknown') },
    { label: i18n.t('debugConsole.fields.scope'), value: compact(event.scope) || '-' },
    { label: i18n.t('debugConsole.fields.kind'), value: compact(event.kind) || '-' },
    { label: i18n.t('debugConsole.fields.traceId'), value: compact(event.trace_id) || '-', mono: true },
    { label: i18n.t('debugConsole.fields.status'), value: eventStatusLabel(event, i18n) },
    { label: i18n.t('debugConsole.fields.statusText'), value: compact(response?.status_text) || '-' },
    { label: i18n.t('debugConsole.fields.duration'), value: formatDuration(event.duration_ms) },
    { label: i18n.t('debugConsole.fields.requestType'), value: compact(request?.payload_kind) || '-' },
    { label: i18n.t('debugConsole.fields.responseType'), value: compact(response?.payload_kind) || '-' },
    { label: i18n.t('debugConsole.fields.when'), value: formatTimestamp(event.created_at) },
  ];
}

function detailItemsForTrace(trace: DebugConsoleTrace | null, i18n: I18nHelpers): KeyValueItem[] {
  if (!trace) {
    return [];
  }
  return [
    { label: i18n.t('debugConsole.fields.traceId'), value: compact(trace.trace_id) || i18n.t('debugConsole.values.generatedGroup'), mono: true },
    { label: i18n.t('debugConsole.fields.events'), value: String(trace.events.length) },
    { label: i18n.t('debugConsole.fields.status'), value: typeof trace.status_code === 'number' ? String(trace.status_code) : '-' },
    { label: i18n.t('debugConsole.fields.maxDuration'), value: formatDuration(trace.max_duration_ms) },
    { label: i18n.t('debugConsole.fields.totalDuration'), value: formatDuration(trace.total_duration_ms) },
    { label: i18n.t('debugConsole.fields.firstSeen'), value: formatTimestamp(trace.first_seen_at) },
    { label: i18n.t('debugConsole.fields.lastSeen'), value: formatTimestamp(trace.last_seen_at) },
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
        return 'bg-[var(--redeven-status-success)]';
      case 'warning':
        return 'bg-[var(--redeven-status-warning)]';
      case 'danger':
        return 'bg-[var(--redeven-status-error)]';
      case 'default':
      default:
        return 'bg-[var(--redeven-status-neutral)]';
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

function renderEventBadge(event: DiagnosticsEvent, i18n: I18nHelpers) {
  if (eventFailed(event)) {
    return <SettingsPill tone="danger">{eventStatusLabel(event, i18n)}</SettingsPill>;
  }
  if (event.slow) {
    return <SettingsPill tone="warning">{i18n.t('debugConsole.badges.slow')}</SettingsPill>;
  }
  if (compact(event.source) === 'browser') {
    return <SettingsPill tone="success">{i18n.t('debugConsole.badges.browser')}</SettingsPill>;
  }
  return <SettingsPill>{compact(event.source) || i18n.t('debugConsole.badges.event')}</SettingsPill>;
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

export interface DebugConsoleFooterProps {
  controller: DebugConsoleController;
}

export function DebugConsoleFooter(props: DebugConsoleFooterProps) {
  const i18n = useI18n();
  return (
    <div class="flex w-full min-w-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
      <div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-[9px] text-muted-foreground">
        <span class="inline-flex items-center gap-1.5">
          <StatusDot tone={props.controller.runtimeEnabled() ? 'success' : 'warning'} />
          {props.controller.runtimeEnabled() ? i18n.t('debugConsole.footer.diagnosticsActive') : i18n.t('debugConsole.footer.diagnosticsUnavailable')}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <StatusDot tone={props.controller.streamConnected() ? 'success' : 'default'} />
          {props.controller.streamConnected() ? i18n.t('debugConsole.footer.streamingUpdates') : i18n.t('debugConsole.footer.snapshotOnly')}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <StatusDot tone={props.controller.uiMetricsCollecting() ? 'success' : 'default'} />
          {props.controller.uiMetricsCollecting() ? i18n.t('debugConsole.footer.uiProbesActive') : i18n.t('debugConsole.footer.uiProbesPaused')}
        </span>
        <span>{i18n.t('debugConsole.footer.lastSnapshot', { value: formatTimestamp(props.controller.lastSnapshotAt()) })}</span>
      </div>
      <div class="text-[9px] text-muted-foreground">{i18n.t('debugConsole.footer.focusNote')}</div>
    </div>
  );
}

export interface DebugConsolePanelProps {
  controller: DebugConsoleController;
  onClose: () => void;
  closeLabel?: string;
  onMinimize?: () => void;
  showMinimize?: boolean;
}

export function DebugConsolePanel(props: DebugConsolePanelProps) {
  const i18n = useI18n();
  const [tab, setTab] = createSignal<DebugConsoleTab>('requests');
  const [query, setQuery] = createSignal('');
  const [selectedEventKey, setSelectedEventKey] = createSignal('');
  const [selectedTraceKey, setSelectedTraceKey] = createSignal('');
  const tabSelection = createUIFirstSelection<DebugConsoleTab>({
    committed: tab,
    commit: setTab,
    onEvent: createUIPresentationEventRecorder({
      surface: 'debug-console',
      source: 'tab',
    }),
  });

  createEffect(() => {
    const request = props.controller.openRequest();
    if (request.sequence <= 0 || !compact(request.query)) return;
    setQuery(request.query ?? '');
    setTab('traces');
  });

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
    <div class="flex h-full min-h-0 flex-col bg-background text-[10px]">
            <div class="border-b border-border/70 bg-muted/[0.08] px-4 py-3">
              <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{i18n.t('debugConsole.header.eyebrow')}</span>
                    <SettingsPill tone={props.controller.streamConnected() ? 'success' : 'default'}>
                      {props.controller.streamConnected() ? i18n.t('debugConsole.badges.streaming') : i18n.t('debugConsole.badges.snapshot')}
                    </SettingsPill>
                    <SettingsPill>{i18n.t('debugConsole.badges.rpcApiOnly')}</SettingsPill>
                  </div>
                  <div class="mt-1 text-[12px] font-semibold text-foreground">{i18n.t('debugConsole.header.title')}</div>
                  <div class="mt-1 max-w-3xl text-[10px] leading-5 text-muted-foreground">
                    {i18n.t('debugConsole.header.description')}
                  </div>
                </div>

                  <div class="flex w-full flex-col gap-2 xl:w-[24rem]">
                    <div>
                      <label class="mb-1 block text-[8px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{i18n.t('debugConsole.search.label')}</label>
                    <input
                      value={query()}
                      onInput={(event) => setQuery(event.currentTarget.value)}
                      class="w-full rounded-md border border-border/70 bg-background px-3 py-2 text-[10px] text-foreground outline-none transition-colors focus:border-primary/35 focus:ring-2 focus:ring-primary/10"
                      placeholder={i18n.t('debugConsole.search.placeholder')}
                      aria-label={i18n.t('debugConsole.search.ariaLabel')}
                    />
                  </div>
                  <div class="flex flex-wrap items-center justify-end gap-2">
                    <Button size="sm" variant="outline" class="cursor-pointer text-[10px]" onClick={() => void props.controller.clear()}>
                      {i18n.t('debugConsole.actions.clear')}
                    </Button>
                    <Button size="sm" variant="secondary" class="cursor-pointer text-[10px]" onClick={() => void exportBundle()} disabled={props.controller.exporting()}>
                      {props.controller.exporting() ? i18n.t('debugConsole.actions.exporting') : i18n.t('debugConsole.actions.export')}
                    </Button>
                    <Button size="sm" variant="secondary" class="cursor-pointer text-[10px]" onClick={() => props.onClose()}>
                      {props.closeLabel ?? i18n.t('debugConsole.actions.closeConsole')}
                    </Button>
                    <Show when={props.showMinimize !== false && props.onMinimize}>
                      <Button size="sm" variant="ghost" class="cursor-pointer text-[10px]" onClick={() => props.onMinimize?.()}>
                        {i18n.t('debugConsole.actions.minimize')}
                      </Button>
                    </Show>
                  </div>
                </div>
              </div>

              <Show when={combinedError()}>
                <div class="mt-3 rounded-md border px-3 py-2 text-[9px] leading-5 text-[var(--redeven-status-warning-foreground)]" style={semanticInteractiveStyle('warning', 'strong')}>
                  {combinedError()}
                </div>
              </Show>
            </div>

            <div class="border-b border-border/70 bg-background px-4 py-2.5">
              <div class="flex flex-wrap gap-2" role="tablist" aria-orientation="horizontal">
                <Index each={DEBUG_CONSOLE_TABS}>
                  {(descriptor) => {
                    const tabDescriptor = descriptor();
                    return (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tabSelection.visual() === tabDescriptor.value}
                        class={tabButtonClass(tabSelection.visual() === tabDescriptor.value)}
                        onClick={() => tabSelection.request(tabDescriptor.value)}
                        style={tabSelection.visual() === tabDescriptor.value ? semanticInteractiveStyle(tabDescriptor.tone ?? 'primary', 'strong') : undefined}
                      >
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <div class={`text-[10px] font-semibold ${tabSelection.visual() === tabDescriptor.value ? 'text-foreground' : 'text-foreground/90'}`}>{i18n.t(tabDescriptor.labelKey)}</div>
                            <div class="mt-0.5 text-[9px] leading-[1rem] text-muted-foreground">{i18n.t(tabDescriptor.descriptionKey)}</div>
                          </div>
                          <Show when={tabDescriptor.hasCount}>
                            <span class="rounded-md border px-1.5 py-0.5 text-[8px] font-semibold tabular-nums" style={semanticBadgeStyle(tabDescriptor.tone ?? 'neutral', tabSelection.visual() === tabDescriptor.value)}>
                              {tabCountLabel(tabDescriptor.value)}
                            </span>
                          </Show>
                        </div>
                      </button>
                    );
                  }}
                </Index>
              </div>
            </div>

            <main class="relative min-h-0 flex-1">
                <Show when={!props.controller.loading()} fallback={<EmptyState title={i18n.t('debugConsole.empty.loadingTitle')} message={i18n.t('debugConsole.empty.loadingMessage')} />}>
                  <UIFirstKeepAlivePanel active={tab() === 'requests'} class="absolute inset-0" testId="debug-console-panel-requests" render={() => (
                    <div class="flex h-full min-h-0 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-1">
                      <section class="min-h-0 flex-1">
                        <TableShell>
                          <div class="border-b border-border/70 px-4 py-3">
                            <div class="text-[11px] font-semibold text-foreground">{i18n.t('debugConsole.requests.title')}</div>
                            <div class="mt-1 text-[9px] leading-[1rem] text-muted-foreground">{i18n.t('debugConsole.requests.description')}</div>
                          </div>
                          <Show
                            when={filteredEvents().length > 0}
                            fallback={<EmptyState title={i18n.t('debugConsole.empty.noRequestsTitle')} message={i18n.t('debugConsole.empty.noRequestsMessage')} />}
                          >
                            <div class="min-h-0 flex-1 overflow-auto">
                              <div class="min-w-[46rem]">
                                <TableHeaderRow
                                  gridClass="grid-cols-[minmax(0,2.2fr)_7rem_8rem_5rem_6rem]"
                                  columns={[
                                    i18n.t('debugConsole.table.request'),
                                    i18n.t('debugConsole.table.source'),
                                    i18n.t('debugConsole.table.trace'),
                                    i18n.t('debugConsole.table.status'),
                                    i18n.t('debugConsole.table.duration'),
                                  ]}
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
                                            {renderEventBadge(event, i18n)}
                                          </div>
                                          <div class="truncate font-mono text-[9px] text-muted-foreground">{compact(event.trace_id) || '-'}</div>
                                          <div class={`tabular-nums ${eventFailed(event) ? 'font-semibold' : ''}`}>{eventStatusLabel(event, i18n)}</div>
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
                          <Show when={selectedEvent()} fallback={<EmptyState title={i18n.t('debugConsole.empty.selectRequestTitle')} message={i18n.t('debugConsole.empty.selectRequestMessage')} />}>
                            {(event) => (
                              <div class="space-y-4">
                                <SectionShell title={i18n.t('debugConsole.sections.overview')} description={eventFailureMessage(event()) || i18n.t('debugConsole.requests.noExtraMessage')}>
                                  <div class="space-y-3">
                                    <div class="flex flex-wrap items-center gap-2">
                                      <div class={`text-[11px] font-semibold ${eventFailed(event()) ? '' : 'text-foreground'}`} style={eventFailed(event()) ? dangerTextStyle() : undefined}>
                                        {eventTitle(event())}
                                      </div>
                                      {renderEventBadge(event(), i18n)}
                                    </div>
                                    <DefinitionList items={detailItemsForEvent(event(), i18n)} />
                                  </div>
                                </SectionShell>

                                <SectionShell title={i18n.t('debugConsole.sections.requestPayload')} description={i18n.t('debugConsole.requests.requestPayloadDescription')}>
                                  <Show
                                    when={requestPayloadPreview(event()) != null}
                                    fallback={<EmptyState title={i18n.t('debugConsole.empty.noRequestPayloadTitle')} message={i18n.t('debugConsole.empty.noRequestPayloadMessage')} />}
                                  >
                                    <div class="space-y-3">
                                      <DefinitionList
                                        items={[
                                          { label: i18n.t('debugConsole.fields.url'), value: eventRequestURL(event()) || '-', mono: true },
                                          { label: i18n.t('debugConsole.fields.contentType'), value: compact(eventRequestDetail(event())?.content_type) || '-' },
                                          { label: i18n.t('debugConsole.fields.bodyType'), value: compact(eventRequestDetail(event())?.payload_kind) || '-' },
                                        ]}
                                      />
                                      <MonoBlock value={prettyJSON(requestPayloadPreview(event()))} />
                                    </div>
                                  </Show>
                                </SectionShell>

                                <SectionShell title={i18n.t('debugConsole.sections.responsePayload')} description={i18n.t('debugConsole.requests.responsePayloadDescription')}>
                                  <Show
                                    when={responsePayloadPreview(event()) != null}
                                    fallback={<EmptyState title={i18n.t('debugConsole.empty.noResponsePayloadTitle')} message={i18n.t('debugConsole.empty.noResponsePayloadMessage')} />}
                                  >
                                    <div class="space-y-3">
                                      <DefinitionList
                                        items={[
                                          { label: i18n.t('debugConsole.fields.status'), value: eventStatusLabel(event(), i18n) },
                                          { label: i18n.t('debugConsole.fields.statusText'), value: compact(eventResponseDetail(event())?.status_text) || '-' },
                                          { label: i18n.t('debugConsole.fields.contentType'), value: compact(eventResponseDetail(event())?.content_type) || '-' },
                                          { label: i18n.t('debugConsole.fields.bodyType'), value: compact(eventResponseDetail(event())?.payload_kind) || '-' },
                                        ]}
                                      />
                                      <MonoBlock value={prettyJSON(responsePayloadPreview(event()))} />
                                    </div>
                                  </Show>
                                </SectionShell>

                                <SectionShell title={i18n.t('debugConsole.sections.rawEventDetail')} description={i18n.t('debugConsole.requests.rawEventDetailDescription')}>
                                  <MonoBlock value={prettyJSON(event().detail)} />
                                </SectionShell>
                              </div>
                            )}
                          </Show>
                        </div>
                      </InspectorShell>
                    </div>
                  )} />

                  <UIFirstKeepAlivePanel active={tab() === 'traces'} class="absolute inset-0" testId="debug-console-panel-traces" render={() => (
                    <div class="flex h-full min-h-0 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:grid-rows-1">
                      <section class="min-h-0 flex-1">
                        <TableShell>
                          <div class="border-b border-border/70 px-4 py-3">
                            <div class="text-[11px] font-semibold text-foreground">{i18n.t('debugConsole.traces.title')}</div>
                            <div class="mt-1 text-[9px] leading-[1rem] text-muted-foreground">{i18n.t('debugConsole.traces.description')}</div>
                          </div>
                          <Show
                            when={filteredTraces().length > 0}
                            fallback={<EmptyState title={i18n.t('debugConsole.empty.noTracesTitle')} message={i18n.t('debugConsole.empty.noTracesMessage')} />}
                          >
                            <div class="min-h-0 flex-1 overflow-auto">
                              <div class="min-w-[46rem]">
                                <TableHeaderRow
                                  gridClass="grid-cols-[minmax(0,2.4fr)_9rem_5rem_6rem_8rem]"
                                  columns={[
                                    i18n.t('debugConsole.table.trace'),
                                    i18n.t('debugConsole.table.sources'),
                                    i18n.t('debugConsole.table.events'),
                                    i18n.t('debugConsole.table.max'),
                                    i18n.t('debugConsole.table.lastSeen'),
                                  ]}
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
                                            <span class="font-mono">{compact(trace.trace_id) || i18n.t('debugConsole.values.generatedGroup')}</span>
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
                          <Show when={selectedTrace()} fallback={<EmptyState title={i18n.t('debugConsole.empty.selectTraceTitle')} message={i18n.t('debugConsole.empty.selectTraceMessage')} />}>
                            {(trace) => (
                              <div class="space-y-4">
                                <SectionShell
                                  title={i18n.t('debugConsole.sections.traceOverview')}
                                  description={i18n.t('debugConsole.traces.sourcesScopes', { sources: trace().sources.join(', ') || '-', scopes: trace().scopes.join(', ') || '-' })}
                                >
                                  <div class="space-y-3">
                                    <div class="flex flex-wrap items-center gap-2">
                                      <div class="text-[11px] font-semibold text-foreground">{trace().title}</div>
                                      <SettingsPill tone={trace().slow ? 'warning' : 'default'}>
                                        {trace().slow ? i18n.t('debugConsole.badges.slowTrace') : i18n.t('debugConsole.badges.trace')}
                                      </SettingsPill>
                                    </div>
                                    <DefinitionList items={detailItemsForTrace(trace(), i18n)} />
                                  </div>
                                </SectionShell>

                                <SectionShell title={i18n.t('debugConsole.sections.timeline')} description={i18n.t('debugConsole.traces.timelineDescription')}>
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
                                            <div class="shrink-0">{renderEventBadge(event, i18n)}</div>
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
                  )} />

                  <UIFirstKeepAlivePanel active={tab() === 'ui'} class="absolute inset-0" testId="debug-console-panel-ui" render={() => (
                    <div class="h-full overflow-auto px-4 py-4">
                      <div class="space-y-4">
                        <Show when={!props.controller.collectUIMetrics()}>
                          <div class="rounded-md border border-border/70 bg-muted/[0.08] px-3 py-2.5 text-[9px] leading-5 text-muted-foreground">
                            {i18n.t('debugConsole.ui.metricsNoticePrefix')} <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">collect_ui_metrics</code> {i18n.t('debugConsole.ui.metricsNoticeSuffix')}
                          </div>
                        </Show>

                        <MetricStrip
                          columnsClass="sm:grid-cols-2 xl:grid-cols-5"
                          items={[
                            {
                              label: i18n.t('debugConsole.metrics.fps'),
                              value: String(Math.round(props.controller.performanceSnapshot().fps.current || 0)),
                              note: i18n.t('debugConsole.metrics.avgLow', { avg: props.controller.performanceSnapshot().fps.average || 0, low: props.controller.performanceSnapshot().fps.low || 0 }),
                            },
                            {
                              label: i18n.t('debugConsole.metrics.longFrames'),
                              value: String(props.controller.performanceSnapshot().frame_timing.long_frame_count),
                              note: i18n.t('debugConsole.metrics.maxGap', { value: formatDuration(props.controller.performanceSnapshot().frame_timing.max_frame_ms) }),
                            },
                            {
                              label: i18n.t('debugConsole.metrics.inputDelay'),
                              value: formatDuration(props.controller.performanceSnapshot().interactions.last_paint_delay_ms),
                              note: i18n.t('debugConsole.metrics.max', { value: formatDuration(props.controller.performanceSnapshot().interactions.max_paint_delay_ms) }),
                            },
                            {
                              label: i18n.t('debugConsole.metrics.domMutations'),
                              value: String(props.controller.performanceSnapshot().dom_activity.mutation_records),
                              note: i18n.t('debugConsole.metrics.batches', { count: props.controller.performanceSnapshot().dom_activity.mutation_batches }),
                            },
                            {
                              label: i18n.t('debugConsole.metrics.longTasks'),
                              value: props.controller.collectUIMetrics() ? String(props.controller.performanceSnapshot().long_tasks.count) : offLabel(i18n),
                              note: props.controller.collectUIMetrics()
                                ? i18n.t('debugConsole.metrics.max', { value: formatDuration(props.controller.performanceSnapshot().long_tasks.max_duration_ms) })
                                : i18n.t('debugConsole.ui.advancedMetricsOptional'),
                            },
                          ]}
                        />

                        <div class="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                          <div class="space-y-4">
                            <SectionShell title={i18n.t('debugConsole.sections.rendererProbes')} description={i18n.t('debugConsole.ui.rendererProbesDescription')}>
                              <DefinitionList
                                items={[
                                  { label: i18n.t('debugConsole.fields.collecting'), value: boolLabel(i18n, props.controller.performanceSnapshot().collecting) },
                                  { label: i18n.t('debugConsole.fields.fpsSamples'), value: String(props.controller.performanceSnapshot().fps.samples) },
                                  { label: i18n.t('debugConsole.fields.lastFrameGap'), value: formatDuration(props.controller.performanceSnapshot().frame_timing.last_frame_ms) },
                                  { label: i18n.t('debugConsole.fields.maxFrameGap'), value: formatDuration(props.controller.performanceSnapshot().frame_timing.max_frame_ms) },
                                  { label: i18n.t('debugConsole.fields.interactions'), value: String(props.controller.performanceSnapshot().interactions.count) },
                                  { label: i18n.t('debugConsole.fields.lastInput'), value: compact(props.controller.performanceSnapshot().interactions.last_type) || '-' },
                                  { label: i18n.t('debugConsole.fields.lastInputDelay'), value: formatDuration(props.controller.performanceSnapshot().interactions.last_paint_delay_ms) },
                                  { label: i18n.t('debugConsole.fields.mutationBatches'), value: String(props.controller.performanceSnapshot().dom_activity.mutation_batches) },
                                  { label: i18n.t('debugConsole.fields.mutationRecords'), value: String(props.controller.performanceSnapshot().dom_activity.mutation_records) },
                                  { label: i18n.t('debugConsole.fields.nodesAdded'), value: String(props.controller.performanceSnapshot().dom_activity.nodes_added) },
                                  { label: i18n.t('debugConsole.fields.nodesRemoved'), value: String(props.controller.performanceSnapshot().dom_activity.nodes_removed) },
                                  { label: i18n.t('debugConsole.fields.lastMutation'), value: formatTimestamp(props.controller.performanceSnapshot().dom_activity.last_mutation_at) },
                                ]}
                              />
                            </SectionShell>

                            <SectionShell
                              title={i18n.t('debugConsole.sections.navigationAndPaints')}
                              description={props.controller.collectUIMetrics()
                                ? i18n.t('debugConsole.ui.navigationDescriptionEnabled')
                                : i18n.t('debugConsole.ui.navigationDescriptionDisabled')}
                            >
                              <DefinitionList
                                items={[
                                  { label: i18n.t('debugConsole.fields.firstPaint'), value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().paints.first_paint_ms) : offLabel(i18n) },
                                  { label: i18n.t('debugConsole.fields.firstContentfulPaint'), value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().paints.first_contentful_paint_ms) : offLabel(i18n) },
                                  { label: i18n.t('debugConsole.fields.navigationType'), value: props.controller.collectUIMetrics() ? (compact(props.controller.performanceSnapshot().navigation.type) || '-') : offLabel(i18n) },
                                  { label: i18n.t('debugConsole.fields.domContentLoaded'), value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().navigation.dom_content_loaded_ms) : offLabel(i18n) },
                                  { label: i18n.t('debugConsole.fields.loadEvent'), value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().navigation.load_event_ms) : offLabel(i18n) },
                                  { label: i18n.t('debugConsole.fields.responseEnd'), value: props.controller.collectUIMetrics() ? formatDuration(props.controller.performanceSnapshot().navigation.response_end_ms) : offLabel(i18n) },
                                  { label: i18n.t('debugConsole.fields.jsHeapUsed'), value: props.controller.collectUIMetrics() ? formatBytes(props.controller.performanceSnapshot().memory?.used_js_heap_size) : offLabel(i18n) },
                                  { label: i18n.t('debugConsole.fields.jsHeapTotal'), value: props.controller.collectUIMetrics() ? formatBytes(props.controller.performanceSnapshot().memory?.total_js_heap_size) : offLabel(i18n) },
                                ]}
                              />
                            </SectionShell>

                            <SectionShell
                              title={i18n.t('debugConsole.sections.instrumentationSupport')}
                              description={props.controller.collectUIMetrics()
                                ? i18n.t('debugConsole.ui.instrumentationDescriptionEnabled')
                                : i18n.t('debugConsole.ui.instrumentationDescriptionDisabled')}
                            >
                              <DefinitionList
                                items={[
                                  { label: i18n.t('debugConsole.fields.longTasks'), value: supportedLabel(i18n, props.controller.performanceSnapshot().supported.longtask) },
                                  { label: i18n.t('debugConsole.fields.layoutShift'), value: supportedLabel(i18n, props.controller.performanceSnapshot().supported.layout_shift) },
                                  { label: i18n.t('debugConsole.fields.paintTiming'), value: supportedLabel(i18n, props.controller.performanceSnapshot().supported.paint) },
                                  { label: i18n.t('debugConsole.fields.navigationTiming'), value: supportedLabel(i18n, props.controller.performanceSnapshot().supported.navigation) },
                                  { label: i18n.t('debugConsole.fields.memory'), value: supportedLabel(i18n, props.controller.performanceSnapshot().supported.memory) },
                                  { label: i18n.t('debugConsole.fields.mutationObserver'), value: supportedLabel(i18n, props.controller.performanceSnapshot().supported.mutation_observer) },
                                  { label: i18n.t('debugConsole.fields.interactionLatency'), value: supportedLabel(i18n, props.controller.performanceSnapshot().supported.interaction_latency) },
                                ]}
                              />
                            </SectionShell>
                          </div>

                          <SectionShell title={i18n.t('debugConsole.sections.recentUiEvents')} description={i18n.t('debugConsole.ui.recentEventsDescription')}>
                            <Show
                              when={props.controller.performanceSnapshot().recent_events.length > 0}
                              fallback={<EmptyState title={i18n.t('debugConsole.empty.noUiSpikesTitle')} message={i18n.t('debugConsole.empty.noUiSpikesMessage')} />}
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
                                        <div class="shrink-0">{renderEventBadge(event, i18n)}</div>
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
                  )} />

                  <UIFirstKeepAlivePanel active={tab() === 'runtime'} class="absolute inset-0" testId="debug-console-panel-runtime" render={() => (
                    <div class="h-full overflow-auto px-4 py-4">
                      <div class="space-y-4">
                        <MetricStrip
                          columnsClass="sm:grid-cols-2 xl:grid-cols-5"
                          items={[
                            { label: i18n.t('debugConsole.metrics.events'), value: String(props.controller.stats().total_events) },
                            { label: i18n.t('debugConsole.metrics.runtime'), value: String(props.controller.stats().agent_events) },
                            { label: i18n.t('debugConsole.metrics.desktop'), value: String(props.controller.stats().desktop_events) },
                            { label: i18n.t('debugConsole.metrics.slow'), value: String(props.controller.stats().slow_events) },
                            { label: i18n.t('debugConsole.metrics.traces'), value: String(props.controller.stats().trace_count) },
                          ]}
                        />

                        <div class="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                          <SectionShell title={i18n.t('debugConsole.sections.collectorState')} description={i18n.t('debugConsole.runtime.collectorStateDescription')}>
                            <DefinitionList
                              items={[
                                { label: i18n.t('debugConsole.fields.consoleVisible'), value: boolLabel(i18n, props.controller.enabled()) },
                                { label: i18n.t('debugConsole.fields.diagnosticsRuntime'), value: activeLabel(i18n, props.controller.runtimeEnabled()) },
                                { label: i18n.t('debugConsole.fields.stream'), value: connectedLabel(i18n, props.controller.streamConnected()) },
                                { label: i18n.t('debugConsole.fields.uiProbes'), value: activeLabel(i18n, props.controller.uiMetricsCollecting()) },
                                { label: i18n.t('debugConsole.fields.advancedUiMetrics'), value: enabledLabel(i18n, props.controller.collectUIMetrics()) },
                                { label: i18n.t('debugConsole.fields.stateDir'), value: compact(props.controller.stateDir()) || '-', mono: true },
                                { label: i18n.t('debugConsole.fields.lastSnapshot'), value: formatTimestamp(props.controller.lastSnapshotAt()) },
                              ]}
                            />
                          </SectionShell>

                          <SectionShell title={i18n.t('debugConsole.sections.slowSummary')} description={i18n.t('debugConsole.runtime.slowSummaryDescription')}>
                            <Show
                              when={props.controller.slowSummary().length > 0}
                              fallback={<EmptyState title={i18n.t('debugConsole.empty.noSlowHotspotsTitle')} message={i18n.t('debugConsole.empty.noSlowHotspotsMessage')} />}
                            >
                              <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
                                <TableHeaderRow
                                  gridClass="grid-cols-[minmax(0,2fr)_4rem_4rem_6rem_6rem]"
                                  columns={[
                                    i18n.t('debugConsole.table.signature'),
                                    i18n.t('debugConsole.table.seen'),
                                    i18n.t('debugConsole.table.slow'),
                                    i18n.t('debugConsole.table.avg'),
                                    i18n.t('debugConsole.table.max'),
                                  ]}
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
                  )} />

                  <UIFirstKeepAlivePanel active={tab() === 'export'} class="absolute inset-0" testId="debug-console-panel-export" render={() => (
                    <div class="h-full overflow-auto px-4 py-4">
                      <div class="space-y-4">
                        <div class="grid gap-4 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)]">
                          <div class="space-y-4">
                            <SectionShell title={i18n.t('debugConsole.sections.bundleContents')} description={i18n.t('debugConsole.export.bundleContentsDescription')}>
                              <DefinitionList
                                items={[
                                  { label: i18n.t('debugConsole.fields.lastExport'), value: formatTimestamp(props.controller.lastExportAt()) },
                                  { label: i18n.t('debugConsole.fields.serverEvents'), value: String(props.controller.serverEvents().length) },
                                  { label: i18n.t('debugConsole.fields.traceGroups'), value: String(props.controller.traces().length) },
                                  { label: i18n.t('debugConsole.fields.uiEvents'), value: String(props.controller.performanceSnapshot().recent_events.length) },
                                ]}
                              />
                            </SectionShell>

                            <SectionShell
                              title={i18n.t('debugConsole.sections.includedSources')}
                              description={props.controller.collectUIMetrics()
                                ? i18n.t('debugConsole.export.includedSourcesDescriptionEnabled')
                                : i18n.t('debugConsole.export.includedSourcesDescriptionDisabled')}
                            >
                              <div class="overflow-hidden rounded-md border border-border/70 bg-background shadow-sm">
                                <div class="border-b border-border/60 px-3 py-2.5 text-xs">
                                  <div class="font-medium text-foreground">{i18n.t('debugConsole.export.backendDiagnosticsTitle')}</div>
                                  <div class="mt-1 text-[9px] leading-5 text-muted-foreground">{i18n.t('debugConsole.export.backendDiagnosticsDescription')}</div>
                                </div>
                                <div class="border-b border-border/60 px-3 py-2.5 text-xs">
                                  <div class="font-medium text-foreground">{i18n.t('debugConsole.export.currentUiStateTitle')}</div>
                                  <div class="mt-1 text-[9px] leading-5 text-muted-foreground">
                                    <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">visible</code>
                                    {` ${i18n.t('debugConsole.export.and')} `}
                                    <code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-foreground">minimized</code>
                                    {` ${i18n.t('debugConsole.export.currentUiStateDescriptionSuffix')}`}
                                  </div>
                                </div>
                                <div class="px-3 py-2.5 text-xs">
                                  <div class="font-medium text-foreground">{i18n.t('debugConsole.export.uiPerformanceSnapshotTitle')}</div>
                                  <div class="mt-1 text-[9px] leading-5 text-muted-foreground">{i18n.t('debugConsole.export.uiPerformanceSnapshotDescription')}</div>
                                </div>
                              </div>
                            </SectionShell>
                          </div>

                          <SectionShell title={i18n.t('debugConsole.sections.bundlePreview')} description={i18n.t('debugConsole.export.bundlePreviewDescription')}>
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
                            {props.controller.exporting() ? i18n.t('debugConsole.actions.exporting') : i18n.t('debugConsole.actions.downloadBundle')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )} />
                </Show>
              </main>
    </div>
  );
}

export function DebugConsoleWindow(props: Readonly<{ controller: DebugConsoleController }>) {
  const i18n = useI18n();
  return (
    <>
      <Show when={props.controller.enabled() && props.controller.minimized()}>
        <button
          type="button"
          class={cn(
            'fixed bottom-4 right-4 inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/80 bg-background/96 px-3 py-2 text-left shadow-[0_20px_36px_-30px_var(--redeven-shadow-color)] backdrop-blur transition-colors hover:border-primary/25',
            ENV_APP_FLOATING_LAYER_CLASS.debugConsole,
          )}
          onClick={props.controller.restore}
          style={semanticInteractiveStyle(props.controller.streamConnected() ? 'success' : 'warning', 'strong')}
        >
          <StatusDot tone={props.controller.streamConnected() ? 'success' : 'warning'} />
          <span class="text-[9px] font-semibold uppercase tracking-[0.14em] text-foreground">{i18n.t('debugConsole.windowTitle')}</span>
          <SettingsPill tone={props.controller.streamConnected() ? 'success' : 'warning'}>
            {props.controller.streamConnected() ? i18n.t('debugConsole.badges.live') : i18n.t('debugConsole.badges.idle')}
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
          title={i18n.t('debugConsole.windowTitle')}
          persistenceKey="debug-console-window"
          defaultPosition={{ x: 48, y: 76 }}
          defaultSize={{ width: 1120, height: 720 }}
          minSize={{ width: 760, height: 520 }}
          class="debug-console-window border-border/80 shadow-[0_38px_92px_-56px_var(--redeven-shadow-color)]"
          contentClass="!p-0"
          zIndex={ENV_APP_FLOATING_LAYER.debugConsole}
          footer={<DebugConsoleFooter controller={props.controller} />}
        >
          <DebugConsolePanel
            controller={props.controller}
            onClose={() => void props.controller.closeConsole()}
            onMinimize={props.controller.minimize}
            showMinimize
          />
        </PersistentFloatingWindow>
      </Show>
    </>
  );
}
