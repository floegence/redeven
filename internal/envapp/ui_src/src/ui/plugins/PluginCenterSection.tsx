import { For, Show, createEffect, createMemo, createResource, createSignal, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { CheckCircle, Download, Grid3x3, RefreshIcon, Settings, Trash } from '@floegence/floe-webapp-core/icons';

import { buildPluginCenterModel } from './pluginInventoryProjection';
import { executePluginLifecycleCommand, loadPluginInventoryProjection } from './pluginApi';
import type {
  PluginCenterTab,
  PluginInventoryItem,
  PluginInventoryProjection,
  PluginLifecycleCommand,
} from './pluginTypes';

type PluginCenterResourceSource = PluginInventoryProjection | 'live';

export type PluginCenterSectionProps = {
  projection?: PluginInventoryProjection;
  loading?: boolean;
  error?: unknown;
  canManagePlugins?: boolean;
  canOpenPluginSurfaces?: boolean;
  onCommand?: (command: PluginLifecycleCommand) => Promise<unknown> | unknown;
};

export function PluginCenterSection(props: PluginCenterSectionProps = {}): JSX.Element {
  const [activeTab, setActiveTab] = createSignal<PluginCenterTab>(props.projection && props.projection.items.every((item) => !item.pluginInstanceID) ? 'discover' : 'installed');
  const [initialTabResolved, setInitialTabResolved] = createSignal(Boolean(props.projection));
  const [resource, { refetch }] = createResource<PluginInventoryProjection, PluginCenterResourceSource>(
    () => props.projection ?? 'live',
    async (source) => (source === 'live' ? loadPluginInventoryProjection() : source),
  );
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [uninstallChoiceFor, setUninstallChoiceFor] = createSignal<string | null>(null);

  const projection = createMemo(() => props.projection ?? resource() ?? { items: [] });
  const model = createMemo(() => buildPluginCenterModel(projection(), activeTab()));
  const visibleItems = createMemo(() => {
    switch (activeTab()) {
      case 'installed':
        return model().installed;
      case 'discover':
        return model().discover;
      case 'updates':
        return model().updates;
      default:
        return [];
    }
  });
  const loading = createMemo(() => props.loading ?? resource.loading);
  const errorMessage = createMemo(() => messageFromUnknown(props.error ?? resource.error ?? commandError()));
  const canManage = createMemo(() => props.canManagePlugins ?? true);
  const canOpenSurfaces = createMemo(() => props.canOpenPluginSurfaces ?? false);

  createEffect(() => {
    if (initialTabResolved() || loading()) return;
    const next = model();
    if (next.installed.length === 0 && next.discover.length > 0) {
      setActiveTab('discover');
    }
    setInitialTabResolved(true);
  });

  const runCommand = async (command: PluginLifecycleCommand) => {
    setCommandError(null);
    try {
      if (props.onCommand) {
        await props.onCommand(command);
      } else {
        await executePluginLifecycleCommand(command);
        await refetch();
      }
    } catch (error) {
      setCommandError(messageFromUnknown(error));
    }
  };

  return (
    <section data-plugin-center class="space-y-4">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Official</p>
        <h2 class="text-xl font-semibold tracking-tight">Plugin Center</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Install and manage Redeven official catalog plugins for this runtime.
        </p>
      </div>

      <div class="flex flex-wrap gap-1 rounded-md border bg-muted/30 p-1">
        <TabButton id="installed" active={activeTab()} onSelect={setActiveTab} label={`Installed (${model().installed.length})`} />
        <TabButton id="discover" active={activeTab()} onSelect={setActiveTab} label={`Discover (${model().discover.length})`} />
        <TabButton id="updates" active={activeTab()} onSelect={setActiveTab} label={`Updates (${model().updates.length})`} />
      </div>

      <Show when={errorMessage()}>
        <div class="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage()}</div>
      </Show>

      <Show when={loading()}>
        <div class="rounded-md border px-3 py-2 text-sm text-muted-foreground">Loading official plugins...</div>
      </Show>

      <div class="space-y-2">
        <For each={visibleItems()}>
          {(item) => (
            <article class="rounded-lg border bg-background p-3" data-plugin-center-item={item.pluginID}>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="flex min-w-0 gap-3">
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    <Grid3x3 class="h-4 w-4" />
                  </span>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <h3 class="truncate text-sm font-semibold">{item.displayName}</h3>
                      <span class="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Official</span>
                      <span class="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{statusLabel(item)}</span>
                    </div>
                    <p class="mt-1 text-sm text-muted-foreground">{item.description}</p>
                    <Show when={installRequiresHostAPI(item)}>
                      <p class="mt-2 text-xs text-amber-600">Host distribution install API required.</p>
                    </Show>
                    <Show when={uninstallChoiceFor() === item.pluginInstanceID}>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          class="cursor-pointer rounded-md border px-2.5 py-1 text-xs hover:bg-muted"
                          onClick={() => void runCommand({ type: 'uninstall', pluginInstanceID: item.pluginInstanceID!, dataRetention: 'keep_data' })}
                        >
                          Keep data
                        </button>
                        <button
                          type="button"
                          class="cursor-pointer rounded-md border border-destructive/30 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                          onClick={() => void runCommand({ type: 'uninstall', pluginInstanceID: item.pluginInstanceID!, dataRetention: 'delete_data' })}
                        >
                          Delete data
                        </button>
                      </div>
                    </Show>
                  </div>
                </div>
                <div class="flex shrink-0 flex-wrap gap-2">
                  <PluginActions
                    item={item}
                    canManage={canManage()}
                    canOpenSurfaces={canOpenSurfaces()}
                    onCommand={(command) => void runCommand(command)}
                    onAskUninstall={(pluginInstanceID) => setUninstallChoiceFor(pluginInstanceID)}
                  />
                </div>
              </div>
            </article>
          )}
        </For>
        <Show when={!loading() && visibleItems().length === 0}>
          <div class="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">No plugins in this view.</div>
        </Show>
      </div>
    </section>
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
        'cursor-pointer rounded px-3 py-1.5 text-xs font-medium transition',
        isActive() ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
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
          disabled={disabledManagement() || installRequiresHostAPI(item())}
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
          onClick={() => props.onCommand({ type: 'update', pluginInstanceID: item().pluginInstanceID!, targetVersion: item().officialCatalog?.stableVersion ?? '' })}
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

function installRequiresHostAPI(item: PluginInventoryItem): boolean {
  return Boolean(item.officialCatalog?.distribution.requiresHostDistributionInstallAPI);
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

function messageFromUnknown(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}
