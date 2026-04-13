import type { DesktopEnvironmentEntry, DesktopLauncherSurface, DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

export type DesktopWelcomeShellViewModel = Readonly<{
  shell_title: 'Redeven Desktop';
  surface_title: string;
  connect_heading: 'Connect Environment';
  primary_action_label: 'Open Environment';
  settings_save_label: string;
}>;

export type EnvironmentLibraryFilter = 'all' | 'open' | 'recent' | 'saved';
export type EnvironmentCenterTab = 'environments' | 'control_planes';
export type EnvironmentCardTone = 'neutral' | 'primary' | 'success';

export type EnvironmentCardMetaItem = Readonly<{
  label: string;
  value: string;
  monospace?: boolean;
}>;

export type EnvironmentCardModel = Readonly<{
  kind_label: 'Local' | 'Control Plane' | 'Redeven URL' | 'SSH';
  status_label: string;
  status_tone: EnvironmentCardTone;
  source_label: string;
  target_primary: string;
  target_secondary: string;
  target_primary_monospace: boolean;
  target_secondary_monospace: boolean;
  meta: readonly EnvironmentCardMetaItem[];
}>;

export function capabilityUnavailableMessage(label: string): string {
  return `Connect to an Environment first to open ${label}.`;
}

export function surfaceTitle(surface: DesktopLauncherSurface): string {
  return surface === 'managed_environment_settings' ? 'Environment Settings' : 'Connect Environment';
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
    primary_action_label: 'Open Environment',
    settings_save_label: snapshot.settings_surface.save_label,
  };
}

export function isRemoteEnvironmentEntry(environment: DesktopEnvironmentEntry): boolean {
  return environment.kind !== 'managed_environment';
}

export function environmentKindLabel(environment: DesktopEnvironmentEntry): EnvironmentCardModel['kind_label'] {
  switch (environment.kind) {
    case 'ssh_environment':
      return 'SSH';
    case 'managed_environment':
      return environment.managed_environment_kind === 'controlplane' ? 'Control Plane' : 'Local';
    case 'external_local_ui':
      return 'Redeven URL';
    default:
      return 'Local';
  }
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

export function environmentSourceLabel(environment: DesktopEnvironmentEntry): string {
  switch (environment.category) {
    case 'managed':
      return 'Desktop-managed';
    case 'open_unsaved':
      return 'Open window';
    case 'recent_auto':
      return 'Recent';
    case 'saved':
      return 'Saved';
    default:
      return 'Local Environment';
  }
}

export function environmentStatusLabel(environment: DesktopEnvironmentEntry): string {
  if (environment.is_open) {
    return 'Open';
  }
  if (environment.kind === 'managed_environment') {
    return 'Ready';
  }
  if (environment.category === 'recent_auto') {
    return 'Recent';
  }
  if (environment.category === 'saved') {
    return 'Saved';
  }
  return 'Available';
}

export function environmentStatusTone(environment: DesktopEnvironmentEntry): EnvironmentCardTone {
  if (environment.is_open) {
    return 'success';
  }
  if (environment.category === 'recent_auto') {
    return 'primary';
  }
  return 'neutral';
}

function environmentCardMeta(environment: DesktopEnvironmentEntry): readonly EnvironmentCardMetaItem[] {
  if (environment.kind === 'managed_environment') {
    if (environment.managed_environment_kind === 'controlplane') {
      return [
        {
          label: 'Provider',
          value: environment.provider_origin ?? '',
          monospace: true,
        },
        {
          label: 'Environment ID',
          value: environment.env_public_id ?? '',
          monospace: true,
        },
      ].filter((item) => item.value !== '');
    }
    return [
      {
        label: 'Scope',
        value: environment.managed_environment_name ?? '',
        monospace: true,
      },
    ].filter((item) => item.value !== '');
  }
  if (environment.kind === 'ssh_environment') {
    return [
      {
        label: 'Bootstrap',
        value: environment.ssh_details?.bootstrap_strategy === 'desktop_upload'
          ? 'Desktop upload'
          : environment.ssh_details?.bootstrap_strategy === 'remote_install'
            ? 'Remote install'
            : 'Automatic',
      },
      {
        label: 'Install root',
        value: environment.ssh_details?.remote_install_dir ?? '',
        monospace: true,
      },
    ].filter((item) => item.value !== '');
  }
  if (environment.kind === 'external_local_ui') {
    return [
      {
        label: 'Source',
        value: environmentSourceLabel(environment),
      },
    ];
  }
  return [];
}

export function buildEnvironmentCardModel(environment: DesktopEnvironmentEntry): EnvironmentCardModel {
  if (environment.kind === 'managed_environment') {
    return {
      kind_label: environment.managed_environment_kind === 'controlplane' ? 'Control Plane' : 'Local',
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      source_label: 'Desktop-managed',
      target_primary: environment.local_ui_url || environment.secondary_text || 'Desktop-managed runtime on this machine',
      target_secondary: environment.local_ui_url === ''
        ? environment.managed_environment_kind === 'controlplane'
          ? 'Desktop will request a fresh Control Plane bootstrap ticket when reopening this environment.'
          : 'Open the managed environment or adjust startup settings before the next launch.'
        : 'Current runtime URL',
      target_primary_monospace: true,
      target_secondary_monospace: false,
      meta: environmentCardMeta(environment),
    };
  }

  if (environment.kind === 'ssh_environment') {
    return {
      kind_label: 'SSH',
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      source_label: environmentSourceLabel(environment),
      target_primary: environment.secondary_text,
      target_secondary: environment.local_ui_url === ''
        ? 'Desktop bootstraps the matching Redeven runtime over SSH and tunnels Local UI back into the shell.'
        : `Forwarded UI ${environment.local_ui_url}`,
      target_primary_monospace: true,
      target_secondary_monospace: environment.local_ui_url !== '',
      meta: environmentCardMeta(environment),
    };
  }

  return {
    kind_label: 'Redeven URL',
    status_label: environmentStatusLabel(environment),
    status_tone: environmentStatusTone(environment),
    source_label: environmentSourceLabel(environment),
    target_primary: environment.local_ui_url || environment.secondary_text,
    target_secondary: 'Redeven Local UI origin saved in Desktop.',
    target_primary_monospace: true,
    target_secondary_monospace: false,
    meta: environmentCardMeta(environment),
  };
}

export function environmentMatchesLibraryFilter(
  environment: DesktopEnvironmentEntry,
  filter: EnvironmentLibraryFilter,
): boolean {
  switch (filter) {
    case 'open':
      return environment.is_open;
    case 'recent':
      return environment.category === 'recent_auto';
    case 'saved':
      return environment.category === 'saved' || environment.category === 'managed';
    default:
      return true;
  }
}

export function environmentMatchesLibrarySearch(
  environment: DesktopEnvironmentEntry,
  query: string,
): boolean {
  const clean = query.trim().toLowerCase();
  if (!clean) {
    return true;
  }
  return [
    environment.label,
    environment.local_ui_url,
    environment.secondary_text,
    environment.managed_environment_name ?? '',
    environment.provider_origin ?? '',
    environment.env_public_id ?? '',
    environment.ssh_details?.ssh_destination ?? '',
    environment.ssh_details?.remote_install_dir ?? '',
    environment.ssh_details?.release_base_url ?? '',
    environment.ssh_details?.bootstrap_strategy ?? '',
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
