import type { ManagedRuntime } from './runtimeProcess';
import type { StartupReport } from './startup';
import type { DesktopLocalEnvironmentOwner } from '../shared/desktopLocalEnvironmentState';

export type DesktopSessionRuntimeKind = 'local_environment' | 'ssh';
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
    persistedOwner?: DesktopLocalEnvironmentOwner;
    desktopOwnerID?: string;
  }>,
): DesktopSessionRuntimeLifecycleOwner {
  if (!options.attached) {
    return 'desktop';
  }
  const desktopOwnerID = String(options.desktopOwnerID ?? '').trim();
  const startupOwnerID = String(startup.desktop_owner_id ?? '').trim();
  if (
    startup.desktop_managed === true
    && desktopOwnerID !== ''
    && startupOwnerID !== ''
    && startupOwnerID === desktopOwnerID
  ) {
    return 'desktop';
  }
  if (startup.desktop_managed === true) {
    return 'external';
  }
  if (startup.desktop_managed === false) {
    return 'external';
  }
  return options.persistedOwner === 'desktop' ? 'desktop' : 'external';
}

export function desktopSessionRuntimeHandleFromManagedRuntime(
  runtime: ManagedRuntime,
  options: Readonly<{
    persistedOwner?: DesktopLocalEnvironmentOwner;
    desktopOwnerID?: string;
  }> = {},
): DesktopSessionRuntimeHandle {
  const lifecycleOwner = resolveManagedRuntimeLifecycleOwner(runtime.startup, {
    attached: runtime.attached,
    persistedOwner: options.persistedOwner,
    desktopOwnerID: options.desktopOwnerID,
  });
  return {
    runtime_kind: 'local_environment',
    lifecycle_owner: lifecycleOwner,
    launch_mode: runtime.attached ? 'attached' : 'spawned',
    stop: lifecycleOwner === 'desktop' ? runtime.stop : noopStop,
  };
}
