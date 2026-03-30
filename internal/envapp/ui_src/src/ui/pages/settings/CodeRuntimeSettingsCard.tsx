import { Show, createMemo, createSignal, type JSX } from 'solid-js';
import { Code, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog } from '@floegence/floe-webapp-core/ui';

import {
  codeRuntimeManagedActionLabel,
  codeRuntimeManagedInstalled,
  codeRuntimeManagedRuntimeSelected,
  codeRuntimeOperationCancelled,
  codeRuntimeOperationFailed,
  codeRuntimeOperationNeedsAttention,
  codeRuntimeOperationRunning,
  codeRuntimeReady,
  codeRuntimeStageLabel,
  type CodeRuntimeStatus,
} from '../../services/codeRuntimeApi';
import { SettingsCard, SettingsKeyValueTable, SettingsPill } from './SettingsPrimitives';

type RuntimeDetailRow = Readonly<{
  label: string;
  value: JSX.Element | string;
  note?: JSX.Element | string;
  mono?: boolean;
}>;

type RuntimeMetaItem = Readonly<{
  label: string;
  value: string;
  mono?: boolean;
}>;

type RuntimePanelTone = 'default' | 'warning' | 'success' | 'danger';

function RuntimeDetailsTableSection(props: { title: string; rows: readonly RuntimeDetailRow[] }) {
  return (
    <div class="space-y-2">
      <div class="text-sm font-semibold text-foreground">{props.title}</div>
      <SettingsKeyValueTable rows={props.rows} minWidthClass="min-w-[40rem]" />
    </div>
  );
}

function runtimePanelClass(tone: RuntimePanelTone): string {
  switch (tone) {
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/[0.06]';
    case 'success':
      return 'border-emerald-500/30 bg-emerald-500/[0.05]';
    case 'danger':
      return 'border-destructive/20 bg-destructive/10';
    default:
      return 'border-border bg-muted/20';
  }
}

function RuntimeStatePanel(props: {
  title: string;
  summary: string;
  tone?: RuntimePanelTone;
  badge?: string;
  meta?: readonly RuntimeMetaItem[];
  error?: string | null;
  outputTitle?: string;
  output?: string;
  outputOpen?: boolean;
}) {
  const tone = () => props.tone ?? 'default';
  const meta = () => props.meta ?? [];
  const output = () => String(props.output ?? '').trim();

  return (
    <div class={`rounded-lg border p-4 ${runtimePanelClass(tone())}`}>
      <div class="space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <div class="text-sm font-semibold text-foreground">{props.title}</div>
          <Show when={props.badge}>
            <SettingsPill tone={tone()}>{props.badge}</SettingsPill>
          </Show>
        </div>

        <div class="text-sm leading-relaxed text-muted-foreground">{props.summary}</div>

        <Show when={props.error}>
          <div class="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
            {props.error}
          </div>
        </Show>

        <Show when={meta().length > 0}>
          <div class="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
            {meta().map((item) => (
              <div>
                {item.label}:{' '}
                <span class={item.mono ? 'font-mono text-foreground break-all' : 'text-foreground'}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </Show>

        <Show when={output()}>
          <details open={props.outputOpen} class="rounded-md border border-border bg-background/80">
            <summary class="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
              {props.outputTitle || 'Recent runtime output'}
            </summary>
            <pre class="max-h-52 overflow-auto border-t border-border px-3 py-3 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
              {output()}
            </pre>
          </details>
        </Show>
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
  uninstallLoading: boolean;
  cancelLoading: boolean;
  onRefresh: () => void;
  onInstall: () => Promise<void> | void;
  onUninstall: () => Promise<void> | void;
  onCancel: () => Promise<void> | void;
}

function runtimeSourceLabel(source: string | null | undefined): string {
  switch (String(source ?? '').trim()) {
    case 'managed':
      return 'Redeven-managed runtime';
    case 'env_override':
      return 'Environment override';
    case 'system':
      return 'Host runtime discovery';
    case 'none':
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
      return 'Not installed';
  }
}

function operationTone(state: string | null | undefined): RuntimePanelTone {
  switch (String(state ?? '').trim()) {
    case 'running':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'warning';
    case 'succeeded':
      return 'success';
    default:
      return 'default';
  }
}

function operationLabel(status: CodeRuntimeStatus | null | undefined): string {
  const operation = status?.operation;
  if (!operation) return 'Idle';
  if (operation.state === 'running') return codeRuntimeStageLabel(operation.stage, operation.action);
  if (operation.state === 'failed') return operation.action === 'uninstall' ? 'Uninstall failed' : 'Install or update failed';
  if (operation.state === 'cancelled') return operation.action === 'uninstall' ? 'Uninstall cancelled' : 'Install or update cancelled';
  if (operation.state === 'succeeded') return operation.action === 'uninstall' ? 'Uninstall completed' : 'Install completed';
  return 'Idle';
}

function normalizedValue(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

export function CodeRuntimeSettingsCard(props: CodeRuntimeSettingsCardProps) {
  const [installConfirmOpen, setInstallConfirmOpen] = createSignal(false);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = createSignal(false);

  const runtimeReady = createMemo(() => codeRuntimeReady(props.status));
  const activeRuntime = createMemo(() => props.status?.active_runtime);
  const managedRuntime = createMemo(() => props.status?.managed_runtime);
  const managedInstalled = createMemo(() => codeRuntimeManagedInstalled(props.status));
  const managedSelected = createMemo(() => codeRuntimeManagedRuntimeSelected(props.status));
  const operationRunning = createMemo(() => codeRuntimeOperationRunning(props.status));
  const operationFailed = createMemo(() => codeRuntimeOperationFailed(props.status));
  const operationCancelled = createMemo(() => codeRuntimeOperationCancelled(props.status));
  const operationNeedsAttention = createMemo(() => codeRuntimeOperationNeedsAttention(props.status));
  const installActionLabel = createMemo(() => codeRuntimeManagedActionLabel(props.status));
  const activeRuntimeSource = createMemo(() => normalizedValue(activeRuntime()?.source));
  const managedRuntimeMatchesCurrent = createMemo(() => {
    const active = activeRuntime();
    const managed = managedRuntime();
    return (
      activeRuntimeSource() === 'managed' &&
      active?.detection_state === 'ready' &&
      managed?.present === true &&
      managed?.detection_state === 'ready' &&
      normalizedValue(active?.binary_path) !== '' &&
      normalizedValue(active?.binary_path) === normalizedValue(managed?.binary_path)
    );
  });

  const showInstallableStatePanel = createMemo(() => {
    if (operationRunning()) return false;
    if (operationNeedsAttention()) return false;
    return !runtimeReady() && !managedInstalled();
  });

  const showCurrentRuntimeSection = createMemo(() => !operationRunning() && !showInstallableStatePanel());

  const showManagedRuntimeSection = createMemo(() => {
    if (!showCurrentRuntimeSection()) return false;
    const managed = managedRuntime();
    if (!managedInstalled()) return false;
    if (managed?.detection_state !== 'ready') return true;
    if (normalizedValue(managed?.error_message) !== '') return true;
    return !managedRuntimeMatchesCurrent();
  });

  const showOperationPanel = createMemo(() => operationRunning() || operationNeedsAttention());

  const cardBadge = createMemo(() => {
    if (operationRunning()) return props.status?.operation.action === 'uninstall' ? 'Removing runtime' : 'Installing runtime';
    if (runtimeReady()) {
      switch (activeRuntimeSource()) {
        case 'managed':
          return 'Current runtime ready';
        case 'env_override':
          return 'Override runtime ready';
        case 'system':
          return 'Host runtime ready';
        default:
          return 'Current runtime ready';
      }
    }
    if (managedInstalled()) return 'Managed runtime installed';
    return 'Runtime needs install';
  });

  const cardBadgeVariant = createMemo<'default' | 'warning' | 'success'>(() => {
    if (operationRunning()) return 'warning';
    if (runtimeReady()) return 'success';
    return 'warning';
  });

  const activeSummary = createMemo(() => {
    const active = activeRuntime();
    if (!active) return 'Codespaces needs a usable code-server runtime before it can start.';
    if (active.detection_state === 'ready') {
      switch (normalizedValue(active.source)) {
        case 'managed':
          return 'Codespaces is currently using the Redeven-managed runtime.';
        case 'env_override':
          return 'Codespaces is currently using the runtime path provided through environment override.';
        case 'system':
          return 'Codespaces is currently using a host runtime.';
        default:
          return 'Codespaces is currently using a runtime.';
      }
    }
    return active.error_message || 'Codespaces needs a usable code-server runtime before it can start.';
  });

  const managedSummary = createMemo(() => {
    const status = props.status;
    const managed = managedRuntime();
    if (status?.operation.state === 'failed') {
      return 'The last managed runtime action failed. Review the attention panel before retrying.';
    }
    if (status?.operation.state === 'cancelled') {
      return 'The last managed runtime action was cancelled. You can retry it explicitly when ready.';
    }
    if (!managed?.present) return 'No managed runtime is installed. Redeven will install the latest stable release only after you explicitly confirm it.';
    if (managedRuntimeMatchesCurrent()) return 'The managed runtime is currently selected for Codespaces.';
    if (managed?.detection_state !== 'ready') return managed.error_message || 'The managed runtime is installed but is not currently usable.';
    if (runtimeReady()) return 'A managed runtime is installed, but a higher-priority runtime is currently active.';
    return managed.error_message || 'The managed runtime is installed but is not currently usable.';
  });

  const uninstallImpact = createMemo(() => {
    if (!managedInstalled()) return 'This removes only the Redeven-managed runtime path.';
    if (managedSelected()) return 'Removing it will make Codespaces depend on another runtime or a fresh managed install.';
    return 'Removing it will not touch the currently selected host runtime.';
  });

  const operationOutput = createMemo(() => props.status?.operation.log_tail?.join('\n') || '');
  const operationError = createMemo(() => String(props.status?.operation.last_error ?? '').trim());
  const cancelLabel = createMemo(() => (props.status?.operation.action === 'uninstall' ? 'Cancel uninstall' : 'Cancel install'));

  const installableStateTitle = createMemo(() => {
    if (activeRuntime()?.detection_state === 'unusable') return 'Usable runtime needed';
    return 'No runtime installed';
  });

  const installableStateSummary = createMemo(() => {
    const active = activeRuntime();
    if (active?.detection_state === 'unusable') {
      return active.error_message || 'Redeven detected a code-server runtime, but it is not usable for Codespaces on this host.';
    }
    return 'Codespaces needs a usable code-server runtime before it can start. Install the Redeven-managed latest stable runtime explicitly when you want Codespaces available on this host.';
  });

  const installableStateMeta = createMemo<readonly RuntimeMetaItem[]>(() => {
    const rows: RuntimeMetaItem[] = [
      {
        label: 'Managed location',
        value: props.status?.managed_prefix || '-',
        mono: true,
      },
      {
        label: 'Installer URL',
        value: props.status?.installer_script_url || '-',
        mono: true,
      },
    ];
    if (normalizedValue(activeRuntime()?.binary_path) !== '') {
      rows.push({
        label: 'Detected path',
        value: activeRuntime()?.binary_path || '-',
        mono: true,
      });
    }
    return rows;
  });

  const operationPanelTitle = createMemo(() => {
    if (operationRunning()) return props.status?.operation.action === 'uninstall' ? 'Removing managed runtime' : 'Installing managed runtime';
    if (operationFailed()) return props.status?.operation.action === 'uninstall' ? 'Unable to remove managed runtime' : 'Unable to install or update managed runtime';
    if (operationCancelled()) return props.status?.operation.action === 'uninstall' ? 'Managed runtime removal cancelled' : 'Managed runtime install cancelled';
    return '';
  });

  const operationPanelSummary = createMemo(() => {
    if (operationRunning()) {
      return props.status?.operation.action === 'uninstall'
        ? 'Redeven is removing the managed runtime after your explicit request. The card will return to the normal steady state as soon as the runtime status settles.'
        : 'Redeven is installing or updating the managed runtime after your explicit request. The card will return to the normal steady state as soon as the runtime status settles.';
    }
    if (operationFailed()) {
      return 'The last managed runtime action did not finish successfully. Review the recent output below before retrying.';
    }
    if (operationCancelled()) {
      return props.status?.operation.action === 'uninstall'
        ? 'The managed runtime removal was cancelled before Redeven confirmed the runtime was fully gone.'
        : 'The managed runtime install was cancelled before Redeven promoted the result.';
    }
    return '';
  });

  const operationPanelMeta = createMemo<readonly RuntimeMetaItem[]>(() => {
    return [
      {
        label: 'Managed location',
        value: props.status?.managed_prefix || '-',
        mono: true,
      },
      {
        label: 'Installer URL',
        value: props.status?.installer_script_url || '-',
        mono: true,
      },
      {
        label: 'Current active runtime',
        value: runtimeSourceLabel(props.status?.active_runtime.source),
      },
    ];
  });

  const currentRuntimeRows = createMemo<readonly RuntimeDetailRow[]>(() => {
    const active = activeRuntime();
    const source = activeRuntimeSource();
    const rows: RuntimeDetailRow[] = [
      {
        label: 'Status',
        value: <SettingsPill tone={runtimeStatusTone(active?.detection_state)}>{runtimeStatusLabel(active?.detection_state)}</SettingsPill>,
        note: activeSummary(),
      },
      {
        label: 'Source',
        value: runtimeSourceLabel(active?.source),
        note:
          source === 'managed'
            ? 'Redeven-managed runtime currently selected for Codespaces.'
            : source === 'system'
              ? 'A host runtime currently has priority over the managed runtime.'
              : source === 'env_override'
                ? 'This session is using a runtime path provided by environment override.'
                : 'No runtime is currently selected.',
      },
      {
        label: 'Binary path',
        value: active?.binary_path || 'Not detected',
        note: active?.binary_path ? 'Executable path used for Codespaces launches.' : 'Path appears after runtime detection succeeds.',
        mono: true,
      },
    ];

    if (!showManagedRuntimeSection() && source === 'managed') {
      rows.push({
        label: 'Managed location',
        value: props.status?.managed_prefix || '-',
        note: 'Redeven stores the current managed runtime here.',
        mono: true,
      });
    }

    return rows;
  });

  const managedRuntimeRows = createMemo<readonly RuntimeDetailRow[]>(() => {
    const managed = managedRuntime();

    return [
      {
        label: 'State',
        value: (
          <SettingsPill tone={managedInstalled() ? (managed?.detection_state === 'ready' ? 'success' : 'warning') : 'default'}>
            {managedInstalled() ? (managed?.detection_state === 'ready' ? 'Installed' : 'Needs attention') : 'Not installed'}
          </SettingsPill>
        ),
        note: managedSummary(),
      },
      {
        label: 'Codespaces selection',
        value: managedSelected() ? (
          <SettingsPill tone="success">Currently selected</SettingsPill>
        ) : (
          <SettingsPill>Not selected</SettingsPill>
        ),
        note: managedSelected()
          ? 'Codespaces is currently using the managed runtime.'
          : 'A different runtime currently has higher priority.',
      },
      {
        label: 'Binary path',
        value: managed?.binary_path || 'Not detected',
        note: managed?.binary_path ? 'Binary path inside the managed runtime prefix.' : 'Binary path appears after the managed runtime is detected.',
        mono: true,
      },
      {
        label: 'Managed location',
        value: props.status?.managed_prefix || '-',
        note: 'Only the Redeven-managed runtime is stored here.',
        mono: true,
      },
      {
        label: 'Installer URL',
        value: props.status?.installer_script_url || '-',
        note: 'Redeven uses the official latest-stable installer only after you explicitly confirm the action.',
        mono: true,
      },
    ];
  });

  const confirmInstall = async () => {
    try {
      await props.onInstall();
    } finally {
      setInstallConfirmOpen(false);
    }
  };

  const confirmUninstall = async () => {
    try {
      await props.onUninstall();
    } finally {
      setUninstallConfirmOpen(false);
    }
  };

  return (
    <>
      <SettingsCard
        icon={Code}
        title="code-server Runtime"
        description="Inspect the current Codespaces runtime, manage the Redeven-installed latest-stable runtime when needed, and review explicit install or uninstall output."
        badge={cardBadge()}
        badgeVariant={cardBadgeVariant()}
        error={props.error}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={props.onRefresh} disabled={props.loading}>
              <RefreshIcon class="mr-2 h-4 w-4" />
              {props.loading ? 'Refreshing...' : 'Refresh runtime'}
            </Button>
            <Show
              when={operationRunning()}
              fallback={
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setUninstallConfirmOpen(true)}
                    disabled={!props.canInteract || !props.canManage || !managedInstalled() || props.uninstallLoading}
                  >
                    {props.uninstallLoading ? 'Starting uninstall...' : 'Uninstall'}
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setInstallConfirmOpen(true)}
                    disabled={!props.canInteract || !props.canManage || props.actionLoading}
                  >
                    {props.actionLoading ? 'Starting...' : installActionLabel()}
                  </Button>
                </>
              }
            >
              <Button
                size="sm"
                variant="outline"
                onClick={() => void props.onCancel()}
                disabled={!props.canInteract || !props.canManage || props.cancelLoading}
              >
                {props.cancelLoading ? 'Cancelling...' : cancelLabel()}
              </Button>
            </Show>
          </>
        }
      >
        <div class="space-y-4">
          <Show when={!props.canManage}>
            <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
              <Code class="h-5 w-5 text-muted-foreground" />
              <div class="text-sm text-muted-foreground">
                Installing, updating, or uninstalling the managed runtime requires read, write, and execute access for this environment session.
              </div>
            </div>
          </Show>

          <Show when={showOperationPanel()}>
            <RuntimeStatePanel
              title={operationPanelTitle()}
              summary={operationPanelSummary()}
              tone={operationTone(props.status?.operation.state)}
              badge={operationLabel(props.status)}
              meta={operationPanelMeta()}
              error={operationError()}
              outputTitle="Recent runtime output"
              output={operationOutput()}
              outputOpen={operationNeedsAttention()}
            />
          </Show>

          <Show when={showInstallableStatePanel()}>
            <RuntimeStatePanel
              title={installableStateTitle()}
              summary={installableStateSummary()}
              meta={installableStateMeta()}
            />
          </Show>

          <Show when={showCurrentRuntimeSection()}>
            <RuntimeDetailsTableSection title="Current runtime" rows={currentRuntimeRows()} />
          </Show>

          <Show when={showManagedRuntimeSection()}>
            <RuntimeDetailsTableSection title="Managed runtime" rows={managedRuntimeRows()} />
          </Show>
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={installConfirmOpen()}
        onOpenChange={(open) => setInstallConfirmOpen(open)}
        title={installActionLabel()}
        confirmText={installActionLabel()}
        loading={props.actionLoading}
        onConfirm={() => void confirmInstall()}
      >
        <div class="space-y-3">
          <p class="text-sm">Redeven will run the official latest-stable code-server installer into the managed runtime location.</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>Managed location: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix || '-'}</span></div>
            <div>Installer URL: <span class="font-mono text-foreground break-all">{props.status?.installer_script_url || '-'}</span></div>
          </div>
          <p class="text-xs text-muted-foreground">Redeven will not retry automatically if the install or update fails or the network is unavailable.</p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={uninstallConfirmOpen()}
        onOpenChange={(open) => setUninstallConfirmOpen(open)}
        title="Uninstall managed runtime"
        confirmText="Uninstall"
        loading={props.uninstallLoading}
        onConfirm={() => void confirmUninstall()}
      >
        <div class="space-y-3">
          <p class="text-sm">This removes only the Redeven-managed code-server runtime.</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>Managed location: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix || '-'}</span></div>
            <div>Current active runtime: <span class="text-foreground">{runtimeSourceLabel(props.status?.active_runtime.source)}</span></div>
          </div>
          <p class="text-xs text-muted-foreground">{uninstallImpact()}</p>
        </div>
      </ConfirmDialog>
    </>
  );
}
