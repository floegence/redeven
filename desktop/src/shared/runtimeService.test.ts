import { describe, expect, it } from 'vitest';

import {
  envAppShellUnavailableOpenReadiness,
  normalizeRuntimeServiceSnapshot,
  runtimeServiceAllowsOpenAttempt,
  runtimeServiceDesktopModelSourceBindingState,
  runtimeServiceIsOpenable,
  runtimeServiceMatchesIdentity,
  runtimeServiceNeedsDesktopUpdate,
  runtimeServiceNeedsRuntimeUpdate,
  runtimeServiceOpenReadinessLabel,
  runtimeServiceProviderConnectionState,
  runtimeServiceProviderLinkBinding,
  runtimeServiceProviderLinkMatches,
  runtimeServiceSupportsDesktopModelSource,
  runtimeServiceSupportsProviderLink,
  runtimeServiceSupportsRuntimeGateway,
} from './runtimeService';

describe('runtimeService', () => {
  it('treats missing open-readiness as openable for otherwise compatible runtimes', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.9',
      compatibility: 'compatible',
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(true);
    expect(runtimeServiceAllowsOpenAttempt(snapshot)).toBe(true);
    expect(snapshot.open_readiness).toEqual({ state: 'openable' });
    expect(runtimeServiceOpenReadinessLabel(snapshot)).toBe(
      'Runtime is ready to open.',
    );
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(false);
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

  it('allows Open attempts for compatibility update blocks while preserving the update type', () => {
    const runtimeUpdate = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.9',
      compatibility: 'update_required',
      compatibility_message: 'Redeven Desktop has a newer bundled runtime.',
      active_workload: {},
    });
    const desktopUpdate = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.8.0',
      compatibility: 'desktop_update_required',
      compatibility_message: 'Update Desktop before opening this runtime.',
      active_workload: {},
    });

    expect(runtimeUpdate.open_readiness).toEqual({
      state: 'blocked',
      reason_code: 'runtime_update_required',
      message: 'Redeven Desktop has a newer bundled runtime.',
    });
    expect(runtimeServiceIsOpenable(runtimeUpdate)).toBe(false);
    expect(runtimeServiceAllowsOpenAttempt(runtimeUpdate)).toBe(true);
    expect(runtimeServiceNeedsRuntimeUpdate(runtimeUpdate)).toBe(true);
    expect(runtimeServiceNeedsDesktopUpdate(runtimeUpdate)).toBe(false);

    expect(desktopUpdate.open_readiness).toEqual({
      state: 'blocked',
      reason_code: 'desktop_update_required',
      message: 'Update Desktop before opening this runtime.',
    });
    expect(runtimeServiceIsOpenable(desktopUpdate)).toBe(false);
    expect(runtimeServiceAllowsOpenAttempt(desktopUpdate)).toBe(true);
    expect(runtimeServiceNeedsRuntimeUpdate(desktopUpdate)).toBe(false);
    expect(runtimeServiceNeedsDesktopUpdate(desktopUpdate)).toBe(true);
  });

  it('treats a missing Env App shell as an update-required runtime block', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.0.0-dev',
      compatibility: 'compatible',
      open_readiness: envAppShellUnavailableOpenReadiness(),
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(false);
    expect(runtimeServiceAllowsOpenAttempt(snapshot)).toBe(true);
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(true);
    expect(runtimeServiceOpenReadinessLabel(snapshot)).toBe(
      'The Environment App shell is not available in this runtime build. Install the update, then restart the runtime when it is safe to interrupt active work.',
    );
  });

  it('allows Open attempts while Env App readiness is still starting', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.11',
      compatibility: 'compatible',
      open_readiness: {
        state: 'starting',
        reason_code: 'env_app_gateway_starting',
        message: 'Env App gateway is starting.',
      },
      active_workload: {},
    });

    expect(runtimeServiceIsOpenable(snapshot)).toBe(false);
    expect(runtimeServiceAllowsOpenAttempt(snapshot)).toBe(true);
    expect(runtimeServiceNeedsRuntimeUpdate(snapshot)).toBe(false);
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

  it('normalizes Desktop model source capability and binding status', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.3',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      capabilities: {
        desktop_model_source: {
          supported: true,
        },
      },
      bindings: {
        desktop_model_source: {
          state: 'bound',
          session_id: ' desktop-session ',
          model_count: 2,
          missing_key_provider_ids: ['openai', '', 'anthropic', 'openai'],
        },
      },
      active_workload: {},
    });

    expect(runtimeServiceSupportsDesktopModelSource(snapshot)).toBe(true);
    expect(runtimeServiceDesktopModelSourceBindingState(snapshot)).toBe('bound');
    expect(snapshot.capabilities?.desktop_model_source.bind_method).toBe('runtime_control_v1');
    expect(snapshot.bindings?.desktop_model_source).toMatchObject({
      state: 'bound',
      session_id: 'desktop-session',
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
          provider_origin: ' https://provider.example.invalid ',
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
      provider_origin: 'https://provider.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      local_environment_public_id: 'lenv_demo',
      binding_generation: 5,
      remote_enabled: false,
      last_connected_at_unix_ms: 1778750000000,
    });
    expect(runtimeServiceProviderLinkMatches(snapshot, {
      provider_origin: 'https://provider.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
    })).toBe(true);
    expect(runtimeServiceProviderLinkMatches(snapshot, {
      provider_origin: 'https://provider.example.invalid',
      provider_id: 'example_control_plane',
      env_public_id: 'env_other',
    })).toBe(false);
  });

  it('normalizes runtime-advertised Gateway capability while keeping old snapshots unsupported', () => {
    const supported = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.3',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      capabilities: {
        runtime_gateway: {
          supported: true,
        },
      },
      active_workload: {},
    });
    const legacy = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.2',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    });

    expect(runtimeServiceSupportsRuntimeGateway(supported)).toBe(true);
    expect(supported.capabilities?.runtime_gateway?.bind_method).toBe('runtime_control_v1');
    expect(runtimeServiceSupportsRuntimeGateway(legacy)).toBe(false);
    expect(legacy.capabilities?.runtime_gateway).toEqual({ supported: false });
  });

  it('marks Provider Link unsupported when runtime capability is absent', () => {
    const snapshot = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v1.2.3',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      bindings: {
        provider_link: {
          state: 'linked',
          provider_origin: 'https://provider.example.invalid',
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
          provider_origin: 'https://provider.example.invalid',
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
          provider_origin: 'https://provider.example.invalid',
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
