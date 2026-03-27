import { fetchGatewayJSON, prepareGatewayRequestInit } from './gatewayApi';

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
  return fetchGatewayJSON<DiagnosticsView>(`/_redeven_proxy/api/debug/diagnostics?${query.toString()}`, { method: 'GET' });
}

export async function exportDiagnostics(limit = 500): Promise<DiagnosticsExportView> {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  return fetchGatewayJSON<DiagnosticsExportView>(`/_redeven_proxy/api/debug/diagnostics/export?${query.toString()}`, { method: 'GET' });
}

export async function connectDiagnosticsStream(args: {
  limit?: number;
  signal: AbortSignal;
  onEvent: (event: DiagnosticsStreamEvent) => void;
}): Promise<void> {
  const query = new URLSearchParams();
  query.set('limit', String(args.limit ?? 200));
  const response = await fetch(
    `/_redeven_proxy/api/debug/diagnostics/stream?${query.toString()}`,
    await prepareGatewayRequestInit({
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: args.signal,
    }),
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('Diagnostics stream unavailable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    if (!payload) return;
    args.onEvent(JSON.parse(payload) as DiagnosticsStreamEvent);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        flushBlock(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const finalBlock = buffer.trim();
    if (finalBlock) {
      flushBlock(finalBlock);
    }
  } finally {
    reader.releaseLock();
  }
}

export function diagnosticsExportFilename(exportedAt: string): string {
  const stamp = String(exportedAt ?? '').trim().replace(/[:.]/g, '-');
  return `redeven-diagnostics-${stamp || 'export'}.json`;
}
