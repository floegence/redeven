import { For, Show, type JSX } from 'solid-js';
import { Activity, Database, FileText, Filter, Layers, Package, Plus, Refresh, Search, Settings } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Tabs } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import type { ContainerResourceView } from '../services/containerResourcesApi';
import { readUIStorageJSON } from '../services/uiStorage';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import './env-containers.css';

export function ContainerViewIcon(props: { view: ContainerResourceView; class?: string }) {
  return <Show when={props.view === 'images'} fallback={<Show when={props.view === 'volumes'} fallback={<Show when={props.view === 'compose-projects'} fallback={<Show when={props.view === 'pods'} fallback={<Layers class={props.class} />}><Activity class={props.class} /></Show>}><FileText class={props.class} /></Show>}><Database class={props.class} /></Show>}><Package class={props.class} /></Show>;
}

export function ContainersHeader(props: { controls?: JSX.Element; tabs: JSX.Element }) {
  const i18n = useI18n();
  return <header class="container-command-header shrink-0 px-3 md:px-5"><div class="container-header-main">
    <div class="flex min-w-0 items-center gap-2.5"><div class="container-product-mark"><Layers class="h-5 w-5" aria-hidden="true" /></div><h1 class="container-page-title truncate">{i18n.t('containers.title')}</h1></div>
    <div class="container-header-controls">{props.controls ?? <>
      <Button size="sm" variant="ghost" class="container-icon-action container-services-entry" disabled aria-label={i18n.t('containers.services.title')}><Settings class="h-4 w-4" /></Button>
      <Button size="sm" variant="ghost" class="container-icon-action" disabled aria-label={i18n.t('containers.actions.refresh')}><Refresh class="h-4 w-4 animate-spin motion-reduce:animate-none" /></Button>
      <Button size="sm" variant="ghost" class="container-icon-action" disabled aria-label={i18n.t('containers.operations.title')}><Activity class="h-4 w-4" /></Button>
    </>}</div>
  </div>{props.tabs}</header>;
}

export function ContainerInventoryToolbarSkeleton(props: { view: ContainerResourceView }) {
  const i18n = useI18n();
  const storageView = () => props.view === 'images' || props.view === 'volumes';
  const createLabel = () => props.view === 'containers' ? 'containers.create.container' : props.view === 'images' ? 'containers.create.image' : props.view === 'volumes' ? 'containers.create.volume' : props.view === 'pods' ? 'containers.create.pod' : 'containers.compose.add';
  return <section class="container-resource-toolbar" data-container-summary data-loading="true">
    <div class="container-search-control"><Search class="h-4 w-4" /><Input disabled aria-label={i18n.t('containers.search.label')} placeholder={i18n.t('containers.search.label')} /></div>
    <div class="container-filter-switch" role="group" aria-label={i18n.t('containers.filters.label')}><button disabled aria-pressed={storageView()}>{i18n.t('containers.filters.all')}</button><button disabled aria-pressed={!storageView()}>{i18n.t(storageView() ? 'containers.filters.inUse' : 'containers.filters.active')}</button><button disabled>{i18n.t(storageView() ? 'containers.filters.unused' : 'containers.filters.inactive')}</button></div>
    <div class="container-toolbar-actions"><div class="container-column-picker"><button disabled class="container-icon-action inline-flex items-center justify-center" aria-label={i18n.t('containers.columns.filter')}><Filter class="h-4 w-4" /></button></div>
      <Show when={props.view === 'containers'}><Button size="sm" variant="ghost" disabled><Activity class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.detail.showCharts')}</Button></Show>
      <Button size="sm" disabled><Plus class="mr-1.5 h-3.5 w-3.5" />{i18n.t(createLabel())}</Button>
    </div>
  </section>;
}

export function ContainerInventorySkeleton(props: { view: ContainerResourceView; header: JSX.Element; volumeSize?: boolean; secondary?: boolean; ports?: boolean; charts?: boolean; created?: boolean }) {
  return <>
      <div class="container-resource-table-shell container-resource-table-shell--loading" data-container-resource-skeleton-table>
        <table class="w-full text-left text-sm">
          {props.header}
          <tbody><For each={[0, 1, 2, 3, 4]}>{(row) => <tr data-container-skeleton-row aria-hidden="true">
            <td><div class="container-name-cell"><span class="container-skeleton container-skeleton--resource-icon" /><span class="container-skeleton container-skeleton--name" data-row={row % 3} /></div></td>
            <td class="container-status-column"><span class={`container-skeleton ${props.view === 'images' || props.view === 'volumes' ? 'container-skeleton--dot' : 'container-skeleton--status'}`} /></td>
            <Show when={props.view === 'volumes' && props.volumeSize}><td><span class="container-skeleton container-skeleton--metric" /></td></Show>
            <Show when={props.secondary}><td class="container-secondary-column" data-numeric={props.view !== 'containers' && props.view !== 'volumes'}><span class="container-skeleton container-skeleton--secondary" data-row={row % 2} /></td></Show>
            <Show when={props.view === 'containers'}><Show when={props.ports}><td><span class="container-skeleton container-skeleton--port" data-row={row % 2} /></td></Show><Show when={props.charts}><td><span class="container-skeleton container-skeleton--metric" /></td><td><span class="container-skeleton container-skeleton--metric" /></td></Show></Show>
            <Show when={props.view !== 'containers' && props.created}><td class="container-created-column"><span class="container-skeleton container-skeleton--created" /></td></Show>
            <td class="container-actions-column"><div class="container-row-actions"><span class="container-skeleton container-skeleton--action" /><span class="container-skeleton container-skeleton--action" /><span class="container-skeleton container-skeleton--chevron" /></div></td>
          </tr>}</For></tbody>
        </table>
      </div>
      <div class="container-mobile-list container-mobile-list--loading" data-container-mobile-skeleton aria-hidden="true">
        <For each={[0, 1, 2, 3, 4]}>{(row) => <div class="container-mobile-card">
          <span class="container-skeleton container-skeleton--resource-icon" />
          <span class="container-mobile-skeleton-copy"><span class="container-skeleton container-skeleton--name" data-row={row % 3} /><span class="container-skeleton container-skeleton--mobile-secondary" /></span>
          <span class="container-skeleton container-skeleton--mobile-status" />
          <span class="container-skeleton container-skeleton--chevron" />
        </div>}</For>
      </div>
    </>;
}

export function ContainersPageSkeleton() {
  const i18n = useI18n();
  const saved = readUIStorageJSON<{ view?: ContainerResourceView }>('containers:activity', {});
  const views: ContainerResourceView[] = ['containers', 'images', 'volumes', 'compose-projects', 'pods'];
  const view = views.includes(saved.view!) ? saved.view! : 'containers';
  const tabs = ['containers', 'images', 'volumes', ...(view === 'compose-projects' || view === 'pods' ? [view] : [])] as ContainerResourceView[];
  const secondary = view !== 'volumes';
  const secondaryKey = view === 'containers' ? 'containers.columns.image' : view === 'images' ? 'containers.columns.size' : 'containers.columns.running';
  const header = <thead><tr><th class="container-name-column"><span class="container-sort-control">{i18n.t('containers.columns.name')}</span></th><th class="container-status-column"><span class="container-sort-control">{i18n.t('containers.columns.status')}</span></th><Show when={view === 'volumes'}><th class="container-volume-size">{i18n.t('containers.volumeUsage.size')}</th></Show><Show when={secondary}><th class="container-secondary-column">{i18n.t(secondaryKey)}</th></Show><Show when={view === 'containers'}><th class="container-port-column">{i18n.t('containers.detail.ports')}</th></Show><th class="container-actions-column">{i18n.t('containers.detail.actions')}</th></tr></thead>;
  return <div class={`redeven-containers flex h-full min-h-0 flex-col ${redevenSurfaceRoleClass('main')}`} data-container-page data-resource-view={view}>
    <ContainersHeader tabs={<Tabs class="container-resource-tabs" items={tabs.map(id => ({ id, label: i18n.t(`containers.views.${id}`), icon: <ContainerViewIcon view={id} class="h-4 w-4" />, disabled: true }))} activeId={view} onChange={() => {}} size="md" ariaLabel={i18n.t('containers.resourceNavigation')} features={{ indicator: { mode: 'slider', thicknessPx: 2, colorToken: 'primary', animated: true }, containerBorder: false, scrollButtons: 'auto' }} slotClassNames={{ scrollContainer: 'container-resource-tabs__scroller', tab: 'container-resource-tabs__tab', indicator: 'container-tab-indicator' }} />} />
    <main class="container-content min-h-0 flex-1 overflow-hidden" aria-busy="true"><div class="container-list-page" data-container-list-loading aria-label={i18n.t('containers.loading')}><ContainerInventoryToolbarSkeleton view={view} /><div class="container-inventory-scroll"><ContainerInventorySkeleton view={view} header={header} volumeSize secondary={secondary} ports /></div></div></main>
  </div>;
}
