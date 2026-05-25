import {
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationRunning,
  codeRuntimePrepareCopy,
  codeRuntimeReady,
  codeRuntimeStageLabel,
  type CodeRuntimeOperationStage,
  type CodeRuntimeStatus,
} from './codeRuntimeApi';

export type BrowserEditorSetupFailureSource =
  | 'desktop_release_lookup'
  | 'desktop_package_cache'
  | 'desktop_upload'
  | 'runtime_import'
  | 'runtime_status'
  | 'unknown';

export type BrowserEditorSetupLocalFailure = Readonly<{
  source: BrowserEditorSetupFailureSource;
  message: string;
  occurred_at_unix_ms: number;
}>;

export type BrowserEditorSetupStepID = 'lookup' | 'cache' | 'upload' | 'verify';
export type BrowserEditorSetupStepState = 'done' | 'active' | 'pending' | 'error' | 'cancelled';
export type BrowserEditorSetupActivityState =
  | 'checking'
  | 'missing'
  | 'preparing'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'unusable'
  | 'error';

export type BrowserEditorSetupStep = Readonly<{
  id: BrowserEditorSetupStepID;
  label: string;
  state: BrowserEditorSetupStepState;
}>;

export type BrowserEditorSetupActivity = Readonly<{
  state: BrowserEditorSetupActivityState;
  title: 'Browser Editor';
  badge_label: string;
  badge_variant: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  summary: string;
  detail?: string;
  steps: readonly BrowserEditorSetupStep[];
  active_step_index: number;
  step_count: number;
  progress_percent: number;
  can_retry: boolean;
  can_cancel: boolean;
  can_continue: boolean;
  show_log: boolean;
  log_tail: readonly string[];
  pending_action_label?: string;
}>;

export type BrowserEditorPendingIntent = Readonly<{
  kind: 'open' | 'start';
}> | null;

const browserEditorStepDefs: readonly Readonly<{ id: BrowserEditorSetupStepID; label: string }>[] = [
  { id: 'lookup', label: 'Check latest package' },
  { id: 'cache', label: 'Cache on Desktop' },
  { id: 'upload', label: 'Send to environment' },
  { id: 'verify', label: 'Verify editor' },
];

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function classifyBrowserEditorLocalFailure(message: string): BrowserEditorSetupFailureSource {
  const normalized = clean(message).toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.includes('github release lookup') || normalized.includes('api rate limit') || normalized.includes('rate limit')) {
    return 'desktop_release_lookup';
  }
  if (
    normalized.includes('download failed')
    || normalized.includes('archive')
    || normalized.includes('cache')
    || normalized.includes('release asset')
    || normalized.includes('did not include')
  ) {
    return 'desktop_package_cache';
  }
  if (
    normalized.includes('upload')
    || normalized.includes('chunk')
    || normalized.includes('import session')
    || normalized.includes('read the browser editor package')
    || normalized.includes('send')
  ) {
    return 'desktop_upload';
  }
  return 'unknown';
}

export function browserEditorLocalFailureFromError(error: unknown, now: () => number = Date.now): BrowserEditorSetupLocalFailure {
  const message = error instanceof Error ? error.message : clean(error) || 'Browser Editor setup did not finish successfully.';
  return {
    source: classifyBrowserEditorLocalFailure(message),
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

function localFailureStepID(source: BrowserEditorSetupFailureSource): BrowserEditorSetupStepID {
  switch (source) {
    case 'desktop_release_lookup':
      return 'lookup';
    case 'desktop_package_cache':
      return 'cache';
    case 'desktop_upload':
    case 'runtime_import':
      return 'upload';
    case 'runtime_status':
    case 'unknown':
    default:
      return 'lookup';
  }
}

function runtimeStageStepID(stage: CodeRuntimeOperationStage | string | null | undefined): BrowserEditorSetupStepID {
  switch (clean(stage)) {
    case 'receiving':
      return 'upload';
    case 'verifying':
    case 'installing':
    case 'validating':
    case 'finalizing':
      return 'verify';
    case 'preparing':
    default:
      return 'cache';
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

function progressPercent(activeStepID: BrowserEditorSetupStepID, state: BrowserEditorSetupActivityState): number {
  if (state === 'ready') return 100;
  const index = stepIndexForID(activeStepID);
  const count = browserEditorStepDefs.length;
  if (state === 'failed' || state === 'cancelled') {
    return Math.round((index / count) * 100);
  }
  return Math.round(((index + 0.55) / count) * 100);
}

function desktopFailureSummary(failure: BrowserEditorSetupLocalFailure): string {
  switch (failure.source) {
    case 'desktop_release_lookup':
      return 'Couldn’t check the latest Browser Editor package.';
    case 'desktop_package_cache':
      return 'Couldn’t cache the Browser Editor package on Desktop.';
    case 'desktop_upload':
      return 'Couldn’t send the Browser Editor package to this environment.';
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
  if (failure.source === 'desktop_release_lookup' && /403|rate limit/i.test(failure.message)) {
    return `${failure.message} GitHub’s API limit was reached on this machine.`;
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
  pendingActionLabel?: string;
}>): BrowserEditorSetupActivity {
  const badge = badgeForState(args.state);
  const activeIndex = stepIndexForID(args.activeStepID);
  return {
    state: args.state,
    title: 'Browser Editor',
    ...badge,
    summary: args.summary,
    ...(args.detail ? { detail: args.detail } : {}),
    steps: args.steps,
    active_step_index: activeIndex + 1,
    step_count: browserEditorStepDefs.length,
    progress_percent: progressPercent(args.activeStepID, args.state),
    can_retry: Boolean(args.canRetry),
    can_cancel: Boolean(args.canCancel),
    can_continue: Boolean(args.canContinue),
    show_log: Boolean(args.showLog),
    log_tail: args.logTail ?? [],
    ...(args.pendingActionLabel ? { pending_action_label: args.pendingActionLabel } : {}),
  };
}

export function buildBrowserEditorSetupActivity(args: Readonly<{
  status: CodeRuntimeStatus | null | undefined;
  loading?: boolean;
  error?: string | null;
  localPending?: boolean;
  localFailure?: BrowserEditorSetupLocalFailure | null;
  pendingIntent?: BrowserEditorPendingIntent;
}>): BrowserEditorSetupActivity {
  const status = args.status;
  const pendingLabel = pendingActionLabel(args.pendingIntent ?? null);
  const operation = status?.operation;
  const setupOperation = runtimeOperationBelongsToBrowserEditorSetup(operation?.action);
  const logTail = operation?.log_tail ?? [];

  if (args.error) {
    return baseActivity({
      state: 'error',
      summary: 'Unable to check browser editor readiness.',
      detail: args.error,
      steps: stepsFor('lookup', 'pending'),
      activeStepID: 'lookup',
    });
  }

  if (setupOperation && codeRuntimeOperationRunning(status)) {
    const stepID = runtimeStageStepID(operation?.stage);
    return baseActivity({
      state: 'preparing',
      summary: codeRuntimeStageLabel(operation?.stage, operation?.action),
      detail: 'Setup starts only after your explicit request. Redeven will not retry automatically if it fails.',
      steps: stepsFor(stepID, 'active'),
      activeStepID: stepID,
      canCancel: true,
      showLog: true,
      logTail,
    });
  }

  if (setupOperation && codeRuntimeOperationFailed(status)) {
    const stepID = runtimeStageStepID(operation?.stage);
    return baseActivity({
      state: 'failed',
      summary: operation?.last_error || 'Browser Editor setup did not finish successfully.',
      steps: stepsFor(stepID, 'error'),
      activeStepID: stepID,
      canRetry: true,
      showLog: true,
      logTail,
    });
  }

  if (setupOperation && codeRuntimeOperationCancelled(status)) {
    const stepID = runtimeStageStepID(operation?.stage);
    return baseActivity({
      state: 'cancelled',
      summary: 'Browser Editor setup was cancelled before it finished.',
      steps: stepsFor(stepID, 'cancelled'),
      activeStepID: stepID,
      canRetry: true,
      showLog: true,
      logTail,
    });
  }

  if (args.localFailure) {
    const stepID = localFailureStepID(args.localFailure.source);
    return baseActivity({
      state: 'failed',
      summary: desktopFailureSummary(args.localFailure),
      detail: desktopFailureDetail(args.localFailure),
      steps: stepsFor(stepID, 'error'),
      activeStepID: stepID,
      canRetry: true,
    });
  }

  if (args.localPending) {
    return baseActivity({
      state: 'preparing',
      summary: 'Desktop is preparing the Browser Editor package.',
      detail: 'Setup starts only after your explicit request. Redeven will not retry automatically if it fails.',
      steps: stepsFor('lookup', 'active'),
      activeStepID: 'lookup',
    });
  }

  if (codeRuntimeReady(status)) {
    return baseActivity({
      state: 'ready',
      summary: `Ready. Editor path: ${status?.active_runtime.binary_path ?? '-'}`,
      steps: stepsFor('verify', 'done'),
      activeStepID: 'verify',
      canContinue: Boolean(pendingLabel),
      pendingActionLabel: pendingLabel,
    });
  }

  if (args.loading) {
    return baseActivity({
      state: 'checking',
      summary: 'Checking browser editor readiness...',
      steps: stepsFor('lookup', 'pending'),
      activeStepID: 'lookup',
    });
  }

  if (status?.active_runtime.detection_state === 'unusable') {
    return baseActivity({
      state: 'unusable',
      summary: status.active_runtime.error_message || 'Redeven detected a browser editor, but it is not usable on this host.',
      steps: stepsFor('verify', 'error'),
      activeStepID: 'verify',
      canRetry: true,
    });
  }

  const copy = codeRuntimePrepareCopy(status);
  return baseActivity({
    state: 'missing',
    summary: `${copy.description}${pendingIntentSuffix(args.pendingIntent ?? null)}`,
    steps: stepsFor('lookup', 'pending'),
    activeStepID: 'lookup',
    pendingActionLabel: pendingLabel,
  });
}
