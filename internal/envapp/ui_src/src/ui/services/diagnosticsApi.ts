import { fetchGatewayJSON } from './gatewayApi';

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

export async function getDiagnostics(limit = 60): Promise<DiagnosticsView> {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  return fetchGatewayJSON<DiagnosticsView>(`/_redeven_proxy/api/debug/diagnostics?${query.toString()}`, { method: 'GET' });
}

export async function exportDiagnostics(limit = 500): Promise<DiagnosticsExportView> {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  return fetchGatewayJSON<DiagnosticsExportView>(`/_redeven_proxy/api/debug/diagnostics/export?${query.toString()}`, { method: 'GET' });
}

export function diagnosticsExportFilename(exportedAt: string): string {
  const stamp = String(exportedAt ?? '').trim().replace(/[:.]/g, '-');
  return `redeven-diagnostics-${stamp || 'export'}.json`;
}
