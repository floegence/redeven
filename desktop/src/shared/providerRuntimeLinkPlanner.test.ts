import { describe, expect, it } from 'vitest';

import { buildDesktopProviderRuntimeLinkPlan } from './providerRuntimeLinkPlanner';
import type { DesktopProviderEnvironmentCandidate, DesktopProviderRuntimeLinkTarget } from './providerRuntimeLinkTarget';
import type { RuntimeServiceProviderLinkBinding, RuntimeServiceSnapshot } from './runtimeService';

function provider(): DesktopProviderEnvironmentCandidate {
  return {
    provider_environment_id: 'cp:https%3A%2F%2Fcp.example.invalid:env:env_demo',
    label: 'Demo Environment',
    provider_origin: 'https://cp.example.invalid',
    provider_id: 'example_control_plane',
    env_public_id: 'env_demo',
    provider_label: 'Demo Provider',
    route_state: 'online',
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
    runtime_control_available: true,
    runtime_control: {
      protocol_version: 'redeven-runtime-control-v1',
      base_url: 'http://127.0.0.1:39002/',
      token: 'token',
      desktop_owner_id: 'desktop-owner',
    },
    runtime_service: service,
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

  it('allows a matching saved provider link to enable the remote control connection', () => {
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
      state: 'linked_but_remote_disabled',
      can_connect: true,
      can_disconnect: true,
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

  it('blocks when runtime-control is missing', () => {
    expect(buildDesktopProviderRuntimeLinkPlan(target({
      runtime_control_available: false,
      runtime_control: undefined,
    }), provider())).toMatchObject({
      state: 'runtime_control_missing',
      can_connect: false,
    });
  });
});
