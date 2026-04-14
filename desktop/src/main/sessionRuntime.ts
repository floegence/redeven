import type { ManagedRuntime } from './runtimeProcess';
import type { StartupReport } from './startup';
import type { DesktopManagedEnvironmentLocalOwner } from '../shared/desktopManagedEnvironment';

export type DesktopSessionRuntimeKind = 'managed_environment' | 'ssh';
export type DesktopSessionRuntimeLifecycleOwner = 'desktop' | 'external';
export type DesktopSessionRuntimeLaunchMode = 'spawned' | 'attached';

export type DesktopSessionRuntimeHandle = Readonly<{
  runtime_kind: DesktopSessionRuntimeKind;
  lifecycle_owner: DesktopSessionRuntimeLifecycleOwner;
  launch_mode: DesktopSessionRuntimeLaunchMode;
  stop: () => Promise<void>;
}>;

function noopStop(): Promise<void> {
  return Promise.resolve();
}

export function resolveManagedRuntimeLifecycleOwner(
  startup: StartupReport,
  options: Readonly<{
    attached: boolean;
    persistedOwner?: DesktopManagedEnvironmentLocalOwner;
  }>,
): DesktopSessionRuntimeLifecycleOwner {
  if (!options.attached) {
    return 'desktop';
  }
  if (startup.desktop_managed === true) {
    return 'desktop';
  }
  if (startup.desktop_managed === false) {
    return 'external';
  }
  return options.persistedOwner === 'desktop' ? 'desktop' : 'external';
}

export function desktopSessionRuntimeHandleFromManagedRuntime(
  runtime: ManagedRuntime,
  options: Readonly<{
    persistedOwner?: DesktopManagedEnvironmentLocalOwner;
  }> = {},
): DesktopSessionRuntimeHandle {
  const lifecycleOwner = resolveManagedRuntimeLifecycleOwner(runtime.startup, {
    attached: runtime.attached,
    persistedOwner: options.persistedOwner,
  });
  return {
    runtime_kind: 'managed_environment',
    lifecycle_owner: lifecycleOwner,
    launch_mode: runtime.attached ? 'attached' : 'spawned',
    stop: lifecycleOwner === 'desktop' ? runtime.stop : noopStop,
  };
}
