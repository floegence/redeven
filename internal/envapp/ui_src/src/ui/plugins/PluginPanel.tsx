import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { Filter, Package, Search, X } from '@floegence/floe-webapp-core/icons';
import { SurfaceAnchoredLayer } from '@floegence/floe-webapp-core/ui';
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
  'utilities',
  'data',
  'collaboration',
  'productivity',
  'other',
];

type PluginPanelMotionState = 'entering' | 'open' | 'closing';

export type PluginPanelProps = {
  id?: string;
  open: boolean;
  mobile?: boolean;
  /** Shell owns the mobile navigation surface, focus, and content isolation. */
  contentOnly?: boolean;
  mobileContentHost?: HTMLElement | null;
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

  onCleanup(() => {
    entranceRequest += 1;
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
  });

  createEffect(() => {
    if (props.mobile) return;
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


  const pluginTiles = createMemo(() => props.model.tiles.filter(isPluginTile));
  const normalizedQuery = createMemo(() => normalizeSearchText(query(), i18n.locale()));
  const visibleTiles = createMemo(() => pluginTiles().filter((tile) => {
    if (category() !== 'all' && tile.item.category !== category()) return false;
    const search = normalizedQuery();
    return search === '' || pluginSearchText(tile.item, i18n, i18n.locale()).includes(search);
  }));
  const visible = () => props.open || mounted();
  const dismiss = () => {
    restoreFocusAfterClose = true;
    props.onClose();
    if (props.mobile) props.trigger?.focus({ preventScroll: true });
  };

  createEffect(() => {
    if (!props.open || props.mobile) return;
    restoreFocusAfterClose = false;
    focusRestoreTarget = props.trigger
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || pinMenu()) return;
      if (event.key === 'Escape') {
        if (!panelRef?.contains(event.target as Node) && event.target !== document && event.target !== props.trigger) return;
        event.preventDefault();
        if (query()) {
          setQuery('');
          searchRef?.focus({ preventScroll: true });
        } else {
          dismiss();
        }
        return;
      }
      if (event.key !== 'Tab' || !isWorkbenchPopup() || !panelRef || (!panelRef.contains(document.activeElement) && event.target !== document)) return;
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
      if (!panelRef) return;
      const trigger = props.trigger?.isConnected ? props.trigger : null;
      if (
        panelRef.contains(event.target as Node)
        || pinMenuRef?.contains(event.target as Node)
        || trigger?.contains(event.target as Node)
      ) return;
      restoreFocusAfterClose = false;
      props.onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    let focusCancelled = false;
    queueMicrotask(() => {
      if (!focusCancelled) searchRef?.focus({ preventScroll: true });
    });
    onCleanup(() => {
      focusCancelled = true;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
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
          props.onDropPlugin?.(target, placement);
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
            <Show when={props.mobile}><div class="mx-auto mt-2.5 mb-1 h-1 w-8 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden="true" /></Show>
            <header class={cn('shrink-0', props.mobile ? 'border-b px-3 pt-1 pb-3' : isWorkbenchPopup() ? 'px-2.5 py-2' : 'plugin-activity-toolbar border-b px-3 py-2.5')}>
              <div class={cn('flex items-center', props.mobile ? 'flex-wrap gap-1' : 'gap-2')}>
                <Show when={!isWorkbenchPopup()}>
                  <h2 id="plugin-launcher-title" class={cn('shrink-0 font-semibold', props.mobile ? 'flex-1 text-base' : 'plugin-activity-title text-sm')}>
                    {i18n.t('uiCopy.plugin.launcherTitle')}
                  </h2>
                </Show>
                <label class={cn("relative min-w-0 flex-1", props.mobile && "order-last basis-full")}>
                  <span class="sr-only">{i18n.t('uiCopy.plugin.launcherSearchLabel')}</span>
                  <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input data-floe-control="input"
                    ref={searchRef}
                    type="search"
                    data-plugin-launcher-search
                    value={query()}
                    onInput={(event) => setQuery(event.currentTarget.value)}
                    placeholder={i18n.t('uiCopy.plugin.launcherSearchPlaceholder')}
                    class={cn('w-full text-[length:var(--floe-type-control)] rounded-md border bg-muted/40 outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground/60 motion-reduce:transition-none', props.mobile ? 'h-11 pl-9 pr-3' : 'h-8 pl-8 pr-2')}
                  />
                </label>
                <Show when={!props.mobile && !isWorkbenchPopup() && pluginTiles().length >= CATEGORY_FILTER_THRESHOLD}>
                  <label data-floe-input-surface class="plugin-activity-category relative inline-flex border border-transparent h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" title={category() === 'all' ? i18n.t('uiCopy.plugin.categories') : categoryLabel(category() as PluginPresentationCategory, i18n)}>
                    <Filter class={cn('h-3.5 w-3.5', category() !== 'all' && 'text-primary')} />
                    <select
                      data-plugin-launcher-category-filter
                      aria-label={i18n.t('uiCopy.plugin.categories')}
                      value={category()}
                      onChange={(event) => setCategory(event.currentTarget.value as PluginPresentationCategory | 'all')}
                      class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    >
                      <option value="all">{i18n.t('uiCopy.plugin.categoryAll')}</option>
                      <For each={CATEGORY_IDS}>{(id) => <option value={id}>{categoryLabel(id, i18n)}</option>}</For>
                    </select>
                  </label>
                </Show>
                <button type="button" data-plugin-center-market-action aria-label={i18n.t('uiCopy.plugin.centerTitle')} title={i18n.t('uiCopy.plugin.centerTitle')} class={cn(props.mobile ? 'h-11 w-11' : 'h-8 w-8', props.mobile && 'order-2', 'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none')} onClick={() => { props.onOpenCenter(); props.onClose(); }}>
                  <Package class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-floe-autofocus={props.mobile && props.open ? '' : undefined}
                  class={cn(props.mobile && 'order-3', 'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none', props.mobile ? 'h-11 w-11' : 'h-8 w-8')}
                  aria-label={i18n.t('uiCopy.plugin.closePanel')}
                  title={i18n.t('uiCopy.plugin.closePanel')}
                  onClick={dismiss}
                >
                  <X class="h-3.5 w-3.5" />
                </button>

              </div>
              <p id="plugin-launcher-description" class="sr-only">
                {i18n.t('uiCopy.plugin.launcherDescription')}
              </p>
              <Show when={(props.mobile || isWorkbenchPopup()) && pluginTiles().length >= CATEGORY_FILTER_THRESHOLD}>
                <div class="mt-3 flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={i18n.t('uiCopy.plugin.categories')}>
                  <CategoryButton id="all" active={category()} onSelect={setCategory} label={i18n.t('uiCopy.plugin.categoryAll')} />
                  <For each={CATEGORY_IDS}>
                    {(id) => <CategoryButton id={id} active={category()} onSelect={setCategory} label={categoryLabel(id, i18n)} />}
                  </For>
                </div>
              </Show>
            </header>

            <div class={cn('min-h-0 flex-1 overflow-y-auto', props.mobile ? 'px-4 py-5 sm:px-5' : 'px-3 py-3')}>
              <Show when={props.model.errorMessage}>
                <div role="alert" class="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-4 text-destructive">
                  {props.model.errorMessage}
                </div>
              </Show>
              <ul
                ref={gridRef}
                data-plugin-launcher-grid
                aria-busy={props.model.loading}
                class={cn('grid', props.mobile ? 'grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5' : 'grid-cols-4 gap-1.5')}
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
                        class={cn('flex w-full min-w-0 cursor-pointer touch-none select-none flex-col items-center rounded-md border border-transparent text-center hover:border-border hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', props.mobile ? 'gap-2.5 px-2 py-3' : isWorkbenchPopup() ? 'gap-1 px-1 py-2' : 'h-[82px] justify-center gap-2 px-1 py-2', PLUGIN_PRESS_MOTION_CLASS)}
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
                          <PluginIcon item={tile.item} size={isWorkbenchPopup() ? 'dock' : 'launcher'} class={cn(!props.mobile && !isWorkbenchPopup() && 'h-10 w-10 rounded-xl', 'transition-transform duration-200 ease-out group-hover:scale-[1.04] motion-reduce:transform-none motion-reduce:transition-none')} />
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
                  <p class="mt-3 max-w-sm text-[length:var(--floe-type-body)] text-muted-foreground">{i18n.t('uiCopy.plugin.noInstalled')}</p>
                </div>
              </Show>
              <Show when={!props.model.loading && pluginTiles().length > 0 && visibleTiles().length === 0}>
                <div class={cn('flex min-h-40 flex-col items-center justify-center text-center', PLUGIN_ENTER_MOTION_CLASS)}>
                  <Search class="h-7 w-7 text-muted-foreground" />
                  <p class="mt-3 text-[length:var(--floe-type-body)] font-medium">{i18n.t('uiCopy.plugin.launcherNoResults')}</p>
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

    </>
  );

  const contents = untrack(panelContents);

  const mobileContent = () => <div class="flex min-h-0 flex-1 flex-col" onKeyDown={(event) => {
    if (event.key === 'Escape' && query() && !event.isComposing) {
      event.preventDefault();
      setQuery('');
    }
  }}>{contents}</div>;

  return (
    <>
      <Show when={props.mobile && props.contentOnly}>{mobileContent()}</Show>
      <Show when={props.mobile && !props.contentOnly && props.mobileContentHost}>
        <Portal mount={props.mobileContentHost!}>{mobileContent()}</Portal>
      </Show>
      <Show when={visible() && isWorkbenchPopup() && props.trigger?.isConnected ? props.trigger : null}>
        {(trigger) => (
          <WorkbenchDockPopoverSurface
            id={props.id}
            owner={trigger()}
            estimatedSize={{ width: 320, height: 380 }}
            surfaceRef={(element) => {
              panelRef = element;
              element.style.setProperty('--redeven-plugin-panel-origin-y', '100%');
              element.style.setProperty('--redeven-plugin-panel-enter-y', '10px');
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
              'plugin-panel-surface redeven-plugin-motion flex max-h-[min(380px,calc(100dvh-120px))] w-[min(320px,calc(100vw-24px))] min-h-0 flex-col overflow-hidden text-foreground',
            )}
          >
            <div data-plugin-panel-content class="redeven-plugin-motion flex min-h-0 flex-1 flex-col">
              {contents}
            </div>
          </WorkbenchDockPopoverSurface>
        )}
      </Show>
      <Show when={visible() && !isWorkbenchPopup() && !props.mobile}>
        <>
          <SurfaceAnchoredLayer
            anchor={props.trigger ?? undefined}
            placement="right"
            gap={16}
            onAnchorDisconnect={dismiss}
            class="plugin-activity-anchor"
            style={{ 'z-index': ENV_APP_FLOATING_LAYER.pluginPanel, width: '424px' }}
          >
            <div
              id={props.id}
              ref={(element) => { panelRef = element; }}
              role={props.open ? 'dialog' : undefined}
              data-plugin-panel-motion-axis="x"
              data-plugin-panel-motion-kind="activity-popover"
              data-plugin-panel-motion-state={motionState()}
              tabIndex={-1}
              inert={!props.open}
              aria-hidden={props.open ? undefined : 'true'}
              aria-labelledby="plugin-launcher-title"
              aria-describedby="plugin-launcher-description"
              class="plugin-panel-surface plugin-activity-panel redeven-plugin-motion flex min-h-0 w-full flex-col rounded-2xl border bg-popover text-popover-foreground shadow-2xl"
            >
              <span class="plugin-activity-arrow" aria-hidden="true" />
              <div data-plugin-panel-content class="redeven-plugin-motion flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
                {contents}
              </div>
            </div>
          </SurfaceAnchoredLayer>
        </>
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
    case 'utilities': return i18n.t('uiCopy.plugin.categoryUtilities');
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
