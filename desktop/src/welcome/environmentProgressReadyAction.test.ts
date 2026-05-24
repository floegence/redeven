import { describe, expect, it } from 'vitest';

import type { DesktopLauncherActionKind, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import {
  runtimeLifecycleProgress,
  type DesktopRuntimeLifecycleOperation,
  type DesktopRuntimeLifecyclePhase,
} from '../shared/desktopRuntimeLifecycleProgress';
import type { EnvironmentActionModel } from './viewModel';
import { runtimeLifecycleReadyPrimaryAction } from './environmentProgressReadyAction';

const openAction: EnvironmentActionModel = {
  intent: 'open',
  label: 'Open',
  enabled: true,
  variant: 'default',
};

function lifecycleActionProgress(input: Readonly<{
  action?: DesktopLauncherActionKind;
  operation?: DesktopRuntimeLifecycleOperation;
  phase?: DesktopRuntimeLifecyclePhase;
  status?: DesktopLauncherActionProgress['status'];
}> = {}): DesktopLauncherActionProgress {
  const phase = input.phase ?? 'runtime_ready';
  return {
    action: input.action ?? 'restart_environment_runtime',
    environment_id: 'local-environment',
    environment_label: 'Local Environment',
    operation_key: 'runtime-operation',
    subject_kind: 'local_environment',
    subject_id: 'local-environment',
    started_at_unix_ms: 100,
    status: input.status ?? 'succeeded',
    phase,
    title: phase === 'runtime_ready' ? 'Runtime ready' : 'Runtime stopped',
    detail: 'Desktop updated the runtime lifecycle.',
    lifecycle_progress: runtimeLifecycleProgress({
      location: 'local_host',
      operation: input.operation ?? 'restart',
      phase,
      targetID: 'local-environment',
      targetLabel: 'Local Environment',
    }),
  };
}

describe('runtimeLifecycleReadyPrimaryAction', () => {
  it('returns the Open action once a runtime start or restart reaches runtime_ready', () => {
    expect(runtimeLifecycleReadyPrimaryAction(lifecycleActionProgress(), openAction)).toBe(openAction);
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({ action: 'start_environment_runtime', operation: 'start' }),
      openAction,
    )).toBe(openAction);
  });

  it('allows Focus when the environment window is already open', () => {
    const focusAction: EnvironmentActionModel = {
      intent: 'focus',
      label: 'Focus',
      enabled: true,
      variant: 'default',
    };

    expect(runtimeLifecycleReadyPrimaryAction(lifecycleActionProgress(), focusAction)).toBe(focusAction);
  });

  it('does not offer Open for stop or non-ready terminal lifecycle progress', () => {
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({
        action: 'stop_environment_runtime',
        operation: 'stop',
        phase: 'runtime_stopped',
      }),
      openAction,
    )).toBeNull();
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({
        action: 'update_environment_runtime',
        operation: 'update',
        phase: 'runtime_up_to_date',
      }),
      openAction,
    )).toBeNull();
  });

  it('requires a succeeded lifecycle and an enabled Open-owned primary action', () => {
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress({ status: 'failed' }),
      openAction,
    )).toBeNull();
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress(),
      { ...openAction, enabled: false },
    )).toBeNull();
    expect(runtimeLifecycleReadyPrimaryAction(
      lifecycleActionProgress(),
      { ...openAction, intent: 'restart_runtime', label: 'Restart runtime' },
    )).toBeNull();
  });
});
