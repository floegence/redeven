import type { AgentLatestVersion } from '../services/controlplaneApi';

export type DesktopManagedAgentState = Readonly<{
  desktopManaged: boolean;
  message: string;
}>;

const DEFAULT_DESKTOP_MANAGED_MESSAGE = 'Managed by Redeven Desktop. Update from the desktop release instead of self-upgrade.';

export function resolveDesktopManagedAgentState(latestMeta: AgentLatestVersion | null | undefined): DesktopManagedAgentState {
  const desktopManaged = Boolean(latestMeta?.desktop_managed);
  if (!desktopManaged) {
    return {
      desktopManaged: false,
      message: '',
    };
  }

  const message = String(latestMeta?.message ?? '').trim() || DEFAULT_DESKTOP_MANAGED_MESSAGE;
  return {
    desktopManaged: true,
    message,
  };
}
