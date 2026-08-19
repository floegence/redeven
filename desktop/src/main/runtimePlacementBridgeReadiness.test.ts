import { describe, expect, it } from 'vitest';

import type { RuntimeServiceSnapshot } from '../shared/runtimeService';
import type { StartupReport } from './startup';
import { desktopFailureForRuntimePlacementBridgeReadiness } from './runtimePlacementBridgeReadiness';

function runtimeService(overrides: Partial<RuntimeServiceSnapshot> = {}): RuntimeServiceSnapshot {
  return {
    compatibility: 'unknown',
    remote_enabled: true,
    active_workload: { terminal_count: 0, session_count: 0, task_count: 0, port_forward_count: 0 },
    ...overrides,
  };
}

function startup(runtimeServiceSnapshot: RuntimeServiceSnapshot): StartupReport {
  return {
    local_ui_url: 'http://127.0.0.1:3000/',
    local_ui_urls: ['http://127.0.0.1:3000/'],
    runtime_service: runtimeServiceSnapshot,
  };
}

describe('runtimePlacementBridgeReadiness', () => {
  it('turns an old Runtime hello plus invalid health into an update-required failure', () => {
    const failure = desktopFailureForRuntimePlacementBridgeReadiness(
      { kind: 'invalid_response', stage: 'runtime_health', status_code: 200 },
      startup(runtimeService({
        compatibility: 'update_required',
        compatibility_message: 'Runtime compatibility epoch is too old.',
      })),
      'orange',
    );

    expect(failure).toMatchObject({
      code: 'runtime_update_required',
      summary_key: 'runtimeMessage.updateRuntimeBeforeOpeningEnvironment',
      recovery_hint_key: 'runtimeMessage.updateRuntimeFirst',
      target_label: 'orange',
    });
    expect(failure.diagnostics?.[0]?.text).toContain('stage=runtime_health');
  });

  it('keeps an unknown readiness failure on the recheck path', () => {
    const failure = desktopFailureForRuntimePlacementBridgeReadiness(
      { kind: 'network_error', stage: 'runtime_health', code: 'ECONNRESET' },
      startup(runtimeService({
        compatibility: 'unknown',
      })),
      'orange',
    );

    expect(failure).toMatchObject({
      code: 'environment_open_failed',
      severity: 'warning',
      summary_key: 'runtimeMessage.runtimeReadinessUnavailable',
      recovery_hint_key: 'runtimeMessage.refreshStatusTitle',
    });
    expect(failure.diagnostics?.[0]?.text).toContain('kind=network_error');
  });
});
