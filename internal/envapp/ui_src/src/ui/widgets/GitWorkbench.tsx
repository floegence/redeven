import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { History, Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
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
  detachedHeadCheckoutActionLabel,
  detachedHeadReattachSummary,
  detachedHeadViewingSummary,
  reattachBranchFromRepoSummary,
  repoDisplayName,
  syncStatusLabel,
  type GitStashWindowRequest,
  type GitBranchSubview,
  type GitDetachedSwitchTarget,
  type GitWorkbenchSubview,
  type GitWorkspaceViewPageState,
  type GitWorkspaceViewSection,
} from '../utils/gitWorkbench';
import { GitChangesPanel } from './GitChangesPanel';
import { GitBranchesPanel } from './GitBranchesPanel';
import { GitHistoryBrowser } from './GitHistoryBrowser';
import { gitSubviewTone, gitToneActionButtonClass } from './GitChrome';
import { GitLabelBlock, GitMetaPill, GitPrimaryTitle } from './GitWorkbenchPrimitives';
import type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchDialog';
import type { GitMergeBranchDialogConfirmOptions, GitMergeBranchDialogState } from './GitMergeBranchDialog';
import { buildTabElementId, buildTabPanelElementId } from '../utils/tabNavigation';
import type { GitAskFlowerRequest, GitDirectoryShortcutRequest } from '../utils/gitBrowserShortcuts';

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
  busyWorkspaceAction?: 'stage' | 'unstage' | '';
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  statusRefreshToken?: number;
  selectedBranch?: GitBranchSummary | null;
  selectedBranchSubview?: GitBranchSubview;
  onSelectBranchSubview?: (view: GitBranchSubview) => void;
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
  onBulkAction?: (section: GitWorkspaceViewSection) => void;
  onLoadMoreWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  onOpenCommitDialog?: () => void;
  onOpenStash?: (request: GitStashWindowRequest) => void;
  onAskFlower?: (request: GitAskFlowerRequest) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
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

function subviewLabel(view: GitWorkbenchSubview): string {
  switch (view) {
    case 'changes':
      return 'Changes';
    case 'branches':
      return 'Branches';
    case 'history':
      return 'Graph';
    default:
      return 'Changes';
  }
}

function normalizeSubview(view: GitWorkbenchSubview): GitWorkbenchSubview {
  return view === 'overview' ? 'changes' : view;
}

const GIT_WORKBENCH_SUBVIEW_ID_PREFIX = 'git-workbench-subview';

export function GitWorkbench(props: GitWorkbenchProps) {
  const repoLabel = () => repoDisplayName(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath);
  const repoPath = () => String(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath || '/').trim() || '/';
  const headRef = () => String(props.repoSummary?.headRef || props.repoInfo?.headRef || '').trim();
  const headDisplay = () => describeGitHead(props.repoSummary, props.repoInfo);
  const reattachBranch = () => reattachBranchFromRepoSummary(props.repoSummary);
  const activeSubview = () => normalizeSubview(props.subview);
  const loadingBusy = () => {
    if (props.repoInfoLoading) return true;
    if (activeSubview() === 'changes') return Boolean(props.workspaceLoading);
    if (activeSubview() === 'branches') return Boolean(props.branchesLoading);
    if (activeSubview() === 'history') return Boolean(props.listLoading);
    return false;
  };
  const subviewTone = () => gitSubviewTone(activeSubview());
  const detachedHead = () => headDisplay().detached;
  const stashCountLabel = () => {
    const count = Number(props.repoSummary?.stashCount ?? 0);
    return count > 0 ? `Stashes · ${count}` : 'Stashes';
  };
  const repoActionsDisabled = () => Boolean(
    props.repoInfoLoading
    || !(props.repoInfo?.available ?? Boolean(props.repoSummary?.repoRootPath))
    || !(props.repoInfo?.repoRootPath || props.repoSummary?.repoRootPath)
  );
  const detachedHeadSummary = () => detachedHeadViewingSummary(props.repoSummary?.headCommit || props.repoInfo?.headCommit);
  const reattachSummary = () => detachedHeadReattachSummary(reattachBranch(), { compact: true });

  return (
    <div class={cn('relative flex h-full min-h-0 flex-col bg-background', props.class)}>
      <div class="shrink-0 border-b border-border/50 bg-background/92 px-3 py-2 backdrop-blur-sm">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <GitLabelBlock
            class="min-w-0 flex-1"
            label={subviewLabel(activeSubview())}
            tone={subviewTone()}
            meta={
              <>
                <Show when={headDisplay().detached} fallback={<GitMetaPill tone={subviewTone()}>{headRef() || 'HEAD'}</GitMetaPill>}>
                  <>
                    <GitMetaPill tone="warning">{headDisplay().label}</GitMetaPill>
                    <Show when={headDisplay().detail}>
                      <GitMetaPill tone="neutral">{headDisplay().detail}</GitMetaPill>
                    </Show>
                  </>
                </Show>
                <Show when={loadingBusy()}>
                  <GitMetaPill tone="neutral">Refreshing…</GitMetaPill>
                </Show>
              </>
            }
          >
            <div class="flex flex-wrap items-center gap-2.5">
              <GitPrimaryTitle class="min-w-0 max-w-full truncate">
                {repoLabel()}
              </GitPrimaryTitle>
              <Show when={props.repoSummary && (props.repoSummary.aheadCount || props.repoSummary.behindCount)}>
                <GitMetaPill tone="info">{syncStatusLabel(props.repoSummary?.aheadCount, props.repoSummary?.behindCount)}</GitMetaPill>
              </Show>
            </div>
            <div class="min-w-0 max-w-full truncate text-[11px] text-muted-foreground">{repoPath()}</div>
            <Show when={headDisplay().detached}>
              <div class="text-[11px] text-foreground">{detachedHeadSummary()}</div>
              <Show when={reattachBranch()}>
                <div class="text-[11px] text-muted-foreground">{reattachSummary()}</div>
              </Show>
            </Show>
          </GitLabelBlock>

          <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5 self-start">
            <Show when={headDisplay().detached && reattachBranch() && props.onCheckoutBranch}>
              <Button
                size="xs"
                variant="ghost"
                class={cn('shrink-0', gitToneActionButtonClass())}
                disabled={repoActionsDisabled() || props.checkoutBusy}
                onClick={() => {
                  const branch = reattachBranch();
                  if (branch) props.onCheckoutBranch?.(branch);
                }}
              >
                {detachedHeadCheckoutActionLabel(reattachBranch(), props.checkoutBusy)}
              </Button>
            </Show>
            <Show when={props.onOpenStash}>
              <Button
                size="xs"
                variant="ghost"
                class={cn('shrink-0', gitToneActionButtonClass())}
                disabled={repoActionsDisabled()}
                onClick={() => {
                  const repoRootPath = String(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || '').trim();
                  if (!repoRootPath) return;
                  props.onOpenStash?.({
                    tab: 'stashes',
                    repoRootPath,
                    source: 'header',
                  });
                }}
              >
                {stashCountLabel()}
              </Button>
            </Show>
            <Show when={props.onFetch}>
              <Button
                size="xs"
                variant="ghost"
                class={cn('shrink-0', gitToneActionButtonClass())}
                disabled={repoActionsDisabled() || props.fetchBusy}
                onClick={props.onFetch}
              >
                {props.fetchBusy ? 'Fetching...' : 'Fetch'}
              </Button>
            </Show>
            <Show when={props.onPull}>
              <Button
                size="xs"
                variant="ghost"
                class={cn('shrink-0', gitToneActionButtonClass())}
                disabled={repoActionsDisabled() || detachedHead() || props.pullBusy}
                onClick={props.onPull}
              >
                {props.pullBusy ? 'Pulling...' : 'Pull'}
              </Button>
            </Show>
            <Show when={props.onPush}>
              <Button
                size="xs"
                variant="ghost"
                class={cn('shrink-0', gitToneActionButtonClass())}
                disabled={repoActionsDisabled() || detachedHead() || props.pushBusy}
                onClick={props.onPush}
              >
                {props.pushBusy ? 'Pushing...' : 'Push'}
              </Button>
            </Show>
            <Show when={props.showMobileSidebarButton && props.onToggleSidebar}>
              <Button
                size="xs"
                variant="ghost"
                icon={History}
                class={cn('shrink-0', gitToneActionButtonClass())}
                aria-label="Toggle browser sidebar"
                onClick={props.onToggleSidebar}
              >
                Sidebar
              </Button>
            </Show>
            <Show when={props.onRefresh}>
              <Button size="xs" variant="ghost" class={cn('shrink-0', gitToneActionButtonClass())} icon={Refresh} onClick={props.onRefresh}>
                Refresh
              </Button>
            </Show>
          </div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-hidden">
        <Show when={activeSubview() === 'changes'}>
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
              onBulkAction={props.onBulkAction}
              onLoadMoreWorkspaceSection={props.onLoadMoreWorkspaceSection}
              onOpenCommitDialog={props.onOpenCommitDialog}
              onOpenStash={props.onOpenStash}
              onAskFlower={(request) => props.onAskFlower?.(request)}
              onOpenInTerminal={props.onOpenInTerminal}
              onBrowseFiles={props.onBrowseFiles}
            />
          </div>
        </Show>

        <Show when={activeSubview() === 'branches'}>
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
              selectedBranch={props.selectedBranch}
              selectedBranchSubview={props.selectedBranchSubview}
              onSelectBranchSubview={props.onSelectBranchSubview}
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
            />
          </div>
        </Show>

        <Show when={activeSubview() === 'history'}>
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
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
