import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { Package, Search, X } from '@floegence/floe-webapp-core/icons';
import type { BarItemContextMenuRequest } from '@floegence/floe-webapp-core/layout';
import { WorkbenchDockPopoverSurface, type WorkbenchCanvasWidgetPlacement, type WorkbenchExternalDockDragController } from '@floegence/floe-webapp-core/workbench';
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
import { PluginPinContextMenu } from './PluginPinContextMenu';
import type { PluginPinPlacement } from './pluginDockPins';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const CATEGORY_FILTER_THRESHOLD = 6;
const PANEL_CLOSE_DURATION_MS = 150;
const CATEGORY_IDS: readonly PluginPresentationCategory[] = [
  'development',
  'infrastructure',
  'data',
  'collaboration',
  'productivity',
  'other',
];

type PluginPanelMotionState = 'entering' | 'open' | 'closing';
type PluginPanelMotionKind = 'modal' | 'mobile-sheet' | 'workbench-popover';

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
  onDropPlugin?: (target: PluginSurfaceLaunchTarget, placement: WorkbenchCanvasWidgetPlacement) => void;
  externalDockDragController?: WorkbenchExternalDockDragController | null;
  pinnedInventoryKeys?: readonly string[];
  onSetPluginPin?: (placement: PluginPinPlacement, inventoryKey: string, pinned: boolean) => void | Promise<void>;
};

export function PluginPanel(props: PluginPanelProps): JSX.Element {
  const i18n = useI18n();
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<PluginPresentationCategory | 'all'>('all');
  const [mounted, setMounted] = createSignal(props.open);
  const [motionState, setMotionStateSignal] = createSignal<PluginPanelMotionState>(
    props.open ? 'entering' : 'closing',
  );
  const [pinMenu, setPinMenu] = createSignal<Readonly<{
    inventoryKey: string;
    request: BarItemContextMenuRequest;
  }> | null>(null);
  const pinMenuItem = createMemo(() => {
    const inventoryKey = pinMenu()?.inventoryKey;
    if (!inventoryKey) return undefined;
    const tile = props.model.tiles.find((candidate) => (
      candidate.kind === 'plugin' && candidate.item.inventoryKey === inventoryKey
    ));
    return tile?.kind === 'plugin' ? tile.item : undefined;
  });
  let panelRef: HTMLDivElement | undefined;
  let pinMenuRef: HTMLDivElement | null = null;
  let searchRef: HTMLInputElement | undefined;
  let gridRef: HTMLUListElement | undefined;
  let restoreFocusAfterClose = false;
  let focusRestoreTarget: HTMLElement | null = null;
  let closeTimer: number | undefined;
  let entranceRequest = 0;
  const isWorkbenchPopup = () => props.placement === 'workbench';
  const motionKind = (): PluginPanelMotionKind => props.mobile
    ? 'mobile-sheet'
    : (isWorkbenchPopup() ? 'workbench-popover' : 'modal');

  onCleanup(() => {
    entranceRequest += 1;
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
  });

  createEffect(() => {
    if (props.open) {
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
        closeTimer = undefined;
      }
      const reversingClose = untrack(mounted) && untrack(motionState) === 'closing';
      if (!untrack(mounted)) setMounted(true);
      if (reversingClose) {
        entranceRequest += 1;
        setMotionStateSignal('open');
        return;
      }
      setMotionStateSignal('entering');
      if (prefersReducedPluginMotion()) {
        setMotionStateSignal('open');
        return;
      }
      const request = ++entranceRequest;
      queueMicrotask(() => {
        if (request !== entranceRequest || !props.open || !untrack(mounted)) return;
        // Flush the entering pose before changing state so the transition is
        // reversible instead of replaying a fixed keyframe on rapid toggles.
        panelRef?.getBoundingClientRect();
        setMotionStateSignal('open');
      });
      return;
    }
    setPinMenu(null);
    entranceRequest += 1;
    if (!untrack(mounted)) return;
    if (prefersReducedPluginMotion()) {
      setMounted(false);
      return;
    }
    setMotionStateSignal('closing');
    closeTimer = window.setTimeout(() => {
      setMounted(false);
      closeTimer = undefined;
    }, PANEL_CLOSE_DURATION_MS);
  });

  createEffect(() => {
    const trigger = props.trigger;
    const kind = motionKind();
    if (!props.open) return;
    queueMicrotask(() => applyPluginPanelMotionGeometry(panelRef, trigger, kind));
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
  const visible = () => props.open || mounted();
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
      const trigger = props.trigger?.isConnected ? props.trigger : null;
      if (
        panelRef.contains(event.target as Node)
        || pinMenuRef?.contains(event.target as Node)
        || trigger?.contains(event.target as Node)
      ) return;
      dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    if (isWorkbenchPopup()) {
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
        document.removeEventListener('pointerdown', onPointerDown, true);
      }
      restoreIsolation?.();
      if (restoreFocusAfterClose && focusRestoreTarget?.isConnected) {
        focusRestoreTarget.focus({ preventScroll: true });
      }
    });
  });

  const beginTileDrag = (
    event: PointerEvent,
    tile: Extract<PluginPanelTile, { kind: 'plugin' }>,
  ) => {
    if (!isWorkbenchPopup() || event.button !== 0 || !props.externalDockDragController) return;
    const target = tile.item.defaultLaunchTarget;
    props.externalDockDragController.begin(event, {
      id: tile.item.inventoryKey,
      label: tile.item.displayName,
      icon: (iconProps) => <PluginIcon item={tile.item} size="dock" class={iconProps.class} />,
      dockPlacement: 'after-components',
      canvasPlacement: target && props.onDropPlugin ? {
        widgetType: 'redeven.plugin',
        onDrop: (placement) => {
          props.onDropPlugin?.({ ...target, preferredPlacement: 'workbench' }, placement);
          dismiss();
        },
      } : undefined,
      onDropToDock: props.onSetPluginPin
        ? () => void props.onSetPluginPin?.('workbench', tile.item.inventoryKey, true)
        : undefined,
    });
  };

  const requestPinMenu = (
    inventoryKey: string,
    request: BarItemContextMenuRequest,
  ) => {
    if (!props.onSetPluginPin) return;
    setPinMenu({ inventoryKey, request });
  };

  const isPinContextMenuKey = (event: KeyboardEvent) => (
    event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
  );

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

  const panelContents = () => (
    <>
            <header class={cn('shrink-0 border-b', isWorkbenchPopup() ? 'px-2.5 py-2' : 'px-4 py-3 sm:px-5')}>
              <div class={cn('flex items-center', isWorkbenchPopup() ? 'gap-2' : 'gap-3')}>
                <button type="button" data-plugin-center-market-action aria-label={i18n.t('uiCopy.plugin.centerTitle')} title={i18n.t('uiCopy.plugin.centerTitle')} class="order-last inline-flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:h-8 sm:w-8" onClick={() => { props.onOpenCenter(); props.onClose(); }}>
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
              <ul
                ref={gridRef}
                data-plugin-launcher-grid
                aria-busy={props.model.loading}
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
                        aria-haspopup={props.onSetPluginPin ? 'menu' : undefined}
                        aria-expanded={pinMenu()?.inventoryKey === tile.item.inventoryKey ? 'true' : undefined}
                        class={cn('flex w-full min-w-0 cursor-pointer touch-none select-none flex-col items-center rounded-md border border-transparent text-center hover:border-border hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', isWorkbenchPopup() ? 'gap-1 px-1 py-2' : 'gap-2.5 px-2 py-3', PLUGIN_PRESS_MOTION_CLASS)}
                        onKeyDown={(event) => {
                          if (props.onSetPluginPin && isPinContextMenuKey(event)) {
                            event.preventDefault();
                            event.stopPropagation();
                            const rect = event.currentTarget.getBoundingClientRect();
                            requestPinMenu(tile.item.inventoryKey, {
                              trigger: event.currentTarget,
                              clientX: rect.left + rect.width / 2,
                              clientY: rect.top + rect.height / 2,
                              source: 'keyboard',
                            });
                            return;
                          }
                          moveGridFocus(event, index());
                        }}
                        onContextMenu={(event) => {
                          if (!props.onSetPluginPin) return;
                          event.preventDefault();
                          event.stopPropagation();
                          requestPinMenu(tile.item.inventoryKey, {
                            trigger: event.currentTarget,
                            clientX: event.clientX,
                            clientY: event.clientY,
                            source: 'pointer',
                          });
                        }}
                        onPointerDown={(event) => beginTileDrag(event, tile)}
                        onClick={() => activateTile(tile)}
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
    </>
  );

  return (
    <>
      <Show when={visible() && isWorkbenchPopup() && props.trigger?.isConnected ? props.trigger : null}>
        {(trigger) => (
          <WorkbenchDockPopoverSurface
            id={props.id}
            owner={trigger()}
            estimatedSize={{ width: 320, height: 380 }}
            surfaceRef={(element) => {
              panelRef = element;
              applyPluginPanelMotionGeometry(element, props.trigger, 'workbench-popover');
            }}
            onOwnerDisconnect={dismiss}
            role={props.open ? 'dialog' : undefined}
            data-plugin-panel-motion-axis="y"
            data-plugin-panel-motion-kind="workbench-popover"
            data-plugin-panel-motion-state={motionState()}
            tabIndex={-1}
            aria-label={i18n.t('uiCopy.plugin.launcherTitle')}
            aria-describedby="plugin-launcher-description"
            class={cn(
              'plugin-panel-surface redeven-plugin-motion flex max-h-[min(380px,calc(100dvh-120px))] w-[min(320px,calc(100vw-24px))] min-h-0 flex-col overflow-hidden rounded-lg text-foreground',
            )}
          >
            <div data-plugin-panel-content class="redeven-plugin-motion flex min-h-0 flex-1 flex-col">
              {panelContents()}
            </div>
          </WorkbenchDockPopoverSurface>
        )}
      </Show>
      <Show when={!isWorkbenchPopup()}>
        <Portal>
          <div
            data-plugin-launcher-backdrop={visible() ? '' : undefined}
            data-plugin-launcher-motion-state={visible() ? motionState() : undefined}
            hidden={!visible()}
            inert={!props.open}
            aria-hidden={props.open ? undefined : 'true'}
            class={cn(
              'plugin-panel-backdrop redeven-plugin-motion fixed inset-0 flex',
              'bg-[var(--redeven-overlay-scrim)]',
              props.mobile ? 'items-end' : 'items-center justify-center p-4',
            )}
            style={{ 'z-index': ENV_APP_FLOATING_LAYER.pluginPanel }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) dismiss();
            }}
          >
            <div
              id={props.id}
              ref={(element) => {
                panelRef = element;
                applyPluginPanelMotionGeometry(
                  element,
                  props.trigger,
                  props.mobile ? 'mobile-sheet' : 'modal',
                );
              }}
              role={props.open ? 'dialog' : undefined}
              data-plugin-panel-motion-axis="y"
              data-plugin-panel-motion-kind={props.mobile ? 'mobile-sheet' : 'modal'}
              data-plugin-panel-motion-state={visible() ? motionState() : undefined}
              tabIndex={-1}
              aria-modal={props.open ? 'true' : undefined}
              aria-labelledby={props.open ? 'plugin-launcher-title' : undefined}
              aria-describedby={props.open ? 'plugin-launcher-description' : undefined}
              class={cn(
                'plugin-panel-surface redeven-plugin-motion flex min-h-0 w-full flex-col overflow-hidden border bg-popover text-popover-foreground shadow-2xl',
                props.mobile
                  ? 'h-[min(680px,92dvh)] rounded-t-lg border-x-0 border-b-0'
                  : 'h-[min(680px,78dvh)] max-w-[820px] rounded-lg',
              )}
            >
              <div data-plugin-panel-content class="redeven-plugin-motion flex min-h-0 flex-1 flex-col">
                {panelContents()}
              </div>
            </div>
          </div>
        </Portal>
      </Show>
      <PluginPinContextMenu
        request={pinMenu()?.request ?? null}
        ariaLabel={i18n.t('uiCopy.plugin.pluginMenuLabel', {
          plugin: pinMenuItem()?.displayName ?? i18n.t('uiCopy.plugin.panelTitle'),
        })}
        informationLabel={i18n.t('uiCopy.plugin.pluginInformation')}
        pinLabel={pinMenu() && (props.pinnedInventoryKeys ?? []).includes(pinMenu()!.inventoryKey)
          ? (props.placement === 'workbench'
              ? i18n.t('uiCopy.plugin.unpinFromWorkbenchDock')
              : i18n.t('uiCopy.plugin.unpinFromActivityBar'))
          : (props.placement === 'workbench'
              ? i18n.t('uiCopy.plugin.pinToWorkbenchDock')
              : i18n.t('uiCopy.plugin.pinToActivityBar'))}
        onLayerRef={(element) => { pinMenuRef = element; }}
        onClose={() => setPinMenu(null)}
        onSelectInformation={() => {
          const menu = pinMenu();
          if (menu) props.onOpenPluginDetails(menu.inventoryKey);
        }}
        onSelectPin={() => {
          const menu = pinMenu();
          if (!menu) return;
          const placement = props.placement === 'workbench' ? 'workbench' : 'activity';
          const pinned = (props.pinnedInventoryKeys ?? []).includes(menu.inventoryKey);
          return props.onSetPluginPin?.(placement, menu.inventoryKey, !pinned);
        }}
      />
    </>
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

function prefersReducedPluginMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function applyPluginPanelMotionGeometry(
  panel: HTMLElement | undefined,
  trigger: HTMLElement | null | undefined,
  kind: PluginPanelMotionKind,
): void {
  if (!panel) return;
  let originX = '50%';
  let originY = '50%';
  let enterX = 0;
  let enterY = 12;
  if (kind === 'mobile-sheet') {
    originY = '100%';
    enterY = 18;
  } else if (kind === 'workbench-popover') {
    originY = '100%';
    enterY = 10;
  } else {
    const triggerRect = trigger?.isConnected ? trigger.getBoundingClientRect() : undefined;
    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);
    if (triggerRect && triggerRect.width > 0 && triggerRect.height > 0) {
      const triggerCenterX = triggerRect.left + triggerRect.width / 2;
      const triggerCenterY = triggerRect.top + triggerRect.height / 2;
      originX = `${formatMotionNumber(clamp(triggerCenterX / viewportWidth * 100, 8, 92))}%`;
      originY = `${formatMotionNumber(clamp(triggerCenterY / viewportHeight * 100, 8, 92))}%`;
      enterX = clamp((triggerCenterX - viewportWidth / 2) * 0.04, -18, 18);
      enterY = clamp((triggerCenterY - viewportHeight / 2) * 0.035, -14, 14);
    }
  }

  panel.style.setProperty('--redeven-plugin-panel-origin-x', originX);
  panel.style.setProperty('--redeven-plugin-panel-origin-y', originY);
  panel.style.setProperty('--redeven-plugin-panel-enter-x', `${formatMotionNumber(enterX)}px`);
  panel.style.setProperty('--redeven-plugin-panel-enter-y', `${formatMotionNumber(enterY)}px`);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatMotionNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}
