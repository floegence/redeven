import type {
  DesktopEnvironmentEntry,
  DesktopLauncherSurface,
  DesktopManagedEnvironmentRoute,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import { desktopControlPlaneKey, type DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import {
  type DesktopControlPlaneSyncState,
  type DesktopProviderRemoteRouteState,
} from '../shared/providerEnvironmentState';

export type DesktopWelcomeShellViewModel = Readonly<{
  shell_title: 'Redeven Desktop';
  surface_title: string;
  connect_heading: 'Connect Environment';
  primary_action_label: 'Open Environment';
  settings_save_label: string;
}>;

export type EnvironmentLibraryFilter = 'all' | 'open' | 'recent' | 'saved';
export type EnvironmentCenterTab = 'environments' | 'control_planes';
export type EnvironmentCardTone = 'neutral' | 'primary' | 'success' | 'warning';

export type EnvironmentCardMetaItem = Readonly<{
  label: string;
  value: string;
  monospace?: boolean;
}>;

export type EnvironmentCardFactModel = Readonly<{
  label: string;
  value: string;
}>;

export type EnvironmentCardEndpointModel = Readonly<{
  label: string;
  value: string;
  monospace: boolean;
  copy_label: string;
}>;

export type EnvironmentCardModel = Readonly<{
  kind_label: 'Local' | 'Environment' | 'Remote Environment' | 'Redeven URL' | 'SSH';
  status_label: string;
  status_tone: EnvironmentCardTone;
  source_label: string;
  target_primary: string;
  target_secondary: string;
  target_primary_monospace: boolean;
  target_secondary_monospace: boolean;
  meta: readonly EnvironmentCardMetaItem[];
}>;

export type EnvironmentActionIntent =
  | 'open'
  | 'focus'
  | 'refresh_status'
  | 'check_status'
  | 'reconnect_provider'
  | 'retry_sync'
  | 'unavailable';

export type EnvironmentActionModel = Readonly<{
  intent: EnvironmentActionIntent;
  label: string;
  enabled: boolean;
  variant: 'default' | 'outline';
  route?: DesktopManagedEnvironmentRoute;
}>;

export type ProviderBackedEnvironmentActionModel = Readonly<{
  status_label: string;
  status_tone: EnvironmentCardTone;
  primary_action: EnvironmentActionModel;
  secondary_action: EnvironmentActionModel | null;
}>;

export type ControlPlaneStatusModel = Readonly<{
  label: string;
  tone: EnvironmentCardTone;
  detail: string;
}>;

export function capabilityUnavailableMessage(label: string): string {
  return `Connect to an Environment first to open ${label}.`;
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
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
      if (environment.managed_has_local_hosting && environment.managed_has_remote_desktop) {
        return 'Environment';
      }
      if (environment.managed_has_remote_desktop) {
        return 'Remote Environment';
      }
      return 'Local';
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

function sshBootstrapSummary(environment: DesktopEnvironmentEntry): string {
  if (environment.kind !== 'ssh_environment') {
    return '';
  }
  switch (environment.ssh_details?.bootstrap_strategy) {
    case 'desktop_upload':
      return 'Desktop upload';
    case 'remote_install':
      return 'Remote install';
    default:
      return 'Automatic bootstrap';
  }
}

function environmentConnectionStateLabel(environment: DesktopEnvironmentEntry): string {
  if (environment.is_open) {
    return 'Open';
  }
  if (environment.category === 'saved') {
    return 'Saved';
  }
  if (environment.category === 'recent_auto') {
    return 'Recent';
  }
  return 'Saved';
}

function managedEnvironmentAccessLabel(environment: DesktopEnvironmentEntry): string {
  const hasLocalHosting = environment.managed_has_local_hosting === true;
  const hasRemoteDesktop = environment.managed_has_remote_desktop === true;
  if (hasLocalHosting && hasRemoteDesktop) {
    return 'Local + Remote';
  }
  if (hasRemoteDesktop) {
    return 'Remote';
  }
  return 'Local';
}

function controlPlaneDisplayLabel(environment: DesktopEnvironmentEntry): string {
  return environment.control_plane_label || environment.provider_origin || '';
}

export function buildEnvironmentCardFactsModel(
  environment: DesktopEnvironmentEntry,
): readonly EnvironmentCardFactModel[] {
  if (environment.kind === 'managed_environment') {
    const facts: EnvironmentCardFactModel[] = [
      {
        label: 'RUNS ON',
        value: environment.managed_has_local_hosting ? 'This device' : 'Control Plane',
      },
      {
        label: 'ACCESS',
        value: managedEnvironmentAccessLabel(environment),
      },
    ];
    const controlPlaneLabel = controlPlaneDisplayLabel(environment);
    if (controlPlaneLabel !== '') {
      facts.push({
        label: 'CONTROL PLANE',
        value: controlPlaneLabel,
      });
    }
    return facts;
  }

  if (environment.kind === 'ssh_environment') {
    return [
      { label: 'ACCESS', value: 'SSH' },
      { label: 'CONNECTION', value: environmentConnectionStateLabel(environment) },
      { label: 'BOOTSTRAP', value: sshBootstrapSummary(environment) },
    ].filter((fact) => fact.value !== '');
  }

  return [
    { label: 'ACCESS', value: 'Redeven URL' },
    { label: 'CONNECTION', value: environmentConnectionStateLabel(environment) },
  ].filter((fact) => fact.value !== '');
}

export function buildEnvironmentCardEndpointsModel(
  environment: DesktopEnvironmentEntry,
): readonly EnvironmentCardEndpointModel[] {
  const card = buildEnvironmentCardModel(environment);
  const primaryLabel = environment.kind === 'ssh_environment'
    ? 'SSH'
    : environment.kind === 'external_local_ui'
      ? 'URL'
      : environment.managed_has_local_hosting
        ? (card.target_primary.startsWith('http://') || card.target_primary.startsWith('https://') ? 'URL' : 'LOCAL')
        : 'REMOTE';
  const secondaryLabel = environment.kind === 'ssh_environment'
    ? 'URL'
    : environment.kind === 'managed_environment'
      ? 'REMOTE'
      : 'DETAIL';
  return [
    card.target_primary !== ''
      ? {
          label: primaryLabel,
          value: card.target_primary,
          monospace: card.target_primary_monospace,
          copy_label: environment.kind === 'ssh_environment' ? 'Copy SSH target' : 'Copy endpoint',
        }
      : null,
    card.target_secondary !== ''
      ? {
          label: secondaryLabel,
          value: card.target_secondary,
          monospace: card.target_secondary_monospace,
          copy_label: environment.kind === 'ssh_environment' ? 'Copy forwarded URL' : 'Copy endpoint',
        }
      : null,
  ].filter((item): item is EnvironmentCardEndpointModel => item !== null);
}

export function splitPinnedEnvironmentEntries(
  entries: readonly DesktopEnvironmentEntry[],
): Readonly<{
  pinned_entries: readonly DesktopEnvironmentEntry[];
  regular_entries: readonly DesktopEnvironmentEntry[];
}> {
  const pinnedEntries = entries.filter((entry) => entry.pinned);
  return {
    pinned_entries: pinnedEntries,
    regular_entries: entries.filter((entry) => !entry.pinned),
  };
}

function localRouteActionModel(environment: DesktopEnvironmentEntry): EnvironmentActionModel {
  return {
    intent: environment.open_local_session_key ? 'focus' : 'open',
    label: environment.open_local_session_key ? 'Focus Local' : 'Open Local',
    enabled: true,
    variant: 'default',
    route: 'local_host',
  };
}

function remoteRouteActionModel(options: Readonly<{
  remoteRouteState: DesktopProviderRemoteRouteState | undefined;
  remoteSessionOpen: boolean;
}>): EnvironmentActionModel {
  if (options.remoteSessionOpen) {
    return {
      intent: 'focus',
      label: 'Focus Remote',
      enabled: true,
      variant: 'outline',
      route: 'remote_desktop',
    };
  }

  switch (options.remoteRouteState) {
    case 'ready':
      return {
        intent: 'open',
        label: 'Open Remote',
        enabled: true,
        variant: 'outline',
        route: 'remote_desktop',
      };
    case 'offline':
      return {
        intent: 'check_status',
        label: 'Check Remote Status',
        enabled: true,
        variant: 'outline',
        route: 'remote_desktop',
      };
    case 'stale':
    case 'unknown':
      return {
        intent: 'refresh_status',
        label: 'Refresh Status',
        enabled: true,
        variant: 'outline',
      };
    case 'auth_required':
      return {
        intent: 'reconnect_provider',
        label: 'Reconnect',
        enabled: true,
        variant: 'outline',
      };
    case 'provider_unreachable':
    case 'provider_invalid':
      return {
        intent: 'retry_sync',
        label: 'Retry Sync',
        enabled: true,
        variant: 'outline',
      };
    case 'removed':
      return {
        intent: 'unavailable',
        label: 'Unavailable',
        enabled: false,
        variant: 'outline',
      };
    default:
      return {
        intent: 'check_status',
        label: 'Check Remote Status',
        enabled: true,
        variant: 'outline',
      };
  }
}

function providerBackedStatusModel(options: Readonly<{
  isOpen: boolean;
  hasLocalHosting: boolean;
  hasRemoteDesktop: boolean;
  localSessionOpen: boolean;
  remoteSessionOpen: boolean;
  remoteRouteState?: DesktopProviderRemoteRouteState;
  controlPlaneSyncState?: DesktopControlPlaneSyncState;
}>): Readonly<{
  label: string;
  tone: EnvironmentCardTone;
}> {
  if (options.isOpen) {
    return {
      label: 'Open',
      tone: 'success',
    };
  }
  if (
    options.controlPlaneSyncState === 'syncing'
    && !options.hasLocalHosting
    && options.remoteRouteState !== 'ready'
  ) {
    return {
      label: 'Checking',
      tone: 'primary',
    };
  }
  if (options.hasLocalHosting && options.hasRemoteDesktop) {
    switch (options.remoteRouteState) {
      case 'offline':
      case 'stale':
      case 'auth_required':
      case 'provider_unreachable':
      case 'provider_invalid':
      case 'removed':
        return {
          label: 'Local Ready',
          tone: 'primary',
        };
      default:
        break;
    }
  }
  switch (options.remoteRouteState) {
    case 'ready':
      return {
        label: 'Ready',
        tone: 'primary',
      };
    case 'offline':
      return {
        label: 'Offline',
        tone: 'warning',
      };
    case 'stale':
      return {
        label: 'Status stale',
        tone: 'warning',
      };
    case 'auth_required':
      return {
        label: 'Reconnect required',
        tone: 'warning',
      };
    case 'provider_unreachable':
    case 'provider_invalid':
      return {
        label: 'Sync needed',
        tone: 'warning',
      };
    case 'removed':
      return {
        label: 'Unavailable',
        tone: 'neutral',
      };
    case 'unknown':
      return {
        label: 'Unknown',
        tone: 'neutral',
      };
    default:
      return {
        label: options.hasRemoteDesktop ? 'Unknown' : 'Ready',
        tone: options.hasRemoteDesktop ? 'neutral' : 'primary',
      };
  }
}

export function buildProviderBackedEnvironmentActionModel(
  environment: DesktopEnvironmentEntry,
  controlPlaneSyncState: DesktopControlPlaneSyncState = environment.control_plane_sync_state ?? 'ready',
): ProviderBackedEnvironmentActionModel {
  const hasLocalHosting = environment.managed_has_local_hosting === true;
  const hasRemoteDesktop = environment.managed_has_remote_desktop === true;
  const localSessionOpen = Boolean(environment.open_local_session_key);
  const remoteSessionOpen = Boolean(environment.open_remote_session_key);
  const status = providerBackedStatusModel({
    isOpen: environment.is_open,
    hasLocalHosting,
    hasRemoteDesktop,
    localSessionOpen,
    remoteSessionOpen,
    remoteRouteState: environment.remote_route_state,
    controlPlaneSyncState,
  });
  const remoteAction = hasRemoteDesktop
    ? remoteRouteActionModel({
      remoteRouteState: environment.remote_route_state,
      remoteSessionOpen,
    })
    : null;

  if (hasLocalHosting && hasRemoteDesktop) {
    return {
      status_label: status.label,
      status_tone: status.tone,
      primary_action: localRouteActionModel(environment),
      secondary_action: remoteAction,
    };
  }
  if (hasLocalHosting) {
    return {
      status_label: status.label,
      status_tone: status.tone,
      primary_action: {
        intent: environment.open_local_session_key ? 'focus' : 'open',
        label: environment.open_local_session_key ? 'Focus' : 'Open',
        enabled: true,
        variant: 'default',
        route: 'local_host',
      },
      secondary_action: null,
    };
  }
  return {
    status_label: status.label,
    status_tone: status.tone,
    primary_action: remoteAction ?? {
      intent: 'refresh_status',
      label: 'Refresh Status',
      enabled: true,
      variant: 'default',
    },
    secondary_action: null,
  };
}

export function buildControlPlaneStatusModel(
  controlPlane: DesktopControlPlaneSummary,
): ControlPlaneStatusModel {
  switch (controlPlane.sync_state) {
    case 'syncing':
      return {
        label: 'Checking',
        tone: 'primary',
        detail: 'Refreshing the latest environment status from this provider.',
      };
    case 'auth_required':
      return {
        label: 'Reconnect required',
        tone: 'warning',
        detail: 'Desktop authorization expired. Reconnect in your browser to refresh environments again.',
      };
    case 'provider_unreachable':
      return {
        label: 'Sync failed',
        tone: 'warning',
        detail: controlPlane.last_sync_error_message || 'Desktop could not reach this provider.',
      };
    case 'provider_invalid':
      return {
        label: 'Invalid response',
        tone: 'warning',
        detail: controlPlane.last_sync_error_message || 'This provider returned an invalid response.',
      };
    case 'sync_error':
      return {
        label: 'Sync failed',
        tone: 'warning',
        detail: controlPlane.last_sync_error_message || 'Desktop could not refresh this provider.',
      };
    default:
      if (controlPlane.catalog_freshness === 'stale') {
        return {
          label: 'Status stale',
          tone: 'warning',
          detail: 'The last provider sync is getting old. Refresh to confirm the latest environment status.',
        };
      }
      return {
        label: 'Authorized',
        tone: 'success',
        detail: 'Desktop has active provider authorization and a fresh environment catalog.',
      };
  }
}

export function environmentStatusLabel(environment: DesktopEnvironmentEntry): string {
  if (environment.is_open) {
    return 'Open';
  }
  if (environment.kind === 'managed_environment') {
    return buildProviderBackedEnvironmentActionModel(environment).status_label;
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
  if (environment.kind === 'managed_environment') {
    return buildProviderBackedEnvironmentActionModel(environment).status_tone;
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
    const hasLocalHosting = environment.managed_has_local_hosting === true;
    const providerSummary = [environment.provider_origin, environment.env_public_id].filter(Boolean).join(' · ');
    const hostSummary = environment.managed_local_ui_bind || environment.managed_environment_name || environment.secondary_text;
    const targetPrimary = environment.local_ui_url
      || (hasLocalHosting
        ? hostSummary
        : providerSummary || environment.secondary_text || 'Provider-backed environment');
    const targetSecondary = providerSummary !== '' && providerSummary !== targetPrimary
      ? providerSummary
      : '';
    return {
      kind_label: environmentKindLabel(environment),
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      source_label: 'Desktop-managed',
      target_primary: targetPrimary,
      target_secondary: targetSecondary,
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
      target_secondary: environment.local_ui_url,
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
    target_secondary: '',
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
    environment.control_plane_label ?? '',
    environment.provider_origin ?? '',
    environment.env_public_id ?? '',
    environment.ssh_details?.ssh_destination ?? '',
    environment.ssh_details?.remote_install_dir ?? '',
    environment.ssh_details?.release_base_url ?? '',
    environment.ssh_details?.bootstrap_strategy ?? '',
  ].some((value) => value.toLowerCase().includes(clean));
}

export function environmentProviderFilterValue(environment: DesktopEnvironmentEntry): string {
  const providerOrigin = compact(environment.provider_origin);
  const providerID = compact(environment.provider_id);
  if (providerOrigin === '' || providerID === '') {
    return '';
  }
  try {
    return desktopControlPlaneKey(providerOrigin, providerID);
  } catch {
    return '';
  }
}

export function environmentMatchesProviderFilter(
  environment: DesktopEnvironmentEntry,
  providerFilter: string,
): boolean {
  const activeFilter = compact(providerFilter);
  if (activeFilter === '') {
    return true;
  }
  return environmentProviderFilterValue(environment) === activeFilter;
}

export function filterEnvironmentLibrary(
  snapshot: DesktopWelcomeSnapshot,
  filter: EnvironmentLibraryFilter,
  query = '',
  providerFilter = '',
): readonly DesktopEnvironmentEntry[] {
  return snapshot.environments.filter((environment) => (
    environmentMatchesLibraryFilter(environment, filter)
    && environmentMatchesLibrarySearch(environment, query)
    && environmentMatchesProviderFilter(environment, providerFilter)
  ));
}

export function environmentLibraryCount(
  snapshot: DesktopWelcomeSnapshot,
  filter: EnvironmentLibraryFilter,
  query = '',
  providerFilter = '',
): number {
  return filterEnvironmentLibrary(snapshot, filter, query, providerFilter).length;
}
