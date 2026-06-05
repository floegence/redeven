import {
  desktopGatewayCanManageService,
  desktopGatewayConnectionKindLabel,
  type DesktopGatewayDiagnosisProbeResult,
  type DesktopGatewaySource,
} from '../shared/desktopGateway';
import type {
  DesktopLauncherActionProgress,
  DesktopLauncherActionRequest,
} from '../shared/desktopLauncherIPC';
import type { GatewaySourceActionModel } from './viewModel';

export type GatewayActionExecutionMode = 'direct' | 'guide' | 'confirm' | 'progress' | 'attention';

export type GatewayActionPanelKind =
  | 'none'
  | 'diagnosis_result'
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
  result_facts: [],
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
  result_facts: readonly GatewayActionPanelFact[];
  diagnostic_facts: readonly GatewayActionPanelFact[];
  affected_sessions: readonly GatewayActionAffectedSession[];
  overflow_session_count: number;
  continuation_action?: DesktopLauncherActionRequest;
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
    return { label: 'Catalog refresh', value: 'Refreshing', tone: 'warning' };
  }
  switch (gateway.sync_state ?? 'idle') {
    case 'catalog_failed':
    case 'gateway_unreachable':
    case 'pairing_failed':
      return { label: 'Catalog refresh', value: 'Failed', tone: 'error' };
    case 'ready':
      return { label: 'Catalog refresh', value: 'Ready' };
    default:
      return { label: 'Catalog refresh', value: 'Idle' };
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

function probeFactValue(probe: DesktopGatewayDiagnosisProbeResult): string {
  return compact(probe.detail) || probe.status;
}

function defaultDiagnosticFacts(gateway: DesktopGatewaySource): readonly GatewayActionPanelFact[] {
  const diagnosis = gateway.diagnosis;
  const probeFacts = diagnosis?.probe_results?.map((probe) => ({
    label: probe.label,
    value: probeFactValue(probe),
    tone: probe.status === 'passed'
      ? 'success' as const
      : probe.status === 'failed'
        ? 'error' as const
        : probe.status === 'warning'
          ? 'warning' as const
          : 'neutral' as const,
  })) ?? [];
  return [
    { label: 'Trust', value: trustStateLabel(gateway), tone: gateway.trust_state === 'paired' ? 'neutral' : 'warning' },
    { label: 'Transport', value: desktopGatewayConnectionKindLabel(gateway.connection_kind) },
    { label: 'Endpoint', value: compact(gateway.endpoint_label) || compact(gateway.gateway_url) || gateway.gateway_id },
    ...(diagnosis ? [{ label: 'Diagnosis', value: diagnosis.summary }] : []),
    ...(diagnosis?.detail ? [{ label: 'Detail', value: diagnosis.detail }] : []),
    ...probeFacts,
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
): DesktopLauncherActionRequest | undefined {
  switch (action.intent) {
    case 'refresh_gateway':
      return {
        kind: 'refresh_gateway',
        gateway_id: gateway.gateway_id,
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
    case 'pairing_required':
      return 'Gateway pairing required';
    case 'identity_changed':
      return 'Gateway identity changed';
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

function probeResultFactValue(probe: DesktopGatewayDiagnosisProbeResult): string {
  switch (probe.id) {
    case 'gateway_service':
      switch (probe.status) {
        case 'passed':
          return 'Ready';
        case 'warning':
          return 'Review required';
        case 'failed':
          return 'Not ready';
        case 'skipped':
          return 'Skipped';
        default:
          return 'Unknown';
      }
    case 'gateway_version':
      switch (probe.status) {
        case 'passed':
          return 'Supported';
        case 'warning':
          return 'Update required';
        case 'failed':
          return 'Failed';
        case 'skipped':
          return 'Skipped';
        default:
          return 'Unknown';
      }
    case 'gateway_trust':
      switch (probe.status) {
        case 'passed':
          return 'Verified';
        case 'warning':
          return 'Review required';
        case 'failed':
          return 'Failed';
        case 'skipped':
          return 'Skipped';
        default:
          return 'Unknown';
      }
    case 'gateway_catalog':
      switch (probe.status) {
        case 'passed':
          return 'Reachable';
        case 'warning':
          return 'Review required';
        case 'failed':
          return 'Failed';
        case 'skipped':
          return 'Skipped';
        default:
          return 'Unknown';
      }
  }
}

function probeResultFactTone(status: string): GatewayActionPanelFact['tone'] {
  switch (status) {
    case 'passed':
      return 'success';
    case 'failed':
      return 'error';
    case 'warning':
      return 'warning';
    default:
      return 'neutral';
  }
}

function gatewayDiagnosisResultFacts(gateway: DesktopGatewaySource): readonly GatewayActionPanelFact[] {
  const diagnosis = gateway.diagnosis;
  const probeResults = diagnosis?.probe_results ?? [];
  if (probeResults.length > 0) {
    const preferred = diagnosis?.classification === 'ready'
      ? probeResults.filter((probe) => probe.status === 'passed').slice(0, 3)
      : probeResults.filter((probe) => probe.status === 'failed' || probe.status === 'warning').slice(0, 3);
    const visible = preferred.length > 0
      ? preferred
      : probeResults.filter((probe) => probe.status === 'unknown' || probe.status === 'skipped').slice(0, 3);
    return visible.map((probe) => ({
      label: probe.label,
      value: probeResultFactValue(probe),
      tone: probeResultFactTone(probe.status),
    }));
  }
  return defaultStatusFacts(gateway).slice(0, 2);
}

type GatewayRecoveryPlan = Readonly<{
  title: string;
  detail: string;
  aria_label: string;
  primary_action?: GatewaySourceActionModel;
  continuation_action?: DesktopLauncherActionRequest;
}>;

function gatewayRecoveryPlanFromRecommendedRecovery(
  gateway: DesktopGatewaySource,
): GatewayRecoveryPlan | undefined {
  const diagnosis = gateway.diagnosis;
  switch (diagnosis?.recommended_recovery) {
    case 'start_gateway': {
      const startAction = gatewaySourceAction('start_gateway', 'Start Gateway', 'default', gateway.service_state?.can_start !== false);
      return {
        title: 'Gateway is stopped',
        detail: 'Desktop can start this Gateway service. Use Refresh again after it is ready to refresh environments.',
        aria_label: 'Start Gateway service',
        primary_action: startAction,
        continuation_action: continuationActionFor(gateway, startAction),
      };
    }
    case 'restart_gateway': {
      const restartAction = gatewaySourceAction('restart_gateway', 'Restart Gateway', 'default', gateway.service_state?.can_restart !== false);
      return {
        title: 'Gateway service needs restart',
        detail: 'Desktop can restart this Gateway service, then Refresh can retry pairing and catalog refresh.',
        aria_label: 'Restart Gateway service',
        primary_action: restartAction,
        continuation_action: continuationActionFor(gateway, restartAction),
      };
    }
    case 'update_gateway': {
      const updateAction = gatewaySourceAction('update_gateway', 'Update Gateway', 'default', gateway.service_state?.can_update !== false);
      return {
        title: 'Gateway update required',
        detail: 'Desktop needs to update this Gateway service before Refresh can safely pair and refresh the catalog.',
        aria_label: 'Update Gateway before refreshing',
        primary_action: updateAction,
        continuation_action: continuationActionFor(gateway, updateAction),
      };
    }
    default:
      return undefined;
  }
}

function gatewayRefreshRecoveryPlan(
  gateway: DesktopGatewaySource,
  options: Readonly<{ useDiagnosis?: boolean }> = {},
): GatewayRecoveryPlan {
  if (gateway.local_enabled === false) {
    const enableAction = gatewaySourceAction('enable_gateway', 'Enable Gateway', 'default', true);
    return {
      title: 'Gateway disabled on this Desktop',
      detail: 'This Desktop is not refreshing this Gateway or showing its environments. Enable it to refresh again.',
      aria_label: 'Enable Gateway',
      primary_action: enableAction,
      continuation_action: continuationActionFor(gateway, enableAction),
    };
  }

  const diagnosis = options.useDiagnosis ? gateway.diagnosis : undefined;
  if (!diagnosis) {
    return {
      title: 'Refresh Gateway',
      detail: 'Refresh checks the target, Gateway service, package, pairing, and catalog in one operation.',
      aria_label: 'Refresh Gateway',
    };
  }

  if (!diagnosis.manageable) {
    return {
      title: gatewayDiagnosisTitle(gateway),
      detail: 'Desktop cannot manage this Gateway. Review the diagnostics and fix it on the Gateway host.',
      aria_label: 'Gateway diagnostics',
    };
  }

  const recommendedRecovery = gatewayRecoveryPlanFromRecommendedRecovery(gateway);
  if (recommendedRecovery) {
    return recommendedRecovery;
  }

  switch (diagnosis.classification) {
    case 'not_started': {
      const startAction = gatewaySourceAction('start_gateway', 'Start Gateway', 'default', true);
      return {
        title: 'Gateway is stopped',
        detail: 'Desktop can start this Gateway service. Use Refresh again after it is ready to refresh environments.',
        aria_label: 'Start Gateway service',
        primary_action: startAction,
        continuation_action: continuationActionFor(gateway, startAction),
      };
    }
    case 'bridge_unavailable': {
      const restartAction = gatewaySourceAction('restart_gateway', 'Restart Gateway', 'default', gateway.service_state?.can_restart !== false);
      return {
        title: 'Gateway service needs restart',
        detail: 'Desktop can restart this Gateway service, then Refresh can retry pairing and catalog refresh.',
        aria_label: 'Restart Gateway service',
        primary_action: restartAction,
        continuation_action: continuationActionFor(gateway, restartAction),
      };
    }
    case 'needs_update': {
      const updateAction = gatewaySourceAction('update_gateway', 'Update Gateway', 'default', gateway.service_state?.can_update !== false);
      return {
        title: 'Gateway update required',
        detail: 'Desktop needs to update this Gateway service before Refresh can safely pair and refresh the catalog.',
        aria_label: 'Update Gateway before refreshing',
        primary_action: updateAction,
        continuation_action: continuationActionFor(gateway, updateAction),
      };
    }
    case 'ssh_unreachable':
    case 'container_unavailable':
    case 'unknown':
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: diagnosis.detail || 'Desktop needs a reachable Gateway target before Refresh can continue.',
        aria_label: 'Gateway diagnostics',
      };
    case 'catalog_failed':
    case 'service_ready_catalog_failed':
    case 'trust_failed':
    case 'pairing_required':
    case 'identity_changed':
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: diagnosis.detail || 'Refresh could not complete pairing or catalog refresh. Review the diagnostics, then run Refresh again after the target is corrected.',
        aria_label: 'Gateway diagnostics',
      };
    case 'legacy_runtime_residue': {
      const updateAction = gatewaySourceAction('update_gateway', 'Update Gateway', 'default', gateway.service_state?.can_update !== false);
      return {
        title: 'Gateway update required',
        detail: 'Desktop found old Gateway service residue on the target. Update Gateway to reinstall the service and clean the stale Desktop-managed service before refreshing.',
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
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Desktop refreshed this Gateway and can reach its catalog.',
        aria_label: 'Gateway refreshed',
      };
    }
    case 'disabled':
      return {
        title: gatewayDiagnosisTitle(gateway),
        detail: 'Enable this Gateway before refreshing it.',
        aria_label: 'Gateway diagnostics',
      };
  }
}

function buildPanel(
  input: Omit<GatewayActionPanelModel, 'facts' | 'status_facts' | 'result_facts' | 'diagnostic_facts' | 'affected_sessions' | 'overflow_session_count' | 'secondary_actions'>
  & Readonly<{
    gateway: DesktopGatewaySource;
    facts?: readonly GatewayActionPanelFact[];
    status_facts?: readonly GatewayActionPanelFact[];
    result_facts?: readonly GatewayActionPanelFact[];
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
    result_facts: input.result_facts ?? [],
    diagnostic_facts: diagnosticFacts,
    affected_sessions: visibleSessions,
    overflow_session_count: Math.max(0, sessions.length - visibleSessions.length),
    ...(input.continuation_action ? { continuation_action: input.continuation_action } : {}),
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
    case 'refresh_gateway':
      return 'Refresh Gateway';
    case 'stop_gateway':
      return 'Stop Gateway';
    case 'restart_gateway':
      return 'Restart Gateway';
    case 'update_gateway':
      return 'Update Gateway';
    default:
      return 'Gateway action';
  }
}

export function buildGatewayActionPresentation(
  input: BuildGatewayActionPresentationInput,
): GatewayActionPanelModel {
  const { gateway, clicked_action: action } = input;
  const manageable = desktopGatewayCanManageService(gateway);

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
    const recovery = gatewayRefreshRecoveryPlan(gateway, {
      useDiagnosis: action.intent === 'refresh_gateway' || input.retained_failure.action === 'refresh_gateway',
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
      ...(recovery.continuation_action ? { continuation_action: recovery.continuation_action } : {}),
      ...(recovery.primary_action ? { primary_action: recovery.primary_action } : {}),
    });
  }

  if (action.intent === 'setup_gateway') {
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
      detail: 'This Desktop is not refreshing this Gateway or showing its environments. Enable it to refresh again.',
      aria_label: 'Enable Gateway',
      continuation_action: continuationActionFor(gateway, gatewaySourceAction('enable_gateway', 'Enable Gateway', 'default', true)),
      primary_action: gatewaySourceAction('enable_gateway', 'Enable Gateway', 'default', true),
    });
  }

  if (action.intent === 'refresh_gateway') {
    const recovery = gatewayRefreshRecoveryPlan(gateway, {
      useDiagnosis: input.show_diagnosis_result === true,
    });
    return buildPanel({
      gateway,
      kind: 'diagnosis_result',
      execution_mode: 'guide',
      tone: recovery.primary_action?.intent === 'start_gateway'
        || recovery.primary_action?.intent === 'restart_gateway'
        || recovery.primary_action?.intent === 'update_gateway'
        || gateway.sync_state === 'catalog_failed'
        || gateway.sync_state === 'gateway_unreachable'
        ? 'warning'
        : 'primary',
      eyebrow: recovery.primary_action ? 'Gateway service' : 'Gateway',
      title: recovery.title,
      detail: recovery.detail,
      aria_label: recovery.aria_label,
      result_facts: input.show_diagnosis_result === true ? gatewayDiagnosisResultFacts(gateway) : [],
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
