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

export type GatewayActionExecutionMode = 'direct' | 'guide' | 'confirm' | 'progress' | 'attention';

export type GatewayActionPanelKind =
  | 'none'
  | 'check_required'
  | 'diagnosis_result'
  | 'pair_ready'
  | 'start_and_pair'
  | 'update_then_pair'
  | 'resolve_before_pair'
  | 'disabled_gateway'
  | 'start_gateway'
  | 'stop_gateway_confirm'
  | 'restart_gateway_confirm'
  | 'update_gateway_confirm'
  | 'start_and_refresh_catalog'
  | 'failure_recovery';

const noGatewayActionPanel: GatewayActionPanelModel = {
  kind: 'none',
  execution_mode: 'direct',
  tone: 'neutral',
  eyebrow: '',
  title: '',
  detail: '',
  aria_label: '',
  facts: [],
  status_facts: [],
  diagnostic_facts: [],
  affected_sessions: [],
  overflow_session_count: 0,
  secondary_actions: [],
};

export type GatewayActionPanelFact = Readonly<{
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
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
  clicked_action: GatewaySourceActionModel;
  active_progress?: DesktopLauncherActionProgress | null;
  retained_failure?: DesktopLauncherActionProgress | null;
  affected_sessions?: readonly GatewayActionAffectedSession[];
  show_diagnosis_result?: boolean;
}>;

function gatewaySourceAction(
  intent: GatewaySourceActionModel['intent'],
  label: string,
  variant: GatewaySourceActionModel['variant'] = 'outline',
  enabled = true,
): GatewaySourceActionModel {
  return { intent, label, variant, enabled };
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
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
      return 'Gateway issue';
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
  if (gateway.background_sync_running === true) {
    return { label: 'Catalog sync', value: 'Syncing', tone: 'warning' };
  }
  switch (gateway.sync_state ?? 'idle') {
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
  const diagnosis = gateway.diagnosis;
  return [
    { label: 'Trust', value: trustStateLabel(gateway), tone: gateway.trust_state === 'paired' ? 'neutral' : 'warning' },
    { label: 'Transport', value: desktopGatewayConnectionKindLabel(gateway.connection_kind) },
    { label: 'Endpoint', value: compact(gateway.endpoint_label) || compact(gateway.gateway_url) || gateway.gateway_id },
    ...(diagnosis ? [{ label: 'Diagnosis', value: diagnosis.summary }] : []),
    ...(diagnosis?.detail ? [{ label: 'Detail', value: diagnosis.detail }] : []),
    ...(diagnosis?.error_code ? [{ label: 'Error code', value: diagnosis.error_code }] : []),
    ...(diagnosis?.error_message ? [{ label: 'Error message', value: diagnosis.error_message, tone: 'error' as const }] : []),
    ...(diagnosis?.managed_probe?.facts ?? []),
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
    case 'check_gateway':
      return {
        kind: 'check_gateway',
        gateway_id: gateway.gateway_id,
      };
    case 'sync_gateway':
    case 'pair_gateway':
    case 'refresh_gateway_catalog':
    case 'refresh_gateway_status':
      return {
        kind: 'sync_gateway',
        gateway_id: gateway.gateway_id,
        ...(startPolicy
          ? { start_policy: startPolicy }
          : {}),
      };
    case 'start_gateway':
      return {
        kind: 'start_gateway',
        gateway_id: gateway.gateway_id,
      };
    case 'enable_gateway':
      return {
        kind: 'set_gateway_enabled',
        gateway_id: gateway.gateway_id,
        enabled: true,
      };
    case 'disable_gateway':
      return {
        kind: 'set_gateway_enabled',
        gateway_id: gateway.gateway_id,
        enabled: false,
      };
    case 'stop_gateway':
    case 'restart_gateway':
    case 'update_gateway':
      return {
        kind: action.intent,
        gateway_id: gateway.gateway_id,
        ...((action.intent === 'update_gateway' || action.intent === 'restart_gateway' || action.intent === 'stop_gateway')
          ? { impact_acknowledged: true }
          : {}),
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

function gatewayResolveAction(): GatewaySourceActionModel {
  return gatewaySourceAction('resolve_gateway', 'Resolve Gateway', 'default', true);
}

function gatewayEditSettingsAction(): GatewaySourceActionModel {
  return gatewaySourceAction('resolve_gateway', 'Edit Gateway Settings', 'default', true);
}

function gatewayReviewTrustAction(): GatewaySourceActionModel {
  return gatewaySourceAction('resolve_gateway', 'Review Trust', 'default', true);
}

function gatewayDiagnosisTitle(gateway: DesktopGatewaySource): string {
  const diagnosis = gateway.diagnosis;
  switch (diagnosis?.classification) {
    case 'disabled':
      return 'Gateway sync is paused';
    case 'ready':
      return 'Gateway is ready';
    case 'not_started':
      return diagnosis.manageable ? 'Gateway is stopped' : 'External Gateway endpoint';
    case 'needs_update':
      return diagnosis.manageable ? 'Gateway update required' : 'Gateway protocol check failed';
    case 'ssh_unreachable':
    case 'container_unavailable':
    case 'bridge_unavailable':
    case 'unknown':
      return diagnosis.manageable ? 'Gateway target needs review' : 'External Gateway endpoint';
    case 'trust_failed':
      return 'Gateway trust check failed';
    case 'catalog_failed':
      return 'Gateway catalog check failed';
    case 'service_ready_catalog_failed':
      return 'Gateway catalog check failed';
    case 'legacy_runtime_residue':
      return 'Gateway update required';
    case 'unmanageable':
      return 'External Gateway endpoint';
    default:
      return 'Gateway diagnostics';
  }
}

type GatewayRecoveryPlan = Readonly<{
  title: string;
  detail: string;
  aria_label: string;
  primary_action?: GatewaySourceActionModel;
  continuation_action?: DesktopLauncherActionRequest;
  resolve_focus?: DesktopGatewayResolveFocus;
}>;

function gatewaySyncRecoveryPlan(
  gateway: DesktopGatewaySource,
  fallbackActionEnabled = true,
  options: Readonly<{ useDiagnosis?: boolean }> = {},
): GatewayRecoveryPlan {
  if (gateway.local_enabled === false) {
    const enableAction = gatewaySourceAction('enable_gateway', 'Enable Gateway', 'default', true);
    return {
      title: 'Gateway disabled on this Desktop',
      detail: 'This Desktop is not syncing this Gateway or showing its environments. Enable it to sync again.',
      aria_label: 'Enable Gateway',
      primary_action: enableAction,
      continuation_action: continuationActionFor(gateway, enableAction),
    };
  }

  const diagnosis = options.useDiagnosis ? gateway.diagnosis : undefined;
  const checkAction = gatewaySourceAction('check_gateway', 'Check Gateway', 'default', fallbackActionEnabled);
  if (!diagnosis) {
    return {
      title: 'Gateway sync failed',
      detail: 'Run a check to identify whether this Gateway needs to start, update, or change configuration.',
      aria_label: 'Check Gateway',
      primary_action: checkAction,
      continuation_action: continuationActionFor(gateway, checkAction),
    };
  }

  if (!diagnosis.manageable) {
    return {
      title: gatewayDiagnosisTitle(gateway),
      detail: 'Desktop cannot manage this Gateway. Review the diagnostics and fix it on the Gateway host.',
      aria_label: 'Gateway diagnostics',
      resolve_focus: resolveFocusForGateway(gateway),
    };
  }

  switch (diagnosis.classification) {
    case 'not_started': {
      const startAction = gatewaySourceAction('start_gateway', 'Start Gateway', 'default', true);
      return {
        title: 'Gateway is stopped',
        detail: 'Desktop can start this Gateway service. Sync the Gateway after it is ready to refresh environments.',
        aria_label: 'Start Gateway service',
        primary_action: startAction,
        continuation_action: continuationActionFor(gateway, startAction),
      };
    }
    case 'needs_update': {
      const updateAction = gatewaySourceAction('update_gateway', 'Update Gateway', 'default', gateway.service_state?.can_update !== false);
      return {
        title: 'Gateway update required',
        detail: 'Desktop needs to update this Gateway service before it can safely pair and trust the catalog.',
        aria_label: 'Update Gateway before syncing',
        primary_action: updateAction,
        continuation_action: continuationActionFor(gateway, updateAction),
      };
    }
    case 'ssh_unreachable':
    case 'container_unavailable':
    case 'bridge_unavailable':
    case 'unknown': {
      const resolveAction = gatewayEditSettingsAction();
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Desktop needs a reachable Gateway service before it can sync environments.',
        aria_label: 'Resolve Gateway before syncing',
        primary_action: resolveAction,
        resolve_focus: resolveFocusForGateway(gateway),
      };
    }
    case 'trust_failed': {
      const reviewAction = gatewayReviewTrustAction();
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Desktop could not verify this Gateway identity. Review the Gateway target, then sync this Gateway again.',
        aria_label: 'Review Gateway identity',
        primary_action: reviewAction,
        resolve_focus: 'identity_trust',
      };
    }
    case 'catalog_failed': {
      if (!diagnosis.manageable) {
        return {
          title: gatewayDiagnosisTitle(gateway),
          detail: 'Desktop cannot manage this Gateway. Review the diagnostics and fix it on the Gateway host.',
          aria_label: 'Gateway diagnostics',
        };
      }
      const syncAction = gatewaySourceAction('sync_gateway', 'Sync Gateway', 'default', fallbackActionEnabled);
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Desktop can reach the Gateway service, but catalog sync still failed.',
        aria_label: 'Sync Gateway',
        primary_action: syncAction,
        continuation_action: continuationActionFor(gateway, syncAction),
      };
    }
    case 'service_ready_catalog_failed': {
      const syncAction = gatewaySourceAction('sync_gateway', 'Sync Gateway', 'default', fallbackActionEnabled);
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Desktop can reach the Gateway service, but the signed catalog check failed. Run sync again after reviewing diagnostics.',
        aria_label: 'Sync Gateway',
        primary_action: syncAction,
        continuation_action: continuationActionFor(gateway, syncAction),
      };
    }
    case 'legacy_runtime_residue': {
      const updateAction = gatewaySourceAction('update_gateway', 'Update Gateway', 'default', gateway.service_state?.can_update !== false);
      return {
        title: 'Gateway update required',
        detail: 'Desktop found old Gateway service residue on the target. Update Gateway to reinstall the service and clean the stale Desktop-managed service before syncing.',
        aria_label: 'Update Gateway and clean legacy residue',
        primary_action: updateAction,
        continuation_action: continuationActionFor(gateway, updateAction),
      };
    }
    case 'unmanageable':
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Desktop cannot manage this Gateway. Review the diagnostics and fix it on the Gateway host.',
        aria_label: 'Gateway diagnostics',
      };
    case 'ready': {
      const syncAction = gatewaySourceAction('sync_gateway', 'Sync Gateway', 'default', fallbackActionEnabled);
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Desktop can reach this Gateway. Run sync to refresh environments.',
        aria_label: 'Sync Gateway',
        primary_action: syncAction,
        continuation_action: continuationActionFor(gateway, syncAction),
      };
    }
    case 'disabled':
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Enable this Gateway before syncing it.',
        aria_label: 'Gateway diagnostics',
      };
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
    case 'sync_gateway':
    case 'refresh_gateway_catalog':
    case 'pair_gateway':
      return 'Sync Gateway';
    case 'check_gateway':
      return 'Check Gateway';
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
  const hasSyncFailure = gateway.sync_state === 'catalog_failed'
    || gateway.sync_state === 'gateway_unreachable'
    || gateway.sync_state === 'pairing_failed';
  const isSyncLikeAction = action.intent === 'sync_gateway'
    || action.intent === 'pair_gateway'
    || action.intent === 'refresh_gateway_catalog'
    || action.intent === 'refresh_gateway_status'
    || action.intent === 'check_gateway'
    || (action.intent === 'resolve_gateway' && hasSyncFailure);

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
    const recovery = gatewaySyncRecoveryPlan(gateway, true, {
      useDiagnosis: action.intent === 'check_gateway' || input.retained_failure.action === 'check_gateway',
    });
    return buildPanel({
      gateway,
      kind: 'failure_recovery',
      execution_mode: 'attention',
      tone: 'error',
      eyebrow: 'Gateway issue',
      title: recovery.title || input.retained_failure.title || `${actionLabel(action.intent)} failed`,
      detail: recovery.detail || input.retained_failure.failure?.summary || input.retained_failure.detail || `Desktop could not complete this Gateway action.`,
      aria_label: recovery.aria_label || 'Gateway action issue',
      ...(recovery.resolve_focus ? { resolve_focus: recovery.resolve_focus } : {}),
      ...(recovery.continuation_action ? { continuation_action: recovery.continuation_action } : {}),
      ...(recovery.primary_action ? { primary_action: recovery.primary_action } : {}),
    });
  }

  if (action.intent === 'setup_gateway' || action.intent === 'manage_gateway') {
    return noGatewayActionPanel;
  }

  if (gateway.local_enabled === false || action.intent === 'enable_gateway') {
    return buildPanel({
      gateway,
      kind: 'disabled_gateway',
      execution_mode: 'guide',
      tone: 'neutral',
      eyebrow: 'Gateway',
      title: 'Gateway disabled on this Desktop',
      detail: 'This Desktop is not syncing this Gateway or showing its environments. Enable it to sync again.',
      aria_label: 'Enable Gateway',
      continuation_action: continuationActionFor(gateway, gatewaySourceAction('enable_gateway', 'Enable Gateway', 'default', true)),
      primary_action: gatewaySourceAction('enable_gateway', 'Enable Gateway', 'default', true),
    });
  }

  if ((action.intent === 'pair_gateway' || action.intent === 'resolve_gateway') && manageable && status === 'service_needs_update') {
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
    });
  }

  if ((action.intent === 'pair_gateway' || action.intent === 'resolve_gateway') && manageable && (status === 'ssh_unreachable' || status === 'container_unavailable' || status === 'bridge_unavailable' || status === 'error')) {
    const resolveAction = gatewayResolveAction();
    return buildPanel({
      gateway,
      kind: 'resolve_before_pair',
      execution_mode: 'guide',
      tone: 'warning',
      eyebrow: 'Gateway service',
      title: 'Resolve Gateway before syncing',
      detail: gateway.service_state?.message || 'Desktop needs a reachable Gateway service before it can sync environments.',
      aria_label: 'Resolve Gateway before syncing',
      resolve_focus: resolveFocusForGateway(gateway),
      primary_action: resolveAction,
    });
  }

  if (isSyncLikeAction) {
    const recovery = gatewaySyncRecoveryPlan(gateway, action.enabled, {
      useDiagnosis: action.intent === 'check_gateway' && input.show_diagnosis_result === true,
    });
    return buildPanel({
      gateway,
      kind: recovery.primary_action?.intent === 'check_gateway'
        ? 'check_required'
        : recovery.primary_action?.intent === 'start_gateway'
          ? 'start_and_refresh_catalog'
          : 'diagnosis_result',
      execution_mode: 'guide',
      tone: recovery.primary_action?.intent === 'check_gateway'
        || recovery.primary_action?.intent === 'start_gateway'
        || gateway.sync_state === 'catalog_failed'
        || gateway.sync_state === 'gateway_unreachable'
        ? 'warning'
        : 'primary',
      eyebrow: recovery.primary_action?.intent === 'start_gateway' || recovery.primary_action?.intent === 'update_gateway' ? 'Gateway service' : 'Gateway',
      title: recovery.title,
      detail: recovery.detail,
      aria_label: recovery.aria_label,
      ...(recovery.resolve_focus ? { resolve_focus: recovery.resolve_focus } : {}),
      ...(recovery.continuation_action ? { continuation_action: recovery.continuation_action } : {}),
      ...(recovery.primary_action ? { primary_action: recovery.primary_action } : {}),
    });
  }

  if (action.intent === 'resolve_gateway') {
    const recovery = gatewaySyncRecoveryPlan(gateway);
    return buildPanel({
      gateway,
      kind: 'resolve_before_pair',
      execution_mode: 'guide',
      tone: 'warning',
      eyebrow: 'Gateway',
      title: recovery.title === 'Sync Gateway' ? 'Resolve Gateway' : recovery.title,
      detail: compact(gateway.last_sync_error_message)
        || gateway.service_state?.message
        || gateway.status_message
        || recovery.detail
        || 'Desktop keeps Gateways synced automatically. Review the target, then sync again when the Gateway is reachable.',
      aria_label: recovery.aria_label || 'Resolve Gateway',
      ...(recovery.resolve_focus ? { resolve_focus: recovery.resolve_focus } : {}),
      ...(recovery.continuation_action ? { continuation_action: recovery.continuation_action } : {}),
      ...(recovery.primary_action ? { primary_action: recovery.primary_action } : {}),
    });
  }

  if ((action.intent === 'stop_gateway' || action.intent === 'restart_gateway' || action.intent === 'update_gateway') && manageable && (input.affected_sessions?.length ?? 0) > 0) {
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
