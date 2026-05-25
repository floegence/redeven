import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { Code, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog, HighlightBlock } from '@floegence/floe-webapp-core/ui';

import {
  codeRuntimeManagedActionLabel,
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationRunning,
  codeRuntimePrepareCopy,
  codeRuntimeReady,
  codeRuntimeStageLabel,
  type CodeRuntimeInstalledVersion,
  type CodeRuntimeStatus,
} from '../../services/codeRuntimeApi';
import {
  buildBrowserEditorSetupActivity,
  type BrowserEditorSetupLocalFailure,
} from '../../services/browserEditorSetupActivity';
import { Tooltip } from '../../primitives/Tooltip';
import { BrowserEditorSetupActivityPanel } from '../BrowserEditorSetupActivityPanel';
import { SettingsCard, SettingsKeyValueTable, SettingsPill } from './SettingsPrimitives';

type RuntimeDetailRow = Readonly<{
  label: string;
  value: JSX.Element | string;
  note?: JSX.Element | string;
  mono?: boolean;
}>;

function runtimeSourceLabel(source: string | null | undefined): string {
  switch (String(source ?? '').trim()) {
    case 'managed':
      return 'Managed runtime';
    case 'env_override':
      return 'Environment override';
    case 'system':
      return 'Host runtime discovery';
    default:
      return 'No active runtime';
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

function runtimeStatusLabel(state: string | null | undefined): string {
  switch (String(state ?? '').trim()) {
    case 'ready':
      return 'Ready';
    case 'unusable':
      return 'Needs attention';
    default:
      return 'Unavailable';
  }
}

function operationLabel(status: CodeRuntimeStatus | null | undefined): string {
  const operation = status?.operation;
  if (!operation) return 'Idle';
  if (operation.state === 'running') return codeRuntimeStageLabel(operation.stage, operation.action);
  if (operation.state === 'failed') return operation.action === 'remove_local_environment_version' ? 'Version removal failed' : 'Browser Editor setup failed';
  if (operation.state === 'cancelled') return operation.action === 'remove_local_environment_version' ? 'Version removal cancelled' : 'Browser Editor setup cancelled';
  if (operation.state === 'succeeded') return operation.action === 'remove_local_environment_version' ? 'Version removed' : 'Browser Editor ready';
  return 'Idle';
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
  const detectionTone = () => runtimeStatusTone(props.version.detection_state);

  return (
    <div class="rounded-lg border border-border bg-muted/20 p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <div class="text-sm font-semibold text-foreground">{props.version.version}</div>
            <SettingsPill tone={detectionTone()}>{runtimeStatusLabel(props.version.detection_state)}</SettingsPill>
            <Show when={props.version.selected_by_local_environment}>
              <SettingsPill tone="success">Current editor</SettingsPill>
            </Show>
          </div>
          <div class="grid gap-1 text-[11px] text-muted-foreground">
            <div>
              Binary path: <span class="font-mono text-foreground break-all">{props.version.binary_path || '-'}</span>
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
            Use this version
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onRemove(props.version.version)}
            disabled={!props.canInteract || !props.canManage || props.busy || !props.version.removable}
          >
            Remove version
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
  const setupActivity = createMemo(() => buildBrowserEditorSetupActivity({
    status: props.status,
    localPending: props.actionLoading && !operationRunning(),
    localFailure: props.localPrepareFailure,
  }));
  const prepareOperationActive = createMemo(() => String(props.status?.operation.action ?? '').trim() === 'prepare_workspace_engine');
  const showSetupActivity = createMemo(() => Boolean(props.localPrepareFailure) || props.actionLoading || (prepareOperationActive() && (operationRunning() || operationNeedsAttention())));
  const showRemovalOperation = createMemo(() => !prepareOperationActive() && (operationRunning() || operationNeedsAttention()));
  const operationLogTail = createMemo(() => props.status?.operation.log_tail ?? []);
  const refreshActionLabel = () => 'Refresh';
  const refreshActionTooltip = () => 'Re-scan the Browser Editor inventory and active runtime.';
  const prepareActionLabel = () => codeRuntimeManagedActionLabel(props.status);
  const prepareActionTooltip = () => prepareCopy().intent === 'update' ? 'Update the Browser Editor runtime.' : prepareCopy().tooltip;
  const cancelActionLabel = () => 'Cancel';
  const cancelActionTooltip = () => 'Cancel the current Browser Editor setup.';

  const currentRuntimeRows = createMemo<readonly RuntimeDetailRow[]>(() => {
    const active = activeRuntime();
    return [
      {
        label: 'Managed editor source',
        value: props.status?.managed_runtime_source === 'managed' ? 'Selected managed version' : 'No managed version selected',
        note:
          props.status?.managed_runtime_source === 'managed'
            ? 'Codespaces uses the selected managed Browser Editor version.'
            : 'Set up or select a managed Browser Editor version.',
      },
      {
        label: 'Selected version',
        value: props.status?.managed_runtime_version || 'None',
        note:
          props.status?.managed_runtime_version
            ? 'Managed Browser Editor version currently selected.'
            : 'A value appears here after setup selects a managed version.',
      },
      {
        label: 'Active runtime',
        value: (
          <SettingsPill tone={runtimeStatusTone(active?.detection_state)}>
            {runtimeStatusLabel(active?.detection_state)}
          </SettingsPill>
        ),
        note: active?.error_message || `Codespaces is currently using ${runtimeSourceLabel(active?.source).toLowerCase()}.`,
      },
      {
        label: 'Active source',
        value: runtimeSourceLabel(active?.source),
        note:
          active?.source === 'env_override'
            ? 'An environment override currently takes precedence over managed and host discovery.'
            : active?.source === 'system'
              ? 'Host discovery is active because no managed runtime is selected.'
              : active?.source === 'managed'
                ? 'A managed Browser Editor runtime is currently active.'
                : 'No active Browser Editor runtime is currently available.',
      },
      {
        label: 'Active editor path',
        value: active?.binary_path || 'Not detected',
        note: 'Executable path used when Codespaces launches.',
        mono: true,
      },
      {
        label: 'Selected editor path',
        value: props.status?.managed_prefix || '-',
        note: 'This path points at the selected managed Browser Editor version.',
        mono: true,
      },
      {
        label: 'Shared runtime root',
        value: props.status?.shared_runtime_root || '-',
        note: 'Browser Editor versions are stored here once per host.',
        mono: true,
      },
    ];
  });

  const localEnvironmentRows = createMemo<readonly RuntimeDetailRow[]>(() => [
    {
      label: 'Installed versions',
      value: String(installedVersions().length),
      note: installedVersions().length > 0 ? 'Browser Editor versions currently available.' : 'No Browser Editor versions are currently available.',
    },
  ]);

  const removalOperationSummary = createMemo(() => {
    if (operationRunning()) {
      return 'Redeven is removing one managed Browser Editor version after your explicit request.';
    }
    if (operationFailed()) {
      return 'The last Browser Editor version removal did not finish successfully. Review the recent output below before retrying.';
    }
    if (operationCancelled()) {
      return 'The last Browser Editor version removal was cancelled before Redeven finished validating the result.';
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
      <SettingsCard
        icon={Code}
        title="Browser Editor"
        description="Manage the browser-based editor used by Codespaces."
        badge={operationRunning() ? operationLabel(props.status) : runtimeReady() ? 'Ready' : 'Needs setup'}
        badgeVariant={operationRunning() ? 'warning' : runtimeReady() ? 'success' : 'warning'}
        error={props.error}
        actions={
          <>
            <ActionButtonTooltip content={refreshActionTooltip()} disabled={props.loading}>
              <Button size="sm" variant="outline" onClick={props.onRefresh} disabled={props.loading}>
                <RefreshIcon class="mr-2 h-4 w-4" />
                {props.loading ? 'Refreshing...' : refreshActionLabel()}
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
                      {props.actionLoading ? prepareCopy().running_label : prepareActionLabel()}
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
                  {props.cancelLoading ? 'Cancelling...' : cancelActionLabel()}
                </Button>
              </ActionButtonTooltip>
            </Show>
          </>
        }
      >
        <div class="space-y-4">
          <Show when={!props.canManage}>
            <div class="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              Setting up, selecting, or removing Browser Editor versions requires read, write, and execute access for this session.
            </div>
          </Show>

          <Show when={showSetupActivity()}>
            <BrowserEditorSetupActivityPanel
              activity={setupActivity()}
              loading={props.loading}
              prepareSubmitting={props.actionLoading}
              cancelSubmitting={props.cancelLoading}
              actionLabel={setupActivity().can_retry ? 'Retry setup' : prepareActionLabel()}
              runningLabel={prepareCopy().running_label}
              onPrepare={props.canInteract && props.canManage ? () => void props.onPrepare() : undefined}
              onRefresh={props.onRefresh}
              onCancel={props.canInteract && props.canManage ? () => void props.onCancel() : undefined}
              extraDetails={setupActivity().state === 'missing' || setupActivity().state === 'checking' ? undefined : (
                <div class="grid gap-2 rounded-md border border-border bg-background/70 p-3 text-[11px] leading-5 text-muted-foreground">
                  <Show when={props.status?.operation.target_version}>
                    <div>Target version: <span class="font-mono text-foreground">{props.status?.operation.target_version}</span></div>
                  </Show>
                  <div>Shared editor root: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root || '-'}</span></div>
                  <div>Selected editor path: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix || '-'}</span></div>
                </div>
              )}
            />
          </Show>

          <Show when={showRemovalOperation()}>
            <div class="rounded-lg border border-border bg-muted/20 p-4">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-sm font-semibold text-foreground">Recent runtime operation</div>
                <SettingsPill tone={operationRunning() ? 'warning' : operationFailed() ? 'warning' : operationCancelled() ? 'warning' : 'success'}>
                  {operationLabel(props.status)}
                </SettingsPill>
              </div>
              <div class="mt-2 text-sm text-muted-foreground">{removalOperationSummary()}</div>
              <Show when={props.status?.operation.target_version}>
                <div class="mt-2 text-xs text-muted-foreground">
                  Target version: <span class="font-mono text-foreground">{props.status?.operation.target_version}</span>
                </div>
              </Show>
              <Show when={props.status?.operation.last_error}>
                <div class="mt-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  {props.status?.operation.last_error}
                </div>
              </Show>
              <pre class="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background/80 p-3 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
                {operationLogTail().length > 0 ? operationLogTail().join('\n') : 'No runtime output yet.'}
              </pre>
            </div>
          </Show>

          <RuntimeDetailsTableSection title="Current editor" rows={currentRuntimeRows()} />
          <RuntimeDetailsTableSection title="Installed editor versions" rows={localEnvironmentRows()} />

          <Show
            when={installedVersions().length > 0}
            fallback={
              <HighlightBlock variant="warning" title="Browser Editor setup required">
                <div class="space-y-2 text-sm text-muted-foreground">
                  <div>Set up the browser editor before opening codespaces.</div>
                  <div>Desktop will download the editor to this computer and send it only after you confirm.</div>
                </div>
              </HighlightBlock>
            }
          >
            <div class="space-y-3">
              <div class="text-sm font-semibold text-foreground">Installed editor versions</div>
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
      </SettingsCard>

      <ConfirmDialog
        open={prepareConfirmOpen()}
        onOpenChange={(open) => setPrepareConfirmOpen(open)}
        title={prepareCopy().confirm_title}
        confirmText={prepareActionLabel()}
        loading={props.actionLoading}
        onConfirm={() => void confirmPrepare()}
      >
        <div class="space-y-3">
          <p class="text-sm">
            {prepareCopy().intent === 'update'
              ? 'Redeven Desktop will update the Browser Editor by downloading the latest editor to this computer and sending it to the connected environment.'
              : prepareCopy().description}
          </p>
          <p class="text-sm text-muted-foreground">Workspace files stay in that environment. Setup starts only after you confirm.</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>Shared engine root: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root || '-'}</span></div>
            <div>Selected editor path: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix || '-'}</span></div>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(removeVersionConfirmOpen())}
        onOpenChange={(open) => setRemoveVersionConfirmOpen(open ? removeVersionConfirmOpen() : null)}
        title="Remove editor version"
        confirmText="Remove version"
        loading={Boolean(props.removeVersionLoading)}
        onConfirm={() => void confirmRemoveVersion()}
      >
        <div class="space-y-3">
          <p class="text-sm">This removes one managed Browser Editor version only when it is not the current selection.</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>Target version: <span class="font-mono text-foreground">{removeVersionConfirmOpen() || '-'}</span></div>
            <div>Shared runtime root: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root || '-'}</span></div>
          </div>
          <p class="text-xs text-muted-foreground">This does not delete any workspace files. Redeven blocks the action when the selected version is still active.</p>
        </div>
      </ConfirmDialog>
    </>
  );
}
