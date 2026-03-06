import { Show } from 'solid-js';
import type {
  GitBranchSummary,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
} from '../protocol/redeven_v1';
import { branchDisplayName, branchStatusSummary, compareHeadline, repoDisplayName, summarizeWorkspaceCount } from '../utils/gitWorkbench';

export interface GitOverviewPanelProps {
  repoSummary?: GitRepoSummaryResponse | null;
  summaryLoading?: boolean;
  summaryError?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  branches?: GitListBranchesResponse | null;
  selectedBranch?: GitBranchSummary | null;
  compare?: GitGetBranchCompareResponse | null;
  currentPath: string;
}

function summaryValue(value: unknown, fallback = '—'): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function GitOverviewPanel(props: GitOverviewPanelProps) {
  return (
    <div class="h-full min-h-0 overflow-auto px-4 py-3">
      <Show when={!props.summaryLoading} fallback={<div class="text-xs text-muted-foreground">Loading repository summary...</div>}>
        <Show when={!props.summaryError} fallback={<div class="text-xs text-error break-words">{props.summaryError}</div>}>
          <Show when={props.repoSummary} fallback={<div class="text-xs text-muted-foreground">Repository summary is unavailable.</div>}>
            {(summaryAccessor) => {
              const summary = summaryAccessor();
              const workspaceSummary = props.workspace?.summary ?? summary.workspaceSummary;
              const workspaceCount = summarizeWorkspaceCount(workspaceSummary);
              const localBranches = props.branches?.local?.length ?? 0;
              const remoteBranches = props.branches?.remote?.length ?? 0;
              return (
                <div class="space-y-4">
                  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Repository</div>
                      <div class="mt-2 text-lg font-semibold text-foreground">{repoDisplayName(summary.repoRootPath)}</div>
                      <div class="mt-1 text-[11px] text-muted-foreground break-all">{summaryValue(summary.repoRootPath)}</div>
                    </div>
                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Workspace Attention</div>
                      <div class="mt-2 text-lg font-semibold text-foreground">{workspaceCount}</div>
                      <div class="mt-1 text-[11px] text-muted-foreground">{workspaceCount > 0 ? 'Files currently need review.' : 'Working tree is clean.'}</div>
                    </div>
                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Ahead / Behind</div>
                      <div class="mt-2 text-lg font-semibold text-foreground">↑{summary.aheadCount ?? 0} ↓{summary.behindCount ?? 0}</div>
                      <div class="mt-1 text-[11px] text-muted-foreground">{summary.upstreamRef ? `Tracking ${summary.upstreamRef}` : 'No upstream configured.'}</div>
                    </div>
                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Branch Coverage</div>
                      <div class="mt-2 text-lg font-semibold text-foreground">{localBranches + remoteBranches}</div>
                      <div class="mt-1 text-[11px] text-muted-foreground">{localBranches} local · {remoteBranches} remote</div>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Repository State</div>
                      <div class="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                        <div class="rounded-md border border-border/60 px-3 py-2">
                          <div class="text-muted-foreground">Current ref</div>
                          <div class="mt-1 text-sm font-medium text-foreground">{summaryValue(summary.headRef, summary.detached ? 'Detached HEAD' : '—')}</div>
                        </div>
                        <div class="rounded-md border border-border/60 px-3 py-2">
                          <div class="text-muted-foreground">Worktree</div>
                          <div class="mt-1 text-sm font-medium text-foreground">{summary.isWorktree ? 'Linked worktree' : 'Primary checkout'}</div>
                        </div>
                        <div class="rounded-md border border-border/60 px-3 py-2">
                          <div class="text-muted-foreground">HEAD commit</div>
                          <div class="mt-1 break-all text-sm font-medium text-foreground">{summary.headCommit ? summary.headCommit.slice(0, 7) : '—'}</div>
                        </div>
                        <div class="rounded-md border border-border/60 px-3 py-2">
                          <div class="text-muted-foreground">Stashes</div>
                          <div class="mt-1 text-sm font-medium text-foreground">{summary.stashCount ?? 0}</div>
                        </div>
                      </div>
                      <div class="mt-3 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[11px] text-muted-foreground">
                        Current browser context: <span class="text-foreground">{summaryValue(props.currentPath, '/')}</span>
                      </div>
                    </div>

                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Workspace Health</div>
                      <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                        <div class="rounded-md border border-border/60 px-3 py-2">
                          <div class="text-muted-foreground">Staged</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.stagedCount ?? 0}</div>
                        </div>
                        <div class="rounded-md border border-border/60 px-3 py-2">
                          <div class="text-muted-foreground">Unstaged</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.unstagedCount ?? 0}</div>
                        </div>
                        <div class="rounded-md border border-border/60 px-3 py-2">
                          <div class="text-muted-foreground">Untracked</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.untrackedCount ?? 0}</div>
                        </div>
                        <div class="rounded-md border border-border/60 px-3 py-2">
                          <div class="text-muted-foreground">Conflicted</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.conflictedCount ?? 0}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Selected Branch Focus</div>
                      <div class="mt-3 text-sm font-medium text-foreground">{props.selectedBranch ? branchDisplayName(props.selectedBranch) : 'No branch selected yet'}</div>
                      <div class="mt-1 text-[11px] text-muted-foreground">{props.selectedBranch ? branchStatusSummary(props.selectedBranch) : 'Pick a branch in the Branches view to inspect compare details.'}</div>
                      <Show when={props.selectedBranch?.subject}>
                        <div class="mt-3 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-[11px] text-foreground">{props.selectedBranch?.subject}</div>
                      </Show>
                    </div>

                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Compare Snapshot</div>
                      <div class="mt-3 text-sm text-foreground">{compareHeadline(props.compare)}</div>
                      <Show when={props.compare}>
                        {(compareAccessor) => {
                          const compare = compareAccessor();
                          return (
                            <div class="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div class="text-muted-foreground">Base</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.baseRef}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div class="text-muted-foreground">Target</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.targetRef}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div class="text-muted-foreground">Compare commits</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.commits.length}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div class="text-muted-foreground">Changed files</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.files.length}</div>
                              </div>
                            </div>
                          );
                        }}
                      </Show>
                    </div>
                  </div>
                </div>
              );
            }}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
