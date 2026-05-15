import { describe, expect, it } from 'vitest';

import {
  desktopManagedRuntimeLifecycleActions,
  desktopRuntimeControlStatusAvailable,
  desktopRuntimeControlStatusMissing,
  desktopRuntimeControlStatusOwnerMismatch,
} from './desktopRuntimePresence';

const hostPlacement = { kind: 'host_process' as const, install_dir: '' };

describe('desktopRuntimePresence', () => {
  it('derives shared lifecycle actions for running managed runtimes', () => {
    expect(desktopManagedRuntimeLifecycleActions({
      running: true,
      lifecycle_control: 'start_stop',
      placement: hostPlacement,
    })).toEqual([
      { intent: 'stop_runtime', label: 'Stop runtime', primary: true },
      { intent: 'refresh_runtime', label: 'Refresh runtime status', primary: false },
    ]);
  });

  it('keeps Stop runtime visible when maintenance adds restart or update actions', () => {
    expect(desktopManagedRuntimeLifecycleActions({
      running: true,
      lifecycle_control: 'start_stop',
      placement: hostPlacement,
      maintenance: {
        kind: 'ssh_runtime_restart_required',
        required_for: 'open',
        can_desktop_restart: true,
        has_active_work: false,
        active_work_label: 'No active work',
        message: 'Restart required.',
      },
    }).map((action) => action.intent)).toEqual([
      'stop_runtime',
      'restart_runtime',
      'refresh_runtime',
    ]);
  });

  it('starts only the runtime process for running container placements', () => {
    expect(desktopManagedRuntimeLifecycleActions({
      running: false,
      lifecycle_control: 'start_stop',
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'abc123',
        container_label: 'web',
        runtime_root: '/runtime',
        bridge_strategy: 'exec_stream',
      },
    })).toEqual([
      { intent: 'start_runtime', label: 'Start runtime', primary: true },
      { intent: 'refresh_runtime', label: 'Refresh runtime status', primary: false },
    ]);
  });

  it('uses observe-only lifecycle for unavailable containers', () => {
    expect(desktopManagedRuntimeLifecycleActions({
      running: false,
      lifecycle_control: 'observe_only',
      placement: {
        kind: 'container_process',
        container_engine: 'docker',
        container_id: 'abc123',
        container_label: 'web',
        runtime_root: '/runtime',
        bridge_strategy: 'exec_stream',
      },
    })).toEqual([
      { intent: 'refresh_runtime', label: 'Refresh runtime status', primary: false },
    ]);
  });

  it('uses explicit runtime-control status values without exposing tokens', () => {
    expect(desktopRuntimeControlStatusAvailable()).toEqual({
      state: 'available',
      owner: 'current_desktop',
    });
    expect(desktopRuntimeControlStatusMissing('not_reported', '')).toMatchObject({
      state: 'missing',
      reason_code: 'not_reported',
    });
    expect(desktopRuntimeControlStatusOwnerMismatch('')).toMatchObject({
      state: 'owner_mismatch',
      owner: 'other_desktop',
    });
  });
});
