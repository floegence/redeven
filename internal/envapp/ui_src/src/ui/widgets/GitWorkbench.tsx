import { Show, createMemo } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Copy, Folder, History, MoreHorizontal, Refresh, Terminal } from '@floegence/floe-webapp-core/icons';
import { Button, Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitPreviewDeleteBranchResponse,
  GitPreviewMergeBranchResponse,
  GitRepoSummaryResponse,
  GitResolveRepoResponse,
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import {
  describeGitHead,
  exactGitPath,
  reattachBranchFromRepoSummary,
  repoDisplayName,
  type GitBranchDetailPresentationState,
  type GitStashWindowRequest,
  type GitBranchSubview,
  type GitDetachedSwitchTarget,
  type GitWorkbenchSubview,
  type GitWorkspaceViewPageState,
  type GitWorkspaceViewSection,
} from '../utils/gitWorkbench';
import {
  localizedDetachedHeadCheckoutActionLabel,
  localizedDetachedHeadReattachSummary,
  localizedDetachedHeadViewingSummary,
  localizedGitHeadDisplay,
  localizedSyncStatusLabel,
} from '../utils/localizedGitWorkbench';
import { GitChangesPanel } from './GitChangesPanel';
import { GitBranchesPanel } from './GitBranchesPanel';
import { GitHistoryBrowser } from './GitHistoryBrowser';
import { gitToneHeaderActionButtonClass } from './GitChrome';
import { GitInlineLoadingStatus, GitMetaPill, GitPrimaryTitle } from './GitWorkbenchPrimitives';
import { GitDeleteBranchDialog, type GitDeleteBranchDialogConfirmOptions, type GitDeleteBranchDialogState } from './GitDeleteBranchDialog';
import { GitMergeBranchDialog, type GitMergeBranchDialogConfirmOptions, type GitMergeBranchDialogState } from './GitMergeBranchDialog';
import { buildTabElementId, buildTabPanelElementId } from '../utils/tabNavigation';
import { buildGitDirectoryShortcutRequest, type GitAskFlowerRequest, type GitDirectoryShortcutRequest, type GitFileShortcutTarget } from '../utils/gitBrowserShortcuts';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { UIFirstKeepAlivePanel } from '../primitives/UIFirstKeepAlivePanel';
import { useI18n } from '../i18n';
import { FlowerIcon } from '../icons/FlowerIcon';
import { GitEntityContextMenu, createGitEntityContextMenuController, type GitContextMenuActionItem } from './GitEntityContextMenu';
import type { GitCapabilityMode } from '../services/gitWorkspaceRuntime';

export interface GitWorkbenchProps {
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  currentPath: string;
  subview: GitWorkbenchSubview;
  repoSummary?: GitRepoSummaryResponse | null;
  repoSummaryLoading?: boolean;
  repoSummaryError?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  workspacePages?: Partial<Record<GitWorkspaceViewSection, GitWorkspaceViewPageState>>;
  workspaceLoading?: boolean;
  workspaceError?: string;
  selectedWorkspaceSection?: GitWorkspaceViewSection;
  onSelectWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  selectedWorkspaceItem?: GitWorkspaceChange | null;
  onSelectWorkspaceItem?: (item: GitWorkspaceChange) => void;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: 'stage' | 'unstage' | 'discard' | '';
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  statusRefreshToken?: number;
  protocolClientIdentity?: object | null;
  capabilityMode?: GitCapabilityMode;
  selectedBranch?: GitBranchSummary | null;
  branchDetailState?: GitBranchDetailPresentationState;
  selectedBranchSubview?: GitBranchSubview;
  onSelectBranchSubview?: (view: GitBranchSubview) => void;
  onRefreshSelectedBranch?: () => void;
  onSelectCurrentBranch?: () => void;
  commits?: GitCommitSummary[];
  listLoading?: boolean;
  listRefreshing?: boolean;
  listLoadingMore?: boolean;
  listError?: string;
  hasMore?: boolean;
  selectedCommitHash?: string;
  onSelectCommit?: (hash: string) => void;
  onLoadMore?: () => void;
  switchDetachedBusy?: boolean;
  checkoutBusy?: boolean;
  mergeBusy?: boolean;
  deleteBusy?: boolean;
  mergeReviewOpen?: boolean;
  mergeReviewBranch?: GitBranchSummary | null;
  mergePreview?: GitPreviewMergeBranchResponse | null;
  mergePreviewError?: string;
  mergeActionError?: string;
  mergeDialogState?: GitMergeBranchDialogState;
  deleteReviewOpen?: boolean;
  deleteReviewBranch?: GitBranchSummary | null;
  deletePreview?: GitPreviewDeleteBranchResponse | null;
  deletePreviewError?: string;
  deleteActionError?: string;
  deleteDialogState?: GitDeleteBranchDialogState;
  onCheckoutBranch?: (branch: GitBranchSummary) => void;
  onMergeBranch?: (branch: GitBranchSummary) => void;
  onDeleteBranch?: (branch: GitBranchSummary) => void;
  onSwitchDetached?: (target: GitDetachedSwitchTarget) => void;
  onCloseMergeReview?: () => void;
  onRetryMergePreview?: (branch: GitBranchSummary) => void;
  onConfirmMergeBranch?: (branch: GitBranchSummary, options: GitMergeBranchDialogConfirmOptions) => void;
  onCloseDeleteReview?: () => void;
  onRetryDeletePreview?: (branch: GitBranchSummary) => void;
  onConfirmDeleteBranch?: (branch: GitBranchSummary, options: GitDeleteBranchDialogConfirmOptions) => void;
  commitMessage?: string;
  commitBusy?: boolean;
  onCommitMessageChange?: (value: string) => void;
  onCommit?: (message: string) => void;
  onStageSelected?: (item: GitWorkspaceChange) => void;
  onUnstageSelected?: (item: GitWorkspaceChange) => void;
  onDiscardSelected?: (item: GitWorkspaceChange) => void;
  onNavigateWorkspaceDirectory?: (directoryPath: string) => void;
  onBulkAction?: (section: GitWorkspaceViewSection) => void;
  onDiscardAll?: (
    section: GitWorkspaceViewSection,
    scope?: { directoryPath?: string; count?: number },
  ) => void;
  onLoadMoreWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  onOpenCommitDialog?: () => void;
  onOpenStash?: (request: GitStashWindowRequest) => void;
  onAskFlower?: (request: GitAskFlowerRequest) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
  onPreviewCurrentFile?: (target: GitFileShortcutTarget) => void;
  onCopyText?: (value: string) => void;
  fetchBusy?: boolean;
  pullBusy?: boolean;
  pushBusy?: boolean;
  onFetch?: () => void;
  onPull?: () => void;
  onPush?: () => void;
  showMobileSidebarButton?: boolean;
  onToggleSidebar?: () => void;
  onRefresh?: () => void;
  class?: string;
}

function normalizeSubview(view: GitWorkbenchSubview): GitWorkbenchSubview {
  return view === 'overview' ? 'changes' : view;
}

const GIT_WORKBENCH_SUBVIEW_ID_PREFIX = 'git-workbench-subview';
type RepositoryHeaderActionId = 'stashes' | 'fetch' | 'pull' | 'push' | 'terminal' | 'files';

export function GitWorkbench(props: GitWorkbenchProps) {
  const i18n = useI18n();
  const repoLabel = () => repoDisplayName(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath);
  const repoPath = () => exactGitPath(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath) || '/';
  const repoDirRequest = (): GitDirectoryShortcutRequest | null =>
    buildGitDirectoryShortcutRequest({ rootPath: repoPath() });
  const headRef = () => String(props.repoSummary?.headRef || props.repoInfo?.headRef || '').trim();
  const headDisplay = () => localizedGitHeadDisplay(describeGitHead(props.repoSummary, props.repoInfo), i18n);
  const reattachBranch = () => reattachBranchFromRepoSummary(props.repoSummary);
  const activeSubview = () => normalizeSubview(props.subview);
  const loadingBusy = () => {
    if (props.repoInfoLoading) return true;
    if (activeSubview() === 'changes') return Boolean(props.workspaceLoading);
    if (activeSubview() === 'branches') return Boolean(props.branchesLoading);
    if (activeSubview() === 'history') return Boolean(props.listLoading);
    return false;
  };
  const detachedHead = () => headDisplay().detached;
  const stashCountLabel = () => {
    const count = Number(props.repoSummary?.stashCount ?? 0);
    return count > 0
      ? i18n.t('uiCopy.git.stashCount', { count })
      : i18n.t('git.common.stashes');
  };
  const repoActionsDisabled = () => Boolean(
    props.repoInfoLoading
    || !(props.repoInfo?.available ?? Boolean(props.repoSummary?.repoRootPath))
    || !(props.repoInfo?.repoRootPath || props.repoSummary?.repoRootPath)
  );
  const detachedHeadSummary = () => localizedDetachedHeadViewingSummary(props.repoSummary?.headCommit || props.repoInfo?.headCommit, i18n);
  const reattachSummary = () => localizedDetachedHeadReattachSummary(reattachBranch(), i18n, { compact: true });
  const mergeReviewBranch = () => props.mergeReviewBranch ?? props.selectedBranch ?? null;
  const deleteReviewBranch = () => props.deleteReviewBranch ?? props.selectedBranch ?? null;
  const deleteReviewUsesWorktree = () => {
    const branch = deleteReviewBranch();
    if (!props.deleteReviewOpen || !branch) return false;
    if (props.deletePreview?.requiresWorktreeRemoval) return true;
    return String(branch.worktreePath ?? '').trim() !== '';
  };
  type RepositoryContextTarget = Readonly<{
    repoRootPath: string;
    worktreePath?: string;
    headRef?: string;
    headCommit?: string;
    summary?: GitRepoSummaryResponse;
  }>;
  const repositoryContextMenu = createGitEntityContextMenuController<RepositoryContextTarget>({
    snapshotTarget: (target) => ({
      ...target,
      summary: target.summary ? { ...target.summary, workspaceSummary: target.summary.workspaceSummary ? { ...target.summary.workspaceSummary } : target.summary.workspaceSummary } : undefined,
    }),
  });
  const repositoryContextTarget = (): RepositoryContextTarget | null => {
    const root = exactGitPath(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath);
    if (!root) return null;
    return {
      repoRootPath: root,
      worktreePath: exactGitPath(props.repoSummary?.worktreePath) || undefined,
      headRef: String(props.repoSummary?.headRef || props.repoInfo?.headRef || '').trim() || undefined,
      headCommit: String(props.repoSummary?.headCommit || props.repoInfo?.headCommit || '').trim() || undefined,
      summary: props.repoSummary ?? undefined,
    };
  };
  const repositoryContextMenuItems = (target: RepositoryContextTarget): GitContextMenuActionItem[] => {
    const rootRequest = buildGitDirectoryShortcutRequest({ rootPath: target.repoRootPath });
    const items: GitContextMenuActionItem[] = [];
    if (props.onAskFlower) {
      items.push({
        id: 'ask-flower', kind: 'action', group: 'assistant', rank: 10,
        label: i18n.t('git.contextMenu.askFlower'), icon: FlowerIcon,
        onSelect: () => props.onAskFlower?.({ kind: 'repository', ...target }),
      });
    }
    if (props.onOpenStash) {
      items.push({
        id: 'open-stashes', kind: 'action', group: 'inspect', rank: 10,
        label: i18n.t('git.common.stashes'), icon: History,
        onSelect: () => props.onOpenStash?.({ tab: 'stashes', repoRootPath: target.repoRootPath, source: 'header' }),
      });
    }
    if (props.onOpenInTerminal) {
      items.push({
        id: 'open-terminal', kind: 'action', group: 'navigate', rank: 10,
        label: i18n.t('git.contextMenu.openTerminal'), icon: Terminal,
        disabled: !rootRequest,
        disabledReason: rootRequest ? undefined : i18n.t('git.notifications.repositoryPathUnavailable'),
        onSelect: () => { if (rootRequest) props.onOpenInTerminal?.(rootRequest); },
      });
    }
    if (props.onBrowseFiles) {
      items.push({
        id: 'browse-files', kind: 'action', group: 'navigate', rank: 20,
        label: i18n.t('git.contextMenu.browseFiles'), icon: Folder,
        disabled: !rootRequest,
        disabledReason: rootRequest ? undefined : i18n.t('git.notifications.repositoryPathUnavailable'),
        onSelect: () => { if (rootRequest) void props.onBrowseFiles?.(rootRequest); },
      });
    }
    if (props.onCopyText) {
      items.push(
        { id: 'copy-repository-path', kind: 'action', group: 'clipboard', rank: 10, label: i18n.t('git.contextMenu.copyAbsolutePath'), icon: Copy, onSelect: () => void props.onCopyText?.(target.repoRootPath) },
        ...(target.headCommit ? [{ id: 'copy-head-commit', kind: 'action' as const, group: 'clipboard' as const, rank: 20, label: i18n.t('git.contextMenu.copyCommitHash'), icon: Copy, onSelect: () => void props.onCopyText?.(target.headCommit!) }] : []),
      );
    }
    return items;
  };
  const repositoryActionLabel = (action: RepositoryHeaderActionId): string => {
    switch (action) {
      case 'stashes':
        return stashCountLabel();
      case 'fetch':
        return props.fetchBusy ? i18n.t('uiCopy.git.fetching') : i18n.t('uiCopy.git.fetch');
      case 'pull':
        return props.pullBusy
          ? i18n.t('uiCopy.git.pulling')
          : `${i18n.t('uiCopy.git.pull')}${Number(props.repoSummary?.behindCount ?? 0) > 0 ? ` ${props.repoSummary?.behindCount}` : ''}`;
      case 'push':
        return props.pushBusy
          ? i18n.t('uiCopy.git.pushing')
          : `${i18n.t('uiCopy.git.push')}${Number(props.repoSummary?.aheadCount ?? 0) > 0 ? ` ${props.repoSummary?.aheadCount}` : ''}`;
      case 'terminal':
        return i18n.t('git.contextMenu.openTerminal');
      case 'files':
        return i18n.t('git.contextMenu.browseFiles');
    }
  };
  const repositoryActionDisabled = (action: RepositoryHeaderActionId): boolean => {
    if (repoActionsDisabled()) return true;
    switch (action) {
      case 'fetch':
        return Boolean(props.fetchBusy);
      case 'pull':
        return detachedHead() || Boolean(props.pullBusy);
      case 'push':
        return detachedHead() || Boolean(props.pushBusy);
      case 'terminal':
      case 'files':
        return !repoDirRequest();
      case 'stashes':
      default:
        return false;
    }
  };
  const runRepositoryAction = (action: RepositoryHeaderActionId) => {
    if (repositoryActionDisabled(action)) return;
    switch (action) {
      case 'stashes': {
        const repoRootPath = exactGitPath(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath);
        if (repoRootPath) props.onOpenStash?.({ tab: 'stashes', repoRootPath, source: 'header' });
        return;
      }
      case 'fetch':
        props.onFetch?.();
        return;
      case 'pull':
        props.onPull?.();
        return;
      case 'push':
        props.onPush?.();
        return;
      case 'terminal': {
        const request = repoDirRequest();
        if (request) props.onOpenInTerminal?.(request);
        return;
      }
      case 'files': {
        const request = repoDirRequest();
        if (request) void props.onBrowseFiles?.(request);
      }
    }
  };
  const primaryRepositoryAction = (): RepositoryHeaderActionId | null => {
    if (!detachedHead() && Number(props.repoSummary?.behindCount ?? 0) > 0 && props.onPull) return 'pull';
    if (!detachedHead() && Number(props.repoSummary?.aheadCount ?? 0) > 0 && props.onPush) return 'push';
    if (props.onFetch) return 'fetch';
    if (!detachedHead() && props.onPull) return 'pull';
    if (!detachedHead() && props.onPush) return 'push';
    return null;
  };
  const repositoryHeaderMenuItems = createMemo<DropdownItem[]>(() => {
    const primary = primaryRepositoryAction();
    const items: DropdownItem[] = [];
    if (props.onOpenStash) {
      items.push({ id: 'stashes', label: repositoryActionLabel('stashes'), disabled: repositoryActionDisabled('stashes') });
    }
    const remoteActions: RepositoryHeaderActionId[] = ['fetch', 'pull', 'push'];
    for (const action of remoteActions) {
      const available = action === 'fetch' ? props.onFetch : action === 'pull' ? props.onPull : props.onPush;
      if (!available || action === primary) continue;
      items.push({ id: action, label: repositoryActionLabel(action), disabled: repositoryActionDisabled(action) });
    }
    if (props.onOpenInTerminal) {
      items.push({ id: 'terminal', label: repositoryActionLabel('terminal'), disabled: repositoryActionDisabled('terminal') });
    }
    if (props.onBrowseFiles) {
      items.push({ id: 'files', label: repositoryActionLabel('files'), disabled: repositoryActionDisabled('files') });
    }
    return items;
  });

  return (
    <div class={cn('relative flex h-full min-h-0 flex-col', redevenSurfaceRoleClass('main'), props.class)}>
      <div
        class={cn('shrink-0 border-b px-2.5 py-1.5', redevenDividerRoleClass(), redevenSurfaceRoleClass('inset'))}
        data-git-repository-header="compact"
      >
        <div class="flex min-w-0 items-center justify-between gap-3">
          <div
            class="min-w-0 flex-1 rounded-md px-1 py-0.5"
            tabIndex={0}
            data-git-repository-context-target="header"
            onContextMenu={(event) => {
              const target = repositoryContextTarget();
              if (target) repositoryContextMenu.openFromContextMenu(event, target);
            }}
            onKeyDown={(event) => {
              const target = repositoryContextTarget();
              if (target) repositoryContextMenu.openFromKeyboard(event, target);
            }}
          >
            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
              <GitPrimaryTitle class="min-w-0 max-w-full truncate">{repoLabel()}</GitPrimaryTitle>
              <span class="text-muted-foreground/45" aria-hidden="true">/</span>
              <Show
                when={headDisplay().detached}
                fallback={<GitMetaPill tone="neutral">{headRef() || 'HEAD'}</GitMetaPill>}
              >
                <GitMetaPill tone="warning">{headDisplay().label}</GitMetaPill>
              </Show>
              <Show when={props.repoSummary && (props.repoSummary.aheadCount || props.repoSummary.behindCount)}>
                <GitMetaPill tone="info">{localizedSyncStatusLabel(props.repoSummary?.aheadCount, props.repoSummary?.behindCount, i18n)}</GitMetaPill>
              </Show>
              <Show when={loadingBusy()}>
                <GitInlineLoadingStatus class="w-16">{i18n.t('files.refreshing')}</GitInlineLoadingStatus>
              </Show>
            </div>
            <div class="mt-0.5 truncate text-[10px] text-muted-foreground" title={repoPath()}>{repoPath()}</div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <Show when={headDisplay().detached && reattachBranch() && props.onCheckoutBranch}>
              <Button
                size="xs"
                variant="ghost"
                class={cn('shrink-0', gitToneHeaderActionButtonClass())}
                disabled={repoActionsDisabled() || props.checkoutBusy}
                onClick={() => {
                  const branch = reattachBranch();
                  if (branch) props.onCheckoutBranch?.(branch);
                }}
              >
                {localizedDetachedHeadCheckoutActionLabel(reattachBranch(), Boolean(props.checkoutBusy), i18n)}
              </Button>
            </Show>
            <Show when={primaryRepositoryAction()}>
              {(action) => (
                <Button
                  size="sm"
                  variant="default"
                  class="shrink-0 rounded-md"
                  loading={action() === 'fetch' ? props.fetchBusy : action() === 'pull' ? props.pullBusy : props.pushBusy}
                  disabled={repositoryActionDisabled(action())}
                  onClick={() => runRepositoryAction(action())}
                >
                  {repositoryActionLabel(action())}
                </Button>
              )}
            </Show>
            <Show when={props.showMobileSidebarButton && props.onToggleSidebar}>
              <Button
                size="xs"
                variant="ghost"
                icon={History}
                class={cn('shrink-0', gitToneHeaderActionButtonClass())}
                aria-label={i18n.t('files.sidebarToggle')}
                onClick={props.onToggleSidebar}
              >
                {i18n.t('files.sidebar')}
              </Button>
            </Show>
            <Show when={props.onRefresh}>
              <Button
                size="sm"
                variant="ghost"
                class={cn('shrink-0 px-2', gitToneHeaderActionButtonClass())}
                aria-label={i18n.t('common.actions.refresh')}
                title={i18n.t('common.actions.refresh')}
                onClick={props.onRefresh}
              >
                <Refresh class="size-3.5" />
              </Button>
            </Show>
            <Show when={repositoryHeaderMenuItems().length > 0}>
              <Dropdown
                trigger={(
                  <Button
                    size="sm"
                    variant="ghost"
                    class={cn('shrink-0 px-2', gitToneHeaderActionButtonClass())}
                    aria-label={i18n.t('git.common.moreActions')}
                    title={i18n.t('git.common.moreActions')}
                  >
                    <MoreHorizontal class="size-3.5" />
                  </Button>
                )}
                items={repositoryHeaderMenuItems()}
                onSelect={(id) => runRepositoryAction(id as RepositoryHeaderActionId)}
                align="end"
              />
            </Show>
          </div>
        </div>
        <Show when={headDisplay().detached}>
          <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-1 text-[10px] text-muted-foreground">
            <span class="text-foreground">{detachedHeadSummary()}</span>
            <Show when={headDisplay().detail}><GitMetaPill tone="neutral">{headDisplay().detail}</GitMetaPill></Show>
            <Show when={reattachBranch()}><span>{reattachSummary()}</span></Show>
          </div>
        </Show>
      </div>

      <GitEntityContextMenu controller={repositoryContextMenu} items={repositoryContextMenuItems} />

      <div class="relative flex-1 min-h-0 overflow-hidden">
        <UIFirstKeepAlivePanel active={activeSubview() === 'changes'} class="absolute inset-0" testId="git-main-subview-changes" render={() => (
          <div
            role="tabpanel"
            id={buildTabPanelElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, 'changes')}
            aria-labelledby={buildTabElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, 'changes')}
            tabIndex={0}
            class="h-full"
          >
            <GitChangesPanel
              repoSummary={props.repoSummary}
              workspace={props.workspace}
              workspacePages={props.workspacePages}
              selectedSection={props.selectedWorkspaceSection}
              onSelectSection={props.onSelectWorkspaceSection}
              selectedItem={props.selectedWorkspaceItem}
              onSelectItem={props.onSelectWorkspaceItem}
              busyWorkspaceKey={props.busyWorkspaceKey}
              busyWorkspaceAction={props.busyWorkspaceAction}
              loading={props.workspaceLoading}
              error={props.workspaceError}
              commitMessage={props.commitMessage}
              onCommitMessageChange={props.onCommitMessageChange}
              onCommit={props.onCommit}
              commitBusy={props.commitBusy}
              onStageSelected={props.onStageSelected}
              onUnstageSelected={props.onUnstageSelected}
              onDiscardSelected={props.onDiscardSelected}
              onNavigateDirectory={props.onNavigateWorkspaceDirectory}
              onBulkAction={props.onBulkAction}
              onDiscardAll={props.onDiscardAll}
              onLoadMoreWorkspaceSection={props.onLoadMoreWorkspaceSection}
              onOpenCommitDialog={props.onOpenCommitDialog}
              onOpenStash={props.onOpenStash}
              onAskFlower={(request) => props.onAskFlower?.(request)}
              onOpenInTerminal={props.onOpenInTerminal}
              onBrowseFiles={props.onBrowseFiles}
              onPreviewCurrentFile={props.onPreviewCurrentFile}
              onCopyText={props.onCopyText}
            />
          </div>
        )} />

        <UIFirstKeepAlivePanel active={activeSubview() === 'branches'} class="absolute inset-0" testId="git-main-subview-branches" render={() => (
          <div
            role="tabpanel"
            id={buildTabPanelElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, 'branches')}
            aria-labelledby={buildTabElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, 'branches')}
            tabIndex={0}
            class="h-full"
          >
            <GitBranchesPanel
              repoRootPath={props.repoSummary?.repoRootPath}
              repoSummary={props.repoSummary}
              statusRefreshToken={props.statusRefreshToken}
              protocolClientIdentity={props.protocolClientIdentity}
              capabilityMode={props.capabilityMode}
              selectedBranch={props.selectedBranch}
              branchDetailState={props.branchDetailState}
              selectedBranchSubview={props.selectedBranchSubview}
              onSelectBranchSubview={props.onSelectBranchSubview}
              onRefreshSelectedBranch={props.onRefreshSelectedBranch}
              onSelectCurrentBranch={props.onSelectCurrentBranch}
              branches={props.branches}
              branchesLoading={props.branchesLoading}
              branchesError={props.branchesError}
              commits={props.commits}
              listLoading={props.listLoading}
              listRefreshing={props.listRefreshing}
              listLoadingMore={props.listLoadingMore}
              listError={props.listError}
              hasMore={props.hasMore}
              selectedCommitHash={props.selectedCommitHash}
              onSelectCommit={props.onSelectCommit}
              onLoadMore={props.onLoadMore}
              switchDetachedBusy={props.switchDetachedBusy}
              checkoutBusy={props.checkoutBusy}
              mergeBusy={props.mergeBusy}
              deleteBusy={props.deleteBusy}
              mergeReviewOpen={props.mergeReviewOpen}
              mergeReviewBranch={props.mergeReviewBranch}
              mergePreview={props.mergePreview}
              mergePreviewError={props.mergePreviewError}
              mergeActionError={props.mergeActionError}
              mergeDialogState={props.mergeDialogState}
              deleteReviewOpen={props.deleteReviewOpen}
              deleteReviewBranch={props.deleteReviewBranch}
              deletePreview={props.deletePreview}
              deletePreviewError={props.deletePreviewError}
              deleteActionError={props.deleteActionError}
              deleteDialogState={props.deleteDialogState}
              onCheckoutBranch={props.onCheckoutBranch}
              onMergeBranch={props.onMergeBranch}
              onDeleteBranch={props.onDeleteBranch}
              onSwitchDetached={props.onSwitchDetached}
              onCloseMergeReview={props.onCloseMergeReview}
              onRetryMergePreview={props.onRetryMergePreview}
              onConfirmMergeBranch={props.onConfirmMergeBranch}
              onOpenStash={props.onOpenStash}
              onCloseDeleteReview={props.onCloseDeleteReview}
              onRetryDeletePreview={props.onRetryDeletePreview}
              onConfirmDeleteBranch={props.onConfirmDeleteBranch}
              onAskFlower={(request) => props.onAskFlower?.(request)}
              onOpenInTerminal={props.onOpenInTerminal}
              onBrowseFiles={props.onBrowseFiles}
              onPreviewCurrentFile={props.onPreviewCurrentFile}
              onCopyText={props.onCopyText}
              renderReviewDialogs={false}
            />
          </div>
        )} />

        <UIFirstKeepAlivePanel active={activeSubview() === 'history'} class="absolute inset-0" testId="git-main-subview-history" render={() => (
          <div
            role="tabpanel"
            id={buildTabPanelElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, 'history')}
            aria-labelledby={buildTabElementId(GIT_WORKBENCH_SUBVIEW_ID_PREFIX, 'history')}
            tabIndex={0}
            class="h-full"
          >
            <GitHistoryBrowser
              class="h-full"
              currentPath={props.currentPath}
              repoInfo={props.repoInfo}
              repoInfoLoading={props.repoInfoLoading}
              repoSummary={props.repoSummary}
              selectedCommitHash={props.selectedCommitHash}
              switchDetachedBusy={props.switchDetachedBusy}
              onSwitchDetached={props.onSwitchDetached}
              onAskFlower={(request) => props.onAskFlower?.(request)}
              onOpenInTerminal={props.onOpenInTerminal}
              onBrowseFiles={props.onBrowseFiles}
              onPreviewCurrentFile={props.onPreviewCurrentFile}
              onCopyText={props.onCopyText}
            />
          </div>
        )} />
      </div>

      <GitMergeBranchDialog
        open={Boolean(props.mergeReviewOpen && mergeReviewBranch())}
        branch={mergeReviewBranch()}
        preview={props.mergePreview ?? null}
        previewError={props.mergePreviewError}
        actionError={props.mergeActionError}
        state={props.mergeDialogState ?? 'idle'}
        onClose={() => props.onCloseMergeReview?.()}
        onRetryPreview={(branch) => props.onRetryMergePreview?.(branch)}
        onOpenStash={(request) => props.onOpenStash?.(request)}
        onConfirm={(branch, options) => props.onConfirmMergeBranch?.(branch, options)}
      />

      <GitDeleteBranchDialog
        open={Boolean(props.deleteReviewOpen && deleteReviewBranch())}
        branch={deleteReviewBranch()}
        preview={props.deletePreview ?? null}
        previewError={props.deletePreviewError}
        actionError={props.deleteActionError}
        state={props.deleteDialogState ?? 'idle'}
        worktreeMode={deleteReviewUsesWorktree()}
        onClose={() => props.onCloseDeleteReview?.()}
        onRetryPreview={(branch) => props.onRetryDeletePreview?.(branch)}
        onConfirm={(branch, options) => props.onConfirmDeleteBranch?.(branch, options)}
      />
    </div>
  );
}
