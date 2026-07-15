import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { Code, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog, HighlightBlock } from '@floegence/floe-webapp-core/ui';

import {
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationRunning,
  codeRuntimePrepareIntent,
  codeRuntimeReady,
  type CodeRuntimeInstalledVersion,
  type CodeRuntimeStatus,
} from '../../services/codeRuntimeApi';
import {
  browserEditorPlatformLabel,
  buildBrowserEditorSetupActivity,
  localizeBrowserEditorPrepareCopy,
  localizeBrowserEditorSetupActivity,
  type BrowserEditorSetupLocalFailure,
} from '../../services/browserEditorSetupActivity';
import type { BrowserEditorSetupProgress } from '../../services/browserEditorSetupProgress';
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
  localPrepareCancelled?: boolean;
  prepareProgress?: BrowserEditorSetupProgress | null;
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
  const [dismissedSetupActivityKey, setDismissedSetupActivityKey] = createSignal<string | null>(null);

  const runtimeReady = createMemo(() => codeRuntimeReady(props.status));
  const operationRunning = createMemo(() => codeRuntimeOperationRunning(props.status));
  const operationFailed = createMemo(() => codeRuntimeOperationFailed(props.status));
  const operationCancelled = createMemo(() => codeRuntimeOperationCancelled(props.status));
  const operationNeedsAttention = createMemo(() => codeRuntimeOperationNeedsAttention(props.status));
  const installedVersions = createMemo(() => props.status?.installed_versions ?? []);
  const activeRuntime = createMemo(() => props.status?.active_runtime);
  const prepareIntent = createMemo(() => codeRuntimePrepareIntent(props.status));
  const localizedPrepareCopy = createMemo(() => localizeBrowserEditorPrepareCopy(prepareIntent(), i18n));
  const localPending = createMemo(() => props.actionLoading && !operationRunning());
  const setupActivity = createMemo(() => {
    const activity = buildBrowserEditorSetupActivity({
      status: props.status,
      localPending: localPending(),
      localFailure: props.localPrepareFailure,
      localCancelled: props.localPrepareCancelled,
      localProgress: props.prepareProgress,
    });
    return localizeBrowserEditorSetupActivity(activity, {
      status: props.status,
      loading: props.loading,
      localPending: localPending(),
      localFailure: props.localPrepareFailure,
      localCancelled: props.localPrepareCancelled,
      localProgress: props.prepareProgress,
      prepareDescription: localizedPrepareCopy().description,
    }, i18n);
  });
  const setupActivityKey = createMemo(() => [
    setupActivity().state,
    setupActivity().error_code ?? '',
    props.status?.updated_at_unix_ms ?? 0,
    props.localPrepareFailure?.occurred_at_unix_ms ?? 0,
  ].join(':'));
  const platformUnsupported = createMemo(() => Boolean(setupActivity().platform_diagnosis));
  const prepareOperationActive = createMemo(() => String(props.status?.operation.action ?? '').trim() === 'prepare_workspace_engine');
  const showSetupActivity = createMemo(() => (
    dismissedSetupActivityKey() !== setupActivityKey()
    && (
      platformUnsupported()
      || Boolean(props.localPrepareFailure)
      || Boolean(props.localPrepareCancelled)
      || props.actionLoading
      || (prepareOperationActive() && (operationRunning() || operationNeedsAttention()))
    )
  ));
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
                <Show when={!platformUnsupported()}>
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
                </Show>
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
              layout="compact"
              loading={props.loading}
              prepareSubmitting={props.actionLoading}
              cancelSubmitting={props.cancelLoading}
              actionLabel={setupActivity().can_retry ? i18n.t('codeRuntime.prepare.retry.actionLabel') : prepareActionLabel()}
              runningLabel={localizedPrepareCopy().runningLabel}
              onPrepare={props.canInteract && props.canManage ? () => void props.onPrepare() : undefined}
              onRefresh={props.onRefresh}
              onCancel={props.canInteract && props.canManage ? () => void props.onCancel() : undefined}
              onDismiss={() => setDismissedSetupActivityKey(setupActivityKey())}
              extraDetails={setupActivity().state === 'missing' || setupActivity().state === 'checking' ? undefined : (
                <dl class="browser-editor-setup__detail-list">
                  <div class="browser-editor-setup__detail-row">
                    <dt>{i18n.t('codeRuntime.activity.platform.environmentPlatform')}</dt>
                    <dd data-mono="true">{browserEditorPlatformLabel(props.status?.platform)}</dd>
                  </div>
                  <Show when={setupActivity().error_code}>
                    {(errorCode) => (
                      <div class="browser-editor-setup__detail-row">
                        <dt>{i18n.t('codeRuntime.activity.platform.errorCode')}</dt>
                        <dd data-mono="true">{errorCode()}</dd>
                      </div>
                    )}
                  </Show>
                  <Show when={props.status?.operation.target_version}>
                    {(targetVersion) => (
                      <div class="browser-editor-setup__detail-row">
                        <dt>{i18n.t('codeRuntime.targetVersion')}</dt>
                        <dd data-mono="true">{targetVersion()}</dd>
                      </div>
                    )}
                  </Show>
                  <div class="browser-editor-setup__detail-row">
                    <dt>{i18n.t('codeRuntime.sharedEditorRoot')}</dt>
                    <dd data-mono="true">{props.status?.shared_runtime_root || '-'}</dd>
                  </div>
                  <div class="browser-editor-setup__detail-row">
                    <dt>{i18n.t('codeRuntime.selectedEditorPath')}</dt>
                    <dd data-mono="true">{props.status?.managed_prefix || '-'}</dd>
                  </div>
                </dl>
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
              <Show when={!platformUnsupported()}>
                <HighlightBlock variant="warning" title={i18n.t('codeRuntime.setupRequiredTitle')}>
                  <div class="space-y-2 text-sm text-muted-foreground">
                    <div>{i18n.t('codeRuntime.setupRequiredDescription')}</div>
                    <div>{i18n.t('codeRuntime.setupRequiresConfirmation')}</div>
                  </div>
                </HighlightBlock>
              </Show>
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
            {prepareIntent() === 'update'
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
