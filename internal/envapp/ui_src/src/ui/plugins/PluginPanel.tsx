import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { ArrowRight, ChevronRight, Grid3x3, Package, Settings, X } from '@floegence/floe-webapp-core/icons';
import { SurfaceFloatingLayer } from '@floegence/floe-webapp-core/ui';

import type { PluginInventoryItem, PluginPanelModel, PluginPanelTile, PluginSurfaceLaunchTarget } from './pluginTypes';
import { useI18n, type I18nHelpers } from '../i18n';
import { isolateDocumentBranch } from './modalIsolation';

const DESKTOP_PANEL_WIDTH_PX = 368;
const DESKTOP_PANEL_ESTIMATED_HEIGHT_PX = 560;
const DESKTOP_PANEL_GAP_PX = 8;
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type PluginPanelProps = {
  id?: string;
  open: boolean;
  mobile?: boolean;
  trigger?: HTMLButtonElement | null;
  model: PluginPanelModel;
  onClose: () => void;
  onOpenCenter: () => void;
  onOpenPluginSurface: (target: PluginSurfaceLaunchTarget) => void;
  onOpenPluginDetails: (inventoryKey: string) => void;
};

export function PluginPanel(props: PluginPanelProps): JSX.Element {
  const i18n = useI18n();
  const [anchorPosition, setAnchorPosition] = createSignal({ x: DESKTOP_PANEL_GAP_PX, y: DESKTOP_PANEL_GAP_PX });
  const pluginTiles = createMemo(() => props.model.tiles.filter(isPluginTile));
  const centerTile = createMemo(() => props.model.tiles.find((tile) => tile.kind === 'open_center'));
  let panelRef: HTMLDivElement | undefined;
  let mobileCloseRef: HTMLButtonElement | undefined;
  let firstActionRef: HTMLButtonElement | undefined;
  let restoreFocusAfterClose = false;
  let focusRestoreTarget: HTMLElement | null = null;

  const updateAnchorPosition = () => {
    const rect = props.trigger?.getBoundingClientRect();
    if (!rect) return;
    setAnchorPosition({
      x: rect.right + DESKTOP_PANEL_GAP_PX,
      y: rect.top,
    });
  };

  const dismiss = () => {
    restoreFocusAfterClose = true;
    props.onClose();
  };

  createEffect(() => {
    if (!props.open) return;
    restoreFocusAfterClose = false;
    focusRestoreTarget = props.trigger
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);

    updateAnchorPosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismiss();
        return;
      }
      if (!props.mobile || event.key !== 'Tab' || !panelRef) return;
      const focusable = [...panelRef.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panelRef.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onDocumentClick = (event: MouseEvent) => {
      if (props.mobile || !(event.target instanceof Node)) return;
      if (panelRef?.contains(event.target) || props.trigger?.contains(event.target)) return;
      dismiss();
    };
    const onViewportChange = () => updateAnchorPosition();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    const restoreIsolation = props.mobile && panelRef ? isolateDocumentBranch(panelRef) : null;

    let focusCancelled = false;
    queueMicrotask(() => {
      if (focusCancelled) return;
      (props.mobile ? mobileCloseRef : firstActionRef)?.focus({ preventScroll: true });
    });

    onCleanup(() => {
      focusCancelled = true;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      restoreIsolation?.();
      if (restoreFocusAfterClose && focusRestoreTarget?.isConnected) {
        focusRestoreTarget.focus({ preventScroll: true });
      }
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

  const panelContent = (mobile: boolean) => (
    <div
      id={props.id}
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
      aria-modal={mobile ? 'true' : 'false'}
      aria-label={i18n.t('uiCopy.plugin.panelTitle')}
      class={cn(
        'flex min-h-0 flex-col overflow-hidden border bg-popover text-popover-foreground shadow-2xl',
        mobile
          ? 'max-h-[82dvh] w-full rounded-t-lg border-x-0 border-b-0'
          : 'max-h-[min(560px,calc(100dvh-1rem))] w-[368px] rounded-lg',
      )}
    >
      <header class={cn('flex shrink-0 items-start justify-between gap-3 border-b', mobile ? 'px-4 py-3' : 'px-4 py-3.5')}>
        <div class="min-w-0">
          <h2 class="text-sm font-semibold leading-5">{i18n.t('uiCopy.plugin.panelTitle')}</h2>
          <p class="mt-0.5 truncate text-xs leading-4 text-muted-foreground">{i18n.t('uiCopy.plugin.panelDescription')}</p>
        </div>
        <button
          ref={(element) => {
            if (mobile) mobileCloseRef = element;
          }}
          type="button"
          class={cn(
            'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            mobile ? 'h-[44px] w-[44px] -mr-2 -mt-1' : 'h-8 w-8 -mr-1 -mt-0.5',
          )}
          aria-label={i18n.t('uiCopy.plugin.closePanel')}
          onClick={dismiss}
        >
          <X class="h-4 w-4" />
        </button>
      </header>

      <div class={cn('min-h-0 flex-1 overflow-y-auto', mobile ? 'px-3 py-2' : 'px-2 py-2')}>
        <Show when={props.model.errorMessage}>
          <div class="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-4 text-destructive">
            {props.model.errorMessage}
          </div>
        </Show>
        <Show when={props.model.loading}>
          <div class="mb-2 rounded-md bg-muted px-3 py-2 text-xs leading-4 text-muted-foreground">
            {i18n.t('uiCopy.plugin.loadingOfficial')}
          </div>
        </Show>

        <div class="flex flex-col">
          <For each={pluginTiles()}>
            {(tile, index) => (
              <button
                ref={(element) => {
                  if (index() === 0) firstActionRef = element;
                }}
                type="button"
                data-plugin-panel-tile={tile.item.inventoryKey}
                class={cn(
                  'group flex w-full cursor-pointer items-center gap-3 rounded-md text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  mobile ? 'min-h-14 px-2 py-2.5' : 'min-h-16 px-2.5 py-2',
                )}
                onClick={() => activateTile(tile)}
              >
                <PluginTileIcon item={tile.item} />
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="min-w-0 truncate text-sm font-medium leading-5">{tile.item.displayName}</span>
                    <span class={cn('shrink-0 text-[11px] leading-4', statusClass(tile.item))}>
                      {statusLabel(tile.item, i18n)}
                    </span>
                  </span>
                  <span class="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">{tile.item.description}</span>
                </span>
                <span class="flex shrink-0 items-center gap-1 pl-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                  <span>{nextActionLabel(tile, i18n)}</span>
                  <ChevronRight class="h-3.5 w-3.5" />
                </span>
              </button>
            )}
          </For>
        </div>

        <Show when={!props.model.loading && pluginTiles().length === 0}>
          <p class="px-2 py-4 text-xs leading-5 text-muted-foreground">{i18n.t('uiCopy.plugin.noInstalled')}</p>
        </Show>
      </div>

      <Show when={centerTile()}>
        {(tile) => (
          <footer class={cn('shrink-0 border-t', mobile ? 'p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]' : 'p-2')}>
            <button
              ref={(element) => {
                if (pluginTiles().length === 0) firstActionRef = element;
              }}
              type="button"
              data-plugin-panel-tile="plugin-center"
              class="flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => activateTile(tile())}
            >
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background text-foreground">
                <Package class="h-4 w-4" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium leading-5">{tile().label}</span>
                <span class="block truncate text-xs leading-4 text-muted-foreground">{i18n.t('uiCopy.plugin.addManage')}</span>
              </span>
              <ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </footer>
        )}
      </Show>
    </div>
  );

  return (
    <Show when={props.open}>
      <Show
        when={props.mobile}
        fallback={(
          <SurfaceFloatingLayer
            position={anchorPosition()}
            estimatedSize={{ width: DESKTOP_PANEL_WIDTH_PX, height: DESKTOP_PANEL_ESTIMATED_HEIGHT_PX }}
            class="pointer-events-auto"
          >
            {panelContent(false)}
          </SurfaceFloatingLayer>
        )}
      >
        <Portal>
          <div
            class="fixed inset-0 z-50 flex items-end bg-[var(--redeven-overlay-scrim)]"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) dismiss();
            }}
          >
            {panelContent(true)}
          </div>
        </Portal>
      </Show>
    </Show>
  );
}

function isPluginTile(tile: PluginPanelTile): tile is Extract<PluginPanelTile, { kind: 'plugin' }> {
  return tile.kind === 'plugin';
}

function PluginTileIcon(props: { item: PluginInventoryItem }) {
  const [imageFailed, setImageFailed] = createSignal(false);
  return (
    <span class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background text-foreground shadow-sm">
      <Show when={props.item.iconURL && !imageFailed()} fallback={(
        props.item.iconFallback === 'containers'
          ? <Grid3x3 class="h-4 w-4" />
          : <Settings class="h-4 w-4" />
      )}>
        <img
          src={props.item.iconURL ?? ''}
          alt=""
          class="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      </Show>
    </span>
  );
}

function nextActionLabel(tile: Extract<PluginPanelTile, { kind: 'plugin' }>, i18n: I18nHelpers): string {
  if (tile.action === 'open_surface') {
    return tile.item.defaultLaunchTarget?.preferredPlacement === 'workbench'
      ? i18n.t('uiCopy.plugin.openInWorkbench')
      : i18n.t('uiCopy.plugin.openInActivity');
  }
  switch (tile.item.lifecycleState) {
    case 'not_installed':
      return i18n.t('uiCopy.plugin.install');
    case 'installed':
    case 'disabled':
      return i18n.t('uiCopy.plugin.enable');
    case 'update_available':
      return i18n.t('uiCopy.plugin.update');
    case 'needs_attention':
      return i18n.t('uiCopy.plugin.needsAttention');
    default:
      return i18n.t('uiCopy.plugin.unavailable');
  }
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
