import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { Code, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog, HighlightBlock } from '@floegence/floe-webapp-core/ui';

import {
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationRunning,
  codeRuntimePrepareCopy,
  codeRuntimeReady,
  type CodeRuntimeInstalledVersion,
  type CodeRuntimeStatus,
} from '../../services/codeRuntimeApi';
import {
  buildBrowserEditorSetupActivity,
  type BrowserEditorSetupLocalFailure,
  type BrowserEditorSetupActivity,
} from '../../services/browserEditorSetupActivity';
import { Tooltip } from '../../primitives/Tooltip';
import { BrowserEditorSetupActivityPanel } from '../BrowserEditorSetupActivityPanel';
import { SettingsSection, SettingsKeyValueTable, SettingsPill } from './SettingsPrimitives';
import { useI18n, type I18nHelpers } from '../../i18n';

type RuntimeDetailRow = Readonly<{
  label: string;
  value: JSX.Element | string;
  note?: JSX.Element | string;
  mono?: boolean;
}>;

type LocalizedPrepareCopy = Readonly<{
  actionLabel: string;
  confirmTitle: string;
  runningLabel: string;
  tooltip: string;
  description: string;
}>;

function runtimeSourceLabel(source: string | null | undefined, i18n: I18nHelpers): string {
  switch (String(source ?? '').trim()) {
    case 'managed':
      return i18n.t('codeRuntime.source.managed');
    case 'env_override':
      return i18n.t('codeRuntime.source.envOverride');
    case 'system':
      return i18n.t('codeRuntime.source.system');
    default:
      return i18n.t('codeRuntime.source.none');
  }
}

function runtimeStatusTone(state: string | null | undefined): 'default' | 'success' | 'warning' {
  switch (String(state ?? '').trim()) {
    case 'ready':
      return 'success';
    case 'unusable':
      return 'warning';
    default:
      return 'default';
  }
}

function runtimeStatusLabel(state: string | null | undefined, i18n: I18nHelpers): string {
  switch (String(state ?? '').trim()) {
    case 'ready':
      return i18n.t('common.status.ready');
    case 'unusable':
      return i18n.t('settings.autoSave.needsAttention');
    default:
      return i18n.t('codeRuntime.unavailable');
  }
}

function codeRuntimeStageLabelLocalized(stage: string | null | undefined, action: string | null | undefined, i18n: I18nHelpers): string {
  const normalizedStage = String(stage ?? '').trim();
  if (String(action ?? '').trim() === 'remove_local_environment_version') {
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
    case 'receiving':
      return i18n.t('codeRuntime.stage.receiving');
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

function operationLabel(status: CodeRuntimeStatus | null | undefined, i18n: I18nHelpers): string {
  const operation = status?.operation;
  if (!operation) return i18n.t('codeRuntime.operation.idle');
  if (operation.state === 'running') return codeRuntimeStageLabelLocalized(operation.stage, operation.action, i18n);
  if (operation.state === 'failed') return operation.action === 'remove_local_environment_version' ? i18n.t('codeRuntime.operation.versionRemovalFailed') : i18n.t('codeRuntime.operation.setupFailed');
  if (operation.state === 'cancelled') return operation.action === 'remove_local_environment_version' ? i18n.t('codeRuntime.operation.versionRemovalCancelled') : i18n.t('codeRuntime.operation.setupCancelled');
  if (operation.state === 'succeeded') return operation.action === 'remove_local_environment_version' ? i18n.t('codeRuntime.operation.versionRemoved') : i18n.t('codeRuntime.operation.ready');
  return i18n.t('codeRuntime.operation.idle');
}

function prepareCopyForI18n(intent: string, i18n: I18nHelpers): LocalizedPrepareCopy {
  switch (intent) {
    case 'retry':
      return {
        actionLabel: i18n.t('codeRuntime.prepare.retry.actionLabel'),
        confirmTitle: i18n.t('codeRuntime.prepare.retry.confirmTitle'),
        runningLabel: i18n.t('codeRuntime.prepare.retry.runningLabel'),
        tooltip: i18n.t('codeRuntime.prepare.retry.tooltip'),
        description: i18n.t('codeRuntime.prepare.description'),
      };
    case 'update':
      return {
        actionLabel: i18n.t('codeRuntime.prepare.update.actionLabel'),
        confirmTitle: i18n.t('codeRuntime.prepare.update.confirmTitle'),
        runningLabel: i18n.t('codeRuntime.prepare.update.runningLabel'),
        tooltip: i18n.t('codeRuntime.prepare.update.tooltip'),
        description: i18n.t('codeRuntime.prepare.description'),
      };
    case 'setup':
    default:
      return {
        actionLabel: i18n.t('codeRuntime.prepare.setup.actionLabel'),
        confirmTitle: i18n.t('codeRuntime.prepare.setup.confirmTitle'),
        runningLabel: i18n.t('codeRuntime.prepare.setup.runningLabel'),
        tooltip: i18n.t('codeRuntime.prepare.setup.tooltip'),
        description: i18n.t('codeRuntime.prepare.description'),
      };
  }
}

function localizedActivityBadgeLabel(state: BrowserEditorSetupActivity['state'], i18n: I18nHelpers): string {
  switch (state) {
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

function localizedActivityStepLabel(id: string, i18n: I18nHelpers): string {
  switch (id) {
    case 'lookup':
      return i18n.t('codeRuntime.activity.steps.lookup');
    case 'cache':
      return i18n.t('codeRuntime.activity.steps.cache');
    case 'upload':
      return i18n.t('codeRuntime.activity.steps.upload');
    case 'verify':
      return i18n.t('codeRuntime.activity.steps.verify');
    default:
      return id;
  }
}

function localizedLocalFailureSummary(failure: BrowserEditorSetupLocalFailure, i18n: I18nHelpers): string {
  switch (failure.source) {
    case 'desktop_release_lookup':
      return i18n.t('codeRuntime.activity.failure.desktopReleaseLookup');
    case 'desktop_package_cache':
      return i18n.t('codeRuntime.activity.failure.desktopPackageCache');
    case 'desktop_upload':
      return i18n.t('codeRuntime.activity.failure.desktopUpload');
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

function localizeBrowserEditorActivity(
  activity: BrowserEditorSetupActivity,
  args: Readonly<{
    status: CodeRuntimeStatus | null | undefined;
    loading: boolean;
    localPending: boolean;
    localFailure: BrowserEditorSetupLocalFailure | null | undefined;
    prepareDescription: string;
  }>,
  i18n: I18nHelpers,
): BrowserEditorSetupActivity {
  const operation = args.status?.operation;
  const setupOperation = String(operation?.action ?? '').trim() === 'prepare_workspace_engine';
  const steps = activity.steps.map((step) => ({
    ...step,
    label: localizedActivityStepLabel(step.id, i18n),
  }));
  let summary = activity.summary;
  let detail = activity.detail;
  let pendingActionLabel = activity.pending_action_label;

  if (args.localFailure) {
    summary = localizedLocalFailureSummary(args.localFailure, i18n);
    detail = localizedLocalFailureDetail(args.localFailure, i18n);
  } else if (setupOperation && operation?.state === 'running') {
    summary = codeRuntimeStageLabelLocalized(operation.stage, operation.action, i18n);
    detail = i18n.t('codeRuntime.activity.explicitRequestDetail');
  } else if (setupOperation && operation?.state === 'failed') {
    summary = operation.last_error || i18n.t('codeRuntime.activity.failure.unknown');
  } else if (setupOperation && operation?.state === 'cancelled') {
    summary = i18n.t('codeRuntime.activity.cancelledSummary');
  } else if (args.localPending) {
    summary = i18n.t('codeRuntime.activity.desktopPreparing');
    detail = i18n.t('codeRuntime.activity.explicitRequestDetail');
  } else if (args.status?.active_runtime.detection_state === 'ready') {
    summary = i18n.t('codeRuntime.activity.readyWithPath', { path: args.status?.active_runtime.binary_path ?? '-' });
  } else if (args.loading) {
    summary = i18n.t('codeRuntime.activity.checkingReadiness');
  } else if (args.status?.active_runtime.detection_state === 'unusable') {
    summary = args.status.active_runtime.error_message || i18n.t('codeRuntime.activity.unusableSummary');
  } else if (activity.state === 'missing') {
    summary = args.prepareDescription;
  }

  if (pendingActionLabel === 'Continue to open codespace') {
    pendingActionLabel = i18n.t('codeRuntime.activity.continueToOpenCodespace');
  } else if (pendingActionLabel === 'Continue to start codespace') {
    pendingActionLabel = i18n.t('codeRuntime.activity.continueToStartCodespace');
  }

  return {
    ...activity,
    title: i18n.t('codeRuntime.title') as BrowserEditorSetupActivity['title'],
    badge_label: localizedActivityBadgeLabel(activity.state, i18n),
    summary,
    ...(detail ? { detail } : {}),
    steps,
    ...(pendingActionLabel ? { pending_action_label: pendingActionLabel } : {}),
  };
}

function RuntimeDetailsTableSection(props: { title: string; rows: readonly RuntimeDetailRow[] }) {
  return (
    <div class="space-y-2">
      <div class="text-sm font-semibold text-foreground">{props.title}</div>
      <SettingsKeyValueTable rows={props.rows} minWidthClass="min-w-[40rem]" />
    </div>
  );
}

function ActionButtonTooltip(props: { content: string; disabled?: boolean; children: JSX.Element }) {
  return (
    <Tooltip content={props.content} placement="top" delay={0}>
      <span class={props.disabled ? 'inline-flex cursor-not-allowed' : 'inline-flex cursor-pointer'}>
        {props.children}
      </span>
    </Tooltip>
  );
}

function VersionRow(props: {
  version: CodeRuntimeInstalledVersion;
  canInteract: boolean;
  canManage: boolean;
  busy: boolean;
  onUse: (version: string) => void;
  onRemove: (version: string) => void;
}) {
  const i18n = useI18n();
  const detectionTone = () => runtimeStatusTone(props.version.detection_state);

  return (
    <div class="rounded-lg border border-border bg-muted/20 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <div class="text-sm font-semibold text-foreground">{props.version.version}</div>
            <SettingsPill tone={detectionTone()}>{runtimeStatusLabel(props.version.detection_state, i18n)}</SettingsPill>
            <Show when={props.version.selected_by_local_environment}>
              <SettingsPill tone="success">{i18n.t('codeRuntime.currentEditor')}</SettingsPill>
            </Show>
          </div>
          <div class="grid gap-1 text-[11px] text-muted-foreground">
            <div>
              {i18n.t('codeRuntime.binaryPath')}: <span class="font-mono text-foreground break-all">{props.version.binary_path || '-'}</span>
            </div>
            <Show when={props.version.error_message}>
              <div class="text-destructive">{props.version.error_message}</div>
            </Show>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onUse(props.version.version)}
            disabled={!props.canInteract || !props.canManage || props.busy || props.version.selected_by_local_environment}
          >
            {i18n.t('codeRuntime.useThisVersion')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onRemove(props.version.version)}
            disabled={!props.canInteract || !props.canManage || props.busy || !props.version.removable}
          >
            {i18n.t('codeRuntime.removeVersionAction')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface CodeRuntimeSettingsCardProps {
  status: CodeRuntimeStatus | null | undefined;
  loading: boolean;
  error?: string | null;
  localPrepareFailure?: BrowserEditorSetupLocalFailure | null;
  canInteract: boolean;
  canManage: boolean;
  actionLoading: boolean;
  cancelLoading: boolean;
  selectionLoadingVersion: string | null;
  removeVersionLoading: string | null;
  onRefresh: () => void;
  onPrepare: () => Promise<void> | void;
  onSelectVersion: (version: string) => Promise<void> | void;
  onRemoveVersion: (version: string) => Promise<void> | void;
  onCancel: () => Promise<void> | void;
}

export function CodeRuntimeSettingsCard(props: CodeRuntimeSettingsCardProps) {
  const i18n = useI18n();
  const [prepareConfirmOpen, setPrepareConfirmOpen] = createSignal(false);
  const [removeVersionConfirmOpen, setRemoveVersionConfirmOpen] = createSignal<string | null>(null);

  const runtimeReady = createMemo(() => codeRuntimeReady(props.status));
  const operationRunning = createMemo(() => codeRuntimeOperationRunning(props.status));
  const operationFailed = createMemo(() => codeRuntimeOperationFailed(props.status));
  const operationCancelled = createMemo(() => codeRuntimeOperationCancelled(props.status));
  const operationNeedsAttention = createMemo(() => codeRuntimeOperationNeedsAttention(props.status));
  const installedVersions = createMemo(() => props.status?.installed_versions ?? []);
  const activeRuntime = createMemo(() => props.status?.active_runtime);
  const prepareCopy = createMemo(() => codeRuntimePrepareCopy(props.status));
  const localizedPrepareCopy = createMemo(() => prepareCopyForI18n(prepareCopy().intent, i18n));
  const localPending = createMemo(() => props.actionLoading && !operationRunning());
  const setupActivity = createMemo(() => {
    const activity = buildBrowserEditorSetupActivity({
      status: props.status,
      localPending: localPending(),
      localFailure: props.localPrepareFailure,
    });
    return localizeBrowserEditorActivity(activity, {
      status: props.status,
      loading: props.loading,
      localPending: localPending(),
      localFailure: props.localPrepareFailure,
      prepareDescription: localizedPrepareCopy().description,
    }, i18n);
  });
  const prepareOperationActive = createMemo(() => String(props.status?.operation.action ?? '').trim() === 'prepare_workspace_engine');
  const showSetupActivity = createMemo(() => Boolean(props.localPrepareFailure) || props.actionLoading || (prepareOperationActive() && (operationRunning() || operationNeedsAttention())));
  const showRemovalOperation = createMemo(() => !prepareOperationActive() && (operationRunning() || operationNeedsAttention()));
  const operationLogTail = createMemo(() => props.status?.operation.log_tail ?? []);
  const refreshActionLabel = () => i18n.t('common.actions.refresh');
  const refreshActionTooltip = () => i18n.t('codeRuntime.refreshTooltip');
  const prepareActionLabel = () => localizedPrepareCopy().actionLabel;
  const prepareActionTooltip = () => localizedPrepareCopy().tooltip;
  const cancelActionLabel = () => i18n.t('common.actions.cancel');
  const cancelActionTooltip = () => i18n.t('codeRuntime.cancelTooltip');

  const currentRuntimeRows = createMemo<readonly RuntimeDetailRow[]>(() => {
    const active = activeRuntime();
    return [
      {
        label: i18n.t('codeRuntime.rows.managedEditorSource'),
        value: props.status?.managed_runtime_source === 'managed' ? i18n.t('codeRuntime.selectedManagedVersion') : i18n.t('codeRuntime.noManagedVersionSelected'),
        note:
          props.status?.managed_runtime_source === 'managed'
            ? i18n.t('codeRuntime.notes.codespacesUsesSelectedManagedVersion')
            : i18n.t('codeRuntime.notes.setupOrSelectManagedVersion'),
      },
      {
        label: i18n.t('codeRuntime.rows.selectedVersion'),
        value: props.status?.managed_runtime_version || i18n.t('codeRuntime.none'),
        note:
          props.status?.managed_runtime_version
            ? i18n.t('codeRuntime.notes.managedVersionSelected')
            : i18n.t('codeRuntime.notes.valueAppearsAfterSetup'),
      },
      {
        label: i18n.t('codeRuntime.rows.activeRuntime'),
        value: (
          <SettingsPill tone={runtimeStatusTone(active?.detection_state)}>
            {runtimeStatusLabel(active?.detection_state, i18n)}
          </SettingsPill>
        ),
        note: active?.error_message || i18n.t('codeRuntime.notes.codespacesUsingRuntimeSource', { source: runtimeSourceLabel(active?.source, i18n) }),
      },
      {
        label: i18n.t('codeRuntime.rows.activeSource'),
        value: runtimeSourceLabel(active?.source, i18n),
        note:
          active?.source === 'env_override'
            ? i18n.t('codeRuntime.notes.envOverrideActive')
            : active?.source === 'system'
              ? i18n.t('codeRuntime.notes.hostDiscoveryActive')
              : active?.source === 'managed'
                ? i18n.t('codeRuntime.notes.managedRuntimeActive')
                : i18n.t('codeRuntime.notes.noActiveRuntime'),
      },
      {
        label: i18n.t('codeRuntime.rows.activeEditorPath'),
        value: active?.binary_path || i18n.t('codeRuntime.notDetected'),
        note: i18n.t('codeRuntime.notes.executablePathUsed'),
        mono: true,
      },
      {
        label: i18n.t('codeRuntime.rows.selectedEditorPath'),
        value: props.status?.managed_prefix || '-',
        note: i18n.t('codeRuntime.notes.selectedManagedPath'),
        mono: true,
      },
      {
        label: i18n.t('codeRuntime.rows.sharedRuntimeRoot'),
        value: props.status?.shared_runtime_root || '-',
        note: i18n.t('codeRuntime.notes.sharedRuntimeRoot'),
        mono: true,
      },
    ];
  });

  const localEnvironmentRows = createMemo<readonly RuntimeDetailRow[]>(() => [
    {
      label: i18n.t('codeRuntime.rows.installedVersions'),
      value: String(installedVersions().length),
      note: installedVersions().length > 0 ? i18n.t('codeRuntime.notes.installedVersionsAvailable') : i18n.t('codeRuntime.notes.noInstalledVersionsAvailable'),
    },
  ]);

  const removalOperationSummary = createMemo(() => {
    if (operationRunning()) {
      return i18n.t('codeRuntime.removal.runningSummary');
    }
    if (operationFailed()) {
      return i18n.t('codeRuntime.removal.failedSummary');
    }
    if (operationCancelled()) {
      return i18n.t('codeRuntime.removal.cancelledSummary');
    }
    return '';
  });

  const busy = createMemo(() => operationRunning() || props.actionLoading || Boolean(props.selectionLoadingVersion) || Boolean(props.removeVersionLoading));

  const confirmPrepare = async () => {
    await props.onPrepare();
    setPrepareConfirmOpen(false);
  };

  const confirmRemoveVersion = async () => {
    const target = removeVersionConfirmOpen();
    if (!target) return;
    await props.onRemoveVersion(target);
    setRemoveVersionConfirmOpen(null);
  };

  return (
    <>
      <SettingsSection
        icon={Code}
        title={i18n.t('codeRuntime.title')}
        description={i18n.t('codeRuntime.description')}
        badge={operationRunning() ? operationLabel(props.status, i18n) : runtimeReady() ? i18n.t('common.status.ready') : i18n.t('codeRuntime.needsSetup')}
        badgeVariant={operationRunning() ? 'warning' : runtimeReady() ? 'success' : 'warning'}
        error={props.error}
        actions={
          <>
            <ActionButtonTooltip content={refreshActionTooltip()} disabled={props.loading}>
              <Button size="sm" variant="outline" onClick={props.onRefresh} disabled={props.loading}>
                <RefreshIcon class="mr-2 h-4 w-4" />
                {props.loading ? i18n.t('codeRuntime.refreshing') : refreshActionLabel()}
              </Button>
            </ActionButtonTooltip>
            <Show
              when={operationRunning()}
              fallback={
                <>
                  <ActionButtonTooltip
                    content={prepareActionTooltip()}
                    disabled={!props.canInteract || !props.canManage || props.actionLoading}
                  >
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => setPrepareConfirmOpen(true)}
                      disabled={!props.canInteract || !props.canManage || props.actionLoading}
                    >
                      {props.actionLoading ? localizedPrepareCopy().runningLabel : prepareActionLabel()}
                    </Button>
                  </ActionButtonTooltip>
                </>
              }
            >
              <ActionButtonTooltip
                content={cancelActionTooltip()}
                disabled={!props.canInteract || !props.canManage || props.cancelLoading}
              >
              <Button size="sm" variant="outline" onClick={() => void props.onCancel()} disabled={!props.canInteract || !props.canManage || props.cancelLoading}>
                  {props.cancelLoading ? i18n.t('codeRuntime.cancelling') : cancelActionLabel()}
                </Button>
              </ActionButtonTooltip>
            </Show>
          </>
        }
      >
        <div class="space-y-4">
          <Show when={!props.canManage}>
            <div class="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              {i18n.t('codeRuntime.manageRequiresRwx')}
            </div>
          </Show>

          <Show when={showSetupActivity()}>
            <BrowserEditorSetupActivityPanel
              activity={setupActivity()}
              loading={props.loading}
              prepareSubmitting={props.actionLoading}
              cancelSubmitting={props.cancelLoading}
              actionLabel={setupActivity().can_retry ? i18n.t('codeRuntime.prepare.retry.actionLabel') : prepareActionLabel()}
              runningLabel={localizedPrepareCopy().runningLabel}
              onPrepare={props.canInteract && props.canManage ? () => void props.onPrepare() : undefined}
              onRefresh={props.onRefresh}
              onCancel={props.canInteract && props.canManage ? () => void props.onCancel() : undefined}
              extraDetails={setupActivity().state === 'missing' || setupActivity().state === 'checking' ? undefined : (
                <div class="grid gap-2 rounded-md border border-border bg-background/70 p-3 text-[11px] leading-5 text-muted-foreground">
                  <Show when={props.status?.operation.target_version}>
                    <div>{i18n.t('codeRuntime.targetVersion')}: <span class="font-mono text-foreground">{props.status?.operation.target_version}</span></div>
                  </Show>
                  <div>{i18n.t('codeRuntime.sharedEditorRoot')}: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root || '-'}</span></div>
                  <div>{i18n.t('codeRuntime.selectedEditorPath')}: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix || '-'}</span></div>
                </div>
              )}
            />
          </Show>

          <Show when={showRemovalOperation()}>
            <div class="rounded-lg border border-border bg-muted/20 p-4">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-sm font-semibold text-foreground">{i18n.t('codeRuntime.recentRuntimeOperation')}</div>
                <SettingsPill tone={operationRunning() ? 'warning' : operationFailed() ? 'warning' : operationCancelled() ? 'warning' : 'success'}>
                  {operationLabel(props.status, i18n)}
                </SettingsPill>
              </div>
              <div class="mt-2 text-sm text-muted-foreground">{removalOperationSummary()}</div>
              <Show when={props.status?.operation.target_version}>
                <div class="mt-2 text-xs text-muted-foreground">
                  {i18n.t('codeRuntime.targetVersion')}: <span class="font-mono text-foreground">{props.status?.operation.target_version}</span>
                </div>
              </Show>
              <Show when={props.status?.operation.last_error}>
                <div class="mt-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  {props.status?.operation.last_error}
                </div>
              </Show>
              <pre class="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background/80 p-3 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                {operationLogTail().length > 0 ? operationLogTail().join('\n') : i18n.t('codeRuntime.noRuntimeOutput')}
              </pre>
            </div>
          </Show>

          <RuntimeDetailsTableSection title={i18n.t('codeRuntime.currentEditorSection')} rows={currentRuntimeRows()} />
          <RuntimeDetailsTableSection title={i18n.t('codeRuntime.installedEditorVersionsSection')} rows={localEnvironmentRows()} />

          <Show
            when={installedVersions().length > 0}
            fallback={
              <HighlightBlock variant="warning" title={i18n.t('codeRuntime.setupRequiredTitle')}>
                <div class="space-y-2 text-sm text-muted-foreground">
                  <div>{i18n.t('codeRuntime.setupRequiredDescription')}</div>
                  <div>{i18n.t('codeRuntime.setupRequiresConfirmation')}</div>
                </div>
              </HighlightBlock>
            }
          >
            <div class="space-y-3">
              <div class="text-sm font-semibold text-foreground">{i18n.t('codeRuntime.installedEditorVersionsSection')}</div>
              <For each={installedVersions()}>
                {(version) => (
                  <VersionRow
                    version={version}
                    canInteract={props.canInteract}
                    canManage={props.canManage}
                    busy={busy()}
                    onUse={(selectedVersion) => void props.onSelectVersion(selectedVersion)}
                    onRemove={(selectedVersion) => setRemoveVersionConfirmOpen(selectedVersion)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </SettingsSection>

      <ConfirmDialog
        open={prepareConfirmOpen()}
        onOpenChange={(open) => setPrepareConfirmOpen(open)}
        title={localizedPrepareCopy().confirmTitle}
        confirmText={prepareActionLabel()}
        loading={props.actionLoading}
        onConfirm={() => void confirmPrepare()}
      >
        <div class="space-y-3">
          <p class="text-sm">
            {prepareCopy().intent === 'update'
              ? i18n.t('codeRuntime.confirm.updateDescription')
              : localizedPrepareCopy().description}
          </p>
          <p class="text-sm text-muted-foreground">{i18n.t('codeRuntime.confirm.workspaceFilesStay')}</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>{i18n.t('codeRuntime.sharedEngineRoot')}: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root || '-'}</span></div>
            <div>{i18n.t('codeRuntime.selectedEditorPath')}: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix || '-'}</span></div>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(removeVersionConfirmOpen())}
        onOpenChange={(open) => setRemoveVersionConfirmOpen(open ? removeVersionConfirmOpen() : null)}
        title={i18n.t('codeRuntime.removeDialogTitle')}
        confirmText={i18n.t('codeRuntime.removeVersionAction')}
        loading={Boolean(props.removeVersionLoading)}
        onConfirm={() => void confirmRemoveVersion()}
      >
        <div class="space-y-3">
          <p class="text-sm">{i18n.t('codeRuntime.removeDialogDescription')}</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>{i18n.t('codeRuntime.targetVersion')}: <span class="font-mono text-foreground">{removeVersionConfirmOpen() || '-'}</span></div>
            <div>{i18n.t('codeRuntime.sharedRuntimeRoot')}: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root || '-'}</span></div>
          </div>
          <p class="text-xs text-muted-foreground">{i18n.t('codeRuntime.removeDialogSafeNote')}</p>
        </div>
      </ConfirmDialog>
    </>
  );
}
