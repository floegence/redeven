import { Show } from 'solid-js';
import { Zap, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { cn } from '@floegence/floe-webapp-core';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, DotIndicator } from '../SettingsPrimitives';
import { useI18n, type I18nHelpers } from '../../../i18n';
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
      case 'managed_elsewhere': return i18n.t('runtimeStatus.compatibility.managedElsewhere');
      default: return i18n.t('runtimeStatus.unknown');
    }
  };
  const compatTone = runtimeServiceCompatibilityTone(ctx.runtimeService());
  const compatOk = () => compatTone === 'success';

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

  const serviceOwnerLabel = () => {
    const service = ctx.runtimeService();
    if (service?.serviceOwner === 'desktop' || service?.desktopManaged) return i18n.t('runtimeStatus.owner.redevenDesktop');
    if (service?.serviceOwner === 'external') return i18n.t('runtimeStatus.owner.externalService');
    return i18n.t('runtimeStatus.unknown');
  };

  const maintenanceAuthority = () => {
    const authority = String(ctx.maintenanceContext()?.authority ?? '').trim();
    if (!authority) return i18n.t('runtimeStatus.runtimeRpc');
    if (authority === 'runtime_rpc') return i18n.t('runtimeStatus.runtimeRpc');
    if (authority === 'desktop_shell') return i18n.t('runtimeStatus.owner.redevenDesktop');
    return authority.replace(/_/g, ' ');
  };

  const upgradeActionLabel = () => {
    const label = String(ctx.upgradeState().actionLabel ?? '').trim();
    if (label === 'Manage in Desktop') return i18n.t('runtimeStatus.manageInDesktopAction');
    if (label === 'Update Redeven') return i18n.t('runtimeStatus.updateRedevenAction');
    return label;
  };

  return (
    <SettingsSection
      icon={Zap}
      title={i18n.t('runtimeStatus.title')}
      description={i18n.t('runtimeStatus.description')}
      badge={statusLabel()}
      badgeVariant={statusOnline() ? 'success' : ctx.displayedStatus() === 'offline' ? 'warning' : 'default'}
      error={ctx.maintenanceError()}
      actions={
        <>
          <Button size="sm" variant="outline" class="gap-1.5" onClick={() => void ctx.startRestart()}
            loading={ctx.isRestarting()} disabled={!ctx.canStartRestart()}>
            <RefreshIcon class="w-3.5 h-3.5" />{i18n.t('runtimeStatus.restartAction')}
          </Button>
          <Show when={ctx.upgradeState().allowsUpgradeAction}>
            <Button size="sm" variant="default" onClick={() => void ctx.startUpgrade()}
              loading={ctx.isUpgrading()} disabled={!ctx.canStartUpgrade()}>
              {upgradeActionLabel()}
            </Button>
          </Show>
        </>
      }
    >
      {/* Metric cards */}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div class={cn('rounded-xl border p-4', statusOnline() ? 'border-success/30 bg-success/5' : 'border-border/50 bg-background')}>
          <div class="flex items-center gap-2.5 mb-1">
            <div class={cn('h-2 w-2 rounded-full', statusOnline() ? 'bg-success' : 'bg-muted-foreground/30')} />
            <span class="text-sm font-semibold text-foreground">{statusLabel()}</span>
          </div>
          <div class="text-[11px] text-muted-foreground">运行状态</div>
        </div>
        <div class="rounded-xl border border-border/50 bg-background p-4">
          <div class="text-sm font-semibold font-mono text-foreground mb-1">{version()}</div>
          <div class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.currentVersion')}</div>
        </div>
        <div class={cn('rounded-xl border p-4', compatOk() ? 'border-success/30 bg-success/5' : 'border-border/50 bg-background')}>
          <div class="flex items-center gap-2.5 mb-1">
            <div class={cn('h-2 w-2 rounded-full', compatOk() ? 'bg-success' : 'bg-warning')} />
            <span class="text-sm font-semibold text-foreground">{compatLabel()}</span>
          </div>
          <div class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.compatibilityLabel')}</div>
        </div>
      </div>

      {/* Detail groups */}
      <div class="mt-5 space-y-4">
        <div class="rounded-xl border border-border/50 bg-background px-4 py-3">
          <div class="text-[11px] font-medium text-muted-foreground mb-3 uppercase tracking-wider">{i18n.t('runtimeStatus.currentVersion')}</div>
          <div class="space-y-2.5">
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{i18n.t('runtimeStatus.currentVersion')}</span>
              <code class="font-mono text-foreground">{version()}</code>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{i18n.t('runtimeStatus.latestVersion')}</span>
              <code class="font-mono text-foreground">{ctx.latestVersionLoading() ? i18n.t('runtimeStatus.loading') : latestVersion()}</code>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{i18n.t('runtimeStatus.manifestETag')}</span>
              <code class="font-mono text-[11px] text-foreground">{ctx.latestVersion()?.manifest_etag ? String(ctx.latestVersion()!.manifest_etag) : '—'}</code>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-border/50 bg-background px-4 py-3">
          <div class="text-[11px] font-medium text-muted-foreground mb-3 uppercase tracking-wider">负载与兼容性</div>
          <div class="space-y-2.5">
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{i18n.t('runtimeStatus.activeWork')}</span>
              <span class="text-foreground">{activeWorkSummary()}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{i18n.t('runtimeStatus.serviceOwner')}</span>
              <span class="text-foreground">{serviceOwnerLabel()}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{i18n.t('runtimeStatus.maintenanceAuthority')}</span>
              <span class="text-foreground">{maintenanceAuthority()}</span>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{i18n.t('runtimeStatus.runtimeProtocol')}</span>
              <code class="font-mono text-foreground">{ctx.runtimeService()?.protocolVersion || '—'}</code>
            </div>
            <div class="flex items-center justify-between text-xs">
              <span class="text-muted-foreground">{i18n.t('runtimeStatus.desktopModelSource')}</span>
              <DotIndicator active={desktopModelSourceActive(ctx.runtimeDesktopModelSourceBinding()?.state)} label={formatDesktopModelSourceBindingState(ctx.runtimeDesktopModelSourceBinding()?.state, i18n)} />
            </div>
          </div>
        </div>
      </div>

      <Show when={ctx.upgradeState().allowsUpgradeAction && ctx.upgradeState().requiresTargetVersion}>
        <div class="mt-3 flex items-center gap-3">
          <span class="text-xs text-muted-foreground">{i18n.t('runtimeStatus.targetVersion')}</span>
          <Input value={ctx.targetVersionInput()} onInput={(e) => ctx.setTargetVersionInput(e.currentTarget.value)}
            placeholder="v1.2.3" size="sm" class="w-40" disabled={ctx.maintaining()} />
        </div>
      </Show>

      {/* Status messages */}
      <div class="mt-4 pt-4 border-t border-border/20 space-y-1.5">
        <Show when={ctx.upgradeState().requiresTargetVersion && ctx.targetUpgradeVersion() && !ctx.targetUpgradeVersionValid()}>
          <div class="text-[11px] text-destructive">{i18n.t('runtimeStatus.validReleaseTagHint')}</div>
        </Show>
        <Show when={ctx.upgradeState().message}>
          <div class="text-[11px] text-muted-foreground">{ctx.upgradeState().message}</div>
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
  );
}
