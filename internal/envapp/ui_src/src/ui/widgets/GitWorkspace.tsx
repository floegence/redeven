import { Show } from 'solid-js';
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
import { type GitBranchDetailPresentationState, type GitBranchSubview, type GitDetachedSwitchTarget, type GitStashWindowRequest, type GitWorkbenchSubview, type GitWorkspaceViewPageState, type GitWorkspaceViewSection } from '../utils/gitWorkbench';
import { localizedGitWorkbenchSubviewItems } from '../utils/localizedGitWorkbench';
import { BrowserWorkspaceShell } from './BrowserWorkspaceShell';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { GitViewNav } from './GitViewNav';
import { GitWorkbenchSidebar } from './GitWorkbenchSidebar';
import { GitWorkbench } from './GitWorkbench';
import { GitInlineLoadingStatus, GitSubtleNote } from './GitWorkbenchPrimitives';
import type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchDialog';
import type { GitMergeBranchDialogConfirmOptions, GitMergeBranchDialogState } from './GitMergeBranchDialog';
import type { GitAskFlowerRequest, GitDirectoryShortcutRequest } from '../utils/gitBrowserShortcuts';
import { useI18n } from '../i18n';

export interface GitWorkspaceProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
  onPreviewGitMode?: () => void;
  gitHistoryDisabled?: boolean;
  gitHistoryDisabledReason?: string;
  subview: GitWorkbenchSubview;
  navigationSubview?: GitWorkbenchSubview;
  onSubviewChange: (view: GitWorkbenchSubview) => void;
  width?: number;
  open?: boolean;
  resizable?: boolean;
  onResize?: (delta: number) => void;
  onClose?: () => void;
  currentPath: string;
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  repoInfoError?: string;
  repoUnavailableReason?: string;
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
  onStageWorkspaceItem?: (item: GitWorkspaceChange) => void;
  onUnstageWorkspaceItem?: (item: GitWorkspaceChange) => void;
  onDiscardWorkspaceItem?: (item: GitWorkspaceChange) => void;
  onNavigateWorkspaceDirectory?: (directoryPath: string) => void;
  onBulkWorkspaceAction?: (section: GitWorkspaceViewSection) => void;
  onDiscardWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  onOpenStash?: (request: GitStashWindowRequest) => void;
  onAskFlower?: (request: GitAskFlowerRequest) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: 'stage' | 'unstage' | 'discard' | '';
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  statusRefreshToken?: number;
  selectedBranch?: GitBranchSummary | null;
  branchDetailState?: GitBranchDetailPresentationState;
  selectedBranchKey?: string;
  onSelectBranch?: (branch: GitBranchSummary) => void;
  selectedBranchSubview?: GitBranchSubview;
  onSelectBranchSubview?: (view: GitBranchSubview) => void;
  onRefreshSelectedBranch?: () => void;
  onSelectCurrentBranch?: () => void;
  onBranchDetailLoadFailure?: () => void;
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
  commitMessage?: string;
  commitBusy?: boolean;
  onCommitMessageChange?: (value: string) => void;
  onCommit?: (message: string) => void;
  onLoadMoreWorkspaceSection?: (section: GitWorkspaceViewSection) => void;
  onOpenCommitDialog?: () => void;
  fetchBusy?: boolean;
  pullBusy?: boolean;
  pushBusy?: boolean;
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
  onFetch?: () => void;
  onPull?: () => void;
  onPush?: () => void;
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
  showMobileSidebarButton?: boolean;
  onToggleSidebar?: () => void;
  onRefresh?: () => void;
  shellLoadingMessage?: string;
  class?: string;
}

export function GitWorkspace(props: GitWorkspaceProps) {
  const i18n = useI18n();
  const subviewItems = () => localizedGitWorkbenchSubviewItems({
    repoSummary: props.repoSummary,
    workspace: props.workspace,
    branchesCount: (props.branches?.local.length ?? 0) + (props.branches?.remote.length ?? 0),
  }, i18n);
  const shellLoadingMessage = () => String(props.shellLoadingMessage ?? '').trim();
  const shellBlocking = () => shellLoadingMessage().length > 0;
  const shellSidebarNote = () => i18n.t('git.workspace.preparingActiveView');

  return (
    <BrowserWorkspaceShell
      title={i18n.t('files.title')}
      width={props.width}
      open={props.open}
      resizable={props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      sidebarBodyClass="overflow-hidden"
      modeSwitcher={(
        <GitHistoryModeSwitch
          mode={props.mode}
          onChange={props.onModeChange}
          onPreviewGitMode={props.onPreviewGitMode}
          gitHistoryDisabled={props.gitHistoryDisabled}
          gitHistoryDisabledReason={props.gitHistoryDisabledReason}
          class="w-full"
        />
      )}
      navigationLabel="View"
      navigation={<GitViewNav value={props.navigationSubview ?? props.subview} items={subviewItems()} onChange={props.onSubviewChange} />}
      sidebarBody={(
        <div class="flex h-full min-h-0 flex-col gap-2">
          <Show when={shellBlocking()}>
            <GitSubtleNote class="mx-0.5 shrink-0 py-1.5 text-[11px]">
              {shellSidebarNote()}
            </GitSubtleNote>
          </Show>
          <div class="min-h-0 flex-1">
            <GitWorkbenchSidebar
              subview={props.subview}
              onClose={props.onClose}
              repoInfoLoading={props.repoInfoLoading}
              repoInfoError={props.repoInfoError}
              repoAvailable={props.repoInfo?.available}
              repoUnavailableReason={props.repoUnavailableReason}
              repoSummary={props.repoSummary}
              workspace={props.workspace}
              workspacePages={props.workspacePages}
              workspaceLoading={props.workspaceLoading}
              workspaceError={props.workspaceError}
              selectedWorkspaceSection={props.selectedWorkspaceSection}
              onSelectWorkspaceSection={props.onSelectWorkspaceSection}
              branches={props.branches}
              branchesLoading={props.branchesLoading}
              branchesError={props.branchesError}
              selectedBranchKey={props.selectedBranchKey}
              onSelectBranch={props.onSelectBranch}
              commits={props.commits}
              listLoading={props.listLoading}
              listLoadingMore={props.listLoadingMore}
              listError={props.listError}
              hasMore={props.hasMore}
              selectedCommitHash={props.selectedCommitHash}
              onSelectCommit={props.onSelectCommit}
              onLoadMore={props.onLoadMore}
            />
          </div>
        </div>
      )}
      content={(
        <div class="relative h-full min-h-0">
          <Show when={shellBlocking()}>
            <div class="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-start">
              <GitInlineLoadingStatus class="shadow-sm">{shellLoadingMessage()}</GitInlineLoadingStatus>
            </div>
          </Show>
            <GitWorkbench
              class="h-full"
              currentPath={props.currentPath}
              repoInfo={props.repoInfo}
              repoInfoLoading={props.repoInfoLoading}
              subview={props.subview}
              repoSummary={props.repoSummary}
              repoSummaryLoading={props.repoSummaryLoading}
              repoSummaryError={props.repoSummaryError}
              workspace={props.workspace}
              workspacePages={props.workspacePages}
              workspaceLoading={props.workspaceLoading}
              workspaceError={props.workspaceError}
              selectedWorkspaceSection={props.selectedWorkspaceSection}
              onSelectWorkspaceSection={props.onSelectWorkspaceSection}
              selectedWorkspaceItem={props.selectedWorkspaceItem}
              onSelectWorkspaceItem={props.onSelectWorkspaceItem}
              busyWorkspaceKey={props.busyWorkspaceKey}
              busyWorkspaceAction={props.busyWorkspaceAction}
              branches={props.branches}
              branchesLoading={props.branchesLoading}
              branchesError={props.branchesError}
              branchDetailState={props.branchDetailState}
              statusRefreshToken={props.statusRefreshToken}
              selectedBranch={props.selectedBranch}
              selectedBranchSubview={props.selectedBranchSubview}
              onSelectBranchSubview={props.onSelectBranchSubview}
              onRefreshSelectedBranch={props.onRefreshSelectedBranch}
              onSelectCurrentBranch={props.onSelectCurrentBranch}
              onBranchDetailLoadFailure={props.onBranchDetailLoadFailure}
              selectedCommitHash={props.selectedCommitHash}
              commits={props.commits}
              listLoading={props.listLoading}
              listRefreshing={props.listRefreshing}
              listLoadingMore={props.listLoadingMore}
              listError={props.listError}
              hasMore={props.hasMore}
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
              onCloseDeleteReview={props.onCloseDeleteReview}
              onRetryDeletePreview={props.onRetryDeletePreview}
              onConfirmDeleteBranch={props.onConfirmDeleteBranch}
              commitMessage={props.commitMessage}
              commitBusy={props.commitBusy}
              onCommitMessageChange={props.onCommitMessageChange}
              onCommit={props.onCommit}
              onStageSelected={props.onStageWorkspaceItem}
              onUnstageSelected={props.onUnstageWorkspaceItem}
              onDiscardSelected={props.onDiscardWorkspaceItem}
              onNavigateWorkspaceDirectory={props.onNavigateWorkspaceDirectory}
              onBulkAction={props.onBulkWorkspaceAction}
              onDiscardAll={props.onDiscardWorkspaceSection}
              onLoadMoreWorkspaceSection={props.onLoadMoreWorkspaceSection}
              onOpenCommitDialog={props.onOpenCommitDialog}
              onOpenStash={props.onOpenStash}
              onAskFlower={props.onAskFlower}
              onOpenInTerminal={props.onOpenInTerminal}
              onBrowseFiles={props.onBrowseFiles}
              fetchBusy={props.fetchBusy}
              pullBusy={props.pullBusy}
              pushBusy={props.pushBusy}
              onFetch={props.onFetch}
              onPull={props.onPull}
              onPush={props.onPush}
              showMobileSidebarButton={props.showMobileSidebarButton}
              onToggleSidebar={props.onToggleSidebar}
              onRefresh={props.onRefresh}
            />
        </div>
      )}
      class={['redeven-git-browser', props.class].filter(Boolean).join(' ')}
    />
  );
}
