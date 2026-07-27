import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn, createUIFirstSelection } from '@floegence/floe-webapp-core';
import { AlertTriangle, ArrowLeft, CheckCircle, Download, Grid3x3, MoreHorizontal, RefreshIcon, Search, Settings, Shield, X } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog, Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import { buildPluginCenterModel } from './pluginInventoryProjection';
import { useI18n, type I18nHelpers } from '../i18n';
import type {
  ExternalPluginCommitResult,
  ExternalPluginInspection,
  ExternalPluginInspectionRequest,
  ExternalPluginSourcePreset,
  PluginCenterTab,
  PluginInventoryItem,
  PluginInventoryProjection,
  PluginLifecycleCommand,
  PluginLifecycleState,
  PluginPresentationCategory,
  PluginTrustBadge,
} from './pluginTypes';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';
import { ExternalPluginInstallDialog } from './ExternalPluginInstallDialog';
import { PLUGIN_MOBILE_TOUCH_TARGET_CLASS, presentPlugin, type PluginPrimaryAction } from './pluginPresentation';

export type PluginCenterViewProps = {
  projection: PluginInventoryProjection;
  loading: boolean;
  error?: unknown;
  selectedInventoryKey?: string;
  focusRequest?: number;
  canManagePlugins: boolean;
  canOpenPluginSurfaces: boolean;
  onClose?: () => void;
  onRefresh: () => Promise<unknown> | unknown;
  onCommand: (command: PluginLifecycleCommand, signal: AbortSignal) => Promise<unknown> | unknown;
  onInspectExternal?: (request: ExternalPluginInspectionRequest, signal: AbortSignal) => Promise<ExternalPluginInspection>;
  onCommitExternal?: (inspection: ExternalPluginInspection, signal: AbortSignal) => Promise<ExternalPluginCommitResult>;
};

type PluginSourceFilter = 'all' | 'official' | 'external';
type PluginTrustFilter = 'all' | PluginTrustBadge;
type PluginLifecycleFilter = 'all' | Exclude<PluginLifecycleState, 'installed'>;

export function PluginCenterView(props: PluginCenterViewProps): JSX.Element {
  const i18n = useI18n();
  const [activeTab, setActiveTab] = createSignal<PluginCenterTab>(initialTabForProjection(props.projection));
  const [initialTabResolved, setInitialTabResolved] = createSignal(Boolean(props.projection));
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<PluginPresentationCategory | 'all'>('all');
  const [sourceFilter, setSourceFilter] = createSignal<PluginSourceFilter>('all');
  const [trustFilter, setTrustFilter] = createSignal<PluginTrustFilter>('all');
  const [lifecycleFilter, setLifecycleFilter] = createSignal<PluginLifecycleFilter>('all');
  const [selectedInventoryKey, setSelectedInventoryKey] = createSignal<string | undefined>();
  const [protectedSelectionInventoryKey, setProtectedSelectionInventoryKey] = createSignal<string | undefined>();
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [commandPending, setCommandPending] = createSignal(false);
  const [uninstallChoiceFor, setUninstallChoiceFor] = createSignal<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = createSignal(Boolean(props.selectedInventoryKey));
  const [externalDialogOpen, setExternalDialogOpen] = createSignal(false);
  const [externalUpdateItem, setExternalUpdateItem] = createSignal<PluginInventoryItem | undefined>();
  const [externalSourcePreset, setExternalSourcePreset] = createSignal<ExternalPluginSourcePreset | undefined>();
  const [permissionsFocusRequest, setPermissionsFocusRequest] = createSignal<{ id: number; inventoryKey: string }>();
  const [permissionsFocusTarget, setPermissionsFocusTarget] = createSignal<HTMLElement>();
  let commandController: AbortController | undefined;
  let pluginCenterPanelRef: HTMLDivElement | undefined;
  let pluginCenterSearchRef: HTMLInputElement | undefined;
  let mobileDetailBackButton: HTMLButtonElement | undefined;
  let detailHeadingRef: HTMLHeadingElement | undefined;
  let mobileDetailReturnTarget: HTMLButtonElement | undefined;
  let handledDetailFocusRequest: number | undefined;
  let handledSelectionInventoryKey: string | undefined;
  let handledSelectionFocusRequest: number | undefined;
  let nextPermissionsFocusRequest = 0;
  let handledPermissionsFocusRequest = 0;
  let deferredPermissionsFocusFrame: number | undefined;
  let deferredPermissionsFocusTimer: number | undefined;

  const cancelDeferredPermissionsFocus = () => {
    if (deferredPermissionsFocusFrame !== undefined) {
      window.cancelAnimationFrame(deferredPermissionsFocusFrame);
      deferredPermissionsFocusFrame = undefined;
    }
    if (deferredPermissionsFocusTimer !== undefined) {
      window.clearTimeout(deferredPermissionsFocusTimer);
      deferredPermissionsFocusTimer = undefined;
    }
  };

  onCleanup(() => {
    commandController?.abort('Plugin Center disposed');
    cancelDeferredPermissionsFocus();
  });

  const projection = createMemo(() => props.projection);
  const model = createMemo(() => buildPluginCenterModel(projection(), activeTab()));
  const allItems = createMemo(() => projection().items);
  const tabItems = createMemo(() => {
    switch (activeTab()) {
      case 'discover':
        return model().discover;
      case 'installed':
        return model().installed;
      case 'updates':
        return model().updates;
      default:
        return [];
    }
  });
  const visibleItems = createMemo(() => filterItems(tabItems(), {
    query: query(),
    category: category(),
    source: sourceFilter(),
    trust: trustFilter(),
    lifecycle: lifecycleFilter(),
  }, i18n, i18n.locale()));
  const loading = createMemo(() => props.loading);
  const errorMessage = createMemo(() => messageFromUnknown(props.error ?? commandError()));
  const canManage = createMemo(() => props.canManagePlugins);
  const canOpenSurfaces = createMemo(() => props.canOpenPluginSurfaces);
  const tabSelection = createUIFirstSelection<PluginCenterTab>({
    committed: activeTab,
    commit: setActiveTab,
    onEvent: createUIPresentationEventRecorder({
      surface: 'plugin-center',
      source: 'tab',
    }),
  });

  createEffect(() => {
    const focusRequest = props.focusRequest;
    const requestedKey = props.selectedInventoryKey;
    if (!requestedKey) return;
    if (requestedKey === handledSelectionInventoryKey && focusRequest === handledSelectionFocusRequest) return;
    const requestedItem = allItems().find((item) => item.inventoryKey === requestedKey);
    if (requestedItem) {
      handledSelectionInventoryKey = requestedKey;
      handledSelectionFocusRequest = focusRequest;
      setSelectedInventoryKey(requestedItem.inventoryKey);
      tabSelection.commitNow(tabForItem(requestedItem));
      if (focusRequest !== undefined && focusRequest !== handledDetailFocusRequest) {
        handledDetailFocusRequest = focusRequest;
        setMobileDetailOpen(true);
        queueMicrotask(() => {
          mobileDetailReturnTarget = Array.from(
            pluginCenterPanelRef?.querySelectorAll<HTMLButtonElement>('[data-plugin-center-item]') ?? [],
          ).find((button) => button.dataset.pluginCenterItem === requestedItem.inventoryKey);
          if (window.innerWidth < 640) mobileDetailBackButton?.focus({ preventScroll: true });
          else detailHeadingRef?.focus({ preventScroll: true });
        });
      }
    }
  });

  createEffect(() => {
    if (initialTabResolved() || loading()) return;
    const next = model();
    if (next.installed.length === 0 && next.discover.length > 0) {
      tabSelection.commitNow('discover');
    }
    setInitialTabResolved(true);
  });

  createEffect(() => {
    const request = permissionsFocusRequest();
    const target = permissionsFocusTarget();
    const selectedKey = selectedInventoryKey();
    const dialogOpen = externalDialogOpen();
    cancelDeferredPermissionsFocus();
    if (!request
      || request.id <= handledPermissionsFocusRequest
      || request.inventoryKey !== selectedKey
      || dialogOpen
      || !target?.isConnected) return;
    deferredPermissionsFocusFrame = window.requestAnimationFrame(() => {
      deferredPermissionsFocusFrame = undefined;
      deferredPermissionsFocusTimer = window.setTimeout(() => {
        deferredPermissionsFocusTimer = undefined;
        if (permissionsFocusRequest() !== request
          || request.inventoryKey !== selectedInventoryKey()
          || externalDialogOpen()
          || permissionsFocusTarget() !== target
          || !target.isConnected) return;
        target.focus({ preventScroll: true });
        handledPermissionsFocusRequest = request.id;
      }, 0);
    });
  });

  createEffect(() => {
    const currentKey = selectedInventoryKey();
    if (!currentKey) return;
    if (!allItems().some((item) => item.inventoryKey === currentKey)) {
      setProtectedSelectionInventoryKey(undefined);
      setSelectedInventoryKey(undefined);
      setMobileDetailOpen(false);
      return;
    }
    if (props.selectedInventoryKey === currentKey) return;
    if (protectedSelectionInventoryKey() === currentKey) return;
    if (!visibleItems().some((item) => item.inventoryKey === currentKey)) {
      setSelectedInventoryKey(undefined);
      setMobileDetailOpen(false);
    }
  });

  const selectedItem = createMemo(() => allItems().find((item) => item.inventoryKey === selectedInventoryKey()));
  const filtersActive = createMemo(() => query() !== ''
    || category() !== 'all'
    || sourceFilter() !== 'all'
    || trustFilter() !== 'all'
    || lifecycleFilter() !== 'all');

  const openExternalDialog = (item?: PluginInventoryItem, sourcePreset?: ExternalPluginSourcePreset) => {
    setExternalUpdateItem(item);
    setExternalSourcePreset(sourcePreset);
    setExternalDialogOpen(true);
  };

  const runCommand = async (command: PluginLifecycleCommand) => {
    if (commandPending()) return;
    const controller = new AbortController();
    commandController = controller;
    setCommandPending(true);
    setCommandError(null);
    try {
      await props.onCommand(command, controller.signal);
      setUninstallChoiceFor(null);
    } catch (error) {
      setCommandError(messageFromUnknown(error));
    } finally {
      if (commandController === controller) commandController = undefined;
      setCommandPending(false);
    }
  };

  const openDetails = (inventoryKey: string, returnTarget: HTMLButtonElement) => {
    setProtectedSelectionInventoryKey(undefined);
    setSelectedInventoryKey(inventoryKey);
    mobileDetailReturnTarget = returnTarget;
    setMobileDetailOpen(true);
    if (window.innerWidth < 640) {
      queueMicrotask(() => mobileDetailBackButton?.focus({ preventScroll: true }));
    }
  };

  const closeDetails = () => {
    const returnTarget = mobileDetailReturnTarget;
    mobileDetailReturnTarget = undefined;
    setProtectedSelectionInventoryKey(undefined);
    setSelectedInventoryKey(undefined);
    setMobileDetailOpen(false);
    queueMicrotask(() => {
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
      else if (pluginCenterSearchRef?.isConnected) pluginCenterSearchRef.focus({ preventScroll: true });
      else pluginCenterPanelRef?.focus({ preventScroll: true });
    });
  };

  const clearDetailSelection = () => {
    mobileDetailReturnTarget = undefined;
    setProtectedSelectionInventoryKey(undefined);
    setSelectedInventoryKey(undefined);
    setMobileDetailOpen(false);
  };

  const updateQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    clearDetailSelection();
  };

  const selectTab = (tab: PluginCenterTab) => {
    clearDetailSelection();
    tabSelection.request(tab);
  };

  const refreshInventory = async () => {
    setCommandError(null);
    try {
      await props.onRefresh();
    } catch (error) {
      setCommandError(messageFromUnknown(error));
    }
  };

  return (
    <PluginCenterShell
      query={query()}
      loading={loading() || commandPending()}
      activeTab={tabSelection.visual()}
      installedCount={model().installed.length}
      discoverCount={model().discover.length}
      updatesCount={model().updates.length}
      onQueryInput={updateQuery}
      searchRef={(element) => { pluginCenterSearchRef = element; }}
      category={category()}
      onCategorySelect={(next) => {
        setCategory(next);
        clearDetailSelection();
      }}
      sourceFilter={sourceFilter()}
      trustFilter={trustFilter()}
      lifecycleFilter={lifecycleFilter()}
      onSourceFilter={(next) => { setSourceFilter(next); clearDetailSelection(); }}
      onTrustFilter={(next) => { setTrustFilter(next); clearDetailSelection(); }}
      onLifecycleFilter={(next) => { setLifecycleFilter(next); clearDetailSelection(); }}
      onRefresh={() => void refreshInventory()}
      onTabSelect={selectTab}
      canManage={canManage()}
      focusRequest={props.selectedInventoryKey ? undefined : props.focusRequest}
      onInstallExternal={() => openExternalDialog()}
      onClose={props.onClose}
    >
      <Show when={errorMessage()}>
        <div role="alert" data-plugin-center-error class="flex flex-wrap items-center gap-3 border-b border-destructive bg-background px-4 py-3 text-sm text-destructive">
          <AlertTriangle class="h-4 w-4 shrink-0" />
          <div class="min-w-0 flex-1">
            <div>{errorMessage()}</div>
            <Show when={!canManage()}>
              <div class="mt-1 text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.permissionsAdminRequired')}</div>
            </Show>
          </div>
          <button
            type="button"
            class="min-h-[44px] cursor-pointer rounded-md border border-destructive px-3 text-xs font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
            disabled={loading()}
            onClick={() => void refreshInventory()}
          >
            {i18n.t('common.actions.retry')}
          </button>
        </div>
      </Show>
      <div
        ref={pluginCenterPanelRef}
        id="plugin-center-panel"
        role="tabpanel"
        tabIndex={-1}
        aria-labelledby={`plugin-center-tab-${activeTab()}`}
        data-plugin-center-shell
        class="flex min-h-0 flex-1 flex-col sm:flex-row"
      >
        <div
          data-plugin-center-master
          class={cn(
            'min-h-0 w-full flex-col border-b sm:border-b-0 sm:border-r',
            selectedItem()
              ? activeTab() === 'discover' ? 'sm:w-[min(560px,58vw)]' : 'sm:w-[280px] lg:w-[min(340px,42vw)]'
              : 'sm:w-full sm:border-r-0',
            mobileDetailOpen() ? 'hidden sm:flex' : 'flex',
          )}
        >
          <div
            data-plugin-center-list
            class={cn(
              'min-h-0 flex-1 overflow-y-auto',
              activeTab() === 'discover' && 'grid auto-rows-min grid-cols-1 gap-3 p-4 md:grid-cols-2',
              activeTab() === 'discover' && !selectedItem() && 'lg:grid-cols-3 xl:grid-cols-4',
            )}
          >
            <Show when={loading()}>
              <div class="border-b px-4 py-3 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.loadingOfficial')}</div>
            </Show>
            <For each={visibleItems()}>
              {(item) => (
                <button
                  type="button"
                  data-plugin-center-item={item.inventoryKey}
                  aria-current={selectedItem()?.inventoryKey === item.inventoryKey ? 'true' : undefined}
                  class={cn(
                    'flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    activeTab() === 'discover' ? 'min-h-36 rounded-md border bg-background' : 'border-b',
                    selectedItem()?.inventoryKey === item.inventoryKey
                      ? activeTab() === 'discover' ? 'border-primary bg-primary/5' : 'bg-primary/10 shadow-[inset_3px_0_0_var(--primary)]'
                      : 'bg-background',
                  )}
                  onClick={(event) => openDetails(item.inventoryKey, event.currentTarget)}
                >
                  <PluginIcon item={item} class="mt-0.5" />
                  <span class="min-w-0 flex-1">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-sm font-semibold text-foreground">{item.displayName}</span>
                      <TrustBadge item={item} />
                    </span>
                    <span class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</span>
                    <span class="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span class={statusPillClass(item)}>{statusLabel(item, i18n)}</span>
                      <Show when={item.version}>
                        <span class="text-muted-foreground">v{item.version}</span>
                      </Show>
                    </span>
                  </span>
                </button>
              )}
            </For>
            <Show when={!loading() && visibleItems().length === 0}>
              <div class="col-span-full flex min-h-52 flex-col items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground">
                <Search class="h-6 w-6" />
                <p class="mt-3">{i18n.t('uiCopy.plugin.emptyView')}</p>
                <Show when={filtersActive()}>
                  <button
                    type="button"
                    class="mt-3 min-h-[44px] cursor-pointer rounded-md border px-3 text-xs font-semibold text-foreground hover:bg-muted"
                    onClick={() => {
                      setQuery('');
                      setCategory('all');
                      setSourceFilter('all');
                      setTrustFilter('all');
                      setLifecycleFilter('all');
                      clearDetailSelection();
                    }}
                  >
                    {i18n.t('uiCopy.plugin.clearFilters')}
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        </div>
        <Show when={selectedItem()}>
          {(item) => (
            <PluginCenterDetails
              item={item()}
              mobileOpen={mobileDetailOpen()}
              mobileBackRef={(element) => { mobileDetailBackButton = element; }}
              detailHeadingRef={(element) => { detailHeadingRef = element; }}
              permissionsRef={setPermissionsFocusTarget}
              onMobileBack={closeDetails}
              canManage={canManage()}
              canOpenSurfaces={canOpenSurfaces()}
              commandPending={commandPending()}
              uninstallChoiceFor={uninstallChoiceFor()}
              onCommand={(command) => void runCommand(command)}
              onAskUninstall={setUninstallChoiceFor}
              onExternalInstall={(selected) => openExternalDialog(undefined, selected.officialCatalog?.distribution.installSource)}
              onExternalUpdate={(selected) => openExternalDialog(selected, selected.officialCatalog?.distribution.installSource)}
            />
          )}
        </Show>
      </div>
      <ExternalPluginInstallDialog
        open={externalDialogOpen()}
        updateItem={externalUpdateItem()}
        sourcePreset={externalSourcePreset()}
        onOpenChange={(open) => {
          setExternalDialogOpen(open);
          if (!open) {
            setExternalUpdateItem(undefined);
            setExternalSourcePreset(undefined);
          }
        }}
        onInspect={props.onInspectExternal ?? (async () => {
          throw new Error(i18n.t('uiCopy.plugin.external.inspectFailed'));
        })}
        onCommit={props.onCommitExternal ?? (async () => {
          throw new Error(i18n.t('uiCopy.plugin.external.commitFailed'));
        })}
        onCommitted={async (result) => {
          await props.onRefresh();
          const inventoryKey = `instance:${result.plugin.plugin_instance_id}`;
          setProtectedSelectionInventoryKey(inventoryKey);
          setSelectedInventoryKey(inventoryKey);
          tabSelection.commitNow('installed');
        }}
        onViewPermissions={(result) => {
          const inventoryKey = `instance:${result.plugin.plugin_instance_id}`;
          setProtectedSelectionInventoryKey(inventoryKey);
          setSelectedInventoryKey(inventoryKey);
          tabSelection.commitNow('installed');
          setMobileDetailOpen(true);
          nextPermissionsFocusRequest += 1;
          setPermissionsFocusRequest({ id: nextPermissionsFocusRequest, inventoryKey });
        }}
      />
    </PluginCenterShell>
  );
}

export function PluginCenterShell(props: {
  query: string;
  searchRef?: (element: HTMLInputElement) => void;
  category: PluginPresentationCategory | 'all';
  sourceFilter: PluginSourceFilter;
  trustFilter: PluginTrustFilter;
  lifecycleFilter: PluginLifecycleFilter;
  loading: boolean;
  activeTab: PluginCenterTab;
  installedCount: number;
  discoverCount: number;
  updatesCount: number;
  onQueryInput: (query: string) => void;
  onCategorySelect: (category: PluginPresentationCategory | 'all') => void;
  onSourceFilter: (source: PluginSourceFilter) => void;
  onTrustFilter: (trust: PluginTrustFilter) => void;
  onLifecycleFilter: (lifecycle: PluginLifecycleFilter) => void;
  onRefresh: () => void;
  onTabSelect: (tab: PluginCenterTab) => void;
  canManage: boolean;
  focusRequest?: number;
  onInstallExternal: () => void;
  onClose?: () => void;
  children: JSX.Element;
}): JSX.Element {
  const i18n = useI18n();
  let rootRef: HTMLElement | undefined;
  let handledFocusRequest = 0;
  createEffect(() => {
    const request = props.focusRequest ?? 0;
    if (request <= handledFocusRequest) return;
    handledFocusRequest = request;
    queueMicrotask(() => rootRef?.focus({ preventScroll: true }));
  });
  const administrationItems = (): DropdownItem[] => [{
    id: 'install-external',
    label: i18n.t('uiCopy.plugin.installFromSource'),
    disabled: !props.canManage || props.loading,
  }];
  return (
    <section ref={rootRef} data-plugin-center-view tabIndex={-1} class="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div class="shrink-0 border-b bg-background px-4 py-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h1 class="truncate text-lg font-semibold">{i18n.t('uiCopy.plugin.centerTitle')}</h1>
              <span class="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">{i18n.t('uiCopy.plugin.openSources')}</span>
            </div>
            <p class="mt-1 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.catalogDescription')}</p>
          </div>
          <div class="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:max-w-[min(760px,65vw)] lg:justify-end">
            <label class="relative order-first block w-full min-w-0 sm:order-none sm:min-w-48 sm:flex-1 lg:w-[min(320px,52vw)] lg:flex-none">
              <span class="sr-only">{i18n.t('uiCopy.plugin.searchPlaceholder')}</span>
              <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={props.searchRef}
                data-plugin-center-search
                type="search"
                value={props.query}
                onInput={(event) => props.onQueryInput(event.currentTarget.value)}
                placeholder={i18n.t('uiCopy.plugin.searchPlaceholder')}
                class="h-[44px] w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20 sm:h-8"
              />
            </label>
            <Show when={props.canManage}>
              <Dropdown
                align="end"
                disabled={props.loading}
                items={administrationItems()}
                onSelect={(id) => {
                  if (id === 'install-external') props.onInstallExternal();
                }}
                triggerAriaLabel={i18n.t('uiCopy.plugin.moreActions')}
                trigger={(
                  <button
                    type="button"
                    data-plugin-center-install-external
                    class="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-8"
                    disabled={props.loading}
                    title={i18n.t('uiCopy.plugin.moreActions')}
                  >
                    <MoreHorizontal class="h-3.5 w-3.5" />
                  </button>
                )}
              />
            </Show>
            <button
              type="button"
              data-plugin-center-refresh
              class="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-8 sm:w-8"
              aria-label={i18n.t('uiCopy.plugin.refreshOfficial')}
              disabled={props.loading}
              onClick={props.onRefresh}
            >
              <RefreshIcon class="h-3.5 w-3.5" />
            </button>
            <Show when={props.onClose}>
              <button
                type="button"
                class="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground sm:h-8 sm:w-8"
                aria-label={i18n.t('uiCopy.plugin.closeCenter')}
                onClick={() => props.onClose?.()}
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </Show>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-1" role="tablist" aria-label={i18n.t('uiCopy.plugin.centerTitle')}>
          <TabButton id="discover" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.discoverCount', { count: props.discoverCount })} />
          <TabButton id="installed" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.installedCount', { count: props.installedCount })} />
          <TabButton id="updates" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.updatesCount', { count: props.updatesCount })} />
        </div>
        <div class="mt-2 flex gap-1 overflow-x-auto pb-0.5" role="group" aria-label={i18n.t('uiCopy.plugin.categories')}>
          <CenterCategoryButton id="all" active={props.category} label={i18n.t('uiCopy.plugin.categoryAll')} onSelect={props.onCategorySelect} />
          <CenterCategoryButton id="development" active={props.category} label={i18n.t('uiCopy.plugin.categoryDevelopment')} onSelect={props.onCategorySelect} />
          <CenterCategoryButton id="infrastructure" active={props.category} label={i18n.t('uiCopy.plugin.categoryInfrastructure')} onSelect={props.onCategorySelect} />
          <CenterCategoryButton id="data" active={props.category} label={i18n.t('uiCopy.plugin.categoryData')} onSelect={props.onCategorySelect} />
          <CenterCategoryButton id="collaboration" active={props.category} label={i18n.t('uiCopy.plugin.categoryCollaboration')} onSelect={props.onCategorySelect} />
          <CenterCategoryButton id="productivity" active={props.category} label={i18n.t('uiCopy.plugin.categoryProductivity')} onSelect={props.onCategorySelect} />
          <CenterCategoryButton id="other" active={props.category} label={i18n.t('uiCopy.plugin.categoryOther')} onSelect={props.onCategorySelect} />
        </div>
        <div class="mt-2 flex gap-2 overflow-x-auto pb-0.5" data-plugin-center-filters>
          <CenterFilterMenu
            id="source"
            value={props.sourceFilter}
            onSelect={(value) => props.onSourceFilter(value as PluginSourceFilter)}
            items={[
              { id: 'all', label: i18n.t('uiCopy.plugin.external.source') },
              { id: 'official', label: i18n.t('uiCopy.plugin.officialSource') },
              { id: 'external', label: i18n.t('uiCopy.plugin.externalPlugin') },
            ]}
          />
          <CenterFilterMenu
            id="trust"
            value={props.trustFilter}
            onSelect={(value) => props.onTrustFilter(value as PluginTrustFilter)}
            items={[
              { id: 'all', label: i18n.t('uiCopy.plugin.trust') },
              { id: 'official', label: i18n.t('uiCopy.plugin.official') },
              { id: 'verified', label: i18n.t('uiCopy.plugin.verified') },
              { id: 'community', label: i18n.t('uiCopy.plugin.community') },
              { id: 'unsigned', label: i18n.t('uiCopy.plugin.unsigned') },
              { id: 'blocked', label: i18n.t('uiCopy.plugin.blocked') },
              { id: 'revoked', label: i18n.t('uiCopy.plugin.revoked') },
              { id: 'unavailable', label: i18n.t('uiCopy.plugin.unavailable') },
            ]}
          />
          <CenterFilterMenu
            id="lifecycle"
            value={props.lifecycleFilter}
            onSelect={(value) => props.onLifecycleFilter(value as PluginLifecycleFilter)}
            items={[
              { id: 'all', label: i18n.t('uiCopy.plugin.lifecycle') },
              { id: 'enabled', label: i18n.t('uiCopy.plugin.enabled') },
              { id: 'disabled', label: i18n.t('uiCopy.plugin.disabled') },
              { id: 'needs_attention', label: i18n.t('uiCopy.plugin.needsAttention') },
              { id: 'update_available', label: i18n.t('uiCopy.plugin.updateAvailable') },
              { id: 'not_installed', label: i18n.t('uiCopy.plugin.notInstalled') },
            ]}
          />
        </div>
      </div>
      {props.children}
    </section>
  );
}

export function PluginCenterDetails(props: {
  item?: PluginInventoryItem;
  mobileOpen?: boolean;
  mobileBackRef?: (element: HTMLButtonElement) => void;
  detailHeadingRef?: (element: HTMLHeadingElement) => void;
  permissionsRef?: (element: HTMLElement) => void;
  onMobileBack?: () => void;
  canManage: boolean;
  canOpenSurfaces: boolean;
  commandPending: boolean;
  uninstallChoiceFor: string | null;
  onCommand: (command: PluginLifecycleCommand) => void;
  onAskUninstall: (pluginInstanceID: string) => void;
  onExternalInstall: (item: PluginInventoryItem) => void;
  onExternalUpdate: (item: PluginInventoryItem) => void;
}): JSX.Element {
  const i18n = useI18n();
  return (
    <aside
      data-plugin-center-details
      class={cn('min-h-0 flex-1 overflow-y-auto', props.mobileOpen === false ? 'hidden sm:block' : 'block')}
    >
      <Show
        when={props.item}
        fallback={<div class="px-5 py-10 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.selectOfficial')}</div>}
      >
        {(item) => (
          <div class="space-y-6 px-4 py-4 sm:px-6 sm:py-5">
            <Button
              ref={props.mobileBackRef}
              data-plugin-center-mobile-back
              size="sm"
              variant="ghost"
              icon={ArrowLeft}
              class="min-h-[44px]"
              onClick={props.onMobileBack}
            >
              {i18n.t('uiCopy.plugin.backToList')}
            </Button>
            <div class="flex items-start gap-3">
              <PluginIcon item={item()} size="lg" />
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 ref={props.detailHeadingRef} tabIndex={-1} data-plugin-center-detail-heading class="truncate text-xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item().displayName}</h2>
                  <TrustBadge item={item()} />
                  <span class={statusPillClass(item())}>{statusLabel(item(), i18n)}</span>
                </div>
                <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{item().description}</p>
              </div>
            </div>

            <PluginActions
              item={item()}
              canManage={props.canManage}
              canOpenSurfaces={props.canOpenSurfaces}
              commandPending={props.commandPending}
              onCommand={props.onCommand}
              onAskUninstall={props.onAskUninstall}
              onExternalInstall={props.onExternalInstall}
              onExternalUpdate={props.onExternalUpdate}
            />

            <PluginIssueDetails item={item()} />

            <PluginPermissionInventory
              item={item()}
              canManage={props.canManage}
              commandPending={props.commandPending}
              onCommand={props.onCommand}
              focusTargetRef={props.permissionsRef}
            />

            <details class="border-t pt-4" data-plugin-technical-details>
              <summary tabIndex={0} class="cursor-pointer text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{i18n.t('uiCopy.plugin.technicalDetails')}</summary>
              <div class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <DetailStat label={i18n.t('uiCopy.plugin.publisher')} value={item().publisher} />
                <DetailStat label={i18n.t('uiCopy.plugin.installedVersion')} value={item().version ?? i18n.t('uiCopy.plugin.notInstalled')} />
                <DetailStat label={i18n.t('uiCopy.plugin.stableVersion')} value={item().officialCatalog?.stableVersion ?? '-'} />
                <DetailStat label={i18n.t('uiCopy.plugin.minimumRedeven')} value={item().officialCatalog?.minRedevenVersion ?? '-'} />
                <DetailStat label={i18n.t('uiCopy.plugin.minimumReDevPlugin')} value={item().officialCatalog?.minReDevPluginVersion ?? '-'} />
                <DetailStat label={i18n.t('uiCopy.plugin.trust')} value={trustLabel(item(), i18n)} />
              </div>
              <code class="mt-4 block break-all text-xs text-muted-foreground">{item().pluginID}</code>
            </details>
            <PluginUninstallDialog
              item={item()}
              open={props.uninstallChoiceFor === item().pluginInstanceID}
              pending={props.commandPending}
              onClose={() => props.onAskUninstall('')}
              onCommand={props.onCommand}
            />
          </div>
        )}
      </Show>
    </aside>
  );
}

function PluginPermissionInventory(props: {
  item: PluginInventoryItem;
  canManage: boolean;
  commandPending: boolean;
  onCommand: (command: PluginLifecycleCommand) => void;
  focusTargetRef?: (element: HTMLElement) => void;
}): JSX.Element {
  const i18n = useI18n();
  const [confirmation, setConfirmation] = createSignal<{ permissionID: string; grant: boolean } | null>(null);
  const authorization = () => props.item.authorization;

  const submit = (permissionID: string, grant: boolean) => {
    const inventory = authorization();
    const pluginInstanceID = props.item.pluginInstanceID;
    if (!inventory || !pluginInstanceID) return;
    const revisions = inventory.revisions;
    props.onCommand({
      type: grant ? 'grant_permission' : 'revoke_permission',
      pluginInstanceID,
      permissionID,
      expectedPolicyRevision: revisions.policyRevision,
      expectedManagementRevision: revisions.managementRevision,
      expectedRevokeEpoch: revisions.revokeEpoch,
    });
    setConfirmation(null);
  };

  return (
    <Show when={authorization()}>
      {(inventory) => (
        <section ref={props.focusTargetRef} data-plugin-permissions tabIndex={-1}>
          <div class="flex items-start justify-between gap-3 border-b pb-2">
            <div>
              <h3 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Shield class="h-3.5 w-3.5" />
                {i18n.t('uiCopy.plugin.permissionsTitle', { plugin: props.item.displayName })}
              </h3>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {props.canManage
                  ? i18n.t('uiCopy.plugin.permissionsDescription', { plugin: props.item.displayName })
                  : i18n.t('uiCopy.plugin.permissionsAdminRequired')}
              </p>
            </div>
            <Show when={inventory().policy}>
              <span class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {i18n.t('uiCopy.plugin.policyConfigured')}
              </span>
            </Show>
          </div>
          <div class="divide-y">
            <For each={inventory().permissions}>
              {(permission) => {
                const effective = () => permission.granted && !permission.deniedByGrant && !permission.grantBlockedByPolicy;
                const granted = () => permission.granted && !permission.deniedByGrant;
                const disabled = () => props.commandPending || (permission.grantBlockedByPolicy && !permission.granted);
                const permissionName = () => permission.group === 'other'
                  ? humanizePermissionIdentifier(permission.permissionID)
                  : permissionLabel(permission.group, i18n);
                const disabledReason = () => permission.grantBlockedByPolicy && !permission.granted
                  ? i18n.t('uiCopy.plugin.permissionDisabledByPolicy')
                  : props.commandPending
                    ? i18n.t('uiCopy.plugin.permissionChangeInProgress')
                    : undefined;
                return (
                  <div class="py-3" data-plugin-permission={permission.permissionID}>
                    <div class="flex items-start justify-between gap-4">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <span data-plugin-permission-name class="text-sm font-medium">{permissionName()}</span>
                          <Show when={permission.requiredToOpen}>
                            <span class="rounded-full bg-[var(--redeven-status-warning-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--redeven-status-warning-foreground)]">
                              {i18n.t('uiCopy.plugin.requiredToOpen')}
                            </span>
                          </Show>
                          <Show when={!permission.requiredToOpen}>
                            <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {i18n.t('uiCopy.plugin.optionalPermission')}
                            </span>
                          </Show>
                          <Show when={permission.blockedByPolicy}>
                            <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {i18n.t('uiCopy.plugin.managedByPolicy')}
                            </span>
                          </Show>
                          <span class="rounded-full border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {effective() ? i18n.t('uiCopy.plugin.permissionGranted') : i18n.t('uiCopy.plugin.permissionNotGranted')}
                          </span>
                        </div>
                        <p class="mt-1 text-xs leading-5 text-muted-foreground">{permissionDescription(permission.group, i18n)}</p>
                        <Show when={disabledReason()}>
                          {(reason) => <p class="mt-1 text-xs font-medium text-[var(--redeven-status-warning-foreground)]">{reason()}</p>}
                        </Show>
                        <details class="mt-1 text-xs text-muted-foreground" data-plugin-permission-technical-details>
                          <summary class="min-h-8 cursor-pointer py-1 font-medium text-foreground">{i18n.t('uiCopy.plugin.technicalDetails')}</summary>
                          <code class="mt-1 block break-all text-[11px]">{permission.permissionID}</code>
                          <Show when={permission.methods.length > 0}>
                            <div class="mt-2">
                              <div class="text-[10px] font-semibold uppercase">{i18n.t('uiCopy.plugin.external.methods')}</div>
                              <For each={permission.methods}>
                                {(method) => <code class="mt-1 block break-all text-[11px]">{method}</code>}
                              </For>
                            </div>
                          </Show>
                        </details>
                      </div>
                      <Show
                        when={props.canManage}
                        fallback={<span class="shrink-0 text-xs font-medium text-muted-foreground">{effective() ? i18n.t('uiCopy.plugin.permissionGranted') : i18n.t('uiCopy.plugin.permissionNotGranted')}</span>}
                      >
                        <button
                          type="button"
                          role="switch"
                          aria-checked={granted()}
                          data-state={granted() ? 'checked' : 'unchecked'}
                          disabled={disabled()}
                          aria-label={i18n.t('uiCopy.plugin.permissionToggleLabel', { permission: permissionName() })}
                          class={cn(
                            'relative mt-0.5 inline-flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-6 sm:w-10',
                          )}
                          onClick={() => {
                            setConfirmation({ permissionID: permission.permissionID, grant: !granted() });
                          }}
                        >
                          <span aria-hidden="true" class={cn('relative inline-flex h-6 w-10 items-center rounded-full border transition', granted() ? 'border-primary bg-primary' : 'bg-muted')}>
                            <span
                              class={cn(
                                'absolute left-1 h-4 w-4 rounded-full bg-background shadow transition-transform',
                                granted() && 'translate-x-4',
                              )}
                            />
                          </span>
                        </button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
          <Show when={confirmation()}>
            {(pending) => {
              const permission = () => inventory().permissions.find((item) => item.permissionID === pending().permissionID);
              const permissionName = () => {
                const current = permission();
                return !current || current.group === 'other'
                  ? humanizePermissionIdentifier(pending().permissionID)
                  : permissionLabel(current.group, i18n);
              };
              return (
                <Dialog
                  open
                  onOpenChange={(open) => { if (!open) setConfirmation(null); }}
                  title={i18n.t('uiCopy.plugin.permissionConfirmationTitle')}
                  description={pending().grant
                    ? i18n.t('uiCopy.plugin.confirmGrantPermission', { permission: permissionName(), plugin: props.item.displayName })
                    : i18n.t('uiCopy.plugin.confirmRevokePermission', { permission: permissionName(), plugin: props.item.displayName })}
                  footer={(
                    <div class="flex w-full justify-end gap-2">
                      <button type="button" class={cn(PLUGIN_MOBILE_TOUCH_TARGET_CLASS, 'cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-muted')} onClick={() => setConfirmation(null)}>
                        {i18n.t('common.actions.cancel')}
                      </button>
                      <button type="button" class={cn(PLUGIN_MOBILE_TOUCH_TARGET_CLASS, 'cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90')} onClick={() => submit(pending().permissionID, pending().grant)}>
                        {pending().grant ? i18n.t('uiCopy.plugin.grantPermission') : i18n.t('uiCopy.plugin.revokePermission')}
                      </button>
                    </div>
                  )}
                >
                  <div class="text-sm text-muted-foreground">
                    {pending().grant
                      ? i18n.t('uiCopy.plugin.permissionGrantImpact')
                      : i18n.t('uiCopy.plugin.permissionRevokeImpact')}
                  </div>
                </Dialog>
              );
            }}
          </Show>
        </section>
      )}
    </Show>
  );
}

function PluginIssueDetails(props: { item: PluginInventoryItem }): JSX.Element {
  const i18n = useI18n();
  const action = () => presentPlugin(props.item).primaryAction;
  const visible = () => action() === 'view_runtime' || action() === 'view_trust' || action() === 'view_diagnostics';
  const external = () => props.item.externalPackage;
  const rawEvidence = () => {
    const facts = [
      props.item.attentionReason ? `attention_reason=${props.item.attentionReason}` : '',
      `trust=${props.item.trustBadge}`,
      props.item.officialCatalog ? `rollout_state=${props.item.officialCatalog.rolloutState}` : '',
      external() ? `signature_assessment=${external()!.signatureAssessment.state}` : '',
      ...(external()?.signatureAssessment.reason_codes ?? []),
      external() ? `execution_approval=${external()!.executionApproval.state}` : '',
      ...(external()?.executionApproval.reason_codes ?? []),
      ...pluginSourceEvidence(props.item),
    ];
    return facts.filter(Boolean);
  };
  const title = () => {
    switch (action()) {
      case 'view_runtime': return i18n.t('uiCopy.plugin.viewRuntimeRequirement');
      case 'view_trust': return i18n.t('uiCopy.plugin.viewTrustDetails');
      default: return i18n.t('uiCopy.plugin.viewIssue');
    }
  };
  const recovery = () => {
    switch (action()) {
      case 'view_runtime': return i18n.t('uiCopy.plugin.runtimeIssueRecovery');
      case 'view_trust': return i18n.t('uiCopy.plugin.trustIssueRecovery');
      default: return i18n.t('uiCopy.plugin.diagnosticIssueRecovery');
    }
  };
  return (
    <Show when={visible()}>
      <section
        tabIndex={-1}
        data-plugin-issue-details
        class="border-y border-[var(--redeven-status-warning-foreground)] bg-background px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div class="flex items-start gap-2">
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0 text-[var(--redeven-status-warning-foreground)]" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-semibold">{title()}</h3>
            <p class="mt-1 text-sm leading-5 text-muted-foreground">{recovery()}</p>
          </div>
        </div>
        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          <Show when={props.item.officialCatalog}>
            {(catalog) => (
              <>
                <DetailStat label={i18n.t('uiCopy.plugin.minimumRedeven')} value={catalog().minRedevenVersion} />
                <DetailStat label={i18n.t('uiCopy.plugin.minimumReDevPlugin')} value={catalog().minReDevPluginVersion} />
              </>
            )}
          </Show>
        </div>
        <details class="mt-3 text-xs" data-plugin-issue-evidence>
          <summary data-plugin-issue-evidence-summary class="cursor-pointer font-medium text-foreground">
            {i18n.t('uiCopy.plugin.technicalDetails')}
          </summary>
          <div class="mt-2 space-y-1">
            <For each={rawEvidence()}>
              {(fact) => <code class="block break-all text-[11px] text-muted-foreground">{fact}</code>}
            </For>
          </div>
        </details>
      </section>
    </Show>
  );
}

function pluginSourceEvidence(item: PluginInventoryItem): readonly string[] {
  const provenance = item.externalPackage?.sourceProvenance;
  if (!provenance) return [];
  if (provenance.kind === 'package_url') {
    return [
      `${provenance.source_origin}${provenance.source_path}`,
      ...provenance.redirect_chain.map((hop) => `${hop.origin}${hop.path}`),
    ];
  }
  if (provenance.kind === 'github_repository') {
    return [
      provenance.repository_url,
      provenance.release_tag ?? '',
      provenance.asset_name ?? '',
      provenance.resolved_commit_sha,
    ].filter(Boolean);
  }
  return [provenance.upload_id];
}

function humanizePermissionIdentifier(permissionID: string): string {
  const normalized = permissionID
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._:/@-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return permissionID;
  return normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1);
}

function permissionLabel(group: 'read' | 'execute' | 'delete' | 'images_write' | 'other', i18n: I18nHelpers): string {
  switch (group) {
    case 'read': return i18n.t('uiCopy.plugin.permission.read.label');
    case 'execute': return i18n.t('uiCopy.plugin.permission.execute.label');
    case 'delete': return i18n.t('uiCopy.plugin.permission.delete.label');
    case 'images_write': return i18n.t('uiCopy.plugin.permission.images_write.label');
    case 'other': return i18n.t('uiCopy.plugin.permission.other.label');
  }
}

function permissionDescription(group: 'read' | 'execute' | 'delete' | 'images_write' | 'other', i18n: I18nHelpers): string {
  switch (group) {
    case 'read': return i18n.t('uiCopy.plugin.permission.read.description');
    case 'execute': return i18n.t('uiCopy.plugin.permission.execute.description');
    case 'delete': return i18n.t('uiCopy.plugin.permission.delete.description');
    case 'images_write': return i18n.t('uiCopy.plugin.permission.images_write.description');
    case 'other': return i18n.t('uiCopy.plugin.permission.other.description');
  }
}

function TabButton(props: {
  id: PluginCenterTab;
  active: PluginCenterTab;
  label: string;
  onSelect: (tab: PluginCenterTab) => void;
}) {
  const isActive = () => props.id === props.active;
  const selectAdjacentTab = (event: KeyboardEvent) => {
    const tabs: readonly PluginCenterTab[] = ['discover', 'installed', 'updates'];
    const current = tabs.indexOf(props.id);
    const next = event.key === 'Home'
      ? tabs[0]
      : event.key === 'End'
        ? tabs[tabs.length - 1]
        : event.key === 'ArrowLeft'
          ? tabs[(current + tabs.length - 1) % tabs.length]
          : event.key === 'ArrowRight'
            ? tabs[(current + 1) % tabs.length]
            : undefined;
    if (!next) return;
    event.preventDefault();
    props.onSelect(next);
    queueMicrotask(() => document.getElementById(`plugin-center-tab-${next}`)?.focus());
  };
  return (
    <button
      id={`plugin-center-tab-${props.id}`}
      type="button"
      role="tab"
      aria-selected={isActive()}
      aria-controls="plugin-center-panel"
      tabIndex={isActive() ? 0 : -1}
      class={cn(
        'min-h-[44px] cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition sm:min-h-8',
        isActive() ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={() => props.onSelect(props.id)}
      onKeyDown={selectAdjacentTab}
    >
      {props.label}
    </button>
  );
}

function CenterCategoryButton(props: {
  id: PluginPresentationCategory | 'all';
  active: PluginPresentationCategory | 'all';
  label: string;
  onSelect: (category: PluginPresentationCategory | 'all') => void;
}): JSX.Element {
  return (
    <button
      type="button"
      data-plugin-center-category={props.id}
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

function CenterFilterMenu(props: {
  id: 'source' | 'trust' | 'lifecycle';
  value: string;
  items: DropdownItem[];
  onSelect: (value: string) => void;
}): JSX.Element {
  const currentLabel = () => props.items.find((item) => item.id === props.value)?.label ?? props.items[0]?.label ?? '';
  return (
    <Dropdown
      align="start"
      value={props.value}
      items={props.items}
      onSelect={props.onSelect}
      trigger={(
        <button
          type="button"
          data-plugin-center-filter={props.id}
          class="h-11 shrink-0 cursor-pointer rounded-md border bg-background px-3 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground sm:h-8"
        >
          {currentLabel()}
        </button>
      )}
    />
  );
}

function PluginActions(props: {
  item: PluginInventoryItem;
  canManage: boolean;
  canOpenSurfaces: boolean;
  commandPending: boolean;
  onCommand: (command: PluginLifecycleCommand) => void;
  onAskUninstall: (pluginInstanceID: string) => void;
  onExternalInstall: (item: PluginInventoryItem) => void;
  onExternalUpdate: (item: PluginInventoryItem) => void;
}) {
  const i18n = useI18n();
  const presentation = () => presentPlugin(props.item);
  const disabledManagement = () => !props.canManage || props.commandPending;
  const disabledOpen = () => props.commandPending || !props.canOpenSurfaces;
  const item = () => props.item;
  const reveal = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return;
    if (element instanceof HTMLDetailsElement) element.open = true;
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const focusTarget = element instanceof HTMLDetailsElement
      ? element.querySelector<HTMLElement>('summary') ?? element
      : element;
    focusTarget.focus({ preventScroll: true });
  };
  const openSurface = (placement: 'activity' | 'workbench') => {
    const target = item().defaultLaunchTarget;
    if (!target) return;
    props.onCommand({
      type: 'open_surface',
      pluginID: target.pluginID,
      pluginInstanceID: target.pluginInstanceID,
      surfaceID: target.surfaceID,
      expectedManagementRevision: target.expectedManagementRevision,
      placement,
    });
  };
  const primaryActionLabel = (action: PluginPrimaryAction) => {
    switch (action) {
      case 'install': return i18n.t('uiCopy.plugin.install');
      case 'review_permissions': return i18n.t('uiCopy.plugin.reviewPermissions');
      case 'enable': return i18n.t('uiCopy.plugin.enable');
      case 'open_activity': return i18n.t('uiCopy.plugin.openInActivity');
      case 'review_update': return i18n.t('uiCopy.plugin.reviewUpdate');
      case 'view_policy': return i18n.t('uiCopy.plugin.viewPolicyRestriction');
      case 'view_runtime': return i18n.t('uiCopy.plugin.viewRuntimeRequirement');
      case 'view_trust': return i18n.t('uiCopy.plugin.viewTrustDetails');
      case 'view_diagnostics': return i18n.t('uiCopy.plugin.viewIssue');
      case 'view_details': return i18n.t('uiCopy.plugin.technicalDetails');
    }
  };
  const runPrimaryAction = () => {
    switch (presentation().primaryAction) {
      case 'install': props.onExternalInstall(item()); break;
      case 'review_permissions':
      case 'view_policy': reveal('[data-plugin-permissions]'); break;
      case 'enable':
        props.onCommand({
          type: 'enable',
          pluginInstanceID: item().pluginInstanceID!,
          expectedManagementRevision: item().managementRevision!,
        });
        break;
      case 'open_activity': openSurface('activity'); break;
      case 'review_update': props.onExternalUpdate(item()); break;
      case 'view_runtime':
      case 'view_trust':
      case 'view_diagnostics': reveal('[data-plugin-issue-evidence-summary]'); break;
      case 'view_details': reveal('[data-plugin-technical-details]'); break;
    }
  };
  const primaryDisabled = () => {
    const action = presentation().primaryAction;
    if (action === 'open_activity') return disabledOpen();
    if (action === 'install' || action === 'enable' || action === 'review_update') return disabledManagement();
    return false;
  };
  const overflowItems = (): DropdownItem[] => [
    ...(presentation().canDisable ? [{ id: 'disable', label: i18n.t('uiCopy.plugin.disable'), disabled: disabledManagement() }] : []),
    ...(presentation().canCheckForUpdate ? [{ id: 'update', label: i18n.t('uiCopy.plugin.checkForUpdate'), disabled: disabledManagement() }] : []),
    ...(presentation().canUninstall ? [
      { id: 'danger-separator', label: '', separator: true },
      { id: 'uninstall', label: i18n.t('uiCopy.plugin.uninstall'), disabled: disabledManagement() },
    ] : []),
  ];
  const selectOverflowAction = (action: string) => {
    if (action === 'disable') {
      props.onCommand({
        type: 'disable',
        pluginInstanceID: item().pluginInstanceID!,
        expectedManagementRevision: item().managementRevision!,
      });
    } else if (action === 'update') {
      props.onExternalUpdate(item());
    } else if (action === 'uninstall') {
      props.onAskUninstall(item().pluginInstanceID!);
    }
  };
  return (
    <section class="border-y bg-muted/20 py-4" data-plugin-primary-actions>
      <div class="flex flex-col gap-2 px-3 sm:flex-row sm:items-center">
        <Button
          data-plugin-action={primaryActionDataID(presentation().primaryAction)}
          variant="primary"
          size="md"
          class="min-h-[44px] w-full justify-center sm:min-h-9 sm:w-auto"
          loading={props.commandPending}
          disabled={primaryDisabled()}
          icon={primaryActionIcon(presentation().primaryAction)}
          onClick={runPrimaryAction}
        >
          {primaryActionLabel(presentation().primaryAction)}
        </Button>
        <Show when={presentation().canOpenWorkbench}>
          <Button
            data-plugin-action="open-workbench"
            variant="outline"
            size="md"
            class="min-h-[44px] w-full justify-center sm:min-h-9 sm:w-auto"
            disabled={disabledOpen()}
            icon={Grid3x3}
            onClick={() => openSurface('workbench')}
          >
            {i18n.t('uiCopy.plugin.openInWorkbench')}
          </Button>
        </Show>
        <Show when={overflowItems().length > 0}>
          <Dropdown
            align="end"
            items={overflowItems()}
            onSelect={selectOverflowAction}
            triggerAriaLabel={i18n.t('uiCopy.plugin.moreActions')}
            trigger={(
              <Button
                data-plugin-action="more"
                variant="ghost"
                size="icon"
                class="min-h-[44px] min-w-[44px] sm:min-h-9 sm:min-w-9"
                title={i18n.t('uiCopy.plugin.moreActions')}
              >
                <MoreHorizontal class="h-4 w-4" />
              </Button>
            )}
          />
        </Show>
      </div>
    </section>
  );
}

function PluginUninstallDialog(props: {
  item: PluginInventoryItem;
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onCommand: (command: PluginLifecycleCommand) => void;
}): JSX.Element {
  const i18n = useI18n();
  const [retention, setRetention] = createSignal<'keep_data' | 'delete_data'>('keep_data');
  const [confirmDeleteData, setConfirmDeleteData] = createSignal(false);
  let wasOpen = false;
  createEffect(() => {
    const open = props.open;
    if (open && !wasOpen) {
      setRetention('keep_data');
      setConfirmDeleteData(false);
    }
    if (!open) setConfirmDeleteData(false);
    wasOpen = open;
  });
  const submit = () => props.onCommand({
    type: 'uninstall',
    pluginInstanceID: props.item.pluginInstanceID!,
    expectedManagementRevision: props.item.managementRevision!,
    dataRetention: retention(),
  });
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => { if (!open) props.onClose(); }}
      title={i18n.t('uiCopy.plugin.uninstallTitle', { plugin: props.item.displayName })}
      description={i18n.t('uiCopy.plugin.uninstallDescription')}
      footer={(
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS} variant="outline" size="sm" disabled={props.pending} onClick={props.onClose}>{i18n.t('common.actions.cancel')}</Button>
          <Button
            data-plugin-uninstall-confirm
            class={PLUGIN_MOBILE_TOUCH_TARGET_CLASS}
            variant={retention() === 'delete_data' ? 'destructive' : 'primary'}
            size="sm"
            loading={props.pending}
            disabled={props.pending}
            onClick={() => {
              if (retention() === 'delete_data' && !confirmDeleteData()) {
                setConfirmDeleteData(true);
                return;
              }
              submit();
            }}
          >
            {confirmDeleteData() ? i18n.t('uiCopy.plugin.deleteData') : i18n.t('uiCopy.plugin.uninstall')}
          </Button>
        </div>
      )}
    >
      <Show
        when={confirmDeleteData()}
        fallback={(
          <div class="space-y-2" role="radiogroup" aria-label={i18n.t('uiCopy.plugin.uninstallDataChoice')}>
            <DataRetentionChoice
              checked={retention() === 'keep_data'}
              label={i18n.t('uiCopy.plugin.keepData')}
              description={i18n.t('uiCopy.plugin.keepDataDescription')}
              onSelect={() => setRetention('keep_data')}
            />
            <DataRetentionChoice
              checked={retention() === 'delete_data'}
              label={i18n.t('uiCopy.plugin.deleteData')}
              description={i18n.t('uiCopy.plugin.deleteDataDescription')}
              destructive
              onSelect={() => setRetention('delete_data')}
            />
          </div>
        )}
      >
        <div role="alert" data-plugin-uninstall-delete-warning class="rounded-md border border-destructive bg-background p-4 text-sm text-destructive">
          {i18n.t('uiCopy.plugin.deleteDataDescription')}
        </div>
      </Show>
    </Dialog>
  );
}

function DataRetentionChoice(props: {
  checked: boolean;
  label: string;
  description: string;
  destructive?: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.checked}
      class={cn(
        'flex min-h-[44px] w-full cursor-pointer items-start gap-3 rounded-md border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        props.checked ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
        props.destructive && props.checked && 'border-destructive bg-destructive/5',
      )}
      onClick={props.onSelect}
    >
      <span class={cn('mt-0.5 h-4 w-4 shrink-0 rounded-full border-[5px]', props.checked ? (props.destructive ? 'border-destructive' : 'border-primary') : 'border-muted-foreground/40')} />
      <span class="min-w-0">
        <span class={cn('block text-sm font-medium', props.destructive && 'text-destructive')}>{props.label}</span>
        <span class="mt-1 block text-xs leading-5 text-muted-foreground">{props.description}</span>
      </span>
    </button>
  );
}

function primaryActionDataID(action: PluginPrimaryAction): string {
  if (action === 'open_activity') return 'open';
  if (action === 'review_update') return 'update-external';
  return action.replace('review_', '').replace('view_', '');
}

function primaryActionIcon(action: PluginPrimaryAction) {
  switch (action) {
    case 'install': return Download;
    case 'open_activity': return CheckCircle;
    case 'review_update': return RefreshIcon;
    case 'enable': return Settings;
    case 'review_permissions':
    case 'view_policy':
    case 'view_trust': return Shield;
    case 'view_runtime':
    case 'view_diagnostics':
    case 'view_details': return CheckCircle;
  }
}

function DetailStat(props: { label: string; value: string }): JSX.Element {
  return (
    <div class="border-t pt-2">
      <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{props.label}</div>
      <div class="mt-1 truncate text-sm text-foreground">{props.value}</div>
    </div>
  );
}

function PluginIcon(props: { item: PluginInventoryItem; class?: string; size?: 'sm' | 'lg' }): JSX.Element {
  const [imageFailed, setImageFailed] = createSignal(false);
  return (
    <span
      class={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-foreground',
        props.size === 'lg' ? 'h-12 w-12' : 'h-10 w-10',
        props.class,
      )}
    >
      <Show when={props.item.iconURL && !imageFailed()} fallback={(
        props.item.iconFallback === 'containers'
          ? <Grid3x3 class={props.size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
          : <Settings class={props.size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
      )}>
        <img src={props.item.iconURL ?? ''} alt="" class="h-full w-full object-cover" onError={() => setImageFailed(true)} />
      </Show>
    </span>
  );
}

function filterItems(
  items: readonly PluginInventoryItem[],
  filters: Readonly<{
    query: string;
    category: PluginPresentationCategory | 'all';
    source: PluginSourceFilter;
    trust: PluginTrustFilter;
    lifecycle: PluginLifecycleFilter;
  }>,
  i18n: I18nHelpers,
  locale: string,
): PluginInventoryItem[] {
  const query = filters.query.normalize('NFKC').trim().toLocaleLowerCase(locale);
  return items.filter((item) => {
    if (filters.category !== 'all' && item.category !== filters.category) return false;
    if (filters.source === 'official' && !item.officialCatalog) return false;
    if (filters.source === 'external' && item.officialCatalog) return false;
    if (filters.trust !== 'all' && item.trustBadge !== filters.trust) return false;
    if (filters.lifecycle !== 'all' && item.lifecycleState !== filters.lifecycle) return false;
    if (!query) return true;
    const fields = [
      item.displayName,
      item.description,
      item.publisher,
      item.pluginID,
      statusLabel(item, i18n),
      item.officialCatalog?.stableVersion,
      item.version,
      centerCategoryLabel(item.category, i18n),
      item.searchAliasesKey ? i18n.t(item.searchAliasesKey) : undefined,
      ...item.searchKeywords,
    ];
    return fields.some((field) => String(field ?? '').normalize('NFKC').toLocaleLowerCase(locale).includes(query));
  });
}

function centerCategoryLabel(category: PluginPresentationCategory, i18n: I18nHelpers): string {
  switch (category) {
    case 'development': return i18n.t('uiCopy.plugin.categoryDevelopment');
    case 'infrastructure': return i18n.t('uiCopy.plugin.categoryInfrastructure');
    case 'data': return i18n.t('uiCopy.plugin.categoryData');
    case 'collaboration': return i18n.t('uiCopy.plugin.categoryCollaboration');
    case 'productivity': return i18n.t('uiCopy.plugin.categoryProductivity');
    case 'other': return i18n.t('uiCopy.plugin.categoryOther');
  }
}

function initialTabForProjection(projection?: PluginInventoryProjection): PluginCenterTab {
  if (projection && projection.items.every((item) => !item.pluginInstanceID)) {
    return 'discover';
  }
  return 'installed';
}

function tabForItem(item: PluginInventoryItem): PluginCenterTab {
  if (item.lifecycleState === 'update_available') return 'updates';
  if (item.pluginInstanceID) return 'installed';
  return 'discover';
}

function statusLabel(item: PluginInventoryItem, i18n: I18nHelpers): string {
  switch (item.lifecycleState) {
    case 'not_installed':
      return i18n.t('uiCopy.plugin.available');
    case 'installed':
      return i18n.t('uiCopy.plugin.installed');
    case 'enabled':
      return i18n.t('uiCopy.plugin.enabled');
    case 'disabled':
      return i18n.t('uiCopy.plugin.disabled');
    case 'update_available':
      return i18n.t('uiCopy.plugin.updateAvailable');
    case 'needs_attention':
      return i18n.t('uiCopy.plugin.needsAttention');
    default:
      return i18n.t('uiCopy.plugin.unavailable');
  }
}

function statusPillClass(item: PluginInventoryItem): string {
  if (item.lifecycleState === 'enabled') return 'rounded-full bg-[var(--redeven-status-success-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--redeven-status-success-foreground)]';
  if (item.lifecycleState === 'needs_attention') return 'rounded-full bg-[var(--redeven-status-warning-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--redeven-status-warning-foreground)]';
  if (item.lifecycleState === 'update_available') return 'rounded-full bg-[var(--redeven-status-info-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--redeven-status-info-foreground)]';
  return 'rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground';
}

function TrustBadge(props: { item: PluginInventoryItem }): JSX.Element {
  const i18n = useI18n();
  return (
    <span class={cn(
      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
      props.item.trustBadge === 'official' || props.item.trustBadge === 'verified'
        ? 'bg-primary/10 text-primary'
        : props.item.trustBadge === 'blocked' || props.item.trustBadge === 'revoked'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-[var(--redeven-status-warning-soft)] text-[var(--redeven-status-warning-foreground)]',
    )}>
      {trustLabel(props.item, i18n)}
    </span>
  );
}

function trustLabel(item: PluginInventoryItem, i18n: I18nHelpers): string {
  switch (item.trustBadge) {
    case 'official':
      return i18n.t('uiCopy.plugin.official');
    case 'verified':
      return i18n.t('uiCopy.plugin.verified');
    case 'unsigned':
      return i18n.t('uiCopy.plugin.unsigned');
    case 'community':
      return i18n.t('uiCopy.plugin.community');
    case 'revoked':
      return i18n.t('uiCopy.plugin.revoked');
    case 'blocked':
      return i18n.t('uiCopy.plugin.blocked');
    case 'unavailable':
      return i18n.t('uiCopy.plugin.unavailable');
    default:
      return i18n.t('uiCopy.plugin.unavailable');
  }
}

function messageFromUnknown(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}
