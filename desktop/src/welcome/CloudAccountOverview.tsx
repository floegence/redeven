import { Show, createMemo, createSignal, createUniqueId } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Activity, AlertTriangle, CheckCircle, Clock, Cloud, Grid, Link, Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { DesktopControlPlaneSummary } from '../shared/controlPlaneProvider';
import type { DesktopI18n } from '../shared/i18n';
import { DesktopActionPopover } from './DesktopActionPopover';
import type { EnvironmentCloudSection } from './environmentLibraryProjection';
import { busyStateMatchesControlPlane, type DesktopLauncherBusyState } from './launcherBusyState';
import { buildControlPlaneStatusModel } from './viewModel';

export function CloudAccountOverview(props: Readonly<{
  i18n: DesktopI18n;
  section: EnvironmentCloudSection;
  lastSyncedLabel: string;
  busyState: DesktopLauncherBusyState;
  reconnectControlPlane: (source: DesktopControlPlaneSummary) => Promise<void>;
  refreshControlPlane: (source: DesktopControlPlaneSummary) => Promise<void>;
  signOutControlPlane: (source: DesktopControlPlaneSummary) => void;
}>) {
  const headingID = createUniqueId();
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const source = () => props.section.source;
  const sourceName = () => source().display_label || 'Redeven Cloud';
  const accountName = () => source().account.user_display_name || sourceName();
  const status = createMemo(() => buildControlPlaneStatusModel(source()));
  const stale = () => source().sync_state !== 'ready' || source().catalog_freshness !== 'fresh';
  const onlineCount = createMemo(() => props.section.groups.filter(group => (
    (group.provider_entry ?? group.primary_entry).runtime_health.status === 'online'
  )).length);
  const reconnectBusy = () => busyStateMatchesControlPlane(props.busyState, source().provider.provider_origin, source().provider.provider_id, ['start_control_plane_connect']);
  const refreshBusy = () => busyStateMatchesControlPlane(props.busyState, source().provider.provider_origin, source().provider.provider_id, ['refresh_control_plane']);
  const signOutBusy = () => busyStateMatchesControlPlane(props.busyState, source().provider.provider_origin, source().provider.provider_id, ['sign_out_control_plane']);
  const syncTime = () => props.i18n.t('environmentCenter.providerSynced', { time: props.lastSyncedLabel });

  return (
    <header class="redeven-cloud-source-header" aria-labelledby={headingID}>
      <div class="redeven-cloud-account-main">
        <div class="redeven-cloud-account-identity">
          <span class="redeven-cloud-account-mark" aria-hidden="true"><Cloud /></span>
          <div class="min-w-0">
            <h2 id={headingID} class="redeven-cloud-account-name" title={accountName()}>{accountName()}</h2>
            <div class="redeven-cloud-account-address" title={`${sourceName()} · ${source().provider.provider_origin}`}>
              <Show when={sourceName() !== 'Redeven Cloud' && sourceName() !== accountName()}>
                <span>{sourceName()}</span><span aria-hidden="true">·</span>
              </Show>
              <span>{new URL(source().provider.provider_origin).host}</span>
            </div>
          </div>
        </div>
        <dl class="redeven-cloud-account-stats" data-cloud-source-counts>
          <div data-cloud-stat="environments">
            <dt><Grid aria-hidden="true" />{props.i18n.t('environmentCenter.cloudEnvironments')}</dt>
            <dd>{props.i18n.formatNumber(props.section.groups.length)}</dd>
          </div>
          <div data-cloud-stat="online" data-stale={stale()}>
            <dt><Activity aria-hidden="true" />{props.i18n.t('environmentCenter.cloudOnline')}</dt>
            <dd>{props.i18n.formatNumber(onlineCount())}</dd>
          </div>
          <div data-cloud-stat="linked">
            <dt><Link aria-hidden="true" />{props.i18n.t('environmentCenter.cloudLinkedRuntimes')}</dt>
            <dd>{props.i18n.formatNumber(props.section.linked_runtime_count)}</dd>
          </div>
        </dl>
        <div class="redeven-cloud-account-actions">
          <Show when={status().recovery_action === 'sign_in'} fallback={
            <Button size="sm" variant="outline" loading={refreshBusy() || source().sync_state === 'syncing'} disabled={signOutBusy() || reconnectBusy()}
              onClick={() => { void props.refreshControlPlane(source()); }}>
              <Refresh class="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{props.i18n.t('common.refresh')}
            </Button>
          }>
            <Button size="sm" variant="outline" loading={reconnectBusy()} disabled={signOutBusy()}
              onClick={() => { void props.reconnectControlPlane(source()); }}>
              {props.i18n.t('environmentCenter.cloudSignInAgain')}
            </Button>
          </Show>
          <Button size="sm" variant="ghost" loading={signOutBusy()} disabled={reconnectBusy()}
            aria-label={props.i18n.t('environmentCenter.cloudSignOutAriaLabel', { label: accountName() })}
            onClick={() => props.signOutControlPlane(source())}>
            {props.i18n.t('environmentCenter.cloudSignOut')}
          </Button>
        </div>
      </div>
      <div class="redeven-cloud-account-sync">
        <div class="redeven-cloud-account-sync-state" role="status">
          <span class="redeven-cloud-account-status" data-tone={status().tone}>
            <Dynamic component={status().tone === 'warning' ? AlertTriangle : source().sync_state === 'syncing' ? Refresh : status().tone === 'neutral' ? Clock : CheckCircle}
              class={source().sync_state === 'syncing' ? 'animate-spin' : undefined} aria-hidden="true" />
            {props.i18n.t(status().label_key)}
          </span>
          <Show when={stale() && source().last_synced_at_ms > 0}><span class="redeven-cloud-account-stale">{props.i18n.t('environmentCenter.cloudLastSyncResults')}</span></Show>
        </div>
        <div class="redeven-cloud-account-sync-meta">
          <Show when={source().last_synced_at_ms > 0}>
            <span class="redeven-cloud-account-sync-time" title={props.i18n.formatDateTime(source().last_synced_at_ms)}>
              <Clock aria-hidden="true" />{syncTime()}
            </span>
          </Show>
          <DesktopActionPopover open={detailsOpen()} onOpenChange={setDetailsOpen}
            popoverAriaLabel={props.i18n.t('environmentCenter.cloudSyncDetails')}
            class="redeven-cloud-account-details"
            content={
              <div class="space-y-3 p-4">
                <h3 class="text-sm font-semibold">{props.i18n.t('environmentCenter.cloudSyncDetails')}</h3>
                <p class="text-xs text-muted-foreground">{props.i18n.t(status().detail_key)}</p>
                <p class="break-all font-mono text-xs">{source().provider.provider_origin}</p>
                <Show when={source().last_sync_error_message && status().tone === 'warning'}>
                  <div class="rounded-md border border-border bg-muted/30 p-3">
                    <p class="mb-1 text-xs font-medium">{props.i18n.t('environmentCenter.cloudTechnicalDetails')}</p>
                    <p class="break-words text-xs text-muted-foreground">{source().last_sync_error_message}</p>
                  </div>
                </Show>
                <Button size="sm" variant="outline" onClick={() => setDetailsOpen(false)}>{props.i18n.t('common.close')}</Button>
              </div>
            }>
            <button type="button" class="redeven-cloud-account-details-trigger" aria-expanded={detailsOpen()} aria-haspopup="dialog"
              onClick={() => setDetailsOpen(!detailsOpen())}>{props.i18n.t('environmentCenter.cloudSyncDetails')}</button>
          </DesktopActionPopover>
        </div>
      </div>
    </header>
  );
}
