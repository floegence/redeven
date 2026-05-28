import { Show } from 'solid-js';
import { Zap, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import { SettingsSection, PropertyRow, DotIndicator } from '../SettingsPrimitives';
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
  const statusActive = () => ctx.displayedStatus() === 'online';

  const serviceOwnerLabel = () => {
    const service = ctx.runtimeService();
    if (service?.serviceOwner === 'desktop' || service?.desktopManaged) return i18n.t('runtimeStatus.owner.redevenDesktop');
    if (service?.serviceOwner === 'external') return i18n.t('runtimeStatus.owner.externalService');
    return i18n.t('runtimeStatus.unknown');
  };
  const runtimeServiceCompatibility = () => {
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
  const compatActive = () => compatTone === 'success';
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
      badgeVariant={ctx.displayedStatus() === 'online' ? 'success' : ctx.displayedStatus() === 'offline' ? 'warning' : 'default'}
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
      <div class="flex items-center gap-2 mb-5">
        <DotIndicator active={statusActive()} label={statusLabel()} />
      </div>

      <PropertyRow label={i18n.t('runtimeStatus.currentVersion')} mono>
        {ctx.runtimeUpdate.version.currentVersion() || '—'}
      </PropertyRow>
      <PropertyRow label={i18n.t('runtimeStatus.latestVersion')} mono>
        {ctx.latestVersion()?.latest_version ? String(ctx.latestVersion()!.latest_version) : ctx.latestVersionLoading() ? i18n.t('runtimeStatus.loading') : '—'}
      </PropertyRow>
      <PropertyRow label={i18n.t('runtimeStatus.activeWork')}>
        {activeWorkSummary()}
      </PropertyRow>
      <PropertyRow label={i18n.t('runtimeStatus.compatibilityLabel')}>
        <DotIndicator active={compatActive()} label={runtimeServiceCompatibility()} />
      </PropertyRow>
      <PropertyRow label={i18n.t('runtimeStatus.serviceOwner')}>
        {serviceOwnerLabel()}
      </PropertyRow>
      <PropertyRow label={i18n.t('runtimeStatus.maintenanceAuthority')}>
        {maintenanceAuthority()}
      </PropertyRow>
      <PropertyRow label={i18n.t('runtimeStatus.runtimeProtocol')} mono>
        {ctx.runtimeService()?.protocolVersion || '—'}
      </PropertyRow>
      <PropertyRow label={i18n.t('runtimeStatus.desktopModelSource')}>
        <DotIndicator active={desktopModelSourceActive(ctx.runtimeDesktopModelSourceBinding()?.state)} label={formatDesktopModelSourceBindingState(ctx.runtimeDesktopModelSourceBinding()?.state, i18n)} />
      </PropertyRow>
      <PropertyRow label={i18n.t('runtimeStatus.manifestETag')} mono>
        {ctx.latestVersion()?.manifest_etag ? String(ctx.latestVersion()!.manifest_etag) : '—'}
      </PropertyRow>

      <Show when={ctx.upgradeState().allowsUpgradeAction && ctx.upgradeState().requiresTargetVersion}>
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2.5">
          <label class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.targetVersion')}</label>
          <Input value={ctx.targetVersionInput()} onInput={(e) => ctx.setTargetVersionInput(e.currentTarget.value)}
            placeholder="v1.2.3" size="sm" class="sm:w-48" disabled={ctx.maintaining()} />
        </div>
      </Show>

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
