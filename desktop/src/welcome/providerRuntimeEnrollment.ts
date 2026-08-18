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

export function providerRuntimeDirectSetupCandidate(
  entries: readonly DesktopEnvironmentEntry[],
  providerEnvironmentID: string,
): ProviderRuntimeDirectSetupCandidate | null {
  const providerEnvironment = entries.find((entry) => (
    entry.id === providerEnvironmentID && entry.kind === 'provider_environment'
  ));
  if (!providerEnvironment) {
    return null;
  }
  const candidates = providerRuntimeDirectSetupCandidates(entries, providerEnvironmentID);
  const linkedTargetID = providerEnvironment.provider_linked_runtime_summary?.runtime_target_id;
  if (linkedTargetID) {
    const linkedCandidate = candidates.find((candidate) => (
      entries.find((entry) => entry.id === candidate.environment_id)
        ?.provider_runtime_link_target?.id === linkedTargetID
    ));
    if (linkedCandidate) {
      return linkedCandidate;
    }
  }
  const identityMatches = candidates.filter((candidate) => {
    const target = entries.find((entry) => entry.id === candidate.environment_id)
      ?.provider_runtime_link_target;
    return !!target
      && !!providerEnvironment.provider_origin
      && !!providerEnvironment.provider_id
      && !!providerEnvironment.env_public_id
      && target.provider_origin === providerEnvironment.provider_origin
      && target.provider_id === providerEnvironment.provider_id
      && target.env_public_id === providerEnvironment.env_public_id;
  });
  if (identityMatches.length === 1) {
    return identityMatches[0];
  }
  return candidates.length === 1 ? candidates[0] : null;
}
