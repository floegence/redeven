import {
  desktopGatewayCanManageService,
  desktopGatewayConnectionKindLabel,
  type DesktopGatewaySource,
} from '../shared/desktopGateway';
import type {
  DesktopGatewayResolveFocus,
  DesktopGatewayStartPolicy,
  DesktopLauncherActionProgress,
  DesktopLauncherActionRequest,
} from '../shared/desktopLauncherIPC';
import type { GatewaySourceActionModel } from './viewModel';

type GatewayManagedActionKind =
  | 'start_gateway'
  | 'stop_gateway'
  | 'restart_gateway'
  | 'update_gateway'
  | 'refresh_gateway_status'
  | 'refresh_gateway_catalog'
  | 'pair_gateway';

export type GatewayActionExecutionMode = 'direct' | 'guide' | 'confirm' | 'progress' | 'attention';

export type GatewayActionPanelKind =
  | 'none'
  | 'pair_ready'
  | 'start_and_pair'
  | 'update_then_pair'
  | 'resolve_before_pair'
  | 'access_only_pair'
  | 'start_gateway'
  | 'stop_gateway_confirm'
  | 'restart_gateway_confirm'
  | 'update_gateway_confirm'
  | 'refresh_status'
  | 'start_and_refresh_catalog'
  | 'failure_recovery';

export type GatewayActionPanelFact = Readonly<{
  label: string;
  value: string;
  tone?: 'neutral' | 'warning' | 'error';
}>;

export type GatewayActionAffectedSession = Readonly<{
  session_key: string;
  label: string;
}>;

export type GatewayActionPanelModel = Readonly<{
  kind: GatewayActionPanelKind;
  execution_mode: GatewayActionExecutionMode;
  tone: 'neutral' | 'primary' | 'warning' | 'error';
  eyebrow: string;
  title: string;
  detail: string;
  aria_label: string;
  facts: readonly GatewayActionPanelFact[];
  status_facts: readonly GatewayActionPanelFact[];
  diagnostic_facts: readonly GatewayActionPanelFact[];
  affected_sessions: readonly GatewayActionAffectedSession[];
  overflow_session_count: number;
  continuation_action?: DesktopLauncherActionRequest;
  resolve_focus?: DesktopGatewayResolveFocus;
  primary_action?: GatewaySourceActionModel;
  secondary_actions: readonly GatewaySourceActionModel[];
}>;

export type BuildGatewayActionPresentationInput = Readonly<{
  gateway: DesktopGatewaySource;
  clicked_action: GatewaySourceActionModel | Readonly<{ intent: 'refresh_gateway_status'; label: string; enabled: boolean; variant: 'outline' }>;
  active_progress?: DesktopLauncherActionProgress | null;
  retained_failure?: DesktopLauncherActionProgress | null;
  affected_sessions?: readonly GatewayActionAffectedSession[];
}>;

function gatewaySourceAction(
  intent: GatewaySourceActionModel['intent'],
  label: string,
  variant: GatewaySourceActionModel['variant'] = 'outline',
  enabled = true,
): GatewaySourceActionModel {
  return { intent, label, variant, enabled };
}

function gatewayServiceAction(
  intent: GatewayManagedActionKind,
  label: string,
  variant: GatewaySourceActionModel['variant'] = 'outline',
  enabled = true,
): GatewaySourceActionModel {
  return gatewaySourceAction(intent as GatewaySourceActionModel['intent'], label, variant, enabled);
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function needsPairing(gateway: DesktopGatewaySource): boolean {
  return gateway.status === 'pairing_required'
    || gateway.status === 'trust_changed'
    || gateway.trust_state === 'unpaired'
    || gateway.trust_state === 'revoked'
    || gateway.trust_state === 'trust_changed';
}

function serviceStatus(gateway: DesktopGatewaySource): string {
  return gateway.service_state?.status ?? (gateway.connection_kind === 'url' ? 'not_applicable' : 'unknown');
}

function serviceStatusLabel(status: string): string {
  switch (status) {
    case 'not_applicable':
      return 'Access-only';
    case 'not_started':
      return 'Not started';
    case 'starting':
      return 'Starting';
    case 'ready':
      return 'Ready';
    case 'ssh_unreachable':
      return 'SSH unreachable';
    case 'container_unavailable':
      return 'Container unavailable';
    case 'service_needs_update':
      return 'Update required';
    case 'bridge_unavailable':
      return 'Bridge unavailable';
    case 'error':
      return 'Needs attention';
    default:
      return 'Unknown';
  }
}

function trustStateLabel(gateway: DesktopGatewaySource): string {
  switch (gateway.trust_state) {
    case 'paired':
      return 'Paired';
    case 'trust_changed':
      return 'Review required';
    case 'revoked':
      return 'Revoked';
    case 'unpaired':
    default:
      return 'Not paired';
  }
}

function catalogSyncLabel(gateway: DesktopGatewaySource): GatewayActionPanelFact {
  switch (gateway.sync_state ?? 'idle') {
    case 'syncing':
      return { label: 'Catalog sync', value: 'Syncing', tone: 'warning' };
    case 'catalog_failed':
    case 'gateway_unreachable':
    case 'pairing_failed':
      return { label: 'Catalog sync', value: 'Failed', tone: 'error' };
    case 'ready':
      return { label: 'Catalog sync', value: 'Ready' };
    default:
      return { label: 'Catalog sync', value: 'Idle' };
  }
}

function gatewayServiceFact(gateway: DesktopGatewaySource): GatewayActionPanelFact {
  const status = serviceStatus(gateway);
  return {
    label: 'Gateway service',
    value: serviceStatusLabel(status),
    tone: status === 'ready' || status === 'not_applicable' ? 'neutral' : 'warning',
  };
}

function defaultStatusFacts(gateway: DesktopGatewaySource): readonly GatewayActionPanelFact[] {
  return [
    gatewayServiceFact(gateway),
    catalogSyncLabel(gateway),
  ];
}

function defaultDiagnosticFacts(gateway: DesktopGatewaySource): readonly GatewayActionPanelFact[] {
  return [
    { label: 'Trust', value: trustStateLabel(gateway), tone: gateway.trust_state === 'paired' ? 'neutral' : 'warning' },
    { label: 'Transport', value: desktopGatewayConnectionKindLabel(gateway.connection_kind) },
    { label: 'Endpoint', value: compact(gateway.endpoint_label) || compact(gateway.gateway_url) || gateway.gateway_id },
    ...(gateway.ssh_details?.ssh_destination ? [{ label: 'Host', value: gateway.ssh_details.ssh_destination }] : []),
    ...(gateway.container_label || gateway.container_ref || gateway.container_id
      ? [{ label: 'Container', value: compact(gateway.container_label) || compact(gateway.container_ref) || compact(gateway.container_id) }]
      : []),
  ];
}

function continuationActionFor(
  gateway: DesktopGatewaySource,
  action: BuildGatewayActionPresentationInput['clicked_action'],
  startPolicy?: Extract<DesktopGatewayStartPolicy, 'start_if_needed'>,
): DesktopLauncherActionRequest | undefined {
  switch (action.intent) {
    case 'pair_gateway':
      return {
        kind: 'pair_gateway',
        gateway_id: gateway.gateway_id,
        ...(startPolicy ? { start_policy: startPolicy } : {}),
      };
    case 'refresh_gateway_catalog':
      return {
        kind: 'refresh_gateway_catalog',
        gateway_id: gateway.gateway_id,
        ...(startPolicy ? { start_policy: startPolicy } : {}),
      };
    case 'refresh_gateway_status':
      return {
        kind: 'refresh_gateway_status',
        gateway_id: gateway.gateway_id,
      };
    case 'start_gateway':
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
      return {
        kind: action.intent,
        gateway_id: gateway.gateway_id,
      } as DesktopLauncherActionRequest;
    default:
      return undefined;
  }
}

function resolveFocusForGateway(gateway: DesktopGatewaySource): DesktopGatewayResolveFocus | undefined {
  if (gateway.connection_kind === 'url') {
    return 'url_endpoint';
  }
  switch (serviceStatus(gateway)) {
    case 'ssh_unreachable':
      return 'ssh_host';
    case 'container_unavailable':
      return 'container';
    default:
      return undefined;
  }
}

function buildPanel(
  input: Omit<GatewayActionPanelModel, 'facts' | 'status_facts' | 'diagnostic_facts' | 'affected_sessions' | 'overflow_session_count' | 'secondary_actions'>
  & Readonly<{
    gateway: DesktopGatewaySource;
    facts?: readonly GatewayActionPanelFact[];
    status_facts?: readonly GatewayActionPanelFact[];
    diagnostic_facts?: readonly GatewayActionPanelFact[];
    affected_sessions?: readonly GatewayActionAffectedSession[];
    secondary_actions?: readonly GatewaySourceActionModel[];
  }>,
): GatewayActionPanelModel {
  const sessions = input.affected_sessions ?? [];
  const visibleSessions = sessions.slice(0, 5);
  const statusFacts = input.status_facts ?? defaultStatusFacts(input.gateway);
  const diagnosticFacts = input.diagnostic_facts ?? defaultDiagnosticFacts(input.gateway);
  return {
    kind: input.kind,
    execution_mode: input.execution_mode,
    tone: input.tone,
    eyebrow: input.eyebrow,
    title: input.title,
    detail: input.detail,
    aria_label: input.aria_label,
    facts: input.facts ?? [...statusFacts, ...diagnosticFacts],
    status_facts: statusFacts,
    diagnostic_facts: diagnosticFacts,
    affected_sessions: visibleSessions,
    overflow_session_count: Math.max(0, sessions.length - visibleSessions.length),
    ...(input.continuation_action ? { continuation_action: input.continuation_action } : {}),
    ...(input.resolve_focus ? { resolve_focus: input.resolve_focus } : {}),
    ...(input.primary_action ? { primary_action: input.primary_action } : {}),
    secondary_actions: input.secondary_actions ?? [],
  };
}

function confirmationPanelKind(action: string): GatewayActionPanelKind {
  switch (action) {
    case 'stop_gateway':
      return 'stop_gateway_confirm';
    case 'restart_gateway':
      return 'restart_gateway_confirm';
    default:
      return 'update_gateway_confirm';
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'stop_gateway':
      return 'Stop Gateway';
    case 'restart_gateway':
      return 'Restart Gateway';
    case 'update_gateway':
      return 'Update Gateway';
    case 'refresh_gateway_status':
      return 'Refresh status';
    case 'refresh_gateway_catalog':
      return 'Refresh';
    case 'pair_gateway':
      return 'Retry sync';
    default:
      return 'Gateway action';
  }
}

export function buildGatewayActionPresentation(
  input: BuildGatewayActionPresentationInput,
): GatewayActionPanelModel {
  const { gateway, clicked_action: action } = input;
  const manageable = desktopGatewayCanManageService(gateway);
  const status = serviceStatus(gateway);
  const isPairAction = action.intent === 'pair_gateway';
  const isCatalogRefresh = action.intent === 'refresh_gateway_catalog';
  const pairingNeeded = needsPairing(gateway);

  if (input.active_progress) {
    return buildPanel({
      gateway,
      kind: 'none',
      execution_mode: 'progress',
      tone: 'primary',
      eyebrow: 'Running',
      title: input.active_progress.title || actionLabel(action.intent),
      detail: input.active_progress.detail || `Desktop is working on ${gateway.display_name}.`,
      aria_label: 'Gateway operation progress',
    });
  }

  if (input.retained_failure) {
    return buildPanel({
      gateway,
      kind: 'failure_recovery',
      execution_mode: 'attention',
      tone: 'error',
      eyebrow: 'Needs attention',
      title: input.retained_failure.title || `${actionLabel(action.intent)} failed`,
      detail: input.retained_failure.failure?.summary || input.retained_failure.detail || `Desktop could not complete this Gateway action.`,
      aria_label: 'Gateway action needs attention',
      continuation_action: continuationActionFor(
        gateway,
        gatewaySourceAction(needsPairing(gateway) ? 'pair_gateway' : 'refresh_gateway_catalog', 'Retry sync', 'default', true),
        serviceStatus(gateway) === 'not_started' ? 'start_if_needed' : undefined,
      ),
      primary_action: gatewaySourceAction(needsPairing(gateway) ? 'pair_gateway' : 'refresh_gateway_catalog', 'Retry sync', 'default', true),
      secondary_actions: [
        gatewayServiceAction('refresh_gateway_status', 'Refresh status', 'outline', true),
        gatewaySourceAction('manage_gateway', 'Manage', 'outline', true),
      ],
    });
  }

  if (action.intent === 'setup_gateway' || action.intent === 'manage_gateway') {
    return buildPanel({
      gateway,
      kind: 'none',
      execution_mode: 'direct',
      tone: 'neutral',
      eyebrow: 'Manage',
      title: 'Manage Gateway',
      detail: 'Review this Gateway configuration.',
      aria_label: 'Manage Gateway',
      primary_action: action as GatewaySourceActionModel,
    });
  }

  if (action.intent === 'resolve_gateway') {
    const syncState = gateway.sync_state ?? 'idle';
    const pairingFailure = syncState === 'pairing_failed' || gateway.status === 'trust_changed';
    const catalogFailure = syncState === 'catalog_failed';
    const unreachable = syncState === 'gateway_unreachable';
    return buildPanel({
      gateway,
      kind: 'resolve_before_pair',
      execution_mode: 'guide',
      tone: 'warning',
      eyebrow: 'Gateway',
      title: pairingFailure
        ? 'Gateway pairing needs attention'
        : catalogFailure
          ? 'Gateway catalog sync failed'
          : unreachable
            ? 'Gateway is unreachable'
            : 'Resolve Gateway',
      detail: compact(gateway.last_sync_error_message)
        || gateway.service_state?.message
        || gateway.status_message
        || 'Desktop keeps Gateways synced automatically. Review the target or retry sync when the Gateway is reachable.',
      aria_label: 'Resolve Gateway',
      resolve_focus: resolveFocusForGateway(gateway),
      continuation_action: continuationActionFor(
        gateway,
        gatewaySourceAction(pairingFailure ? 'pair_gateway' : 'refresh_gateway_catalog', 'Retry sync', 'default', true),
        serviceStatus(gateway) === 'not_started' ? 'start_if_needed' : undefined,
      ),
      primary_action: gatewaySourceAction(pairingFailure ? 'pair_gateway' : 'refresh_gateway_catalog', 'Retry sync', 'default', true),
      secondary_actions: [
        ...(manageable && (serviceStatus(gateway) === 'not_started' || serviceStatus(gateway) === 'service_needs_update')
          ? [gatewayServiceAction(
              serviceStatus(gateway) === 'service_needs_update' ? 'update_gateway' : 'start_gateway',
              serviceStatus(gateway) === 'service_needs_update' ? 'Update Gateway' : 'Start Gateway',
              'outline',
              true,
            )]
          : []),
        gatewayServiceAction('refresh_gateway_status', 'Refresh status', 'outline', true),
        gatewaySourceAction('manage_gateway', 'Manage', 'outline', true),
      ],
    });
  }

  if (action.intent === 'refresh_gateway_status') {
    return buildPanel({
      gateway,
      kind: 'refresh_status',
      execution_mode: 'direct',
      tone: 'neutral',
      eyebrow: 'Gateway status',
      title: 'Refresh Gateway status',
      detail: manageable
        ? 'Desktop will check Gateway service reachability, version, and management state without refreshing the catalog.'
        : 'Desktop will check whether this external Gateway endpoint is reachable without changing trust or catalog data.',
      aria_label: 'Refresh Gateway status',
      continuation_action: continuationActionFor(gateway, action),
      primary_action: gatewayServiceAction('refresh_gateway_status', 'Refresh status', 'default', action.enabled),
    });
  }

  if ((action.intent === 'stop_gateway' || action.intent === 'restart_gateway' || action.intent === 'update_gateway') && manageable) {
    const label = actionLabel(action.intent);
    const sessions = input.affected_sessions ?? [];
    return buildPanel({
      gateway,
      kind: confirmationPanelKind(action.intent),
      execution_mode: 'confirm',
      tone: sessions.length > 0 ? 'warning' : 'neutral',
      eyebrow: 'Gateway service',
      title: label,
      detail: sessions.length > 0
        ? `${sessions.length} environment session${sessions.length === 1 ? '' : 's'} opened through this Gateway will be disconnected.`
        : `Desktop will ${label.toLowerCase()} on the configured target.`,
      aria_label: label,
      affected_sessions: sessions,
      continuation_action: {
        kind: action.intent,
        gateway_id: gateway.gateway_id,
        impact_acknowledged: true,
      } as DesktopLauncherActionRequest,
      primary_action: gatewaySourceAction(action.intent, label, 'default', action.enabled),
      secondary_actions: [gatewaySourceAction('cancel_gateway_action', 'Cancel', 'outline', true)],
    });
  }

  if (isPairAction && gateway.connection_kind === 'url') {
    return buildPanel({
      gateway,
      kind: 'access_only_pair',
      execution_mode: 'guide',
      tone: 'primary',
      eyebrow: 'Gateway trust',
      title: gateway.trust_state === 'revoked' ? 'Review Gateway identity' : 'Retry Gateway pairing',
      detail: 'Desktop pairs URL Gateways automatically. Retry sync when the endpoint is reachable; Gateway service is managed on the Gateway host.',
      aria_label: 'Pair access-only Gateway',
      continuation_action: continuationActionFor(gateway, gatewaySourceAction('pair_gateway', 'Retry sync', 'default', action.enabled)),
      primary_action: gatewaySourceAction('pair_gateway', 'Retry sync', 'default', action.enabled),
      secondary_actions: [gatewaySourceAction('manage_gateway', 'Manage', 'outline', true)],
    });
  }

  if ((isPairAction || isCatalogRefresh) && manageable && status === 'not_started') {
    return buildPanel({
      gateway,
      kind: 'start_and_refresh_catalog',
      execution_mode: 'guide',
      tone: 'warning',
      eyebrow: 'Gateway service',
      title: 'Start Gateway to sync',
      detail: 'Desktop can start this Gateway service, then continue automatic pairing and catalog sync.',
      aria_label: 'Start Gateway before syncing catalog',
      continuation_action: continuationActionFor(
        gateway,
        gatewaySourceAction(isPairAction ? 'pair_gateway' : 'refresh_gateway_catalog', 'Retry sync', 'default', action.enabled),
        'start_if_needed',
      ),
      primary_action: gatewaySourceAction(isPairAction ? 'pair_gateway' : 'refresh_gateway_catalog', 'Retry sync', 'default', action.enabled),
      secondary_actions: [
        gatewaySourceAction('start_gateway', 'Start Gateway', 'outline', gateway.service_state?.can_start !== false),
        gatewaySourceAction('manage_gateway', 'Manage', 'outline', true),
      ],
    });
  }

  if (isPairAction && manageable && status === 'service_needs_update') {
    return buildPanel({
      gateway,
      kind: 'update_then_pair',
      execution_mode: 'guide',
      tone: 'warning',
      eyebrow: 'Gateway service',
      title: 'Update Gateway before pairing',
      detail: 'Desktop needs to update this Gateway service before it can safely pair and trust the catalog.',
      aria_label: 'Update Gateway before pairing',
      primary_action: gatewaySourceAction('update_gateway', 'Update Gateway', 'default', gateway.service_state?.can_update !== false),
      secondary_actions: [gatewaySourceAction('manage_gateway', 'Manage', 'outline', true)],
    });
  }

  if (isPairAction && manageable && (status === 'ssh_unreachable' || status === 'container_unavailable' || status === 'bridge_unavailable' || status === 'error')) {
    return buildPanel({
      gateway,
      kind: 'resolve_before_pair',
      execution_mode: 'guide',
      tone: 'warning',
      eyebrow: 'Gateway service',
      title: 'Resolve Gateway before pairing',
      detail: gateway.service_state?.message || 'Desktop needs a reachable Gateway service before it can pair.',
      aria_label: 'Resolve Gateway before pairing',
      resolve_focus: resolveFocusForGateway(gateway),
      primary_action: gatewaySourceAction('resolve_gateway', 'Resolve Gateway', 'default', true),
      secondary_actions: [gatewayServiceAction('refresh_gateway_status', 'Refresh status', 'outline', true)],
    });
  }

  if (isPairAction && pairingNeeded) {
    return buildPanel({
      gateway,
      kind: 'pair_ready',
      execution_mode: 'guide',
      tone: gateway.trust_state === 'revoked' || gateway.trust_state === 'trust_changed' ? 'warning' : 'primary',
      eyebrow: 'Gateway trust',
      title: gateway.trust_state === 'revoked' || gateway.trust_state === 'trust_changed' ? 'Review Gateway identity' : 'Retry Gateway pairing',
      detail: 'Desktop normally pairs Gateways automatically. Retry sync to verify the Gateway identity and refresh its environment catalog.',
      aria_label: 'Pair this Gateway',
      continuation_action: continuationActionFor(gateway, gatewaySourceAction('pair_gateway', 'Retry sync', 'default', action.enabled)),
      primary_action: gatewaySourceAction('pair_gateway', 'Retry sync', 'default', action.enabled),
      secondary_actions: [gatewaySourceAction('manage_gateway', 'Manage', 'outline', true)],
    });
  }

  if (isCatalogRefresh && manageable && status !== 'ready') {
    return buildPanel({
      gateway,
      kind: 'resolve_before_pair',
      execution_mode: 'guide',
      tone: 'warning',
      eyebrow: 'Gateway service',
      title: 'Gateway needs attention',
      detail: gateway.service_state?.message || 'Desktop needs this Gateway service ready before refreshing the catalog.',
      aria_label: 'Resolve Gateway before refreshing catalog',
      resolve_focus: resolveFocusForGateway(gateway),
      primary_action: gatewaySourceAction('resolve_gateway', 'Resolve Gateway', 'default', true),
      secondary_actions: [gatewayServiceAction('refresh_gateway_status', 'Refresh status', 'outline', true)],
    });
  }

  return buildPanel({
    gateway,
    kind: 'none',
    execution_mode: 'direct',
    tone: 'neutral',
    eyebrow: 'Gateway',
    title: actionLabel(action.intent),
    detail: `Desktop will run ${actionLabel(action.intent).toLowerCase()} for ${gateway.display_name}.`,
    aria_label: actionLabel(action.intent),
    continuation_action: continuationActionFor(gateway, action),
    primary_action: action as GatewaySourceActionModel,
  });
}
