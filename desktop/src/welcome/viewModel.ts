import type { DesktopEnvironmentEntry, DesktopLauncherSurface, DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

export type DesktopWelcomeShellViewModel = Readonly<{
  shell_title: 'Redeven Desktop';
  surface_title: string;
  connect_heading: 'Connect Environment';
  primary_action_label: 'Open Local Environment';
  settings_save_label: string;
}>;

export type EnvironmentLibraryFilter = 'all' | 'open' | 'recent' | 'saved';

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
  if (snapshot.open_windows.length > 0) {
    return {
      tone: 'connected',
      label: snapshot.open_windows.length === 1 ? '1 environment window open' : `${snapshot.open_windows.length} environment windows open`,
    };
  }
  return {
    tone: 'disconnected',
    label: 'No environment windows open',
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

export function isRemoteEnvironmentEntry(environment: DesktopEnvironmentEntry): boolean {
  return environment.kind === 'external_local_ui' || environment.kind === 'ssh_environment';
}

export function libraryFilterLabel(filter: EnvironmentLibraryFilter): string {
  switch (filter) {
    case 'open':
      return 'Open';
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
  if (!isRemoteEnvironmentEntry(environment)) {
    return false;
  }
  switch (filter) {
    case 'open':
      return environment.is_open;
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
  if (!isRemoteEnvironmentEntry(environment)) {
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
    environment.ssh_details?.ssh_destination ?? '',
    environment.ssh_details?.remote_install_dir ?? '',
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
