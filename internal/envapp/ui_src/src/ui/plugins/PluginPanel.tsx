import { For, Show, createEffect, onCleanup, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Grid3x3, Plus, Settings, X } from '@floegence/floe-webapp-core/icons';

import type { PluginInventoryItem, PluginPanelModel, PluginPanelTile, PluginSurfaceLaunchTarget } from './pluginTypes';

export type PluginPanelProps = {
  open: boolean;
  model: PluginPanelModel;
  onClose: () => void;
  onOpenCenter: () => void;
  onOpenPluginSurface: (target: PluginSurfaceLaunchTarget) => void;
  onOpenPluginDetails: (pluginID: string) => void;
};

export function PluginPanel(props: PluginPanelProps): JSX.Element {
  let panelRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose();
    };
    const onClick = (event: MouseEvent) => {
      if (panelRef && event.target instanceof Node && !panelRef.contains(event.target)) {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClick);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClick);
    });
  });

  const activateTile = (tile: PluginPanelTile) => {
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
    props.onOpenPluginDetails(tile.item.pluginID);
    props.onClose();
  };

  return (
    <Show when={props.open}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Plugins"
        class="fixed left-14 top-28 z-50 w-[min(420px,calc(100vw-4.5rem))] rounded-lg border bg-popover/98 p-3 text-popover-foreground shadow-xl backdrop-blur"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <div>
            <h2 class="text-sm font-semibold leading-tight">Plugins</h2>
            <p class="text-[11px] text-muted-foreground">Official plugins installed in this runtime.</p>
          </div>
          <button
            type="button"
            class="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close plugins"
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
        <div class="grid grid-cols-3 gap-2">
          <For each={props.model.tiles}>
            {(tile) => (
              <button
                type="button"
                data-plugin-panel-tile={tile.kind === 'open_center' ? tile.id : tile.item.pluginID}
                class="group flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border bg-background/85 p-2 text-center transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => activateTile(tile)}
              >
                {tile.kind === 'open_center' ? <CenterTileIcon /> : <PluginTileIcon item={tile.item} />}
                <span class="max-w-full truncate text-xs font-medium">{tile.kind === 'open_center' ? tile.label : tile.item.displayName}</span>
                <span class={cn('max-w-full truncate text-[10px]', tile.kind === 'open_center' ? 'text-muted-foreground' : statusClass(tile.item))}>
                  {tile.kind === 'open_center' ? 'Add/manage' : statusLabel(tile.item)}
                </span>
              </button>
            )}
          </For>
        </div>
        <Show when={!props.model.loading && props.model.tiles.length === 1}>
          <p class="mt-3 text-xs text-muted-foreground">No installed plugins yet. Open Plugin Center to discover Redeven official plugins.</p>
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

function statusLabel(item: PluginInventoryItem): string {
  switch (item.lifecycleState) {
    case 'enabled':
      return 'Ready';
    case 'disabled':
      return 'Disabled';
    case 'not_installed':
      return 'Available';
    case 'update_available':
      return 'Update';
    case 'needs_attention':
      return 'Needs attention';
    case 'installed':
      return 'Installed';
    default:
      return 'Unavailable';
  }
}

function statusClass(item: PluginInventoryItem): string {
  if (item.lifecycleState === 'enabled') return 'text-emerald-600';
  if (item.lifecycleState === 'needs_attention') return 'text-amber-600';
  return 'text-muted-foreground';
}
