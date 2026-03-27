// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data: body }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('diagnosticsApi', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads diagnostics through the gateway helper', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => ({ mode: 'local', env_public_id: 'env_local' })),
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/_redeven_proxy/api/debug/diagnostics?limit=60');
      expect(init?.method).toBe('GET');
      return jsonResponse({
        enabled: true,
        recent_events: [],
        slow_summary: [],
        stats: { total_events: 0, agent_events: 0, desktop_events: 0, slow_events: 0, trace_count: 0 },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./diagnosticsApi');
    const out = await mod.getDiagnostics();

    expect(out.enabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('builds a stable export filename', async () => {
    const mod = await import('./diagnosticsApi');
    expect(mod.diagnosticsExportFilename('2026-03-18T14:15:16.123Z')).toBe('redeven-diagnostics-2026-03-18T14-15-16-123Z.json');
  });

  it('builds a stable diagnostics event key', async () => {
    const mod = await import('./diagnosticsApi');
    expect(mod.diagnosticsEventKey({
      created_at: '2026-03-18T14:15:16Z',
      source: 'desktop',
      scope: 'desktop_http',
      kind: 'completed',
      trace_id: 'trace-1',
      method: 'GET',
      path: '/api/local/runtime',
      status_code: 200,
      duration_ms: 24,
    })).toBe('{"created_at":"2026-03-18T14:15:16Z","source":"desktop","scope":"desktop_http","kind":"completed","trace_id":"trace-1","method":"GET","path":"/api/local/runtime","status_code":200,"duration_ms":24}');
  });

  it('reads diagnostics events from the streaming endpoint', async () => {
    vi.doMock('./controlplaneApi', () => ({
      getLocalRuntime: vi.fn(async () => null),
    }));

    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: diagnostics_event\n'));
          controller.enqueue(encoder.encode('data: {"key":"evt-1","event":{"created_at":"2026-03-18T14:15:16Z","source":"agent","scope":"gateway_api","kind":"request","trace_id":"trace-1","method":"GET","path":"/_redeven_proxy/api/settings","status_code":200,"duration_ms":16}}\n\n'));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('./diagnosticsApi');
    const events: any[] = [];
    await mod.connectDiagnosticsStream({
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      key: 'evt-1',
      event: {
        trace_id: 'trace-1',
        path: '/_redeven_proxy/api/settings',
      },
    });
  });
});
