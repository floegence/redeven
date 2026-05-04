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
import {
  formatRuntimeServiceWorkload,
  runtimeServiceOpenReadinessLabel,
  runtimeServiceIsOpenable,
  runtimeServiceNeedsRuntimeUpdate,
  type RuntimeServiceSnapshot,
} from '../shared/runtimeService';

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
  kind_label: 'Local' | 'Provider' | 'Redeven URL' | 'SSH Host';
  status_label: string;
  status_tone: EnvironmentCardTone;
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
  | 'reconnect_provider'
  | 'start_runtime'
  | 'stop_runtime'
  | 'restart_runtime'
  | 'refresh_runtime'
  | 'serve_runtime_locally'
  | 'focus_local_serve'
  | 'unavailable';

export type EnvironmentActionModel = Readonly<{
  intent: EnvironmentActionIntent;
  label: string;
  enabled: boolean;
  variant: 'default' | 'outline';
  route?: DesktopManagedEnvironmentRoute;
  provider_origin?: string;
  provider_id?: string;
}>;

export type EnvironmentActionMenuItemModel = Readonly<{
  id: string;
  label: string;
  action: EnvironmentActionModel;
}>;

export type EnvironmentActionOverlayTone = 'neutral' | 'warning';

export type EnvironmentGuidanceActionModel = Readonly<{
  label: string;
  emphasis: 'primary' | 'secondary';
  action: EnvironmentActionModel;
}>;

export type EnvironmentPrimaryActionOverlayModel =
  | Readonly<{
      kind: 'tooltip';
      tone: EnvironmentActionOverlayTone;
      message: string;
    }>
  | Readonly<{
      kind: 'popover';
      tone: EnvironmentActionOverlayTone;
      eyebrow: string;
      title: string;
      detail: string;
      actions: readonly EnvironmentGuidanceActionModel[];
    }>;

export type EnvironmentActionPresentation = Readonly<{
  kind: 'split_button';
  primary_action: EnvironmentActionModel;
  primary_action_overlay?: EnvironmentPrimaryActionOverlayModel;
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
  return surface === 'environment_settings' ? 'Environment Settings' : 'Connect Environment';
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
    case 'provider':
      return 'Provider';
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

const ENVIRONMENT_CARD_FACT_ORDER = [
  'RUNS ON',
  'RUNTIME SERVICE',
  'VERSION',
  'ACTIVE WORK',
  'PROVIDER',
  'SOURCE ENV',
  'BOOTSTRAP',
] as const;

function orderEnvironmentCardFacts(
  facts: readonly EnvironmentCardFactModel[],
): readonly EnvironmentCardFactModel[] {
  return [...facts].sort((left, right) => (
    ENVIRONMENT_CARD_FACT_ORDER.indexOf(left.label as (typeof ENVIRONMENT_CARD_FACT_ORDER)[number])
    - ENVIRONMENT_CARD_FACT_ORDER.indexOf(right.label as (typeof ENVIRONMENT_CARD_FACT_ORDER)[number])
  ));
}

function controlPlaneDisplayLabel(environment: DesktopEnvironmentEntry): string {
  return environment.control_plane_label || environment.provider_origin || '';
}

function environmentRunsOnLabel(environment: DesktopEnvironmentEntry): string {
  if (environment.kind === 'managed_environment') {
    return 'This device';
  }
  if (environment.kind === 'provider_environment') {
    const localRuntimeOnline = environment.provider_local_runtime_state === 'running_desktop'
      || environment.provider_local_runtime_state === 'running_external';
    const localWindowActive = environment.provider_effective_window_route === 'local_host';
    if (localRuntimeOnline || localWindowActive || environment.remote_route_state !== 'ready') {
      return 'This device';
    }
    return 'Provider remote';
  }
  if (environment.kind === 'ssh_environment') {
    return environment.secondary_text || 'Unknown';
  }
  return externalLocalUINetworkLabel(environment);
}

function environmentRuntimeService(environment: DesktopEnvironmentEntry): RuntimeServiceSnapshot | undefined {
  if (environment.runtime_service) {
    return environment.runtime_service;
  }
  if (environment.kind === 'managed_environment') {
    return environment.managed_runtime_service;
  }
  if (environment.kind === 'provider_environment') {
    return environment.provider_runtime_service;
  }
  return undefined;
}

function runtimeServiceLabel(snapshot: RuntimeServiceSnapshot | undefined): string {
  if (!snapshot) {
    return 'Unknown';
  }
  if (snapshot.open_readiness?.state === 'blocked') {
    if (runtimeServiceNeedsRuntimeUpdate(snapshot)) {
      return 'Needs update';
    }
    return 'Blocked';
  }
  if (snapshot.open_readiness?.state === 'starting') {
    return 'Preparing';
  }
  switch (snapshot.compatibility) {
    case 'update_available':
      return 'Update ready';
    case 'restart_recommended':
      return 'Restart recommended';
    case 'update_required':
      return 'Needs update';
    case 'desktop_update_required':
      return 'Update Desktop';
    case 'managed_elsewhere':
      return 'Managed elsewhere';
    default:
      break;
  }
  if (snapshot.service_owner === 'desktop' || snapshot.desktop_managed) {
    return 'Running';
  }
  if (snapshot.service_owner === 'external') {
    return 'External service';
  }
  return 'Unknown';
}

function runtimeServiceVersionLabel(snapshot: RuntimeServiceSnapshot | undefined): string {
  return compact(snapshot?.runtime_version) || 'Unknown';
}

function runtimeServiceFacts(environment: DesktopEnvironmentEntry): readonly EnvironmentCardFactModel[] {
  const snapshot = environmentRuntimeService(environment);
  if (!snapshot) {
    return [];
  }
  return [
    buildEnvironmentCardFact('RUNTIME SERVICE', runtimeServiceLabel(snapshot)),
    buildEnvironmentCardFact('VERSION', runtimeServiceVersionLabel(snapshot)),
    buildEnvironmentCardFact('ACTIVE WORK', formatRuntimeServiceWorkload(snapshot)),
  ];
}

export function buildEnvironmentCardFactsModel(
  environment: DesktopEnvironmentEntry,
): readonly EnvironmentCardFactModel[] {
  if (environment.kind === 'managed_environment') {
    return orderEnvironmentCardFacts([
      buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
      ...runtimeServiceFacts(environment),
      buildPlaceholderEnvironmentCardFact('PROVIDER'),
    ]);
  }

  if (environment.kind === 'provider_environment') {
    return orderEnvironmentCardFacts([
      buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
      ...runtimeServiceFacts(environment),
      buildEnvironmentCardFact('PROVIDER', controlPlaneDisplayLabel(environment) || 'Unavailable'),
      buildEnvironmentCardFact('SOURCE ENV', environment.env_public_id ?? 'Unknown'),
    ]);
  }

  if (environment.kind === 'ssh_environment') {
    return orderEnvironmentCardFacts([
      buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
      ...runtimeServiceFacts(environment),
      buildEnvironmentCardFact('BOOTSTRAP', sshBootstrapSummary(environment) || 'Automatic bootstrap'),
    ]);
  }

  return orderEnvironmentCardFacts([
    buildEnvironmentCardFact('RUNS ON', environmentRunsOnLabel(environment)),
    ...runtimeServiceFacts(environment),
  ]);
}

export function buildEnvironmentCardEndpointsModel(
  environment: DesktopEnvironmentEntry,
): readonly EnvironmentCardEndpointModel[] {
  if (environment.kind === 'managed_environment') {
    const localEndpoint = compact(environment.local_ui_url) || compact(environment.managed_local_ui_bind) || compact(environment.managed_environment_name);
    return localEndpoint !== ''
      ? [{
        label: looksLikeAbsoluteURL(localEndpoint) ? 'URL' : 'LOCAL',
        value: localEndpoint,
        monospace: shouldUseMonospaceEndpoint(localEndpoint),
        copy_label: 'Copy local endpoint',
      }]
      : [];
  }

  if (environment.kind === 'provider_environment') {
    const localEndpoint = compact(environment.provider_local_runtime_url)
      || (
        (
          environment.provider_local_runtime_state === 'running_desktop'
          || environment.provider_local_runtime_state === 'running_external'
        )
          ? compact(environment.local_ui_url)
          : ''
      );
    const remoteEndpoint = compact(environment.remote_environment_url);
    return [
      localEndpoint !== ''
        ? {
          label: 'LOCAL',
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
  if (environment.kind === 'provider_environment' && environment.control_plane_sync_state === 'auth_required') {
    return 'RECONNECT REQUIRED';
  }
  if (environment.runtime_health.status !== 'online') {
    return 'RUNTIME OFFLINE';
  }
  const snapshot = environmentRuntimeService(environment);
  if (runtimeServiceIsOpenable(snapshot)) {
    return 'RUNTIME READY';
  }
  if (snapshot?.open_readiness?.state === 'blocked') {
    return runtimeServiceNeedsRuntimeUpdate(snapshot)
      ? 'RUNTIME NEEDS UPDATE'
      : 'RUNTIME BLOCKED';
  }
  return 'RUNTIME PREPARING';
}

function runtimeStatusTone(environment: DesktopEnvironmentEntry): EnvironmentCardTone {
  return environment.runtime_health.status === 'online' && runtimeServiceIsOpenable(environmentRuntimeService(environment))
    ? 'success'
    : 'warning';
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
  const snapshot = environmentRuntimeService(environment);
  const blocked = snapshot?.open_readiness?.state === 'blocked';
  return {
    intent: 'open',
    label: environment.runtime_health.status === 'online' && !runtimeServiceIsOpenable(snapshot)
      ? blocked ? 'Open' : 'Preparing…'
      : 'Open',
    enabled: environment.runtime_health.status === 'online' && runtimeServiceIsOpenable(snapshot),
    variant: 'default',
  };
}

function providerPrimaryRoute(environment: DesktopEnvironmentEntry): DesktopManagedEnvironmentRoute | '' {
  if (environment.kind !== 'provider_environment') {
    return '';
  }
  return environment.provider_effective_window_route || environment.provider_default_open_route || '';
}

function providerLocalRuntimeMenuAction(
  environment: DesktopEnvironmentEntry,
): EnvironmentActionMenuItemModel | null {
  if (environment.kind !== 'provider_environment') {
    return null;
  }
  const primaryRoute = providerPrimaryRoute(environment);
  const localRuntimeOnline = environment.provider_local_runtime_state === 'running_desktop'
    || environment.provider_local_runtime_state === 'running_external';

  if (environment.open_local_session_lifecycle === 'open' && primaryRoute !== 'local_host') {
    return {
      id: 'focus_local_runtime',
      label: 'Focus local runtime',
      action: {
        intent: 'focus_local_serve',
        label: 'Focus local runtime',
        enabled: true,
        variant: 'outline',
        route: 'local_host',
      },
    };
  }

  if (environment.open_local_session_lifecycle === 'opening' && primaryRoute !== 'local_host') {
    return {
      id: 'local_runtime_opening',
      label: 'Local runtime opening…',
      action: {
        intent: 'opening',
        label: 'Local runtime opening…',
        enabled: false,
        variant: 'outline',
      },
    };
  }

  if (primaryRoute === 'local_host' && localRuntimeOnline) {
    return null;
  }

  return localRuntimeOnline && primaryRoute !== 'local_host'
    ? {
        id: 'open_local_runtime',
        label: 'Open Local',
        action: {
          intent: 'open',
          label: 'Open Local',
          enabled: true,
          variant: 'outline',
          route: 'local_host',
        },
      }
    : {
        id: 'use_locally',
        label: 'Use Locally',
        action: {
          intent: 'serve_runtime_locally',
          label: 'Use Locally',
          enabled: true,
          variant: 'outline',
          route: 'local_host',
        },
      };
}

function providerRemoteRouteMenuAction(
  environment: DesktopEnvironmentEntry,
): EnvironmentActionMenuItemModel | null {
  if (environment.kind !== 'provider_environment' || providerPrimaryRoute(environment) === 'remote_desktop') {
    return null;
  }
  if (compact(environment.open_remote_session_key) !== '') {
    return {
      id: 'focus_control_plane_window',
      label: 'Focus remote window',
      action: {
        intent: 'focus',
        label: 'Focus remote window',
        enabled: true,
        variant: 'outline',
        route: 'remote_desktop',
      },
    };
  }
  if (environment.open_remote_session_lifecycle === 'opening') {
    return {
      id: 'control_plane_window_opening',
      label: 'Remote window opening…',
      action: {
        intent: 'opening',
        label: 'Remote window opening…',
        enabled: false,
        variant: 'outline',
        route: 'remote_desktop',
      },
    };
  }
  if (environment.remote_route_state === 'ready') {
    return {
      id: 'open_via_control_plane',
      label: 'Open remotely',
      action: {
        intent: 'open',
        label: 'Open remotely',
        enabled: true,
        variant: 'outline',
        route: 'remote_desktop',
      },
    };
  }
  return null;
}

function runtimeMenuActions(environment: DesktopEnvironmentEntry): readonly EnvironmentActionMenuItemModel[] {
  const items: EnvironmentActionMenuItemModel[] = [];
  const localServeAction = providerLocalRuntimeMenuAction(environment);
  const remoteRouteAction = providerRemoteRouteMenuAction(environment);
  if (localServeAction) {
    items.push(localServeAction);
  }
  if (remoteRouteAction) {
    items.push(remoteRouteAction);
  }
  if (environment.runtime_control_capability === 'start_stop') {
    const providerNeedsLocalBinding = environment.kind === 'provider_environment'
      && environment.provider_local_runtime_state === 'not_running';
    if (!providerNeedsLocalBinding) {
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
    }
  } else if (!localServeAction && !remoteRouteAction) {
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

function blockedPrimaryActionGuidanceAction(
  environment: DesktopEnvironmentEntry,
  menuActions: readonly EnvironmentActionMenuItemModel[],
): EnvironmentGuidanceActionModel | null {
  const recoveryAction = menuActions.find((item) => (
    item.action.intent === 'start_runtime'
      || item.action.intent === 'serve_runtime_locally'
  ));
  if (!recoveryAction) {
    return null;
  }
  if (recoveryAction.action.intent === 'serve_runtime_locally') {
    return {
      label: 'Use Locally',
      emphasis: 'primary',
      action: recoveryAction.action,
    };
  }
  return {
    label: environment.kind === 'ssh_environment' ? 'Start runtime' : 'Start runtime locally',
    emphasis: 'primary',
    action: recoveryAction.action,
  };
}

function blockedPrimaryActionRefreshGuidanceAction(
  menuActions: readonly EnvironmentActionMenuItemModel[],
): EnvironmentGuidanceActionModel | null {
  const refreshAction = menuActions.find((item) => item.action.intent === 'refresh_runtime');
  if (!refreshAction) {
    return null;
  }
  return {
    label: 'Refresh status',
    emphasis: 'secondary',
    action: refreshAction.action,
  };
}

function blockedRuntimePrimaryActionGuidanceActions(
  menuActions: readonly EnvironmentActionMenuItemModel[],
): readonly EnvironmentGuidanceActionModel[] {
  const restartSource = menuActions.find((item) => item.action.intent === 'stop_runtime');
  const refreshSource = menuActions.find((item) => item.action.intent === 'refresh_runtime');
  return [
    restartSource
      ? {
          label: 'Restart after update…',
          emphasis: 'primary',
          action: {
            ...restartSource.action,
            intent: 'restart_runtime' as const,
            label: 'Restart after update…',
          },
        }
      : null,
    refreshSource
      ? {
          label: 'Refresh status',
          emphasis: 'secondary',
          action: refreshSource.action,
        }
      : null,
  ].filter((item): item is EnvironmentGuidanceActionModel => item !== null);
}

function blockedRuntimePrimaryActionTitle(
  snapshot: RuntimeServiceSnapshot | undefined,
): string {
  return runtimeServiceNeedsRuntimeUpdate(snapshot)
    ? 'Runtime update required'
    : 'Runtime cannot open yet';
}

function blockedRuntimePrimaryActionDetail(
  environment: DesktopEnvironmentEntry,
  snapshot: RuntimeServiceSnapshot | undefined,
): string {
  if (runtimeServiceNeedsRuntimeUpdate(snapshot)) {
    return environment.kind === 'ssh_environment'
      ? 'SSH is connected, but the running runtime on this host needs an update before it can open the Environment App. Open will stay locked until the runtime is updated and restarted when active work can be interrupted.'
      : 'This running runtime needs an update before it can open the Environment App. Open will stay locked until the runtime is updated and restarted when active work can be interrupted.';
  }
  return runtimeServiceOpenReadinessLabel(snapshot);
}

function blockedPrimaryActionTitle(
  environment: DesktopEnvironmentEntry,
  action: EnvironmentActionModel,
): string {
  if (action.intent === 'serve_runtime_locally') {
    return 'Use Local Environment to continue';
  }
  return environment.kind === 'ssh_environment'
    ? 'Start the runtime to continue'
    : 'Start the local runtime to continue';
}

function blockedPrimaryActionDetail(
  environment: DesktopEnvironmentEntry,
  action: EnvironmentActionModel,
): string {
  if (action.intent === 'serve_runtime_locally') {
    return 'Desktop will link the Local Environment on this device to this provider Environment, then open it locally.';
  }
  return environment.kind === 'ssh_environment'
    ? 'Open becomes available once the runtime is ready on this SSH host.'
    : 'Open becomes available once the runtime is ready on this device.';
}

function primaryActionOverlay(
  environment: DesktopEnvironmentEntry,
  menuActions: readonly EnvironmentActionMenuItemModel[],
): EnvironmentPrimaryActionOverlayModel | undefined {
  if (environment.window_state !== 'closed') {
    return undefined;
  }
  if (environment.kind === 'provider_environment' && environment.control_plane_sync_state === 'auth_required') {
    return {
      kind: 'tooltip',
      tone: 'warning',
      message: 'Desktop needs fresh provider authorization before it can request a one-time Local Environment bootstrap ticket for this Environment.',
    };
  }
  if (environment.runtime_health.status === 'online') {
    const snapshot = environmentRuntimeService(environment);
    if (runtimeServiceIsOpenable(snapshot)) {
      return undefined;
    }
    if (snapshot?.open_readiness?.state === 'blocked') {
      return {
        kind: 'popover',
        tone: 'warning',
        eyebrow: 'Runtime blocked',
        title: blockedRuntimePrimaryActionTitle(snapshot),
        detail: blockedRuntimePrimaryActionDetail(environment, snapshot),
        actions: blockedRuntimePrimaryActionGuidanceActions(menuActions),
      };
    }
    return {
      kind: 'tooltip',
      tone: 'warning',
      message: runtimeServiceOpenReadinessLabel(snapshot),
    };
  }

  const recoveryAction = blockedPrimaryActionGuidanceAction(environment, menuActions);
  if (recoveryAction) {
    const refreshAction = blockedPrimaryActionRefreshGuidanceAction(menuActions);
    return {
      kind: 'popover',
      tone: 'warning',
      eyebrow: 'Runtime offline',
      title: blockedPrimaryActionTitle(environment, recoveryAction.action),
      detail: blockedPrimaryActionDetail(environment, recoveryAction.action),
      actions: [
        recoveryAction,
        ...(refreshAction ? [refreshAction] : []),
      ],
    };
  }

  return {
    kind: 'tooltip',
    tone: 'warning',
    message: 'Runtime is offline or unavailable right now. Start it from its source, then refresh status.',
  };
}

export function buildProviderBackedEnvironmentActionModel(
  environment: DesktopEnvironmentEntry,
  _controlPlaneSyncState: DesktopControlPlaneSyncState = environment.control_plane_sync_state ?? 'ready',
): ProviderBackedEnvironmentActionModel {
  const syncState = _controlPlaneSyncState;
  const primaryAction = syncState === 'auth_required' && environment.kind === 'provider_environment'
    ? {
        intent: 'reconnect_provider' as const,
        label: 'Reconnect Provider',
        enabled: true,
        variant: 'default' as const,
        provider_origin: environment.provider_origin,
        provider_id: environment.provider_id,
      }
    : primaryWindowAction(environment);
  const menuActions = syncState === 'auth_required' && environment.kind === 'provider_environment'
    ? [{
        id: 'reconnect_provider',
        label: 'Reconnect Provider',
        action: primaryAction,
      }]
    : runtimeMenuActions(environment);
  return {
    status_label: runtimeStatusLabel(environment),
    status_tone: runtimeStatusTone(environment),
    action_presentation: {
      kind: 'split_button',
      primary_action: primaryAction,
      primary_action_overlay: primaryActionOverlay(environment, menuActions),
      menu_button_label: 'Runtime actions',
      menu_actions: menuActions,
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
    const targetPrimary = localEndpoint || environment.secondary_text || 'Local environment';
    return {
      kind_label: environmentKindLabel(environment),
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      target_primary: targetPrimary,
      target_secondary: '',
      target_primary_monospace: shouldUseMonospaceEndpoint(targetPrimary),
      target_secondary_monospace: false,
      meta: environmentCardMeta(environment),
    };
  }

  if (environment.kind === 'provider_environment') {
    const localEndpoint = compact(environment.provider_local_runtime_url);
    const remoteEndpoint = compact(environment.remote_environment_url);
    const targetPrimary = localEndpoint
      || remoteEndpoint
      || compact(environment.local_ui_url)
      || compact(environment.secondary_text)
      || 'Provider environment';
    return {
      kind_label: 'Provider',
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
      target_primary: targetPrimary,
      target_secondary: localEndpoint !== '' && remoteEndpoint !== '' && remoteEndpoint !== targetPrimary
        ? remoteEndpoint
        : '',
      target_primary_monospace: shouldUseMonospaceEndpoint(targetPrimary),
      target_secondary_monospace: shouldUseMonospaceEndpoint(remoteEndpoint),
      meta: environmentCardMeta(environment),
    };
  }

  if (environment.kind === 'ssh_environment') {
    return {
      kind_label: 'SSH Host',
      status_label: environmentStatusLabel(environment),
      status_tone: environmentStatusTone(environment),
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
