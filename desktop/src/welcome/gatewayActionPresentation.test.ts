import { describe, expect, it, vi } from 'vitest';

import type { DesktopGatewayDiagnosisClassification, DesktopGatewaySource } from '../shared/desktopGateway';
import type { GatewaySourceActionModel } from './viewModel';
import { buildGatewayActionPresentation } from './gatewayActionPresentation';
import { runGatewaySourceAction } from './gatewaySourceActionRunner';

function gateway(overrides: Partial<DesktopGatewaySource> = {}): DesktopGatewaySource {
  return {
    gateway_id: 'gw-demo',
    display_name: 'Gateway-demo',
    local_enabled: true,
    connection_kind: 'url',
    management_capability: 'access_only',
    capabilities: [],
    status: 'pairing_required',
    trust_state: 'unpaired',
    endpoint_label: 'demo:22',
    service_state: {
      status: 'ready',
      can_start: true,
      can_stop: true,
      can_restart: true,
      can_update: true,
      can_pair_after_start: true,
    },
    created_at_ms: 1,
    updated_at_ms: 1,
    environments: [],
    ...overrides,
  };
}

function action(intent: GatewaySourceActionModel['intent']): GatewaySourceActionModel {
  return {
    intent,
    label: intent,
    enabled: true,
    variant: 'default',
  };
}

function diagnosis(
  classification: DesktopGatewayDiagnosisClassification,
  overrides: Partial<NonNullable<DesktopGatewaySource['diagnosis']>> = {},
): NonNullable<DesktopGatewaySource['diagnosis']> {
  return {
    checked_at_unix_ms: 10,
    classification,
    manageable: true,
    summary: `${classification} summary`,
    detail: `${classification} detail`,
    ...overrides,
  };
}

function expectNoLegacyGatewayActions(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('Check Gateway');
  expect(serialized).not.toContain('Sync Gateway');
  expect(serialized).not.toContain('Pair Gateway');
  expect(serialized).not.toContain('Review Trust');
}

describe('buildGatewayActionPresentation', () => {
  it('opens Refresh as one guide without exposing Check, Sync, or Pair actions', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway(),
      clicked_action: action('refresh_gateway'),
    });

    expect(model).toMatchObject({
      kind: 'diagnosis_result',
      execution_mode: 'guide',
      title: 'Refresh Gateway',
    });
    expect(model.continuation_action).toBeUndefined();
    expect(model.primary_action).toBeUndefined();
    expect(model.detail).toContain('checks the target');
    expect(model.detail).toContain('catalog');
    expectNoLegacyGatewayActions(model);
  });

  it('keeps Standalone Gateway diagnosis access-only', () => {
    const stopped = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: diagnosis('not_started', {
          probe_results: [
            { id: 'gateway_service', label: 'Gateway service', status: 'failed', detail: 'Service is not running.' },
            { id: 'gateway_version', label: 'Gateway version', status: 'skipped' },
          ],
        }),
      }),
      clicked_action: action('refresh_gateway'),
      show_diagnosis_result: true,
    });
    expect(stopped).toMatchObject({ kind: 'diagnosis_result' });
    expect(stopped.primary_action).toBeUndefined();
    expect(stopped.continuation_action).toBeUndefined();
    expect(stopped.result_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Not ready', tone: 'error' }),
    ]);

    const bridgeUnavailable = buildGatewayActionPresentation({
      gateway: gateway({ diagnosis: diagnosis('bridge_unavailable') }),
      clicked_action: action('refresh_gateway'),
      show_diagnosis_result: true,
    });
    expect(bridgeUnavailable.primary_action).toBeUndefined();
    expect(bridgeUnavailable.continuation_action).toBeUndefined();

    const needsUpdate = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: diagnosis('needs_update', {
          error_code: 'UNAUTHORIZED',
          error_message: 'Pair this Gateway before listing or opening environments.',
          recommended_recovery: 'update_gateway',
          managed_probe: {
            package_status: 'ready',
            version: 'v0.0.0-dev',
            target_version: 'v0.0.0-dev',
            commit: '46c3d67cc469',
            target_commit: 'a7fd66530509',
            facts: [
              { label: 'Gateway version', value: 'v0.0.0-dev' },
              { label: 'Gateway target commit', value: 'a7fd66530509' },
            ],
          },
        }),
      }),
      clicked_action: action('refresh_gateway'),
      show_diagnosis_result: true,
    });
    expect(needsUpdate).toMatchObject({ title: 'Gateway update required' });
    expect(needsUpdate.primary_action).toBeUndefined();
    expect(needsUpdate.continuation_action).toBeUndefined();
    expect(needsUpdate.diagnostic_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Error code', value: 'UNAUTHORIZED' }),
      expect.objectContaining({ label: 'Error message', value: 'Pair this Gateway before listing or opening environments.', tone: 'error' }),
      expect.objectContaining({ label: 'Gateway target commit', value: 'a7fd66530509' }),
    ]));

    expectNoLegacyGatewayActions([stopped, bridgeUnavailable, needsUpdate]);
  });

  it('routes managed protocol incompatibility to reinstall while URL Gateways stay access-only', () => {
    const managed = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'needs_reinstall',
          can_start: false,
          can_stop: true,
          can_restart: false,
          can_update: false,
          can_pair_after_start: false,
        },
        diagnosis: diagnosis('needs_reinstall', {
          manageable: true,
          error_code: 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED',
          error_message: 'Gateway protocol version is not supported.',
        }),
      }),
      clicked_action: action('refresh_gateway'),
      show_diagnosis_result: true,
    });
    expect(managed).toMatchObject({ title: 'Gateway requires host maintenance' });
    expect(managed.primary_action).toBeUndefined();

    const accessOnly = buildGatewayActionPresentation({
      gateway: gateway({
        connection_kind: 'url',
        management_capability: 'access_only',
        service_state: undefined,
        diagnosis: diagnosis('needs_update', {
          manageable: false,
          error_code: 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED',
          error_message: 'Gateway protocol version is not supported.',
        }),
      }),
      clicked_action: action('refresh_gateway'),
      show_diagnosis_result: true,
    });
    expect(accessOnly).toMatchObject({
      title: 'Gateway protocol check failed',
    });
    expect(accessOnly.primary_action?.intent).not.toBe('reinstall_target');
    expect(accessOnly.continuation_action?.kind).not.toBe('reinstall_target');
    expect(JSON.stringify(accessOnly)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(accessOnly)).not.toContain('X-Redeven-Request-Signature');
  });

  it('delegates reinstall confirmation to the unified target dialog', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'needs_reinstall',
          can_start: false,
          can_stop: true,
          can_restart: false,
          can_update: false,
          can_pair_after_start: false,
        },
      }),
      clicked_action: action('reinstall_target'),
      affected_sessions: [],
    });

    expect(model).toMatchObject({
      kind: 'none',
      execution_mode: 'direct',
      tone: 'neutral',
    });
  });

  it('keeps pairing as an explicit Refresh action for an unpaired URL Gateway', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        trust_state: 'unpaired',
      }),
      clicked_action: action('refresh_gateway'),
    });

    expect(model).toMatchObject({ title: 'Refresh Gateway' });
    expect(model.primary_action).toBeUndefined();
    expect(model.continuation_action).toBeUndefined();
  });

  it('keeps auth, trust, catalog, and target failures facts-only when no service recovery is valid', () => {
    const factsOnlyClassifications: readonly DesktopGatewayDiagnosisClassification[] = [
      'ssh_unreachable',
      'container_unavailable',
      'trust_failed',
      'pairing_required',
      'identity_changed',
      'catalog_failed',
      'service_ready_catalog_failed',
      'unknown',
      'unmanageable',
    ];

    for (const classification of factsOnlyClassifications) {
      const model = buildGatewayActionPresentation({
        gateway: gateway({
          diagnosis: diagnosis(classification, {
            manageable: classification !== 'unmanageable',
            error_code: classification === 'service_ready_catalog_failed' ? 'UNAUTHORIZED' : undefined,
            error_message: classification === 'service_ready_catalog_failed'
              ? 'Pair this Gateway before listing or opening environments.'
              : undefined,
          }),
        }),
        clicked_action: action('refresh_gateway'),
        show_diagnosis_result: true,
      });

      expect(model.kind).toBe('diagnosis_result');
      expect(model.primary_action).toBeUndefined();
      expect(model.continuation_action).toBeUndefined();
      expectNoLegacyGatewayActions(model);
    }
  });

  it('keeps retained Refresh failures on the same panel and derives service recovery from the retained diagnosis', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: diagnosis('not_started', {
          summary: 'Gateway is stopped',
          detail: 'Desktop can start this Gateway service.',
        }),
      }),
      clicked_action: action('refresh_gateway'),
      retained_failure: {
        action: 'refresh_gateway',
        operation_key: 'gateway:gw-demo:refresh',
        subject_kind: 'gateway',
        subject_id: 'gw-demo',
        gateway_id: 'gw-demo',
        started_at_unix_ms: 100,
        status: 'failed',
        phase: 'failed',
        title: 'Refresh failed',
        detail: 'Gateway service is not running.',
      },
    });

    expect(model).toMatchObject({ kind: 'failure_recovery' });
    expect(model.primary_action).toBeUndefined();
    expect(model.continuation_action).toBeUndefined();
    expectNoLegacyGatewayActions(model);
  });

  it('keeps disabled Gateways on Enable without surfacing management actions in the popup', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({ local_enabled: false }),
      clicked_action: action('refresh_gateway'),
    });

    expect(model).toMatchObject({
      kind: 'disabled_gateway',
      title: 'Gateway disabled on this Desktop',
      primary_action: { intent: 'enable_gateway', label: 'Enable Gateway' },
      continuation_action: { kind: 'set_gateway_enabled', gateway_id: 'gw-demo', enabled: true },
    });
    expect(JSON.stringify(model)).not.toContain('manage_gateway');
    expect(JSON.stringify(model)).not.toContain('delete_gateway');
    expectNoLegacyGatewayActions(model);
  });

  it('uses renderer-owned confirmation for Gateway service impact actions', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway(),
      clicked_action: action('restart_gateway'),
      affected_sessions: [
        { session_key: 's1', label: 'Prod shell' },
        { session_key: 's2', label: 'Build runner' },
      ],
    });

    expect(model).toMatchObject({ kind: 'none', execution_mode: 'direct' });
    expect(model.continuation_action).toBeUndefined();
    expect(model.affected_sessions).toEqual([]);
  });

  it('dispatches only the allowed Gateway source operations', async () => {
    const openCreateGatewaySetup = vi.fn();
    const runGatewayLauncherAction = vi.fn(async () => undefined);

    await runGatewaySourceAction(action('refresh_gateway'), gateway(), openCreateGatewaySetup, runGatewayLauncherAction);
    await runGatewaySourceAction(action('start_gateway'), gateway(), openCreateGatewaySetup, runGatewayLauncherAction);
    await runGatewaySourceAction(action('update_gateway'), gateway(), openCreateGatewaySetup, runGatewayLauncherAction);
    await runGatewaySourceAction(action('view_gateway_environments'), gateway(), openCreateGatewaySetup, runGatewayLauncherAction);

    expect(runGatewayLauncherAction).toHaveBeenCalledWith({
      kind: 'refresh_gateway',
      gateway_id: 'gw-demo',
    });
    expect(runGatewayLauncherAction).toHaveBeenCalledTimes(1);
    expect(openCreateGatewaySetup).not.toHaveBeenCalled();
  });
});
