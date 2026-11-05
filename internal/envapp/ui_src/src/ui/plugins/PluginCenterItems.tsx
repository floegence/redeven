import { StableText, Button, Card, Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import { Show, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { CheckCircle, Download, MoreHorizontal, Play, Refresh, RefreshIcon } from '@floegence/floe-webapp-core/icons';

import { useI18n } from '../i18n';
import type { PluginCenterTab, PluginInstallExecutionProjection, PluginInventoryItem, PluginPendingCommandType, PluginRuntimeRecoveryPresentation } from './pluginTypes';
import { PLUGIN_ENTER_MOTION_CLASS, pluginPendingActionLabels, pluginPendingCommandLabel, presentPlugin } from './pluginPresentation';
import { PluginIcon, PluginProcessStatusBadge, PluginStatusBadge, PluginSourceBadge } from './PluginPresentationPrimitives';
import { resolveAuthorPresentation, resolvePluginPresentation } from './officialPluginCatalog';
import { PluginPinButton } from './PluginPinButton';
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
  onOpenDetails: (target: HTMLElement) => void;
  onInstall: () => void;
  onUpdate: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onUninstall: () => void;
  onOpenSurface: () => void;
  activityPinned?: boolean;
  onSetActivityPin?: (pinned: boolean) => void | Promise<void>;
  onRetryInstall?: () => void;
  onReviewInstall?: () => void;
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
  let menuTrigger: HTMLSpanElement | undefined;
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
      case 'view_permissions': return i18n.t('uiCopy.plugin.reviewPermissions');
      case 'view_policy': return i18n.t('uiCopy.plugin.viewPolicyRestriction');
      case 'view_runtime': return i18n.t('uiCopy.plugin.viewRuntimeRequirement');
      case 'view_attention': return i18n.t('uiCopy.plugin.viewIssue');
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
  const selectMenuItem = (id: string, target: HTMLElement) => {
    if (id === 'open') props.onOpenSurface();
    else if (id === 'enable') props.onEnable();
    else if (id === 'disable') props.onDisable();
    else if (id === 'update') props.onUpdate();
    else if (id === 'uninstall') props.onUninstall();
    else if (id === 'details') props.onOpenDetails(target);
  };
  return (
    <Card
      role="article"
      data-plugin-directory-card={props.item.inventoryKey}
      class={cn(
        'redeven-plugin-directory-card flex min-h-[144px] min-w-0 flex-col gap-2.5 p-3',
        PLUGIN_ENTER_MOTION_CLASS,
        props.selected && 'bg-[var(--floe-state-selected)]',
      )}
      style={`animation-delay: ${props.entranceDelayMs ?? 0}ms`}
      aria-current={props.selected ? 'true' : undefined}
    >
      <button
        type="button"
        data-plugin-center-item={props.item.inventoryKey}
        aria-current={props.selected ? 'true' : undefined}
        class="flex min-h-0 min-w-0 flex-1 cursor-pointer flex-col gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${displayName()}: ${i18n.t('uiCopy.plugin.viewDetails')}`}
        onClick={(event) => props.onOpenDetails(event.currentTarget)}
      >
        <span class="flex min-w-0 items-start gap-2.5 overflow-hidden">
          <PluginIcon item={props.item} size="card" />
          <span class="min-w-0 flex-1 pt-0.5">
            <span class="line-clamp-2 break-words text-[13px] font-medium leading-[18px]" title={displayName()} lang={presentation()?.resolved_locale} dir="auto">{displayName()}</span>
            <span class="mt-1 flex flex-wrap gap-1">
              <PluginSourceBadge item={props.item} />
            </span>
          </span>
        </span>
        <Show when={(runtimeRecovery() && runtimeRecovery()?.state !== 'ready') || (summary()?.trim() && summary()?.trim() !== displayName().trim())}>
        <span class="line-clamp-2 break-words text-xs leading-[18px] text-muted-foreground" lang={presentation()?.resolved_locale} dir="auto">
          <Show when={runtimeRecovery() && runtimeRecovery()?.state !== 'ready'} fallback={(
            <Show when={summary()?.trim() !== displayName().trim()}>{summary()}</Show>
          )}>
            <span role={runtimeRecovery()?.state === 'failed' ? 'alert' : 'status'} data-plugin-runtime-recovery={runtimeRecovery()?.state} class={cn(runtimeRecovery()?.state === 'failed' && 'text-destructive')} title={runtimeRecovery()?.error}>
              {runtimeRecovery()?.state === 'recovering' ? i18n.t('uiCopy.plugin.runtimeRecoveryPluginInProgress') : runtimeRecovery()?.error ?? i18n.t('uiCopy.plugin.runtimeRecoveryPluginFailed')}
            </span>
          </Show>
        </span>
        </Show>
        <span class="mt-auto flex w-full min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span class="min-w-0 truncate" title={publisher()} lang={presentation()?.resolved_locale} dir="auto">{publisher()}</span>
          <Show when={version()}>
            {(value) => <><span aria-hidden="true">·</span><span class="max-w-[35%] shrink-0 truncate" title={`v${value()}`}>v{value()}</span></>}
          </Show>
          <Show when={props.item.lifecycleState !== 'not_installed'}><PluginStatusBadge item={props.item} class="ml-auto max-w-[50%] truncate" /></Show>
          <Show when={props.item.processStatus}><PluginProcessStatusBadge state={props.item.processStatus!.state} class="max-w-[50%] truncate" /></Show>
        </span>
      </button>
      <div class="flex min-w-0 items-center gap-1.5" data-plugin-center-card-actions>
        <Show when={installSummary()} fallback={(
          <Button
            type="button"
            data-plugin-center-card-primary={primaryAction() === 'install' ? undefined : props.item.inventoryKey}
            data-plugin-center-install={primaryAction() === 'install' ? props.item.inventoryKey : undefined}
            data-plugin-center-update={update() ? props.item.inventoryKey : undefined}
            variant={['install', 'enable', 'review_update'].includes(primaryAction()) ? 'primary' : 'secondary'}
            size="sm"
            class="min-h-[44px] min-w-0 flex-1 text-xs sm:min-h-8 sm:h-8"
            loading={commandPending()}
            icon={primaryAction() === 'install' ? Download
              : primaryAction() === 'review_update' ? Refresh
              : primaryAction() === 'open' ? Play
              : primaryAction() === 'enable' ? CheckCircle : MoreHorizontal}
            aria-label={commandPending() ? pendingLabel() : primaryLabel()}
            title={commandPending() ? pendingLabel() : primaryLabel()}
            aria-busy={commandPending()}
            disabled={commandPending() || ((primaryAction() === 'review_update' || primaryAction() === 'install') && (!props.canManage || props.managementDisabled))
              || (primaryAction() === 'open' && (!props.canOpenSurfaces || !props.item.defaultLaunchTarget))
              || (primaryAction() === 'enable' && (!props.canManage || props.managementDisabled))}
            onClick={(event) => activatePrimary(event.currentTarget)}
          >
            <span data-plugin-center-card-primary-label class="min-w-0 leading-4">
              <StableText class="max-w-full [&>span]:truncate" reserve={[...pluginPendingActionLabels(i18n), primaryLabel()]}>{commandPending() ? pendingLabel() : primaryLabel()}</StableText>
            </span>
          </Button>
        )}>
          {(operation) => (
            <PluginInstallSummary
              projection={operation()}
              announce={props.announceInstallStatus}
              onOpenDetails={props.onOpenDetails}
              onRetry={props.onRetryInstall}
              onReviewAgain={props.onReviewInstall}
            />
          )}
        </Show>
        <Show when={!installSummary() && runtimeRecovery()?.state === 'failed' && props.onRetryRuntimeRecovery}>
          <Button variant="ghost" size="icon" data-plugin-runtime-recovery-retry={props.item.pluginInstanceID} class="h-11 w-11 shrink-0 sm:h-8 sm:w-8" aria-label={i18n.t('common.actions.retry')} title={i18n.t('common.actions.retry')} onClick={() => void props.onRetryRuntimeRecovery?.()}>
            <RefreshIcon class="h-4 w-4" />
          </Button>
        </Show>
        <Show when={props.onSetActivityPin && (actions().canOpenSurface || props.activityPinned)}>
          <PluginPinButton pluginName={displayName()} pinned={Boolean(props.activityPinned)}
            onSetPinned={(pinned) => props.onSetActivityPin?.(pinned)} />
        </Show>
        <Dropdown
          align="end"
          items={menuItems()}
          onSelect={(id) => {
            const target = menuTrigger?.closest<HTMLElement>('[role="button"]');
            if (target) selectMenuItem(id, target);
          }}
          triggerAriaLabel={`${displayName()}: ${i18n.t('uiCopy.plugin.moreActions')}`}
          triggerClass="ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-[var(--floe-state-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
          trigger={(
            <span
              ref={menuTrigger}
              data-plugin-center-card-menu={props.item.inventoryKey}
              class="inline-flex items-center justify-center"
              title={i18n.t('uiCopy.plugin.moreActions')}
            >
              <MoreHorizontal class="h-4 w-4" />
            </span>
          )}
        />
      </div>
    </Card>
  );
}
