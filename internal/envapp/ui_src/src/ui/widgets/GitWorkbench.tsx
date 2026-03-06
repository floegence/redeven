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
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import {
  buildGitWorkbenchSubviewItems,
  repoDisplayName,
  summarizeWorkspaceCount,
  type GitWorkbenchSubview,
} from '../utils/gitWorkbench';
import { GitSubviewSwitch } from './GitSubviewSwitch';
import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';
import { GitOverviewPanel } from './GitOverviewPanel';
import { GitChangesPanel } from './GitChangesPanel';
import { GitBranchesPanel } from './GitBranchesPanel';
import { GitHistoryBrowser } from './GitHistoryBrowser';

export interface GitWorkbenchProps {
  mode: GitHistoryMode;
  onModeChange: (mode: GitHistoryMode) => void;
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
  selectedWorkspaceItem?: GitWorkspaceChange | null;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  selectedBranch?: GitBranchSummary | null;
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

  const repoLabel = () => repoDisplayName(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath);
  const changeCount = () => summarizeWorkspaceCount(props.workspace?.summary ?? props.repoSummary?.workspaceSummary);
  const headRef = () => String(props.repoSummary?.headRef || props.repoInfo?.headRef || '').trim();
  const loadingBusy = () => Boolean(props.repoSummaryLoading || props.workspaceLoading || props.branchesLoading || props.compareLoading);
  const showMenuButton = () => Boolean(props.showSidebarToggle && props.onOpenSidebar && props.subview !== 'overview');

  return (
    <div class={cn('relative h-full min-h-0 flex flex-col bg-background', props.class)}>
      <div class={cn('shrink-0 border-b border-border/70 px-4 py-3 space-y-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85', showMenuButton() && 'pl-14')}>
        <Show when={showMenuButton()}>
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

        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1 space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <GitHistoryModeSwitch mode={props.mode} onChange={props.onModeChange} />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-foreground">{repoLabel()}</div>
                <div class="truncate text-[11px] text-muted-foreground" title={props.repoSummary?.repoRootPath || props.currentPath}>
                  {props.repoSummary?.repoRootPath || props.currentPath || '/'}
                </div>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <Show when={headRef()}>
                <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">{headRef()}</span>
              </Show>
              <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">{changeCount() > 0 ? `${changeCount()} changes` : 'Clean workspace'}</span>
              <Show when={typeof props.repoSummary?.aheadCount === 'number' || typeof props.repoSummary?.behindCount === 'number'}>
                <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">↑{props.repoSummary?.aheadCount ?? 0} ↓{props.repoSummary?.behindCount ?? 0}</span>
              </Show>
              <Show when={props.repoSummary?.isWorktree}>
                <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">Linked worktree</span>
              </Show>
              <span class="rounded-full border border-border/60 bg-muted/20 px-2 py-0.5" title={props.currentPath || '/'}>Context {props.currentPath || '/'}</span>
            </div>
          </div>

          <Button size="xs" variant="outline" icon={Refresh} onClick={props.onRefresh} disabled={loadingBusy()}>
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
            selectedBranch={props.selectedBranch}
            compare={props.compare}
            currentPath={props.currentPath}
          />
        </Show>

        <Show when={props.subview === 'changes'}>
          <GitChangesPanel
            repoRootPath={props.repoSummary?.repoRootPath}
            workspace={props.workspace}
            selectedItem={props.selectedWorkspaceItem}
            loading={props.workspaceLoading}
            error={props.workspaceError}
          />
        </Show>

        <Show when={props.subview === 'branches'}>
          <GitBranchesPanel
            repoRootPath={props.repoSummary?.repoRootPath}
            selectedBranch={props.selectedBranch}
            branchesLoading={props.branchesLoading}
            branchesError={props.branchesError}
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
          />
        </Show>
      </div>
    </div>
  );
}
