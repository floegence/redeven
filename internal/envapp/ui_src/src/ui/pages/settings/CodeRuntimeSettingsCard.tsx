import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { Code, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog, HighlightBlock } from '@floegence/floe-webapp-core/ui';

import {
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationRunning,
  codeRuntimeReady,
  codeRuntimeStageLabel,
  type CodeRuntimeInstalledVersion,
  type CodeRuntimeStatus,
} from '../../services/codeRuntimeApi';
import { Tooltip } from '../../primitives/Tooltip';
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
  if (operation.state === 'failed') return operation.action === 'remove_local_environment_version' ? 'Version removal failed' : 'Install failed';
  if (operation.state === 'cancelled') return operation.action === 'remove_local_environment_version' ? 'Version removal cancelled' : 'Install cancelled';
  if (operation.state === 'succeeded') return operation.action === 'remove_local_environment_version' ? 'Version removed' : 'Install completed';
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
              <SettingsPill tone="success">Current Local Environment</SettingsPill>
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
            Use for this Local Environment
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => props.onRemove(props.version.version)}
            disabled={!props.canInteract || !props.canManage || props.busy || !props.version.removable}
          >
            Remove from Local Environment
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
  canInteract: boolean;
  canManage: boolean;
  actionLoading: boolean;
  cancelLoading: boolean;
  selectionLoadingVersion: string | null;
  removeVersionLoading: string | null;
  onRefresh: () => void;
  onInstall: () => Promise<void> | void;
  onSelectVersion: (version: string) => Promise<void> | void;
  onRemoveVersion: (version: string) => Promise<void> | void;
  onCancel: () => Promise<void> | void;
}

export function CodeRuntimeSettingsCard(props: CodeRuntimeSettingsCardProps) {
  const [installConfirmOpen, setInstallConfirmOpen] = createSignal(false);
  const [removeVersionConfirmOpen, setRemoveVersionConfirmOpen] = createSignal<string | null>(null);

  const runtimeReady = createMemo(() => codeRuntimeReady(props.status));
  const operationRunning = createMemo(() => codeRuntimeOperationRunning(props.status));
  const operationFailed = createMemo(() => codeRuntimeOperationFailed(props.status));
  const operationCancelled = createMemo(() => codeRuntimeOperationCancelled(props.status));
  const operationNeedsAttention = createMemo(() => codeRuntimeOperationNeedsAttention(props.status));
  const installedVersions = createMemo(() => props.status?.installed_versions ?? []);
  const activeRuntime = createMemo(() => props.status?.active_runtime);
  const refreshActionLabel = () => 'Refresh';
  const refreshActionTooltip = () => 'Re-scan the Local Environment inventory and the active runtime.';
  const installActionLabel = () => 'Install latest';
  const installActionTooltip = () => 'Install the latest stable managed code-server for this Local Environment, then select it.';
  const cancelActionLabel = () => 'Cancel';
  const cancelActionTooltip = () => 'Cancel the current managed runtime install.';

  const currentRuntimeRows = createMemo<readonly RuntimeDetailRow[]>(() => {
    const active = activeRuntime();
    return [
      {
        label: 'Managed runtime source',
        value: props.status?.managed_runtime_source === 'managed' ? 'Current Local Environment selection' : 'No managed selection',
        note:
          props.status?.managed_runtime_source === 'managed'
            ? 'This Local Environment selects one managed runtime version.'
            : 'Install or select a managed runtime version for this Local Environment.',
      },
      {
        label: 'Selected version',
        value: props.status?.managed_runtime_version || 'None',
        note:
          props.status?.managed_runtime_version
            ? 'Managed version currently selected for this Local Environment.'
            : 'A value appears here after this Local Environment selects a managed version.',
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
                ? 'A managed runtime is currently active for this Local Environment.'
                : 'No active code-server runtime is currently available.',
      },
      {
        label: 'Active binary path',
        value: active?.binary_path || 'Not detected',
        note: 'Executable path used when Codespaces launches.',
        mono: true,
      },
      {
        label: 'Local Environment link path',
        value: props.status?.managed_prefix || '-',
        note: 'This path points at the selected Local Environment runtime version.',
        mono: true,
      },
      {
        label: 'Shared runtime root',
        value: props.status?.shared_runtime_root || '-',
        note: 'Managed runtime versions for this Local Environment are stored here once per host.',
        mono: true,
      },
    ];
  });

  const localEnvironmentRows = createMemo<readonly RuntimeDetailRow[]>(() => [
    {
      label: 'Installed versions',
      value: String(installedVersions().length),
      note: installedVersions().length > 0 ? 'Managed versions currently installed for this Local Environment.' : 'No managed versions are currently installed for this Local Environment.',
    },
    {
      label: 'Installer URL',
      value: props.status?.installer_script_url || '-',
      note: 'Redeven runs the official latest-stable installer only after you explicitly confirm the action.',
      mono: true,
    },
  ]);

  const operationSummary = createMemo(() => {
    if (operationRunning()) {
      return props.status?.operation.action === 'remove_local_environment_version'
        ? 'Redeven is removing one Local Environment runtime version after your explicit request.'
        : 'Redeven is installing the latest stable managed runtime for this Local Environment and then selecting it.';
    }
    if (operationFailed()) {
      return 'The last Local Environment runtime action did not finish successfully. Review the recent output below before retrying.';
    }
    if (operationCancelled()) {
      return 'The last Local Environment runtime action was cancelled before Redeven finished validating the result.';
    }
    return '';
  });

  const busy = createMemo(() => operationRunning() || props.actionLoading || Boolean(props.selectionLoadingVersion) || Boolean(props.removeVersionLoading));

  const confirmInstall = async () => {
    await props.onInstall();
    setInstallConfirmOpen(false);
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
        title="code-server Runtime"
        description="Manage the code-server runtime inventory and the current managed version for this Local Environment."
        badge={operationRunning() ? operationLabel(props.status) : runtimeReady() ? 'Local Environment ready' : 'Runtime needs action'}
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
                    content={installActionTooltip()}
                    disabled={!props.canInteract || !props.canManage || props.actionLoading}
                  >
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => setInstallConfirmOpen(true)}
                      disabled={!props.canInteract || !props.canManage || props.actionLoading}
                    >
                      {props.actionLoading ? 'Starting...' : installActionLabel()}
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
              Installing, selecting, or removing Local Environment runtime versions requires read, write, and execute access for this session.
            </div>
          </Show>

          <Show when={operationRunning() || operationNeedsAttention()}>
            <div class="rounded-lg border border-border bg-muted/20 p-4">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-sm font-semibold text-foreground">Recent runtime operation</div>
                <SettingsPill tone={operationRunning() ? 'warning' : operationFailed() ? 'warning' : operationCancelled() ? 'warning' : 'success'}>
                  {operationLabel(props.status)}
                </SettingsPill>
              </div>
              <div class="mt-2 text-sm text-muted-foreground">{operationSummary()}</div>
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
                {(props.status?.operation.log_tail?.length ?? 0) > 0 ? props.status?.operation.log_tail?.join('\n') : 'No runtime output yet.'}
              </pre>
            </div>
          </Show>

          <RuntimeDetailsTableSection title="Current Local Environment" rows={currentRuntimeRows()} />
          <RuntimeDetailsTableSection title="Installed for this Local Environment" rows={localEnvironmentRows()} />

          <Show
            when={installedVersions().length > 0}
            fallback={
              <HighlightBlock variant="warning" title="No managed versions installed">
                <div class="space-y-2 text-sm text-muted-foreground">
                  <div>Install the latest stable managed runtime for this Local Environment.</div>
                  <div>This action affects the Local Environment inventory, then selects the installed version.</div>
                </div>
              </HighlightBlock>
            }
          >
            <div class="space-y-3">
              <div class="text-sm font-semibold text-foreground">Installed versions</div>
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
        open={installConfirmOpen()}
        onOpenChange={(open) => setInstallConfirmOpen(open)}
        title="Install latest runtime"
        confirmText={installActionLabel()}
        loading={props.actionLoading}
        onConfirm={() => void confirmInstall()}
      >
        <div class="space-y-3">
          <p class="text-sm">Redeven will install the latest stable managed code-server runtime into the Local Environment inventory, then select it.</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>Shared runtime root: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root || '-'}</span></div>
            <div>Local Environment link: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix || '-'}</span></div>
            <div>Installer URL: <span class="font-mono text-foreground break-all">{props.status?.installer_script_url || '-'}</span></div>
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(removeVersionConfirmOpen())}
        onOpenChange={(open) => setRemoveVersionConfirmOpen(open ? removeVersionConfirmOpen() : null)}
        title="Remove from Local Environment"
        confirmText="Remove from Local Environment"
        loading={Boolean(props.removeVersionLoading)}
        onConfirm={() => void confirmRemoveVersion()}
      >
        <div class="space-y-3">
          <p class="text-sm">This removes one managed version from the Local Environment inventory only when it is not the current selection.</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>Target version: <span class="font-mono text-foreground">{removeVersionConfirmOpen() || '-'}</span></div>
            <div>Shared runtime root: <span class="font-mono text-foreground break-all">{props.status?.shared_runtime_root || '-'}</span></div>
          </div>
          <p class="text-xs text-muted-foreground">This does not delete any workspace files. Redeven blocks the action when the selected version is still active for this Local Environment.</p>
        </div>
      </ConfirmDialog>
    </>
  );
}
