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
  GitWorkspaceChange,
} from '../protocol/redeven_v1';
import { repoDisplayName, summarizeWorkspaceCount, type GitWorkbenchSubview } from '../utils/gitWorkbench';
import { GitOverviewPanel } from './GitOverviewPanel';
import { GitChangesPanel } from './GitChangesPanel';
import { GitBranchesPanel } from './GitBranchesPanel';
import { GitHistoryBrowser } from './GitHistoryBrowser';
import { gitSubviewTone, gitToneBadgeClass } from './GitChrome';

export interface GitWorkbenchProps {
  repoInfo?: GitResolveRepoResponse | null;
  repoInfoLoading?: boolean;
  currentPath: string;
  subview: GitWorkbenchSubview;
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
  selectedCommitHash?: string;
  showSidebarToggle?: boolean;
  onOpenSidebar?: () => void;
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
      return 'History';
    default:
      return 'Overview';
  }
}

export function GitWorkbench(props: GitWorkbenchProps) {
  const repoLabel = () => repoDisplayName(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath);
  const repoPath = () => String(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath || '/').trim() || '/';
  const changeCount = () => summarizeWorkspaceCount(props.workspace?.summary ?? props.repoSummary?.workspaceSummary);
  const headRef = () => String(props.repoSummary?.headRef || props.repoInfo?.headRef || '').trim();
  const loadingBusy = () => Boolean(props.repoInfoLoading || props.repoSummaryLoading || props.workspaceLoading || props.branchesLoading || props.compareLoading);
  const showMenuButton = () => Boolean(props.showSidebarToggle && props.onOpenSidebar);
  const subviewTone = () => gitSubviewTone(props.subview);

  return (
    <div class={cn('relative flex h-full min-h-0 flex-col bg-background', props.class)}>
      <div class={cn('shrink-0 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85', showMenuButton() && 'pl-14')}>
        <Show when={showMenuButton()}>
          <Button
            size="xs"
            variant="outline"
            icon={Menu}
            class="absolute left-3 top-3 z-10 h-7 w-7 bg-background/95 px-0 shadow-sm backdrop-blur-sm"
            aria-label="Open browser sidebar"
            title="Open browser sidebar"
            onClick={props.onOpenSidebar}
          />
        </Show>

        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1 space-y-2.5">
            <div class="flex flex-wrap items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
              <span class={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-medium normal-case tracking-normal', gitToneBadgeClass(subviewTone()))}>
                {subviewLabel(props.subview)}
              </span>
              <Show when={loadingBusy()}>
                <span class={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-medium normal-case tracking-normal', gitToneBadgeClass('warning'))}>Refreshing…</span>
              </Show>
            </div>

            <div class="min-w-0 space-y-1">
              <div class="truncate text-base font-semibold text-foreground">{repoLabel()}</div>
              <div class="truncate text-[11px] text-muted-foreground" title={repoPath()}>{repoPath()}</div>
            </div>

            <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <Show when={headRef()}>
                <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('brand'))}>{headRef()}</span>
              </Show>
              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(changeCount() > 0 ? 'warning' : 'success'))}>
                {changeCount() > 0 ? `${changeCount()} changes` : 'Clean workspace'}
              </span>
              <Show when={typeof props.repoSummary?.aheadCount === 'number' || typeof props.repoSummary?.behindCount === 'number'}>
                <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('violet'))}>
                  ↑{props.repoSummary?.aheadCount ?? 0} ↓{props.repoSummary?.behindCount ?? 0}
                </span>
              </Show>
              <Show when={props.repoSummary?.isWorktree}>
                <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('info'))}>Linked worktree</span>
              </Show>
            </div>
          </div>

          <Button size="xs" variant="outline" icon={Refresh} onClick={() => props.onRefresh?.()} disabled={!props.onRefresh || loadingBusy()}>
            Refresh
          </Button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-hidden">
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
