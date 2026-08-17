import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type {
  DesktopRuntimeHostAccess,
  DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import { desktopEntryKindSupportsRuntimeManagement } from '../shared/environmentManagementPrinciples';

export type ProviderRuntimeDirectSetupConnectionKind =
  | 'local_host'
  | 'ssh_host'
  | 'local_container'
  | 'ssh_container';

export type ProviderRuntimeDirectSetupCandidate = Readonly<{
  environment_id: string;
  label: string;
  secondary_text: string;
  connection_kind: ProviderRuntimeDirectSetupConnectionKind;
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
}>;

function directSetupConnectionKind(
  hostAccess: DesktopRuntimeHostAccess,
  placement: DesktopRuntimePlacement,
): ProviderRuntimeDirectSetupConnectionKind {
  if (placement.kind === 'container_process') {
    return hostAccess.kind === 'ssh_host' ? 'ssh_container' : 'local_container';
  }
  return hostAccess.kind === 'ssh_host' ? 'ssh_host' : 'local_host';
}

export function providerRuntimeDirectSetupCandidates(
  entries: readonly DesktopEnvironmentEntry[],
  providerEnvironmentID: string,
): readonly ProviderRuntimeDirectSetupCandidate[] {
  return entries.flatMap((entry) => {
    if (
      entry.id === providerEnvironmentID
      || !desktopEntryKindSupportsRuntimeManagement(entry.kind)
      || !entry.managed_runtime_host_access
      || !entry.managed_runtime_placement
    ) {
      return [];
    }
    return [{
      environment_id: entry.id,
      label: entry.label,
      secondary_text: entry.secondary_text,
      connection_kind: directSetupConnectionKind(
        entry.managed_runtime_host_access,
        entry.managed_runtime_placement,
      ),
      host_access: entry.managed_runtime_host_access,
      placement: entry.managed_runtime_placement,
    }];
  });
}
