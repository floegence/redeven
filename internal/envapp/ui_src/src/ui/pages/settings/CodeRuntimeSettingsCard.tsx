import { Show, createMemo, createSignal, type JSX } from 'solid-js';
import { Code, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, ConfirmDialog } from '@floegence/floe-webapp-core/ui';

import {
  codeRuntimeManagedActionLabel,
  codeRuntimeManagedInstalled,
  codeRuntimeManagedNeedsUpgrade,
  codeRuntimeManagedRuntimeSelected,
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

function RuntimeDetailsTableSection(props: { title: string; rows: readonly RuntimeDetailRow[] }) {
  return (
    <div class="space-y-2">
      <div class="text-sm font-semibold text-foreground">{props.title}</div>
      <SettingsKeyValueTable rows={props.rows} minWidthClass="min-w-[40rem]" />
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
    case 'incompatible':
      return 'warning';
    default:
      return 'default';
  }
}

function runtimeStatusLabel(state: string | null | undefined): string {
  switch (String(state ?? '').trim()) {
    case 'ready':
      return 'Ready';
    case 'incompatible':
      return 'Needs attention';
    default:
      return 'Not installed';
  }
}

function operationTone(state: string | null | undefined): 'default' | 'success' | 'warning' | 'danger' {
  switch (String(state ?? '').trim()) {
    case 'running':
      return 'warning';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return 'default';
  }
}

function operationLabel(status: CodeRuntimeStatus | null | undefined): string {
  const operation = status?.operation;
  if (!operation) return 'Idle';
  if (operation.state === 'running') return codeRuntimeStageLabel(operation.stage, operation.action);
  if (operation.state === 'failed') return operation.action === 'uninstall' ? 'Uninstall failed' : 'Install failed';
  if (operation.state === 'cancelled') return operation.action === 'uninstall' ? 'Uninstall cancelled' : 'Install cancelled';
  if (operation.state === 'succeeded') return operation.action === 'uninstall' ? 'Uninstall completed' : 'Install completed';
  return 'Idle';
}

export function CodeRuntimeSettingsCard(props: CodeRuntimeSettingsCardProps) {
  const [installConfirmOpen, setInstallConfirmOpen] = createSignal(false);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = createSignal(false);

  const runtimeReady = createMemo(() => codeRuntimeReady(props.status));
  const managedInstalled = createMemo(() => codeRuntimeManagedInstalled(props.status));
  const managedSelected = createMemo(() => codeRuntimeManagedRuntimeSelected(props.status));
  const managedNeedsUpgrade = createMemo(() => codeRuntimeManagedNeedsUpgrade(props.status));
  const operationRunning = createMemo(() => codeRuntimeOperationRunning(props.status));
  const installActionLabel = createMemo(() => codeRuntimeManagedActionLabel(props.status));

  const cardBadge = createMemo(() => {
    if (operationRunning()) return props.status?.operation.action === 'uninstall' ? 'Removing runtime' : 'Installing runtime';
    if (runtimeReady() && managedSelected()) return 'Managed runtime ready';
    if (runtimeReady()) return 'Host runtime ready';
    if (managedInstalled() && managedNeedsUpgrade()) return 'Managed upgrade available';
    if (managedInstalled()) return 'Managed runtime installed';
    return 'Runtime needs install';
  });

  const cardBadgeVariant = createMemo<'default' | 'warning' | 'success'>(() => {
    if (operationRunning()) return 'warning';
    if (runtimeReady()) return 'success';
    return 'warning';
  });

  const activeSummary = createMemo(() => {
    const active = props.status?.active_runtime;
    if (!active) return 'Codespaces needs a compatible code-server runtime before it can start.';
    if (active.detection_state === 'ready') {
      return active.source === 'managed'
        ? 'Codespaces will use the Redeven-managed runtime.'
        : 'Codespaces is currently using a compatible host runtime.';
    }
    return active.error_message || 'Codespaces needs a compatible code-server runtime before it can start.';
  });

  const managedSummary = createMemo(() => {
    const status = props.status;
    const managed = status?.managed_runtime;
    if (!managed?.present) return 'No managed runtime is installed. Redeven will install one only after you explicitly confirm it.';
    if (managedSelected()) return 'The managed runtime is currently active for Codespaces.';
    if (managedNeedsUpgrade()) return 'A managed runtime is installed, but it does not match the supported version for this agent build.';
    if (runtimeReady()) return 'A managed runtime is installed, but a higher-priority compatible runtime is currently active.';
    return managed.error_message || 'The managed runtime is installed but is not currently usable.';
  });

  const uninstallImpact = createMemo(() => {
    if (!managedInstalled()) return 'This removes only the Redeven-managed runtime path.';
    if (managedSelected()) return 'Removing it will make Codespaces depend on another compatible runtime or a fresh managed install.';
    return 'Removing it will not touch the currently selected host runtime.';
  });

  const operationOutput = createMemo(() => props.status?.operation.log_tail?.join('\n') || 'No runtime management output yet.');
  const operationError = createMemo(() => String(props.status?.operation.last_error ?? '').trim());
  const cancelLabel = createMemo(() => (props.status?.operation.action === 'uninstall' ? 'Cancel uninstall' : 'Cancel install'));
  const activeRuntimeRows = createMemo<readonly RuntimeDetailRow[]>(() => {
    const active = props.status?.active_runtime;
    const source = String(active?.source ?? '').trim();

    return [
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
              ? 'A compatible host runtime currently has priority over the managed runtime.'
              : source === 'env_override'
                ? 'This session is using a runtime path provided by environment override.'
                : 'No compatible runtime is currently selected.',
      },
      {
        label: 'Detected version',
        value: active?.installed_version || 'Not detected',
        note:
          active?.detection_state === 'ready'
            ? 'Detected from the runtime currently selected for Codespaces.'
            : active?.error_message || 'Version metadata appears after a compatible runtime is detected.',
        mono: true,
      },
      {
        label: 'Binary path',
        value: active?.binary_path || 'Not detected',
        note: active?.binary_path ? 'Executable path used for Codespaces launches.' : 'Path appears after runtime detection succeeds.',
        mono: true,
      },
    ];
  });
  const managedRuntimeRows = createMemo<readonly RuntimeDetailRow[]>(() => {
    const managed = props.status?.managed_runtime;

    return [
      {
        label: 'State',
        value: (
          <SettingsPill tone={managedInstalled() ? (managedNeedsUpgrade() ? 'warning' : 'success') : 'default'}>
            {managedInstalled() ? (managedNeedsUpgrade() ? 'Needs upgrade' : 'Installed') : 'Not installed'}
          </SettingsPill>
        ),
        note: managedSummary(),
      },
      {
        label: 'Selection',
        value: managedSelected() ? (
          <SettingsPill tone="success">Currently selected</SettingsPill>
        ) : managedInstalled() ? (
          <SettingsPill>Available</SettingsPill>
        ) : (
          'Unavailable'
        ),
        note: managedSelected()
          ? 'Codespaces is currently using the managed runtime.'
          : managedInstalled()
            ? 'A different compatible runtime currently has higher priority.'
            : 'Install the managed runtime to make it available for Codespaces.',
      },
      {
        label: 'Supported version',
        value: props.status?.supported_version || '-',
        note: 'Pinned by this Redeven agent build.',
        mono: true,
      },
      {
        label: 'Managed version',
        value: managed?.installed_version || 'Not installed',
        note: managedInstalled()
          ? managedNeedsUpgrade()
            ? 'Upgrade to align the managed runtime with the supported version.'
            : 'Managed runtime matches the supported version.'
          : 'No managed runtime is installed yet.',
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
        note: 'Used only after you explicitly confirm install or upgrade.',
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
        description="Inspect the active runtime, manage the Redeven-installed runtime, and review explicit install or uninstall output."
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
                    {props.uninstallLoading ? 'Starting uninstall...' : 'Uninstall managed runtime'}
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
          <div class="flex flex-wrap gap-2">
            <SettingsPill tone={runtimeStatusTone(props.status?.active_runtime.detection_state)}>{runtimeStatusLabel(props.status?.active_runtime.detection_state)}</SettingsPill>
            <SettingsPill tone={managedInstalled() ? (managedNeedsUpgrade() ? 'warning' : 'success') : 'default'}>
              {managedInstalled() ? (managedNeedsUpgrade() ? 'Managed upgrade required' : 'Managed runtime installed') : 'Managed runtime missing'}
            </SettingsPill>
            <SettingsPill tone={operationTone(props.status?.operation.state)}>{operationLabel(props.status)}</SettingsPill>
          </div>

          <Show when={!props.canManage}>
            <div class="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
              <Code class="h-5 w-5 text-muted-foreground" />
              <div class="text-sm text-muted-foreground">
                Installing, upgrading, or uninstalling the managed runtime requires read, write, and execute access for this environment session.
              </div>
            </div>
          </Show>

          <RuntimeDetailsTableSection title="Active runtime" rows={activeRuntimeRows()} />

          <RuntimeDetailsTableSection title="Managed runtime" rows={managedRuntimeRows()} />

          <div class="rounded-lg border border-border bg-muted/20 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-sm font-semibold text-foreground">Management activity</div>
              <SettingsPill tone={operationTone(props.status?.operation.state)}>{operationLabel(props.status)}</SettingsPill>
            </div>
            <div class="mt-2 text-xs text-muted-foreground">
              Redeven never auto-installs code-server. Every managed install, upgrade, or uninstall must be explicitly triggered from Env App.
            </div>
            <Show when={operationError()}>
              <div class="mt-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                {operationError()}
              </div>
            </Show>
            <pre class="mt-3 max-h-52 overflow-auto rounded-md border border-border bg-background/80 p-3 text-[11px] leading-5 text-muted-foreground whitespace-pre-wrap break-words">
              {operationOutput()}
            </pre>
          </div>
        </div>
      </SettingsCard>

      <ConfirmDialog
        open={installConfirmOpen()}
        onOpenChange={(open) => setInstallConfirmOpen(open)}
        title={installActionLabel()}
        confirmText={managedNeedsUpgrade() ? 'Upgrade' : managedInstalled() ? 'Reinstall' : 'Install'}
        loading={props.actionLoading}
        onConfirm={() => void confirmInstall()}
      >
        <div class="space-y-3">
          <p class="text-sm">Redeven will run the official code-server installer for the pinned supported version.</p>
          <div class="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
            <div>Supported version: <span class="font-mono text-foreground">{props.status?.supported_version || '-'}</span></div>
            <div>Managed location: <span class="font-mono text-foreground break-all">{props.status?.managed_prefix || '-'}</span></div>
            <div>Installer URL: <span class="font-mono text-foreground break-all">{props.status?.installer_script_url || '-'}</span></div>
          </div>
          <p class="text-xs text-muted-foreground">Redeven will not retry automatically if the install fails or the network is unavailable.</p>
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
