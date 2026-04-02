import type { DesktopEnvironmentEntry, DesktopLauncherSurface, DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

export type DesktopWelcomeShellViewModel = Readonly<{
  shell_title: 'Redeven Desktop';
  surface_title: string;
  connect_heading: 'Connect Environment';
  primary_action_label: 'Open Local Environment';
  settings_save_label: string;
}>;

export type EnvironmentLibraryFilter = 'all' | 'current' | 'recent' | 'saved';

export function capabilityUnavailableMessage(label: string): string {
  return `Connect to an Environment first to open ${label}.`;
}

export function surfaceTitle(surface: DesktopLauncherSurface): string {
  return surface === 'local_environment_settings' ? 'Local Environment Settings' : 'Connect Environment';
}

export function shellStatus(snapshot: DesktopWelcomeSnapshot): Readonly<{
  tone: 'connected' | 'disconnected' | 'connecting' | 'error';
  label: string;
}> {
  if (snapshot.issue) {
    return {
      tone: 'error',
      label: snapshot.issue.title,
    };
  }
  if (snapshot.current_session_target_kind) {
    return {
      tone: 'connected',
      label: snapshot.current_session_label,
    };
  }
  return {
    tone: 'disconnected',
    label: 'No environment open',
  };
}

export function buildDesktopWelcomeShellViewModel(
  snapshot: DesktopWelcomeSnapshot,
  visibleSurface: DesktopLauncherSurface = snapshot.surface,
): DesktopWelcomeShellViewModel {
  return {
    shell_title: 'Redeven Desktop',
    surface_title: surfaceTitle(visibleSurface),
    connect_heading: 'Connect Environment',
    primary_action_label: 'Open Local Environment',
    settings_save_label: snapshot.settings_surface.save_label,
  };
}

export function isExternalEnvironmentEntry(environment: DesktopEnvironmentEntry): boolean {
  return environment.kind === 'external_local_ui';
}

export function libraryFilterLabel(filter: EnvironmentLibraryFilter): string {
  switch (filter) {
    case 'current':
      return 'Current';
    case 'recent':
      return 'Recent';
    case 'saved':
      return 'Saved';
    default:
      return 'All';
  }
}

export function environmentMatchesLibraryFilter(
  environment: DesktopEnvironmentEntry,
  filter: EnvironmentLibraryFilter,
): boolean {
  if (!isExternalEnvironmentEntry(environment)) {
    return false;
  }
  switch (filter) {
    case 'current':
      return environment.is_current;
    case 'recent':
      return environment.category === 'recent_auto';
    case 'saved':
      return environment.category === 'saved';
    default:
      return true;
  }
}

export function environmentMatchesLibrarySearch(
  environment: DesktopEnvironmentEntry,
  query: string,
): boolean {
  if (!isExternalEnvironmentEntry(environment)) {
    return false;
  }
  const clean = query.trim().toLowerCase();
  if (!clean) {
    return true;
  }
  return [
    environment.label,
    environment.local_ui_url,
    environment.secondary_text,
  ].some((value) => value.toLowerCase().includes(clean));
}

export function filterEnvironmentLibrary(
  snapshot: DesktopWelcomeSnapshot,
  filter: EnvironmentLibraryFilter,
  query = '',
): readonly DesktopEnvironmentEntry[] {
  return snapshot.environments.filter((environment) => (
    environmentMatchesLibraryFilter(environment, filter)
    && environmentMatchesLibrarySearch(environment, query)
  ));
}

export function environmentLibraryCount(
  snapshot: DesktopWelcomeSnapshot,
  filter: EnvironmentLibraryFilter,
): number {
  return filterEnvironmentLibrary(snapshot, filter).length;
}
