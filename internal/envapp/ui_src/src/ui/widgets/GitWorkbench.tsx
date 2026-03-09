import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { History, Refresh } from '@floegence/floe-webapp-core/icons';
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
import { gitSubviewTone, gitToneSurfaceClass } from './GitChrome';
import { GitStatStrip } from './GitWorkbenchPrimitives';

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
  workspaceInspectNonce?: number;
  branches?: GitListBranchesResponse | null;
  branchesLoading?: boolean;
  branchesError?: string;
  selectedBranch?: GitBranchSummary | null;
  compare?: GitGetBranchCompareResponse | null;
  compareLoading?: boolean;
  compareError?: string;
  selectedCommitHash?: string;
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
      return 'History';
    default:
      return 'Overview';
  }
}

function subviewSummaryLabel(view: GitWorkbenchSubview): string {
  switch (view) {
    case 'changes':
      return 'Workspace Summary';
    case 'branches':
      return 'Branch Scope';
    case 'history':
      return 'Commit History';
    default:
      return 'Overview Summary';
  }
}

export function GitWorkbench(props: GitWorkbenchProps) {
  const repoLabel = () => repoDisplayName(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath);
  const repoPath = () => String(props.repoSummary?.repoRootPath || props.repoInfo?.repoRootPath || props.currentPath || '/').trim() || '/';
  const changeCount = () => summarizeWorkspaceCount(props.workspace?.summary ?? props.repoSummary?.workspaceSummary);
  const headRef = () => String(props.repoSummary?.headRef || props.repoInfo?.headRef || '').trim();
  const loadingBusy = () => Boolean(props.repoInfoLoading || props.repoSummaryLoading || props.workspaceLoading || props.branchesLoading || props.compareLoading);
  const subviewTone = () => gitSubviewTone(props.subview);

  return (
    <div class={cn('relative flex h-full min-h-0 flex-col bg-background', props.class)}>
      <div class="shrink-0 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/90">
        <section class={cn('rounded-xl p-2 sm:p-2.5', gitToneSurfaceClass(subviewTone()))}>
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/65">Repository Context</div>
              <div class="mt-1 max-w-full truncate text-[13px] font-medium text-foreground">{repoLabel()}</div>
              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{changeCount() > 0 ? `${changeCount()} open` : 'Clean'}</span>
                <Show when={loadingBusy()}>
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Refreshing…</span>
                  </>
                </Show>
              </div>
              <div class="mt-1 text-[11px] leading-5 text-muted-foreground">Compact repo signals and actions for the current view.</div>
              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{subviewLabel(props.subview)}</span>
                <span aria-hidden="true">·</span>
                <span>{headRef() || 'Detached HEAD'}</span>
                <span aria-hidden="true">·</span>
                <span class="min-w-0 max-w-full truncate" title={repoPath()}>{repoPath()}</span>
              </div>
            </div>

            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <Show when={props.showMobileSidebarButton && props.onToggleSidebar}>
                <Button
                  size="sm"
                  variant="outline"
                  icon={History}
                  class="shrink-0 cursor-pointer"
                  aria-label="Toggle browser sidebar"
                  onClick={props.onToggleSidebar}
                >
                  Sidebar
                </Button>
              </Show>
              <Show when={props.onRefresh}>
                <Button size="sm" variant="outline" class="shrink-0 cursor-pointer" icon={Refresh} onClick={props.onRefresh}>
                  Refresh
                </Button>
              </Show>
            </div>
          </div>

          <GitStatStrip
            class="mt-2"
            columnsClass="grid-cols-2 sm:grid-cols-4"
            items={[
              { label: 'Workspace Summary', value: changeCount() > 0 ? `${changeCount()} open` : 'Clean' },
              { label: 'Sync Status', value: `↑${props.repoSummary?.aheadCount ?? 0} ↓${props.repoSummary?.behindCount ?? 0}` },
              { label: 'Head Ref', value: headRef() || 'Detached' },
              { label: 'Focused View', value: subviewSummaryLabel(props.subview) },
            ]}
          />
        </section>
      </div>

      <div class="flex-1 min-h-0 overflow-hidden bg-muted/[0.02]">
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
            inspectNonce={props.workspaceInspectNonce}
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
