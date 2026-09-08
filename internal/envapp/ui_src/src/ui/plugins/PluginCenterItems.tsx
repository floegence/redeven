import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { CheckCircle, Download, MoreHorizontal, Play, RefreshIcon } from '@floegence/floe-webapp-core/icons';
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';

import { useI18n } from '../i18n';
import type { PluginCenterTab, PluginInstallExecutionProjection, PluginInventoryItem, PluginPendingCommandType, PluginRuntimeRecoveryPresentation } from './pluginTypes';
import { PLUGIN_ENTER_MOTION_CLASS, PLUGIN_PRESS_MOTION_CLASS, pluginPendingCommandLabel, presentPlugin } from './pluginPresentation';
import { PluginIcon, PluginStatusBadge, PluginTrustBadge } from './PluginPresentationPrimitives';
import { resolveAuthorPresentation, resolvePluginPresentation } from './officialPluginCatalog';
import { PluginInstallSummary } from './PluginInstallStatus';

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
  installOperation?: PluginInstallExecutionProjection;
  announceInstallStatus?: boolean;
  entranceDelayMs?: number;
  onOpenDetails: (target: HTMLButtonElement) => void;
  onInstall: () => void;
  onUpdate: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onUninstall: () => void;
  onOpenSurface: () => void;
  onRetryInstall?: () => void;
  onReviewInstall?: () => void;
  onResolveRetainedData?: () => void;
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
  const version = () => props.item.pluginInstanceID ? props.item.version : (props.item.officialCatalog?.stableVersion ?? props.item.version);
  const actions = () => presentPlugin(props.item);
  const installSummary = () => {
    const operation = props.installOperation;
    return operation?.execution?.status === 'completed' && operation.observation === 'watching' && !operation.failure
      ? undefined
      : operation;
  };
  let menuTrigger: HTMLButtonElement | undefined;
  const update = () => props.tab === 'updates' || props.item.lifecycleState === 'update_available';
  const primaryAction = () => actions().primaryAction;
  const commandPending = () => props.commandPendingType !== undefined;
  const pendingLabel = () => props.commandPendingType
      ? pluginPendingCommandLabel(props.commandPendingType, i18n, props.installOperation?.observation)
      : i18n.t('uiCopy.plugin.installOperation.starting');
  const runtimeRecovery = () => props.runtimeRecovery;
  const primaryLabel = () => {
    switch (primaryAction()) {
      case 'install': return i18n.t('uiCopy.plugin.install');
      case 'enable': return i18n.t('uiCopy.plugin.enable');
      case 'review_update': return i18n.t('uiCopy.plugin.reviewUpdate');
      case 'open': return i18n.t('common.actions.open');
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
      case 'open': return props.onOpenSurface();
      default: return props.onOpenDetails(target);
    }
  };
  const menuItems = (): DropdownItem[] => [
    ...(actions().canOpenSurface ? [
      { id: 'open', label: i18n.t('common.actions.open'), disabled: !props.canOpenSurfaces },
      ] : []),
    ...(actions().canOpenSurface ? [
      { id: 'surface-separator', label: '', separator: true },
    ] : []),
    ...(actions().primaryAction === 'enable' ? [{ id: 'enable', label: i18n.t('uiCopy.plugin.enable'), disabled: !props.canManage || props.managementDisabled }] : []),
    ...(actions().canDisable ? [{ id: 'disable', label: i18n.t('uiCopy.plugin.disable'), disabled: !props.canManage || props.managementDisabled }] : []),
    ...(actions().canCheckForUpdate ? [{ id: 'update', label: i18n.t('uiCopy.plugin.checkForUpdate'), disabled: !props.canManage || props.managementDisabled }] : []),
    ...(actions().canUninstall ? [{ id: 'uninstall', label: i18n.t('uiCopy.plugin.uninstall'), disabled: !props.canManage || props.managementDisabled }] : []),
    { id: 'details', label: i18n.t('uiCopy.plugin.viewDetails') },
  ];
  const selectMenuItem = (id: string, target: HTMLButtonElement) => {
    if (id === 'open') props.onOpenSurface();
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
        'redeven-plugin-directory-card group/card grid h-[248px] min-w-0 grid-rows-[minmax(0,1fr)_56px] gap-3 rounded-lg border bg-card p-4 text-card-foreground [transition-duration:180ms] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
        PLUGIN_ENTER_MOTION_CLASS,
        props.selected && 'border-primary bg-primary/[0.035] ring-1 ring-primary/20',
      )}
      style={`animation-delay: ${props.entranceDelayMs ?? 0}ms`}
      aria-current={props.selected ? 'true' : undefined}
    >
      <button
        type="button"
        data-plugin-center-item={props.item.inventoryKey}
        aria-current={props.selected ? 'true' : undefined}
        class="grid min-h-0 min-w-0 cursor-pointer grid-rows-[64px_minmax(0,1fr)_20px] gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${displayName()}: ${i18n.t('uiCopy.plugin.viewDetails')}`}
        onClick={(event) => props.onOpenDetails(event.currentTarget)}
      >
        <span class="flex min-w-0 items-start gap-3 overflow-hidden">
          <PluginIcon item={props.item} size="card" class="redeven-plugin-directory-card-icon" />
          <span class="min-w-0 flex-1 pt-0.5">
            <span class="line-clamp-2 break-words text-sm font-semibold leading-5" title={displayName()} lang={presentation()?.resolved_locale} dir="auto">{displayName()}</span>
            <span class="mt-1 flex flex-wrap gap-1">
              <PluginTrustBadge item={props.item} />
            </span>
          </span>
        </span>
        <span class="line-clamp-2 break-words text-xs leading-5 text-muted-foreground" lang={presentation()?.resolved_locale} dir="auto">
          <Show when={runtimeRecovery() && runtimeRecovery()?.state !== 'ready'} fallback={(
            <Show when={summary()?.trim() !== displayName().trim()}>{summary()}</Show>
          )}>
            <span role={runtimeRecovery()?.state === 'failed' ? 'alert' : 'status'} data-plugin-runtime-recovery={runtimeRecovery()?.state} class={cn(runtimeRecovery()?.state === 'failed' && 'text-destructive')} title={runtimeRecovery()?.error}>
              {runtimeRecovery()?.state === 'recovering' ? i18n.t('uiCopy.plugin.runtimeRecoveryPluginInProgress') : runtimeRecovery()?.error ?? i18n.t('uiCopy.plugin.runtimeRecoveryPluginFailed')}
            </span>
          </Show>
        </span>
        <span class="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span class="min-w-0 truncate" title={publisher()} lang={presentation()?.resolved_locale} dir="auto">{publisher()}</span>
          <Show when={version()}>
            {(value) => <><span aria-hidden="true">·</span><span class="max-w-[35%] shrink-0 truncate" title={`v${value()}`}>v{value()}</span></>}
          </Show>
          <Show when={props.item.lifecycleState !== 'not_installed'}><PluginStatusBadge item={props.item} class="ml-auto max-w-[50%] truncate" /></Show>
        </span>
      </button>
      <div class="flex min-w-0 items-center gap-1.5 border-t pt-3" data-plugin-center-card-actions>
        <Show when={installSummary()} fallback={(
          <button
            type="button"
            data-plugin-center-card-primary={primaryAction() === 'install' ? undefined : props.item.inventoryKey}
            data-plugin-center-install={primaryAction() === 'install' ? props.item.inventoryKey : undefined}
            data-plugin-center-update={update() ? props.item.inventoryKey : undefined}
            class={cn('inline-flex h-9 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md bg-primary px-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', PLUGIN_PRESS_MOTION_CLASS)}
            aria-busy={commandPending()}
            disabled={commandPending() || ((primaryAction() === 'review_update' || primaryAction() === 'install') && (!props.canManage || props.managementDisabled))
              || (primaryAction() === 'open' && (!props.canOpenSurfaces || !props.item.defaultLaunchTarget))
              || (primaryAction() === 'enable' && (!props.canManage || props.managementDisabled))}
            onClick={(event) => activatePrimary(event.currentTarget)}
          >
            {commandPending()
              ? <RefreshIcon class="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
              : primaryAction() === 'install' ? <Download class="h-4 w-4 shrink-0" />
              : primaryAction() === 'review_update'
              ? <RefreshIcon class="h-4 w-4 shrink-0" />
              : primaryAction() === 'open' ? <Play class="h-4 w-4 shrink-0" />
                : primaryAction() === 'enable' ? <CheckCircle class="h-4 w-4 shrink-0" />
                  : <MoreHorizontal class="h-4 w-4 shrink-0" />}
            <span data-plugin-center-card-primary-label class="min-w-0 break-words leading-4">
              {commandPending() ? pendingLabel() : primaryLabel()}
            </span>
          </button>
        )}>
          {(operation) => (
            <PluginInstallSummary
              projection={operation()}
              announce={props.announceInstallStatus}
              onOpenDetails={props.onOpenDetails}
              onRetry={props.onRetryInstall}
              onReviewAgain={props.onReviewInstall}
              onResolveRetainedData={props.onResolveRetainedData}
            />
          )}
        </Show>
        <Show when={!installSummary() && runtimeRecovery()?.state === 'failed' && props.onRetryRuntimeRecovery}>
          <button type="button" data-plugin-runtime-recovery-retry={props.item.pluginInstanceID} class="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={i18n.t('common.actions.retry')} title={i18n.t('common.actions.retry')} onClick={() => void props.onRetryRuntimeRecovery?.()}>
            <RefreshIcon class="h-4 w-4" />
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
              class={cn('inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', PLUGIN_PRESS_MOTION_CLASS)}
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
