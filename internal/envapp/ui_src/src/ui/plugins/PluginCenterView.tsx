import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn, createUIFirstSelection } from '@floegence/floe-webapp-core';
import { AlertTriangle, ArrowLeft, CheckCircle, ChevronDown, Download, MoreHorizontal, RefreshIcon, Search, Settings, Shield, X } from '@floegence/floe-webapp-core/icons';
import { Button, Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import { buildPluginCenterModel } from './pluginInventoryProjection';
import { useI18n, type I18nHelpers } from '../i18n';
import { Dialog } from '../primitives/EnvAppModal';
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
  PluginUpdateCandidate,
} from './pluginTypes';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';
import { ExternalPluginInstallDialog } from './ExternalPluginInstallDialog';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_MOBILE_TOUCH_TARGET_CLASS, PLUGIN_PRESS_MOTION_CLASS, pluginLifecycleLabel, pluginTrustLabel, presentPlugin, type PluginPrimaryAction } from './pluginPresentation';
import { PluginCenterItem } from './PluginCenterItems';
import { PluginIdentityHeader } from './PluginPresentationPrimitives';
import { PluginUpdateReviewDialog } from './PluginUpdateReviewDialog';

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
  const [updateReviewItem, setUpdateReviewItem] = createSignal<PluginInventoryItem>();
  const [updateReviewOpen, setUpdateReviewOpen] = createSignal(false);
  const [updateSuccess, setUpdateSuccess] = createSignal(false);
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
  const errorMessage = createMemo(() => {
    const error = props.error ?? commandError();
    if (error) return messageFromUnknown(error);
    return projection().marketUnavailable ? i18n.t('uiCopy.plugin.marketUnavailable') : undefined;
  });
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
  const clearAllFilters = () => {
    setQuery('');
    setCategory('all');
    setSourceFilter('all');
    setTrustFilter('all');
    setLifecycleFilter('all');
    clearDetailSelection();
  };

  const openExternalDialog = (item?: PluginInventoryItem, sourcePreset?: ExternalPluginSourcePreset) => {
    setExternalUpdateItem(item);
    setExternalSourcePreset(sourcePreset);
    setExternalDialogOpen(true);
  };
  const requestUpdate = (item: PluginInventoryItem) => {
    setUpdateSuccess(false);
    setUpdateReviewItem(item);
    setUpdateReviewOpen(true);
  };
  const installItem = (item: PluginInventoryItem) => {
    if (item.officialCatalog) {
      void runCommand({ type: 'install', pluginID: item.pluginID, source: 'official_catalog' });
      return;
    }
    openExternalDialog();
  };
  const currentUpdateReviewItem = createMemo(() => {
    const reviewed = updateReviewItem();
    if (!reviewed) return undefined;
    return allItems().find((item) => item.inventoryKey === reviewed.inventoryKey) ?? reviewed;
  });

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

  const openItemSurface = (item: PluginInventoryItem, placement: 'activity' | 'workbench') => {
    const target = item.defaultLaunchTarget;
    if (!target || !canOpenSurfaces()) return;
    void runCommand({
      type: 'open_surface',
      pluginID: target.pluginID,
      pluginInstanceID: target.pluginInstanceID,
      surfaceID: target.surfaceID,
      expectedManagementRevision: target.expectedManagementRevision,
      placement,
    });
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
      filtersActive={filtersActive()}
      onClearFilters={clearAllFilters}
      onRefresh={() => void refreshInventory()}
      onTabSelect={selectTab}
      canManage={canManage()}
      focusRequest={props.selectedInventoryKey ? undefined : props.focusRequest}
      onInstallExternal={() => openExternalDialog()}
      onClose={props.onClose}
    >
      <Show when={errorMessage()}>
        <div role="alert" data-plugin-center-error class={cn('flex flex-wrap items-center gap-3 border-b border-destructive bg-background px-4 py-3 text-sm text-destructive', PLUGIN_ENTER_MOTION_CLASS)}>
          <AlertTriangle class="h-4 w-4 shrink-0" />
          <div class="min-w-0 flex-1">
            <div>{errorMessage()}</div>
            <Show when={!canManage()}>
              <div class="mt-1 text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.permissionsAdminRequired')}</div>
            </Show>
          </div>
          <button
            type="button"
              class={cn('min-h-[44px] cursor-pointer rounded-md border border-destructive px-3 text-xs font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9', PLUGIN_PRESS_MOTION_CLASS)}
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
            'min-h-0 min-w-0 w-full flex-1 flex-col border-b sm:border-b-0',
            mobileDetailOpen() ? 'hidden sm:flex' : 'flex',
          )}
        >
          <Show when={loading()}>
            <div role="status" data-plugin-center-loading class="sr-only">{i18n.t('uiCopy.plugin.loadingOfficial')}</div>
          </Show>
          <div
            data-plugin-center-list
            aria-busy={loading()}
            class="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-3 overflow-y-auto p-3 sm:p-4"
          >
            <For each={visibleItems()}>
              {(item, index) => (
                <PluginCenterItem
                  item={item}
                  tab={activeTab()}
                  selected={selectedItem()?.inventoryKey === item.inventoryKey}
                  canManage={canManage()}
                  canOpenSurfaces={canOpenSurfaces()}
                  pending={loading() || commandPending()}
                  entranceDelayMs={Math.min(index() * 18, 126)}
                  onOpenDetails={(target) => openDetails(item.inventoryKey, target)}
                  onInstall={() => installItem(item)}
                  onUpdate={() => requestUpdate(item)}
                  onOpenActivity={() => openItemSurface(item, 'activity')}
                  onOpenWorkbench={() => openItemSurface(item, 'workbench')}
                />
              )}
            </For>
            <Show when={!loading() && visibleItems().length === 0}>
              <div class={cn('col-span-full flex min-h-52 flex-col items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground', PLUGIN_ENTER_MOTION_CLASS)}>
                <Show when={activeTab() === 'updates' && updateSuccess()} fallback={<Search class="h-6 w-6" />}>
                  <CheckCircle class="h-6 w-6 text-[var(--redeven-status-success-foreground)]" />
                </Show>
                <p class="mt-3">{activeTab() === 'updates' && updateSuccess() ? i18n.t('uiCopy.plugin.updateReview.allCurrent') : i18n.t('uiCopy.plugin.emptyView')}</p>
                <Show when={filtersActive()}>
                  <button
                    type="button"
                    class={cn('mt-3 min-h-[44px] cursor-pointer rounded-md border px-3 text-xs font-semibold text-foreground hover:bg-muted', PLUGIN_PRESS_MOTION_CLASS)}
                    onClick={clearAllFilters}
                  >
                    {i18n.t('uiCopy.plugin.clearFilters')}
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        </div>
        <Show keyed when={selectedItem()}>
          {(item) => (
            <PluginCenterDetails
              item={item}
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
              onExternalInstall={installItem}
              onExternalUpdate={requestUpdate}
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
      <PluginUpdateReviewDialog
        open={updateReviewOpen()}
        item={currentUpdateReviewItem()}
        canManage={canManage()}
        onOpenChange={(open) => {
          if (!open) {
            setUpdateReviewOpen(false);
            clearDetailSelection();
          }
        }}
        onInspect={props.onInspectExternal ?? (async () => {
          throw new Error(i18n.t('uiCopy.plugin.external.inspectFailed'));
        })}
        onCommitExternal={props.onCommitExternal ?? (async () => {
          throw new Error(i18n.t('uiCopy.plugin.external.commitFailed'));
        })}
        onCommitDevelopment={async (candidate: PluginUpdateCandidate, signal) => {
          await props.onCommand({
            type: 'update',
            pluginID: candidate.intent.pluginID,
            pluginInstanceID: candidate.intent.pluginInstanceID,
            expectedManagementRevision: candidate.intent.expectedManagementRevision,
            targetVersion: candidate.targetVersion,
          }, signal);
        }}
        onRefresh={async () => {
          await props.onRefresh();
        }}
        onCommitted={() => setUpdateSuccess(true)}
        onOpenActivity={() => {
          const item = currentUpdateReviewItem();
          if (item) openItemSurface(item, 'activity');
          setUpdateReviewOpen(false);
        }}
        onViewPermissions={() => {
          const item = currentUpdateReviewItem();
          if (item) {
            setSelectedInventoryKey(item.inventoryKey);
            setMobileDetailOpen(true);
            nextPermissionsFocusRequest += 1;
            setPermissionsFocusRequest({ id: nextPermissionsFocusRequest, inventoryKey: item.inventoryKey });
          }
          setUpdateReviewOpen(false);
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
  filtersActive: boolean;
  onClearFilters: () => void;
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
    <section ref={rootRef} data-plugin-center-view tabIndex={-1} class="redeven-plugin-motion flex h-full min-h-0 flex-col bg-background text-foreground animate-in fade-in duration-200 motion-reduce:animate-none">
      <header class="w-full shrink-0 border-b bg-background" data-plugin-center-toolbar>
        <div class="flex w-full min-w-0 flex-wrap items-center gap-3 px-3 py-2.5 sm:flex-nowrap sm:px-4" data-plugin-center-toolbar-primary>
          <div class="flex min-w-0 shrink-0 items-center gap-2">
            <h1 class="truncate text-sm font-semibold">{i18n.t('uiCopy.plugin.centerTitle')}</h1>
            <span class="rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">{i18n.t('uiCopy.plugin.openSources')}</span>
          </div>
          <label class="relative order-last block w-full min-w-0 basis-full sm:order-none sm:ml-auto sm:max-w-[360px] sm:flex-1 sm:basis-auto">
              <span class="sr-only">{i18n.t('uiCopy.plugin.searchPlaceholder')}</span>
              <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={props.searchRef}
                data-plugin-center-search
                type="search"
                value={props.query}
                onInput={(event) => props.onQueryInput(event.currentTarget.value)}
                placeholder={i18n.t('uiCopy.plugin.searchPlaceholder')}
                class="h-[44px] w-full rounded-md border bg-muted/30 pl-8 pr-2 text-sm outline-none transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground/60 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/20 sm:h-9 motion-reduce:transition-none"
              />
          </label>
          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <Show when={props.filtersActive}>
              <button
                type="button"
                data-plugin-center-clear-filters
                class="min-h-[44px] shrink-0 cursor-pointer whitespace-nowrap rounded-md px-2.5 text-xs font-semibold text-primary transition-colors duration-150 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 motion-reduce:transition-none"
                onClick={props.onClearFilters}
              >
                {i18n.t('uiCopy.plugin.clearFilters')}
              </button>
            </Show>
            <Show when={props.canManage}>
              <Dropdown
                align="end"
                disabled={props.loading}
                items={administrationItems()}
                onSelect={(id) => { if (id === 'install-external') props.onInstallExternal(); }}
                triggerAriaLabel={i18n.t('uiCopy.plugin.moreActions')}
                trigger={(
                  <button
                    type="button"
                    data-plugin-center-install-external
                    class="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9 motion-reduce:transition-none"
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
              class="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9 motion-reduce:transition-none"
              aria-label={i18n.t('uiCopy.plugin.refreshOfficial')}
              title={i18n.t('uiCopy.plugin.refreshOfficial')}
              disabled={props.loading}
              onClick={props.onRefresh}
            >
              <RefreshIcon class={cn('h-3.5 w-3.5', props.loading && 'animate-spin motion-reduce:animate-none')} />
            </button>
            <Show when={props.onClose}>
              <button
                type="button"
                class="inline-flex h-[44px] w-[44px] cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground sm:h-9 sm:w-9 motion-reduce:transition-none"
                aria-label={i18n.t('uiCopy.plugin.closeCenter')}
                title={i18n.t('uiCopy.plugin.closeCenter')}
                onClick={() => props.onClose?.()}
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </Show>
          </div>
        </div>
        <div class="flex min-w-0 items-center gap-3 overflow-x-auto border-t px-3 py-2 sm:px-4" data-plugin-center-toolbar-secondary>
          <div class="flex shrink-0 items-center" role="tablist" aria-label={i18n.t('uiCopy.plugin.centerTitle')}>
          <TabButton id="discover" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.discoverCount', { count: props.discoverCount })} />
          <TabButton id="installed" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.installedCount', { count: props.installedCount })} />
          <TabButton id="updates" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.updatesCount', { count: props.updatesCount })} />
          </div>
          <span aria-hidden="true" class="h-5 w-px shrink-0 bg-border" />
          <div class="flex min-w-max flex-1 items-center gap-2" data-plugin-center-filter-scroll>
            <div class="flex gap-1" role="group" aria-label={i18n.t('uiCopy.plugin.categories')}>
              <CenterCategoryButton id="all" active={props.category} label={i18n.t('uiCopy.plugin.categoryAll')} onSelect={props.onCategorySelect} />
              <CenterCategoryButton id="development" active={props.category} label={i18n.t('uiCopy.plugin.categoryDevelopment')} onSelect={props.onCategorySelect} />
              <CenterCategoryButton id="infrastructure" active={props.category} label={i18n.t('uiCopy.plugin.categoryInfrastructure')} onSelect={props.onCategorySelect} />
              <CenterCategoryButton id="data" active={props.category} label={i18n.t('uiCopy.plugin.categoryData')} onSelect={props.onCategorySelect} />
              <CenterCategoryButton id="collaboration" active={props.category} label={i18n.t('uiCopy.plugin.categoryCollaboration')} onSelect={props.onCategorySelect} />
              <CenterCategoryButton id="productivity" active={props.category} label={i18n.t('uiCopy.plugin.categoryProductivity')} onSelect={props.onCategorySelect} />
              <CenterCategoryButton id="other" active={props.category} label={i18n.t('uiCopy.plugin.categoryOther')} onSelect={props.onCategorySelect} />
            </div>
          <div class="flex items-center gap-2" data-plugin-center-filters>
            <CenterFilterMenu
              id="source"
              dimension={i18n.t('uiCopy.plugin.external.source')}
              value={props.sourceFilter}
              onSelect={(value) => props.onSourceFilter(value as PluginSourceFilter)}
              items={[
                { id: 'all', label: i18n.t('uiCopy.plugin.categoryAll') },
                { id: 'official', label: i18n.t('uiCopy.plugin.officialSource') },
                { id: 'external', label: i18n.t('uiCopy.plugin.externalPlugin') },
              ]}
            />
            <CenterFilterMenu
              id="trust"
              dimension={i18n.t('uiCopy.plugin.trust')}
              value={props.trustFilter}
              onSelect={(value) => props.onTrustFilter(value as PluginTrustFilter)}
              items={[
                { id: 'all', label: i18n.t('uiCopy.plugin.categoryAll') },
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
              dimension={i18n.t('uiCopy.plugin.lifecycle')}
              value={props.lifecycleFilter}
              onSelect={(value) => props.onLifecycleFilter(value as PluginLifecycleFilter)}
              items={[
                { id: 'all', label: i18n.t('uiCopy.plugin.categoryAll') },
                { id: 'enabled', label: i18n.t('uiCopy.plugin.enabled') },
                { id: 'disabled', label: i18n.t('uiCopy.plugin.disabled') },
                { id: 'needs_attention', label: i18n.t('uiCopy.plugin.needsAttention') },
                { id: 'update_available', label: i18n.t('uiCopy.plugin.updateAvailable') },
                { id: 'not_installed', label: i18n.t('uiCopy.plugin.notInstalled') },
              ]}
            />
          </div>
          </div>
        </div>
      </header>
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
      class={cn('min-h-0 w-full overflow-y-auto bg-background sm:w-[360px] sm:max-w-[42vw] sm:flex-none sm:border-l', props.mobileOpen === false ? 'hidden sm:block' : 'redeven-plugin-motion block animate-in fade-in duration-200 ease-out motion-reduce:animate-none')}
    >
      <Show
        when={props.item}
        fallback={<div class="px-4 py-8 text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.selectOfficial')}</div>}
      >
        {(item) => (
          <div class="space-y-4 px-4 py-4">
            <Button
              ref={props.mobileBackRef}
              data-plugin-center-mobile-back
              size="sm"
              variant="ghost"
              icon={ArrowLeft}
              class="min-h-[44px] sm:hidden"
              onClick={props.onMobileBack}
            >
              {i18n.t('uiCopy.plugin.backToList')}
            </Button>
            <PluginIdentityHeader item={item()} description headingRef={props.detailHeadingRef} />

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

            <PluginPermissionInventory
              item={item()}
              canManage={props.canManage}
              commandPending={props.commandPending}
              onCommand={props.onCommand}
              focusTargetRef={props.permissionsRef}
            />

            <PluginIssueDetails item={item()} />

            <details class="group rounded-md border px-3 py-2.5 transition-[border-color,background-color] duration-150 open:bg-muted/10 motion-reduce:transition-none" data-plugin-technical-details>
              <summary tabIndex={0} class="min-h-7 cursor-pointer text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{i18n.t('uiCopy.plugin.technicalDetails')}</summary>
              <div class="redeven-plugin-disclosure-content mt-3 grid gap-2.5">
                <DetailStat label={i18n.t('uiCopy.plugin.publisher')} value={item().publisher} />
                <DetailStat label={i18n.t('uiCopy.plugin.installedVersion')} value={item().version ?? i18n.t('uiCopy.plugin.notInstalled')} />
                <DetailStat label={i18n.t('uiCopy.plugin.stableVersion')} value={item().officialCatalog?.stableVersion ?? '-'} />
                <DetailStat label={i18n.t('uiCopy.plugin.minimumRedeven')} value={item().officialCatalog?.minRedevenVersion ?? '-'} />
                <DetailStat label={i18n.t('uiCopy.plugin.minimumReDevPlugin')} value={item().officialCatalog?.minReDevPluginVersion ?? '-'} />
                <DetailStat label={i18n.t('uiCopy.plugin.trust')} value={pluginTrustLabel(item(), i18n)} />
              </div>
              <code class="mt-3 block break-all text-[11px] text-muted-foreground">{item().pluginID}</code>
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
          <div class="space-y-4 pt-2.5">
            <For each={[true, false] as const}>
              {(required) => {
                const permissions = () => inventory().permissions.filter((permission) => permission.requiredToOpen === required);
                return (
                  <Show when={permissions().length > 0}>
                    <section data-plugin-permission-group={required ? 'required' : 'optional'}>
                      <h4 class="text-xs font-semibold text-foreground">
                        {required ? i18n.t('uiCopy.plugin.requiredToOpen') : i18n.t('uiCopy.plugin.optionalPermission')}
                      </h4>
                      <div class="mt-1 divide-y">
                        <For each={permissions()}>
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
                  <div class="py-2.5" data-plugin-permission={permission.permissionID}>
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <span data-plugin-permission-name class="text-xs font-medium">{permissionName()}</span>
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
                            'relative mt-0.5 inline-flex h-[44px] w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md transition-opacity duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:h-6 sm:w-10 motion-reduce:transition-none',
                          )}
                          onClick={() => {
                            setConfirmation({ permissionID: permission.permissionID, grant: !granted() });
                          }}
                        >
                          <span aria-hidden="true" class={cn('relative inline-flex h-6 w-10 items-center rounded-full border transition-[background-color,border-color] duration-150 motion-reduce:transition-none', granted() ? 'border-primary bg-primary' : 'bg-muted')}>
                            <span
                              class={cn(
                                'absolute left-1 h-4 w-4 rounded-full bg-background shadow transition-transform duration-150 motion-reduce:transition-none',
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
                    </section>
                  </Show>
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
                  <div class="space-y-4" data-plugin-permission-confirmation>
                    <PluginIdentityHeader item={props.item} />
                    <div class="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
                        <Shield class="h-4 w-4" />
                      </span>
                      <p class="min-w-0 leading-6">
                        {pending().grant
                          ? i18n.t('uiCopy.plugin.permissionGrantImpact')
                          : i18n.t('uiCopy.plugin.permissionRevokeImpact')}
                      </p>
                    </div>
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
        'min-h-[44px] min-w-[44px] cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 sm:min-h-8 sm:min-w-0 motion-reduce:transition-none',
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
  dimension: string;
  value: string;
  items: DropdownItem[];
  onSelect: (value: string) => void;
}): JSX.Element {
  const i18n = useI18n();
  const currentLabel = () => props.items.find((item) => item.id === props.value)?.label ?? props.items[0]?.label ?? '';
  const triggerLabel = () => i18n.t('uiCopy.plugin.filterSelection', {
    dimension: props.dimension,
    value: currentLabel(),
  });
  return (
    <Dropdown
      align="start"
      value={props.value}
      items={props.items}
      onSelect={props.onSelect}
      triggerAriaLabel={triggerLabel()}
      triggerClass="group/filter shrink-0 rounded-md"
      trigger={(
        <div
          data-plugin-center-filter={props.id}
          class={cn(
            'inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium text-muted-foreground transition-[border-color,background-color,color,box-shadow] duration-150 hover:border-foreground/20 hover:bg-muted hover:text-foreground group-focus-visible/filter:ring-2 group-focus-visible/filter:ring-ring sm:h-8',
            props.value !== 'all' && 'border-primary/40 bg-primary/5 text-foreground',
          )}
        >
          <span class="whitespace-nowrap">{triggerLabel()}</span>
          <ChevronDown class="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-aria-expanded/filter:rotate-180 motion-reduce:transition-none" />
        </div>
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
    ...(presentation().canOpenWorkbench ? [{ id: 'workbench', label: i18n.t('uiCopy.plugin.openInWorkbench'), disabled: disabledOpen() }] : []),
    ...(presentation().canDisable ? [{ id: 'disable', label: i18n.t('uiCopy.plugin.disable'), disabled: disabledManagement() }] : []),
    ...(presentation().canCheckForUpdate ? [{ id: 'update', label: i18n.t('uiCopy.plugin.checkForUpdate'), disabled: disabledManagement() }] : []),
    ...(presentation().canUninstall ? [
      { id: 'danger-separator', label: '', separator: true },
      { id: 'uninstall', label: i18n.t('uiCopy.plugin.uninstall'), disabled: disabledManagement() },
    ] : []),
  ];
  const selectOverflowAction = (action: string) => {
    if (action === 'workbench') {
      openSurface('workbench');
    } else if (action === 'disable') {
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
    <section class="border-y bg-muted/20 px-3 py-3" data-plugin-primary-actions>
      <div class="flex min-w-0 items-center gap-2" data-plugin-action-row>
        <Button
          data-plugin-action={primaryActionDataID(presentation().primaryAction)}
          variant="primary"
          size="sm"
          class="min-h-[44px] min-w-0 flex-1 justify-center text-xs sm:min-h-8"
          loading={props.commandPending}
          disabled={primaryDisabled()}
          icon={primaryActionIcon(presentation().primaryAction)}
          onClick={runPrimaryAction}
        >
          {primaryActionLabel(presentation().primaryAction)}
        </Button>
        <Show when={overflowItems().length > 0}>
          <Dropdown
            align="end"
            items={overflowItems()}
            onSelect={selectOverflowAction}
            triggerAriaLabel={i18n.t('uiCopy.plugin.moreActions')}
            triggerClass="shrink-0 rounded-md"
            trigger={(
              <Button
                data-plugin-action="more"
                variant="outline"
                size="icon"
                class="min-h-[44px] min-w-[44px] shrink-0 sm:min-h-8 sm:min-w-8"
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
        <div class="space-y-4">
          <PluginIdentityHeader item={props.item} />
          <div role="alert" data-plugin-uninstall-delete-warning class="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{i18n.t('uiCopy.plugin.deleteDataDescription')}</span>
          </div>
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
        'flex min-h-[44px] w-full cursor-pointer items-start gap-3 rounded-md border p-3 text-left transition-[background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none',
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
      <div class="mt-1 truncate text-xs text-foreground">{props.value}</div>
    </div>
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
      pluginLifecycleLabel(item, i18n),
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

function messageFromUnknown(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}
