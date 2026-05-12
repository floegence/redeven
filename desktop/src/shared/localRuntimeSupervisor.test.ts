import { describe, expect, it } from 'vitest';

import {
  buildDesktopLocalRuntimeOpenPlan,
  desktopLocalRuntimePlanAllowsAutoLocalOpen,
  type DesktopLocalRuntimeObservation,
  type DesktopLocalRuntimeTarget,
} from './localRuntimeSupervisor';
import type { RuntimeServiceSnapshot } from './runtimeService';

const providerTarget: DesktopLocalRuntimeTarget = {
  kind: 'provider_environment',
  provider_origin: 'https://cp.example.invalid',
  provider_id: 'example_control_plane',
  env_public_id: 'env_demo',
};

const DESKTOP_OWNER_ID = 'desktop-owner-1';

function runtimeService(overrides: Partial<RuntimeServiceSnapshot> = {}): RuntimeServiceSnapshot {
  return {
    protocol_version: 'redeven-runtime-v1',
    service_owner: 'desktop',
    desktop_managed: true,
    effective_run_mode: 'desktop',
    remote_enabled: false,
    compatibility: 'compatible',
    open_readiness: { state: 'openable' },
    active_workload: {
      terminal_count: 0,
      session_count: 0,
      task_count: 0,
      port_forward_count: 0,
    },
    ...overrides,
  };
}

function runtime(overrides: Partial<DesktopLocalRuntimeObservation> = {}): DesktopLocalRuntimeObservation {
  return {
    local_ui_url: 'http://localhost:23998/',
    desktop_managed: true,
    desktop_owner_id: DESKTOP_OWNER_ID,
    runtime_service: runtimeService(),
    ...overrides,
  };
}

function buildPlan(
  observedRuntime: DesktopLocalRuntimeObservation | null | undefined,
  options: Parameters<typeof buildDesktopLocalRuntimeOpenPlan>[2] = {},
) {
  return buildDesktopLocalRuntimeOpenPlan(providerTarget, observedRuntime, {
    desktopOwnerID: DESKTOP_OWNER_ID,
    ...options,
  });
}

describe('localRuntimeSupervisor', () => {
  it('allows provider Open to start the singleton runtime when it is not running', () => {
    expect(buildDesktopLocalRuntimeOpenPlan(providerTarget, undefined)).toMatchObject({
      state: 'not_running',
      runtime_running: false,
      can_open: true,
      can_prepare: true,
      requires_bootstrap: true,
      requires_restart: false,
    });
  });

  it('marks matching provider runtimes as directly openable', () => {
    expect(buildPlan(runtime({
      controlplane_base_url: 'https://cp.example.invalid',
      controlplane_provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
    }))).toMatchObject({
      state: 'openable',
      runtime_running: true,
      runtime_matches_target: true,
      can_open: true,
      can_prepare: false,
      requires_restart: false,
    });
  });

  it('plans a Desktop-managed restart when the singleton runtime needs provider binding', () => {
    expect(buildPlan(runtime())).toMatchObject({
      state: 'restart_to_bind',
      runtime_running: true,
      runtime_matches_target: false,
      desktop_can_manage: true,
      can_open: true,
      can_prepare: true,
      requires_restart: true,
    });
  });

  it('plans a Desktop-managed restart when the running runtime needs the bundled update', () => {
    expect(buildPlan(runtime({
      controlplane_base_url: 'https://cp.example.invalid',
      controlplane_provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      runtime_service: runtimeService({
        compatibility: 'update_required',
        open_readiness: {
          state: 'blocked',
          reason_code: 'runtime_update_required',
          message: 'Update the runtime before opening.',
        },
      }),
    }))).toMatchObject({
      state: 'restart_to_update',
      runtime_matches_target: true,
      can_open: true,
      can_prepare: true,
      requires_restart: true,
    });
  });

  it('plans a Desktop-managed restart when the runtime identity does not match the bundled runtime', () => {
    expect(buildPlan(runtime({
      controlplane_base_url: 'https://cp.example.invalid',
      controlplane_provider_id: 'example_control_plane',
      env_public_id: 'env_demo',
      runtime_service: runtimeService({
        runtime_version: 'v1.0.0',
        runtime_commit: 'old-commit',
        runtime_build_time: 'old-build',
      }),
    }), {
      expectedRuntimeIdentity: {
        runtime_version: 'v2.0.0',
        runtime_commit: 'new-commit',
        runtime_build_time: 'new-build',
      },
    })).toMatchObject({
      state: 'restart_to_update',
      runtime_matches_target: true,
      can_open: true,
      can_prepare: true,
      requires_restart: true,
    });
  });

  it('treats a running runtime without service metadata as needing the bundled update', () => {
    expect(buildPlan(runtime({
      runtime_service: undefined,
    }))).toMatchObject({
      state: 'restart_to_update',
      can_open: true,
      can_prepare: true,
      requires_restart: true,
    });
  });

  it('blocks automatic restart when active work would be interrupted', () => {
    expect(buildPlan(runtime({
      runtime_service: runtimeService({
        active_workload: {
          terminal_count: 1,
          session_count: 0,
          task_count: 0,
          port_forward_count: 0,
        },
      }),
    }))).toMatchObject({
      state: 'blocked_active_work',
      can_open: false,
      can_prepare: false,
      requires_restart: true,
      requires_confirmation: true,
    });
  });

  it('blocks silent takeover of an external-managed runtime', () => {
    expect(buildPlan(runtime({
      desktop_managed: false,
      desktop_owner_id: undefined,
      runtime_service: runtimeService({
        service_owner: 'external',
        desktop_managed: false,
      }),
    }))).toMatchObject({
      state: 'blocked_external_runtime',
      desktop_can_manage: false,
      can_open: false,
      can_prepare: false,
      requires_restart: true,
    });
  });

  it('blocks a Desktop-managed runtime leased to another Desktop', () => {
    expect(buildPlan(runtime({
      desktop_owner_id: 'other-desktop-owner',
    }))).toMatchObject({
      state: 'blocked_external_runtime',
      desktop_can_manage: false,
      can_open: false,
      can_prepare: false,
      requires_restart: true,
    });
  });

  it('reclaims an idle legacy Desktop-managed runtime without a lease owner', () => {
    expect(buildPlan(runtime({
      desktop_owner_id: undefined,
    }))).toMatchObject({
      state: 'restart_to_reclaim',
      desktop_can_manage: true,
      can_open: true,
      can_prepare: true,
      requires_restart: true,
    });
  });

  it('blocks reclaiming a legacy Desktop-managed runtime while active work exists', () => {
    expect(buildPlan(runtime({
      desktop_owner_id: undefined,
      runtime_service: runtimeService({
        active_workload: {
          terminal_count: 0,
          session_count: 1,
          task_count: 0,
          port_forward_count: 0,
        },
      }),
    }))).toMatchObject({
      state: 'blocked_active_work',
      can_open: false,
      can_prepare: false,
      requires_restart: true,
      requires_confirmation: true,
    });
  });

  it('uses the plan as the auto-route authority without overriding explicit remote preference', () => {
    const plan = buildDesktopLocalRuntimeOpenPlan(providerTarget, undefined);

    expect(desktopLocalRuntimePlanAllowsAutoLocalOpen(plan, 'auto')).toBe(true);
    expect(desktopLocalRuntimePlanAllowsAutoLocalOpen(plan, 'local_host')).toBe(true);
    expect(desktopLocalRuntimePlanAllowsAutoLocalOpen(plan, 'remote_desktop')).toBe(false);
  });
});
