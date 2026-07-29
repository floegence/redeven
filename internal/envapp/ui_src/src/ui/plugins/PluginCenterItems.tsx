import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { CheckCircle, Download, Grid3x3, MoreHorizontal, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import { useI18n } from '../i18n';
import type { PluginCenterTab, PluginInventoryItem } from './pluginTypes';
import { PluginIcon, PluginStatusBadge, PluginTrustBadge } from './PluginPresentationPrimitives';

export function PluginCenterItem(props: {
  item: PluginInventoryItem;
  tab: PluginCenterTab;
  selected: boolean;
  canManage: boolean;
  canOpenSurfaces: boolean;
  pending: boolean;
  onOpenDetails: (target: HTMLButtonElement) => void;
  onInstall: () => void;
  onUpdate: () => void;
  onOpenActivity: () => void;
  onOpenWorkbench: () => void;
}): JSX.Element {
  return <PluginDirectoryCard {...props} />;
}

function PluginDirectoryCard(props: Parameters<typeof PluginCenterItem>[0]): JSX.Element {
  const i18n = useI18n();
  let menuTrigger: HTMLButtonElement | undefined;
  const installed = () => props.item.lifecycleState !== 'not_installed';
  const update = () => props.tab === 'updates' || props.item.lifecycleState === 'update_available';
  const menuItems = (): DropdownItem[] => [
    ...(installed() && props.item.defaultLaunchTarget ? [
      { id: 'activity', label: i18n.t('uiCopy.plugin.openInActivity'), disabled: props.pending || !props.canOpenSurfaces },
      { id: 'workbench', label: i18n.t('uiCopy.plugin.openInWorkbench'), disabled: props.pending || !props.canOpenSurfaces },
      { id: 'surface-separator', label: '', separator: true },
    ] : []),
    { id: 'details', label: i18n.t('uiCopy.plugin.viewDetails') },
  ];
  const selectMenuItem = (id: string, target: HTMLButtonElement) => {
    if (id === 'activity') props.onOpenActivity();
    else if (id === 'workbench') props.onOpenWorkbench();
    else if (id === 'details') props.onOpenDetails(target);
  };
  return (
    <article
      class={cn(
        'group/card flex min-h-[208px] min-w-0 flex-col rounded-lg border bg-card p-4 text-card-foreground transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none',
        props.selected && 'border-primary bg-primary/[0.035] ring-1 ring-primary/20',
        update() && 'border-t-2 border-t-[var(--redeven-status-info-foreground)]',
      )}
      aria-current={props.selected ? 'true' : undefined}
    >
      <button
        type="button"
        data-plugin-center-item={props.item.inventoryKey}
        aria-current={props.selected ? 'true' : undefined}
        class="flex min-w-0 flex-1 cursor-pointer flex-col rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${props.item.displayName}: ${i18n.t('uiCopy.plugin.viewDetails')}`}
        onClick={(event) => props.onOpenDetails(event.currentTarget)}
      >
        <span class="flex min-w-0 items-start gap-3">
          <PluginIcon item={props.item} size="card" />
          <span class="min-w-0 flex-1 pt-0.5">
            <span class="line-clamp-2 text-sm font-semibold leading-5">{props.item.displayName}</span>
            <span class="mt-1 flex flex-wrap gap-1">
              <PluginTrustBadge item={props.item} />
            </span>
          </span>
        </span>
        <span class="mt-3 line-clamp-2 flex-1 text-xs leading-5 text-muted-foreground">{props.item.description}</span>
        <span class="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Show when={props.item.officialCatalog?.stableVersion ?? props.item.version}>
            {(version) => <span>v{version()}</span>}
          </Show>
          <span aria-hidden="true">·</span>
          <span>{props.item.publisher}</span>
          <PluginStatusBadge item={props.item} />
        </span>
      </button>
      <div class="mt-3 flex items-center gap-1.5">
        <Show when={!installed()} fallback={(
          <button
            type="button"
            data-plugin-center-card-primary={props.item.inventoryKey}
            data-plugin-center-update={update() ? props.item.inventoryKey : undefined}
            class="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8 motion-reduce:transition-none"
            disabled={props.pending || (!update() && !props.canOpenSurfaces)}
            onClick={update() ? props.onUpdate : props.onOpenActivity}
          >
            {update() ? <RefreshIcon class="h-4 w-4" /> : <CheckCircle class="h-4 w-4" />}
            {update() ? i18n.t('uiCopy.plugin.reviewUpdate') : i18n.t('uiCopy.plugin.openInActivity')}
          </button>
        )}>
          <button
            type="button"
            data-plugin-center-install={props.item.inventoryKey}
            class="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8 motion-reduce:transition-none"
            disabled={!props.canManage || props.pending}
            onClick={props.onInstall}
          >
            <Download class="h-4 w-4" />
            {i18n.t('uiCopy.plugin.install')}
          </button>
        </Show>
        <Show when={installed() && props.item.defaultLaunchTarget}>
          <button
            type="button"
            class="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:min-w-8 motion-reduce:transition-none"
            aria-label={i18n.t('uiCopy.plugin.openInWorkbench')}
            title={i18n.t('uiCopy.plugin.openInWorkbench')}
            disabled={props.pending || !props.canOpenSurfaces}
            onClick={props.onOpenWorkbench}
          >
            <Grid3x3 class="h-4 w-4" />
          </button>
        </Show>
        <Dropdown
          align="end"
          items={menuItems()}
          onSelect={(id) => {
            if (menuTrigger) selectMenuItem(id, menuTrigger);
          }}
          triggerAriaLabel={`${props.item.displayName}: ${i18n.t('uiCopy.plugin.moreActions')}`}
          triggerClass="rounded-md"
          trigger={(
            <button
              ref={menuTrigger}
              type="button"
              data-plugin-center-card-menu={props.item.inventoryKey}
              class="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:min-w-8 motion-reduce:transition-none"
              title={i18n.t('uiCopy.plugin.moreActions')}
            >
              <MoreHorizontal class="h-4 w-4" />
            </button>
          )}
        />
      </div>
    </article>
  );
}
