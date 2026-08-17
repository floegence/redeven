import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { CheckCircle, Download, MoreHorizontal, Play, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import { useI18n } from '../i18n';
import type { PluginCenterTab, PluginInstallExecutionProjection, PluginInventoryItem, PluginPendingCommandType, PluginRuntimeRecoveryPresentation } from './pluginTypes';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_PRESS_MOTION_CLASS, pluginPendingCommandLabel, presentPlugin } from './pluginPresentation';
import { PluginIcon, PluginStatusBadge, PluginTrustBadge } from './PluginPresentationPrimitives';
import { resolveAuthorPresentation, resolvePluginPresentation } from './officialPluginCatalog';
import { PluginInstallStatus } from './PluginInstallStatus';

export function PluginCenterItem(props: {
  item: PluginInventoryItem;
  tab: PluginCenterTab;
  selected: boolean;
  canManage: boolean;
  canOpenSurfaces: boolean;
  runtimeRecovery?: PluginRuntimeRecoveryPresentation;
  onRetryRuntimeRecovery?: () => Promise<unknown> | unknown;
  managementDisabled: boolean;
  commandPendingType?: PluginPendingCommandType;
  officialInstallPhase?: 'inspecting' | 'installing';
  officialInstallError?: string;
  installOperation?: PluginInstallExecutionProjection;
  entranceDelayMs?: number;
  onOpenDetails: (target: HTMLButtonElement) => void;
  onInstall: () => void;
  onRetryOfficialInstall: () => void;
  onUpdate: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onUninstall: () => void;
  onOpenActivity: () => void;
  onOpenWorkbench: () => void;
  onRetryInstall?: () => void;
}): JSX.Element {
  return <PluginDirectoryCard {...props} />;
}

function PluginDirectoryCard(props: Parameters<typeof PluginCenterItem>[0]): JSX.Element {
  const i18n = useI18n();
  const presentation = () => props.item.presentation
    ? resolveAuthorPresentation(props.item.presentation, i18n.locale())
    : !props.item.pluginInstanceID && props.item.officialCatalog
      ? resolvePluginPresentation(props.item.officialCatalog, i18n.locale())
      : undefined;
  const displayName = () => presentation()?.plugin_name ?? props.item.displayName;
  const summary = () => presentation()?.summary ?? props.item.description;
  const publisher = () => presentation()?.publisher_name ?? props.item.publisher;
  const actions = () => presentPlugin(props.item);
  let menuTrigger: HTMLButtonElement | undefined;
  const update = () => props.tab === 'updates' || props.item.lifecycleState === 'update_available';
  const primaryAction = () => actions().primaryAction;
  const commandPending = () => props.commandPendingType !== undefined || props.officialInstallPhase !== undefined;
  const pendingLabel = () => props.officialInstallPhase === 'inspecting'
    ? i18n.t('uiCopy.plugin.checkingPackage')
    : props.commandPendingType
      ? pluginPendingCommandLabel(props.commandPendingType, i18n)
      : i18n.t('uiCopy.plugin.installOperation.starting');
  const runtimeRecovery = () => props.runtimeRecovery;
  const primaryLabel = () => {
    switch (primaryAction()) {
      case 'install': return i18n.t('uiCopy.plugin.install');
      case 'enable': return i18n.t('uiCopy.plugin.enable');
      case 'review_update': return i18n.t('uiCopy.plugin.reviewUpdate');
      case 'open_activity': return i18n.t('common.actions.open');
      case 'view_policy': return i18n.t('uiCopy.plugin.viewPolicyRestriction');
      case 'view_runtime': return i18n.t('uiCopy.plugin.viewRuntimeRequirement');
      case 'view_trust': return i18n.t('uiCopy.plugin.viewTrustDetails');
      case 'view_diagnostics': return i18n.t('uiCopy.plugin.viewIssue');
      default: return i18n.t('uiCopy.plugin.viewDetails');
    }
  };
  const activatePrimary = (target: HTMLButtonElement) => {
    switch (primaryAction()) {
      case 'install': return props.onInstall();
      case 'enable': return props.onEnable();
      case 'review_update': return props.onUpdate();
      case 'open_activity': return props.onOpenActivity();
      default: return props.onOpenDetails(target);
    }
  };
  const menuItems = (): DropdownItem[] => [
    ...(actions().canOpenActivity ? [
      { id: 'activity', label: i18n.t('common.actions.open'), disabled: !props.canOpenSurfaces },
      ] : []),
    ...(actions().canOpenWorkbench ? [
      { id: 'workbench', label: i18n.t('uiCopy.plugin.openInWorkbench'), disabled: !props.canOpenSurfaces },
    ] : []),
    ...((actions().canOpenActivity || actions().canOpenWorkbench) ? [
      { id: 'surface-separator', label: '', separator: true },
    ] : []),
    ...(actions().primaryAction === 'enable' ? [{ id: 'enable', label: i18n.t('uiCopy.plugin.enable'), disabled: !props.canManage || props.managementDisabled }] : []),
    ...(actions().canDisable ? [{ id: 'disable', label: i18n.t('uiCopy.plugin.disable'), disabled: !props.canManage || props.managementDisabled }] : []),
    ...(actions().canCheckForUpdate ? [{ id: 'update', label: i18n.t('uiCopy.plugin.checkForUpdate'), disabled: !props.canManage || props.managementDisabled }] : []),
    ...(actions().canUninstall ? [{ id: 'uninstall', label: i18n.t('uiCopy.plugin.uninstall'), disabled: !props.canManage || props.managementDisabled }] : []),
    { id: 'details', label: i18n.t('uiCopy.plugin.viewDetails') },
  ];
  const selectMenuItem = (id: string, target: HTMLButtonElement) => {
    if (id === 'activity') props.onOpenActivity();
    else if (id === 'workbench') props.onOpenWorkbench();
    else if (id === 'enable') props.onEnable();
    else if (id === 'disable') props.onDisable();
    else if (id === 'update') props.onUpdate();
    else if (id === 'uninstall') props.onUninstall();
    else if (id === 'details') props.onOpenDetails(target);
  };
  return (
    <article
      data-plugin-directory-card={props.item.inventoryKey}
      class={cn(
        'redeven-plugin-directory-card group/card flex min-h-[208px] min-w-0 flex-col rounded-lg border bg-card p-4 text-card-foreground [transition-duration:180ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
        PLUGIN_ENTER_MOTION_CLASS,
        props.selected && 'border-primary bg-primary/[0.035] ring-1 ring-primary/20',
        update() && 'border-t-2 border-t-[var(--redeven-status-info-foreground)]',
      )}
      style={`animation-delay: ${props.entranceDelayMs ?? 0}ms`}
      aria-current={props.selected ? 'true' : undefined}
    >
      <button
        type="button"
        data-plugin-center-item={props.item.inventoryKey}
        aria-current={props.selected ? 'true' : undefined}
        class="flex min-w-0 flex-1 cursor-pointer flex-col rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${displayName()}: ${i18n.t('uiCopy.plugin.viewDetails')}`}
        onClick={(event) => props.onOpenDetails(event.currentTarget)}
      >
        <span class="flex min-w-0 items-start gap-3">
          <PluginIcon item={props.item} size="card" class="redeven-plugin-directory-card-icon" />
          <span class="min-w-0 flex-1 pt-0.5">
            <span class="line-clamp-2 text-sm font-semibold leading-5" lang={presentation()?.resolved_locale} dir="auto">{displayName()}</span>
            <span class="mt-1 flex flex-wrap gap-1">
              <PluginTrustBadge item={props.item} />
            </span>
          </span>
        </span>
        <span class="mt-3 line-clamp-2 flex-1 text-xs leading-5 text-muted-foreground" lang={presentation()?.resolved_locale} dir="auto">{summary()}</span>
        <span class="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Show when={props.item.pluginInstanceID ? props.item.version : (props.item.officialCatalog?.stableVersion ?? props.item.version)}>
            {(version) => <span>v{version()}</span>}
          </Show>
          <span aria-hidden="true">·</span>
          <span lang={presentation()?.resolved_locale} dir="auto">{publisher()}</span>
          <PluginStatusBadge item={props.item} />
        </span>
        <Show when={runtimeRecovery()}>
          {(recovery) => (
            <Show when={recovery().state !== 'ready'}>
              <span
                role={recovery().state === 'failed' ? 'alert' : 'status'}
                data-plugin-runtime-recovery={recovery().state}
                class={cn('mt-2 text-xs', recovery().state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}
              >
                {recovery().state === 'recovering'
                  ? i18n.t('uiCopy.plugin.runtimeRecoveryPluginInProgress')
                  : recovery().error ?? i18n.t('uiCopy.plugin.runtimeRecoveryPluginFailed')}
                <Show when={recovery().state === 'failed' && props.onRetryRuntimeRecovery}>
                  <button
                    type="button"
                    data-plugin-runtime-recovery-retry={props.item.pluginInstanceID}
                    class="ml-2 inline-flex min-h-7 items-center rounded-md border px-2 text-[11px] font-semibold text-foreground hover:bg-muted"
                    onClick={() => void props.onRetryRuntimeRecovery?.()}
                  >
                    {i18n.t('common.actions.retry')}
                  </button>
                </Show>
              </span>
            </Show>
          )}
        </Show>
      </button>
      <Show when={props.officialInstallError}>
        {(message) => (
          <div
            role="alert"
            data-plugin-install-inspection-error={props.item.inventoryKey}
            class="mt-2 flex min-w-0 items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
          >
            <span class="min-w-0 flex-1">{message()}</span>
            <button
              type="button"
              class="shrink-0 cursor-pointer rounded-md border border-destructive/40 px-2 py-1 font-semibold hover:bg-muted"
              onClick={props.onRetryOfficialInstall}
            >
              {i18n.t('common.actions.retry')}
            </button>
          </div>
        )}
      </Show>
      <Show when={props.installOperation}>
        {(operation) => (
          <div class="mt-3">
            <PluginInstallStatus
              projection={operation()}
              pluginName={props.item.displayName}
              compact
              onRetry={props.onRetryInstall}
            />
          </div>
        )}
      </Show>
      <div class="mt-3 flex min-w-0 items-center gap-1.5" data-plugin-center-card-actions>
        <Show when={primaryAction() === 'install'} fallback={(
          <button
            type="button"
            data-plugin-center-card-primary={props.item.inventoryKey}
            data-plugin-center-update={update() ? props.item.inventoryKey : undefined}
            class={cn('inline-flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8', PLUGIN_PRESS_MOTION_CLASS)}
            aria-busy={commandPending()}
            disabled={commandPending() || (primaryAction() === 'review_update' && props.managementDisabled)
              || (primaryAction() === 'open_activity' && (!props.canOpenSurfaces || !props.item.defaultLaunchTarget))
              || (primaryAction() === 'enable' && (!props.canManage || props.managementDisabled))}
            onClick={(event) => activatePrimary(event.currentTarget)}
          >
            {commandPending()
              ? <RefreshIcon class="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
              : primaryAction() === 'review_update'
              ? <RefreshIcon class="h-4 w-4 shrink-0" />
              : primaryAction() === 'open_activity' ? <CheckCircle class="h-4 w-4 shrink-0" />
                : primaryAction() === 'enable' ? <Play class="h-4 w-4 shrink-0" />
                  : <MoreHorizontal class="h-4 w-4 shrink-0" />}
            <span data-plugin-center-card-primary-label class="shrink-0 whitespace-nowrap">
              {commandPending() ? pendingLabel() : primaryLabel()}
            </span>
          </button>
        )}>
          <button
            type="button"
            data-plugin-center-install={props.item.inventoryKey}
            class={cn('inline-flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8', PLUGIN_PRESS_MOTION_CLASS)}
            aria-busy={commandPending()}
            disabled={!props.canManage || props.managementDisabled || commandPending()}
            onClick={props.onInstall}
          >
            <Show when={commandPending()} fallback={<Download class="h-4 w-4 shrink-0" />}>
              <RefreshIcon class="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
            </Show>
            <span data-plugin-center-card-primary-label class="shrink-0 whitespace-nowrap">
              {commandPending() ? pendingLabel() : i18n.t('uiCopy.plugin.install')}
            </span>
          </button>
        </Show>
        <Dropdown
          align="end"
          items={menuItems()}
          onSelect={(id) => {
            if (menuTrigger) selectMenuItem(id, menuTrigger);
          }}
          triggerAriaLabel={`${displayName()}: ${i18n.t('uiCopy.plugin.moreActions')}`}
          triggerClass="shrink-0 rounded-md"
          trigger={(
            <button
              ref={menuTrigger}
              type="button"
              data-plugin-center-card-menu={props.item.inventoryKey}
              class={cn('inline-flex min-h-[44px] min-w-[44px] shrink-0 cursor-pointer items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8 sm:min-w-8', PLUGIN_PRESS_MOTION_CLASS)}
              title={i18n.t('uiCopy.plugin.moreActions')}
            >
              <MoreHorizontal class="h-4 w-4" />
            </button>
          )}
        />
      </div>
    </article>
  );
}
