import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { cn, createUIFirstSelection } from '@floegence/floe-webapp-core';
import { AlertTriangle, ArrowLeft, CheckCircle, ChevronDown, Download, MoreHorizontal, Play, RefreshIcon, Search, Shield, X } from '@floegence/floe-webapp-core/icons';
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
  PluginInstallExecutionProjection,
  PluginInventoryItem,
  PluginInventoryProjection,
  PluginMarketDetail,
  PluginLifecycleCommand,
  PluginLifecycleState,
  PluginPendingCommandType,
  PluginPresentationCategory,
  PluginRuntimeRecoveryPresentation,
  PluginTrustBadge,
  OfficialPluginReleaseInspection,
} from './pluginTypes';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';
import { ExternalPluginInstallDialog } from './ExternalPluginInstallDialog';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_MOBILE_TOUCH_TARGET_CLASS, PLUGIN_PRESS_MOTION_CLASS, pluginLifecycleLabel, pluginPendingCommandLabel, pluginTrustLabel, presentPlugin, type PluginPrimaryAction } from './pluginPresentation';
import { PluginCenterItem } from './PluginCenterItems';
import { PluginIdentityHeader } from './PluginPresentationPrimitives';
import { resolveAuthorPresentation, resolvePluginPresentation } from './officialPluginCatalog';
import { PluginUpdateReviewDialog } from './PluginUpdateReviewDialog';
import { PluginInstallStatus } from './PluginInstallStatus';

export type PluginCenterViewProps = {
  projection: PluginInventoryProjection;
  loading: boolean;
  error?: unknown;
  selectedInventoryKey?: string;
  focusRequest?: number;
  canManagePlugins: boolean;
  canOpenPluginSurfaces: boolean;
  runtimeRecovery?: PluginRuntimeRecoveryPresentation;
  runtimeRecoveryByInstanceID?: Readonly<Record<string, PluginRuntimeRecoveryPresentation>>;
  onRetryRuntimeRecovery?: (pluginInstanceID?: string) => Promise<unknown> | unknown;
  onClose?: () => void;
  onRefresh: () => Promise<unknown> | unknown;
  onCommand: (command: PluginLifecycleCommand, signal: AbortSignal) => Promise<unknown> | unknown;
  installOperations?: readonly PluginInstallExecutionProjection[];
  onRetryInstall?: (pluginInstanceID: string) => Promise<unknown> | unknown;
  onInspectOfficial?: (item: PluginInventoryItem, signal: AbortSignal) => Promise<OfficialPluginReleaseInspection>;
  onInspectExternal?: (request: ExternalPluginInspectionRequest, signal: AbortSignal) => Promise<ExternalPluginInspection>;
  onCommitExternal?: (inspection: ExternalPluginInspection, signal: AbortSignal) => Promise<ExternalPluginCommitResult>;
  onLoadMarketDetail?: (pluginID: string, generation: number, signal?: AbortSignal) => Promise<PluginMarketDetail>;
};

type PluginSourceFilter = 'all' | 'official' | 'external';
type PluginTrustFilter = 'all' | PluginTrustBadge;
type PluginLifecycleFilter = 'all' | Exclude<PluginLifecycleState, 'installed'>;

export function PluginCenterView(props: PluginCenterViewProps): JSX.Element {
  const i18n = useI18n();
  const [activeTab, setActiveTab] = createSignal<PluginCenterTab>(initialTabForProjection(props.projection));
  // The shell supplies an empty fallback projection while the first inventory
  // request is in flight. Treat that fallback as unresolved so the tab follows
  // the authoritative inventory once it arrives.
  const [initialTabResolved, setInitialTabResolved] = createSignal(props.projection.items.length > 0);
  const [query, setQuery] = createSignal('');
  const [category, setCategory] = createSignal<PluginPresentationCategory | 'all'>('all');
  const [sourceFilter, setSourceFilter] = createSignal<PluginSourceFilter>('all');
  const [trustFilter, setTrustFilter] = createSignal<PluginTrustFilter>('all');
  const [lifecycleFilter, setLifecycleFilter] = createSignal<PluginLifecycleFilter>('all');
  const [selectedInventoryKey, setSelectedInventoryKey] = createSignal<string | undefined>();
  const [protectedSelectionInventoryKey, setProtectedSelectionInventoryKey] = createSignal<string | undefined>();
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [pendingCommand, setPendingCommand] = createSignal<Readonly<{
    type: PluginPendingCommandType;
    target?: string;
  }>>();
  const [submittedInstallTarget, setSubmittedInstallTarget] = createSignal<Readonly<{
    pluginID: string;
    pluginInstanceID: string;
  }>>();
  const [uninstallChoiceFor, setUninstallChoiceFor] = createSignal<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = createSignal(Boolean(props.selectedInventoryKey));
  const [externalDialogOpen, setExternalDialogOpen] = createSignal(false);
  const [officialInstallReviewItem, setOfficialInstallReviewItem] = createSignal<PluginInventoryItem>();
  const [officialInstallInspection, setOfficialInstallInspection] = createSignal<OfficialPluginReleaseInspection>();
  const [officialInstallReviewPending, setOfficialInstallReviewPending] = createSignal(false);
  const [officialInstallReviewError, setOfficialInstallReviewError] = createSignal<string>();
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
  const [marketDetailState, setMarketDetailState] = createSignal<{
    pluginID: string;
    detail?: PluginMarketDetail;
    error?: unknown;
    loading: boolean;
  }>();
  let marketDetailController: AbortController | undefined;
  let officialInstallInspectionController: AbortController | undefined;
  const marketDetailCache = new Map<string, PluginMarketDetail>();

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
    marketDetailController?.abort('Plugin Center disposed');
    officialInstallInspectionController?.abort('Plugin Center disposed');
    cancelDeferredPermissionsFocus();
  });

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mobileDetailOpen() && selectedInventoryKey()) {
        event.preventDefault();
        closeDetails();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  const projection = createMemo(() => props.projection);
  const model = createMemo(() => buildPluginCenterModel(projection(), activeTab()));
  const allItems = createMemo(() => projection().items);
  const installOperationByInstanceID = createMemo(() => new Map(
    (props.installOperations ?? []).map((operation) => [operation.pluginInstanceID, operation]),
  ));
  const installOperationForItem = (item: PluginInventoryItem): PluginInstallExecutionProjection | undefined => {
    const pluginInstanceID = item.pluginInstanceID ?? item.officialCatalog?.pluginInstanceID;
    if (!pluginInstanceID) return undefined;
    const authoritative = installOperationByInstanceID().get(pluginInstanceID);
    const submitted = submittedInstallTarget();
    if (submitted?.pluginInstanceID === pluginInstanceID) {
      return authoritative ?? {
        pluginID: submitted.pluginID,
        pluginInstanceID,
        observation: 'starting',
        events: [],
      };
    }
    if (item.pluginInstanceID) return authoritative;
    if (!authoritative) return undefined;
    if (installOperationActive(authoritative)) return authoritative;
    if (authoritative.observation === 'refresh_failed') return authoritative;
    if (authoritative.execution?.status === 'failed') return authoritative;
    return undefined;
  };
  const installOperationActive = (projection: PluginInstallExecutionProjection): boolean => (
    projection.observation === 'starting'
    || projection.observation === 'reconnecting'
    || projection.observation === 'refreshing'
    || (
      projection.observation === 'watching'
      && projection.execution?.status !== 'completed'
      && projection.execution?.status !== 'canceled'
      && projection.execution?.status !== 'failed'
      && projection.execution?.status !== 'orphaned'
    )
  );
  const installPending = createMemo(() => (
    Boolean(submittedInstallTarget())
    || (props.installOperations ?? []).some(installOperationActive)
  ));
  const managementPending = createMemo(() => Boolean(pendingCommand()) || installPending());
  const pendingCommandTypeForItem = (item: PluginInventoryItem): PluginPendingCommandType | undefined => {
    const command = pendingCommand();
    const target = command?.target;
    if (target && (
      target === item.pluginInstanceID
      || target === item.pluginID
      || target === item.inventoryKey
    )) return command?.type;
    const submitted = submittedInstallTarget();
    if (submitted && (
      submitted.pluginInstanceID === item.pluginInstanceID
      || submitted.pluginInstanceID === item.officialCatalog?.pluginInstanceID
      || submitted.pluginID === item.pluginID
    )) return 'install';
    const operation = installOperationForItem(item);
    return operation && installOperationActive(operation) ? 'install' : undefined;
  };
  const itemManagementPending = (item: PluginInventoryItem) => {
    if (pendingCommandTypeForItem(item)) return true;
    const operation = installOperationForItem(item);
    return Boolean(operation && installOperationActive(operation));
  };
  createEffect(() => {
    const submitted = submittedInstallTarget();
    if (!submitted) return;
    const installed = allItems().find((item) => item.pluginInstanceID === submitted.pluginInstanceID);
    if (installed) {
      tabSelection.commitNow('installed');
      setSubmittedInstallTarget(undefined);
      return;
    }
    const operation = installOperationByInstanceID().get(submitted.pluginInstanceID);
    if (operation?.observation === 'failed' || operation?.execution?.status === 'failed') {
      setSubmittedInstallTarget(undefined);
    }
  });
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
    // The shell exposes an empty fallback before the inventory resource has
    // actually started. Do not let that transient value permanently select
    // Discover when persisted navigation opens Plugin Center on page load.
    if (initialTabResolved() || loading() || projection().items.length === 0) return;
    tabSelection.commitNow(initialTabForProjection(projection()));
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
  createEffect(() => {
    const item = selectedItem();
    if (!item?.officialCatalog || item.pluginInstanceID || !props.onLoadMarketDetail) {
      marketDetailController?.abort('Selection changed');
      marketDetailController = undefined;
      setMarketDetailState(undefined);
      return;
    }
    const pluginID = item.pluginID;
    const marketGeneration = item.officialCatalog.marketGeneration ?? 0;
    const cacheKey = `${marketGeneration}:${pluginID}`;
    const cached = marketDetailCache.get(cacheKey);
    const current = marketDetailState();
    if (current?.pluginID === pluginID && (current.loading || current.detail === cached)) return;
    if (cached) {
      setMarketDetailState({ pluginID, detail: cached, loading: false });
      return;
    }
    marketDetailController?.abort('Selection changed');
    const controller = new AbortController();
    marketDetailController = controller;
    setMarketDetailState({ pluginID, loading: true });
    void props.onLoadMarketDetail(pluginID, marketGeneration, controller.signal).then((detail) => {
      if (marketDetailController !== controller) return;
      if (detail.generation === undefined || detail.generation !== marketGeneration) {
        setMarketDetailState({ pluginID, error: new Error('Plugin market generation changed'), loading: false });
        return;
      }
      marketDetailCache.set(cacheKey, detail);
      setMarketDetailState({ pluginID, detail, loading: false });
    }).catch((error: unknown) => {
      if (marketDetailController !== controller || controller.signal.aborted) return;
      setMarketDetailState({ pluginID, error, loading: false });
    });
  });

  const retryMarketDetail = () => {
    const item = selectedItem();
    if (!item?.officialCatalog || item.pluginInstanceID || !props.onLoadMarketDetail) return;
    const marketGeneration = item.officialCatalog.marketGeneration ?? 0;
    marketDetailCache.delete(`${marketGeneration}:${item.pluginID}`);
    setMarketDetailState(undefined);
  };
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
      officialInstallInspectionController?.abort('Official installation inspection superseded');
      const controller = new AbortController();
      officialInstallInspectionController = controller;
      setOfficialInstallReviewItem(item);
      setOfficialInstallInspection(undefined);
      setOfficialInstallReviewError(undefined);
      setOfficialInstallReviewPending(true);
      void (props.onInspectOfficial?.(item, controller.signal)
        ?? Promise.reject(new Error(i18n.t('uiCopy.plugin.external.inspectFailed'))))
        .then((inspection) => {
          if (officialInstallInspectionController === controller) setOfficialInstallInspection(inspection);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted && officialInstallInspectionController === controller) {
            setOfficialInstallReviewError(messageFromUnknown(error) ?? undefined);
          }
        })
        .finally(() => {
          if (officialInstallInspectionController === controller) {
            officialInstallInspectionController = undefined;
            setOfficialInstallReviewPending(false);
          }
        });
      return;
    }
    openExternalDialog();
  };
  const confirmOfficialInstall = () => {
    const reviewed = officialInstallReviewItem();
    const inspection = officialInstallInspection();
    if (!reviewed?.officialCatalog || !inspection || officialInstallReviewPending()) return;
    const approvedPermissionIDs = [...new Set(inspection.security_summary.permissions
      .map((permission) => permission.permission_id))];
    setOfficialInstallReviewItem(undefined);
    setOfficialInstallInspection(undefined);
    setOfficialInstallReviewError(undefined);
    void runCommand({
      type: 'install',
      pluginID: reviewed.pluginID,
      source: 'official_catalog',
      ...(approvedPermissionIDs.length > 0 ? { approvedPermissionIDs } : {}),
    });
  };
  const currentUpdateReviewItem = createMemo(() => {
    const reviewed = updateReviewItem();
    if (!reviewed) return undefined;
    return allItems().find((item) => item.inventoryKey === reviewed.inventoryKey) ?? reviewed;
  });

  const runCommand = async (command: PluginLifecycleCommand) => {
    if (command.type === 'install') {
      const item = allItems().find((candidate) => candidate.pluginID === command.pluginID && candidate.officialCatalog);
      if (!item?.officialCatalog) {
        setCommandError(i18n.t('uiCopy.plugin.installOperation.failure.internal'));
        return;
      }
      setSubmittedInstallTarget({
        pluginID: command.pluginID,
        pluginInstanceID: item.officialCatalog.pluginInstanceID,
      });
      setCommandError(null);
      try {
        await props.onCommand(command, new AbortController().signal);
      } catch (error) {
        setSubmittedInstallTarget(undefined);
        setCommandError(messageFromUnknown(error));
      }
      return;
    }
    if (command.type === 'open_surface' ? pendingCommand() : managementPending()) return;
    const controller = new AbortController();
    commandController = controller;
    const pendingTarget = command.pluginInstanceID;
    setPendingCommand({ type: command.type, target: pendingTarget });
    setCommandError(null);
    try {
      await props.onCommand(command, controller.signal);
      setUninstallChoiceFor(null);
      if (command.type === 'uninstall') {
        clearDetailSelection();
        tabSelection.commitNow('discover');
      }
    } catch (error) {
      setCommandError(messageFromUnknown(error));
    } finally {
      if (commandController === controller) commandController = undefined;
      setPendingCommand(undefined);
    }
  };

  const openDetails = (inventoryKey: string, returnTarget: HTMLButtonElement) => {
    setProtectedSelectionInventoryKey(undefined);
    setSelectedInventoryKey(inventoryKey);
    mobileDetailReturnTarget = returnTarget;
    setMobileDetailOpen(true);
    queueMicrotask(() => {
      if (window.innerWidth < 640) mobileDetailBackButton?.focus({ preventScroll: true });
      else detailHeadingRef?.focus({ preventScroll: true });
    });
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
      marketDetailCache.clear();
      setMarketDetailState(undefined);
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
      keepPluginCenter: placement === 'activity',
    });
  };

  return (
    <PluginCenterShell
      query={query()}
      loading={loading()}
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
      runtimeRecovery={props.runtimeRecovery}
      onRetryRuntimeRecovery={props.onRetryRuntimeRecovery}
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
        class="relative flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row"
      >
        <div
          data-plugin-center-master
          class={cn(
            'min-h-0 min-w-0 w-full flex-1 flex-col border-b sm:w-auto sm:border-b-0',
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
                  runtimeRecovery={item.pluginInstanceID ? props.runtimeRecoveryByInstanceID?.[item.pluginInstanceID] : undefined}
                  onRetryRuntimeRecovery={item.pluginInstanceID ? () => props.onRetryRuntimeRecovery?.(item.pluginInstanceID) : undefined}
                  managementDisabled={loading() || itemManagementPending(item)}
                  commandPendingType={pendingCommandTypeForItem(item)}
                  installOperation={installOperationForItem(item)}
                  entranceDelayMs={Math.min(index() * 18, 126)}
                  onOpenDetails={(target) => openDetails(item.inventoryKey, target)}
                  onInstall={() => installItem(item)}
                  onUpdate={() => requestUpdate(item)}
                  onEnable={() => {
                    if (!item.pluginInstanceID || item.managementRevision === undefined) return;
                    void runCommand({
                      type: 'enable',
                      pluginInstanceID: item.pluginInstanceID,
                      expectedManagementRevision: item.managementRevision,
                    });
                  }}
                  onDisable={() => {
                    if (!item.pluginInstanceID || item.managementRevision === undefined) return;
                    void runCommand({
                      type: 'disable',
                      pluginInstanceID: item.pluginInstanceID,
                      expectedManagementRevision: item.managementRevision,
                    });
                  }}
                  onUninstall={() => {
                    if (!item.pluginInstanceID) return;
                    setSelectedInventoryKey(item.inventoryKey);
                    setMobileDetailOpen(true);
                    setUninstallChoiceFor(item.pluginInstanceID);
                  }}
                  onOpenActivity={() => openItemSurface(item, 'activity')}
                  onOpenWorkbench={() => openItemSurface(item, 'workbench')}
                  onRetryInstall={() => {
                    const pluginInstanceID = item.pluginInstanceID ?? item.officialCatalog?.pluginInstanceID;
                    if (pluginInstanceID) void props.onRetryInstall?.(pluginInstanceID);
                  }}
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
        <Show when={selectedItem() && mobileDetailOpen()}>
          <button
            type="button"
            data-plugin-center-drawer-backdrop
            aria-label={i18n.t('uiCopy.plugin.backToList')}
            class="absolute inset-0 z-10 cursor-default bg-[var(--redeven-overlay-scrim)] backdrop-blur-[1px]"
            onClick={closeDetails}
          />
        </Show>
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
              runtimeRecovery={item.pluginInstanceID ? props.runtimeRecoveryByInstanceID?.[item.pluginInstanceID] : undefined}
              managementPending={managementPending()}
              commandPendingType={pendingCommandTypeForItem(item)}
              installOperation={installOperationForItem(item)}
              uninstallChoiceFor={uninstallChoiceFor()}
              onCommand={(command) => void runCommand(command)}
              onAskUninstall={setUninstallChoiceFor}
              onExternalInstall={installItem}
              onExternalUpdate={requestUpdate}
              onRetryInstall={() => {
                const pluginInstanceID = item.pluginInstanceID ?? item.officialCatalog?.pluginInstanceID;
                if (pluginInstanceID) void props.onRetryInstall?.(pluginInstanceID);
              }}
              marketDetail={marketDetailState()?.pluginID === item.pluginID ? marketDetailState()?.detail : undefined}
              marketDetailLoading={marketDetailState()?.pluginID === item.pluginID && marketDetailState()?.loading === true}
              marketDetailError={marketDetailState()?.pluginID === item.pluginID ? marketDetailState()?.error : undefined}
              onRetryMarketDetail={retryMarketDetail}
            />
          )}
        </Show>
      </div>
      <OfficialPluginInstallDialog
        item={officialInstallReviewItem()}
        inspection={officialInstallInspection()}
        pending={officialInstallReviewPending()}
        error={officialInstallReviewError()}
        onOpenChange={(open) => {
          if (!open) {
            officialInstallInspectionController?.abort('Official installation review closed');
            officialInstallInspectionController = undefined;
            setOfficialInstallReviewItem(undefined);
            setOfficialInstallInspection(undefined);
            setOfficialInstallReviewPending(false);
            setOfficialInstallReviewError(undefined);
          }
        }}
        onConfirm={confirmOfficialInstall}
      />
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
        onOfficialUpdate={async (item, targetVersion) => {
          if (!item.pluginInstanceID || item.managementRevision === undefined) return;
          await runCommand({
            type: 'update',
            pluginID: item.pluginID,
            pluginInstanceID: item.pluginInstanceID,
            targetVersion,
            expectedManagementRevision: item.managementRevision,
          });
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

function OfficialPluginInstallDialog(props: {
  item?: PluginInventoryItem;
  inspection?: OfficialPluginReleaseInspection;
  pending: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}): JSX.Element {
  const i18n = useI18n();
  const permissions = () => (props.inspection?.security_summary.permissions ?? []).map((permission) => {
    const catalogPermission = props.item?.officialCatalog?.permissions?.find(
      (candidate) => candidate.permissionID === permission.permission_id,
    );
    return {
      permissionID: permission.permission_id,
      group: catalogPermission?.group ?? 'other' as const,
      requiredToOpen: catalogPermission?.requiredToOpen ?? true,
    };
  });
  return (
    <Dialog
      open={Boolean(props.item)}
      onOpenChange={props.onOpenChange}
      title={i18n.t('uiCopy.plugin.external.confirmInstallTitle')}
      description={i18n.t('uiCopy.plugin.external.confirmInstallGuidance')}
      class="w-[min(34rem,calc(100%-1rem))] max-w-[34rem] bg-background text-foreground sm:w-[min(34rem,calc(100%-2rem))]"
      footer={(
        <div class="flex w-full flex-wrap justify-end gap-2">
          <button
            type="button"
            class={cn(PLUGIN_MOBILE_TOUCH_TARGET_CLASS, 'cursor-pointer rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted')}
            onClick={() => props.onOpenChange(false)}
          >
            {i18n.t('common.actions.cancel')}
          </button>
          <button
            type="button"
            data-plugin-install-review-confirm
            class={cn(PLUGIN_MOBILE_TOUCH_TARGET_CLASS, 'cursor-pointer rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90')}
            onClick={props.onConfirm}
            disabled={props.pending || !props.inspection || Boolean(props.error)}
          >
            {i18n.t('uiCopy.plugin.external.confirmInstall')}
          </button>
        </div>
      )}
    >
      <Show when={props.item}>
        {(item) => (
          <div data-plugin-install-review-dialog class="space-y-4">
            <PluginIdentityHeader item={item()} description />
            <Show when={props.pending}>
              <p class="text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.external.inspecting')}</p>
            </Show>
            <Show when={props.error}>
              {(error) => <p role="alert" class="text-sm text-destructive">{error()}</p>}
            </Show>
            <section class="rounded-md border bg-muted/10 px-4 py-3">
              <h3 class="text-sm font-semibold">
                {i18n.t('uiCopy.plugin.permissionsTitle', { plugin: item().displayName })}
              </h3>
              <Show
                when={permissions().length > 0}
                fallback={<p class="mt-2 text-sm leading-6 text-muted-foreground">{i18n.t('uiCopy.plugin.permissionsResolvedDuringInstall')}</p>}
              >
                <div class="mt-2 divide-y">
                  <For each={permissions()}>
                    {(permission) => (
                      <div class="flex items-start gap-3 py-2.5" data-plugin-install-permission={permission.permissionID}>
                        <Shield class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="text-sm font-medium">{permissionLabel(permission.group, i18n)}</span>
                            <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                              {permission.requiredToOpen
                                ? i18n.t('uiCopy.plugin.requiredToOpen')
                                : i18n.t('uiCopy.plugin.optionalPermission')}
                            </span>
                          </div>
                          <p class="mt-1 text-xs leading-5 text-muted-foreground">
                            {permissionDescription(permission.group, i18n)}
                          </p>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </div>
        )}
      </Show>
    </Dialog>
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
  runtimeRecovery?: PluginRuntimeRecoveryPresentation;
  onRetryRuntimeRecovery?: () => Promise<unknown> | unknown;
  focusRequest?: number;
  onInstallExternal: () => void;
  onClose?: () => void;
  children: JSX.Element;
}): JSX.Element {
  const i18n = useI18n();
  const [runtimeRetryPending, setRuntimeRetryPending] = createSignal(false);
  createEffect(() => {
    if (props.runtimeRecovery?.state !== 'failed') setRuntimeRetryPending(false);
  });
  const retryRuntimeRecovery = () => {
    if (runtimeRetryPending() || !props.onRetryRuntimeRecovery) return;
    setRuntimeRetryPending(true);
    Promise.resolve(props.onRetryRuntimeRecovery())
      .catch(() => undefined)
      .finally(() => setRuntimeRetryPending(false));
  };
  const runtimeRecoveryTitle = () => {
    const reason = props.runtimeRecovery?.reason;
    if (!reason) return i18n.t('shell.status.connectionFailed');
    return i18n.t(`uiCopy.plugin.runtimeRecoveryReason.${reason}`);
  };
  const runtimeRecoveryGuidance = () => {
    const action = props.runtimeRecovery?.action;
    if (!action) return i18n.t('uiCopy.plugin.runtimeRecoveryFailed');
    return i18n.t(`uiCopy.plugin.runtimeRecoveryAction.${action}`);
  };
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
                data-plugin-center-close
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
      <Show when={props.runtimeRecovery}>
        {(recovery) => (
          <Show when={recovery().state !== 'ready'}>
            <div
              role={recovery().state === 'recovering' ? 'status' : 'alert'}
              data-plugin-runtime-recovery={recovery().state}
              class={cn(
                'flex flex-wrap items-center gap-3 border-b px-4 py-3 text-sm',
                recovery().state === 'recovering'
                  ? 'border-primary/30 bg-primary/5 text-foreground'
                  : 'border-destructive bg-background text-destructive',
                PLUGIN_ENTER_MOTION_CLASS,
              )}
            >
              <Show when={recovery().state === 'recovering'} fallback={<AlertTriangle class="h-4 w-4 shrink-0" />}>
                <RefreshIcon class="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
              </Show>
              <div class="min-w-0 flex-1">
                <div class="font-medium">
                  {recovery().state === 'recovering'
                    ? i18n.t('shell.status.preparingSecureSession')
                    : runtimeRecoveryTitle()}
                </div>
                <Show when={recovery().error}>
                  {(message) => <div class="mt-1 text-xs text-muted-foreground">{message()}</div>}
                </Show>
                <div class="mt-1 text-xs text-muted-foreground">
                  {recovery().state === 'recovering'
                    ? i18n.t('uiCopy.plugin.runtimeRecoveryInProgress')
                    : runtimeRecoveryGuidance()}
                </div>
              </div>
              <Show when={props.onRetryRuntimeRecovery && recovery().state === 'failed'}>
                <button
                  type="button"
                  data-plugin-runtime-recovery-retry
                  class={cn('min-h-[44px] cursor-pointer rounded-md border border-destructive px-3 text-xs font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9', PLUGIN_PRESS_MOTION_CLASS)}
                  aria-busy={runtimeRetryPending()}
                  disabled={runtimeRetryPending()}
                  onClick={retryRuntimeRecovery}
                >
                  {i18n.t('shell.status.retryNow')}
                </button>
              </Show>
            </div>
          </Show>
        )}
      </Show>
      {props.children}
    </section>
  );
}

export function PluginCenterDetails(props: {
  item?: PluginInventoryItem;
  marketDetail?: PluginMarketDetail;
  marketDetailLoading?: boolean;
  marketDetailError?: unknown;
  onRetryMarketDetail?: () => void;
  mobileOpen?: boolean;
  mobileBackRef?: (element: HTMLButtonElement) => void;
  detailHeadingRef?: (element: HTMLHeadingElement) => void;
  permissionsRef?: (element: HTMLElement) => void;
  onMobileBack?: () => void;
  canManage: boolean;
  canOpenSurfaces: boolean;
  runtimeRecovery?: PluginRuntimeRecoveryPresentation;
  managementPending: boolean;
  commandPendingType?: PluginPendingCommandType;
  installOperation?: PluginInstallExecutionProjection;
  uninstallChoiceFor: string | null;
  onCommand: (command: PluginLifecycleCommand) => void;
  onAskUninstall: (pluginInstanceID: string) => void;
  onExternalInstall: (item: PluginInventoryItem) => void;
  onExternalUpdate: (item: PluginInventoryItem) => void;
  onRetryInstall?: () => void;
}): JSX.Element {
  const i18n = useI18n();
  return (
    <aside
      data-plugin-center-details={props.item?.inventoryKey ?? ''}
      role="dialog"
      aria-modal="true"
      aria-labelledby={props.item ? 'plugin-center-detail-heading' : undefined}
      class={cn('absolute inset-y-0 right-0 z-20 min-h-0 w-full max-w-full overflow-hidden border-l bg-background shadow-2xl sm:relative sm:inset-auto sm:h-full sm:w-[420px] sm:max-w-[min(420px,calc(100vw-2rem))] sm:shrink-0', props.mobileOpen === false ? 'hidden' : 'redeven-plugin-motion block animate-in fade-in slide-in-from-right-2 duration-200 ease-out motion-reduce:animate-none')}
    >
      <Show
        when={props.item}
        fallback={<div class="px-4 py-8 text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.selectOfficial')}</div>}
      >
        {(item) => (
          <div class="flex h-full min-h-0 flex-col">
            <div class="shrink-0 space-y-4 border-b px-4 py-4" data-plugin-detail-controls>
              <div class="flex items-center justify-between gap-3">
                <Button
                ref={props.mobileBackRef}
                data-plugin-center-mobile-back
                size="sm"
                variant="ghost"
                icon={ArrowLeft}
                class="min-h-[44px] min-w-[44px] sm:hidden"
                onClick={props.onMobileBack}
              >
                {i18n.t('uiCopy.plugin.backToList')}
                </Button>
                <button
                  type="button"
                  data-plugin-center-drawer-close
                  class="ml-auto inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-10 sm:w-10"
                  aria-label={i18n.t('uiCopy.plugin.backToList')}
                  title={i18n.t('uiCopy.plugin.backToList')}
                  onClick={props.onMobileBack}
                >
                  <X class="h-4 w-4" />
                </button>
              </div>
              <PluginIdentityHeader item={item()} description headingRef={props.detailHeadingRef} />

              <Show when={props.runtimeRecovery}>
                {(recovery) => (
                  <Show when={recovery().state !== 'ready'}>
                    <div
                      role={recovery().state === 'failed' ? 'alert' : 'status'}
                      data-plugin-runtime-recovery={recovery().state}
                      class={cn('text-xs', recovery().state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}
                    >
                      {recovery().state === 'recovering'
                        ? i18n.t('uiCopy.plugin.runtimeRecoveryPluginInProgress')
                        : recovery().error ?? i18n.t('uiCopy.plugin.runtimeRecoveryPluginFailed')}
                    </div>
                  </Show>
                )}
              </Show>

              <PluginActions
                item={item()}
                canManage={props.canManage}
                canOpenSurfaces={props.canOpenSurfaces}
                managementPending={props.managementPending}
                commandPendingType={props.commandPendingType}
                installOperation={props.installOperation}
                onCommand={props.onCommand}
                onAskUninstall={props.onAskUninstall}
                onExternalInstall={props.onExternalInstall}
                onExternalUpdate={props.onExternalUpdate}
                onRetryInstall={props.onRetryInstall}
              />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-plugin-detail-scroll-body>
              <div class="space-y-4">
                <PluginAuthorContent
                  item={item()}
                  marketDetail={props.marketDetail}
                  loading={props.marketDetailLoading}
                  error={props.marketDetailError}
                  onRetry={props.onRetryMarketDetail}
                />

                <PluginPermissionInventory
                  item={item()}
                  canManage={props.canManage}
                  commandPending={props.managementPending}
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
                  pending={props.managementPending}
                  onClose={() => props.onAskUninstall('')}
                  onCommand={props.onCommand}
                />
              </div>
            </div>
          </div>
        )}
      </Show>
    </aside>
  );
}

function PluginAuthorContent(props: {
  item: PluginInventoryItem;
  marketDetail?: PluginMarketDetail;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}): JSX.Element {
  const i18n = useI18n();
  const presentation = () => {
    if (props.item.presentation) return resolveAuthorPresentation(props.item.presentation, i18n.locale());
    if (!props.item.pluginInstanceID && props.marketDetail) return resolveAuthorPresentation(props.marketDetail.presentation, i18n.locale());
    return undefined;
  };
  return (
    <section class="min-w-0 space-y-4" data-plugin-author-content>
      <Show when={props.loading}>
        <div class="rounded-md border bg-muted/20 px-3 py-3 text-xs text-muted-foreground" role="status">
          {i18n.t('uiCopy.plugin.loadingOfficial')}
        </div>
      </Show>
      <Show when={props.error}>
        <div class="flex min-w-0 items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-xs text-destructive" role="alert">
          <span class="min-w-0 flex-1">{i18n.t('uiCopy.plugin.marketUnavailable')}</span>
          <Button size="sm" variant="outline" icon={RefreshIcon} onClick={props.onRetry}>
            {i18n.t('common.actions.retry')}
          </Button>
        </div>
      </Show>
      <Show when={presentation()}>
        {(resolved) => (
          <div class="min-w-0 space-y-4" lang={resolved().resolved_locale} dir="auto">
            <div class="space-y-2" data-plugin-author-description>
              <For each={resolved().description}>
                {(paragraph) => <p class="text-sm leading-6 text-foreground">{paragraph}</p>}
              </For>
            </div>
            <Show when={resolved().highlights.length > 0}>
              <ul class="space-y-2 text-sm leading-6 text-foreground" data-plugin-author-highlights>
                <For each={resolved().highlights}>
                  {(highlight) => <li class="flex items-start gap-2"><span aria-hidden="true" class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>{highlight}</span></li>}
                </For>
              </ul>
            </Show>
          </div>
        )}
      </Show>
    </section>
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
  managementPending: boolean;
  commandPendingType?: PluginPendingCommandType;
  installOperation?: PluginInstallExecutionProjection;
  onCommand: (command: PluginLifecycleCommand) => void;
  onAskUninstall: (pluginInstanceID: string) => void;
  onExternalInstall: (item: PluginInventoryItem) => void;
  onExternalUpdate: (item: PluginInventoryItem) => void;
  onRetryInstall?: () => void;
}) {
  const i18n = useI18n();
  const presentation = () => presentPlugin(props.item);
  const disabledManagement = () => !props.canManage || props.managementPending;
  const commandPending = () => props.commandPendingType !== undefined;
  const disabledOpen = () => commandPending() || !props.canOpenSurfaces;
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
      keepPluginCenter: placement === 'activity',
    });
  };
  const primaryActionLabel = (action: PluginPrimaryAction) => {
    switch (action) {
      case 'install': return i18n.t('uiCopy.plugin.install');
      case 'enable': return i18n.t('uiCopy.plugin.enable');
      case 'open_activity': return i18n.t('common.actions.open');
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
    ...(presentation().canOpenActivity ? [{ id: 'activity', label: i18n.t('common.actions.open'), disabled: disabledOpen() }] : []),
    ...(presentation().canOpenWorkbench ? [{ id: 'workbench', label: i18n.t('uiCopy.plugin.openInWorkbench'), disabled: disabledOpen() }] : []),
    ...(presentation().canDisable ? [{ id: 'disable', label: i18n.t('uiCopy.plugin.disable'), disabled: disabledManagement() }] : []),
    ...(presentation().canCheckForUpdate ? [{ id: 'update', label: i18n.t('uiCopy.plugin.checkForUpdate'), disabled: disabledManagement() }] : []),
    ...(presentation().canUninstall ? [
      { id: 'danger-separator', label: '', separator: true },
      { id: 'uninstall', label: i18n.t('uiCopy.plugin.uninstall'), disabled: disabledManagement() },
    ] : []),
  ];
  const selectOverflowAction = (action: string) => {
    if (action === 'activity') {
      openSurface('activity');
    } else if (action === 'workbench') {
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
      <Show when={props.installOperation}>
        {(operation) => (
          <div class="mb-3">
            <PluginInstallStatus
              projection={operation()}
              pluginName={item().displayName}
              onRetry={props.onRetryInstall}
            />
          </div>
        )}
      </Show>
      <div class="flex min-w-0 items-center gap-2" data-plugin-action-row>
        <Button
          data-plugin-action={primaryActionDataID(presentation().primaryAction)}
          variant="primary"
          size="sm"
          class="min-h-[44px] min-w-0 flex-1 justify-center text-xs sm:min-h-8"
          loading={commandPending()}
          disabled={primaryDisabled()}
          icon={primaryActionIcon(presentation().primaryAction)}
          onClick={runPrimaryAction}
        >
          {props.commandPendingType
            ? pluginPendingCommandLabel(props.commandPendingType, i18n)
            : primaryActionLabel(presentation().primaryAction)}
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
  let wasOpen = false;
  createEffect(() => {
    const open = props.open;
    if (open && !wasOpen) {
      setRetention('keep_data');
    }
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
            onClick={submit}
          >
            {i18n.t('uiCopy.plugin.uninstall')}
          </Button>
        </div>
      )}
    >
      <div class="space-y-4">
        <PluginIdentityHeader item={props.item} />
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
      </div>
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
        props.checked
          ? props.destructive
            ? 'border-destructive bg-destructive/10 ring-1 ring-destructive/40'
            : 'border-primary bg-primary/10 ring-1 ring-primary/35'
          : 'border-border hover:bg-muted/50',
      )}
      data-selected={props.checked ? 'true' : 'false'}
      onClick={props.onSelect}
    >
      <span
        aria-hidden="true"
        class={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
          props.checked
            ? props.destructive ? 'border-destructive' : 'border-primary'
            : 'border-muted-foreground/50',
        )}
      >
        <Show when={props.checked}>
          <span class={cn('h-2.5 w-2.5 rounded-full', props.destructive ? 'bg-destructive' : 'bg-primary')} />
        </Show>
      </span>
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
    case 'enable': return Play;
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
    const presentation = item.presentation
      ? resolveAuthorPresentation(item.presentation, locale)
      : !item.pluginInstanceID && item.officialCatalog
        ? resolvePluginPresentation(item.officialCatalog, locale)
        : undefined;
    const fields = [
      presentation?.plugin_name ?? item.displayName,
      presentation?.summary ?? item.description,
      presentation?.publisher_name ?? item.publisher,
      item.pluginID,
      pluginLifecycleLabel(item, i18n),
      item.officialCatalog?.stableVersion,
      item.version,
      centerCategoryLabel(item.category, i18n),
      ...(presentation?.keywords ?? item.searchKeywords),
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
