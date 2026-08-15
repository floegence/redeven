import type { I18nHelpers } from '../i18n';
import type { AIReadinessSnapshot } from './aiReadiness';

export type AIReadinessAction = 'retry' | 'open_update' | 'open_permissions' | 'review_issues' | 'show_diagnostics';

export type AIReadinessDiagnosticRow = Readonly<{
  label: string;
  value: string;
}>;

export type AIReadinessPresentation = Readonly<{
  mode: 'busy' | 'blocked' | 'degraded' | 'ready';
  tone: 'neutral' | 'warning' | 'danger';
  title: string;
  description: string;
  dataStatement: string;
  primaryAction?: AIReadinessAction;
  secondaryAction?: AIReadinessAction;
  diagnosticRows: readonly AIReadinessDiagnosticRow[];
  diagnosticText: string;
}>;

type TranslationKey = Parameters<I18nHelpers['t']>[0];

function text(i18n: I18nHelpers, key: TranslationKey): string {
  return i18n.t(key);
}

function diagnosticStatus(snapshot: AIReadinessSnapshot, i18n: I18nHelpers): string {
  if (snapshot.state === 'ready') return text(i18n, 'aiReadiness.diagnostics.statusReady');
  if (snapshot.state === 'degraded') return text(i18n, 'aiReadiness.diagnostics.statusDegraded');
  if (snapshot.state === 'blocked') return text(i18n, 'aiReadiness.diagnostics.statusBlocked');
  return text(i18n, 'aiReadiness.diagnostics.statusChecking');
}

function diagnosticRows(snapshot: AIReadinessSnapshot, i18n: I18nHelpers): readonly AIReadinessDiagnosticRow[] {
  const yes = text(i18n, 'aiReadiness.diagnostics.yes');
  const no = text(i18n, 'aiReadiness.diagnostics.no');
  return [
    { label: text(i18n, 'aiReadiness.diagnostics.owner'), value: text(i18n, 'aiReadiness.diagnostics.ownerFloret') },
    { label: text(i18n, 'aiReadiness.diagnostics.status'), value: diagnosticStatus(snapshot, i18n) },
    { label: text(i18n, 'aiReadiness.diagnostics.retry'), value: snapshot.retryable && snapshot.safe_to_retry ? yes : no },
    { label: text(i18n, 'aiReadiness.diagnostics.committed'), value: snapshot.committed ? yes : no },
    { label: text(i18n, 'aiReadiness.diagnostics.rolledBack'), value: snapshot.rolled_back ? yes : no },
    ...(snapshot.state === 'degraded'
      ? [{ label: text(i18n, 'aiReadiness.diagnostics.issueCount'), value: String(snapshot.issue_count ?? 0) }]
      : []),
  ];
}

function presentationActions(
  snapshot: AIReadinessSnapshot,
  canRetryGeneration: boolean,
): Readonly<{ primaryAction?: AIReadinessAction; secondaryAction?: AIReadinessAction }> {
  if (snapshot.state !== 'blocked') return {};
  const canRetry = canRetryGeneration && snapshot.retryable && snapshot.safe_to_retry;
  switch (snapshot.reason_code) {
    case 'temporarily_blocked':
      return canRetry
        ? { primaryAction: 'retry', secondaryAction: 'show_diagnostics' }
        : { primaryAction: 'show_diagnostics' };
    case 'update_required':
      return { primaryAction: 'open_update', secondaryAction: 'show_diagnostics' };
    case 'environment_permission_error':
      return { primaryAction: 'open_permissions', secondaryAction: 'show_diagnostics' };
    case 'unsupported_store':
    case 'store_integrity_error':
    case 'post_commit_verification_error':
      return canRetry
        ? { primaryAction: 'show_diagnostics', secondaryAction: 'retry' }
        : { primaryAction: 'show_diagnostics' };
    case 'store_io_error':
    case 'migration_rolled_back':
      return canRetry
        ? { primaryAction: 'retry', secondaryAction: 'show_diagnostics' }
        : { primaryAction: 'show_diagnostics' };
    default:
      return canRetry
        ? { primaryAction: 'show_diagnostics', secondaryAction: 'retry' }
        : { primaryAction: 'show_diagnostics' };
  }
}

function stateCopy(snapshot: AIReadinessSnapshot): Readonly<{
  title: TranslationKey;
  description: TranslationKey;
  tone: AIReadinessPresentation['tone'];
}> {
  if (snapshot.state === 'degraded') {
    return { title: 'aiReadiness.states.degradedTitle', description: 'aiReadiness.states.degradedDescription', tone: 'warning' };
  }
  if (snapshot.state !== 'blocked') {
    switch (snapshot.state) {
      case 'inspecting':
        return { title: 'aiReadiness.states.inspectingTitle', description: 'aiReadiness.states.inspectingDescription', tone: 'neutral' };
      case 'migrating':
        return { title: 'aiReadiness.states.migratingTitle', description: 'aiReadiness.states.migratingDescription', tone: 'neutral' };
      case 'verifying':
        return { title: 'aiReadiness.states.verifyingTitle', description: 'aiReadiness.states.verifyingDescription', tone: 'neutral' };
      case 'recovering':
        return { title: 'aiReadiness.states.busyTitle', description: 'aiReadiness.states.busyDescription', tone: 'neutral' };
      case 'ready':
        return { title: 'common.status.ready', description: 'aiReadiness.data.unopened', tone: 'neutral' };
      case 'unavailable':
      default:
        return { title: 'aiReadiness.states.unavailableTitle', description: 'aiReadiness.states.unavailableDescription', tone: 'neutral' };
    }
  }

  switch (snapshot.reason_code) {
    case 'temporarily_blocked':
      return { title: 'aiReadiness.states.busyTitle', description: 'aiReadiness.states.busyDescription', tone: 'warning' };
    case 'update_required':
      return { title: 'aiReadiness.states.updateRequiredTitle', description: 'aiReadiness.states.updateRequiredDescription', tone: 'warning' };
    case 'unsupported_store':
      return { title: 'aiReadiness.states.unsupportedTitle', description: 'aiReadiness.states.unsupportedDescription', tone: 'danger' };
    case 'store_integrity_error':
      return { title: 'aiReadiness.states.integrityTitle', description: 'aiReadiness.states.integrityDescription', tone: 'danger' };
    case 'environment_permission_error':
      return { title: 'aiReadiness.states.permissionTitle', description: 'aiReadiness.states.permissionDescription', tone: 'warning' };
    case 'store_io_error':
      return { title: 'aiReadiness.states.ioTitle', description: 'aiReadiness.states.ioDescription', tone: 'danger' };
    case 'configuration_error':
      return { title: 'aiReadiness.states.configurationTitle', description: 'aiReadiness.states.configurationDescription', tone: 'danger' };
    case 'migration_rolled_back':
      return { title: 'aiReadiness.states.rollbackTitle', description: 'aiReadiness.states.rollbackDescription', tone: 'warning' };
    case 'post_commit_verification_error':
      return { title: 'aiReadiness.states.committedTitle', description: 'aiReadiness.states.committedDescription', tone: 'danger' };
    case 'cancelled':
      return { title: 'aiReadiness.states.cancelledTitle', description: 'aiReadiness.states.cancelledDescription', tone: 'warning' };
    case 'ai_service_startup_error':
      return { title: 'aiReadiness.states.startupTitle', description: 'aiReadiness.states.startupDescription', tone: 'danger' };
    case 'contract_error':
    case 'ai_readiness_contract_error':
    default:
      return { title: 'aiReadiness.states.contractTitle', description: 'aiReadiness.states.contractDescription', tone: 'danger' };
  }
}

function dataStatement(snapshot: AIReadinessSnapshot, i18n: I18nHelpers): string {
  if (snapshot.rolled_back) return text(i18n, 'aiReadiness.data.rolledBack');
  if (snapshot.committed) return text(i18n, 'aiReadiness.data.committed');
  if (snapshot.state === 'degraded') return text(i18n, 'aiReadiness.data.degraded');
  if (snapshot.state === 'blocked') return text(i18n, 'aiReadiness.data.preserved');
  return text(i18n, 'aiReadiness.data.unopened');
}

export function createAIReadinessPresentation(
  snapshot: AIReadinessSnapshot,
  i18n: I18nHelpers,
  options: Readonly<{ canRetryGeneration?: boolean }> = {},
): AIReadinessPresentation {
  const copy = stateCopy(snapshot);
  const rows = diagnosticRows(snapshot, i18n);
  return {
    mode: snapshot.state === 'ready' ? 'ready' : snapshot.state === 'degraded' ? 'degraded' : snapshot.state === 'blocked' ? 'blocked' : 'busy',
    tone: copy.tone,
    title: text(i18n, copy.title),
    description: text(i18n, copy.description),
    dataStatement: dataStatement(snapshot, i18n),
    ...(snapshot.state === 'degraded' ? { primaryAction: 'review_issues' as const } : presentationActions(snapshot, options.canRetryGeneration !== false)),
    diagnosticRows: rows,
    diagnosticText: rows.map((row) => `${row.label}: ${row.value}`).join('\n'),
  };
}
