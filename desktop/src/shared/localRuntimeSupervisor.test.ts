import { describe, expect, it } from 'vitest';

import { buildDesktopLocalRuntimeOpenPlan } from './localRuntimeSupervisor';
import { normalizeRuntimeServiceSnapshot } from './runtimeService';

describe('localRuntimeSupervisor', () => {
  it('guides Local Environment update blocks through the Desktop update handoff', () => {
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
        expectedRuntimeIdentity: { runtime_version: 'v0.6.7' },
      },
    );

    expect(plan).toMatchObject({
      state: 'restart_to_update',
      can_open: false,
      can_prepare: false,
      requires_restart: true,
      requires_confirmation: false,
      message: 'Open the Redeven Desktop update handoff before opening this Local Environment. Open stays separate from runtime maintenance.',
    });
  });

  it('keeps active local work blocked before the Desktop update handoff', () => {
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
        expectedRuntimeIdentity: { runtime_version: 'v0.6.7' },
      },
    );

    expect(plan).toMatchObject({
      state: 'blocked_active_work',
      can_open: false,
      can_prepare: false,
      requires_restart: true,
      requires_confirmation: true,
      message: 'Redeven Desktop needs an update, but active work is still running. Close or stop that work before opening the Desktop update handoff.',
    });
  });
});
