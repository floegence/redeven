import { describe, expect, it } from 'vitest';

import {
  envAppShellUnavailableOpenReadiness,
  normalizeRuntimeServiceSnapshot,
  runtimeServiceDesktopAIBrokerBindingState,
  runtimeServiceIsOpenable,
  runtimeServiceMatchesIdentity,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceOpenReadinessLabel,
  runtimeServiceProviderConnectionState,
  runtimeServiceProviderLinkBinding,
  runtimeServiceProviderLinkMatches,
  runtimeServiceSupportsDesktopAIBrokerBinding,
  runtimeServiceSupportsProviderLink,
} from './runtimeService';

describe('runtimeService', () => {
  it('blocks runtimes that do not expose explicit Desktop open-readiness', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.9',
      compatibility: 'compatible',
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(false);
    expect(snapshot.open_readiness).toEqual({
      state: 'blocked',
      reason_code: 'runtime_open_readiness_unavailable',
      message: 'This running runtime is older than this Desktop. Install the update, then restart the runtime when it is safe to interrupt active work.',
    });
    expect(runtimeServiceOpenReadinessLabel(snapshot)).toBe(
      'This running runtime is older than this Desktop. Install the update, then restart the runtime when it is safe to interrupt active work.',
    );
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(true);
  });

  it('keeps explicit openable readiness openable', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.11',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(true);
    expect(snapshot.open_readiness).toEqual({ state: 'openable' });
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(false);
  });

  it('treats a missing Env App shell as an update-required runtime block', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.0.0-dev',
      compatibility: 'compatible',
      open_readiness: envAppShellUnavailableOpenReadiness(),
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(false);
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(true);
    expect(runtimeServiceOpenReadinessLabel(snapshot)).toBe(
      'The Environment App shell is not available in this runtime build. Install the update, then restart the runtime when it is safe to interrupt active work.',
    );
  });

  it('requires every expected bundled identity field to match when present', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.3',
      runtime_commit: 'abc123',
      runtime_build_time: '2026-01-02T03:04:05Z',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    });

    expect(runtimeServiceMatchesIdentity(snapshot, {
      runtime_version: 'v1.2.3',
      runtime_commit: 'abc123',
      runtime_build_time: '2026-01-02T03:04:05Z',
    })).toBe(true);
    expect(runtimeServiceMatchesIdentity(snapshot, {
      runtime_version: 'v1.2.3',
      runtime_commit: 'new-commit',
      runtime_build_time: '2026-01-02T03:04:05Z',
    })).toBe(false);
    expect(runtimeServiceMatchesIdentity(normalizeRuntimeServiceSnapshot({
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    }), {
      runtime_version: 'v1.2.3',
    })).toBe(false);
  });

  it('normalizes Desktop AI Broker capability and binding status', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.3',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      capabilities: {
        desktop_ai_broker: {
          supported: true,
        },
      },
      bindings: {
        desktop_ai_broker: {
          state: 'bound',
          session_id: ' broker-session ',
          ssh_runtime_key: ' ssh:devbox ',
          model_count: 2,
          missing_key_provider_ids: ['openai', '', 'anthropic', 'openai'],
        },
      },
      active_workload: {},
    });

    expect(runtimeServiceSupportsDesktopAIBrokerBinding(snapshot)).toBe(true);
    expect(runtimeServiceDesktopAIBrokerBindingState(snapshot)).toBe('bound');
    expect(snapshot.capabilities?.desktop_ai_broker.bind_method).toBe('runtime_control_v1');
    expect(snapshot.bindings?.desktop_ai_broker).toMatchObject({
      state: 'bound',
      session_id: 'broker-session',
      ssh_runtime_key: 'ssh:devbox',
      model_count: 2,
      missing_key_provider_ids: ['anthropic', 'openai'],
    });
  });

  it('normalizes Provider Link capability and binding status', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.3',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      capabilities: {
        provider_link: {
          supported: true,
        },
      },
      bindings: {
        provider_link: {
          state: 'linked',
          provider_origin: ' https://cp.example.invalid ',
          provider_id: ' example_control_plane ',
          env_public_id: ' env_demo ',
          local_environment_public_id: ' lenv_demo ',
          binding_generation: 5,
          remote_enabled: false,
          last_connected_at_unix_ms: 1778750000000,
        },
      },
      active_workload: {},
    });

    expect(runtimeServiceSupportsProviderLink(snapshot)).toBe(true);
    expect(snapshot.capabilities?.provider_link.bind_method).toBe('runtime_control_v1');
    expect(runtimeServiceProviderLinkBinding(snapshot)).toMatchObject({
      state: 'linked',
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      local_environment_public_id: 'lenv_demo',
      binding_generation: 5,
      remote_enabled: false,
      last_connected_at_unix_ms: 1778750000000,
    });
    expect(runtimeServiceProviderLinkMatches(snapshot, {
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
    })).toBe(true);
    expect(runtimeServiceProviderLinkMatches(snapshot, {
      provider_origin: 'https://cp.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_other',
    })).toBe(false);
  });

  it('marks Provider Link unsupported when runtime capability is absent', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.3',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      bindings: {
        provider_link: {
          state: 'linked',
          provider_origin: 'https://cp.example.invalid',
          provider_id: 'example_control_plane',
          env_public_id: 'env_demo',
          remote_enabled: true,
        },
      },
      active_workload: {},
    });

    expect(runtimeServiceSupportsProviderLink(snapshot)).toBe(false);
    expect(runtimeServiceProviderLinkBinding(snapshot)).toMatchObject({
      state: 'unsupported',
      remote_enabled: false,
    });
  });

  it('derives provider connection state from link and runtime remote facts', () => {
    expect(runtimeServiceProviderConnectionState(normalizeRuntimeServiceSnapshot({
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
      capabilities: { provider_link: { supported: true } },
      bindings: { provider_link: { state: 'unbound' } },
    }))).toBe('unlinked');

    expect(runtimeServiceProviderConnectionState(normalizeRuntimeServiceSnapshot({
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      remote_enabled: true,
      active_workload: {},
      capabilities: { provider_link: { supported: true } },
      bindings: {
        provider_link: {
          state: 'linked',
          provider_origin: 'https://cp.example.invalid',
          provider_id: 'example_control_plane',
          env_public_id: 'env_demo',
          remote_enabled: true,
        },
      },
    }))).toBe('connected');

    expect(runtimeServiceProviderConnectionState(normalizeRuntimeServiceSnapshot({
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      remote_enabled: false,
      active_workload: {},
      capabilities: { provider_link: { supported: true } },
      bindings: {
        provider_link: {
          state: 'linked',
          provider_origin: 'https://cp.example.invalid',
          provider_id: 'example_control_plane',
          env_public_id: 'env_demo',
          remote_enabled: false,
        },
      },
    }))).toBe('error');

    expect(runtimeServiceProviderConnectionState(normalizeRuntimeServiceSnapshot({
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    }))).toBe('unsupported');
  });
});
