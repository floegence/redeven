import type { DesktopEnvironmentEntry } from './desktopLauncherIPC';

export type ProviderRuntimeLifecycleOperation = 'start' | 'stop' | 'restart' | 'update_runtime';

export function providerRuntimeGatewayCandidates(
  providerEnvironment: DesktopEnvironmentEntry,
  environments: readonly DesktopEnvironmentEntry[],
  operation: ProviderRuntimeLifecycleOperation,
): readonly DesktopEnvironmentEntry[] {
  const providerManagement = providerEnvironment.kind === 'provider_environment'
    ? providerEnvironment.runtime_management
    : undefined;
  const providerTarget = providerManagement?.presentation_state === 'allowed'
    ? providerManagement.target
    : undefined;
  if (!providerTarget || !providerManagement?.operations?.includes(operation)) {
    return [];
  }
  return environments.filter((candidate) => {
    if (candidate.kind !== 'gateway_environment') {
      return false;
    }
    const gatewayManagement = candidate.runtime_management;
    return gatewayManagement?.presentation_state === 'allowed'
      && gatewayManagement.target?.lifecycle_target_id === providerTarget.lifecycle_target_id
      && gatewayManagement.target.target_generation === providerTarget.target_generation
      && gatewayManagement.operations?.includes(operation) === true;
  });
}
