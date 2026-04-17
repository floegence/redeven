import type {
  DesktopEnvironmentEntry,
  DesktopLauncherSurface,
  DesktopManagedEnvironmentRoute,
  DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';
import { desktopControlPlaneKey, type DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import {
  type DesktopControlPlaneSyncState,
} from '../shared/providerEnvironmentState';

export type DesktopWelcomeShellViewModel = Readonly<{
  shell_title: 'Redeven Desktop';
  surface_title: string;
  connect_heading: 'Connect Environment';
  primary_action_label: 'Open Environment';
  settings_save_label: string;
}>;

export type EnvironmentCenterTab = 'environments' | 'control_planes';
export type EnvironmentCardTone = 'neutral' | 'primary' | 'success' | 'warning';
export type EnvironmentLibraryLayoutDensity = 'compact' | 'spacious';

export type EnvironmentLibraryLayoutModel = Readonly<{
  visible_card_count: number;
  layout_reference_count: number;
  density: EnvironmentLibraryLayoutDensity;
  column_count: number;
}>;

export type EnvironmentCardMetaItem = Readonly<{
  label: string;
  value: string;
  monospace?: boolean;
}>;

export type EnvironmentCardFactModel = Readonly<{
  label: string;
  value: string;
  value_tone: 'default' | 'placeholder';
}>;

export type EnvironmentCardEndpointModel = Readonly<{
  label: string;
  value: string;
  monospace: boolean;
  copy_label: string;
}>;

export type EnvironmentCardModel = Readonly<{
  kind_label: 'Local' | 'Local Serve' | 'Provider' | 'Redeven URL' | 'SSH Host';
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
  | 'opening'
  | 'start_runtime'
  | 'stop_runtime'
  | 'refresh_runtime'
  | 'serve_runtime_locally'
  | 'focus_local_serve'
  | 'unavailable';

export type EnvironmentActionModel = Readonly<{
  intent: EnvironmentActionIntent;
  label: string;
  enabled: boolean;
  variant: 'default' | 'outline';
  tooltip?: string;
  route?: DesktopManagedEnvironmentRoute;
}>;

export type EnvironmentActionMenuItemModel = Readonly<{
  id: string;
  label: string;
  action: EnvironmentActionModel;
}>;

export type EnvironmentActionPresentation = Readonly<{
  kind: 'split_button';
  primary_action: EnvironmentActionModel;
  primary_action_tooltip?: string;
  menu_button_label: string;
  menu_actions: readonly EnvironmentActionMenuItemModel[];
}>;

export type ProviderBackedEnvironmentActionModel = Readonly<{
  status_label: string;
  status_tone: EnvironmentCardTone;
  action_presentation: EnvironmentActionPresentation;
}>;

export type ControlPlaneStatusModel = Readonly<{
  label: string;
  tone: EnvironmentCardTone;
  detail: string;
}>;

export const SPACIOUS_ENVIRONMENT_GRID_CARD_THRESHOLD = 4;
export const COMPACT_ENVIRONMENT_GRID_MIN_COLUMN_REM = 17;
export const SPACIOUS_ENVIRONMENT_GRID_MIN_COLUMN_REM = 19;
export const COMPACT_ENVIRONMENT_GRID_GAP_REM = 1;
export const SPACIOUS_ENVIRONMENT_GRID_GAP_REM = 1.125;
export const LOCAL_ENVIRONMENT_LIBRARY_FILTER = '__local__';
export const PROVIDER_ENVIRONMENT_LIBRARY_FILTER = '__provider__';
export const URL_ENVIRONMENT_LIBRARY_FILTER = '__url__';
export const SSH_ENVIRONMENT_LIBRARY_FILTER = '__ssh__';

export function capabilityUnavailableMessage(label: string): string {
  return `Connect to an Environment first to open ${label}.`;
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function looksLikeAbsoluteURL(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function shouldUseMonospaceEndpoint(value: string): boolean {
  const clean = compact(value);
  if (clean === '') {
    return false;
  }
  return looksLikeAbsoluteURL(clean) || clean.includes(':') || clean.includes('/');
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizePositivePixelValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function environmentGridMinimumColumnRem(density: EnvironmentLibraryLayoutDensity): number {
  return density === 'spacious'
    ? SPACIOUS_ENVIRONMENT_GRID_MIN_COLUMN_REM
    : COMPACT_ENVIRONMENT_GRID_MIN_COLUMN_REM;
}

function environmentGridGapRem(density: EnvironmentLibraryLayoutDensity): number {
  return density === 'spacious'
    ? SPACIOUS_ENVIRONMENT_GRID_GAP_REM
    : COMPACT_ENVIRONMENT_GRID_GAP_REM;
}

export function shouldUseSpaciousEnvironmentGrid(cardCount: number): boolean {
  return normalizePositiveInteger(cardCount) >= SPACIOUS_ENVIRONMENT_GRID_CARD_THRESHOLD;
}

export function buildEnvironmentLibraryLayoutModel(args: Readonly<{
  visible_card_count: number;
  layout_reference_count: number;
  container_width_px: number;
  root_font_size_px?: number;
}>): EnvironmentLibraryLayoutModel {
  const visibleCardCount = normalizePositiveInteger(args.visible_card_count);
  const layoutReferenceCount = normalizePositiveInteger(args.layout_reference_count);
  const density: EnvironmentLibraryLayoutDensity = shouldUseSpaciousEnvironmentGrid(layoutReferenceCount)
    ? 'spacious'
    : 'compact';

  if (layoutReferenceCount <= 0) {
    return {
      visible_card_count: visibleCardCount,
      layout_reference_count: 0,
      density,
      column_count: 1,
    };
  }

  const containerWidthPx = normalizePositivePixelValue(args.container_width_px);
  if (containerWidthPx <= 0) {
    return {
      visible_card_count: visibleCardCount,
      layout_reference_count: layoutReferenceCount,
      density,
      column_count: 1,
    };
  }

  const rootFontSizePx = normalizePositivePixelValue(args.root_font_size_px ?? 16) || 16;
  const minColumnWidthPx = environmentGridMinimumColumnRem(density) * rootFontSizePx;
  const gapPx = environmentGridGapRem(density) * rootFontSizePx;
  const fitColumnCount = Math.floor((containerWidthPx + gapPx) / (minColumnWidthPx + gapPx));

  return {
    visible_card_count: visibleCardCount,
    layout_reference_count: layoutReferenceCount,
    density,
    column_count: Math.max(1, Math.min(layoutReferenceCount, fitColumnCount)),
  };
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
  return environment.kind === 'provider_environment'
    || environment.kind === 'external_local_ui'
    || environment.kind === 'ssh_environment';
}

export function environmentKindLabel(environment: DesktopEnvironmentEntry): EnvironmentCardModel['kind_label'] {
  switch (environment.kind) {
    case 'ssh_environment':
      return 'SSH Host';
    case 'provider_environment':
      return 'Provider';
    case 'managed_environment':
      return environment.managed_environment_kind === 'controlplane' ? 'Local Serve' : 'Local';
    case 'external_local_ui':
      return 'Redeven URL';
    default:
      return 'Local';
  }
}

export function environmentSourceLabel(environment: DesktopEnvironmentEntry): string {
  switch (environment.category) {
    case 'managed':
      return 'Desktop-managed';
    case 'provider':
      return 'Control Plane';
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

function externalLocalUISourceLabel(environment: DesktopEnvironmentEntry): string {
  return environmentSourceLabel(environment);
}

function normalizeIPAddressHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

function isLoopbackIPAddressHost(value: string): boolean {
  const host = normalizeIPAddressHost(value);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isPrivateIPv4Host(value: string): boolean {
  const host = normalizeIPAddressHost(value);
  const segments = host.split('.');
  if (segments.length !== 4 || segments.some((segment) => segment === '')) {
    return false;
  }
  const octets = segments.map((segment) => Number(segment));
  if (octets.some((segment) => !Number.isInteger(segment) || segment < 0 || segment > 255)) {
    return false;
  }
  if (octets[0] === 10) {
    return true;
  }
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }
  if (octets[0] === 192 && octets[1] === 168) {
    return true;
  }
  return octets[0] === 169 && octets[1] === 254;
}

function isLocalIPv6Host(value: string): boolean {
  const host = normalizeIPAddressHost(value);
  return /^fc/i.test(host) || /^fd/i.test(host) || /^fe[89ab]/i.test(host);
}

function externalLocalUINetworkLabel(environment: DesktopEnvironmentEntry): string {
  const targetURL = compact(environment.local_ui_url) || compact(environment.secondary_text);
  if (targetURL === '') {
    return 'Unknown host';
  }
  try {
    const parsed = new URL(targetURL);
    const host = parsed.hostname;
    if (isLoopbackIPAddressHost(host)) {
      return 'This device';
    }
    if (isPrivateIPv4Host(host) || isLocalIPv6Host(host)) {
      return 'LAN host';
    }
    return 'Remote host';
  } catch {
    return 'Unknown host';
  }
}

function buildEnvironmentCardFact(label: string, value: string): EnvironmentCardFactModel {
  return {
    label,
    value,
    value_tone: 'default',
  };
}

function buildPlaceholderEnvironmentCardFact(
  label: string,
  value = 'None',
): EnvironmentCardFactModel {
  return {
    label,
    value,
    value_tone: 'placeholder',
  };
}

function controlPlaneDisplayLabel(environment: DesktopEnvironmentEntry): string {
  return environment.control_plane_label || environment.provider_origin || '';
}

function environmentWindowLabel(environment: DesktopEnvironmentEntry): string {
  switch (environment.window_state) {
    case 'open':
      return 'Open';
    case 'opening':
      return 'Opening';
    default:
      return 'Closed';
  }
}

function environmentRunsOnLabel(environment: DesktopEnvironmentEntry): string {
  if (environment.kind === 'managed_environment') {
    return 'This device';
  }
  if (environment.kind === 'provider_environment') {
    return 'Provider remote';
  }
  if (environment.kind === 'ssh_environment') {
    return environment.secondary_text || 'Unknown';
  }
  return externalLocalUINetworkLabel(environment);
}

export function buildEnvironmentCardFactsModel(
  environment: DesktopEnvironmentEntry,
): readonly EnvironmentCardFactModel[] {
  if (environment.kind === 'managed_environment') {
    const facts: EnvironmentCardFactModel[] = environment.managed_environment_kind === 'controlplane'
      ? [
          buildEnvironmentCardFact('SOURCE ENV', environment.env_public_id ?? 'Unknown'),
          buildEnvironmentCardFact('CONTROL PLANE', controlPlaneDisplayLabel(environment) || 'Unavailable'),
          buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
          buildEnvironmentCardFact('WINDOW', environmentWindowLabel(environment)),
        ]
      : [
          buildEnvironmentCardFact('SOURCE', environmentSourceLabel(environment)),
          buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
          buildEnvironmentCardFact('WINDOW', environmentWindowLabel(environment)),
        ];
    if (environment.managed_environment_kind !== 'controlplane') {
      facts.push(buildPlaceholderEnvironmentCardFact('CONTROL PLANE'));
    }
    return facts;
  }

  if (environment.kind === 'provider_environment') {
    return [
      buildEnvironmentCardFact('SOURCE ENV', environment.env_public_id ?? 'Unknown'),
      buildEnvironmentCardFact('CONTROL PLANE', controlPlaneDisplayLabel(environment) || 'Unavailable'),
      buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
      buildEnvironmentCardFact('WINDOW', environmentWindowLabel(environment)),
    ];
  }

  if (environment.kind === 'ssh_environment') {
    return [
      buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
      buildEnvironmentCardFact('WINDOW', environmentWindowLabel(environment)),
      buildEnvironmentCardFact('BOOTSTRAP', sshBootstrapSummary(environment) || 'Automatic bootstrap'),
    ];
  }

  return [
    buildEnvironmentCardFact('SOURCE', externalLocalUISourceLabel(environment)),
    buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
    buildEnvironmentCardFact('WINDOW', environmentWindowLabel(environment)),
  ];
}

export function buildEnvironmentCardEndpointsModel(
  environment: DesktopEnvironmentEntry,
): readonly EnvironmentCardEndpointModel[] {
  if (environment.kind === 'managed_environment') {
    const localEndpoint = compact(environment.local_ui_url) || compact(environment.managed_local_ui_bind) || compact(environment.managed_environment_name);
    const remoteEndpoint = compact(environment.remote_environment_url);
    return [
      localEndpoint !== ''
        ? {
            label: looksLikeAbsoluteURL(localEndpoint) ? 'URL' : 'LOCAL',
            value: localEndpoint,
            monospace: shouldUseMonospaceEndpoint(localEndpoint),
            copy_label: 'Copy local endpoint',
          }
        : null,
      environment.managed_environment_kind === 'controlplane' && remoteEndpoint !== ''
        ? {
            label: 'SOURCE',
            value: remoteEndpoint,
            monospace: shouldUseMonospaceEndpoint(remoteEndpoint),
            copy_label: 'Copy provider URL',
          }
        : null,
    ].filter((item): item is EnvironmentCardEndpointModel => item !== null);
  }

  if (environment.kind === 'provider_environment') {
    const remoteEndpoint = compact(environment.remote_environment_url) || compact(environment.local_ui_url);
    return [
      remoteEndpoint !== ''
        ? {
          label: 'REMOTE',
            value: remoteEndpoint,
            monospace: shouldUseMonospaceEndpoint(remoteEndpoint),
            copy_label: 'Copy environment URL',
          }
        : null,
    ].filter((item): item is EnvironmentCardEndpointModel => item !== null);
  }

  const card = buildEnvironmentCardModel(environment);
  const primaryLabel = environment.kind === 'ssh_environment' ? 'SSH HOST' : 'URL';
  const secondaryLabel = environment.kind === 'ssh_environment' ? 'FORWARDED URL' : 'DETAIL';
  return [
    card.target_primary !== ''
      ? {
          label: primaryLabel,
          value: card.target_primary,
          monospace: card.target_primary_monospace,
          copy_label: environment.kind === 'ssh_environment' ? 'Copy SSH host' : 'Copy endpoint',
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

function runtimeStatusLabel(environment: DesktopEnvironmentEntry): string {
  return environment.runtime_health.status === 'online' ? 'RUNTIME ONLINE' : 'RUNTIME OFFLINE';
}

function runtimeStatusTone(environment: DesktopEnvironmentEntry): EnvironmentCardTone {
  return environment.runtime_health.status === 'online' ? 'success' : 'warning';
}

function environmentPrimaryTooltip(environment: DesktopEnvironmentEntry): string {
  if (environment.window_state !== 'closed' || environment.runtime_health.status === 'online') {
    return '';
  }
  return environment.runtime_control_capability === 'start_stop'
    ? 'serve the runtime first'
    : 'the runtime offline / unavailable';
}

function primaryWindowAction(environment: DesktopEnvironmentEntry): EnvironmentActionModel {
  if (environment.window_state === 'open') {
    return {
      intent: 'focus',
      label: 'Focus',
      enabled: true,
      variant: 'default',
    };
  }
  if (environment.window_state === 'opening') {
    return {
      intent: 'opening',
      label: 'Opening…',
      enabled: false,
      variant: 'default',
    };
  }
  return {
    intent: 'open',
    label: 'Open',
    enabled: environment.runtime_health.status === 'online',
    variant: 'default',
    tooltip: environmentPrimaryTooltip(environment) || undefined,
  };
}

function providerLocalServeMenuAction(
  environment: DesktopEnvironmentEntry,
): EnvironmentActionMenuItemModel | null {
  if (environment.kind !== 'provider_environment' || environment.runtime_health.status !== 'offline') {
    return null;
  }

  if (environment.provider_local_serve_state === 'open') {
    return {
      id: 'focus_local_serve',
      label: 'Focus local serve',
      action: {
        intent: 'focus_local_serve',
        label: 'Focus local serve',
        enabled: true,
        variant: 'outline',
      },
    };
  }

  if (environment.provider_local_serve_state === 'opening') {
    return {
      id: 'local_serve_opening',
      label: 'Local serve opening…',
      action: {
        intent: 'opening',
        label: 'Local serve opening…',
        enabled: false,
        variant: 'outline',
      },
    };
  }

  return {
    id: 'serve_runtime_locally',
    label: 'Serve runtime locally',
    action: {
      intent: 'serve_runtime_locally',
      label: 'Serve runtime locally',
      enabled: true,
      variant: 'outline',
    },
  };
}

function runtimeMenuActions(environment: DesktopEnvironmentEntry): readonly EnvironmentActionMenuItemModel[] {
  const items: EnvironmentActionMenuItemModel[] = [];
  const localServeAction = providerLocalServeMenuAction(environment);
  if (localServeAction) {
    items.push(localServeAction);
  }
  if (environment.runtime_control_capability === 'start_stop') {
    const runtimeAction: EnvironmentActionModel = {
      intent: environment.runtime_health.status === 'online' ? 'stop_runtime' : 'start_runtime',
      label: environment.runtime_health.status === 'online' ? 'Stop runtime' : 'Start runtime',
      enabled: true,
      variant: 'outline',
    };
    items.push({
      id: runtimeAction.intent,
      label: runtimeAction.label,
      action: runtimeAction,
    });
  } else if (!localServeAction) {
    items.push({
      id: 'runtime_managed_externally',
      label: 'Runtime managed externally',
      action: {
        intent: 'unavailable',
        label: 'Runtime managed externally',
        enabled: false,
        variant: 'outline',
      },
    });
  }
  items.push({
    id: 'refresh_runtime',
    label: 'Refresh runtime status',
    action: {
      intent: 'refresh_runtime',
      label: 'Refresh runtime status',
      enabled: true,
      variant: 'outline',
    },
  });
  return items;
}

export function buildProviderBackedEnvironmentActionModel(
  environment: DesktopEnvironmentEntry,
  _controlPlaneSyncState: DesktopControlPlaneSyncState = environment.control_plane_sync_state ?? 'ready',
): ProviderBackedEnvironmentActionModel {
  const primaryAction = primaryWindowAction(environment);
  return {
    status_label: runtimeStatusLabel(environment),
    status_tone: runtimeStatusTone(environment),
    action_presentation: {
      kind: 'split_button',
      primary_action: primaryAction,
      primary_action_tooltip: primaryAction.tooltip,
      menu_button_label: 'Runtime actions',
      menu_actions: runtimeMenuActions(environment),
    },
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
  return runtimeStatusLabel(environment);
}

export function environmentStatusTone(environment: DesktopEnvironmentEntry): EnvironmentCardTone {
  return runtimeStatusTone(environment);
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
  if (environment.kind === 'provider_environment') {
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
  if (environment.kind === 'ssh_environment') {
    return [
      {
        label: 'Instance ID',
        value: environment.ssh_details?.environment_instance_id ?? '',
        monospace: true,
      },
      {
        label: 'Install root',
        value: environment.ssh_details?.remote_install_dir ?? '',
        monospace: true,
      },
      {
        label: 'Bootstrap',
        value: environment.ssh_details?.bootstrap_strategy === 'desktop_upload'
          ? 'Desktop upload'
          : environment.ssh_details?.bootstrap_strategy === 'remote_install'
            ? 'Remote install'
            : 'Automatic',
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
    const localEndpoint = compact(environment.local_ui_url) || compact(environment.managed_local_ui_bind) || compact(environment.managed_environment_name);
    const remoteEndpoint = compact(environment.remote_environment_url);
    const targetPrimary = localEndpoint || remoteEndpoint || environment.secondary_text || 'Local environment';
    const targetSecondary = environment.managed_environment_kind === 'controlplane' && remoteEndpoint !== '' && remoteEndpoint !== targetPrimary
      ? remoteEndpoint
      : '';
    return {
      kind_label: environmentKindLabel(environment),
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      source_label: 'Desktop-managed',
      target_primary: targetPrimary,
      target_secondary: targetSecondary,
      target_primary_monospace: shouldUseMonospaceEndpoint(targetPrimary),
      target_secondary_monospace: shouldUseMonospaceEndpoint(targetSecondary),
      meta: environmentCardMeta(environment),
    };
  }

  if (environment.kind === 'provider_environment') {
    const remoteEndpoint = compact(environment.remote_environment_url) || compact(environment.local_ui_url);
    const targetPrimary = remoteEndpoint
      || compact(environment.secondary_text)
      || 'Provider environment';
    return {
      kind_label: 'Provider',
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      source_label: environmentSourceLabel(environment),
      target_primary: targetPrimary,
      target_secondary: '',
      target_primary_monospace: shouldUseMonospaceEndpoint(targetPrimary),
      target_secondary_monospace: false,
      meta: environmentCardMeta(environment),
    };
  }

  if (environment.kind === 'ssh_environment') {
    return {
      kind_label: 'SSH Host',
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
    environment.ssh_details?.environment_instance_id ?? '',
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

function isVisibleEnvironmentLibraryEntry(environment: DesktopEnvironmentEntry): boolean {
  return Boolean(environment);
}

export function environmentMatchesProviderFilter(
  environment: DesktopEnvironmentEntry,
  providerFilter: string,
): boolean {
  const activeFilter = compact(providerFilter);
  if (activeFilter === '') {
    return true;
  }
  if (activeFilter === LOCAL_ENVIRONMENT_LIBRARY_FILTER) {
    return environment.kind === 'managed_environment';
  }
  if (activeFilter === PROVIDER_ENVIRONMENT_LIBRARY_FILTER) {
    return environment.kind === 'provider_environment';
  }
  if (activeFilter === URL_ENVIRONMENT_LIBRARY_FILTER) {
    return environment.kind === 'external_local_ui';
  }
  if (activeFilter === SSH_ENVIRONMENT_LIBRARY_FILTER) {
    return environment.kind === 'ssh_environment';
  }
  const environmentFilter = environmentProviderFilterValue(environment);
  return environmentFilter === activeFilter;
}

export function filterEnvironmentLibrary(
  snapshot: DesktopWelcomeSnapshot,
  query = '',
  providerFilter = '',
): readonly DesktopEnvironmentEntry[] {
  return snapshot.environments.filter((environment) => (
    isVisibleEnvironmentLibraryEntry(environment)
    && (
    environmentMatchesLibrarySearch(environment, query)
    && environmentMatchesProviderFilter(environment, providerFilter)
    )
  ));
}

export function environmentLibraryCount(
  snapshot: DesktopWelcomeSnapshot,
  query = '',
  providerFilter = '',
): number {
  return filterEnvironmentLibrary(snapshot, query, providerFilter).length;
}
