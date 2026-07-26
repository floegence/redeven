import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { cn } from '@floegence/floe-webapp-core';
import { ChevronRight, Grid3x3, MoreHorizontal, Package, Search, Settings, X } from '@floegence/floe-webapp-core/icons';
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import type {
  PluginInventoryItem,
  PluginPanelModel,
  PluginPanelTile,
  PluginPresentationCategory,
  PluginSurfaceLaunchTarget,
} from './pluginTypes';
import { useI18n, type I18nHelpers } from '../i18n';
import { isolateDocumentBranch } from './modalIsolation';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
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
      props.onClose();
      return;
    }
    props.onOpenPluginDetails(tile.item.inventoryKey);
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

  return (
    <Show when={props.open}>
      <Portal>
        <div
          data-plugin-launcher-backdrop
          class={cn(
            'fixed inset-0 z-50 flex bg-[var(--redeven-overlay-scrim)]',
            props.mobile ? 'items-end' : 'items-center justify-center p-4',
          )}
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
              'flex min-h-0 w-full flex-col overflow-hidden border bg-popover text-popover-foreground shadow-2xl',
              props.mobile
                ? 'max-h-[92dvh] rounded-t-lg border-x-0 border-b-0'
                : 'max-h-[min(680px,78dvh)] max-w-[820px] rounded-lg',
            )}
          >
            <header class="shrink-0 border-b px-4 pb-3 pt-4 sm:px-5">
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 items-center gap-2.5">
                  <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background">
                    <Grid3x3 class="h-4 w-4" />
                  </span>
                  <div class="min-w-0">
                    <h2 id="plugin-launcher-title" class="truncate text-base font-semibold leading-5">
                      {i18n.t('uiCopy.plugin.launcherTitle')}
                    </h2>
                    <p id="plugin-launcher-description" class="truncate text-xs leading-4 text-muted-foreground">
                      {i18n.t('uiCopy.plugin.launcherDescription')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  class="inline-flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
                  aria-label={i18n.t('uiCopy.plugin.closePanel')}
                  title={i18n.t('uiCopy.plugin.closePanel')}
                  onClick={dismiss}
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
              <label class="relative mt-3 block">
                <span class="sr-only">{i18n.t('uiCopy.plugin.launcherSearchLabel')}</span>
                <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={searchRef}
                  type="search"
                  data-plugin-launcher-search
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  placeholder={i18n.t('uiCopy.plugin.launcherSearchPlaceholder')}
                  class="h-[44px] w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <div class="mt-3 flex gap-1 overflow-x-auto pb-0.5" role="group" aria-label={i18n.t('uiCopy.plugin.categories')}>
                <CategoryButton id="all" active={category()} onSelect={setCategory} label={i18n.t('uiCopy.plugin.categoryAll')} />
                <For each={CATEGORY_IDS}>
                  {(id) => <CategoryButton id={id} active={category()} onSelect={setCategory} label={categoryLabel(id, i18n)} />}
                </For>
              </div>
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <Show when={props.model.errorMessage}>
                <div role="alert" class="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-4 text-destructive">
                  {props.model.errorMessage}
                </div>
              </Show>
              <Show when={props.model.loading}>
                <div role="status" class="mb-3 rounded-md bg-muted px-3 py-2 text-xs leading-4 text-muted-foreground">
                  {i18n.t('uiCopy.plugin.loadingOfficial')}
                </div>
              </Show>

              <div class="mb-3 flex items-center justify-between gap-3">
                <h3 class="text-xs font-semibold uppercase text-muted-foreground">{i18n.t('uiCopy.plugin.launcherApplications')}</h3>
                <span role="status" aria-live="polite" class="text-xs text-muted-foreground">
                  {i18n.t('uiCopy.plugin.launcherResultCount', { count: visibleTiles().length })}
                </span>
              </div>
              <ul
                ref={gridRef}
                data-plugin-launcher-grid
                class="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
              >
                <For each={visibleTiles()}>
                  {(tile, index) => (
                    <li class="group min-w-0 rounded-md transition-colors hover:bg-accent focus-within:bg-accent">
                      <button
                        type="button"
                        data-plugin-panel-tile={tile.item.inventoryKey}
                        aria-describedby={`plugin-launcher-tile-status-${index()}`}
                        class="flex min-h-[88px] w-full min-w-0 cursor-pointer flex-col items-center rounded-md px-2 pb-1 pt-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onKeyDown={(event) => moveGridFocus(event, index())}
                        onClick={() => activateTile(tile)}
                      >
                        <PluginTileIcon item={tile.item} />
                        <span class="mt-2 line-clamp-2 min-w-0 max-w-full text-sm font-medium leading-4">{tile.item.displayName}</span>
                      </button>
                      <div class="flex min-h-11 min-w-0 items-center justify-between gap-1 pl-2">
                        <span
                          id={`plugin-launcher-tile-status-${index()}`}
                          class={cn('min-w-0 flex-1 truncate text-left text-[11px] leading-4', statusClass(tile.item))}
                        >
                          {statusLabel(tile.item, i18n)}
                        </span>
                        <Dropdown
                          align="end"
                          items={tileMenuItems(tile)}
                          onSelect={(action) => activateTileMenu(tile, action)}
                          triggerAriaLabel={`${tile.item.displayName}: ${i18n.t('uiCopy.plugin.moreActions')}`}
                          trigger={(
                            <button
                              type="button"
                              data-plugin-panel-tile-menu={tile.item.inventoryKey}
                              class="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-70 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              title={i18n.t('uiCopy.plugin.moreActions')}
                            >
                              <MoreHorizontal class="h-4 w-4" />
                            </button>
                          )}
                        />
                      </div>
                    </li>
                  )}
                </For>
              </ul>

              <Show when={!props.model.loading && pluginTiles().length === 0}>
                <div class="flex min-h-40 flex-col items-center justify-center text-center">
                  <Package class="h-7 w-7 text-muted-foreground" />
                  <p class="mt-3 max-w-sm text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.noInstalled')}</p>
                </div>
              </Show>
              <Show when={!props.model.loading && pluginTiles().length > 0 && visibleTiles().length === 0}>
                <div class="flex min-h-40 flex-col items-center justify-center text-center">
                  <Search class="h-7 w-7 text-muted-foreground" />
                  <p class="mt-3 text-sm font-medium">{i18n.t('uiCopy.plugin.launcherNoResults')}</p>
                  <button
                    type="button"
                    class="mt-3 min-h-[44px] cursor-pointer rounded-md border px-3 text-xs font-semibold hover:bg-muted"
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
                  <div class="min-w-0 text-xs text-muted-foreground">
                    {i18n.t('uiCopy.plugin.launcherSummary', { count: pluginTiles().length, attention: attentionCount() })}
                  </div>
                  <button
                    type="button"
                    data-plugin-panel-tile="plugin-center"
                    class="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      class={cn(
        'h-11 min-w-11 shrink-0 cursor-pointer rounded-md border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:min-w-0',
        props.id === props.active ? 'border-foreground/20 bg-foreground text-background' : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={() => props.onSelect(props.id)}
    >
      {props.label}
    </button>
  );
}

function isPluginTile(tile: PluginPanelTile): tile is Extract<PluginPanelTile, { kind: 'plugin' }> {
  return tile.kind === 'plugin';
}

function PluginTileIcon(props: { item: PluginInventoryItem }) {
  const [imageFailed, setImageFailed] = createSignal(false);
  return (
    <span class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-background text-foreground shadow-sm transition-transform group-hover:-translate-y-0.5 motion-reduce:transform-none motion-reduce:transition-none">
      <Show when={props.item.iconURL && !imageFailed()} fallback={(
        props.item.iconFallback === 'containers'
          ? <Grid3x3 class="h-5 w-5" />
          : <Settings class="h-5 w-5" />
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

function normalizeSearchText(value: string, locale: string): string {
  return value.normalize('NFKC').toLocaleLowerCase(locale).trim();
}

function pluginSearchText(item: PluginInventoryItem, i18n: I18nHelpers, locale: string): string {
  return normalizeSearchText([
    item.displayName,
    item.description,
    item.publisher,
    item.pluginID,
    categoryLabel(item.category, i18n),
    item.searchAliasesKey ? i18n.t(item.searchAliasesKey) : '',
    ...item.searchKeywords,
  ].join(' '), locale);
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
  switch (item.lifecycleState) {
    case 'enabled': return i18n.t('common.status.ready');
    case 'disabled': return i18n.t('uiCopy.plugin.disabled');
    case 'not_installed': return i18n.t('uiCopy.plugin.available');
    case 'update_available': return i18n.t('uiCopy.plugin.update');
    case 'needs_attention': return i18n.t('uiCopy.plugin.needsAttention');
    case 'installed': return i18n.t('uiCopy.plugin.installed');
    default: return i18n.t('uiCopy.plugin.unavailable');
  }
}

function statusClass(item: PluginInventoryItem): string {
  if (item.lifecycleState === 'enabled') return 'text-[var(--redeven-status-success-foreground)]';
  if (item.lifecycleState === 'needs_attention' || item.lifecycleState === 'update_available') {
    return 'text-[var(--redeven-status-warning-foreground)]';
  }
  return 'text-muted-foreground';
}
