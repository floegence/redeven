import { For, Show, createEffect, createMemo, createResource, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { CheckCircle, Download, Grid3x3, RefreshIcon, Search, Settings, Trash, X } from '@floegence/floe-webapp-core/icons';

import { buildPluginCenterModel } from './pluginInventoryProjection';
import { executePluginLifecycleCommand, loadPluginInventoryProjection } from './pluginApi';
import type {
  PluginCenterTab,
  PluginInventoryItem,
  PluginInventoryProjection,
  PluginLifecycleCommand,
} from './pluginTypes';

type PluginCenterResourceSource = PluginInventoryProjection | 'live';

export type PluginCenterViewProps = {
  projection?: PluginInventoryProjection;
  loading?: boolean;
  error?: unknown;
  selectedPluginID?: string;
  canManagePlugins?: boolean;
  canOpenPluginSurfaces?: boolean;
  onClose?: () => void;
  onCommand?: (command: PluginLifecycleCommand) => Promise<unknown> | unknown;
};

export function PluginCenterView(props: PluginCenterViewProps = {}): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<PluginCenterTab>(initialTabForProjection(props.projection));
  const [initialTabResolved, setInitialTabResolved] = createSignal(Boolean(props.projection));
  const [query, setQuery] = createSignal('');
  const [selectedPluginID, setSelectedPluginID] = createSignal<string | undefined>(props.selectedPluginID);
  const [resource, { refetch }] = createResource<PluginInventoryProjection, PluginCenterResourceSource>(
    () => props.projection ?? 'live',
    async (source) => (source === 'live' ? loadPluginInventoryProjection() : source),
  );
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [uninstallChoiceFor, setUninstallChoiceFor] = createSignal<string | null>(null);

  const projection = createMemo(() => props.projection ?? resource() ?? { items: [] });
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
  const visibleItems = createMemo(() => filterItems(tabItems(), query()));
  const loading = createMemo(() => props.loading ?? resource.loading);
  const errorMessage = createMemo(() => messageFromUnknown(props.error ?? resource.error ?? commandError()));
  const canManage = createMemo(() => props.canManagePlugins ?? true);
  const canOpenSurfaces = createMemo(() => props.canOpenPluginSurfaces ?? false);

  createEffect(() => {
    const requestedID = props.selectedPluginID;
    if (!requestedID) return;
    setSelectedPluginID(requestedID);
    const requestedItem = allItems().find((item) => item.pluginID === requestedID);
    if (requestedItem) {
      setActiveTab(tabForItem(requestedItem));
    }
  });

  createEffect(() => {
    if (initialTabResolved() || loading()) return;
    const next = model();
    if (next.installed.length === 0 && next.discover.length > 0) {
      setActiveTab('discover');
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
    setCommandError(null);
    try {
      if (props.onCommand) {
        await props.onCommand(command);
        if (command.type !== 'open_surface') {
          await refetch();
        }
      } else {
        await executePluginLifecycleCommand(command);
        await refetch();
      }
      setUninstallChoiceFor(null);
    } catch (error) {
      setCommandError(messageFromUnknown(error));
    }
  };

  return (
    <PluginCenterShell
      query={query()}
      loading={loading()}
      activeTab={activeTab()}
      installedCount={model().installed.length}
      discoverCount={model().discover.length}
      updatesCount={model().updates.length}
      onQueryInput={setQuery}
      onRefresh={() => void refetch()}
      onTabSelect={setActiveTab}
      onClose={props.onClose}
    >
      <Show when={errorMessage()}>
        <div class="border-b border-destructive/25 bg-destructive/10 px-4 py-2 text-sm text-destructive">{errorMessage()}</div>
      </Show>
      <div data-plugin-center-shell class="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div class="flex min-h-0 w-full flex-col border-b lg:w-[min(430px,42vw)] lg:border-b-0 lg:border-r">
          <div data-plugin-center-list class="min-h-0 flex-1 overflow-y-auto">
            <Show when={loading()}>
              <div class="border-b px-4 py-3 text-sm text-muted-foreground">Loading official plugins...</div>
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
                      <span class="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Official</span>
                    </span>
                    <span class="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</span>
                    <span class="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span class={statusPillClass(item)}>{statusLabel(item)}</span>
                      <Show when={item.version}>
                        <span class="text-muted-foreground">v{item.version}</span>
                      </Show>
                    </span>
                  </span>
                </button>
              )}
            </For>
            <Show when={!loading() && visibleItems().length === 0}>
              <div class="px-4 py-10 text-center text-sm text-muted-foreground">No official plugins in this view.</div>
            </Show>
          </div>
        </div>
        <PluginCenterDetails
          item={selectedItem()}
          canManage={canManage()}
          canOpenSurfaces={canOpenSurfaces()}
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
  return (
    <section data-plugin-center-view class="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div class="shrink-0 border-b bg-background/95 px-4 py-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h1 class="truncate text-lg font-semibold tracking-tight">Plugin Center</h1>
              <span class="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">Official only</span>
            </div>
            <p class="mt-1 text-sm text-muted-foreground">Redeven official catalog for this runtime.</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <label class="relative block w-[min(320px,52vw)]">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                data-plugin-center-search
                type="search"
                value={props.query}
                onInput={(event) => props.onQueryInput(event.currentTarget.value)}
                placeholder="Search official plugins"
                class="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <button
              type="button"
              data-plugin-center-refresh
              class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Refresh official plugins"
              disabled={props.loading}
              onClick={props.onRefresh}
            >
              <RefreshIcon class="h-3.5 w-3.5" />
            </button>
            <Show when={props.onClose}>
              <button
                type="button"
                class="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Close Plugin Center"
                onClick={() => props.onClose?.()}
              >
                <X class="h-3.5 w-3.5" />
              </button>
            </Show>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-1">
          <TabButton id="discover" active={props.activeTab} onSelect={props.onTabSelect} label={`Discover (${props.discoverCount})`} />
          <TabButton id="installed" active={props.activeTab} onSelect={props.onTabSelect} label={`Installed (${props.installedCount})`} />
          <TabButton id="updates" active={props.activeTab} onSelect={props.onTabSelect} label={`Updates (${props.updatesCount})`} />
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
  uninstallChoiceFor: string | null;
  onCommand: (command: PluginLifecycleCommand) => void;
  onAskUninstall: (pluginInstanceID: string) => void;
}): JSX.Element {
  return (
    <aside data-plugin-center-details class="min-h-0 flex-1 overflow-y-auto">
      <Show
        when={props.item}
        fallback={<div class="px-5 py-10 text-sm text-muted-foreground">Select an official plugin.</div>}
      >
        {(item) => (
          <div class="space-y-5 px-5 py-5">
            <div class="flex items-start gap-3">
              <PluginIcon item={item()} size="lg" />
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="truncate text-xl font-semibold tracking-tight">{item().displayName}</h2>
                  <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Official</span>
                  <span class={statusPillClass(item())}>{statusLabel(item())}</span>
                </div>
                <p class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{item().description}</p>
              </div>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <DetailStat label="Publisher" value={item().publisher} />
              <DetailStat label="Installed version" value={item().version ?? 'Not installed'} />
              <DetailStat label="Stable version" value={item().officialCatalog?.stableVersion ?? '-'} />
              <DetailStat label="Minimum Redeven" value={item().officialCatalog?.minRedevenVersion ?? '-'} />
              <DetailStat label="Minimum ReDevPlugin" value={item().officialCatalog?.minReDevPluginVersion ?? '-'} />
              <DetailStat label="Trust" value={trustLabel(item())} />
            </div>

            <div>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lifecycle</h3>
              <div class="mt-2 flex flex-wrap gap-2">
                <PluginActions
                  item={item()}
                  canManage={props.canManage}
                  canOpenSurfaces={props.canOpenSurfaces}
                  onCommand={props.onCommand}
                  onAskUninstall={props.onAskUninstall}
                />
              </div>
              <Show when={props.uninstallChoiceFor === item().pluginInstanceID}>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="cursor-pointer rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                    onClick={() => props.onCommand({ type: 'uninstall', pluginInstanceID: item().pluginInstanceID!, dataRetention: 'keep_data' })}
                  >
                    Keep data
                  </button>
                  <button
                    type="button"
                    class="cursor-pointer rounded-md border border-destructive/30 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                    onClick={() => props.onCommand({ type: 'uninstall', pluginInstanceID: item().pluginInstanceID!, dataRetention: 'delete_data' })}
                  >
                    Delete data
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
  onCommand: (command: PluginLifecycleCommand) => void;
  onAskUninstall: (pluginInstanceID: string) => void;
}) {
  const disabledManagement = () => !props.canManage;
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
          Install
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
              pluginInstanceID: target.pluginInstanceID,
              surfaceID: target.surfaceID,
              placement: target.preferredPlacement,
            });
          }}
        >
          <CheckCircle class="h-3.5 w-3.5" />
          Open
        </button>
      </Show>
      <Show when={canEnablePlugin(item())}>
        <button
          type="button"
          data-plugin-action="enable"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabledManagement()}
          onClick={() => props.onCommand({ type: 'enable', pluginInstanceID: item().pluginInstanceID! })}
        >
          <Settings class="h-3.5 w-3.5" />
          Enable
        </button>
      </Show>
      <Show when={item().pluginInstanceID && item().lifecycleState === 'enabled'}>
        <button
          type="button"
          data-plugin-action="disable"
          class="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabledManagement()}
          onClick={() => props.onCommand({ type: 'disable', pluginInstanceID: item().pluginInstanceID! })}
        >
          <Settings class="h-3.5 w-3.5" />
          Disable
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
            targetVersion: item().officialCatalog?.stableVersion ?? '',
          })}
        >
          <RefreshIcon class="h-3.5 w-3.5" />
          Update
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
          Uninstall
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

function filterItems(items: readonly PluginInventoryItem[], rawQuery: string): PluginInventoryItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [...items];
  return items.filter((item) => {
    const fields = [
      item.displayName,
      item.description,
      item.publisher,
      item.pluginID,
      statusLabel(item),
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

function statusLabel(item: PluginInventoryItem): string {
  switch (item.lifecycleState) {
    case 'not_installed':
      return 'Available';
    case 'installed':
      return 'Installed';
    case 'enabled':
      return 'Enabled';
    case 'disabled':
      return 'Disabled';
    case 'update_available':
      return 'Update available';
    case 'needs_attention':
      return 'Needs attention';
    default:
      return 'Unavailable';
  }
}

function statusPillClass(item: PluginInventoryItem): string {
  if (item.lifecycleState === 'enabled') return 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700';
  if (item.lifecycleState === 'needs_attention') return 'rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700';
  if (item.lifecycleState === 'update_available') return 'rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-700';
  return 'rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground';
}

function trustLabel(item: PluginInventoryItem): string {
  switch (item.trustBadge) {
    case 'official':
      return 'Official';
    case 'revoked':
      return 'Revoked';
    case 'blocked':
      return 'Blocked';
    case 'unavailable':
      return 'Unavailable';
    default:
      return 'Unavailable';
  }
}

function messageFromUnknown(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}
