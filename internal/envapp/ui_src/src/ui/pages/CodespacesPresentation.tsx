import './codespaces.css';
import './resource-header.css';
import { For, Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { RefreshIcon } from '@floegence/floe-webapp-core/icons';
import {
  FeedbackIndicator,
  type FeedbackIndicatorEntry,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

export function CodespacesPageFrame(props: {
  children: JSX.Element;
  readiness?: JSX.Element;
  feedback?: readonly FeedbackIndicatorEntry[];
  refreshing?: boolean;
  reloadState?: 'pending' | 'content' | 'error';
  onRefresh?: () => void;
  onCreate?: () => void;
}) {
  const i18n = useI18n();
  let heading: HTMLHeadingElement | undefined;
  return <div data-env-reload-state={props.reloadState ?? 'pending'} class={cn('codespaces-page flex h-full min-h-0 flex-col overflow-hidden', redevenSurfaceRoleClass('main'))}>
    <header class="codespaces-header redeven-resource-header">
      <h1 ref={heading} tabIndex={-1}>{i18n.t('codespaces.title')}</h1>
      <div class="flex items-center gap-2 flex-shrink-0">
        <FeedbackIndicator entries={props.feedback ?? []} label={i18n.t('codespaces.title')} closeLabel={i18n.t('common.actions.close')} restoreFocus={() => heading} />
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
    <div data-floe-reload-scroll="codespaces" {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="codespaces-content min-h-0 flex-1 overflow-auto p-4 space-y-4">
      {props.children}
    </div>
  </div>;
}

export function CodespacesGrid(props: { children: JSX.Element; hidden?: boolean }) {
  return <div class="codespaces-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-start" aria-hidden={props.hidden}>{props.children}</div>;
}

/** Loading and loaded cards share every layout boundary. */
export function CodespaceCardFrame(props: {
  title: JSX.Element; description: JSX.Element; status: JSX.Element;
  path?: JSX.Element; details: JSX.Element; actions: JSX.Element; class?: string; skeleton?: boolean;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  const i18n = useI18n();
  return <Card class={cn('codespace-card min-w-0', props.class)} onContextMenu={props.onContextMenu}
    data-codespace-skeleton={props.skeleton ? 'true' : undefined}>
    <CardHeader class="p-3 pb-1">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <CardTitle class="text-[0.8125rem] font-medium leading-5 truncate" title={typeof props.title === 'string' ? props.title : undefined}>{props.title}</CardTitle>
        </div>
        <div class="codespace-card-status flex h-5 shrink-0 items-center">{props.status}</div>
      </div>
    </CardHeader>
    <CardContent class="px-3 pb-2">
      <Show when={props.path}><div class="codespace-path text-xs font-mono truncate mb-1 text-muted-foreground" title={typeof props.path === 'string' ? props.path : undefined}>{props.path}</div></Show>
      <details>
        <summary tabIndex={props.skeleton ? -1 : undefined} class="codespace-details-toggle cursor-pointer text-xs text-muted-foreground">{i18n.t('codespaces.fields.details')}</summary>
        <div class="codespace-details-content text-[11px] leading-4">
          <Show when={props.description}><CardDescription class="text-xs leading-4 mb-2">{props.description}</CardDescription></Show>
          <Show when={typeof props.path === 'string' ? props.path : undefined}>{path => <div class="font-mono mb-2">{path()}</div>}</Show>
          <div class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">{props.details}</div>
        </div>
      </details>
    </CardContent>
    <CardFooter class={cn('codespace-card-actions px-3 py-2 flex flex-wrap items-center justify-start gap-2 border-t', redevenDividerRoleClass())}>{props.actions}</CardFooter>
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
  return <CodespacesPageFrame refreshing><div><CodespacesListSkeleton /></div></CodespacesPageFrame>;
}
