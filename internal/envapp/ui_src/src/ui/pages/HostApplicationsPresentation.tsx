import { For, type JSX } from 'solid-js';
import { Filter, Plus, Refresh, Search } from '@floegence/floe-webapp-core/icons';
import { Button, Input, FeedbackIndicator, type FeedbackIndicatorEntry } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import './host-applications.css';
import './resource-header.css';

export function HostApplicationsHeader(props: { actions?: JSX.Element; feedback?: readonly FeedbackIndicatorEntry[] }) {
  const i18n = useI18n();
  let heading: HTMLHeadingElement | undefined;
  return <header class="host-apps-header redeven-resource-header">
    <h1 ref={heading} tabIndex={-1}>{i18n.t('hostApplications.title')}</h1>
    <div class="flex items-center gap-2 shrink-0"><FeedbackIndicator entries={props.feedback ?? []} label={i18n.t('hostApplications.title')} closeLabel={i18n.t('common.actions.close')} restoreFocus={() => heading} />{props.actions ?? <>
      <Button variant="ghost" size="sm" disabled aria-label={i18n.t('hostApplications.refresh')}><Refresh class="w-4 h-4 animate-spin motion-reduce:animate-none" /></Button>
      <Button variant="outline" size="sm" disabled><Plus class="w-3.5 h-3.5" /><span>{i18n.t('hostApplications.add')}</span></Button>
    </>}</div>
  </header>;
}

export function HostApplicationsListSkeleton() {
  const i18n = useI18n();
  return <div role="status" aria-label={i18n.t('hostApplications.loading')} data-testid="host-applications-initial-loading">
    <section class="host-apps-running" aria-hidden="true">
      <div class="host-apps-section-title"><h2>{i18n.t('hostApplications.running')}</h2><span class="invisible">0</span></div>
      <p class="host-apps-hint"><span class="inline-block h-2 w-80 max-w-full rounded bg-muted" /></p>
      <div class="host-apps-session-grid host-apps-process-grid"><For each={[0, 1, 2]}>{() => <div class={`host-app-session host-app-process ${redevenSurfaceRoleClass('panelInteractive')}`}>
        <div class="host-app-process-row"><div class="host-app-session-open"><span class="host-app-icon rounded-lg bg-muted" /><span class="min-w-0"><strong class="block h-4 w-28 rounded bg-muted" /><span class="host-app-status h-3 w-16 rounded bg-muted" /></span></div><span class="mr-4 h-3 w-12 rounded bg-muted" /></div>
      </div>}</For></div>
    </section>
    <section class="host-apps-library" aria-hidden="true">
      <div class="host-apps-library-heading"><div class="host-apps-section-title"><h2>{i18n.t('hostApplications.library')}</h2></div>
        <div class="host-apps-filters"><div class="host-apps-search"><Search class="w-3.5 h-3.5" /><Input disabled placeholder={i18n.t('hostApplications.search')} /></div><div class="host-apps-mobile-filters"><button disabled class="host-apps-filter-button" aria-label={i18n.t('hostApplications.filterApplications')}><Filter class="h-4 w-4" /></button></div></div>
      </div>
      <div class="host-apps-grid"><For each={[0, 1, 2, 3, 4, 5]}>{() => <div class="host-app-tile-wrap"><div class={`host-app-tile ${redevenSurfaceRoleClass('panelInteractive')}`}><span class="host-app-icon rounded-lg bg-muted" /><span class="h-4 w-28 max-w-full rounded bg-muted" /></div></div>}</For></div>
    </section>
  </div>;
}

export function HostApplicationsPageSkeleton() {
  return <div class="host-apps h-full min-h-0 flex flex-col"><HostApplicationsHeader /><div class="host-apps-content min-h-0 flex-1 overflow-auto"><HostApplicationsListSkeleton /></div></div>;
}
