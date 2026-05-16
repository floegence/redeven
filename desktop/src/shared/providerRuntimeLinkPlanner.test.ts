import { describe, expect, it } from 'vitest';

import { buildDesktopProviderRuntimeLinkPlan } from './providerRuntimeLinkPlanner';
import type { DesktopProviderEnvironmentCandidate, DesktopProviderRuntimeLinkTarget } from './providerRuntimeLinkTarget';
import {
  runtimeServiceProviderConnectionState,
  type RuntimeServiceProviderLinkBinding,
  type RuntimeServiceSnapshot,
} from './runtimeService';

function provider(): DesktopProviderEnvironmentCandidate {
  return {
    provider_environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
    label: 'Demo Environment',
    provider_origin: 'https://cp.example.invalid',
    provider_id: 'example_control_plane',
    env_public_id: 'env_demo',
    provider_label: 'Demo Provider',
    route_state: 'online',
    occupancy: { state: 'available' },
  };
}

function runtimeService(binding: RuntimeServiceProviderLinkBinding): RuntimeServiceSnapshot {
  return {
    protocol_version: 'redeven-runtime-v1',
    service_owner: 'desktop',
    desktop_managed: true,
    effective_run_mode: 'desktop',
    remote_enabled: binding.state === 'linked' && binding.remote_enabled === true,
    compatibility: 'compatible',
    open_readiness: { state: 'openable' },
    active_workload: {
      terminal_count: 0,
      session_count: 0,
      task_count: 0,
      port_forward_count: 0,
    },
    capabilities: {
      desktop_ai_broker: { supported: true, bind_method: 'runtime_control_v1' },
      provider_link: { supported: true, bind_method: 'runtime_control_v1' },
    },
    bindings: {
      desktop_ai_broker: { state: 'unbound' },
      provider_link: binding,
    },
  };
}

function target(overrides: Partial<DesktopProviderRuntimeLinkTarget> = {}): DesktopProviderRuntimeLinkTarget {
  const service = overrides.runtime_service ?? runtimeService({ state: 'unbound', remote_enabled: false });
  return {
    id: 'ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default',
    kind: 'ssh_environment',
    environment_id: 'ssh_saved',
    label: 'SSH devbox',
    runtime_key: 'ssh:devbox:default:key_agent:remote_default',
    runtime_url: 'http://127.0.0.1:24000/',
    runtime_running: true,
    runtime_openable: true,
    runtime_control_status: {
      state: 'available',
      owner: 'current_desktop',
    },
    runtime_service: service,
    provider_connection_state: runtimeServiceProviderConnectionState(service),
    provider_link_state: service.bindings!.provider_link.state,
    provider_link_binding: service.bindings!.provider_link,
    can_connect_provider: true,
    can_disconnect_provider: false,
    ...overrides,
  };
}

describe('buildDesktopProviderRuntimeLinkPlan', () => {
  it('allows an unbound running SSH runtime to connect to a provider environment', () => {
    expect(buildDesktopProviderRuntimeLinkPlan(target(), provider())).toMatchObject({
      state: 'target_ready',
      can_connect: true,
      can_disconnect: false,
      runtime_matches_provider: false,
    });
  });

  it('reports already linked for the same provider environment', () => {
    const binding = {
      state: 'linked' as const,
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      remote_enabled: true,
    };
    expect(buildDesktopProviderRuntimeLinkPlan(target({
      runtime_service: runtimeService(binding),
      provider_link_state: 'linked',
      provider_link_binding: binding,
    }), provider())).toMatchObject({
      state: 'already_linked',
      can_connect: false,
      can_disconnect: true,
      runtime_matches_provider: true,
    });
  });

  it('treats a matching saved link without an active provider connection as a runtime inconsistency', () => {
    const binding = {
      state: 'linked' as const,
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      remote_enabled: false,
    };
    expect(buildDesktopProviderRuntimeLinkPlan(target({
      runtime_service: runtimeService(binding),
      provider_link_state: 'linked',
      provider_link_binding: binding,
      can_connect_provider: true,
      can_disconnect_provider: true,
    }), provider())).toMatchObject({
      state: 'blocked_runtime',
      can_connect: false,
      can_disconnect: false,
      runtime_matches_provider: true,
    });
  });

  it('does not ask a local-only linked runtime to reconnect when the provider environment is occupied here', () => {
    const binding = {
      state: 'linked' as const,
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      remote_enabled: false,
    };
    expect(buildDesktopProviderRuntimeLinkPlan(target({
      runtime_service: runtimeService(binding),
      provider_link_state: 'linked',
      provider_link_binding: binding,
      can_connect_provider: true,
      can_disconnect_provider: true,
    }), {
      ...provider(),
      occupancy: {
        state: 'linked_here',
        runtime_target_id: 'ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default',
        runtime_kind: 'ssh_environment',
        runtime_label: 'SSH devbox',
        provider_connection_state: 'error',
      },
    })).toMatchObject({
      state: 'blocked_runtime',
      can_connect: false,
      can_disconnect: false,
      runtime_matches_provider: true,
    });
  });

  it('requires disconnecting before linking another provider', () => {
    const binding = {
      state: 'linked' as const,
      provider_origin: 'https://other.example.invalid',
      provider_id: 'other',
      env_public_id: 'env_other',
      remote_enabled: true,
    };
    expect(buildDesktopProviderRuntimeLinkPlan(target({
      runtime_service: runtimeService(binding),
      provider_link_state: 'linked',
      provider_link_binding: binding,
    }), provider())).toMatchObject({
      state: 'linked_elsewhere',
      can_connect: false,
      can_disconnect: false,
    });
  });

  it('blocks provider environments already occupied by another managed runtime', () => {
    expect(buildDesktopProviderRuntimeLinkPlan(target(), {
      ...provider(),
      occupancy: {
        state: 'occupied_by_known_runtime',
        runtime_target_id: 'local:local',
        runtime_kind: 'local_environment',
        runtime_label: 'Local Environment',
        provider_connection_state: 'connected',
      },
    })).toMatchObject({
      state: 'provider_environment_occupied',
      can_connect: false,
      message: 'Demo Environment is already connected to Local Environment. Disconnect it from that runtime card before connecting another runtime.',
    });
  });

  it('blocks provider environments reported online by the provider when Desktop cannot identify the runtime', () => {
    expect(buildDesktopProviderRuntimeLinkPlan(target(), {
      ...provider(),
      occupancy: { state: 'occupied_by_provider_online_runtime' },
    })).toMatchObject({
      state: 'provider_environment_occupied',
      can_connect: false,
      message: 'Demo Environment already has an online runtime through the provider. Disconnect that runtime before connecting another runtime.',
    });
  });

  it('blocks when runtime-control is missing', () => {
    expect(buildDesktopProviderRuntimeLinkPlan(target({
      runtime_control_status: {
        state: 'missing',
        reason_code: 'not_reported',
        message: 'Restart this runtime from Desktop so runtime-control can be prepared.',
      },
    }), provider())).toMatchObject({
      state: 'runtime_control_missing',
      can_connect: false,
    });
  });

  it('blocks runtime-control owned by another Desktop instance', () => {
    expect(buildDesktopProviderRuntimeLinkPlan(target({
      runtime_control_status: {
        state: 'owner_mismatch',
        owner: 'other_desktop',
        message: 'This runtime is owned by another Desktop instance.',
      },
    }), provider())).toMatchObject({
      state: 'blocked_owner_mismatch',
      can_connect: false,
    });
  });
});
