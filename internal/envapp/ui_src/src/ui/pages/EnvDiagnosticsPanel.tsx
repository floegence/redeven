import { For, Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';

import type { DiagnosticsEvent, DiagnosticsSummaryItem, DiagnosticsView } from '../services/diagnosticsApi';
import {
  SettingsPill,
  SettingsTable,
  SettingsTableBody,
  SettingsTableCell,
  SettingsTableEmptyRow,
  SettingsTableHead,
  SettingsTableHeaderCell,
  SettingsTableHeaderRow,
  SettingsTableRow,
} from './settings/SettingsPrimitives';

export type EnvDiagnosticsPanelProps = Readonly<{
  configuredDebug: boolean;
  runtimeEnabled: boolean;
  loading: boolean;
  refreshing: boolean;
  exporting: boolean;
  error: string;
  diagnostics: DiagnosticsView | null | undefined;
  onRefresh: () => void;
  onExport: () => void;
}>;

function formatDuration(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${Math.round(value)} ms`;
}

function summaryTarget(item: DiagnosticsSummaryItem): string {
  const method = String(item.method ?? '').trim();
  const path = String(item.path ?? '').trim();
  const kind = String(item.kind ?? '').trim();
  return [method, path || kind || item.scope].filter(Boolean).join(' ');
}

function eventTitle(event: DiagnosticsEvent): string {
  const method = String(event.method ?? '').trim();
  const path = String(event.path ?? '').trim();
  const kind = String(event.kind ?? '').trim();
  return [method, path || kind || event.scope].filter(Boolean).join(' ');
}

function formatTimestamp(value: string | undefined): string {
  const input = String(value ?? '').trim();
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

export function EnvDiagnosticsPanel(props: EnvDiagnosticsPanelProps) {
  const stats = () => props.diagnostics?.stats;
  const slowSummary = () => props.diagnostics?.slow_summary ?? [];
  const recentEvents = () => props.diagnostics?.recent_events ?? [];

  return (
    <div class="space-y-3 text-[11px]">
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2">
        <div class="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <SettingsPill tone={props.runtimeEnabled ? 'success' : props.configuredDebug ? 'warning' : 'default'}>
            {props.runtimeEnabled ? 'Active' : props.configuredDebug ? 'Pending restart' : 'Disabled'}
          </SettingsPill>
          <span class="break-words">
            Diagnostics follows <code>log_level=debug</code> and only becomes active after the agent restarts.
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={props.onRefresh} disabled={props.loading || props.refreshing}>
            {props.refreshing ? 'Refreshing...' : 'Refresh diagnostics'}
          </Button>
          <Button size="sm" variant="secondary" onClick={props.onExport} disabled={!props.runtimeEnabled || props.exporting}>
            {props.exporting ? 'Exporting...' : 'Export diagnostics'}
          </Button>
        </div>
      </div>

      <Show when={!props.loading} fallback={<div class="text-[11px] text-muted-foreground">Loading diagnostics...</div>}>
        <Show when={!props.error} fallback={<div class="rounded-lg border border-red-300/50 bg-red-50 px-3 py-2 text-[11px] text-red-700">{props.error}</div>}>
          <Show
            when={props.runtimeEnabled}
            fallback={
              <div class="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                {props.configuredDebug
                  ? 'Diagnostics mode is configured but not active yet. Restart the agent to start collecting traces.'
                  : 'Set log_level=debug and restart the agent to enable diagnostics mode.'}
              </div>
            }
          >
            <div class="space-y-3">
              <SettingsTable class="text-[11px]" minWidthClass="min-w-[36rem]">
                <SettingsTableHead>
                  <SettingsTableHeaderRow>
                    <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Total events</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Desktop</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Agent</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Slow events</SettingsTableHeaderCell>
                    <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Trace IDs</SettingsTableHeaderCell>
                  </SettingsTableHeaderRow>
                </SettingsTableHead>
                <SettingsTableBody>
                  <SettingsTableRow>
                    <SettingsTableCell class="py-1.5 text-sm font-semibold text-foreground">{stats()?.total_events ?? 0}</SettingsTableCell>
                    <SettingsTableCell class="py-1.5 text-sm font-semibold text-foreground">{stats()?.desktop_events ?? 0}</SettingsTableCell>
                    <SettingsTableCell class="py-1.5 text-sm font-semibold text-foreground">{stats()?.agent_events ?? 0}</SettingsTableCell>
                    <SettingsTableCell class="py-1.5 text-sm font-semibold text-foreground">{stats()?.slow_events ?? 0}</SettingsTableCell>
                    <SettingsTableCell class="py-1.5 text-sm font-semibold text-foreground">{stats()?.trace_count ?? 0}</SettingsTableCell>
                  </SettingsTableRow>
                </SettingsTableBody>
              </SettingsTable>

              <div class="grid gap-3 xl:grid-cols-2">
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-xs font-semibold text-foreground">Slow summary</div>
                    <SettingsPill tone={slowSummary().length > 0 ? 'warning' : 'default'}>
                      {slowSummary().length > 0 ? `${slowSummary().length} entries` : 'No slow requests'}
                    </SettingsPill>
                  </div>
                  <SettingsTable class="text-[11px]" minWidthClass="min-w-[42rem]">
                    <SettingsTableHead sticky>
                      <SettingsTableHeaderRow>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Target</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Scope</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Max</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Avg</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Slow ratio</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Last status</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Last seen</SettingsTableHeaderCell>
                      </SettingsTableHeaderRow>
                    </SettingsTableHead>
                    <SettingsTableBody>
                      <For each={slowSummary()}>
                        {(item) => (
                          <SettingsTableRow>
                            <SettingsTableCell class="py-1.5 font-medium text-foreground">{summaryTarget(item)}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 font-mono text-[10px] text-muted-foreground">{item.scope}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 font-mono text-[10px] text-muted-foreground">{formatDuration(item.max_duration_ms)}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 font-mono text-[10px] text-muted-foreground">{formatDuration(item.avg_duration_ms)}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 font-mono text-[10px] text-muted-foreground">{item.slow_count}/{item.count}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 font-mono text-[10px] text-muted-foreground">
                              {typeof item.last_status_code === 'number' ? item.last_status_code : '-'}
                            </SettingsTableCell>
                            <SettingsTableCell class="py-1.5 text-[10px] text-muted-foreground">{formatTimestamp(item.last_seen_at)}</SettingsTableCell>
                          </SettingsTableRow>
                        )}
                      </For>
                      <Show when={slowSummary().length === 0}>
                        <SettingsTableEmptyRow colSpan={7}>No slow requests recorded yet.</SettingsTableEmptyRow>
                      </Show>
                    </SettingsTableBody>
                  </SettingsTable>
                </div>

                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-xs font-semibold text-foreground">Recent events</div>
                    <SettingsPill>{`${recentEvents().slice(0, 8).length} shown`}</SettingsPill>
                  </div>
                  <SettingsTable class="text-[11px]" minWidthClass="min-w-[46rem]">
                    <SettingsTableHead sticky>
                      <SettingsTableHeaderRow>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Event</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Source</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Scope</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Duration</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Status</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">When</SettingsTableHeaderCell>
                        <SettingsTableHeaderCell class="py-1.5 text-[10px] uppercase tracking-wide">Message</SettingsTableHeaderCell>
                      </SettingsTableHeaderRow>
                    </SettingsTableHead>
                    <SettingsTableBody>
                      <For each={recentEvents().slice(0, 8)}>
                        {(event) => (
                          <SettingsTableRow>
                            <SettingsTableCell class="py-1.5 font-medium text-foreground">{eventTitle(event)}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 text-[10px] text-muted-foreground">{event.source ?? 'unknown'}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 font-mono text-[10px] text-muted-foreground">{event.scope}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 font-mono text-[10px] text-muted-foreground">{formatDuration(event.duration_ms)}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 font-mono text-[10px] text-muted-foreground">
                              {typeof event.status_code === 'number' ? event.status_code : '-'}
                            </SettingsTableCell>
                            <SettingsTableCell class="py-1.5 text-[10px] text-muted-foreground">{formatTimestamp(event.created_at)}</SettingsTableCell>
                            <SettingsTableCell class="py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                              {String(event.message ?? '').trim() || '-'}
                            </SettingsTableCell>
                          </SettingsTableRow>
                        )}
                      </For>
                      <Show when={recentEvents().length === 0}>
                        <SettingsTableEmptyRow colSpan={7}>No diagnostic events recorded yet.</SettingsTableEmptyRow>
                      </Show>
                    </SettingsTableBody>
                  </SettingsTable>
                </div>
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
