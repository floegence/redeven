import { describe, expect, it } from 'vitest';

import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { GatewaySourceActionModel } from './viewModel';
import { buildGatewayActionPresentation } from './gatewayActionPresentation';

function gateway(overrides: Partial<DesktopGatewaySource> = {}): DesktopGatewaySource {
  return {
    gateway_id: 'gw-demo',
    display_name: 'Gateway-demo',
    connection_kind: 'ssh_host',
    management_capability: 'managed_ssh_host',
    status: 'pairing_required',
    trust_state: 'unpaired',
    endpoint_label: 'demo:22',
    runtime_state: {
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
  it('opens a Pair guide even when the managed Gateway runtime is ready', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway(),
      clicked_action: action('pair_gateway'),
    });

    expect(model).toMatchObject({
      kind: 'pair_ready',
      execution_mode: 'guide',
      continuation_action: {
        kind: 'pair_gateway',
        gateway_id: 'gw-demo',
      },
    });
  });

  it('keeps URL Gateways access-only and does not offer runtime management while pairing', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        connection_kind: 'url',
        management_capability: 'access_only',
        endpoint_label: 'https://gateway.example.test',
        runtime_state: {
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

    expect(model.kind).toBe('access_only_pair');
    expect(model.secondary_actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ intent: 'start_gateway_runtime' }),
      expect.objectContaining({ intent: 'update_gateway_runtime' }),
    ]));
  });

  it('offers Start Gateway and Start Gateway & Pair when the managed runtime is not started', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway({
        runtime_state: {
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

    expect(model.kind).toBe('start_and_pair');
    expect(model.primary_action).toMatchObject({ intent: 'start_gateway_runtime' });
    expect(model.secondary_actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ intent: 'pair_gateway', label: 'Start Gateway & Pair' }),
    ]));
    expect(model.continuation_action).toMatchObject({
      kind: 'pair_gateway',
      start_policy: 'start_if_needed',
    });
  });

  it('routes Pair through update or resolve guides when runtime state blocks trust', () => {
    expect(buildGatewayActionPresentation({
      gateway: gateway({
        runtime_state: {
          status: 'runtime_needs_update',
          can_start: false,
          can_stop: false,
          can_restart: true,
          can_update: true,
          can_pair_after_start: false,
        },
      }),
      clicked_action: action('pair_gateway'),
    })).toMatchObject({ kind: 'update_then_pair', primary_action: { intent: 'update_gateway_runtime' } });

    expect(buildGatewayActionPresentation({
      gateway: gateway({
        runtime_state: {
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

  it('uses renderer-owned confirmation for runtime impact actions', () => {
    const model = buildGatewayActionPresentation({
      gateway: gateway(),
      clicked_action: action('restart_gateway_runtime'),
      affected_sessions: [
        { session_key: 's1', label: 'Prod shell' },
        { session_key: 's2', label: 'Build runner' },
      ],
    });

    expect(model).toMatchObject({
      kind: 'restart_gateway_confirm',
      execution_mode: 'confirm',
      continuation_action: {
        kind: 'restart_gateway_runtime',
        gateway_id: 'gw-demo',
        impact_acknowledged: true,
      },
      affected_sessions: [
        { session_key: 's1', label: 'Prod shell' },
        { session_key: 's2', label: 'Build runner' },
      ],
    });
  });
});
