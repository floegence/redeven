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
import { buildGitWorkbenchSubviewItems, type GitBranchSubview, type GitDetachedSwitchTarget, type GitStashWindowRequest, type GitWorkbenchSubview, type GitWorkspaceViewPageState, type GitWorkspaceViewSection } from '../utils/gitWorkbench';
import { BrowserWorkspaceShell } from './BrowserWorkspaceShell';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { GitViewNav } from './GitViewNav';
import { GitWorkbenchSidebar } from './GitWorkbenchSidebar';
import { GitWorkbench } from './GitWorkbench';
import { GitStatePane, GitSubtleNote } from './GitWorkbenchPrimitives';
import type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchDialog';
import type { GitMergeBranchDialogConfirmOptions, GitMergeBranchDialogState } from './GitMergeBranchDialog';
import type { GitAskFlowerRequest, GitDirectoryShortcutRequest } from '../utils/gitBrowserShortcuts';

export interface GitWorkspaceProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
  gitHistoryDisabled?: boolean;
  gitHistoryDisabledReason?: string;
  subview: GitWorkbenchSubview;
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
  onBulkWorkspaceAction?: (section: GitWorkspaceViewSection) => void;
  onOpenStash?: (request: GitStashWindowRequest) => void;
  onAskFlower?: (request: GitAskFlowerRequest) => void;
  onOpenInTerminal?: (request: GitDirectoryShortcutRequest) => void;
  onBrowseFiles?: (request: GitDirectoryShortcutRequest) => void | Promise<void>;
  busyWorkspaceKey?: string;
  busyWorkspaceAction?: 'stage' | 'unstage' | '';
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  statusRefreshToken?: number;
  selectedBranch?: GitBranchSummary | null;
  selectedBranchKey?: string;
  onSelectBranch?: (branch: GitBranchSummary) => void;
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
  const subviewItems = () => buildGitWorkbenchSubviewItems({
    repoSummary: props.repoSummary,
    workspace: props.workspace,
    branchesCount: (props.branches?.local.length ?? 0) + (props.branches?.remote.length ?? 0),
  });
  const shellLoadingMessage = () => String(props.shellLoadingMessage ?? '').trim();
  const shellBlocking = () => shellLoadingMessage().length > 0;
  const shellSidebarNote = () => 'Preparing the active Git view...';

  return (
    <BrowserWorkspaceShell
      title="Browser"
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
          gitHistoryDisabled={props.gitHistoryDisabled}
          gitHistoryDisabledReason={props.gitHistoryDisabledReason}
          class="w-full"
        />
      )}
      navigationLabel="View"
      navigation={<GitViewNav value={props.subview} items={subviewItems()} onChange={props.onSubviewChange} />}
      sidebarBody={(
        shellBlocking()
          ? <GitSubtleNote class="mx-0.5">{shellSidebarNote()}</GitSubtleNote>
          : (
            <GitWorkbenchSidebar
              subview={props.subview}
              onClose={props.onClose}
              repoInfoLoading={props.repoInfoLoading}
              repoInfoError={props.repoInfoError}
              repoAvailable={props.repoInfo?.available}
              repoUnavailableReason={props.repoUnavailableReason}
              repoSummary={props.repoSummary}
              workspace={props.workspace}
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
          )
      )}
      content={(
        shellBlocking()
          ? <GitStatePane loading message={shellLoadingMessage()} class="h-full px-4 py-6" />
          : (
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
              statusRefreshToken={props.statusRefreshToken}
              selectedBranch={props.selectedBranch}
              selectedBranchSubview={props.selectedBranchSubview}
              onSelectBranchSubview={props.onSelectBranchSubview}
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
              onBulkAction={props.onBulkWorkspaceAction}
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
          )
      )}
      class={props.class}
    />
  );
}
