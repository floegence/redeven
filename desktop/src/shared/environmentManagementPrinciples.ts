import type { DesktopEnvironmentEntryKind, DesktopLauncherActionKind, DesktopLocalEnvironmentStateRoute } from './desktopLauncherIPC';
import type { DesktopProviderRuntimeLinkTargetID } from './providerRuntimeLinkTarget';
import { normalizeDesktopProviderRuntimeLinkTargetID } from './providerRuntimeLinkTarget';

export type DesktopEnvironmentManagementSurface = 'provider_card' | 'managed_runtime_card' | 'unmanaged_environment_card';

export const DESKTOP_PROVIDER_ENVIRONMENT_OPEN_ROUTE: Extract<DesktopLocalEnvironmentStateRoute, 'remote_desktop'> = 'remote_desktop';

export const DESKTOP_PROVIDER_CARD_FORBIDDEN_ACTIONS = [
  'open_local_environment',
  'open_remote_environment',
  'open_ssh_environment',
  'start_environment_runtime',
  'stop_environment_runtime',
  'connect_provider_runtime',
  'disconnect_provider_runtime',
] as const satisfies readonly DesktopLauncherActionKind[];

export const DESKTOP_MANAGED_RUNTIME_ENTRY_KINDS = [
  'local_environment',
  'ssh_environment',
] as const satisfies readonly DesktopEnvironmentEntryKind[];

export type DesktopProviderRuntimeLinkRequestFields = Readonly<{
  provider_environment_id?: unknown;
  runtime_target_id?: unknown;
}>;

export type DesktopProviderRuntimeLinkRequestTarget = Readonly<{
  provider_environment_id: string;
  runtime_target_id: DesktopProviderRuntimeLinkTargetID;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

// IMPORTANT: Provider Environment cards are provider-tunnel access surfaces only.
// Runtime lifecycle and provider-link management belong exclusively to Local/SSH
// runtime cards so a user never grants provider control from the remote access card.
// A saved provider link may auto-restore during runtime startup, but that belongs
// to the managed runtime lifecycle and must not become a Provider card action.
export function desktopEnvironmentManagementSurface(
  kind: DesktopEnvironmentEntryKind,
): DesktopEnvironmentManagementSurface {
  if (kind === 'provider_environment') {
    return 'provider_card';
  }
  if (desktopEntryKindOwnsRuntimeManagement(kind)) {
    return 'managed_runtime_card';
  }
  return 'unmanaged_environment_card';
}

export function desktopProviderEnvironmentOpenRoute(): Extract<DesktopLocalEnvironmentStateRoute, 'remote_desktop'> {
  return DESKTOP_PROVIDER_ENVIRONMENT_OPEN_ROUTE;
}

export function desktopProviderCardAllowsAction(action: DesktopLauncherActionKind): boolean {
  return !DESKTOP_PROVIDER_CARD_FORBIDDEN_ACTIONS.includes(action as (typeof DESKTOP_PROVIDER_CARD_FORBIDDEN_ACTIONS)[number]);
}

export function desktopEntryKindOwnsRuntimeManagement(kind: DesktopEnvironmentEntryKind): boolean {
  return DESKTOP_MANAGED_RUNTIME_ENTRY_KINDS.includes(kind as (typeof DESKTOP_MANAGED_RUNTIME_ENTRY_KINDS)[number]);
}

// IMPORTANT: Provider-link requests are runtime-target-first and must name the
// exact Local/SSH runtime target selected by the user. Do not add automatic
// target selection, implicit fallback targets, or provider-card initiated links.
export function normalizeDesktopProviderRuntimeLinkRequestTarget(
  fields: DesktopProviderRuntimeLinkRequestFields,
): DesktopProviderRuntimeLinkRequestTarget | null {
  const providerEnvironmentID = compact(fields.provider_environment_id);
  const runtimeTargetID = normalizeDesktopProviderRuntimeLinkTargetID(fields.runtime_target_id);
  if (providerEnvironmentID === '' || !runtimeTargetID) {
    return null;
  }
  return {
    provider_environment_id: providerEnvironmentID,
    runtime_target_id: runtimeTargetID,
  };
}
