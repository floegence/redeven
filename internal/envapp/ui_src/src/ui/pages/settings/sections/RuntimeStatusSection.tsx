import { Show, createSignal } from 'solid-js';
import { Activity, Cpu, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { cn } from '@floegence/floe-webapp-core';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsList, SettingsSection, SettingRow, DotIndicator } from '../SettingsPrimitives';
import { useI18n, type I18nHelpers } from '../../../i18n';
import { ConfirmDialog } from '../../../primitives/EnvAppModal';
import { runtimeServiceCompatibilityTone } from './helpers';

function formatDesktopModelSourceBindingState(value: unknown, i18n: I18nHelpers): string {
  switch (String(value ?? '').trim()) {
    case 'bound': return i18n.t('runtimeStatus.desktopModelState.bound');
    case 'unbound': return i18n.t('runtimeStatus.desktopModelState.unbound');
    case 'unsupported': return i18n.t('runtimeStatus.desktopModelState.unsupported');
    case 'expired': return i18n.t('runtimeStatus.desktopModelState.expired');
    case 'error': return i18n.t('runtimeStatus.desktopModelState.error');
    default: return i18n.t('runtimeStatus.unknown');
  }
}

function desktopModelSourceActive(value: unknown): boolean {
  return String(value ?? '').trim() === 'bound';
}

export function RuntimeStatusSection() {
  const ctx = useEnvSettingsPage();
  const [maintenanceAction, setMaintenanceAction] = createSignal<'restart' | 'upgrade' | null>(null);
  const i18n = useI18n();

  const statusLabel = () => {
    switch (String(ctx.displayedStatus() ?? '').trim().toLowerCase()) {
      case 'online': return i18n.t('runtimeStatus.status.online');
      case 'offline': return i18n.t('runtimeStatus.status.offline');
      case 'unknown': case '': return i18n.t('runtimeStatus.unknown');
      default: return ctx.statusLabel();
    }
  };
  const statusOnline = () => ctx.displayedStatus() === 'online';

  const compatLabel = () => {
    switch (String(ctx.runtimeService()?.compatibility ?? 'unknown').trim()) {
      case 'compatible': return i18n.t('runtimeStatus.compatibility.compatible');
      case 'update_available': return i18n.t('runtimeStatus.compatibility.updateAvailable');
      case 'restart_recommended': return i18n.t('runtimeStatus.compatibility.restartRecommended');
      case 'update_required': return i18n.t('runtimeStatus.compatibility.updateRequired');
      case 'desktop_update_required': return i18n.t('runtimeStatus.compatibility.desktopUpdateRequired');
      default: return i18n.t('runtimeStatus.unknown');
    }
  };
  const compatTone = runtimeServiceCompatibilityTone(ctx.runtimeService());
  const compatOk = () => compatTone === 'success';
  const compatibilityMessage = () => String(ctx.runtimeService()?.compatibilityMessage ?? '').trim();

  const version = () => ctx.runtimeUpdate.version.currentVersion() || '—';
  const latestVersion = () => ctx.latestVersion()?.latest_version ? String(ctx.latestVersion()!.latest_version) : '—';

  const activeWorkSummary = () => {
    const workload = ctx.runtimeService()?.activeWorkload;
    if (!workload) return i18n.t('runtimeStatus.noActiveWork');
    const parts = [
      workload.terminalCount > 0 ? i18n.tn('runtimeStatus.workload.terminals', workload.terminalCount) : '',
      workload.sessionCount > 0 ? i18n.tn('runtimeStatus.workload.sessions', workload.sessionCount) : '',
      workload.taskCount > 0 ? i18n.tn('runtimeStatus.workload.tasks', workload.taskCount) : '',
      workload.portForwardCount > 0 ? i18n.tn('runtimeStatus.workload.webServices', workload.portForwardCount) : '',
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : i18n.t('runtimeStatus.noActiveWork');
  };

  const maintenanceAuthority = () => {
    const authority = String(ctx.maintenanceContext()?.authority ?? '').trim();
    if (!authority) return i18n.t('runtimeStatus.runtimeRpc');
    if (authority === 'runtime_rpc') return i18n.t('runtimeStatus.runtimeRpc');
    if (authority === 'desktop_shell') return i18n.t('runtimeStatus.desktopShell');
    return authority.replace(/_/g, ' ');
  };

  const upgradeActionLabel = () => {
    const label = String(ctx.upgradeState().actionLabel ?? '').trim();
    if (label === 'Manage in Desktop') return i18n.t('runtimeStatus.manageInDesktopAction');
    if (label === 'Update Redeven') return i18n.t('runtimeStatus.updateRedevenAction');
    return label;
  };

  return (
    <>
    <SettingsSection
      variant="page"
      icon={Activity}
      title={i18n.t('runtimeStatus.title')}
      description={i18n.t('runtimeStatus.description')}
      error={ctx.maintenanceError()}
    >
      <SettingsList class="runtime-status-summary">
        <SettingRow icon={Activity} title={i18n.t('runtimeStatus.statusLabel')}
          control={<span class={cn('font-medium', statusOnline() ? 'text-success' : 'text-warning')}>{statusLabel()}</span>} />
        <SettingRow icon={Cpu} title={i18n.t('runtimeStatus.currentVersion')} description={compatLabel()}
          control={<code class="font-mono text-xs text-foreground">{version()}</code>} />
        <SettingRow title={i18n.t('runtimeStatus.activeWork')} control={<span class="text-xs">{activeWorkSummary()}</span>} />
        <SettingRow title={i18n.t('runtimeStatus.desktopModelSource')}
          control={<DotIndicator active={desktopModelSourceActive(ctx.runtimeDesktopModelSourceBinding()?.state)} label={formatDesktopModelSourceBindingState(ctx.runtimeDesktopModelSourceBinding()?.state, i18n)} />} />
      </SettingsList>
      <SettingsList>
        <SettingRow title={i18n.t('runtimeStatus.restartAction')} description={i18n.t('settingsDesign.maintenanceWarning')}
          control={<Button size="sm" variant="outline" onClick={() => setMaintenanceAction('restart')}
            loading={ctx.isRestarting()} disabled={!ctx.canStartRestart()}>
            <RefreshIcon class="mr-1.5 h-3.5 w-3.5" />{i18n.t('runtimeStatus.restartAction')}
          </Button>} />
        <Show when={ctx.upgradeState().allowsUpgradeAction}>
          <Show when={ctx.upgradeState().requiresTargetVersion}>
            <SettingRow title={i18n.t('runtimeStatus.targetVersion')}
              control={<Input value={ctx.targetVersionInput()} onInput={(e) => ctx.setTargetVersionInput(e.currentTarget.value)}
                placeholder="v1.2.3" size="sm" class="w-40" disabled={ctx.maintaining()} />} />
          </Show>
          <SettingRow title={upgradeActionLabel()} description={ctx.upgradeState().message}
            control={<Button size="sm" variant="outline" onClick={() => setMaintenanceAction('upgrade')}
              loading={ctx.isUpgrading()} disabled={!ctx.canStartUpgrade()}>{upgradeActionLabel()}</Button>} />
        </Show>
      </SettingsList>
      <details class="settings-technical-details runtime-status-details">
        <summary>{i18n.t('settings.connection.technicalInformation')}</summary>
        <SettingsList>
        <SettingRow title={i18n.t('runtimeStatus.latestVersion')}
          control={<code class="font-mono text-xs text-foreground">{ctx.latestVersionLoading() ? i18n.t('runtimeStatus.loading') : latestVersion()}</code>} />
        <SettingRow title={i18n.t('runtimeStatus.compatibilityLabel')}
          control={<span class={compatOk() ? 'text-success' : 'text-warning'}>{compatLabel()}</span>} />
        <SettingRow title={i18n.t('runtimeStatus.maintenanceAuthority')}
          control={<span class="text-xs text-muted-foreground">{maintenanceAuthority()}</span>} />
        <SettingRow title={i18n.t('runtimeStatus.runtimeProtocol')}
          control={<code class="font-mono text-xs text-foreground">{ctx.runtimeService()?.protocolVersion || '—'}</code>} />
          <SettingRow title={i18n.t('runtimeStatus.manifestETag')}
            control={<code class="break-all font-mono text-xs">{ctx.latestVersion()?.manifest_etag || '—'}</code>} />
        </SettingsList>
      </details>

      {/* Status messages */}
      <div class="space-y-2 text-xs">
        <Show when={ctx.upgradeState().requiresTargetVersion && ctx.targetUpgradeVersion() && !ctx.targetUpgradeVersionValid()}>
          <div class="text-[11px] text-destructive">{i18n.t('runtimeStatus.validReleaseTagHint')}</div>
        </Show>
        <Show when={compatibilityMessage()}>
          <div class="text-[11px] text-muted-foreground">{compatibilityMessage()}</div>
        </Show>
        <Show when={ctx.upgradeState().policy === 'desktop_release' && ctx.upgradeState().releasePageURL}>
          <div class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.desktopReleasePageHint')}</div>
        </Show>
        <Show when={ctx.latestVersionError()}>
          <div class="text-[11px] text-destructive">{i18n.t('runtimeStatus.latestVersionUnavailable', { message: ctx.latestVersionError() })}</div>
        </Show>
        <Show when={ctx.latestVersion()?.stale}>
          <div class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.staleMetadataHint')}</div>
        </Show>
        <Show when={!ctx.canAdmin()}>
          <div class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.adminRequired')}</div>
        </Show>
        <Show when={ctx.maintenanceStage()}>
          <div class="text-[11px] text-muted-foreground">{ctx.maintenanceStage()}</div>
        </Show>
      </div>
    </SettingsSection>
    <ConfirmDialog open={Boolean(maintenanceAction())} onOpenChange={(open) => { if (!open) setMaintenanceAction(null); }}
      title={maintenanceAction() === 'restart' ? i18n.t('runtimeStatus.restartAction') : upgradeActionLabel()}
      confirmText={maintenanceAction() === 'restart' ? i18n.t('runtimeStatus.restartAction') : upgradeActionLabel()}
      onConfirm={async () => { const action = maintenanceAction(); setMaintenanceAction(null); if (action === 'restart') await ctx.startRestart(); else if (action === 'upgrade') await ctx.startUpgrade(); }}>
      <p class="text-[length:var(--floe-type-body)]">{i18n.t('settingsDesign.maintenanceWarning')}</p>
      <p class="mt-3 text-xs text-muted-foreground">{activeWorkSummary()}</p>
      <Show when={maintenanceAction() === 'upgrade' && ctx.targetUpgradeVersion()}><code class="mt-3 block text-[length:var(--floe-type-body)]">{ctx.targetUpgradeVersion()}</code></Show>
    </ConfirmDialog>
    </>
  );
}
