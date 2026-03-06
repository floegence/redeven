import { Show } from 'solid-js';
import type { GitGetBranchCompareResponse, GitListBranchesResponse, GitListWorkspaceChangesResponse, GitRepoSummaryResponse } from '../protocol/redeven_v1';
import { compareHeadline } from '../utils/gitWorkbench';

export interface GitOverviewPanelProps {
  repoSummary?: GitRepoSummaryResponse | null;
  summaryLoading?: boolean;
  summaryError?: string;
  workspace?: GitListWorkspaceChangesResponse | null;
  branches?: GitListBranchesResponse | null;
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
              return (
                <div class="space-y-4">
                  <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Repository</div>
                      <div class="mt-2 text-sm font-medium text-foreground break-all">{summaryValue(summary.repoRootPath)}</div>
                      <div class="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                        <div>
                          <div class="uppercase tracking-wide">Current ref</div>
                          <div class="mt-1 text-foreground">{summaryValue(summary.headRef, summary.detached ? 'Detached HEAD' : '—')}</div>
                        </div>
                        <div>
                          <div class="uppercase tracking-wide">Upstream</div>
                          <div class="mt-1 text-foreground">{summaryValue(summary.upstreamRef)}</div>
                        </div>
                        <div>
                          <div class="uppercase tracking-wide">Ahead / Behind</div>
                          <div class="mt-1 text-foreground">↑{summary.aheadCount ?? 0} ↓{summary.behindCount ?? 0}</div>
                        </div>
                        <div>
                          <div class="uppercase tracking-wide">Stashes</div>
                          <div class="mt-1 text-foreground">{summary.stashCount ?? 0}</div>
                        </div>
                      </div>
                    </div>

                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Workspace</div>
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

                  <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Context</div>
                      <div class="mt-2 space-y-2 text-sm text-foreground">
                        <div>
                          <span class="text-muted-foreground">Current path:</span> {summaryValue(props.currentPath, '/')}
                        </div>
                        <div>
                          <span class="text-muted-foreground">Linked worktree:</span> {summary.isWorktree ? 'Yes' : 'No'}
                        </div>
                        <div>
                          <span class="text-muted-foreground">Local branches:</span> {props.branches?.local?.length ?? 0}
                        </div>
                        <div>
                          <span class="text-muted-foreground">Remote branches:</span> {props.branches?.remote?.length ?? 0}
                        </div>
                      </div>
                    </div>

                    <div class="rounded-lg border border-border/70 bg-muted/15 p-4">
                      <div class="text-[11px] uppercase tracking-wide text-muted-foreground">Branch compare</div>
                      <div class="mt-2 text-sm text-foreground">{compareHeadline(props.compare)}</div>
                      <Show when={props.compare}>
                        {(compareAccessor) => {
                          const compare = compareAccessor();
                          return (
                            <div class="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div>Target ahead</div>
                                <div class="mt-1 text-base font-semibold text-foreground">{compare.targetAheadCount ?? 0}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div>Target behind</div>
                                <div class="mt-1 text-base font-semibold text-foreground">{compare.targetBehindCount ?? 0}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div>Compare commits</div>
                                <div class="mt-1 text-base font-semibold text-foreground">{compare.commits.length}</div>
                              </div>
                              <div class="rounded-md border border-border/60 px-3 py-2">
                                <div>Changed files</div>
                                <div class="mt-1 text-base font-semibold text-foreground">{compare.files.length}</div>
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
