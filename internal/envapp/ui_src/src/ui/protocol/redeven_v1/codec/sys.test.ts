import { describe, expect, it } from 'vitest';

import { fromWireSysPingResponse } from './sys';

describe('sys codec', () => {
  it('decodes runtime service identity and active workload from ping responses', () => {
    expect(fromWireSysPingResponse({
      server_time_ms: 42,
      version: 'v1.4.2',
      runtime_service: {
        runtime_version: 'v1.4.2',
        runtime_commit: 'abc123',
        runtime_build_time: '2026-05-02T00:00:00Z',
        protocol_version: 'redeven-runtime-v1',
        compatibility_epoch: 1,
        service_owner: 'desktop',
        desktop_managed: true,
        effective_run_mode: 'hybrid',
        remote_enabled: true,
        compatibility: 'restart_recommended',
        compatibility_message: 'Restart when your work is idle.',
        minimum_desktop_version: 'v1.4.0',
        minimum_runtime_version: 'v1.4.0',
        compatibility_review_id: 'runtime-service-maintenance-v1',
        open_readiness: {
          state: 'starting',
          reason_code: 'env_app_gateway_starting',
          message: 'Env App gateway is starting.',
        },
        active_workload: {
          terminal_count: 3,
          session_count: 2,
          task_count: 1,
          port_forward_count: 4,
        },
        capabilities: {
          desktop_model_source: {
            supported: true,
            bind_method: 'runtime_control_v1',
          },
          provider_link: {
            supported: true,
            bind_method: 'runtime_control_v1',
          },
        },
        bindings: {
          desktop_model_source: {
            state: 'bound',
            session_id: 'desktop-session',
            connected_at_unix_ms: 1778750000000,
            model_count: 2,
            missing_key_provider_ids: ['openai', 'anthropic', 'openai'],
          },
          provider_link: {
            state: 'linked',
            provider_origin: ' https://redeven.test ',
            provider_id: ' dev_redeven ',
            env_public_id: ' env_demo ',
            access_point_origin: ' https://dev.redeven.test ',
            local_environment_public_id: ' le_demo ',
            binding_generation: 7,
            remote_enabled: true,
            last_connected_at_unix_ms: 1778750000000,
          },
        },
      },
    })).toMatchObject({
      serverTimeMs: 42,
      version: 'v1.4.2',
      runtimeService: {
        runtimeVersion: 'v1.4.2',
        runtimeCommit: 'abc123',
        runtimeBuildTime: '2026-05-02T00:00:00Z',
        protocolVersion: 'redeven-runtime-v1',
        compatibilityEpoch: 1,
        serviceOwner: 'desktop',
        desktopManaged: true,
        effectiveRunMode: 'hybrid',
        remoteEnabled: true,
        compatibility: 'restart_recommended',
        compatibilityMessage: 'Restart when your work is idle.',
        minimumDesktopVersion: 'v1.4.0',
        minimumRuntimeVersion: 'v1.4.0',
        compatibilityReviewId: 'runtime-service-maintenance-v1',
        openReadiness: {
          state: 'starting',
          reasonCode: 'env_app_gateway_starting',
          message: 'Env App gateway is starting.',
        },
        activeWorkload: {
          terminalCount: 3,
          sessionCount: 2,
          taskCount: 1,
          portForwardCount: 4,
        },
        capabilities: {
          desktopModelSource: {
            supported: true,
            bindMethod: 'runtime_control_v1',
          },
          providerLink: {
            supported: true,
            bindMethod: 'runtime_control_v1',
          },
        },
        bindings: {
          desktopModelSource: {
            state: 'bound',
            sessionId: 'desktop-session',
            connectedAtUnixMs: 1778750000000,
            modelCount: 2,
            missingKeyProviderIds: ['anthropic', 'openai'],
          },
          providerLink: {
            state: 'linked',
            providerOrigin: 'https://redeven.test',
            providerId: 'dev_redeven',
            envPublicId: 'env_demo',
            accessPointOrigin: 'https://dev.redeven.test',
            localEnvironmentPublicId: 'le_demo',
            bindingGeneration: 7,
            remoteEnabled: true,
            lastConnectedAtUnixMs: 1778750000000,
          },
        },
      },
    });
  });

  it('normalizes partial runtime service snapshots defensively', () => {
    expect(fromWireSysPingResponse({
      server_time_ms: 0,
      runtime_service: {
        desktop_managed: true,
        service_owner: 'surprise-owner',
        compatibility: 'surprise-state',
        active_workload: {
          terminal_count: -1,
          session_count: 2.9,
          task_count: Number.NaN,
          port_forward_count: 1,
        },
      },
    }).runtimeService).toEqual({
      runtimeVersion: undefined,
      runtimeCommit: undefined,
      runtimeBuildTime: undefined,
      protocolVersion: 'redeven-runtime-v1',
      compatibilityEpoch: undefined,
      serviceOwner: 'desktop',
      desktopManaged: true,
      effectiveRunMode: undefined,
      remoteEnabled: false,
      compatibility: 'unknown',
      compatibilityMessage: undefined,
      minimumDesktopVersion: undefined,
      minimumRuntimeVersion: undefined,
      compatibilityReviewId: undefined,
      openReadiness: undefined,
      activeWorkload: {
        terminalCount: 0,
        sessionCount: 2,
        taskCount: 0,
        portForwardCount: 1,
      },
      capabilities: {
        desktopModelSource: {
          supported: false,
          bindMethod: undefined,
          reasonCode: undefined,
          message: undefined,
        },
        providerLink: {
          supported: false,
          bindMethod: undefined,
          reasonCode: undefined,
          message: undefined,
        },
      },
      bindings: {
        desktopModelSource: {
          state: 'unsupported',
          sessionId: undefined,
          expiresAtUnixMs: undefined,
          connectedAtUnixMs: undefined,
          modelSource: undefined,
          modelCount: 0,
          missingKeyProviderIds: undefined,
          lastError: undefined,
        },
        providerLink: {
          state: 'unsupported',
          providerOrigin: undefined,
          providerId: undefined,
          envPublicId: undefined,
          localEnvironmentPublicId: undefined,
          bindingGeneration: undefined,
          remoteEnabled: false,
          lastConnectedAtUnixMs: undefined,
          lastDisconnectedAtUnixMs: undefined,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
        },
      },
    });
  });

  it('decodes maintenance reconciliation diagnostics from ping responses', () => {
    expect(fromWireSysPingResponse({
      server_time_ms: 42,
      maintenance: {
        kind: 'upgrade',
        state: 'succeeded',
        target_version: 'v1.2.0',
        previous_version: 'v1.1.0',
        observed_version: 'v1.2.0',
        previous_process_started_at_ms: 100,
        observed_process_started_at_ms: 200,
        previous_runtime_instance_id: 'rt_previous',
        observed_runtime_instance_id: 'rt_observed',
        install_dir: '/opt/redeven/bin',
        exe_path: '/opt/redeven/bin/redeven',
        message: 'Redeven updated to v1.2.0.',
        error_code: 'version_mismatch',
        started_at_ms: 10,
        updated_at_ms: 20,
        completed_at_ms: 30,
      },
    }).maintenance).toEqual({
      kind: 'upgrade',
      state: 'succeeded',
      targetVersion: 'v1.2.0',
      previousVersion: 'v1.1.0',
      observedVersion: 'v1.2.0',
      previousProcessStartedAtMs: 100,
      observedProcessStartedAtMs: 200,
      previousRuntimeInstanceId: 'rt_previous',
      observedRuntimeInstanceId: 'rt_observed',
      installDir: '/opt/redeven/bin',
      exePath: '/opt/redeven/bin/redeven',
      message: 'Redeven updated to v1.2.0.',
      errorCode: 'version_mismatch',
      startedAtMs: 10,
      updatedAtMs: 20,
      completedAtMs: 30,
    });
  });
});
