import type { ManagedRuntime } from './runtimeProcess';

export type DesktopSessionRuntimeKind = 'local_environment' | 'ssh';
export type DesktopSessionRuntimeLaunchMode = 'spawned' | 'attached';

export type DesktopSessionRuntimeHandle = Readonly<{
  runtime_kind: DesktopSessionRuntimeKind;
  launch_mode: DesktopSessionRuntimeLaunchMode;
  stop: () => Promise<void>;
}>;

export function desktopSessionRuntimeHandleFromManagedRuntime(
  runtime: ManagedRuntime,
  _options: Readonly<Record<string, unknown>> = {},
): DesktopSessionRuntimeHandle {
  return {
    runtime_kind: 'local_environment',
    launch_mode: runtime.attached ? 'attached' : 'spawned',
    stop: runtime.stop,
  };
}
