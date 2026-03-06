import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Menu, Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import type {
  GitBranchSummary,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
  GitResolveRepoResponse,
  GitCommitSummary,
} from '../protocol/redeven_v1';
import { buildGitWorkbenchSubviewItems, type GitWorkbenchSubview } from '../utils/gitWorkbench';
import { GitSubviewSwitch } from './GitSubviewSwitch';
import { GitOverviewPanel } from './GitOverviewPanel';
import { GitChangesPanel } from './GitChangesPanel';
import { GitBranchesPanel } from './GitBranchesPanel';
import { GitHistoryBrowser } from './GitHistoryBrowser';

export interface GitWorkbenchProps {
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  currentPath: string;
  subview: GitWorkbenchSubview;
  onSubviewChange: (value: GitWorkbenchSubview) => void;
  repoSummary?: GitRepoSummaryResponse | null;
  repoSummaryLoading?: boolean;
  repoSummaryError?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  workspaceLoading?: boolean;
  workspaceError?: string;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  selectedBranch?: GitBranchSummary | null;
  selectedBranchName?: string;
  onSelectBranch?: (branch: GitBranchSummary) => void;
  compare?: GitGetBranchCompareResponse | null;
  compareLoading?: boolean;
  compareError?: string;
  commits?: GitCommitSummary[];
  selectedCommitHash?: string;
  showSidebarToggle?: boolean;
  onOpenSidebar?: () => void;
  onRefresh?: () => void;
  class?: string;
}

export function GitWorkbench(props: GitWorkbenchProps) {
  const subviewItems = () => buildGitWorkbenchSubviewItems({
    repoSummary: props.repoSummary,
    workspace: props.workspace,
    branchesCount: (props.branches?.local.length ?? 0) + (props.branches?.remote.length ?? 0),
  });

  return (
    <div class={cn('relative h-full min-h-0 flex flex-col bg-background', props.class)}>
      <Show when={props.showSidebarToggle && props.onOpenSidebar}>
        <Button
          size="xs"
          variant="outline"
          icon={Menu}
          class="absolute left-3 top-3 z-10 h-7 w-7 px-0 shadow-sm bg-background/95 backdrop-blur-sm"
          aria-label="Open Git sidebar"
          title="Open Git sidebar"
          onClick={props.onOpenSidebar}
        />
      </Show>

      <div class={cn('shrink-0 border-b border-border/70 px-4 py-2.5 space-y-2', props.showSidebarToggle && 'pl-14')}>
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-sm font-medium text-foreground">Git Workbench</div>
            <div class="text-[11px] text-muted-foreground">Inspect repository state, workspace changes, branches, and history.</div>
          </div>
          <Button size="xs" variant="outline" icon={Refresh} onClick={props.onRefresh} disabled={props.repoSummaryLoading || props.workspaceLoading || props.branchesLoading}>
            Refresh
          </Button>
        </div>
        <GitSubviewSwitch value={props.subview} items={subviewItems()} onChange={props.onSubviewChange} />
      </div>

      <div class="flex-1 min-h-0 overflow-hidden">
        <Show when={props.subview === 'overview'}>
          <GitOverviewPanel
            repoSummary={props.repoSummary}
            summaryLoading={props.repoSummaryLoading}
            summaryError={props.repoSummaryError}
            workspace={props.workspace}
            branches={props.branches}
            compare={props.compare}
            currentPath={props.currentPath}
          />
        </Show>

        <Show when={props.subview === 'changes'}>
          <GitChangesPanel
            repoRootPath={props.repoSummary?.repoRootPath}
            workspace={props.workspace}
            loading={props.workspaceLoading}
            error={props.workspaceError}
          />
        </Show>

        <Show when={props.subview === 'branches'}>
          <GitBranchesPanel
            repoRootPath={props.repoSummary?.repoRootPath}
            currentRef={props.repoSummary?.headRef}
            branches={props.branches}
            branchesLoading={props.branchesLoading}
            branchesError={props.branchesError}
            selectedBranchName={props.selectedBranchName}
            onSelectBranch={props.onSelectBranch}
            compare={props.compare}
            compareLoading={props.compareLoading}
            compareError={props.compareError}
          />
        </Show>

        <Show when={props.subview === 'history'}>
          <GitHistoryBrowser
            class="h-full"
            currentPath={props.currentPath}
            repoInfo={props.repoInfo}
            repoInfoLoading={props.repoInfoLoading}
            selectedCommitHash={props.selectedCommitHash}
            showSidebarToggle={props.showSidebarToggle}
            onOpenSidebar={props.onOpenSidebar}
          />
        </Show>
      </div>
    </div>
  );
}
