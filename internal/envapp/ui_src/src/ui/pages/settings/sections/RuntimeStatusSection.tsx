import { Show } from 'solid-js';
import { Zap, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Button, Input } from '@floegence/floe-webapp-core/ui';
import { useEnvSettingsPage } from '../EnvSettingsPageContext';
import {
  SettingsSection, SettingsTable, SettingsTableHead, SettingsTableHeaderRow, SettingsTableHeaderCell,
  SettingsTableBody, SettingsTableRow, SettingsTableCell, SettingsPill,
} from '../SettingsPrimitives';
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

function desktopModelSourceBindingTone(value: unknown): 'default' | 'warning' | 'success' {
  switch (String(value ?? '').trim()) {
    case 'bound': return 'success';
    case 'unsupported': case 'expired': case 'error': return 'warning';
    default: return 'default';
  }
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
  const runtimeServiceOwner = () => {
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
      <SettingsTable minWidthClass="min-w-[44rem]">
        <SettingsTableHead>
          <SettingsTableHeaderRow>
            <SettingsTableHeaderCell class="w-48">{i18n.t('runtimeStatus.metricHeader')}</SettingsTableHeaderCell>
            <SettingsTableHeaderCell>{i18n.t('settings.table.value')}</SettingsTableHeaderCell>
            <SettingsTableHeaderCell class="w-72">{i18n.t('settings.table.notes')}</SettingsTableHeaderCell>
          </SettingsTableHeaderRow>
        </SettingsTableHead>
        <SettingsTableBody>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.currentVersion')}</SettingsTableCell>
            <SettingsTableCell class="font-mono text-[11px]">{ctx.runtimeUpdate.version.currentVersion() || '—'}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.currentVersionNote')}</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.latestVersion')}</SettingsTableCell>
            <SettingsTableCell class="font-mono text-[11px]">
              {ctx.latestVersion()?.latest_version ? String(ctx.latestVersion()!.latest_version) : ctx.latestVersionLoading() ? i18n.t('runtimeStatus.loading') : '—'}
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.latestVersionNote')}</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.statusLabel')}</SettingsTableCell>
            <SettingsTableCell>
              <SettingsPill tone={ctx.displayedStatus() === 'online' ? 'success' : ctx.displayedStatus() === 'offline' ? 'warning' : 'default'}>
                {statusLabel()}
              </SettingsPill>
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.statusNote')}</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.serviceOwner')}</SettingsTableCell>
            <SettingsTableCell>{runtimeServiceOwner()}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.serviceOwnerNote')}</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.maintenanceAuthority')}</SettingsTableCell>
            <SettingsTableCell>{maintenanceAuthority()}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.maintenanceAuthorityNote')}</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.compatibilityLabel')}</SettingsTableCell>
            <SettingsTableCell>
              <SettingsPill tone={runtimeServiceCompatibilityTone(ctx.runtimeService())}>
                {runtimeServiceCompatibility()}
              </SettingsPill>
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">
              {ctx.runtimeService()?.compatibilityMessage || i18n.t('runtimeStatus.compatibilityNote')}
            </SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.activeWork')}</SettingsTableCell>
            <SettingsTableCell>{activeWorkSummary()}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.activeWorkNote')}</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.runtimeProtocol')}</SettingsTableCell>
            <SettingsTableCell class="font-mono text-[11px]">{ctx.runtimeService()?.protocolVersion || '—'}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.runtimeProtocolNote')}</SettingsTableCell>
          </SettingsTableRow>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.desktopModelSource')}</SettingsTableCell>
            <SettingsTableCell>
              <SettingsPill tone={desktopModelSourceBindingTone(ctx.runtimeDesktopModelSourceBinding()?.state)}>
                {formatDesktopModelSourceBindingState(ctx.runtimeDesktopModelSourceBinding()?.state, i18n)}
              </SettingsPill>
            </SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">
              {ctx.runtimeDesktopModelSourceBinding()?.lastError || i18n.t('runtimeStatus.desktopModelSourceNote')}
            </SettingsTableCell>
          </SettingsTableRow>
          <Show when={ctx.upgradeState().allowsUpgradeAction && ctx.upgradeState().requiresTargetVersion}>
            <SettingsTableRow>
              <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.targetVersion')}</SettingsTableCell>
              <SettingsTableCell>
                <Input value={ctx.targetVersionInput()} onInput={(e) => ctx.setTargetVersionInput(e.currentTarget.value)}
                  placeholder="v1.2.3" size="sm" class="w-full" disabled={ctx.maintaining()} />
              </SettingsTableCell>
              <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.targetVersionNote')}</SettingsTableCell>
            </SettingsTableRow>
          </Show>
          <SettingsTableRow>
            <SettingsTableCell class="font-medium text-muted-foreground">{i18n.t('runtimeStatus.manifestETag')}</SettingsTableCell>
            <SettingsTableCell class="font-mono text-[11px]">{ctx.latestVersion()?.manifest_etag ? String(ctx.latestVersion()!.manifest_etag) : '—'}</SettingsTableCell>
            <SettingsTableCell class="text-[11px] text-muted-foreground">{i18n.t('runtimeStatus.manifestETagNote')}</SettingsTableCell>
          </SettingsTableRow>
        </SettingsTableBody>
      </SettingsTable>

      <div class="mt-3 space-y-2">
        <Show when={ctx.upgradeState().requiresTargetVersion && ctx.targetUpgradeVersion() && !ctx.targetUpgradeVersionValid()}>
          <div class="text-xs text-destructive">{i18n.t('runtimeStatus.validReleaseTagHint')}</div>
        </Show>
        <Show when={ctx.upgradeState().message}>
          <div class="text-xs text-muted-foreground">{ctx.upgradeState().message}</div>
        </Show>
        <Show when={ctx.upgradeState().policy === 'desktop_release' && ctx.upgradeState().releasePageURL}>
          <div class="text-xs text-muted-foreground">{i18n.t('runtimeStatus.desktopReleasePageHint')}</div>
        </Show>
        <Show when={ctx.latestVersionError()}>
          <div class="text-xs text-destructive">{i18n.t('runtimeStatus.latestVersionUnavailable', { message: ctx.latestVersionError() })}</div>
        </Show>
        <Show when={ctx.latestVersion()?.stale}>
          <div class="text-xs text-muted-foreground">{i18n.t('runtimeStatus.staleMetadataHint')}</div>
        </Show>
        <Show when={!ctx.canAdmin()}>
          <div class="text-xs text-muted-foreground">{i18n.t('runtimeStatus.adminRequired')}</div>
        </Show>
        <Show when={ctx.maintenanceStage()}>
          <div class="text-xs text-muted-foreground">{ctx.maintenanceStage()}</div>
        </Show>
      </div>
    </SettingsSection>
  );
}
