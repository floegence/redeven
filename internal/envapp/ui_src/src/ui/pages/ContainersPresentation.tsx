import { For, Show, type JSX } from 'solid-js';
import { Activity, Database, FileText, Filter, Layers, MoreHorizontal, Package, Plus, Refresh, Search, Settings } from '@floegence/floe-webapp-core/icons';
import { Button, Input, Tabs } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import type { ContainerResourceView } from '../services/containerResourcesApi';
import { sanitizePersistedState } from './containerPageState';
import { readUIStorageJSON } from '../services/uiStorage';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import './env-containers.css';
import './resource-header.css';

export function ContainerViewIcon(props: { view: ContainerResourceView; class?: string }) {
  return <Show when={props.view === 'images'} fallback={<Show when={props.view === 'volumes'} fallback={<Show when={props.view === 'compose-projects'} fallback={<Show when={props.view === 'pods'} fallback={<Layers class={props.class} />}><Activity class={props.class} /></Show>}><FileText class={props.class} /></Show>}><Database class={props.class} /></Show>}><Package class={props.class} /></Show>;
}

export function ContainersHeader(props: { controls?: JSX.Element; tabs: JSX.Element }) {
  const i18n = useI18n();
  return <header class="container-command-header shrink-0"><div class="container-header-main redeven-resource-header">
    <h1 class="container-page-title truncate">{i18n.t('containers.title')}</h1>
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
    <div class="container-compact-filter"><button disabled class="container-compact-filter-trigger" aria-label={i18n.t('containers.filters.label')}><Filter class="h-4 w-4" /></button></div>
    <div class="container-toolbar-actions"><div class="container-column-picker"><button disabled class="container-icon-action inline-flex items-center justify-center" aria-label={i18n.t('containers.columns.filter')}><Filter class="h-4 w-4" /></button></div>
      <Show when={props.view === 'containers'}><Button class="container-charts-toggle" size="sm" variant="ghost" disabled><Activity class="mr-1.5 h-3.5 w-3.5" />{i18n.t('containers.detail.showCharts')}</Button></Show>
      <Show when={props.view === 'containers' || storageView()}><button disabled class={props.view === 'containers' ? 'container-compact-more' : 'container-icon-action'} aria-label={i18n.t('containers.prune.moreActions')}><MoreHorizontal class="h-4 w-4" /></button></Show>
      <Button size="sm" disabled aria-label={i18n.t(createLabel())}><Plus class="mr-1.5 h-3.5 w-3.5" /><span class="container-create-label">{i18n.t(createLabel())}</span></Button>
    </div>
  </section>;
}

type InventoryColumns = { view: ContainerResourceView; volumeSize?: boolean; secondary?: boolean; ports?: boolean; charts?: boolean; created?: boolean };
type InventorySort = 'name' | 'status' | 'size' | 'secondary' | 'created';

export function ContainerInventoryTableHeader(props: InventoryColumns & { sortKey?: InventorySort; sortDirection?: 'ascending' | 'descending'; renderSort?: (key: InventorySort, label: string) => JSX.Element }) {
  const i18n = useI18n();
  const column = (key: InventorySort, label: string, className: string, numeric = false) => <th class={className} data-numeric={numeric || undefined} aria-sort={props.sortKey === key ? props.sortDirection : 'none'}>
    {props.renderSort ? props.renderSort(key, label) : <span class="container-sort-control">{label}</span>}
  </th>;
  const secondaryLabel = () => i18n.t(props.view === 'containers' ? 'containers.columns.image' : props.view === 'images' ? 'containers.columns.size' : props.view === 'volumes' ? 'containers.columns.driver' : 'containers.columns.running');
  return <thead><tr>
    {column('name', i18n.t('containers.columns.name'), 'container-name-column')}
    {column('status', i18n.t('containers.columns.status'), 'container-status-column')}
    <Show when={props.view === 'volumes' && props.volumeSize}>{column('size', i18n.t('containers.volumeUsage.size'), 'container-volume-size')}</Show>
    <Show when={props.secondary}>{column('secondary', secondaryLabel(), 'container-secondary-column', props.view !== 'containers' && props.view !== 'volumes')}</Show>
    <Show when={props.view === 'containers'}><Show when={props.ports}><th class="container-port-column">{i18n.t('containers.detail.ports')}</th></Show><Show when={props.charts}><th class="container-metric-column">{i18n.t('containers.stats.cpu')}</th><th class="container-metric-column">{i18n.t('containers.stats.memory')}</th></Show></Show>
    <Show when={props.view !== 'containers' && props.created}>{column('created', i18n.t('containers.columns.created'), 'container-created-column')}</Show>
    <th class="container-actions-column">{i18n.t('containers.detail.actions')}</th>
  </tr></thead>;
}

export function ContainerInventorySkeleton(props: InventoryColumns & { header: JSX.Element }) {
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

export function ContainersPageSkeleton(props: { stateScope?: string; variant?: 'activity' | 'workbench' } = {}) {
  const i18n = useI18n();
  const { view } = sanitizePersistedState(readUIStorageJSON(`containers:${props.stateScope?.trim() || 'activity'}`, {}));
  const tabs = ['containers', 'images', 'volumes', ...(view === 'compose-projects' || view === 'pods' ? [view] : [])] as ContainerResourceView[];
  const secondary = view !== 'volumes';
  const header = <ContainerInventoryTableHeader view={view} volumeSize secondary={secondary} ports />;
  return <div class={`redeven-containers flex h-full min-h-0 flex-col ${redevenSurfaceRoleClass('main')}`} data-container-page data-variant={props.variant ?? 'activity'} data-resource-view={view}>
    <ContainersHeader tabs={<Tabs class="container-resource-tabs" items={tabs.map(id => ({ id, label: i18n.t(`containers.views.${id}`), icon: <ContainerViewIcon view={id} class="h-4 w-4" />, disabled: true }))} activeId={view} onChange={() => {}} size="md" ariaLabel={i18n.t('containers.resourceNavigation')} features={{ indicator: { mode: 'slider', thicknessPx: 2, colorToken: 'primary', animated: true }, containerBorder: false, scrollButtons: 'auto' }} slotClassNames={{ scrollContainer: 'container-resource-tabs__scroller', tab: 'container-resource-tabs__tab', indicator: 'container-tab-indicator' }} />} />
    <main class="container-content min-h-0 flex-1 overflow-hidden" aria-busy="true"><div class="container-list-page" data-container-list-loading aria-label={i18n.t('containers.loading')}><ContainerInventoryToolbarSkeleton view={view} /><div class="container-inventory-scroll"><ContainerInventorySkeleton view={view} header={header} volumeSize secondary={secondary} ports /></div></div></main>
  </div>;
}
