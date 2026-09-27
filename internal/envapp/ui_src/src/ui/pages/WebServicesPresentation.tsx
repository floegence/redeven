import { For, type JSX } from 'solid-js';
import { ChevronDown, FileText, Globe, Plus, RefreshIcon, Search } from '@floegence/floe-webapp-core/icons';
import { Button, Input, StatusRegion } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import './web-services.css';
import './resource-header.css';

export function WebServicesHeader(props: { actions?: JSX.Element }) {
  const i18n = useI18n();
  return <header class="web-services-header redeven-resource-header" data-testid="web-services-panel">
    <h1>{i18n.t('webServices.title')}</h1>
    <div class="web-services-header-actions">{props.actions ?? <>
      <Button size="sm" variant="outline" disabled class={`h-8 ${redevenSurfaceRoleClass('control')}`}><FileText class="mr-1.5 h-3.5 w-3.5" /><span>{i18n.t('webServices.managed.serviceTemplates')}</span></Button>
      <Button size="sm" disabled class="h-8"><Plus class="mr-1.5 h-3.5 w-3.5" /><span>{i18n.t('webServices.actions.addService')}</span></Button>
    </>}</div>
  </header>;
}

export function WebServicesListSkeleton() {
  const i18n = useI18n();
  return <div role="status" aria-label={i18n.t('webServices.loadingMessage')} data-testid="web-services-initial-loading">
    <div class={`web-service-list ${redevenSurfaceRoleClass('panel')}`} aria-hidden="true">
      <For each={[0, 1, 2]}>{() => <div class="web-service-row">
        <div class="web-service-identity"><span class="h-8 w-8 shrink-0 rounded-lg bg-muted" /><div class="web-service-identity-content min-w-0"><div class="flex h-5 items-center"><span class="h-3 w-32 rounded bg-muted" /></div><div class="mt-0.5 flex h-4 items-center"><span class="h-2 w-52 max-w-full rounded bg-muted" /></div><div class="web-service-metadata web-service-forward-meta h-[18px]"><span class="h-2 w-36 rounded bg-muted" /><span class="h-2 w-20 rounded bg-muted" /></div></div></div>
        <div class="web-service-status"><span class="web-service-state inline-flex items-center text-xs font-medium"><span class="h-3 w-12 rounded bg-muted" /></span></div><div class="web-service-actions"><span class="web-service-open h-8 rounded bg-muted" /><span class="web-service-manage h-8 rounded bg-muted" /><span class="web-service-more h-8 rounded bg-muted" /></div>
      </div>}</For>
    </div>
  </div>;
}

export function WebServicesPageSkeleton() {
  const i18n = useI18n();
  return <div class={`web-services flex h-full min-h-0 flex-col overflow-hidden ${redevenSurfaceRoleClass('main')}`}>
    <WebServicesHeader />
    <main class="web-services-main min-h-0 flex-1 overflow-auto"><div class="web-services-content">
      <section aria-label={i18n.t('webServices.address.label')}><div class="w-full"><div class="web-services-address"><div class="relative min-w-0 flex-1">
        <Globe class="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input disabled size="sm" class="h-10 w-full pl-10 pr-12 font-mono text-[length:var(--floe-type-body)]" placeholder={i18n.t('webServices.address.placeholder')} />
      </div></div><div class="web-services-address-guidance mt-2 text-xs flex items-center gap-2 px-0.5 leading-5 text-muted-foreground"><Globe class="h-3.5 w-3.5 shrink-0" /><span><span class="font-medium text-foreground">{i18n.t('webServices.address.scopeTitle')}</span>{' '}{i18n.t('webServices.address.scopeDescription')}</span></div></div></section>
      <section class="space-y-3"><div class="web-services-toolbar"><div class="web-services-toolbar-heading"><h2>{i18n.t('webServices.collection.title')}</h2></div><div class="web-services-toolbar-actions">
        <div class="web-services-search"><Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input disabled size="sm" class="h-9 w-full pl-9 pr-9" placeholder={i18n.t('webServices.search.placeholder')} /></div>
        <button disabled class="web-services-menu-trigger"><span>{i18n.t('webServices.collection.archives')}<ChevronDown class="ml-1.5 h-3.5 w-3.5" /></span></button>
        <Button size="sm" variant="ghost" disabled class="h-9 w-9 shrink-0 px-0" aria-label={i18n.t('webServices.actions.refresh')}><RefreshIcon class="h-4 w-4 animate-spin motion-reduce:animate-none" /></Button>
      </div></div><div class="relative" style={{ 'min-height': '200px' }}><StatusRegion lines={3} class="text-xs" /><WebServicesListSkeleton /></div></section>
    </div></main>
  </div>;
}
