// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EnvDiagnosticsPanel } from './EnvDiagnosticsPanel';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('EnvDiagnosticsPanel', () => {
  it('shows restart guidance when diagnostics are configured but not active', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <EnvDiagnosticsPanel
        configuredDebug
        runtimeEnabled={false}
        loading={false}
        refreshing={false}
        exporting={false}
        error=""
        diagnostics={null}
        onRefresh={() => undefined}
        onExport={() => undefined}
      />
    ), host);

    expect(host.textContent).toContain('Restart the agent to start collecting traces.');
  });

  it('renders slow summary and recent events when diagnostics are active', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <EnvDiagnosticsPanel
        configuredDebug
        runtimeEnabled
        loading={false}
        refreshing={false}
        exporting={false}
        error=""
        diagnostics={{
          enabled: true,
          recent_events: [
            {
              created_at: '2026-03-18T12:00:00Z',
              source: 'desktop',
              scope: 'desktop_http',
              kind: 'completed',
              method: 'GET',
              path: '/api/local/runtime',
              duration_ms: 1200,
            },
          ],
          slow_summary: [
            {
              scope: 'gateway_api',
              method: 'POST',
              path: '/_redeven_proxy/api/settings',
              count: 2,
              slow_count: 1,
              max_duration_ms: 1800,
              avg_duration_ms: 900,
            },
          ],
          stats: { total_events: 3, agent_events: 2, desktop_events: 1, slow_events: 1, trace_count: 1 },
        }}
        onRefresh={() => undefined}
        onExport={() => undefined}
      />
    ), host);

    expect(host.textContent).toContain('Slow summary');
    expect(host.textContent).toContain('POST /_redeven_proxy/api/settings');
    expect(host.textContent).toContain('Recent events');
    expect(host.textContent).toContain('GET /api/local/runtime');
    expect(host.textContent).toContain('Slow ratio');
    expect(host.querySelectorAll('table')).toHaveLength(3);
    expect(host.innerHTML).toContain('text-[11px]');
  });
});
