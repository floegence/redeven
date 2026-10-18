import type { DesktopLocalEnvironmentState } from '../shared/desktopLocalEnvironmentState';
import type { DesktopRuntimePlacement } from '../shared/desktopRuntimePlacement';
import { resolveStateRoot } from './statePaths';

/** Saved local authority is independent of transient Runtime Presence. */
export function localHostRuntimeLifecyclePlacement(
  environment: DesktopLocalEnvironmentState,
): Extract<DesktopRuntimePlacement, Readonly<{ kind: 'host_process' }>> {
  return {
    kind: 'host_process',
    runtime_root: String(environment.local_hosting.state_dir ?? '').trim(),
    runtime_state_root: resolveStateRoot(),
  };
}
