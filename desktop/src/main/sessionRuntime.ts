import type { ManagedAgent } from './agentProcess';

export type DesktopSessionRuntimeOwnerKind = 'managed_environment_runtime' | 'ssh_runtime';

export type DesktopSessionRuntimeHandle = Readonly<{
  owner_kind: DesktopSessionRuntimeOwnerKind;
  restartable: boolean;
  stop: () => Promise<void>;
}>;

export function desktopSessionRuntimeHandleFromManagedAgent(agent: ManagedAgent): DesktopSessionRuntimeHandle {
  return {
    owner_kind: 'managed_environment_runtime',
    restartable: true,
    stop: agent.stop,
  };
}
