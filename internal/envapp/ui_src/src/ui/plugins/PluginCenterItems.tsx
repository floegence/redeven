import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronRight, Download } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';
import type { PluginCenterTab, PluginInventoryItem } from './pluginTypes';
import { PluginIcon, PluginStatusBadge, PluginTrustBadge } from './PluginPresentationPrimitives';

export function PluginCenterItem(props: {
  item: PluginInventoryItem;
  tab: PluginCenterTab;
  selected: boolean;
  canManage: boolean;
  pending: boolean;
  onOpenDetails: (target: HTMLButtonElement) => void;
  onInstall: () => void;
  onUpdate: () => void;
}): JSX.Element {
  return props.tab === 'discover'
    ? <DiscoverPluginCard {...props} />
    : <ManagedPluginRow {...props} />;
}

function DiscoverPluginCard(props: Parameters<typeof PluginCenterItem>[0]): JSX.Element {
  const i18n = useI18n();
  return (
    <article
      class={cn(
        'flex min-h-[250px] min-w-0 flex-col rounded-lg border bg-background p-4 transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transform-none motion-reduce:transition-none',
        props.selected && 'border-primary ring-1 ring-primary/20',
      )}
      aria-current={props.selected ? 'true' : undefined}
    >
      <div class="flex min-w-0 items-start gap-3">
        <PluginIcon item={props.item} size="launcher" />
        <div class="min-w-0 flex-1 pt-0.5">
          <h2 class="truncate text-sm font-semibold">{props.item.displayName}</h2>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <PluginTrustBadge item={props.item} />
            <PluginStatusBadge item={props.item} />
          </div>
          <Show when={props.item.officialCatalog?.stableVersion ?? props.item.version}>
            {(version) => <p class="mt-2 text-xs text-muted-foreground">v{version()}</p>}
          </Show>
        </div>
      </div>
      <p class="mt-4 line-clamp-3 flex-1 text-xs leading-5 text-muted-foreground">{props.item.description}</p>
      <div class="mt-4 flex items-center gap-2 border-t pt-3">
        <button
          type="button"
          data-plugin-center-install={props.item.inventoryKey}
          class="inline-flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 motion-reduce:transition-none"
          disabled={!props.canManage || props.pending}
          onClick={props.onInstall}
        >
          <Download class="h-3.5 w-3.5" />
          {i18n.t('uiCopy.plugin.install')}
        </button>
        <button
          type="button"
          data-plugin-center-item={props.item.inventoryKey}
          aria-current={props.selected ? 'true' : undefined}
          class="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 sm:min-w-9 motion-reduce:transition-none"
          aria-label={`${props.item.displayName}: ${i18n.t('uiCopy.plugin.viewDetails')}`}
          title={i18n.t('uiCopy.plugin.viewDetails')}
          onClick={(event) => props.onOpenDetails(event.currentTarget)}
        >
          <ChevronRight class="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function ManagedPluginRow(props: Parameters<typeof PluginCenterItem>[0]): JSX.Element {
  const i18n = useI18n();
  const isUpdate = () => props.tab === 'updates';
  return (
    <article
      class={cn(
        'flex min-w-0 flex-col gap-3 border-b px-4 py-3 transition-colors duration-150 hover:bg-muted/30 motion-reduce:transition-none sm:flex-row sm:items-center',
        props.selected && 'bg-primary/[0.06] shadow-[inset_3px_0_0_var(--primary)]',
        isUpdate() && 'border-l-2 border-l-[var(--redeven-status-info-foreground)]',
      )}
      aria-current={props.selected ? 'true' : undefined}
    >
      <button
        type="button"
        data-plugin-center-item={props.item.inventoryKey}
        aria-current={props.selected ? 'true' : undefined}
        class="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => props.onOpenDetails(event.currentTarget)}
      >
        <PluginIcon item={props.item} size="row" />
        <span class="min-w-0 flex-1">
          <span class="flex min-w-0 flex-wrap items-center gap-2">
            <span class="truncate text-sm font-semibold">{props.item.displayName}</span>
            <PluginStatusBadge item={props.item} />
          </span>
          <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <PluginTrustBadge item={props.item} />
            <span>{props.item.publisher}</span>
            <Show when={props.item.version}>
              {(version) => <span>v{version()}</span>}
            </Show>
          </span>
          <span class="mt-1.5 line-clamp-1 block text-xs leading-5 text-muted-foreground">{props.item.description}</span>
        </span>
      </button>
      <div class="flex shrink-0 items-center gap-2 pl-[52px] sm:pl-0">
        <Show when={isUpdate()}>
          <button
            type="button"
            data-plugin-center-update={props.item.inventoryKey}
            class="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-md bg-[var(--redeven-status-info-foreground)] px-3 text-xs font-semibold text-background transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 motion-reduce:transition-none"
            disabled={!props.canManage || props.pending}
            onClick={props.onUpdate}
          >
            {i18n.t('uiCopy.plugin.reviewUpdate')}
          </button>
        </Show>
        <button
          type="button"
          class="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1 rounded-md border px-3 text-xs font-semibold transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 motion-reduce:transition-none"
          onClick={(event) => props.onOpenDetails(event.currentTarget)}
        >
          {i18n.t('uiCopy.plugin.viewDetails')}
          <ChevronRight class="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}
