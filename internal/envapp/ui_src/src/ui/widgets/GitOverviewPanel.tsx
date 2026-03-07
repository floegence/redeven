import { For, Show } from 'solid-js';
import type {
  GitBranchSummary,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
} from '../protocol/redeven_v1';
import { branchDisplayName, branchStatusSummary, compareHeadline, summarizeWorkspaceCount } from '../utils/gitWorkbench';

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
        <Show when={!props.summaryError} fallback={<div class="text-xs break-words text-error">{props.summaryError}</div>}>
          <Show when={props.repoSummary} fallback={<div class="text-xs text-muted-foreground">Repository summary is unavailable.</div>}>
            {(summaryAccessor) => {
              const summary = summaryAccessor();
              const workspaceSummary = props.workspace?.summary ?? summary.workspaceSummary;
              const workspaceCount = summarizeWorkspaceCount(workspaceSummary);
              const localBranches = props.branches?.local?.length ?? 0;
              const remoteBranches = props.branches?.remote?.length ?? 0;
              const repoSignals = () => [
                summary.headRef ? { label: 'Head', value: summary.headRef } : null,
                summary.upstreamRef ? { label: 'Upstream', value: summary.upstreamRef } : null,
                summary.detached ? { label: 'State', value: 'Detached HEAD' } : null,
                summary.isWorktree ? { label: 'Checkout', value: 'Linked worktree' } : { label: 'Checkout', value: 'Primary checkout' },
                { label: 'Stashes', value: String(summary.stashCount ?? 0) },
                { label: 'Context', value: summaryValue(props.currentPath, '/') },
              ].filter(Boolean) as { label: string; value: string }[];

              return (
                <div class="space-y-4">
                  <div class="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_1fr_1fr]">
                    <section class="rounded-xl border border-border/70 bg-muted/15 p-4 shadow-sm">
                      <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Workspace Attention</div>
                      <div class="mt-3 flex items-end gap-3">
                        <div class="text-4xl font-semibold tracking-tight text-foreground">{workspaceCount}</div>
                        <div class="pb-1 text-xs text-muted-foreground">
                          {workspaceCount > 0 ? 'Files currently need review.' : 'Working tree is clean.'}
                        </div>
                      </div>
                      <div class="mt-4 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                        <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                          <div class="text-muted-foreground">Staged</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.stagedCount ?? 0}</div>
                        </div>
                        <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                          <div class="text-muted-foreground">Unstaged</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.unstagedCount ?? 0}</div>
                        </div>
                        <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                          <div class="text-muted-foreground">Untracked</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.untrackedCount ?? 0}</div>
                        </div>
                        <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                          <div class="text-muted-foreground">Conflicted</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.conflictedCount ?? 0}</div>
                        </div>
                      </div>
                    </section>

                    <section class="rounded-xl border border-border/70 bg-muted/15 p-4 shadow-sm">
                      <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Branch Sync</div>
                      <div class="mt-3 text-2xl font-semibold tracking-tight text-foreground">↑{summary.aheadCount ?? 0} ↓{summary.behindCount ?? 0}</div>
                      <div class="mt-1 text-[11px] text-muted-foreground">
                        {summary.upstreamRef ? `Tracking ${summary.upstreamRef}` : 'No upstream configured.'}
                      </div>
                      <div class="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                        <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                          <div class="text-muted-foreground">Local branches</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{localBranches}</div>
                        </div>
                        <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                          <div class="text-muted-foreground">Remote branches</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{remoteBranches}</div>
                        </div>
                      </div>
                    </section>

                    <section class="rounded-xl border border-border/70 bg-muted/15 p-4 shadow-sm">
                      <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Selected Branch</div>
                      <div class="mt-3 text-base font-semibold text-foreground">
                        {props.selectedBranch ? branchDisplayName(props.selectedBranch) : 'No branch selected yet'}
                      </div>
                      <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {props.selectedBranch ? branchStatusSummary(props.selectedBranch) : 'Open Branches to inspect compare details for a target branch.'}
                      </div>
                      <Show when={props.selectedBranch?.subject}>
                        <div class="mt-3 rounded-lg border border-border/60 bg-background/65 px-3 py-2 text-[11px] leading-5 text-foreground">
                          {props.selectedBranch?.subject}
                        </div>
                      </Show>
                    </section>
                  </div>

                  <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <section class="rounded-xl border border-border/70 bg-muted/15 p-4 shadow-sm">
                      <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Repository Signals</div>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <For each={repoSignals()}>
                          {(signal) => (
                            <div class="rounded-full border border-border/60 bg-background/65 px-3 py-1.5 text-[11px] text-foreground">
                              <span class="text-muted-foreground">{signal.label}</span>
                              <span class="mx-1 text-muted-foreground/60">·</span>
                              <span>{signal.value}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>

                    <section class="rounded-xl border border-border/70 bg-muted/15 p-4 shadow-sm">
                      <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Compare Snapshot</div>
                      <div class="mt-3 text-sm text-foreground">{compareHeadline(props.compare)}</div>
                      <Show when={props.compare}>
                        {(compareAccessor) => {
                          const compare = compareAccessor();
                          return (
                            <div class="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                              <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                                <div class="text-muted-foreground">Base</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.baseRef}</div>
                              </div>
                              <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                                <div class="text-muted-foreground">Target</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.targetRef}</div>
                              </div>
                              <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                                <div class="text-muted-foreground">Commits</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.commits.length}</div>
                              </div>
                              <div class="rounded-lg border border-border/60 bg-background/65 px-3 py-2">
                                <div class="text-muted-foreground">Files</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.files.length}</div>
                              </div>
                            </div>
                          );
                        }}
                      </Show>
                    </section>
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
