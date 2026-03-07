import { type JSX } from 'solid-js';
import type {
  GitBranchSummary,
  GitCommitSummary,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
  GitResolveRepoResponse,
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import { buildGitWorkbenchSubviewItems, type GitWorkbenchSubview } from '../utils/gitWorkbench';
import { BrowserWorkspaceShell } from './BrowserWorkspaceShell';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { GitViewNav } from './GitViewNav';
import { GitWorkbenchSidebar } from './GitWorkbenchSidebar';
import { GitWorkbench } from './GitWorkbench';
import { gitToneBadgeClass } from './GitChrome';

export interface GitWorkspaceProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
  gitHistoryDisabled?: boolean;
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
  repoSummary?: GitRepoSummaryResponse | null;
  repoSummaryLoading?: boolean;
  repoSummaryError?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  workspaceLoading?: boolean;
  workspaceError?: string;
  selectedWorkspaceItem?: GitWorkspaceChange | null;
  selectedWorkspaceKey?: string;
  onSelectWorkspaceItem?: (item: GitWorkspaceChange) => void;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  selectedBranch?: GitBranchSummary | null;
  selectedBranchKey?: string;
  onSelectBranch?: (branch: GitBranchSummary) => void;
  compare?: GitGetBranchCompareResponse | null;
  compareLoading?: boolean;
  compareError?: string;
  commits?: GitCommitSummary[];
  listLoading?: boolean;
  listLoadingMore?: boolean;
  listError?: string;
  hasMore?: boolean;
  selectedCommitHash?: string;
  onSelectCommit?: (hash: string) => void;
  onLoadMore?: () => void;
  showSidebarToggle?: boolean;
  onOpenSidebar?: () => void;
  onRefresh?: () => void;
  class?: string;
}

export function GitWorkspace(props: GitWorkspaceProps) {
  const subviewItems = () => buildGitWorkbenchSubviewItems({
    repoSummary: props.repoSummary,
    workspace: props.workspace,
    branchesCount: (props.branches?.local.length ?? 0) + (props.branches?.remote.length ?? 0),
  });

  return (
    <BrowserWorkspaceShell
      title="Browser"
      headerActions={<span class={gitToneBadgeClass('violet') + ' inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]'}>Git</span>}
      width={props.width}
      open={props.open}
      resizable={props.resizable}
      onResize={props.onResize}
      onClose={props.onClose}
      modeSwitcher={<GitHistoryModeSwitch mode={props.mode} onChange={props.onModeChange} gitHistoryDisabled={props.gitHistoryDisabled} class="w-full" />}
      navigationLabel="View"
      navigation={<GitViewNav value={props.subview} items={subviewItems()} onChange={props.onSubviewChange} />}
      sidebarBody={(
        <GitWorkbenchSidebar
          subview={props.subview}
          onClose={props.onClose}
          repoInfoLoading={props.repoInfoLoading}
          repoInfoError={props.repoInfoError}
          repoAvailable={props.repoInfo?.available}
          repoSummary={props.repoSummary}
          workspace={props.workspace}
          workspaceLoading={props.workspaceLoading}
          workspaceError={props.workspaceError}
          selectedWorkspaceKey={props.selectedWorkspaceKey}
          onSelectWorkspaceItem={props.onSelectWorkspaceItem}
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
      )}
      content={(
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
          workspaceLoading={props.workspaceLoading}
          workspaceError={props.workspaceError}
          selectedWorkspaceItem={props.selectedWorkspaceItem}
          branches={props.branches}
          branchesLoading={props.branchesLoading}
          branchesError={props.branchesError}
          selectedBranch={props.selectedBranch}
          compare={props.compare}
          compareLoading={props.compareLoading}
          compareError={props.compareError}
          selectedCommitHash={props.selectedCommitHash}
          showSidebarToggle={props.showSidebarToggle}
          onOpenSidebar={props.onOpenSidebar}
          onRefresh={props.onRefresh}
        />
      )}
      class={props.class}
    />
  );
}
