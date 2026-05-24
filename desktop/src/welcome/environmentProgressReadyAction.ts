import type { DesktopLauncherActionKind, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { DesktopRuntimeLifecycleOperation } from '../shared/desktopRuntimeLifecycleProgress';
import type { EnvironmentActionModel } from './viewModel';

const RUNTIME_READY_ACTIONS: readonly DesktopLauncherActionKind[] = [
  'start_environment_runtime',
  'restart_environment_runtime',
  'update_environment_runtime',
];

const RUNTIME_READY_OPERATIONS: readonly DesktopRuntimeLifecycleOperation[] = [
  'start',
  'restart',
  'update',
];

export function runtimeLifecycleReadyPrimaryAction(
  progress: DesktopLauncherActionProgress,
  primaryAction: EnvironmentActionModel | undefined,
): EnvironmentActionModel | null {
  const lifecycle = progress.lifecycle_progress;
  if (
    progress.status !== 'succeeded'
    || lifecycle?.phase !== 'runtime_ready'
    || !RUNTIME_READY_ACTIONS.includes(progress.action)
    || !RUNTIME_READY_OPERATIONS.includes(lifecycle.operation)
    || !primaryAction?.enabled
    || (primaryAction.intent !== 'open' && primaryAction.intent !== 'focus')
  ) {
    return null;
  }
  return primaryAction;
}
