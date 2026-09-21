import { readSessionEvents } from './sessionHTTP';
import { fetchLocalApiJSON } from './localApi';

export type DiagnosticsEvent = Readonly<{
  created_at: string;
  source?: string;
  scope: string;
  kind: string;
  trace_id?: string;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  slow?: boolean;
  message?: string;
  detail?: Record<string, unknown>;
}>;

export type DiagnosticsSummaryItem = Readonly<{
  scope: string;
  kind?: string;
  method?: string;
  path?: string;
  count: number;
  slow_count: number;
  max_duration_ms: number;
  avg_duration_ms: number;
  last_status_code?: number;
  last_seen_at?: string;
}>;

export type DiagnosticsStats = Readonly<{
  total_events: number;
  agent_events: number;
  desktop_events: number;
  slow_events: number;
  trace_count: number;
}>;

export type DiagnosticsSnapshot = Readonly<{
  recent_events: DiagnosticsEvent[];
  slow_summary: DiagnosticsSummaryItem[];
  stats: DiagnosticsStats;
}>;

export type DiagnosticsView = Readonly<{
  enabled: boolean;
  state_dir?: string;
}> & DiagnosticsSnapshot;

export type DiagnosticsExportView = Readonly<{
  enabled: boolean;
  state_dir?: string;
  exported_at: string;
  snapshot: DiagnosticsSnapshot;
  agent_events: DiagnosticsEvent[];
  desktop_events: DiagnosticsEvent[];
}>;

export type DiagnosticsStreamEvent = Readonly<{
  key: string;
  event: DiagnosticsEvent;
}>;

function normalizeDiagnosticsEventPayload(event: DiagnosticsEvent): Record<string, unknown> {
  return {
    created_at: String(event.created_at ?? '').trim(),
    source: String(event.source ?? '').trim() || undefined,
    scope: String(event.scope ?? '').trim(),
    kind: String(event.kind ?? '').trim(),
    trace_id: String(event.trace_id ?? '').trim() || undefined,
    method: String(event.method ?? '').trim() || undefined,
    path: String(event.path ?? '').trim() || undefined,
    status_code: typeof event.status_code === 'number' ? event.status_code : undefined,
    duration_ms: typeof event.duration_ms === 'number' ? event.duration_ms : undefined,
    slow: event.slow === true ? true : undefined,
    message: String(event.message ?? '').trim() || undefined,
    detail: event.detail ?? undefined,
  };
}

export function diagnosticsEventKey(event: DiagnosticsEvent): string {
  return JSON.stringify(normalizeDiagnosticsEventPayload(event));
}

export async function getDiagnostics(limit = 60): Promise<DiagnosticsView> {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  return fetchLocalApiJSON<DiagnosticsView>(`/_redeven_proxy/api/debug/diagnostics?${query.toString()}`, { method: 'GET' });
}

export async function exportDiagnostics(limit = 500): Promise<DiagnosticsExportView> {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  return fetchLocalApiJSON<DiagnosticsExportView>(`/_redeven_proxy/api/debug/diagnostics/export?${query.toString()}`, { method: 'GET' });
}

export async function connectDiagnosticsStream(args: {
  limit?: number;
  signal: AbortSignal;
  onEvent: (event: DiagnosticsStreamEvent) => void;
}): Promise<void> {
  for await (const frame of readSessionEvents(`/_redeven_proxy/api/debug/diagnostics/stream?limit=${encodeURIComponent(String(args.limit ?? 200))}`, { method: 'GET', signal: args.signal })) {
    if (!frame.data) continue;
    args.onEvent(JSON.parse(frame.data) as DiagnosticsStreamEvent);
  }
}

export function diagnosticsExportFilename(exportedAt: string): string {
  const stamp = String(exportedAt ?? '').trim().replace(/[:.]/g, '-');
  return `redeven-diagnostics-${stamp || 'export'}.json`;
}
