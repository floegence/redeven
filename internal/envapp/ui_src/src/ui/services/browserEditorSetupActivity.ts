import {
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationRunning,
  codeRuntimeReady,
  codeRuntimeStageLabel,
  type CodeRuntimePlatform,
  type CodeRuntimePrepareIntent,
  type CodeRuntimeOperationStage,
  type CodeRuntimeStatus,
  type BrowserEditorInstallMethod,
} from './codeRuntimeApi';
import { type I18nHelpers } from '../i18n';
import type { BrowserEditorSetupProgress, BrowserEditorSetupProgressPhase } from './browserEditorSetupProgress';
import {
  browserEditorRuntimeFailureSource,
  browserEditorSetupFailureSource,
  type BrowserEditorSetupFailureSource,
} from './browserEditorSetupError';

export type { BrowserEditorSetupFailureSource } from './browserEditorSetupError';

export type BrowserEditorSetupLocalFailure = Readonly<{
  source: BrowserEditorSetupFailureSource;
  install_method: BrowserEditorInstallMethod;
  message: string;
  occurred_at_unix_ms: number;
}>;

export type BrowserEditorSetupStepID = 'catalog' | 'acquire' | 'deliver' | 'install';
export type BrowserEditorSetupStepState = 'done' | 'active' | 'pending' | 'error' | 'cancelled';
export type BrowserEditorSetupPresentation = 'idle' | 'progress' | 'result';
export type BrowserEditorSetupActivityState =
  | 'checking'
  | 'missing'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'unusable'
  | 'error';

export type BrowserEditorSetupPlatformRequirement = 'supported_os' | 'supported_arch' | 'linux_glibc';

export type BrowserEditorSetupPlatformDiagnosis = Readonly<{
  code: string;
  detected: CodeRuntimePlatform;
  requirement: BrowserEditorSetupPlatformRequirement;
  detected_label?: string;
  required_label?: string;
}>;

export type BrowserEditorSetupStep = Readonly<{
  id: BrowserEditorSetupStepID;
  label: string;
  state: BrowserEditorSetupStepState;
}>;

export type BrowserEditorSetupActivity = Readonly<{
  state: BrowserEditorSetupActivityState;
  presentation: BrowserEditorSetupPresentation;
  title: string;
  badge_label: string;
  badge_variant: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  summary: string;
  detail?: string;
  steps: readonly BrowserEditorSetupStep[];
  active_step_index: number;
  step_count: number;
  show_steps: boolean;
  progress?: BrowserEditorSetupProgress;
  install_method?: BrowserEditorInstallMethod;
  can_retry: boolean;
  can_cancel: boolean;
  can_continue: boolean;
  show_log: boolean;
  log_tail: readonly string[];
  error_code?: string;
  platform_diagnosis?: BrowserEditorSetupPlatformDiagnosis;
  pending_action_label?: string;
}>;

export type LocalizedBrowserEditorPrepareCopy = Readonly<{
  actionLabel: string;
  confirmTitle: string;
  runningLabel: string;
  tooltip: string;
}>;

export type BrowserEditorPendingIntent = Readonly<{
  kind: 'open' | 'start';
}> | null;

const browserEditorStepDefs: readonly Readonly<{ id: BrowserEditorSetupStepID; label: string }>[] = [
  { id: 'catalog', label: 'Get package info' },
  { id: 'acquire', label: 'Acquire package' },
  { id: 'deliver', label: 'Prepare package' },
  { id: 'install', label: 'Install editor' },
];

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function browserEditorPlatformLabel(platform: CodeRuntimePlatform | null | undefined): string {
  if (!platform) return '-';
  return [clean(platform.os), clean(platform.arch), clean(platform.libc)].filter(Boolean).join(' / ') || clean(platform.platform_id) || '-';
}

function platformDiagnosisFromStatus(status: CodeRuntimeStatus | null | undefined): BrowserEditorSetupPlatformDiagnosis | undefined {
  const platform = status?.platform;
  if (!platform || platform.supported !== false) return undefined;
  const code = clean(platform.unsupported_code);
  switch (code) {
    case 'unsupported_libc':
      return { code, detected: platform, requirement: 'linux_glibc' };
    case 'unsupported_arch':
      return { code, detected: platform, requirement: 'supported_arch' };
    case 'unsupported_os':
      return { code, detected: platform, requirement: 'supported_os' };
    default:
      return undefined;
  }
}

export function browserEditorLocalFailureFromError(
  error: unknown,
  installMethod: BrowserEditorInstallMethod,
  now: () => number = Date.now,
): BrowserEditorSetupLocalFailure {
  const message = error instanceof Error ? error.message : clean(error) || 'Browser Editor setup did not finish successfully.';
  return {
    source: browserEditorSetupFailureSource(error),
    install_method: installMethod,
    message,
    occurred_at_unix_ms: now(),
  };
}

function pendingIntentSuffix(pendingIntent: BrowserEditorPendingIntent): string {
  if (pendingIntent?.kind === 'open') return ' Redeven will open the codespace after setup.';
  if (pendingIntent?.kind === 'start') return ' Redeven will start the codespace after setup.';
  return '';
}

function pendingActionLabel(pendingIntent: BrowserEditorPendingIntent): string | undefined {
  if (pendingIntent?.kind === 'open') return 'Continue to open codespace';
  if (pendingIntent?.kind === 'start') return 'Continue to start codespace';
  return undefined;
}

function stepIndexForID(stepID: BrowserEditorSetupStepID): number {
  return Math.max(0, browserEditorStepDefs.findIndex((step) => step.id === stepID));
}

function localFailureStepID(
  source: BrowserEditorSetupFailureSource,
  installMethod: BrowserEditorInstallMethod,
): BrowserEditorSetupStepID {
  switch (source) {
    case 'desktop_release_lookup':
    case 'remote_catalog':
    case 'remote_source':
      return 'catalog';
    case 'desktop_package_cache':
    case 'remote_download':
      return 'acquire';
    case 'desktop_upload':
    case 'runtime_import':
      return 'deliver';
    case 'package_verification':
      return installMethod === 'remote_download' ? 'deliver' : 'install';
    case 'installation':
      return 'install';
    case 'runtime_status':
    case 'unknown':
    default:
      return 'catalog';
  }
}

function runtimeStageStepID(
  stage: CodeRuntimeOperationStage | string | null | undefined,
  installMethod: BrowserEditorInstallMethod,
): BrowserEditorSetupStepID {
  switch (clean(stage)) {
    case 'resolving_catalog':
      return 'catalog';
    case 'receiving':
      return 'deliver';
    case 'downloading':
      return 'acquire';
    case 'verifying':
      return installMethod === 'remote_download' ? 'deliver' : 'install';
    case 'installing':
    case 'validating':
    case 'finalizing':
      return 'install';
    case 'preparing':
    default:
      return 'catalog';
  }
}

function progressStepID(phase: BrowserEditorSetupProgressPhase, installMethod: BrowserEditorInstallMethod): BrowserEditorSetupStepID {
  switch (phase) {
    case 'lookup':
      return 'catalog';
    case 'download':
    case 'package_validation':
      return 'acquire';
    case 'upload':
      return 'deliver';
    case 'verify':
      return installMethod === 'remote_download' ? 'deliver' : 'install';
    case 'install':
    case 'finalize':
    default:
      return 'install';
  }
}

function runtimeProgress(status: CodeRuntimeStatus | null | undefined): BrowserEditorSetupProgress | undefined {
  const operation = status?.operation;
  if (!operation || operation.state !== 'running' || !runtimeOperationBelongsToBrowserEditorSetup(operation.action)) return undefined;
  const startedAt = Math.max(0, Math.floor(operation.started_at_unix_ms ?? status?.updated_at_unix_ms ?? Date.now()));
  const updatedAt = Math.max(startedAt, Math.floor(status?.updated_at_unix_ms ?? Date.now()));
  const operationID = clean(operation.operation_id);
  if (!operationID) return undefined;
  switch (clean(operation.stage)) {
    case 'resolving_catalog':
      return { operation_id: operationID, phase: 'lookup', state: 'running', updated_at_unix_ms: updatedAt };
    case 'receiving':
      return {
        operation_id: operationID,
        phase: 'upload',
        state: 'running',
        ...(operation.transfer ? {
          completed_bytes: operation.transfer.received_bytes,
          total_bytes: operation.transfer.expected_bytes,
        } : {}),
        updated_at_unix_ms: updatedAt,
      };
    case 'verifying':
      return { operation_id: operationID, phase: 'verify', state: 'running', updated_at_unix_ms: updatedAt };
    case 'downloading':
      return {
        operation_id: operationID,
        phase: 'download',
        state: 'running',
        ...(operation.transfer ? {
          completed_bytes: operation.transfer.received_bytes,
          total_bytes: operation.transfer.expected_bytes,
          ...(operation.transfer.from_cache ? { from_cache: true } : {}),
        } : {}),
        updated_at_unix_ms: updatedAt,
      };
    case 'installing':
      return { operation_id: operationID, phase: 'install', state: 'running', updated_at_unix_ms: updatedAt };
    case 'finalizing':
      return { operation_id: operationID, phase: 'finalize', state: 'running', updated_at_unix_ms: updatedAt };
    case 'preparing':
    default:
      return { operation_id: operationID, phase: 'lookup', state: 'running', updated_at_unix_ms: updatedAt };
  }
}

function runtimeOperationBelongsToBrowserEditorSetup(action: string | null | undefined): boolean {
  return clean(action) === 'prepare_workspace_engine';
}

function stepsFor(activeStepID: BrowserEditorSetupStepID, state: 'active' | 'error' | 'cancelled' | 'done' | 'pending'): readonly BrowserEditorSetupStep[] {
  const activeIndex = stepIndexForID(activeStepID);
  return browserEditorStepDefs.map((step, index) => {
    let stepState: BrowserEditorSetupStepState = 'pending';
    if (state === 'done') {
      stepState = 'done';
    } else if (state === 'pending') {
      stepState = index === 0 ? 'active' : 'pending';
    } else if (index < activeIndex) {
      stepState = 'done';
    } else if (index === activeIndex) {
      stepState = state;
    }
    return {
      id: step.id,
      label: step.label,
      state: stepState,
    };
  });
}

function desktopFailureSummary(failure: BrowserEditorSetupLocalFailure): string {
  switch (failure.source) {
    case 'desktop_release_lookup':
      return 'Couldn’t check the latest Browser Editor.';
    case 'desktop_package_cache':
      return 'Couldn’t cache the Browser Editor package on Desktop.';
    case 'desktop_upload':
      return 'Couldn’t send the Browser Editor package to this environment.';
    case 'remote_catalog':
      return 'This environment couldn’t read the Browser Editor catalog.';
    case 'remote_download':
      return 'This environment couldn’t download the Browser Editor package.';
    case 'remote_source':
      return 'The Browser Editor package source was rejected.';
    case 'package_verification':
      return 'The Browser Editor package could not be verified.';
    case 'installation':
      return 'The Browser Editor package was verified, but installation did not finish.';
    case 'runtime_import':
      return 'This environment could not receive the Browser Editor package.';
    case 'runtime_status':
      return 'Couldn’t refresh Browser Editor setup status.';
    case 'unknown':
    default:
      return 'Browser Editor setup did not finish successfully.';
  }
}

function desktopFailureDetail(failure: BrowserEditorSetupLocalFailure): string {
  if (failure.source === 'desktop_release_lookup') {
    return `${failure.message} Redeven’s update catalog may be temporarily unavailable.`;
  }
  return failure.message;
}

function badgeForState(state: BrowserEditorSetupActivityState): Pick<BrowserEditorSetupActivity, 'badge_label' | 'badge_variant'> {
  switch (state) {
    case 'checking':
      return { badge_label: 'Checking', badge_variant: 'neutral' };
    case 'missing':
      return { badge_label: 'Not ready', badge_variant: 'neutral' };
    case 'preparing':
      return { badge_label: 'Preparing', badge_variant: 'info' };
    case 'ready':
      return { badge_label: 'Ready', badge_variant: 'success' };
    case 'failed':
      return { badge_label: 'Setup failed', badge_variant: 'error' };
    case 'cancelled':
      return { badge_label: 'Cancelled', badge_variant: 'warning' };
    case 'unusable':
      return { badge_label: 'Needs attention', badge_variant: 'warning' };
    case 'error':
    default:
      return { badge_label: 'Error', badge_variant: 'error' };
  }
}

function presentationForState(state: BrowserEditorSetupActivityState): BrowserEditorSetupPresentation {
  if (state === 'missing') return 'idle';
  if (state === 'checking' || state === 'preparing') return 'progress';
  return 'result';
}

function baseActivity(args: Readonly<{
  state: BrowserEditorSetupActivityState;
  summary: string;
  detail?: string;
  steps: readonly BrowserEditorSetupStep[];
  activeStepID: BrowserEditorSetupStepID;
  canRetry?: boolean;
  canCancel?: boolean;
  canContinue?: boolean;
  showLog?: boolean;
  logTail?: readonly string[];
  errorCode?: string;
  platformDiagnosis?: BrowserEditorSetupPlatformDiagnosis;
  pendingActionLabel?: string;
  progress?: BrowserEditorSetupProgress;
  installMethod?: BrowserEditorInstallMethod;
  showSteps?: boolean;
}>): BrowserEditorSetupActivity {
  const badge = badgeForState(args.state);
  const activeIndex = stepIndexForID(args.activeStepID);
  return {
    state: args.state,
    presentation: presentationForState(args.state),
    title: 'Browser Editor',
    ...badge,
    summary: args.summary,
    ...(args.detail ? { detail: args.detail } : {}),
    steps: args.steps,
    active_step_index: activeIndex + 1,
    step_count: browserEditorStepDefs.length,
    show_steps: args.showSteps !== false,
    ...(args.progress ? { progress: args.progress } : {}),
    ...(args.installMethod ? { install_method: args.installMethod } : {}),
    can_retry: Boolean(args.canRetry),
    can_cancel: Boolean(args.canCancel),
    can_continue: Boolean(args.canContinue),
    show_log: Boolean(args.showLog),
    log_tail: args.logTail ?? [],
    ...(args.errorCode ? { error_code: args.errorCode } : {}),
    ...(args.platformDiagnosis ? { platform_diagnosis: args.platformDiagnosis } : {}),
    ...(args.pendingActionLabel ? { pending_action_label: args.pendingActionLabel } : {}),
  };
}

export function buildBrowserEditorSetupActivity(args: Readonly<{
  status: CodeRuntimeStatus | null | undefined;
  loading?: boolean;
  error?: string | null;
  localPending?: boolean;
  localFailure?: BrowserEditorSetupLocalFailure | null;
  localCancelled?: boolean;
  localProgress?: BrowserEditorSetupProgress | null;
  installMethod: BrowserEditorInstallMethod;
  pendingIntent?: BrowserEditorPendingIntent;
}>): BrowserEditorSetupActivity {
  const status = args.status;
  const pendingLabel = pendingActionLabel(args.pendingIntent ?? null);
  const operation = status?.operation;
  const installMethod = operation?.install_method ?? args.localFailure?.install_method ?? args.installMethod;
  const setupOperation = runtimeOperationBelongsToBrowserEditorSetup(operation?.action);
  const logTail = operation?.log_tail ?? [];
  const platformDiagnosis = platformDiagnosisFromStatus(status);

  if (args.error) {
    return baseActivity({
      state: 'error',
      summary: 'Unable to check browser editor readiness.',
      detail: args.error,
      steps: stepsFor('catalog', 'pending'),
      activeStepID: 'catalog',
      installMethod,
    });
  }

  if (platformDiagnosis) {
    return baseActivity({
      state: 'failed',
      summary: status?.platform?.message || 'This environment is not supported by the managed Browser Editor.',
      steps: stepsFor('catalog', 'error'),
      activeStepID: 'catalog',
      installMethod,
      errorCode: platformDiagnosis.code,
      platformDiagnosis,
    });
  }

  if (setupOperation && codeRuntimeOperationRunning(status)) {
    const progress = runtimeProgress(status);
    const stepID = progress ? progressStepID(progress.phase, installMethod) : runtimeStageStepID(operation?.stage, installMethod);
    return baseActivity({
      state: 'preparing',
      summary: codeRuntimeStageLabel(operation?.stage, operation?.action),
      detail: 'Setup starts only after your explicit request. Redeven will not retry automatically if it fails.',
      steps: stepsFor(stepID, 'active'),
      activeStepID: stepID,
      canCancel: true,
      showLog: true,
      logTail,
      progress,
      installMethod,
    });
  }

  if (setupOperation && codeRuntimeOperationFailed(status)) {
    const stepID = runtimeStageStepID(operation?.stage, installMethod);
    return baseActivity({
      state: 'failed',
      summary: operation?.last_error || 'Browser Editor setup did not finish successfully.',
      steps: stepsFor(stepID, 'error'),
      activeStepID: stepID,
      canRetry: true,
      showLog: true,
      logTail,
      errorCode: operation?.last_error_code,
      installMethod,
    });
  }

  if (setupOperation && codeRuntimeOperationCancelled(status)) {
    const stepID = runtimeStageStepID(operation?.stage, installMethod);
    return baseActivity({
      state: 'cancelled',
      summary: 'Browser Editor setup was cancelled before it finished.',
      steps: stepsFor(stepID, 'cancelled'),
      activeStepID: stepID,
      canRetry: true,
      showLog: true,
      logTail,
      errorCode: operation?.last_error_code,
      installMethod,
    });
  }

  if (args.localFailure) {
    const progress = args.localProgress ?? undefined;
    const stepID = progress ? progressStepID(progress.phase, installMethod) : localFailureStepID(args.localFailure.source, installMethod);
    return baseActivity({
      state: 'failed',
      summary: desktopFailureSummary(args.localFailure),
      detail: desktopFailureDetail(args.localFailure),
      steps: stepsFor(stepID, 'error'),
      activeStepID: stepID,
      canRetry: true,
      errorCode: args.localFailure.source === 'unknown' ? undefined : args.localFailure.source,
      progress: progress ? { ...progress, state: 'failed' } : undefined,
      installMethod,
    });
  }

  if (args.localCancelled) {
    const stepID = args.localProgress ? progressStepID(args.localProgress.phase, installMethod) : 'catalog';
    return baseActivity({
      state: 'cancelled',
      summary: 'Browser Editor setup was cancelled before it finished.',
      steps: stepsFor(stepID, 'cancelled'),
      activeStepID: stepID,
      canRetry: true,
      progress: args.localProgress ? { ...args.localProgress, state: 'cancelled' } : undefined,
      installMethod,
    });
  }

  if (args.localPending) {
    const progress = args.localProgress ?? undefined;
    const stepID = progress ? progressStepID(progress.phase, installMethod) : 'catalog';
    const remoteSubmitting = installMethod === 'remote_download' && progress === undefined;
    return baseActivity({
      state: 'preparing',
      summary: 'Desktop is preparing the Browser Editor.',
      detail: 'Setup starts only after your explicit request. Redeven will not retry automatically if it fails.',
      steps: remoteSubmitting
        ? browserEditorStepDefs.map((step) => ({ ...step, state: 'pending' as const }))
        : stepsFor(stepID, 'active'),
      activeStepID: stepID,
      canCancel: true,
      progress,
      installMethod,
      showSteps: !remoteSubmitting,
    });
  }

  if (codeRuntimeReady(status)) {
    return baseActivity({
      state: 'ready',
      summary: `Ready. Editor path: ${status?.active_runtime.binary_path ?? '-'}`,
      steps: stepsFor('install', 'done'),
      activeStepID: 'install',
      installMethod,
      canContinue: Boolean(pendingLabel),
      pendingActionLabel: pendingLabel,
    });
  }

  if (args.loading) {
    return baseActivity({
      state: 'checking',
      summary: 'Checking browser editor readiness...',
      steps: stepsFor('catalog', 'pending'),
      activeStepID: 'catalog',
      installMethod,
    });
  }

  if (status?.active_runtime.detection_state === 'unusable') {
    return baseActivity({
      state: 'unusable',
      summary: status.active_runtime.error_message || 'Redeven detected a browser editor, but it is not usable on this host.',
      steps: stepsFor('install', 'error'),
      activeStepID: 'install',
      installMethod,
      canRetry: true,
      errorCode: status.active_runtime.error_code,
    });
  }

  return baseActivity({
    state: 'missing',
    summary: `${installMethod === 'desktop_transfer'
      ? 'Desktop downloads and verifies the Browser Editor package, then sends it through the current connection to this environment.'
      : 'This environment downloads and verifies the Browser Editor package directly from the Redeven package service.'}${pendingIntentSuffix(args.pendingIntent ?? null)}`,
    steps: stepsFor('catalog', 'pending'),
    activeStepID: 'catalog',
    installMethod,
    pendingActionLabel: pendingLabel,
  });
}

function localizedActivityBadgeLabel(activity: BrowserEditorSetupActivity, i18n: I18nHelpers): string {
  if (activity.platform_diagnosis) return i18n.t('codeRuntime.activity.platform.unsupported');
  switch (activity.state) {
    case 'checking':
      return i18n.t('common.status.checking');
    case 'missing':
      return i18n.t('codeRuntime.notReady');
    case 'preparing':
      return i18n.t('codeRuntime.preparing');
    case 'ready':
      return i18n.t('common.status.ready');
    case 'failed':
      return i18n.t('codeRuntime.setupFailed');
    case 'cancelled':
      return i18n.t('codeRuntime.cancelled');
    case 'unusable':
      return i18n.t('settings.autoSave.needsAttention');
    case 'error':
    default:
      return i18n.t('common.status.failed');
  }
}

function localizedActivityStepLabel(id: BrowserEditorSetupStepID, installMethod: BrowserEditorInstallMethod, i18n: I18nHelpers): string {
  const methodKey = installMethod === 'desktop_transfer' ? 'desktopTransfer' : 'remoteDownload';
  return i18n.t(`codeRuntime.activity.steps.${methodKey}.${id}`);
}

function localizedFailureSummary(source: BrowserEditorSetupFailureSource, i18n: I18nHelpers): string {
  switch (source) {
    case 'desktop_release_lookup':
      return i18n.t('codeRuntime.activity.failure.desktopReleaseLookup');
    case 'desktop_package_cache':
      return i18n.t('codeRuntime.activity.failure.desktopPackageCache');
    case 'desktop_upload':
      return i18n.t('codeRuntime.activity.failure.desktopUpload');
    case 'remote_catalog':
      return i18n.t('codeRuntime.activity.failure.remoteCatalog');
    case 'remote_download':
      return i18n.t('codeRuntime.activity.failure.remoteDownload');
    case 'remote_source':
      return i18n.t('codeRuntime.activity.failure.remoteSource');
    case 'package_verification':
      return i18n.t('codeRuntime.activity.failure.packageVerification');
    case 'installation':
      return i18n.t('codeRuntime.activity.failure.installation');
    case 'runtime_import':
      return i18n.t('codeRuntime.activity.failure.runtimeImport');
    case 'runtime_status':
      return i18n.t('codeRuntime.activity.failure.runtimeStatus');
    case 'unknown':
    default:
      return i18n.t('codeRuntime.activity.failure.unknown');
  }
}

function localizedLocalFailureDetail(failure: BrowserEditorSetupLocalFailure, i18n: I18nHelpers): string {
  if (failure.source === 'desktop_release_lookup') {
    return i18n.t('codeRuntime.activity.failure.desktopReleaseLookupDetail', { message: failure.message });
  }
  return failure.message;
}

function localizedProgressSummary(progress: BrowserEditorSetupProgress, i18n: I18nHelpers): string {
  switch (progress.phase) {
    case 'lookup':
      return i18n.t('codeRuntime.activity.progress.lookup');
    case 'download':
      return progress.from_cache
        ? i18n.t('codeRuntime.activity.progress.desktopCacheHit')
        : i18n.t('codeRuntime.activity.progress.downloading');
    case 'package_validation':
      return i18n.t('codeRuntime.activity.progress.packageValidation');
    case 'upload':
      return i18n.t('codeRuntime.stage.receiving');
    case 'verify':
      return i18n.t('codeRuntime.stage.verifying');
    case 'install':
      return i18n.t('codeRuntime.stage.installing');
    case 'finalize':
    default:
      return i18n.t('codeRuntime.stage.finalizing');
  }
}

function localizedPlatformRequirement(requirement: BrowserEditorSetupPlatformRequirement, i18n: I18nHelpers): string {
  switch (requirement) {
    case 'linux_glibc':
      return i18n.t('codeRuntime.activity.platform.linuxGlibc');
    case 'supported_arch':
      return i18n.t('codeRuntime.activity.platform.supportedArchitectures');
    case 'supported_os':
    default:
      return i18n.t('codeRuntime.activity.platform.supportedOperatingSystems');
  }
}

function localizedRuntimeFailureSummary(
  errorCode: string | null | undefined,
  installMethod: BrowserEditorInstallMethod,
  i18n: I18nHelpers,
): string {
  return localizedFailureSummary(browserEditorRuntimeFailureSource(errorCode, installMethod), i18n);
}

export function localizeBrowserEditorPrepareCopy(
  intent: CodeRuntimePrepareIntent,
  installMethod: BrowserEditorInstallMethod,
  i18n: I18nHelpers,
): LocalizedBrowserEditorPrepareCopy {
  const base = `codeRuntime.prepare.${intent}` as const;
  return {
    actionLabel: i18n.t(`${base}.actionLabel`),
    confirmTitle: i18n.t(`${base}.confirmTitle`),
    runningLabel: i18n.t(`${base}.runningLabel`),
    tooltip: i18n.t(installMethod === 'desktop_transfer'
      ? 'codeRuntime.installMethod.desktopTransferDescription'
      : 'codeRuntime.installMethod.remoteDownloadDescription'),
  };
}

export function localizeBrowserEditorSetupActivity(
  activity: BrowserEditorSetupActivity,
  args: Readonly<{
    status: CodeRuntimeStatus | null | undefined;
    loading: boolean;
    error?: string | null;
    localPending: boolean;
    localFailure: BrowserEditorSetupLocalFailure | null | undefined;
    localCancelled?: boolean;
    localProgress?: BrowserEditorSetupProgress | null;
    installMethod: BrowserEditorInstallMethod;
    pendingIntent?: BrowserEditorPendingIntent;
  }>,
  i18n: I18nHelpers,
): BrowserEditorSetupActivity {
  const operation = args.status?.operation;
  const installMethod = activity.install_method ?? operation?.install_method ?? args.localFailure?.install_method ?? args.installMethod;
  const setupOperation = runtimeOperationBelongsToBrowserEditorSetup(operation?.action);
  const steps = activity.steps.map((step) => ({
    ...step,
    label: localizedActivityStepLabel(step.id, installMethod, i18n),
  }));
  let summary = activity.summary;
  let detail = activity.detail;
  let pendingActionLabel = activity.pending_action_label;
  let platformDiagnosis = activity.platform_diagnosis;

  if (platformDiagnosis) {
    summary = i18n.t('codeRuntime.activity.platform.unsupportedSummary');
    detail = undefined;
    platformDiagnosis = {
      ...platformDiagnosis,
      detected_label: browserEditorPlatformLabel(platformDiagnosis.detected),
      required_label: localizedPlatformRequirement(platformDiagnosis.requirement, i18n),
    };
  } else if (args.error) {
    summary = i18n.t('codeRuntime.activity.readinessFailed');
    detail = args.error;
  } else if (args.localCancelled) {
    summary = i18n.t('codeRuntime.activity.cancelledSummary');
    detail = undefined;
  } else if (args.localFailure) {
    summary = localizedFailureSummary(args.localFailure.source, i18n);
    detail = localizedLocalFailureDetail(args.localFailure, i18n);
  } else if (setupOperation && operation?.state === 'running') {
    summary = codeRuntimeStageLabelLocalized(operation.stage, operation.action, i18n);
    detail = i18n.t('codeRuntime.activity.explicitRequestDetail');
  } else if (setupOperation && operation?.state === 'failed') {
    summary = localizedRuntimeFailureSummary(operation.last_error_code, installMethod, i18n);
    detail = operation.last_error || undefined;
  } else if (setupOperation && operation?.state === 'cancelled') {
    summary = i18n.t('codeRuntime.activity.cancelledSummary');
    detail = operation.last_error || undefined;
  } else if (args.localPending) {
    summary = args.localProgress
      ? localizedProgressSummary(args.localProgress, i18n)
      : i18n.t(args.installMethod === 'desktop_transfer'
        ? 'codeRuntime.activity.desktopPreparing'
        : 'codeRuntime.stage.preparing');
    detail = i18n.t('codeRuntime.activity.explicitRequestDetail');
  } else if (args.status?.active_runtime.detection_state === 'ready') {
    summary = i18n.t('codeRuntime.activity.readyWithPath', { path: args.status.active_runtime.binary_path ?? '-' });
    detail = undefined;
  } else if (args.loading) {
    summary = i18n.t('codeRuntime.activity.checkingReadiness');
    detail = undefined;
  } else if (args.status?.active_runtime.detection_state === 'unusable') {
    summary = args.status.active_runtime.error_message || i18n.t('codeRuntime.activity.unusableSummary');
    detail = undefined;
  } else if (activity.state === 'missing') {
    summary = i18n.t(installMethod === 'desktop_transfer'
      ? 'codeRuntime.installMethod.desktopTransferDescription'
      : 'codeRuntime.installMethod.remoteDownloadDescription');
    if (args.pendingIntent?.kind === 'open') summary += ` ${i18n.t('codeRuntime.activity.willOpenAfterSetup')}`;
    if (args.pendingIntent?.kind === 'start') summary += ` ${i18n.t('codeRuntime.activity.willStartAfterSetup')}`;
    detail = undefined;
  }

  if (
    !platformDiagnosis
    && (activity.state === 'failed' || activity.state === 'cancelled')
    && (setupOperation || args.localFailure || args.localCancelled)
  ) {
    const methodLabel = installMethod === 'desktop_transfer'
      ? i18n.t('codeRuntime.installMethod.desktopTransfer')
      : i18n.t('codeRuntime.installMethod.remoteDownload');
    detail = [i18n.t('codeRuntime.installMethod.lastAttempt', { method: methodLabel }), detail].filter(Boolean).join(' ');
  }

  if (pendingActionLabel === 'Continue to open codespace') {
    pendingActionLabel = i18n.t('codeRuntime.activity.continueToOpenCodespace');
  } else if (pendingActionLabel === 'Continue to start codespace') {
    pendingActionLabel = i18n.t('codeRuntime.activity.continueToStartCodespace');
  }

  const { detail: _detail, pending_action_label: _pendingActionLabel, platform_diagnosis: _platformDiagnosis, ...rest } = activity;
  return {
    ...rest,
    title: i18n.t('codeRuntime.title'),
    badge_label: localizedActivityBadgeLabel(activity, i18n),
    summary,
    steps,
    ...(detail ? { detail } : {}),
    ...(pendingActionLabel ? { pending_action_label: pendingActionLabel } : {}),
    ...(platformDiagnosis ? { platform_diagnosis: platformDiagnosis } : {}),
  };
}

function codeRuntimeStageLabelLocalized(stage: string | null | undefined, action: string | null | undefined, i18n: I18nHelpers): string {
  const normalizedStage = clean(stage);
  if (clean(action) === 'remove_local_environment_version') {
    switch (normalizedStage) {
      case 'preparing':
        return i18n.t('codeRuntime.stage.removalPreparing');
      case 'removing':
        return i18n.t('codeRuntime.stage.removing');
      case 'validating':
        return i18n.t('codeRuntime.stage.removalValidating');
      case 'finalizing':
        return i18n.t('codeRuntime.stage.removalFinalizing');
      default:
        return i18n.t('codeRuntime.stage.removalDefault');
    }
  }

  switch (normalizedStage) {
    case 'preparing':
      return i18n.t('codeRuntime.stage.preparing');
    case 'resolving_catalog':
      return i18n.t('codeRuntime.stage.resolvingCatalog');
    case 'receiving':
      return i18n.t('codeRuntime.stage.receiving');
    case 'downloading':
      return i18n.t('codeRuntime.stage.downloadingInEnvironment');
    case 'verifying':
      return i18n.t('codeRuntime.stage.verifying');
    case 'installing':
      return i18n.t('codeRuntime.stage.installing');
    case 'validating':
      return i18n.t('codeRuntime.stage.validating');
    case 'finalizing':
      return i18n.t('codeRuntime.stage.finalizing');
    default:
      return i18n.t('codeRuntime.stage.default');
  }
}
