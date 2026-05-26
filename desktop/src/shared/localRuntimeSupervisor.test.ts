import { describe, expect, it } from 'vitest';

import { buildDesktopLocalRuntimeOpenPlan } from './localRuntimeSupervisor';
import { normalizeRuntimeServiceSnapshot } from './runtimeService';

describe('localRuntimeSupervisor', () => {
  it('keeps Local Environment Open available when the running runtime reports a runtime update block', () => {
    const runtimeService = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.9',
      compatibility: 'update_required',
      compatibility_message: 'Redeven Desktop has a newer bundled runtime.',
      open_readiness: {
        state: 'blocked',
        reason_code: 'runtime_update_required',
        message: 'Redeven Desktop has a newer bundled runtime.',
      },
      active_workload: {},
    });
    const plan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        desktop_owner_id: 'desktop-owner',
        runtime_service: runtimeService,
      },
      {
        desktopOwnerID: 'desktop-owner',
      },
    );

    expect(plan).toMatchObject({
      state: 'openable',
      can_open: true,
      can_prepare: false,
      requires_restart: false,
      requires_confirmation: false,
      message: 'Desktop will try opening this runtime and report upgrade guidance if the runtime rejects the connection.',
    });
  });

  it('keeps Local Environment Open available even when an update-required runtime has active work', () => {
    const runtimeService = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.9',
      compatibility: 'update_required',
      open_readiness: {
        state: 'blocked',
        reason_code: 'runtime_update_required',
        message: 'Redeven Desktop has a newer bundled runtime.',
      },
      active_workload: {
        terminal_count: 1,
      },
    });
    const plan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        desktop_owner_id: 'desktop-owner',
        runtime_service: runtimeService,
      },
      {
        desktopOwnerID: 'desktop-owner',
      },
    );

    expect(plan).toMatchObject({
      state: 'openable',
      can_open: true,
      can_prepare: false,
      requires_restart: false,
      requires_confirmation: false,
      message: 'Desktop will try opening this runtime and report upgrade guidance if the runtime rejects the connection.',
    });
  });

  it('keeps Local Environment Open available when a newer runtime requires a Desktop update', () => {
    const runtimeService = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.8.0',
      compatibility: 'desktop_update_required',
      open_readiness: {
        state: 'blocked',
        reason_code: 'desktop_update_required',
        message: 'Update Desktop before opening this runtime.',
      },
      active_workload: {},
    });
    const plan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        desktop_owner_id: 'desktop-owner',
        runtime_service: runtimeService,
      },
      {
        desktopOwnerID: 'desktop-owner',
      },
    );

    expect(plan).toMatchObject({
      state: 'openable',
      can_open: true,
      requires_restart: false,
      message: 'Desktop will try opening this runtime and report upgrade guidance if the runtime rejects the connection.',
    });
  });

  it('keeps Local Environment Open available when compatible runtimes omit open-readiness', () => {
    const runtimeService = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.8',
      compatibility: 'compatible',
      active_workload: {},
    });
    const plan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        desktop_owner_id: 'desktop-owner',
        runtime_service: runtimeService,
      },
      {
        desktopOwnerID: 'desktop-owner',
      },
    );

    expect(plan).toMatchObject({
      state: 'openable',
      can_open: true,
      requires_restart: false,
      message: 'Runtime is ready to open.',
    });
  });

  it('does not block Local Host reuse when the running runtime identity differs from the bundled runtime', () => {
    const runtimeService = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.9',
      runtime_commit: 'old-runtime',
      runtime_build_time: '2026-01-01T00:00:00Z',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {},
    });
    const plan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        desktop_owner_id: 'desktop-owner',
        runtime_service: runtimeService,
      },
      {
        desktopOwnerID: 'desktop-owner',
      },
    );

    expect(plan).toMatchObject({
      state: 'openable',
      can_open: true,
      can_prepare: false,
      requires_restart: false,
      requires_confirmation: false,
      message: 'Runtime is ready to open.',
    });
  });

  it('keeps Local Environment Open available while Env App readiness is starting', () => {
    const runtimeService = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.11',
      compatibility: 'compatible',
      open_readiness: {
        state: 'starting',
        reason_code: 'env_app_gateway_starting',
        message: 'Env App gateway is starting.',
      },
      active_workload: {},
    });
    const plan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        desktop_owner_id: 'desktop-owner',
        runtime_service: runtimeService,
      },
      {
        desktopOwnerID: 'desktop-owner',
      },
    );

    expect(plan).toMatchObject({
      state: 'starting',
      can_open: true,
      can_prepare: false,
      requires_restart: false,
      message: 'Env App gateway is starting.',
    });
  });

  it('keeps reclaim protection when an unowned runtime has active work', () => {
    const runtimeService = normalizeRuntimeServiceSnapshot({
      runtime_version: 'v0.5.11',
      compatibility: 'compatible',
      open_readiness: { state: 'openable' },
      active_workload: {
        session_count: 1,
      },
    });
    const plan = buildDesktopLocalRuntimeOpenPlan(
      { kind: 'local_environment' },
      {
        local_ui_url: 'http://127.0.0.1:24001/',
        desktop_managed: true,
        desktop_owner_id: '',
        runtime_service: runtimeService,
      },
      {
        desktopOwnerID: 'desktop-owner',
      },
    );

    expect(plan).toMatchObject({
      state: 'blocked_active_work',
      can_open: false,
      requires_restart: true,
      requires_confirmation: true,
    });
  });
});
