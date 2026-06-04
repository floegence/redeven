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
  it('opens a sync guide when automatic Gateway pairing has an issue', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        status: 'error',
        sync_state: 'pairing_failed',
        last_sync_error_message: 'Gateway pairing challenge signature is invalid.',
      }),
      clicked_action: action('resolve_gateway'),
    });

    expect(model).toMatchObject({
      kind: 'resolve_before_pair',
      execution_mode: 'guide',
      eyebrow: 'Gateway',
      title: 'Gateway pairing issue',
      detail: 'Gateway pairing challenge signature is invalid.',
      primary_action: { intent: 'sync_gateway', label: 'Sync Gateway' },
      continuation_action: { kind: 'sync_gateway', gateway_id: 'gw-demo' },
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

  it('keeps URL Gateways access-only and does not offer Gateway service management while pairing', () => {
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

    expect(model.kind).toBe('resolve_before_pair');
    expect(model.primary_action).toMatchObject({ intent: 'sync_gateway', label: 'Sync Gateway' });
    expect(model.secondary_actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ intent: 'start_gateway' }),
      expect.objectContaining({ intent: 'update_gateway' }),
      expect.objectContaining({ intent: 'manage_gateway' }),
    ]));
  });

  it('explains that stopped managed Gateways are started by sync instead of requiring manual Pair confirmation', () => {
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

    expect(model.kind).toBe('start_and_refresh_catalog');
    expect(model.eyebrow).toBe('Gateway service');
    expect(model.primary_action).toMatchObject({ intent: 'start_gateway', label: 'Start Gateway' });
    expect(model.status_facts).toEqual([
      expect.objectContaining({ label: 'Gateway service', value: 'Not started', tone: 'warning' }),
      expect.objectContaining({ label: 'Catalog sync', value: 'Idle' }),
    ]);
    expect(model.continuation_action).toMatchObject({
      kind: 'sync_gateway',
      start_policy: 'start_if_needed',
    });
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
    })).toMatchObject({ kind: 'resolve_before_pair', resolve_focus: 'container' });
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
      secondary_actions: [
        expect.objectContaining({ intent: 'cancel_gateway_action', label: 'Cancel' }),
      ],
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

  it('uses unified sync for catalog and status refresh, starting managed Gateways when needed', async () => {
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
    expect(runGatewayLauncherAction).toHaveBeenCalledTimes(2);
    expect(runGatewayServiceAction).not.toHaveBeenCalled();
    expect(pairGateway).not.toHaveBeenCalled();
    expect(openCreateGatewaySetup).not.toHaveBeenCalled();
  });

  it('keeps direct service start separate from sync-and-start primary actions', async () => {
    const openCreateGatewaySetup = vi.fn();
    const pairGateway = vi.fn(async () => undefined);
    const runGatewayServiceAction = vi.fn(async () => undefined);
    const runGatewayLauncherAction = vi.fn(async () => undefined);

    await runGatewaySourceAction(
      {
        intent: 'service_start_gateway',
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

    expect(runGatewayServiceAction).toHaveBeenCalledWith('gw-demo', 'start_gateway');
    expect(runGatewayLauncherAction).not.toHaveBeenCalled();
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
