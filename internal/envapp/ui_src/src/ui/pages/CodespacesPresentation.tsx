import './codespaces.css';
import './resource-header.css';
import { For, Show, createSignal, type JSX } from 'solid-js';
import { cn, useResizeObserver } from '@floegence/floe-webapp-core';
import { RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Panel, PanelContent } from '@floegence/floe-webapp-core/layout';
import { Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

export function CodespacesPageFrame(props: {
  children: JSX.Element;
  readiness?: JSX.Element;
  refreshing?: boolean;
  reloadState?: 'pending' | 'content' | 'error';
  onRefresh?: () => void;
  onCreate?: () => void;
}) {
  const i18n = useI18n();
  return <div data-env-reload-state={props.reloadState ?? 'pending'} data-floe-reload-scroll="codespaces" {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class={cn('codespaces-page h-full min-h-0 overflow-auto', redevenSurfaceRoleClass('main'))}>
    <Panel class={cn('overflow-hidden', redevenSurfaceRoleClass('panelStrong'))} data-testid="codespaces-panel">
      <header class="codespaces-header redeven-resource-header">
        <h1>{i18n.t('codespaces.title')}</h1>
        <div class="flex items-center gap-2 flex-shrink-0">
          {props.readiness}
          <Button size="sm" variant="outline" onClick={props.onRefresh} disabled={!props.onRefresh || props.refreshing}
            aria-label={i18n.t('codespaces.actions.refresh')} title={i18n.t('codespaces.actions.refresh')}
            aria-busy={props.refreshing ? 'true' : undefined} class={redevenSurfaceRoleClass('control')}>
            <RefreshIcon class={cn('w-3.5 h-3.5 sm:mr-1', props.refreshing && 'animate-spin motion-reduce:animate-none')} />
            <span class="hidden sm:inline">{i18n.t('codespaces.actions.refresh')}</span>
          </Button>
          <Button size="sm" variant="default" onClick={props.onCreate} disabled={!props.onCreate}
            aria-label={i18n.t('codespaces.actions.newCodespace')} title={i18n.t('codespaces.actions.newCodespace')}>
            <svg class="w-3.5 h-3.5 sm:mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span class="hidden sm:inline">{i18n.t('codespaces.actions.newCodespace')}</span>
          </Button>
        </div>
      </header>
      <PanelContent class="codespaces-content p-4 space-y-4">
        {props.children}
      </PanelContent>
    </Panel>
  </div>;
}

export function CodespacesGrid(props: { children: JSX.Element; hidden?: boolean }) {
  return <div class="codespaces-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" aria-hidden={props.hidden}>{props.children}</div>;
}

/** Loading and loaded cards share every layout boundary. */
export function CodespaceCardFrame(props: {
  title: JSX.Element; description: JSX.Element; descriptionTitle?: string; status: JSX.Element;
  path?: JSX.Element; details: JSX.Element; actions: JSX.Element; class?: string; skeleton?: boolean;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  const i18n = useI18n();
  let card: HTMLDivElement | undefined;
  const size = useResizeObserver(() => card?.closest('.codespaces-page') as HTMLElement | undefined);
  const compact = () => (size()?.width ?? 768) < 768;
  const [expanded, setExpanded] = createSignal(false);
  return <Card ref={card} class={cn('codespace-card border transition-colors duration-200', props.class)} onContextMenu={props.onContextMenu}
    data-codespace-skeleton={props.skeleton ? 'true' : undefined}>
    <CardHeader class="pb-2">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <CardTitle class="text-[length:var(--floe-type-body)] leading-5 truncate">{props.title}</CardTitle>
          <Show when={props.description}><CardDescription class="text-xs leading-4 truncate mt-0.5" title={props.descriptionTitle}>{props.description}</CardDescription></Show>
        </div>
        <div class="codespace-card-status flex h-5 shrink-0 items-center">{props.status}</div>
      </div>
    </CardHeader>
    <CardContent class="pb-2">
      <Show when={props.path}><div class="codespace-path text-xs font-mono truncate mb-1">{props.path}</div></Show>
      <details open={!compact() || expanded()} onToggle={event => { if (compact()) setExpanded(event.currentTarget.open); }}>
        <summary class="codespace-details-toggle cursor-pointer text-xs text-muted-foreground">{i18n.t('codespaces.fields.details')}</summary>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] leading-4">{props.details}</div>
      </details>
    </CardContent>
    <CardFooter class={cn('pt-2 flex items-center justify-between gap-2 border-t', redevenDividerRoleClass())}>{props.actions}</CardFooter>
  </Card>;
}

const Bar = (props: { class?: string }) => <span class={cn('codespace-skeleton-bar inline-block rounded bg-muted align-middle', props.class)} />;

export function CodespacesListSkeleton() {
  const i18n = useI18n();
  return <div role="status" aria-live="polite" aria-busy="true" data-testid="codespaces-initial-loading">
    <span class="sr-only">{i18n.t('codespaces.loadingMessage')}</span>
    <CodespacesGrid hidden>
      <For each={['', 'hidden md:block', 'hidden lg:block']}>{visibility => <CodespaceCardFrame skeleton
        class={cn(redevenSurfaceRoleClass('panelInteractive'), visibility)}
        title={<Bar class="h-3 w-28 max-w-full" />} description={<Bar class="h-2 w-36 max-w-full" />}
        status={<Bar class="h-4 w-14" />}
        path={<Bar class="h-2 w-36 max-w-full" />}
        details={<For each={[0, 1, 2]}>{() => <><div class="h-4"><Bar class="h-2 w-12" /></div><div class="h-4 text-right"><Bar class="h-2 w-20 max-w-full" /></div></>}</For>}
        actions={<><Bar class="h-7 flex-1" /><Bar class="h-7 w-8 shrink-0" /><Bar class="h-7 w-8 shrink-0" /></>}
      />}</For>
    </CodespacesGrid>
  </div>;
}

export function CodespacesPageSkeleton() {
  return <CodespacesPageFrame refreshing><CodespacesListSkeleton /></CodespacesPageFrame>;
}
