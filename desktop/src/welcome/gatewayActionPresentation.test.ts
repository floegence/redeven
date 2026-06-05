import { describe, expect, it, vi } from 'vitest';

import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { GatewaySourceActionModel } from './viewModel';
import { buildGatewayActionPresentation } from './gatewayActionPresentation';
import { runGatewaySourceAction } from './gatewaySourceActionRunner';

function gateway(overrides: Partial<DesktopGatewaySource> = {}): DesktopGatewaySource {
  return {
    gateway_id: 'gw-demo',
    display_name: 'Gateway-demo',
    local_enabled: true,
    connection_kind: 'ssh_host',
    management_capability: 'managed_ssh_host',
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

describe('buildGatewayActionPresentation', () => {
  it('opens a check-first guide when automatic Gateway pairing has an issue', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        status: 'error',
        sync_state: 'pairing_failed',
        last_sync_error_message: 'Gateway pairing challenge signature is invalid.',
      }),
      clicked_action: action('resolve_gateway'),
    });

    expect(model).toMatchObject({
      kind: 'check_required',
      execution_mode: 'guide',
      eyebrow: 'Gateway',
      title: 'Gateway sync failed',
      detail: 'Run a check to identify whether this Gateway needs to start, update, or change configuration.',
      primary_action: { intent: 'check_gateway', label: 'Check Gateway' },
      continuation_action: { kind: 'check_gateway', gateway_id: 'gw-demo' },
    });
    expect(model.status_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Ready' }),
      expect.objectContaining({ label: 'Catalog sync', value: 'Failed', tone: 'error' }),
    ]);
    expect(model.diagnostic_facts.map((fact) => fact.label)).toEqual(expect.arrayContaining([
      'Trust',
      'Transport',
      'Endpoint',
    ]));
    expect(JSON.stringify(model)).not.toContain('Managed Gateway');
  });

  it('keeps URL Gateways access-only and starts sync recovery with diagnostics', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        connection_kind: 'url',
        management_capability: 'access_only',
        endpoint_label: 'https://gateway.example.test',
        service_state: {
          status: 'not_applicable',
          can_start: false,
          can_stop: false,
          can_restart: false,
          can_update: false,
          can_pair_after_start: false,
        },
      }),
      clicked_action: action('pair_gateway'),
    });

    expect(model.kind).toBe('check_required');
    expect(model.primary_action).toMatchObject({ intent: 'check_gateway', label: 'Check Gateway' });
    expect(model.secondary_actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ intent: 'start_gateway' }),
      expect.objectContaining({ intent: 'update_gateway' }),
      expect.objectContaining({ intent: 'manage_gateway' }),
    ]));
  });

  it('checks stopped managed Gateways before recommending startup', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'not_started',
          can_start: true,
          can_stop: false,
          can_restart: false,
          can_update: false,
          can_pair_after_start: true,
        },
      }),
      clicked_action: action('pair_gateway'),
    });

    expect(model.kind).toBe('check_required');
    expect(model.eyebrow).toBe('Gateway');
    expect(model.primary_action).toMatchObject({ intent: 'check_gateway', label: 'Check Gateway' });
    expect(model.status_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Not started', tone: 'warning' }),
      expect.objectContaining({ label: 'Catalog sync', value: 'Idle' }),
    ]);
    expect(model.continuation_action).toMatchObject({ kind: 'check_gateway', gateway_id: 'gw-demo' });
    expect(model.secondary_actions).toEqual([]);
  });

  it('routes Pair through update or resolve guides when Gateway service state blocks trust', () => {
    const updateModel = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'service_needs_update',
          can_start: false,
          can_stop: false,
          can_restart: true,
          can_update: true,
          can_pair_after_start: false,
        },
      }),
      clicked_action: action('pair_gateway'),
    });
    expect(updateModel).toMatchObject({
      kind: 'update_then_pair',
      primary_action: { intent: 'update_gateway' },
    });
    expect(updateModel.status_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Update required', tone: 'warning' }),
      expect.objectContaining({ label: 'Catalog sync', value: 'Idle' }),
    ]);
    expect(updateModel.continuation_action).toBeUndefined();

    expect(buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'container_unavailable',
          can_start: false,
          can_stop: false,
          can_restart: false,
          can_update: false,
          can_pair_after_start: false,
        },
      }),
      clicked_action: action('pair_gateway'),
    })).toMatchObject({
      kind: 'resolve_before_pair',
      resolve_focus: 'container',
      primary_action: { intent: 'resolve_gateway', label: 'Resolve Gateway' },
    });
  });

  it('recovers retained Gateway failures by checking before recommending a next step', () => {
    const stoppedFailure = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'not_started',
          can_start: true,
          can_stop: false,
          can_restart: false,
          can_update: false,
          can_pair_after_start: true,
        },
      }),
      clicked_action: action('sync_gateway'),
      retained_failure: {
        action: 'sync_gateway',
        operation_key: 'gateway:gw-demo:sync',
        subject_kind: 'gateway',
        subject_id: 'gw-demo',
        gateway_id: 'gw-demo',
        started_at_unix_ms: 100,
        status: 'failed',
        phase: 'failed',
        title: 'Sync failed',
        detail: 'Gateway service is not running.',
      },
    });
    expect(stoppedFailure).toMatchObject({
      kind: 'failure_recovery',
      primary_action: { intent: 'check_gateway', label: 'Check Gateway' },
      continuation_action: { kind: 'check_gateway', gateway_id: 'gw-demo' },
    });

    const updateFailure = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'service_needs_update',
          can_start: false,
          can_stop: false,
          can_restart: true,
          can_update: true,
          can_pair_after_start: false,
        },
      }),
      clicked_action: action('sync_gateway'),
      retained_failure: {
        action: 'sync_gateway',
        operation_key: 'gateway:gw-demo:sync',
        subject_kind: 'gateway',
        subject_id: 'gw-demo',
        gateway_id: 'gw-demo',
        started_at_unix_ms: 100,
        status: 'failed',
        phase: 'failed',
        title: 'Sync failed',
        detail: 'Gateway needs update.',
      },
    });
    expect(updateFailure).toMatchObject({
      primary_action: { intent: 'check_gateway', label: 'Check Gateway' },
      continuation_action: { kind: 'check_gateway', gateway_id: 'gw-demo' },
    });

    const unreachableFailure = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'ssh_unreachable',
          can_start: false,
          can_stop: false,
          can_restart: false,
          can_update: false,
          can_pair_after_start: false,
        },
      }),
      clicked_action: action('sync_gateway'),
      retained_failure: {
        action: 'sync_gateway',
        operation_key: 'gateway:gw-demo:sync',
        subject_kind: 'gateway',
        subject_id: 'gw-demo',
        gateway_id: 'gw-demo',
        started_at_unix_ms: 100,
        status: 'failed',
        phase: 'failed',
        title: 'Sync failed',
        detail: 'SSH host is unreachable.',
      },
    });
    expect(unreachableFailure).toMatchObject({
      primary_action: { intent: 'check_gateway', label: 'Check Gateway' },
      continuation_action: { kind: 'check_gateway', gateway_id: 'gw-demo' },
    });
  });

  it('keeps Check Gateway as a diagnostic workflow before showing retained diagnosis results', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        sync_state: 'catalog_failed',
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'ready',
          manageable: true,
          summary: 'Gateway service is ready',
          detail: 'A retained diagnosis should not replace the next manual check.',
        },
      }),
      clicked_action: action('check_gateway'),
    });

    expect(model).toMatchObject({
      kind: 'check_required',
      primary_action: { intent: 'check_gateway', label: 'Check Gateway' },
      continuation_action: { kind: 'check_gateway', gateway_id: 'gw-demo' },
    });
  });

  it('uses a completed Gateway diagnosis to recommend manageable recovery actions', () => {
    const stopped = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'not_started',
          manageable: true,
          summary: 'Gateway is stopped',
          detail: 'Desktop can start this Gateway service.',
          probe_results: [
            { id: 'gateway_service', label: 'Gateway service', status: 'failed', detail: 'Service is not running.' },
            { id: 'gateway_version', label: 'Gateway version', status: 'skipped' },
          ],
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(stopped).toMatchObject({
      kind: 'start_and_refresh_catalog',
      primary_action: { intent: 'start_gateway', label: 'Start Gateway' },
      continuation_action: { kind: 'start_gateway', gateway_id: 'gw-demo' },
    });
    expect(stopped.result_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Not ready', tone: 'error' }),
    ]);
    expect(stopped.diagnostic_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Gateway service', value: 'Service is not running.', tone: 'error' }),
    ]));

    const unmanaged = buildGatewayActionPresentation({
      gateway: gateway({
        connection_kind: 'url',
        management_capability: 'access_only',
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'catalog_failed',
          manageable: false,
          summary: 'Gateway catalog check failed',
          detail: 'Desktop cannot manage this Gateway.',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(unmanaged.kind).toBe('diagnosis_result');
    expect(unmanaged.primary_action).toBeUndefined();
    expect(unmanaged.continuation_action).toBeUndefined();
  });

  it('maps completed Gateway diagnosis classifications to specific recovery actions', () => {
    const needsUpdate = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'needs_update',
          manageable: true,
          summary: 'Gateway protocol unsupported',
          detail: 'Raw protocol detail should stay out of the panel title.',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(needsUpdate).toMatchObject({
      kind: 'diagnosis_result',
      title: 'Gateway update required',
      primary_action: { intent: 'update_gateway', label: 'Update Gateway' },
      continuation_action: { kind: 'update_gateway', gateway_id: 'gw-demo' },
    });

    const needsUpdateWithProbes = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'needs_update',
          manageable: true,
          summary: 'Gateway protocol unsupported',
          detail: 'Raw protocol detail should stay out of the panel title.',
          probe_results: [
            { id: 'gateway_service', label: 'Gateway service', status: 'warning', detail: 'Gateway service is reachable but needs update.' },
            { id: 'gateway_version', label: 'Gateway version', status: 'warning' },
            { id: 'gateway_trust', label: 'Gateway trust', status: 'skipped' },
          ],
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(needsUpdateWithProbes.result_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Review required', tone: 'warning' }),
      expect.objectContaining({ label: 'Gateway version', value: 'Update required', tone: 'warning' }),
    ]);
    expect(needsUpdateWithProbes.diagnostic_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Gateway service', value: 'Gateway service is reachable but needs update.', tone: 'warning' }),
    ]));

    const sshUnreachable = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'ssh_unreachable',
          can_start: false,
          can_stop: false,
          can_restart: false,
          can_update: false,
          can_pair_after_start: false,
        },
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'ssh_unreachable',
          manageable: true,
          summary: 'SSH host unreachable',
          detail: 'Raw SSH detail should stay out of the panel title.',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(sshUnreachable).toMatchObject({
      title: 'Gateway target needs review',
      primary_action: { intent: 'resolve_gateway', label: 'Edit Gateway Settings' },
      resolve_focus: 'ssh_host',
    });

    const containerUnavailable = buildGatewayActionPresentation({
      gateway: gateway({
        service_state: {
          status: 'container_unavailable',
          can_start: false,
          can_stop: false,
          can_restart: false,
          can_update: false,
          can_pair_after_start: false,
        },
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'container_unavailable',
          manageable: true,
          summary: 'Gateway container unavailable',
          detail: 'Raw container detail should stay out of the panel title.',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(containerUnavailable).toMatchObject({
      title: 'Gateway target needs review',
      primary_action: { intent: 'resolve_gateway', label: 'Edit Gateway Settings' },
      resolve_focus: 'container',
    });

    const trustFailed = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'trust_failed',
          manageable: true,
          summary: 'Gateway pairing challenge signature is invalid.',
          detail: 'Raw trust detail should stay out of the panel title.',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(trustFailed).toMatchObject({
      title: 'Gateway trust check failed',
      primary_action: { intent: 'resolve_gateway', label: 'Review Trust' },
      resolve_focus: 'identity_trust',
    });

    const unpaired = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'trust_failed',
          manageable: true,
          summary: 'Gateway is not paired',
          detail: 'Desktop needs to sync this Gateway before it can trust and read its catalog.',
          trust_state: 'unpaired',
          catalog_state: 'pairing_failed',
          recommended_recovery: 'sync_gateway',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(unpaired).toMatchObject({
      title: 'Retry Gateway pairing',
      primary_action: { intent: 'sync_gateway', label: 'Sync Gateway' },
      continuation_action: { kind: 'sync_gateway', gateway_id: 'gw-demo' },
    });

    const catalogFailed = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'catalog_failed',
          manageable: true,
          summary: 'Gateway catalog check failed with raw server text.',
          detail: 'Raw catalog detail should stay out of the panel title.',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(catalogFailed).toMatchObject({
      title: 'Gateway catalog check failed',
      primary_action: { intent: 'sync_gateway', label: 'Sync Gateway' },
      continuation_action: { kind: 'sync_gateway', gateway_id: 'gw-demo' },
    });

    const readyCatalogFailed = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'service_ready_catalog_failed',
          manageable: true,
          summary: 'Gateway service is ready but catalog failed.',
          detail: 'Raw catalog detail should stay out of the panel title.',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(readyCatalogFailed).toMatchObject({
      title: 'Gateway catalog check failed',
      primary_action: { intent: 'sync_gateway', label: 'Sync Gateway' },
      continuation_action: { kind: 'sync_gateway', gateway_id: 'gw-demo' },
    });

    const legacyResidue = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'legacy_runtime_residue',
          manageable: true,
          summary: 'Legacy Gateway service residue found',
          detail: 'Raw residue detail should stay out of the panel title.',
          managed_probe: {
            binary_path: '/root/.redeven/gateway/managed/bin/redeven-gateway',
            state_root: '/root/.redeven/gateways/gw-demo/state',
            legacy_runtime_residue: true,
            legacy_runtime_pids: [3342497],
            facts: [
              { label: 'Legacy runtime residue', value: 'Found', tone: 'warning' },
              { label: 'Legacy runtime pids', value: '3342497', tone: 'warning' },
            ],
          },
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(legacyResidue).toMatchObject({
      title: 'Gateway update required',
      primary_action: { intent: 'update_gateway', label: 'Update Gateway' },
      continuation_action: { kind: 'update_gateway', gateway_id: 'gw-demo', impact_acknowledged: true },
    });
    expect(legacyResidue.diagnostic_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Legacy runtime residue', value: 'Found', tone: 'warning' }),
      expect.objectContaining({ label: 'Legacy runtime pids', value: '3342497', tone: 'warning' }),
    ]));

    const ready = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'ready',
          manageable: true,
          summary: 'Gateway service is ready',
          detail: 'Raw ready detail should stay out of the panel title.',
          probe_results: [
            { id: 'gateway_service', label: 'Gateway service', status: 'passed' },
            { id: 'gateway_trust', label: 'Gateway trust', status: 'passed' },
            { id: 'gateway_catalog', label: 'Gateway catalog', status: 'passed' },
          ],
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(ready).toMatchObject({
      title: 'Gateway is ready',
      primary_action: { intent: 'sync_gateway', label: 'Sync Gateway' },
    });
    expect(ready.result_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Ready', tone: 'success' }),
      expect.objectContaining({ label: 'Gateway trust', value: 'Verified', tone: 'success' }),
      expect.objectContaining({ label: 'Gateway catalog', value: 'Reachable', tone: 'success' }),
    ]);
    expect(ready.diagnostic_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Gateway service', value: 'passed', tone: 'success' }),
      expect.objectContaining({ label: 'Gateway trust', value: 'passed', tone: 'success' }),
      expect.objectContaining({ label: 'Gateway catalog', value: 'passed', tone: 'success' }),
    ]));

    const inconclusive = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'unknown',
          manageable: true,
          summary: 'Gateway status is unknown',
          detail: 'Desktop could not determine this Gateway service state.',
          probe_results: [
            { id: 'gateway_service', label: 'Gateway service', status: 'unknown' },
            { id: 'gateway_trust', label: 'Gateway trust', status: 'skipped' },
          ],
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(inconclusive.result_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Unknown', tone: 'neutral' }),
      expect.objectContaining({ label: 'Gateway trust', value: 'Skipped', tone: 'neutral' }),
    ]);

    const disabled = buildGatewayActionPresentation({
      gateway: gateway({
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'disabled',
          manageable: true,
          summary: 'Gateway sync is paused by raw text.',
          detail: 'Raw disabled detail should stay out of the panel title.',
        },
      }),
      clicked_action: action('check_gateway'),
      show_diagnosis_result: true,
    });
    expect(disabled).toMatchObject({
      title: 'Gateway sync is paused',
    });
    expect(disabled.primary_action).toBeUndefined();
  });

  it('does not reuse stale diagnosis for a new sync failure before the user checks again', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        sync_state: 'catalog_failed',
        diagnosis: {
          checked_at_unix_ms: 10,
          classification: 'not_started',
          manageable: true,
          summary: 'Gateway is stopped',
          detail: 'Desktop can start this Gateway service.',
        },
      }),
      clicked_action: action('sync_gateway'),
      retained_failure: {
        action: 'sync_gateway',
        operation_key: 'gateway:gw-demo:sync',
        subject_kind: 'gateway',
        subject_id: 'gw-demo',
        gateway_id: 'gw-demo',
        started_at_unix_ms: 100,
        status: 'failed',
        phase: 'failed',
        title: 'Sync failed',
        detail: 'Catalog sync failed.',
      },
    });

    expect(model).toMatchObject({
      kind: 'failure_recovery',
      title: 'Gateway sync failed',
      primary_action: { intent: 'check_gateway', label: 'Check Gateway' },
      continuation_action: { kind: 'check_gateway', gateway_id: 'gw-demo' },
    });
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

    expect(model).toMatchObject({
      kind: 'restart_gateway_confirm',
      execution_mode: 'confirm',
      continuation_action: {
        kind: 'restart_gateway',
        gateway_id: 'gw-demo',
        impact_acknowledged: true,
      },
      affected_sessions: [
        { session_key: 's1', label: 'Prod shell' },
        { session_key: 's2', label: 'Build runner' },
      ],
      secondary_actions: [],
    });
  });

  it('dispatches legacy refresh status as unified Gateway sync', async () => {
    const openCreateGatewaySetup = vi.fn();
    const pairGateway = vi.fn(async () => undefined);
    const runGatewayServiceAction = vi.fn(async () => undefined);
    const runGatewayLauncherAction = vi.fn(async () => undefined);

    await runGatewaySourceAction(
      {
        intent: 'refresh_gateway_status',
        label: 'Refresh status',
        enabled: true,
        variant: 'outline',
      },
      gateway({ status: 'online', trust_state: 'paired' }),
      openCreateGatewaySetup,
      pairGateway,
      runGatewayServiceAction,
      runGatewayLauncherAction,
    );

    expect(runGatewayLauncherAction).toHaveBeenCalledWith({
      kind: 'sync_gateway',
      gateway_id: 'gw-demo',
    });
    expect(pairGateway).not.toHaveBeenCalled();
    expect(runGatewayServiceAction).not.toHaveBeenCalled();
    expect(openCreateGatewaySetup).not.toHaveBeenCalled();
  });

  it('keeps renderer-owned Gateway source CTAs out of the launcher runner', async () => {
    const openCreateGatewaySetup = vi.fn();
    const pairGateway = vi.fn(async () => undefined);
    const runGatewayServiceAction = vi.fn(async () => undefined);
    const runGatewayLauncherAction = vi.fn(async () => undefined);

    await runGatewaySourceAction(
      {
        intent: 'view_gateway_environments',
        label: 'View Environments',
        enabled: true,
        variant: 'default',
      },
      gateway({ status: 'online', trust_state: 'paired' }),
      openCreateGatewaySetup,
      pairGateway,
      runGatewayServiceAction,
      runGatewayLauncherAction,
    );
    await runGatewaySourceAction(
      {
        intent: 'add_gateway_environment',
        label: 'Add Env',
        enabled: true,
        variant: 'default',
      },
      gateway({ status: 'online', trust_state: 'paired' }),
      openCreateGatewaySetup,
      pairGateway,
      runGatewayServiceAction,
      runGatewayLauncherAction,
    );

    expect(openCreateGatewaySetup).not.toHaveBeenCalled();
    expect(pairGateway).not.toHaveBeenCalled();
    expect(runGatewayServiceAction).not.toHaveBeenCalled();
    expect(runGatewayLauncherAction).not.toHaveBeenCalled();
  });

  it('uses unified sync for catalog refresh and direct service workflow for Start Gateway', async () => {
    const openCreateGatewaySetup = vi.fn();
    const pairGateway = vi.fn(async () => undefined);
    const runGatewayServiceAction = vi.fn(async () => undefined);
    const runGatewayLauncherAction = vi.fn(async () => undefined);
    const stoppedGateway = gateway({
      status: 'pairing_required',
      trust_state: 'unpaired',
      service_state: {
        status: 'not_started',
        can_start: true,
        can_stop: false,
        can_restart: false,
        can_update: false,
        can_pair_after_start: true,
      },
    });

    await runGatewaySourceAction(
      {
        intent: 'sync_gateway',
        label: 'Sync Gateway',
        enabled: true,
        variant: 'default',
      },
      stoppedGateway,
      openCreateGatewaySetup,
      pairGateway,
      runGatewayServiceAction,
      runGatewayLauncherAction,
    );
    await runGatewaySourceAction(
      {
        intent: 'start_gateway',
        label: 'Start Gateway',
        enabled: true,
        variant: 'default',
      },
      stoppedGateway,
      openCreateGatewaySetup,
      pairGateway,
      runGatewayServiceAction,
      runGatewayLauncherAction,
    );

    expect(runGatewayLauncherAction).toHaveBeenCalledWith({
      kind: 'sync_gateway',
      gateway_id: 'gw-demo',
      start_policy: 'start_if_needed',
    });
    expect(runGatewayLauncherAction).toHaveBeenCalledWith({
      kind: 'start_gateway',
      gateway_id: 'gw-demo',
    });
    expect(runGatewayLauncherAction).toHaveBeenCalledTimes(2);
    expect(runGatewayServiceAction).not.toHaveBeenCalled();
    expect(pairGateway).not.toHaveBeenCalled();
    expect(openCreateGatewaySetup).not.toHaveBeenCalled();
  });

  it('routes direct Gateway service actions through launcher workflows', async () => {
    const openCreateGatewaySetup = vi.fn();
    const pairGateway = vi.fn(async () => undefined);
    const runGatewayServiceAction = vi.fn(async () => undefined);
    const runGatewayLauncherAction = vi.fn(async () => undefined);

    await runGatewaySourceAction(
      {
        intent: 'start_gateway',
        label: 'Start Gateway',
        enabled: true,
        variant: 'outline',
      },
      gateway(),
      openCreateGatewaySetup,
      pairGateway,
      runGatewayServiceAction,
      runGatewayLauncherAction,
    );
    await runGatewaySourceAction(
      {
        intent: 'update_gateway',
        label: 'Update Gateway',
        enabled: true,
        variant: 'outline',
      },
      gateway(),
      openCreateGatewaySetup,
      pairGateway,
      runGatewayServiceAction,
      runGatewayLauncherAction,
    );

    expect(runGatewayLauncherAction).toHaveBeenCalledWith({
      kind: 'start_gateway',
      gateway_id: 'gw-demo',
    });
    expect(runGatewayLauncherAction).toHaveBeenCalledWith({
      kind: 'update_gateway',
      gateway_id: 'gw-demo',
      impact_acknowledged: true,
    });
    expect(runGatewayServiceAction).not.toHaveBeenCalled();
  });

  it('guides disabled Gateways without surfacing Manage inside the popup', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({ local_enabled: false }),
      clicked_action: action('sync_gateway'),
    });

    expect(model).toMatchObject({
      kind: 'disabled_gateway',
      title: 'Gateway disabled on this Desktop',
      primary_action: { intent: 'enable_gateway', label: 'Enable Gateway' },
      continuation_action: { kind: 'set_gateway_enabled', gateway_id: 'gw-demo', enabled: true },
    });
    expect(JSON.stringify(model)).not.toContain('manage_gateway');
    expect(JSON.stringify(model)).not.toContain('Managed Gateway');
  });
});
