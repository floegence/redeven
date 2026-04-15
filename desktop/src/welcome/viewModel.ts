import type {
  DesktopEnvironmentEntry,
  DesktopLauncherSessionLifecycle,
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
  | 'attach'
  | 'focus'
  | 'opening'
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

export type EnvironmentSplitMenuActionModel = Readonly<{
  id:
    | 'local_route'
    | 'remote_route'
    | 'remote_refresh'
    | 'remote_reconnect'
    | 'remote_retry_sync'
    | 'remote_check_status'
    | 'remote_unavailable';
  section: 'local' | 'remote';
  label: string;
  detail: string;
  action: EnvironmentActionModel;
  disabled: boolean;
  is_default: boolean;
}>;

export type EnvironmentActionPresentation =
  | Readonly<{
      kind: 'single_button';
      action: EnvironmentActionModel;
    }>
  | Readonly<{
      kind: 'split_button';
      default_action: EnvironmentActionModel;
      menu_actions: readonly EnvironmentSplitMenuActionModel[];
      menu_button_label: 'Choose environment route';
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
  if (environment.is_opening) {
    return 'Opening';
  }
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

function managedEnvironmentLocalRuntimeLabel(environment: DesktopEnvironmentEntry): string {
  switch (environment.managed_local_runtime_state) {
    case 'running_desktop':
      return 'Running in Desktop';
    case 'running_external':
      return 'Running externally';
    default:
      return 'Starts on open';
  }
}

function managedEnvironmentLocalCloseLabel(environment: DesktopEnvironmentEntry): string {
  return environment.managed_local_close_behavior === 'detaches'
    ? 'Detaches on close'
    : 'Stops on close';
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
    if (environment.managed_has_local_hosting) {
      facts.push({
        label: 'LOCAL RUNTIME',
        value: managedEnvironmentLocalRuntimeLabel(environment),
      });
      if (environment.managed_local_runtime_state === 'running_desktop' || environment.managed_local_runtime_state === 'running_external') {
        facts.push({
          label: 'WINDOW',
          value: managedEnvironmentLocalCloseLabel(environment),
        });
      }
    }
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
  if (environment.kind === 'managed_environment') {
    const localEndpoint = compact(environment.local_ui_url) || compact(environment.managed_local_ui_bind) || compact(environment.managed_environment_name);
    const remoteEndpoint = compact(environment.remote_environment_url);
    return [
      environment.managed_has_local_hosting && localEndpoint !== ''
        ? {
            label: looksLikeAbsoluteURL(localEndpoint) ? 'URL' : 'LOCAL',
            value: localEndpoint,
            monospace: shouldUseMonospaceEndpoint(localEndpoint),
            copy_label: 'Copy local endpoint',
          }
        : null,
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
  const primaryLabel = environment.kind === 'ssh_environment'
    ? 'SSH'
    : environment.kind === 'external_local_ui'
      ? 'URL'
      : environment.managed_has_local_hosting
        ? (looksLikeAbsoluteURL(card.target_primary) ? 'URL' : 'LOCAL')
        : 'REMOTE';
  const secondaryLabel = environment.kind === 'ssh_environment'
    ? 'URL'
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
  if (environment.open_local_session_lifecycle === 'opening') {
    return {
      intent: 'opening',
      label: 'Opening…',
      enabled: false,
      variant: 'default',
      route: 'local_host',
    };
  }
  return {
    intent: environment.open_local_session_lifecycle === 'open'
      ? 'focus'
      : environment.managed_local_runtime_state === 'running_desktop' || environment.managed_local_runtime_state === 'running_external'
        ? 'attach'
        : 'open',
    label: environment.open_local_session_lifecycle === 'open'
      ? 'Focus Local'
      : environment.managed_local_runtime_state === 'running_desktop' || environment.managed_local_runtime_state === 'running_external'
        ? 'Attach Local'
        : 'Open Local',
    enabled: true,
    variant: 'default',
    route: 'local_host',
  };
}

function remoteRouteActionModel(options: Readonly<{
  remoteRouteState: DesktopProviderRemoteRouteState | undefined;
  remoteSessionLifecycle?: DesktopLauncherSessionLifecycle;
}>): EnvironmentActionModel {
  if (options.remoteSessionLifecycle === 'opening') {
    return {
      intent: 'opening',
      label: 'Opening…',
      enabled: false,
      variant: 'outline',
      route: 'remote_desktop',
    };
  }

  if (options.remoteSessionLifecycle === 'open') {
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

function isImmediateRouteAction(action: EnvironmentActionModel | null): boolean {
  return action?.intent === 'open' || action?.intent === 'attach' || action?.intent === 'focus';
}

function preferredRouteCandidate(input: Readonly<{
  defaultOpenRoute?: DesktopManagedEnvironmentRoute;
  managedPreferredOpenRoute?: 'auto' | DesktopManagedEnvironmentRoute;
}>): DesktopManagedEnvironmentRoute | null {
  if (input.defaultOpenRoute === 'local_host' || input.defaultOpenRoute === 'remote_desktop') {
    return input.defaultOpenRoute;
  }
  if (
    input.managedPreferredOpenRoute === 'local_host'
    || input.managedPreferredOpenRoute === 'remote_desktop'
  ) {
    return input.managedPreferredOpenRoute;
  }
  return null;
}

export function resolveDefaultDualRouteAction(input: Readonly<{
  local_action: EnvironmentActionModel;
  remote_action: EnvironmentActionModel | null;
  local_session_open: boolean;
  remote_session_open: boolean;
  managed_preferred_open_route?: 'auto' | DesktopManagedEnvironmentRoute;
  default_open_route?: DesktopManagedEnvironmentRoute;
}>): EnvironmentActionModel {
  const localAction = input.local_action;
  const remoteAction = input.remote_action;
  if (!remoteAction) {
    return localAction;
  }
  if (input.local_session_open && !input.remote_session_open && isImmediateRouteAction(localAction)) {
    return localAction;
  }
  if (input.remote_session_open && !input.local_session_open && isImmediateRouteAction(remoteAction)) {
    return remoteAction;
  }

  const preferredRoute = preferredRouteCandidate({
    defaultOpenRoute: input.default_open_route,
    managedPreferredOpenRoute: input.managed_preferred_open_route,
  });
  if (preferredRoute === 'remote_desktop' && isImmediateRouteAction(remoteAction)) {
    return remoteAction;
  }
  if (preferredRoute === 'local_host' && isImmediateRouteAction(localAction)) {
    return localAction;
  }
  if (isImmediateRouteAction(localAction)) {
    return localAction;
  }
  if (isImmediateRouteAction(remoteAction)) {
    return remoteAction;
  }
  if (localAction.enabled) {
    return localAction;
  }
  if (remoteAction.enabled) {
    return remoteAction;
  }
  return localAction;
}

function splitButtonPrimaryAction(action: EnvironmentActionModel): EnvironmentActionModel {
  return {
    ...action,
    label: action.intent === 'focus'
      ? 'Focus'
      : action.intent === 'attach'
        ? 'Attach'
      : action.intent === 'open'
        ? 'Open'
        : action.label,
    variant: 'default',
  };
}

function localSplitMenuActionLabel(action: EnvironmentActionModel): string {
  if (action.intent === 'focus') {
    return 'Focus Local Window';
  }
  if (action.intent === 'attach') {
    return 'Attach via Local Port';
  }
  return 'Open via Local Port';
}

function localSplitMenuActionDetail(environment: DesktopEnvironmentEntry): string {
  const runtimeURL = compact(environment.managed_local_runtime_url);
  if (environment.managed_local_runtime_state === 'running_external') {
    return runtimeURL || 'Running outside Desktop. Closing the window detaches only.';
  }
  if (environment.managed_local_runtime_state === 'running_desktop') {
    return runtimeURL || 'Already running in Desktop.';
  }
  return compact(environment.managed_local_ui_bind) || 'Hosted on this device.';
}

function remoteSplitMenuActionID(action: EnvironmentActionModel): EnvironmentSplitMenuActionModel['id'] {
  switch (action.intent) {
    case 'refresh_status':
      return 'remote_refresh';
    case 'reconnect_provider':
      return 'remote_reconnect';
    case 'retry_sync':
      return 'remote_retry_sync';
    case 'check_status':
      return 'remote_check_status';
    case 'unavailable':
      return 'remote_unavailable';
    default:
      return 'remote_route';
  }
}

function remoteSplitMenuActionLabel(action: EnvironmentActionModel): string {
  switch (action.intent) {
    case 'focus':
      return 'Focus Remote Window';
    case 'open':
      return 'Open via Control Plane';
    case 'refresh_status':
      return 'Refresh Remote Status';
    case 'reconnect_provider':
      return 'Reconnect Control Plane';
    case 'retry_sync':
      return 'Retry Control Plane Sync';
    case 'unavailable':
      return 'Remote route unavailable';
    default:
      return 'Check Remote Status';
  }
}

function remoteSplitMenuActionDetail(
  environment: DesktopEnvironmentEntry,
  action: EnvironmentActionModel,
): string {
  const routeSummary = [controlPlaneDisplayLabel(environment), compact(environment.env_public_id)].filter(Boolean).join(' / ');
  if (!isImmediateRouteAction(action)) {
    return compact(environment.remote_state_reason) || routeSummary || 'Remote status is not currently available.';
  }
  return routeSummary || compact(environment.remote_state_reason) || 'Open through the connected Control Plane.';
}

function dualRouteSplitMenuActions(
  environment: DesktopEnvironmentEntry,
  localAction: EnvironmentActionModel,
  remoteAction: EnvironmentActionModel,
  defaultAction: EnvironmentActionModel,
): readonly EnvironmentSplitMenuActionModel[] {
  return [
    {
      id: 'local_route',
      section: 'local',
      label: localSplitMenuActionLabel(localAction),
      detail: localSplitMenuActionDetail(environment),
      action: localAction,
      disabled: !localAction.enabled,
      is_default: defaultAction.route === 'local_host',
    },
    {
      id: remoteSplitMenuActionID(remoteAction),
      section: 'remote',
      label: remoteSplitMenuActionLabel(remoteAction),
      detail: remoteSplitMenuActionDetail(environment, remoteAction),
      action: remoteAction,
      disabled: !remoteAction.enabled,
      is_default: defaultAction.route === 'remote_desktop',
    },
  ];
}

function providerBackedStatusModel(options: Readonly<{
  isOpen: boolean;
  isOpening: boolean;
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
  if (options.isOpening) {
    return {
      label: 'Opening',
      tone: 'primary',
    };
  }
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
  const localSessionOpen = environment.open_local_session_lifecycle === 'open';
  const remoteSessionOpen = environment.open_remote_session_lifecycle === 'open';
  const status = providerBackedStatusModel({
    isOpen: environment.is_open,
    isOpening: environment.is_opening,
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
      remoteSessionLifecycle: environment.open_remote_session_lifecycle,
    })
    : null;

  if (environment.is_opening) {
    return {
      status_label: status.label,
      status_tone: status.tone,
      action_presentation: {
        kind: 'single_button',
        action: {
          intent: 'opening',
          label: 'Opening…',
          enabled: false,
          variant: 'default',
          route: environment.default_open_route ?? 'local_host',
        },
      },
    };
  }

  if (hasLocalHosting && hasRemoteDesktop) {
    const localAction = localRouteActionModel(environment);
    const resolvedDefaultAction = resolveDefaultDualRouteAction({
      local_action: localAction,
      remote_action: remoteAction,
      local_session_open: localSessionOpen,
      remote_session_open: remoteSessionOpen,
      managed_preferred_open_route: environment.managed_preferred_open_route,
      default_open_route: environment.default_open_route,
    });
    return {
      status_label: status.label,
      status_tone: status.tone,
      action_presentation: {
        kind: 'split_button',
        default_action: splitButtonPrimaryAction(resolvedDefaultAction),
        menu_actions: dualRouteSplitMenuActions(environment, localAction, remoteAction!, resolvedDefaultAction),
        menu_button_label: 'Choose environment route',
      },
    };
  }
  if (hasLocalHosting) {
    return {
      status_label: status.label,
      status_tone: status.tone,
      action_presentation: {
        kind: 'single_button',
        action: {
          intent: environment.open_local_session_lifecycle === 'open'
            ? 'focus'
            : environment.managed_local_runtime_state === 'running_desktop' || environment.managed_local_runtime_state === 'running_external'
              ? 'attach'
              : 'open',
          label: environment.open_local_session_lifecycle === 'open'
            ? 'Focus'
            : environment.managed_local_runtime_state === 'running_desktop' || environment.managed_local_runtime_state === 'running_external'
              ? 'Attach'
              : 'Open',
          enabled: true,
          variant: 'default',
          route: 'local_host',
        },
      },
    };
  }
  return {
    status_label: status.label,
    status_tone: status.tone,
    action_presentation: {
      kind: 'single_button',
      action: remoteAction ?? {
        intent: 'refresh_status',
        label: 'Refresh Status',
        enabled: true,
        variant: 'default',
      },
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
  if (environment.is_opening) {
    return 'Opening';
  }
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
  if (environment.is_opening) {
    return 'primary';
  }
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
    const localEndpoint = compact(environment.local_ui_url) || compact(environment.managed_local_ui_bind) || compact(environment.managed_environment_name);
    const remoteEndpoint = compact(environment.remote_environment_url);
    const targetPrimary = hasLocalHosting
      ? (localEndpoint || remoteEndpoint || environment.secondary_text || 'Local environment')
      : (remoteEndpoint || environment.secondary_text || localEndpoint || 'Provider-backed environment');
    const targetSecondary = hasLocalHosting && remoteEndpoint !== '' && remoteEndpoint !== targetPrimary
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
  const environmentFilter = environmentProviderFilterValue(environment);
  if (activeFilter === LOCAL_ENVIRONMENT_LIBRARY_FILTER) {
    return environmentFilter === '';
  }
  return environmentFilter === activeFilter;
}

export function filterEnvironmentLibrary(
  snapshot: DesktopWelcomeSnapshot,
  query = '',
  providerFilter = '',
): readonly DesktopEnvironmentEntry[] {
  return snapshot.environments.filter((environment) => (
    environmentMatchesLibrarySearch(environment, query)
    && environmentMatchesProviderFilter(environment, providerFilter)
  ));
}

export function environmentLibraryCount(
  snapshot: DesktopWelcomeSnapshot,
  query = '',
  providerFilter = '',
): number {
  return filterEnvironmentLibrary(snapshot, query, providerFilter).length;
}
