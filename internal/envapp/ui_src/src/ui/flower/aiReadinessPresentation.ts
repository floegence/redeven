import type { I18nHelpers } from '../i18n';
import type { AIReadinessSnapshot } from './aiReadiness';

export type AIReadinessAction = 'retry' | 'open_update' | 'open_permissions' | 'review_issues' | 'show_diagnostics' | 'open_backups';

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
  if (snapshot.state === 'restoring' || snapshot.startup_phase === 'restoring') return text(i18n, 'aiReadiness.storage.restoringDescription');
  if (snapshot.state === 'degraded') return text(i18n, 'aiReadiness.diagnostics.statusDegraded');
  if (snapshot.state === 'blocked') return text(i18n, 'aiReadiness.diagnostics.statusBlocked');
  return text(i18n, 'aiReadiness.diagnostics.statusChecking');
}

function diagnosticPhase(snapshot: AIReadinessSnapshot, i18n: I18nHelpers): string {
  switch (snapshot.startup_phase || snapshot.state) {
    case 'backing_up': return text(i18n, 'aiReadiness.storage.backingUp');
    case 'restoring': return text(i18n, 'aiReadiness.storage.restoring');
    case 'inspecting':
    case 'unavailable':
      return text(i18n, 'aiReadiness.diagnostics.phaseChecking');
    case 'optimizing':
    case 'recovering':
      return text(i18n, 'aiReadiness.diagnostics.phasePreparing');
    case 'migrating':
      return text(i18n, 'aiReadiness.diagnostics.phaseUpdating');
    case 'verifying':
      return text(i18n, 'aiReadiness.diagnostics.phaseFinalCheck');
    case 'ready':
    case 'degraded':
      return text(i18n, 'aiReadiness.diagnostics.phaseReady');
    default:
      return text(i18n, 'aiReadiness.diagnostics.phaseStopped');
  }
}

function diagnosticElapsed(elapsedMs: number, i18n: I18nHelpers): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return text(i18n, 'aiReadiness.diagnostics.notAvailable');
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) return i18n.t('aiReadiness.diagnostics.elapsedSeconds', { seconds });
  return i18n.t('aiReadiness.diagnostics.elapsedMinutes', { minutes: Math.floor(seconds / 60) });
}

function diagnosticRows(
  snapshot: AIReadinessSnapshot,
  i18n: I18nHelpers,
  elapsedMs: number,
): readonly AIReadinessDiagnosticRow[] {
  return [
    ...(snapshot.component ? [{ label: text(i18n, 'aiReadiness.storage.component'), value: text(i18n, `aiReadiness.storage.${snapshot.component}`) }] : []),
    { label: text(i18n, 'aiReadiness.diagnostics.phase'), value: diagnosticPhase(snapshot, i18n) },
    { label: text(i18n, 'aiReadiness.diagnostics.elapsed'), value: diagnosticElapsed(elapsedMs, i18n) },
    { label: text(i18n, 'aiReadiness.diagnostics.status'), value: diagnosticStatus(snapshot, i18n) },
    { label: text(i18n, 'aiReadiness.diagnostics.traceID'), value: snapshot.trace_id || text(i18n, 'aiReadiness.diagnostics.notAvailable') },
  ];
}

function presentationActions(
  snapshot: AIReadinessSnapshot,
  canRetryGeneration: boolean,
  canManageStorage: boolean,
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
    case 'migration_failed':
    case 'backup_failed':
    case 'restore_failed':
      return canManageStorage ? { primaryAction: 'open_backups', secondaryAction: 'show_diagnostics' } : { primaryAction: 'show_diagnostics' };
    case 'insufficient_space':
      return canRetry ? { primaryAction: 'retry', secondaryAction: 'show_diagnostics' } : { primaryAction: 'show_diagnostics' };
    case 'store_io_error':
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
      case 'backing_up':
        return { title: 'aiReadiness.storage.backingUp', description: 'aiReadiness.storage.backingUpDescription', tone: 'neutral' };
      case 'restoring':
        return { title: 'aiReadiness.storage.restoring', description: 'aiReadiness.storage.restoringDescription', tone: 'neutral' };
      case 'inspecting':
        return { title: 'aiReadiness.states.inspectingTitle', description: 'aiReadiness.states.inspectingDescription', tone: 'neutral' };
      case 'optimizing':
        return { title: 'aiReadiness.states.optimizingTitle', description: 'aiReadiness.states.optimizingDescription', tone: 'neutral' };
      case 'migrating':
        return { title: 'aiReadiness.states.migratingTitle', description: 'aiReadiness.states.migratingDescription', tone: 'neutral' };
      case 'verifying':
        return { title: 'aiReadiness.states.verifyingTitle', description: 'aiReadiness.states.verifyingDescription', tone: 'neutral' };
      case 'recovering':
        return { title: 'aiReadiness.states.optimizingTitle', description: 'aiReadiness.states.optimizingDescription', tone: 'neutral' };
      case 'ready':
        return { title: 'common.status.ready', description: 'aiReadiness.data.processing', tone: 'neutral' };
      case 'unavailable':
      default:
        return { title: 'aiReadiness.states.unavailableTitle', description: 'aiReadiness.states.unavailableDescription', tone: 'neutral' };
    }
  }

  if (snapshot.reason_code === 'insufficient_space') return { title: 'aiReadiness.storage.spaceTitle', description: 'aiReadiness.storage.spaceDescription', tone: 'warning' };
  if (['migration_failed', 'backup_failed', 'restore_failed'].includes(snapshot.reason_code)) return { title: 'aiReadiness.storage.failedTitle', description: 'aiReadiness.storage.failedDescription', tone: 'danger' };
  if (snapshot.retryable && snapshot.safe_to_retry) {
    return { title: 'aiReadiness.states.temporarilyUnavailableTitle', description: 'aiReadiness.states.temporarilyUnavailableDescription', tone: 'warning' };
  }

  switch (snapshot.reason_code) {
    case 'temporarily_blocked':
    case 'store_io_error':
    case 'cancelled':
    case 'ai_service_startup_error':
      return { title: 'aiReadiness.states.needsCheckTitle', description: 'aiReadiness.states.needsCheckDescription', tone: 'danger' };
    case 'update_required':
      return { title: 'aiReadiness.states.updateRequiredTitle', description: 'aiReadiness.states.updateRequiredDescription', tone: 'warning' };
    case 'unsupported_store':
    case 'store_integrity_error':
    case 'contract_error':
    case 'ai_readiness_contract_error':
      return { title: 'aiReadiness.states.needsCheckTitle', description: 'aiReadiness.states.needsCheckDescription', tone: 'danger' };
    case 'environment_permission_error':
      return { title: 'aiReadiness.states.permissionTitle', description: 'aiReadiness.states.permissionDescription', tone: 'warning' };
    default:
      return { title: 'aiReadiness.states.temporarilyUnavailableTitle', description: 'aiReadiness.states.temporarilyUnavailableDescription', tone: 'warning' };
  }
}

function dataStatement(snapshot: AIReadinessSnapshot, i18n: I18nHelpers): string {
  if (snapshot.state === 'restoring' || snapshot.startup_phase === 'restoring') return text(i18n, 'aiReadiness.storage.restoringDescription');
  if (snapshot.state === 'degraded') return text(i18n, 'aiReadiness.data.degraded');
  if (snapshot.state === 'blocked') return text(i18n, 'aiReadiness.data.preserved');
  return text(i18n, 'aiReadiness.data.processing');
}

export function createAIReadinessPresentation(
  snapshot: AIReadinessSnapshot,
  i18n: I18nHelpers,
  options: Readonly<{ canRetryGeneration?: boolean; canManageStorage?: boolean; elapsedMs?: number }> = {},
): AIReadinessPresentation {
  const copy = stateCopy(snapshot);
  const rows = diagnosticRows(snapshot, i18n, options.elapsedMs ?? -1);
  return {
    mode: snapshot.state === 'ready' ? 'ready' : snapshot.state === 'degraded' ? 'degraded' : snapshot.state === 'blocked' ? 'blocked' : 'busy',
    tone: copy.tone,
    title: text(i18n, copy.title),
    description: text(i18n, copy.description),
    dataStatement: dataStatement(snapshot, i18n),
    ...(snapshot.state === 'degraded' ? { primaryAction: 'review_issues' as const } : presentationActions(snapshot, options.canRetryGeneration !== false, options.canManageStorage === true)),
    diagnosticRows: rows,
    diagnosticText: rows.map((row) => `${row.label}: ${row.value}`).join('\n'),
  };
}
