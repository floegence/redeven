import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn, createUIFirstSelection } from '@floegence/floe-webapp-core';
import { CheckCircle, Download, Grid3x3, RefreshIcon, Search, Settings, Trash, X } from '@floegence/floe-webapp-core/icons';

import { buildPluginCenterModel } from './pluginInventoryProjection';
import { useI18n, type I18nHelpers } from '../i18n';
import type {
  PluginCenterTab,
  PluginInventoryItem,
  PluginInventoryProjection,
  PluginLifecycleCommand,
} from './pluginTypes';
import { createUIPresentationEventRecorder } from '../services/uiPresentationTransactions';

export type PluginCenterViewProps = {
  projection: PluginInventoryProjection;
  loading: boolean;
  error?: unknown;
  selectedPluginID?: string;
  canManagePlugins: boolean;
  canOpenPluginSurfaces: boolean;
  onClose?: () => void;
  onRefresh: () => Promise<unknown> | unknown;
  onCommand: (command: PluginLifecycleCommand, signal: AbortSignal) => Promise<unknown> | unknown;
};

export function PluginCenterView(props: PluginCenterViewProps): JSX.Element {
  const i18n = useI18n();
  const [activeTab, setActiveTab] = createSignal<PluginCenterTab>(initialTabForProjection(props.projection));
  const [initialTabResolved, setInitialTabResolved] = createSignal(Boolean(props.projection));
  const [query, setQuery] = createSignal('');
  const [selectedPluginID, setSelectedPluginID] = createSignal<string | undefined>(props.selectedPluginID);
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [commandPending, setCommandPending] = createSignal(false);
  const [uninstallChoiceFor, setUninstallChoiceFor] = createSignal<string | null>(null);
  let commandController: AbortController | undefined;

  onCleanup(() => commandController?.abort('Plugin Center disposed'));

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
  const visibleItems = createMemo(() => filterItems(tabItems(), query(), i18n));
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
    const requestedID = props.selectedPluginID;
    if (!requestedID) return;
    setSelectedPluginID(requestedID);
    const requestedItem = allItems().find((item) => item.pluginID === requestedID);
    if (requestedItem) {
      tabSelection.commitNow(tabForItem(requestedItem));
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
    const items = visibleItems();
    const currentID = selectedPluginID();
    if (currentID && items.some((item) => item.pluginID === currentID)) {
      return;
    }
    setSelectedPluginID(items[0]?.pluginID);
  });

  const selectedItem = createMemo(() => (
    visibleItems().find((item) => item.pluginID === selectedPluginID()) ??
    allItems().find((item) => item.pluginID === selectedPluginID()) ??
    visibleItems()[0]
  ));

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

  return (
    <PluginCenterShell
      query={query()}
      loading={loading() || commandPending()}
      activeTab={tabSelection.visual()}
      installedCount={model().installed.length}
      discoverCount={model().discover.length}
      updatesCount={model().updates.length}
      onQueryInput={setQuery}
      onRefresh={() => void props.onRefresh()}
      onTabSelect={tabSelection.request}
      onClose={props.onClose}
    >
      <Show when={errorMessage()}>
        <div class="border-b border-destructive/25 bg-destructive/10 px-4 py-2 text-sm text-destructive">{errorMessage()}</div>
      </Show>
      <div data-plugin-center-shell class="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div class="flex min-h-0 w-full flex-col border-b lg:w-[min(430px,42vw)] lg:border-b-0 lg:border-r">
          <div data-plugin-center-list class="min-h-0 flex-1 overflow-y-auto">
            <Show when={loading()}>
              <div class="border-b px-4 py-3 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.loadingOfficial')}</div>
            </Show>
            <For each={visibleItems()}>
              {(item) => (
                <button
                  type="button"
                  data-plugin-center-item={item.pluginID}
                  class={cn(
                    'flex w-full cursor-pointer items-start gap-3 border-b px-4 py-3 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selectedItem()?.pluginID === item.pluginID ? 'bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]' : 'bg-background',
                  )}
                  onClick={() => setSelectedPluginID(item.pluginID)}
                >
                  <PluginIcon item={item} class="mt-0.5" />
                  <span class="min-w-0 flex-1">
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-sm font-semibold text-foreground">{item.displayName}</span>
                      <span class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{i18n.t('uiCopy.plugin.official')}</span>
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
              <div class="px-4 py-10 text-center text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.emptyView')}</div>
            </Show>
          </div>
        </div>
        <PluginCenterDetails
          item={selectedItem()}
          canManage={canManage()}
          canOpenSurfaces={canOpenSurfaces()}
          commandPending={commandPending()}
          uninstallChoiceFor={uninstallChoiceFor()}
          onCommand={(command) => void runCommand(command)}
          onAskUninstall={setUninstallChoiceFor}
        />
      </div>
    </PluginCenterShell>
  );
}

export function PluginCenterShell(props: {
  query: string;
  loading: boolean;
  activeTab: PluginCenterTab;
  installedCount: number;
  discoverCount: number;
  updatesCount: number;
  onQueryInput: (query: string) => void;
  onRefresh: () => void;
  onTabSelect: (tab: PluginCenterTab) => void;
  onClose?: () => void;
  children: JSX.Element;
}): JSX.Element {
  const i18n = useI18n();
  return (
    <section data-plugin-center-view class="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div class="shrink-0 border-b bg-background/95 px-4 py-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h1 class="truncate text-lg font-semibold tracking-tight">{i18n.t('uiCopy.plugin.centerTitle')}</h1>
              <span class="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">{i18n.t('uiCopy.plugin.officialOnly')}</span>
            </div>
            <p class="mt-1 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.catalogDescription')}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <label class="relative block w-[min(320px,52vw)]">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                data-plugin-center-search
                type="search"
                value={props.query}
                onInput={(event) => props.onQueryInput(event.currentTarget.value)}
                placeholder={i18n.t('uiCopy.plugin.searchPlaceholder')}
                class="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <button
              type="button"
              data-plugin-center-refresh
              class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={i18n.t('uiCopy.plugin.refreshOfficial')}
              disabled={props.loading}
              onClick={props.onRefresh}
            >
              <RefreshIcon class="h-3.5 w-3.5" />
            </button>
            <Show when={props.onClose}>
              <button
                type="button"
                class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label={i18n.t('uiCopy.plugin.closeCenter')}
                onClick={() => props.onClose?.()}
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </Show>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-1">
          <TabButton id="discover" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.discoverCount', { count: props.discoverCount })} />
          <TabButton id="installed" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.installedCount', { count: props.installedCount })} />
          <TabButton id="updates" active={props.activeTab} onSelect={props.onTabSelect} label={i18n.t('uiCopy.plugin.updatesCount', { count: props.updatesCount })} />
        </div>
      </div>
      {props.children}
    </section>
  );
}

export function PluginCenterDetails(props: {
  item?: PluginInventoryItem;
  canManage: boolean;
  canOpenSurfaces: boolean;
  commandPending: boolean;
  uninstallChoiceFor: string | null;
  onCommand: (command: PluginLifecycleCommand) => void;
  onAskUninstall: (pluginInstanceID: string) => void;
}): JSX.Element {
  const i18n = useI18n();
  return (
    <aside data-plugin-center-details class="min-h-0 flex-1 overflow-y-auto">
      <Show
        when={props.item}
        fallback={<div class="px-5 py-10 text-sm text-muted-foreground">{i18n.t('uiCopy.plugin.selectOfficial')}</div>}
      >
        {(item) => (
          <div class="space-y-5 px-5 py-5">
            <div class="flex items-start gap-3">
              <PluginIcon item={item()} size="lg" />
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="truncate text-xl font-semibold tracking-tight">{item().displayName}</h2>
                  <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{i18n.t('uiCopy.plugin.official')}</span>
                  <span class={statusPillClass(item())}>{statusLabel(item(), i18n)}</span>
                </div>
                <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{item().description}</p>
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <DetailStat label={i18n.t('uiCopy.plugin.publisher')} value={item().publisher} />
              <DetailStat label={i18n.t('uiCopy.plugin.installedVersion')} value={item().version ?? i18n.t('uiCopy.plugin.notInstalled')} />
              <DetailStat label={i18n.t('uiCopy.plugin.stableVersion')} value={item().officialCatalog?.stableVersion ?? '-'} />
              <DetailStat label={i18n.t('uiCopy.plugin.minimumRedeven')} value={item().officialCatalog?.minRedevenVersion ?? '-'} />
              <DetailStat label={i18n.t('uiCopy.plugin.minimumReDevPlugin')} value={item().officialCatalog?.minReDevPluginVersion ?? '-'} />
              <DetailStat label={i18n.t('uiCopy.plugin.trust')} value={trustLabel(item(), i18n)} />
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{i18n.t('uiCopy.plugin.lifecycle')}</h3>
              <div class="mt-2 flex flex-wrap gap-2">
                <PluginActions
                  item={item()}
                  canManage={props.canManage}
                  canOpenSurfaces={props.canOpenSurfaces}
                  commandPending={props.commandPending}
                  onCommand={props.onCommand}
                  onAskUninstall={props.onAskUninstall}
                />
              </div>
              <Show when={props.uninstallChoiceFor === item().pluginInstanceID}>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="cursor-pointer rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={props.commandPending}
                    onClick={() => props.onCommand({
                      type: 'uninstall',
                      pluginInstanceID: item().pluginInstanceID!,
                      expectedManagementRevision: item().managementRevision!,
                      dataRetention: 'keep_data',
                    })}
                  >
                    {i18n.t('uiCopy.plugin.keepData')}
                  </button>
                  <button
                    type="button"
                    class="cursor-pointer rounded-md border border-destructive/30 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={props.commandPending}
                    onClick={() => props.onCommand({
                      type: 'uninstall',
                      pluginInstanceID: item().pluginInstanceID!,
                      expectedManagementRevision: item().managementRevision!,
                      dataRetention: 'delete_data',
                    })}
                  >
                    {i18n.t('uiCopy.plugin.deleteData')}
                  </button>
                </div>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </aside>
  );
}

function TabButton(props: {
  id: PluginCenterTab;
  active: PluginCenterTab;
  label: string;
  onSelect: (tab: PluginCenterTab) => void;
}) {
  const isActive = () => props.id === props.active;
  return (
    <button
      type="button"
      class={cn(
        'cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition',
        isActive() ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={() => props.onSelect(props.id)}
    >
      {props.label}
    </button>
  );
}

function PluginActions(props: {
  item: PluginInventoryItem;
  canManage: boolean;
  canOpenSurfaces: boolean;
  commandPending: boolean;
  onCommand: (command: PluginLifecycleCommand) => void;
  onAskUninstall: (pluginInstanceID: string) => void;
}) {
  const i18n = useI18n();
  const disabledManagement = () => !props.canManage || props.commandPending;
  const item = () => props.item;
  return (
    <>
      <Show when={item().lifecycleState === 'not_installed'}>
        <button
          type="button"
          data-plugin-action="install"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabledManagement()}
          onClick={() => props.onCommand({ type: 'install', pluginID: item().pluginID, source: 'official_catalog' })}
        >
          <Download class="h-3.5 w-3.5" />
          {i18n.t('uiCopy.plugin.install')}
        </button>
      </Show>
      <Show when={item().lifecycleState === 'enabled' && item().defaultLaunchTarget}>
        <button
          type="button"
          data-plugin-action="open"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabledManagement() || !props.canOpenSurfaces}
          onClick={() => {
            const target = item().defaultLaunchTarget!;
            props.onCommand({
              type: 'open_surface',
              pluginID: target.pluginID,
              pluginInstanceID: target.pluginInstanceID,
              surfaceID: target.surfaceID,
              expectedManagementRevision: target.expectedManagementRevision,
              placement: target.preferredPlacement,
            });
          }}
        >
          <CheckCircle class="h-3.5 w-3.5" />
          {i18n.t('common.actions.open')}
        </button>
      </Show>
      <Show when={canEnablePlugin(item())}>
        <button
          type="button"
          data-plugin-action="enable"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabledManagement()}
          onClick={() => props.onCommand({
            type: 'enable',
            pluginInstanceID: item().pluginInstanceID!,
            expectedManagementRevision: item().managementRevision!,
          })}
        >
          <Settings class="h-3.5 w-3.5" />
          {i18n.t('uiCopy.plugin.enable')}
        </button>
      </Show>
      <Show when={item().pluginInstanceID && item().lifecycleState === 'enabled'}>
        <button
          type="button"
          data-plugin-action="disable"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabledManagement()}
          onClick={() => props.onCommand({
            type: 'disable',
            pluginInstanceID: item().pluginInstanceID!,
            expectedManagementRevision: item().managementRevision!,
          })}
        >
          <Settings class="h-3.5 w-3.5" />
          {i18n.t('uiCopy.plugin.disable')}
        </button>
      </Show>
      <Show when={item().lifecycleState === 'update_available' && item().pluginInstanceID}>
        <button
          type="button"
          data-plugin-action="update"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabledManagement()}
          onClick={() => props.onCommand({
            type: 'update',
            pluginID: item().pluginID,
            pluginInstanceID: item().pluginInstanceID!,
            expectedManagementRevision: item().managementRevision!,
            targetVersion: item().officialCatalog?.stableVersion ?? '',
          })}
        >
          <RefreshIcon class="h-3.5 w-3.5" />
          {i18n.t('uiCopy.plugin.update')}
        </button>
      </Show>
      <Show when={item().pluginInstanceID}>
        <button
          type="button"
          data-plugin-action="uninstall"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border border-destructive/30 px-2.5 py-1 text-xs font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabledManagement()}
          onClick={() => props.onAskUninstall(item().pluginInstanceID!)}
        >
          <Trash class="h-3.5 w-3.5" />
          {i18n.t('uiCopy.plugin.uninstall')}
        </button>
      </Show>
    </>
  );
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
  return (
    <span
      class={cn(
        'flex shrink-0 items-center justify-center rounded-md bg-muted text-foreground',
        props.size === 'lg' ? 'h-12 w-12' : 'h-10 w-10',
        props.class,
      )}
    >
      <Grid3x3 class={props.size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
    </span>
  );
}

function filterItems(items: readonly PluginInventoryItem[], rawQuery: string, i18n: I18nHelpers): PluginInventoryItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [...items];
  return items.filter((item) => {
    const fields = [
      item.displayName,
      item.description,
      item.publisher,
      item.pluginID,
      statusLabel(item, i18n),
      item.officialCatalog?.stableVersion,
      item.version,
    ];
    return fields.some((field) => String(field ?? '').toLowerCase().includes(query));
  });
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

function canEnablePlugin(item: PluginInventoryItem): boolean {
  return Boolean(item.pluginInstanceID) && (item.lifecycleState === 'disabled' || item.lifecycleState === 'installed');
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

function trustLabel(item: PluginInventoryItem, i18n: I18nHelpers): string {
  switch (item.trustBadge) {
    case 'official':
      return i18n.t('uiCopy.plugin.official');
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
