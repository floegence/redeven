import { For, Show, createEffect, onCleanup, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Grid3x3, Plus, Settings, X } from '@floegence/floe-webapp-core/icons';

import type { PluginInventoryItem, PluginPanelModel, PluginPanelTile, PluginSurfaceLaunchTarget } from './pluginTypes';
import { useI18n, type I18nHelpers } from '../i18n';

const PANEL_FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type PluginPanelProps = {
  open: boolean;
  model: PluginPanelModel;
  onClose: () => void;
  onOpenCenter: () => void;
  onOpenPluginSurface: (target: PluginSurfaceLaunchTarget) => void;
  onOpenPluginDetails: (inventoryKey: string) => void;
};

export function PluginPanel(props: PluginPanelProps): JSX.Element {
  const i18n = useI18n();
  let panelRef: HTMLDivElement | undefined;
  let restoreFocusAfterClose = true;

  createEffect(() => {
    if (!props.open) return;
    restoreFocusAfterClose = true;
    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef) return;
      const focusable = [...panelRef.querySelectorAll<HTMLElement>(PANEL_FOCUSABLE_SELECTOR)];
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (panelRef && event.target instanceof Node && !panelRef.contains(event.target)) {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    queueMicrotask(() => panelRef?.querySelector<HTMLElement>(PANEL_FOCUSABLE_SELECTOR)?.focus());
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
      if (restoreFocusAfterClose && restoreFocus?.isConnected) restoreFocus.focus();
    });
  });

  const activateTile = (tile: PluginPanelTile) => {
    restoreFocusAfterClose = false;
    if (tile.kind === 'open_center') {
      props.onOpenCenter();
      props.onClose();
      return;
    }
    if (tile.action === 'open_surface' && tile.item.defaultLaunchTarget) {
      props.onOpenPluginSurface(tile.item.defaultLaunchTarget);
      props.onClose();
      return;
    }
    props.onOpenPluginDetails(tile.item.inventoryKey);
    props.onClose();
  };

  return (
    <Show when={props.open}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={i18n.t('uiCopy.plugin.panelTitle')}
        tabIndex={-1}
        class="fixed left-14 top-28 z-50 w-[min(420px,calc(100vw-4.5rem))] rounded-lg border bg-popover/98 p-3 text-popover-foreground shadow-xl backdrop-blur"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold leading-tight">{i18n.t('uiCopy.plugin.panelTitle')}</h2>
            <p class="text-[11px] text-muted-foreground">{i18n.t('uiCopy.plugin.panelDescription')}</p>
          </div>
          <button
            type="button"
            class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={i18n.t('uiCopy.plugin.closePanel')}
            onClick={props.onClose}
          >
            <X class="h-3.5 w-3.5" />
          </button>
        </div>
        <Show when={props.model.errorMessage}>
          <div class="mb-2 rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {props.model.errorMessage}
          </div>
        </Show>
        <Show when={props.model.loading}>
          <div class="mb-2 rounded-md border bg-muted/35 px-2 py-1.5 text-xs text-muted-foreground">
            {i18n.t('uiCopy.plugin.loadingOfficial')}
          </div>
        </Show>
        <div class="grid grid-cols-3 gap-2">
          <For each={props.model.tiles}>
            {(tile) => (
              <button
                type="button"
                data-plugin-panel-tile={tile.kind === 'open_center' ? tile.id : tile.item.inventoryKey}
                class="group flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border bg-background/85 p-2 text-center transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => activateTile(tile)}
              >
                {tile.kind === 'open_center' ? <CenterTileIcon /> : <PluginTileIcon item={tile.item} />}
                <span class="max-w-full truncate text-xs font-medium">{tile.kind === 'open_center' ? tile.label : tile.item.displayName}</span>
                <span class={cn('max-w-full truncate text-[10px]', tile.kind === 'open_center' ? 'text-muted-foreground' : statusClass(tile.item))}>
                  {tile.kind === 'open_center' ? i18n.t('uiCopy.plugin.addManage') : statusLabel(tile.item, i18n)}
                </span>
              </button>
            )}
          </For>
        </div>
        <Show when={!props.model.loading && props.model.tiles.length === 1}>
          <p class="mt-3 text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.noInstalled')}</p>
        </Show>
      </div>
    </Show>
  );
}

function CenterTileIcon() {
  return (
    <span class="flex h-9 w-9 items-center justify-center rounded-md border border-dashed border-primary/45 bg-primary/10 text-primary">
      <Plus class="h-4 w-4" />
    </span>
  );
}

function PluginTileIcon(props: { item: PluginInventoryItem }) {
  return (
    <span class="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
      {props.item.iconFallback === 'containers' ? <Grid3x3 class="h-4 w-4" /> : <Settings class="h-4 w-4" />}
    </span>
  );
}

function statusLabel(item: PluginInventoryItem, i18n: I18nHelpers): string {
  switch (item.lifecycleState) {
    case 'enabled':
      return i18n.t('common.status.ready');
    case 'disabled':
      return i18n.t('uiCopy.plugin.disabled');
    case 'not_installed':
      return i18n.t('uiCopy.plugin.available');
    case 'update_available':
      return i18n.t('uiCopy.plugin.update');
    case 'needs_attention':
      return i18n.t('uiCopy.plugin.needsAttention');
    case 'installed':
      return i18n.t('uiCopy.plugin.installed');
    default:
      return i18n.t('uiCopy.plugin.unavailable');
  }
}

function statusClass(item: PluginInventoryItem): string {
  if (item.lifecycleState === 'enabled') return 'text-[var(--redeven-status-success-foreground)]';
  if (item.lifecycleState === 'needs_attention') return 'text-[var(--redeven-status-warning-foreground)]';
  return 'text-muted-foreground';
}
