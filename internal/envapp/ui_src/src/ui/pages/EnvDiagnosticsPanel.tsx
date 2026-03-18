import { For, Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';

import type { DiagnosticsEvent, DiagnosticsSummaryItem, DiagnosticsView } from '../services/diagnosticsApi';

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

export function EnvDiagnosticsPanel(props: EnvDiagnosticsPanelProps) {
  const stats = () => props.diagnostics?.stats;
  const slowSummary = () => props.diagnostics?.slow_summary ?? [];
  const recentEvents = () => props.diagnostics?.recent_events ?? [];

  return (
    <div class="space-y-4">
      <div class="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Diagnostics mode follows <code>log_level=debug</code> and only becomes active after the agent restarts.
      </div>

      <div class="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={props.onRefresh} disabled={props.loading || props.refreshing}>
          {props.refreshing ? 'Refreshing...' : 'Refresh diagnostics'}
        </Button>
        <Button size="sm" variant="secondary" onClick={props.onExport} disabled={!props.runtimeEnabled || props.exporting}>
          {props.exporting ? 'Exporting...' : 'Export diagnostics'}
        </Button>
      </div>

      <Show when={!props.loading} fallback={<div class="text-sm text-muted-foreground">Loading diagnostics...</div>}>
        <Show when={!props.error} fallback={<div class="rounded-lg border border-red-300/50 bg-red-50 px-3 py-2 text-sm text-red-700">{props.error}</div>}>
          <Show
            when={props.runtimeEnabled}
            fallback={
              <div class="rounded-lg border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {props.configuredDebug
                  ? 'Diagnostics mode is configured but not active yet. Restart the agent to start collecting traces.'
                  : 'Set log_level=debug and restart the agent to enable diagnostics mode.'}
              </div>
            }
          >
            <div class="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div class="rounded-lg border border-border bg-background px-3 py-2">
                <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Total events</div>
                <div class="mt-1 text-lg font-semibold text-foreground">{stats()?.total_events ?? 0}</div>
              </div>
              <div class="rounded-lg border border-border bg-background px-3 py-2">
                <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Desktop</div>
                <div class="mt-1 text-lg font-semibold text-foreground">{stats()?.desktop_events ?? 0}</div>
              </div>
              <div class="rounded-lg border border-border bg-background px-3 py-2">
                <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Agent</div>
                <div class="mt-1 text-lg font-semibold text-foreground">{stats()?.agent_events ?? 0}</div>
              </div>
              <div class="rounded-lg border border-border bg-background px-3 py-2">
                <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Slow events</div>
                <div class="mt-1 text-lg font-semibold text-foreground">{stats()?.slow_events ?? 0}</div>
              </div>
              <div class="rounded-lg border border-border bg-background px-3 py-2">
                <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Trace IDs</div>
                <div class="mt-1 text-lg font-semibold text-foreground">{stats()?.trace_count ?? 0}</div>
              </div>
            </div>

            <div class="grid gap-4 lg:grid-cols-2">
              <div class="space-y-2 rounded-xl border border-border bg-background p-4">
                <div class="text-sm font-semibold text-foreground">Slow summary</div>
                <Show when={slowSummary().length > 0} fallback={<div class="text-sm text-muted-foreground">No slow requests recorded yet.</div>}>
                  <div class="space-y-2">
                    <For each={slowSummary()}>
                      {(item) => (
                        <div class="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                          <div class="text-sm font-medium text-foreground">{summaryTarget(item)}</div>
                          <div class="mt-1 text-xs text-muted-foreground">
                            {item.scope} • max {formatDuration(item.max_duration_ms)} • avg {formatDuration(item.avg_duration_ms)} • slow {item.slow_count}/{item.count}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="space-y-2 rounded-xl border border-border bg-background p-4">
                <div class="text-sm font-semibold text-foreground">Recent events</div>
                <Show when={recentEvents().length > 0} fallback={<div class="text-sm text-muted-foreground">No diagnostic events recorded yet.</div>}>
                  <div class="space-y-2">
                    <For each={recentEvents().slice(0, 8)}>
                      {(event) => (
                        <div class="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                          <div class="text-sm font-medium text-foreground">{eventTitle(event)}</div>
                          <div class="mt-1 text-xs text-muted-foreground">
                            {event.source ?? 'unknown'} • {event.scope} • {formatDuration(event.duration_ms)}
                            <Show when={event.message}> • {event.message}</Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
