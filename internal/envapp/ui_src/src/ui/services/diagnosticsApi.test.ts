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
});
