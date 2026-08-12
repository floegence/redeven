import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { Package, Search, X } from '@floegence/floe-webapp-core/icons';
import type { WorkbenchExternalDockDragController } from '@floegence/floe-webapp-core/workbench';
import { ENV_APP_FLOATING_LAYER } from '../utils/envAppLayers';

import type {
  PluginInventoryItem,
  PluginPanelModel,
  PluginPanelTile,
  PluginPresentationCategory,
  PluginSurfaceLaunchTarget,
} from './pluginTypes';
import { useI18n, type I18nHelpers } from '../i18n';
import { isolateDocumentBranch } from './modalIsolation';
import { PluginIcon, PluginUpdateBadge } from './PluginPresentationPrimitives';
import { resolveAuthorPresentation, resolvePluginPresentation } from './officialPluginCatalog';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_PRESS_MOTION_CLASS, pluginLifecycleLabel } from './pluginPresentation';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CATEGORY_FILTER_THRESHOLD = 6;
const CATEGORY_IDS: readonly PluginPresentationCategory[] = [
  'development',
  'infrastructure',
  'data',
  'collaboration',
  'productivity',
  'other',
];

export type PluginPanelProps = {
  id?: string;
  open: boolean;
  mobile?: boolean;
  trigger?: HTMLButtonElement | null;
  placement?: 'activity' | 'workbench';
  model: PluginPanelModel;
  onClose: () => void;
  onOpenCenter: () => void;
  onOpenPluginSurface: (target: PluginSurfaceLaunchTarget) => void;
  onOpenPluginDetails: (inventoryKey: string) => void;
  onDropPlugin?: (target: PluginSurfaceLaunchTarget) => void;
  externalDockDragController?: WorkbenchExternalDockDragController | null;
  onPinPlugin?: (inventoryKey: string) => void;
};

type PluginTileDragState = Readonly<{
  tile: Extract<PluginPanelTile, { kind: 'plugin' }>;
  clientX: number;
  clientY: number;
}>;

export function PluginPanel(props: PluginPanelProps): JSX.Element {
  const i18n = useI18n();
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<PluginPresentationCategory | 'all'>('all');
  const [dragState, setDragState] = createSignal<PluginTileDragState | null>(null);
  const [mounted, setMounted] = createSignal(props.open);
  const [closing, setClosing] = createSignal(false);
  let suppressTileClick = false;
  let panelRef: HTMLDivElement | undefined;
  let searchRef: HTMLInputElement | undefined;
  let gridRef: HTMLUListElement | undefined;
  let restoreFocusAfterClose = false;
  let focusRestoreTarget: HTMLElement | null = null;
  let cancelActiveTileDrag: (() => void) | undefined;

  onCleanup(() => {
    cancelActiveTileDrag?.();
    cancelActiveTileDrag = undefined;
  });

  createEffect(() => {
    if (props.open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted()) return;
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      setMounted(false);
    }, 150);
  });

  const pluginTiles = createMemo(() => props.model.tiles.filter(isPluginTile));
  const centerTile = createMemo(() => props.model.tiles.find((tile) => tile.kind === 'open_center'));
  const normalizedQuery = createMemo(() => normalizeSearchText(query(), i18n.locale()));
  const visibleTiles = createMemo(() => pluginTiles().filter((tile) => {
    if (category() !== 'all' && tile.item.category !== category()) return false;
    const search = normalizedQuery();
    return search === '' || pluginSearchText(tile.item, i18n, i18n.locale()).includes(search);
  }));
  const attentionCount = createMemo(() => pluginTiles().filter((tile) => (
    tile.item.lifecycleState === 'needs_attention' || tile.item.lifecycleState === 'update_available'
  )).length);
  const isWorkbenchPopup = () => props.placement === 'workbench';
  const [popupPosition, setPopupPosition] = createSignal<{
    left: number;
    bottom: number;
    arrowLeft: number;
  }>({ left: 0, bottom: 88, arrowLeft: 24 });

  const updatePopupPosition = () => {
    if (!isWorkbenchPopup()) return;
    const trigger = props.trigger?.isConnected
      ? props.trigger
      : document.querySelector<HTMLButtonElement>('[data-workbench-dock-action="plugins"]');
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(320, Math.max(280, window.innerWidth - 24));
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2));
    const triggerCenter = rect.left + rect.width / 2;
    setPopupPosition({
      left,
      bottom: Math.max(76, window.innerHeight - rect.top + 16),
      arrowLeft: Math.max(18, Math.min(width - 18, triggerCenter - left)),
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (query()) {
          event.preventDefault();
          setQuery('');
          searchRef?.focus({ preventScroll: true });
        } else {
          dismiss();
        }
        return;
      }
      if (event.key !== 'Tab' || !panelRef) return;
      const focusable = [...panelRef.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panelRef.focus();
      } else {
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? (index <= 0 ? focusable.length - 1 : index - 1)
          : (index < 0 || index >= focusable.length - 1 ? 0 : index + 1);
        event.preventDefault();
        focusable[nextIndex]?.focus({ preventScroll: true });
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!isWorkbenchPopup() || !panelRef) return;
      const trigger = props.trigger?.isConnected
        ? props.trigger
        : document.querySelector<HTMLButtonElement>('[data-workbench-dock-action="plugins"]');
      if (panelRef.contains(event.target as Node) || trigger?.contains(event.target as Node)) return;
      dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    if (isWorkbenchPopup()) {
      updatePopupPosition();
      window.addEventListener('resize', updatePopupPosition);
      window.addEventListener('scroll', updatePopupPosition, true);
      document.addEventListener('pointerdown', onPointerDown, true);
    }
    const restoreIsolation = panelRef && !isWorkbenchPopup() ? isolateDocumentBranch(panelRef) : null;
    let focusCancelled = false;
    queueMicrotask(() => {
      if (!focusCancelled) searchRef?.focus({ preventScroll: true });
    });
    onCleanup(() => {
      focusCancelled = true;
      document.removeEventListener('keydown', onKeyDown);
      if (isWorkbenchPopup()) {
        window.removeEventListener('resize', updatePopupPosition);
        window.removeEventListener('scroll', updatePopupPosition, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
      }
      restoreIsolation?.();
      if (restoreFocusAfterClose && focusRestoreTarget?.isConnected) {
        focusRestoreTarget.focus({ preventScroll: true });
      }
    });
  });

  const isCanvasDropPoint = (clientX: number, clientY: number): boolean => {
    const frame = document.querySelector<HTMLElement>('[data-floe-workbench-canvas-frame="true"]');
    const rect = frame?.getBoundingClientRect();
    return Boolean(rect
      && clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom);
  };

  const beginTileDrag = (
    event: PointerEvent,
    tile: Extract<PluginPanelTile, { kind: 'plugin' }>,
  ) => {
    if (!isWorkbenchPopup() || event.button !== 0) return;
    if (props.externalDockDragController) {
      props.externalDockDragController.begin(event, {
        id: tile.item.inventoryKey,
        label: tile.item.displayName,
        icon: (iconProps) => <PluginIcon item={tile.item} size="dock" class={iconProps.class} />,
      });
      return;
    }
    cancelActiveTileDrag?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerID = event.pointerId;
    const captureTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    let moved = false;
    try {
      captureTarget?.setPointerCapture(pointerID);
    } catch {
      // The window listeners below remain the fallback for older browsers.
    }
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID) return;
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (distance > 6) moved = true;
      if (moved) {
        moveEvent.preventDefault();
        setDragState({ tile, clientX: moveEvent.clientX, clientY: moveEvent.clientY });
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      try {
        if (captureTarget?.hasPointerCapture(pointerID)) {
          captureTarget.releasePointerCapture(pointerID);
        }
      } catch {
        // The pointer may already have been released by the browser.
      }
      if (cancelActiveTileDrag === cleanup) cancelActiveTileDrag = undefined;
      setDragState(null);
    };
    const finish = (upEvent: PointerEvent, cancelled: boolean) => {
      if (upEvent.pointerId !== pointerID) return;
      const dropped = !cancelled
        && moved
        && isCanvasDropPoint(upEvent.clientX, upEvent.clientY)
        && tile.item.defaultLaunchTarget
        && props.onDropPlugin;
      cleanup();
      if (moved) suppressTileClick = true;
      if (!dropped) return;
      props.onDropPlugin?.({
        ...tile.item.defaultLaunchTarget!,
        preferredPlacement: 'workbench',
        workbenchDropPoint: { clientX: upEvent.clientX, clientY: upEvent.clientY },
      });
      dismiss();
    };
    const onUp = (upEvent: PointerEvent) => finish(upEvent, false);
    const onCancel = (cancelEvent: PointerEvent) => finish(cancelEvent, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    cancelActiveTileDrag = cleanup;
  };

  const activateTile = (tile: PluginPanelTile) => {
    restoreFocusAfterClose = false;
    if (tile.kind === 'open_center') {
      props.onOpenCenter();
      props.onClose();
      return;
    }
    if (tile.action === 'open_surface' && tile.item.defaultLaunchTarget) {
      props.onOpenPluginSurface(tile.item.defaultLaunchTarget);
    } else {
      props.onOpenPluginDetails(tile.item.inventoryKey);
    }
    props.onClose();
  };

  const moveGridFocus = (event: KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(gridRef?.querySelectorAll<HTMLButtonElement>('[data-plugin-panel-tile]') ?? [])];
    if (buttons.length === 0) return;
    const computedColumns = gridRef ? getComputedStyle(gridRef).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    const columns = computedColumns > 0 ? computedColumns : 4;
    let next = index;
    if (event.key === 'ArrowLeft') next -= 1;
    if (event.key === 'ArrowRight') next += 1;
    if (event.key === 'ArrowUp') next -= columns;
    if (event.key === 'ArrowDown') next += columns;
    if (event.key === 'Home') next = Math.floor(index / columns) * columns;
    if (event.key === 'End') next = Math.min(buttons.length - 1, Math.floor(index / columns) * columns + columns - 1);
    next = Math.max(0, Math.min(buttons.length - 1, next));
    if (next === index) return;
    event.preventDefault();
    buttons[next]?.focus({ preventScroll: true });
  };

  return (
    <Show when={mounted()}>
      <Portal>
        <div
          data-plugin-launcher-backdrop
          class={cn(
            'redeven-plugin-motion fixed inset-0 flex animate-in fade-in duration-150 motion-reduce:animate-none',
            isWorkbenchPopup() ? 'pointer-events-none items-end' : 'bg-[var(--redeven-overlay-scrim)]',
            props.mobile ? 'items-end' : 'items-center justify-center p-4',
          )}
            style={{ 'z-index': ENV_APP_FLOATING_LAYER.pluginPanel }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) dismiss();
          }}
        >
          <div
            id={props.id}
            ref={panelRef}
            role="dialog"
            data-plugin-panel-motion-axis="y"
            data-plugin-panel-motion-state={closing() ? 'closing' : 'open'}
            tabIndex={-1}
            aria-modal={isWorkbenchPopup() ? undefined : 'true'}
            aria-label={isWorkbenchPopup() ? i18n.t('uiCopy.plugin.launcherTitle') : undefined}
            aria-labelledby={isWorkbenchPopup() ? undefined : 'plugin-launcher-title'}
            aria-describedby="plugin-launcher-description"
            class={cn(
              'redeven-plugin-motion pointer-events-auto flex min-h-0 origin-bottom flex-col overflow-hidden border bg-popover text-popover-foreground shadow-2xl ease-out motion-reduce:animate-none',
              isWorkbenchPopup()
                ? `fixed max-h-[min(380px,calc(100vh-120px))] w-[min(320px,calc(100vw-24px))] rounded-lg ${closing() ? 'plugin-panel-popover-close' : 'plugin-panel-popover-open'} duration-150`
                : 'w-full',
              !isWorkbenchPopup() && props.mobile
                ? 'h-[min(680px,92dvh)] rounded-t-lg border-x-0 border-b-0 animate-in fade-in duration-200'
                : !isWorkbenchPopup() ? 'h-[min(680px,78dvh)] max-w-[820px] rounded-lg animate-in fade-in duration-200' : '',
            )}
            style={isWorkbenchPopup() ? {
              left: `${popupPosition().left}px`,
              bottom: `${popupPosition().bottom}px`,
              'transform-origin': `${popupPosition().arrowLeft}px calc(100% + 8px)`,
            } : undefined}
          >
            <header class={cn('shrink-0 border-b', isWorkbenchPopup() ? 'px-2.5 py-2' : 'px-4 py-3 sm:px-5')}>
              <div class={cn('flex items-center', isWorkbenchPopup() ? 'gap-2' : 'gap-3')}>
                <button type="button" data-plugin-center-market-action aria-label="Plugin Center" title="Plugin Center" class="order-last inline-flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:h-8 sm:w-8" onClick={() => { props.onOpenCenter(); props.onClose(); }}>
                  <Package class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class={cn('order-last inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none', isWorkbenchPopup() ? 'h-8 w-8' : 'h-[44px] w-[44px] sm:h-8 sm:w-8')}
                  aria-label={i18n.t('uiCopy.plugin.closePanel')}
                  title={i18n.t('uiCopy.plugin.closePanel')}
                  onClick={dismiss}
                >
                  <X class="h-3.5 w-3.5" />
                </button>
                <Show when={!isWorkbenchPopup()}>
                  <h2 id="plugin-launcher-title" class="shrink-0 text-base font-semibold">
                    {i18n.t('uiCopy.plugin.launcherTitle')}
                  </h2>
                </Show>
                <label class="relative min-w-0 flex-1">
                  <span class="sr-only">{i18n.t('uiCopy.plugin.launcherSearchLabel')}</span>
                  <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={searchRef}
                    type="search"
                    data-plugin-launcher-search
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    placeholder={i18n.t('uiCopy.plugin.launcherSearchPlaceholder')}
                    class={cn('w-full rounded-md border bg-muted/40 outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground/60 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20 motion-reduce:transition-none', isWorkbenchPopup() ? 'h-8 pl-8 pr-2 text-xs' : 'h-10 pl-9 pr-3 text-sm')}
                  />
                </label>
              </div>
              <p id="plugin-launcher-description" class="sr-only">
                {i18n.t('uiCopy.plugin.launcherDescription')}
              </p>
              <Show when={pluginTiles().length >= CATEGORY_FILTER_THRESHOLD}>
                <div class="mt-3 flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={i18n.t('uiCopy.plugin.categories')}>
                  <CategoryButton id="all" active={category()} onSelect={setCategory} label={i18n.t('uiCopy.plugin.categoryAll')} />
                  <For each={CATEGORY_IDS}>
                    {(id) => <CategoryButton id={id} active={category()} onSelect={setCategory} label={categoryLabel(id, i18n)} />}
                  </For>
                </div>
              </Show>
            </header>

            <div class={cn('min-h-0 flex-1 overflow-y-auto', isWorkbenchPopup() ? 'px-3 py-3' : 'px-4 py-5 sm:px-5')}>
              <Show when={props.model.errorMessage}>
                <div role="alert" class="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-4 text-destructive">
                  {props.model.errorMessage}
                </div>
              </Show>
              <Show when={props.model.loading}>
                <div role="status" class="mb-2 rounded-md bg-muted px-3 py-2 text-xs leading-4 text-muted-foreground">
                  {i18n.t('uiCopy.plugin.loadingOfficial')}
                </div>
              </Show>

              <ul
                ref={gridRef}
                data-plugin-launcher-grid
                class={cn('grid', isWorkbenchPopup() ? 'grid-cols-4 gap-1.5' : 'grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5')}
              >
                <For each={visibleTiles()}>
                  {(tile, index) => (
                    <li
                      class={cn('group relative min-w-0', PLUGIN_ENTER_MOTION_CLASS)}
                      style={`animation-delay: ${Math.min(index() * 18, 126)}ms`}
                    >
                      <button
                        type="button"
                        data-plugin-panel-tile={tile.item.inventoryKey}
                        aria-describedby={`plugin-launcher-tile-status-${index()}`}
                        class={cn('flex w-full min-w-0 cursor-pointer touch-none select-none flex-col items-center rounded-md border border-transparent text-center hover:border-border hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', isWorkbenchPopup() ? 'gap-1 px-1 py-2' : 'gap-2.5 px-2 py-3', PLUGIN_PRESS_MOTION_CLASS)}
                        onKeyDown={(event) => {
                          moveGridFocus(event, index());
                        }}
                        onPointerDown={(event) => beginTileDrag(event, tile)}
                        onClick={() => {
                          if (suppressTileClick) {
                            suppressTileClick = false;
                            return;
                          }
                          activateTile(tile);
                        }}
                      >
                        <div class="relative">
                          <PluginIcon item={tile.item} size={isWorkbenchPopup() ? 'dock' : 'launcher'} class="transition-transform duration-200 ease-out group-hover:scale-[1.04] motion-reduce:transform-none motion-reduce:transition-none" />
                          <PluginUpdateBadge item={tile.item} />
                        </div>
                        <span class={cn('block min-w-0 max-w-full truncate font-medium', isWorkbenchPopup() ? 'text-[10px] leading-3.5' : 'text-xs leading-4')}>
                          {resolvedPluginPresentation(tile.item, i18n.locale())?.plugin_name ?? tile.item.displayName}
                        </span>
                      </button>
                      <span id={`plugin-launcher-tile-status-${index()}`} class="sr-only">
                        {statusLabel(tile.item, i18n)}
                      </span>
                    </li>
                  )}
                </For>
              </ul>

              <Show when={!props.model.loading && pluginTiles().length === 0}>
                <div class={cn('flex min-h-40 flex-col items-center justify-center text-center', PLUGIN_ENTER_MOTION_CLASS)}>
                  <Package class="h-7 w-7 text-muted-foreground" />
                  <p class="mt-3 max-w-sm text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.noInstalled')}</p>
                </div>
              </Show>
              <Show when={!props.model.loading && pluginTiles().length > 0 && visibleTiles().length === 0}>
                <div class={cn('flex min-h-40 flex-col items-center justify-center text-center', PLUGIN_ENTER_MOTION_CLASS)}>
                  <Search class="h-7 w-7 text-muted-foreground" />
                  <p class="mt-3 text-sm font-medium">{i18n.t('uiCopy.plugin.launcherNoResults')}</p>
                  <button
                    type="button"
                    class={cn('mt-3 min-h-[44px] cursor-pointer rounded-md border px-3 text-xs font-semibold hover:bg-muted', PLUGIN_PRESS_MOTION_CLASS)}
                    onClick={() => { setQuery(''); setCategory('all'); searchRef?.focus(); }}
                  >
                    {i18n.t('uiCopy.plugin.clearFilters')}
                  </button>
                </div>
              </Show>
            </div>

            <Show when={centerTile()}>
              <footer class={cn('flex shrink-0 items-center justify-between border-t bg-muted/25', isWorkbenchPopup() ? 'gap-2 px-3 py-2' : 'gap-3 px-4 py-3 sm:px-5')}>
                  <div class={cn('min-w-0 text-muted-foreground', isWorkbenchPopup() ? 'text-[10px] leading-4' : 'text-xs leading-5')}>
                    {i18n.t('uiCopy.plugin.launcherSummary', { count: pluginTiles().length, attention: attentionCount() })}
                  </div>
              </footer>
            </Show>
          </div>
        </div>
        <Show when={isWorkbenchPopup()}>
          <span
            data-plugin-workbench-popover-arrow
            class="pointer-events-none fixed h-3 w-3 rotate-45 border-b border-r bg-popover"
            style={{
              'z-index': ENV_APP_FLOATING_LAYER.pluginPanel,
              left: `${popupPosition().left + popupPosition().arrowLeft - 6}px`,
              bottom: `${popupPosition().bottom - 6}px`,
            }}
            aria-hidden="true"
          />
        </Show>
        <Show when={dragState()}>
          {(state) => (
            <div
              data-plugin-workbench-drag-ghost
              class="pointer-events-none fixed left-0 top-0 flex items-center gap-2 rounded-lg border bg-popover/95 px-3 py-2 text-popover-foreground shadow-xl backdrop-blur-md"
              style={{
                'z-index': ENV_APP_FLOATING_LAYER.pluginPanel + 1,
                transform: `translate3d(${state().clientX + 14}px, ${state().clientY - 34}px, 0)`,
              }}
              aria-hidden="true"
            >
              <PluginIcon item={state().tile.item} size="dock" />
              <span class="max-w-40 truncate text-xs font-semibold">
                {resolvedPluginPresentation(state().tile.item, i18n.locale())?.plugin_name ?? state().tile.item.displayName}
              </span>
            </div>
          )}
        </Show>
      </Portal>
    </Show>
  );
}

function CategoryButton(props: {
  id: PluginPresentationCategory | 'all';
  active: PluginPresentationCategory | 'all';
  label: string;
  onSelect: (id: PluginPresentationCategory | 'all') => void;
}) {
  return (
    <button
      type="button"
      data-plugin-launcher-category={props.id}
      aria-pressed={props.id === props.active}
      class={cn('min-h-[44px] min-w-[44px] h-8 shrink-0 cursor-pointer rounded-full px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:min-w-0 motion-reduce:transition-none', props.id === props.active ? 'bg-foreground text-background' : 'bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground')}
      onClick={() => props.onSelect(props.id)}
    >
      {props.label}
    </button>
  );
}

function isPluginTile(tile: PluginPanelTile): tile is Extract<PluginPanelTile, { kind: 'plugin' }> {
  return tile.kind === 'plugin';
}

function normalizeSearchText(value: string, locale: string): string {
  return value.normalize('NFKC').toLocaleLowerCase(locale).trim();
}

function pluginSearchText(item: PluginInventoryItem, i18n: I18nHelpers, locale: string): string {
  const presentation = resolvedPluginPresentation(item, locale);
  return normalizeSearchText([
    presentation?.plugin_name ?? item.displayName,
    presentation?.summary ?? item.description,
    presentation?.publisher_name ?? item.publisher,
    item.pluginID,
    categoryLabel(item.category, i18n),
    ...(presentation?.keywords ?? item.searchKeywords),
  ].join(' '), locale);
}

function resolvedPluginPresentation(item: PluginInventoryItem, locale: string) {
  return item.presentation
    ? resolveAuthorPresentation(item.presentation, locale)
    : item.officialCatalog
      ? resolvePluginPresentation(item.officialCatalog, locale)
      : undefined;
}

function categoryLabel(category: PluginPresentationCategory, i18n: I18nHelpers): string {
  switch (category) {
    case 'development': return i18n.t('uiCopy.plugin.categoryDevelopment');
    case 'infrastructure': return i18n.t('uiCopy.plugin.categoryInfrastructure');
    case 'data': return i18n.t('uiCopy.plugin.categoryData');
    case 'collaboration': return i18n.t('uiCopy.plugin.categoryCollaboration');
    case 'productivity': return i18n.t('uiCopy.plugin.categoryProductivity');
    case 'other': return i18n.t('uiCopy.plugin.categoryOther');
  }
}

function statusLabel(item: PluginInventoryItem, i18n: I18nHelpers): string {
  return pluginLifecycleLabel(item, i18n);
}
