import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronRight, MoreHorizontal, Package, Search, Settings, X } from '@floegence/floe-webapp-core/icons';
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
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
  model: PluginPanelModel;
  onClose: () => void;
  onOpenCenter: () => void;
  onOpenPluginSurface: (target: PluginSurfaceLaunchTarget) => void;
  onOpenPluginDetails: (inventoryKey: string) => void;
};

export function PluginPanel(props: PluginPanelProps): JSX.Element {
  const i18n = useI18n();
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<PluginPresentationCategory | 'all'>('all');
  let panelRef: HTMLDivElement | undefined;
  let searchRef: HTMLInputElement | undefined;
  let gridRef: HTMLUListElement | undefined;
  const tileMenuButtons = new Map<string, HTMLButtonElement>();
  let restoreFocusAfterClose = false;
  let focusRestoreTarget: HTMLElement | null = null;

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
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const restoreIsolation = panelRef ? isolateDocumentBranch(panelRef) : null;
    let focusCancelled = false;
    queueMicrotask(() => {
      if (!focusCancelled) searchRef?.focus({ preventScroll: true });
    });
    onCleanup(() => {
      focusCancelled = true;
      document.removeEventListener('keydown', onKeyDown);
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
    } else {
      props.onOpenPluginDetails(tile.item.inventoryKey);
    }
    props.onClose();
  };

  const tileMenuItems = (tile: Extract<PluginPanelTile, { kind: 'plugin' }>): DropdownItem[] => [
    ...(tile.action === 'open_surface' && tile.item.defaultLaunchTarget ? [
      { id: 'activity', label: i18n.t('uiCopy.plugin.openInActivity') },
      { id: 'workbench', label: i18n.t('uiCopy.plugin.openInWorkbench') },
    ] : []),
    { id: 'details', label: i18n.t('uiCopy.plugin.technicalDetails') },
  ];

  const activateTileMenu = (tile: Extract<PluginPanelTile, { kind: 'plugin' }>, action: string) => {
    restoreFocusAfterClose = false;
    if ((action === 'activity' || action === 'workbench') && tile.item.defaultLaunchTarget) {
      props.onOpenPluginSurface({ ...tile.item.defaultLaunchTarget, preferredPlacement: action });
    } else if (action === 'details') {
      props.onOpenPluginDetails(tile.item.inventoryKey);
    } else {
      return;
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

  const openTileMenu = (event: MouseEvent | KeyboardEvent, inventoryKey: string) => {
    const keyboardRequest = event instanceof KeyboardEvent
      && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'));
    if (event instanceof KeyboardEvent && !keyboardRequest) return false;
    event.preventDefault();
    event.stopPropagation();
    tileMenuButtons.get(inventoryKey)?.click();
    return true;
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          data-plugin-launcher-backdrop
          class={cn(
            'redeven-plugin-motion fixed inset-0 flex bg-[var(--redeven-overlay-scrim)] animate-in fade-in duration-150 motion-reduce:animate-none',
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
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="plugin-launcher-title"
            aria-describedby="plugin-launcher-description"
            class={cn(
              'redeven-plugin-motion flex min-h-0 w-full origin-bottom flex-col overflow-hidden border bg-popover text-popover-foreground shadow-2xl ease-out motion-reduce:animate-none',
              props.mobile
                ? 'h-[min(680px,92dvh)] rounded-t-lg border-x-0 border-b-0 animate-in fade-in duration-200'
                : 'h-[min(680px,78dvh)] max-w-[820px] rounded-lg animate-in fade-in zoom-in-95 duration-200',
            )}
          >
            <header class="shrink-0 border-b px-4 py-3 sm:px-5">
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  class="order-last inline-flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8 motion-reduce:transition-none"
                  aria-label={i18n.t('uiCopy.plugin.closePanel')}
                  title={i18n.t('uiCopy.plugin.closePanel')}
                  onClick={dismiss}
                >
                  <X class="h-3.5 w-3.5" />
                </button>
                <h2 id="plugin-launcher-title" class="shrink-0 text-base font-semibold">
                  {i18n.t('uiCopy.plugin.launcherTitle')}
                </h2>
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
                    class="h-10 w-full rounded-md border bg-muted/40 pl-9 pr-3 text-sm outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground/60 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20 motion-reduce:transition-none"
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

            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
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
                class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5"
              >
                <For each={visibleTiles()}>
                  {(tile, index) => (
                    <li
                      class={cn('group relative min-w-0', PLUGIN_ENTER_MOTION_CLASS)}
                      style={`animation-delay: ${Math.min(index() * 18, 126)}ms`}
                      onContextMenu={(event) => openTileMenu(event, tile.item.inventoryKey)}
                    >
                      <button
                        type="button"
                        data-plugin-panel-tile={tile.item.inventoryKey}
                        aria-describedby={`plugin-launcher-tile-status-${index()}`}
                        class={cn('flex w-full min-w-0 cursor-pointer flex-col items-center gap-2.5 rounded-lg border border-transparent px-2 py-3 text-center hover:-translate-y-0.5 hover:border-border hover:bg-background hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', PLUGIN_PRESS_MOTION_CLASS)}
                        onKeyDown={(event) => {
                          if (!openTileMenu(event, tile.item.inventoryKey)) moveGridFocus(event, index());
                        }}
                        onClick={() => activateTile(tile)}
                      >
                        <div class="relative">
                          <PluginIcon item={tile.item} size="launcher" class="transition-transform duration-200 ease-out group-hover:scale-[1.04] motion-reduce:transform-none motion-reduce:transition-none" />
                          <PluginUpdateBadge item={tile.item} />
                        </div>
                        <span class="block min-w-0 max-w-full truncate text-xs font-medium leading-4">
                          {resolvedPluginPresentation(tile.item, i18n.locale())?.plugin_name ?? tile.item.displayName}
                        </span>
                      </button>
                      <span id={`plugin-launcher-tile-status-${index()}`} class="sr-only">
                        {statusLabel(tile.item, i18n)}
                      </span>
                      <Show when={tileMenuItems(tile).length > 0}>
                        <Dropdown
                          align="end"
                          class="absolute right-1 top-1 z-10"
                          triggerClass="rounded-md"
                          items={tileMenuItems(tile)}
                          onSelect={(action) => activateTileMenu(tile, action)}
                          triggerAriaLabel={`${resolvedPluginPresentation(tile.item, i18n.locale())?.plugin_name ?? tile.item.displayName}: ${i18n.t('uiCopy.plugin.moreActions')}`}
                          trigger={(
                            <button
                              ref={(element) => tileMenuButtons.set(tile.item.inventoryKey, element)}
                              type="button"
                              data-plugin-panel-tile-menu={tile.item.inventoryKey}
                              class="inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-100 shadow-sm transition-[background-color,color,opacity] duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:min-h-0 sm:w-7 sm:min-w-0 sm:opacity-0 sm:shadow-none sm:group-hover:opacity-100 motion-reduce:transition-none"
                              title={i18n.t('uiCopy.plugin.moreActions')}
                            >
                              <MoreHorizontal class="h-3.5 w-3.5" />
                            </button>
                          )}
                        />
                      </Show>
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
              {(tile) => (
                <footer class="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/25 px-4 py-3 sm:px-5">
                  <div class="min-w-0 text-xs leading-5 text-muted-foreground">
                    {i18n.t('uiCopy.plugin.launcherSummary', { count: pluginTiles().length, attention: attentionCount() })}
                  </div>
                  <button
                    type="button"
                    data-plugin-panel-tile="plugin-center"
                    class={cn('inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', PLUGIN_PRESS_MOTION_CLASS)}
                    onClick={() => activateTile(tile())}
                  >
                    <Settings class="h-4 w-4" />
                    <span>{tile().label}</span>
                    <ChevronRight class="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </footer>
              )}
            </Show>
          </div>
        </div>
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
