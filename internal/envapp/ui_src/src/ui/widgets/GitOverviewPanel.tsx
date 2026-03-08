import { For, Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type {
  GitBranchSummary,
  GitGetBranchCompareResponse,
  GitListBranchesResponse,
  GitListWorkspaceChangesResponse,
  GitRepoSummaryResponse,
} from '../protocol/redeven_v1';
import { branchDisplayName, branchStatusSummary, compareHeadline, summarizeWorkspaceCount } from '../utils/gitWorkbench';
import { gitCompareTone, gitToneBadgeClass, gitToneInsetClass, gitToneSurfaceClass, workspaceSectionTone } from './GitChrome';

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
    <div class="h-full min-h-0 overflow-auto px-3 py-3">
      <Show when={!props.summaryLoading} fallback={<div class="text-xs text-muted-foreground">Loading repository summary...</div>}>
        <Show when={!props.summaryError} fallback={<div class="text-xs break-words text-error">{props.summaryError}</div>}>
          <Show when={props.repoSummary} fallback={<div class="text-xs text-muted-foreground">Repository summary is unavailable.</div>}>
            {(summaryAccessor) => {
              const summary = summaryAccessor();
              const workspaceSummary = props.workspace?.summary ?? summary.workspaceSummary;
              const workspaceCount = summarizeWorkspaceCount(workspaceSummary);
              const localBranches = props.branches?.local?.length ?? 0;
              const remoteBranches = props.branches?.remote?.length ?? 0;
              const compareTone = () => gitCompareTone(props.compare?.targetAheadCount, props.compare?.targetBehindCount);
              const repoSignals = () => [
                summary.headRef ? { label: 'Head', value: summary.headRef, tone: 'brand' as const } : null,
                summary.upstreamRef ? { label: 'Upstream', value: summary.upstreamRef, tone: 'violet' as const } : null,
                summary.detached ? { label: 'State', value: 'Detached HEAD', tone: 'warning' as const } : null,
                summary.isWorktree ? { label: 'Checkout', value: 'Linked worktree', tone: 'info' as const } : { label: 'Checkout', value: 'Primary checkout', tone: 'neutral' as const },
                { label: 'Stashes', value: String(summary.stashCount ?? 0), tone: 'neutral' as const },
                { label: 'Context', value: summaryValue(props.currentPath, '/'), tone: 'info' as const },
              ].filter(Boolean) as { label: string; value: string; tone: 'neutral' | 'info' | 'brand' | 'warning' | 'violet' }[];

              return (
                <div class="space-y-1.5 sm:space-y-2">
                  <div class="grid grid-cols-1 gap-1.5 sm:gap-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                    <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass(workspaceCount > 0 ? 'warning' : 'success'))}>
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Workspace Attention</div>
                          <div class="mt-1 text-[11px] text-muted-foreground">{workspaceCount > 0 ? 'Files need review.' : 'Working tree is clean.'}</div>
                        </div>
                        <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(workspaceCount > 0 ? 'warning' : 'success'))}>
                          {workspaceCount > 0 ? `${workspaceCount} open` : 'Clean'}
                        </span>
                      </div>

                      <div class="mt-2 flex flex-wrap items-end gap-2.5">
                        <div class="text-[24px] font-semibold tracking-tight text-foreground">{workspaceCount}</div>
                        <div class="text-[11px] text-muted-foreground">Review staged, unstaged, untracked, and conflicted changes.</div>
                      </div>

                      <div class="mt-2 grid grid-cols-2 gap-1.5 text-[11px] xl:grid-cols-4">
                        <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(workspaceSectionTone('staged')))}>
                          <div class="text-muted-foreground">Staged</div>
                          <div class="mt-0.5 text-sm font-semibold text-foreground">{workspaceSummary?.stagedCount ?? 0}</div>
                        </div>
                        <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(workspaceSectionTone('unstaged')))}>
                          <div class="text-muted-foreground">Unstaged</div>
                          <div class="mt-0.5 text-sm font-semibold text-foreground">{workspaceSummary?.unstagedCount ?? 0}</div>
                        </div>
                        <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(workspaceSectionTone('untracked')))}>
                          <div class="text-muted-foreground">Untracked</div>
                          <div class="mt-0.5 text-sm font-semibold text-foreground">{workspaceSummary?.untrackedCount ?? 0}</div>
                        </div>
                        <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(workspaceSectionTone('conflicted')))}>
                          <div class="text-muted-foreground">Conflicted</div>
                          <div class="mt-0.5 text-sm font-semibold text-foreground">{workspaceSummary?.conflictedCount ?? 0}</div>
                        </div>
                      </div>
                    </section>

                    <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass(props.selectedBranch ? 'violet' : 'neutral'))}>
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(props.selectedBranch ? 'violet' : 'neutral'))}>Selected Branch</span>
                        <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(compareTone()))}>↑{summary.aheadCount ?? 0} ↓{summary.behindCount ?? 0}</span>
                      </div>

                      <div class="mt-2 text-sm font-semibold text-foreground">{props.selectedBranch ? branchDisplayName(props.selectedBranch) : 'No branch selected yet'}</div>
                      <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {props.selectedBranch ? branchStatusSummary(props.selectedBranch) : 'Open Branches to inspect compare details.'}
                      </div>
                      <Show when={props.selectedBranch?.subject}>
                        <div class={cn('mt-2 rounded-xl border px-2 py-1.5 text-[11px] leading-5 text-foreground', gitToneInsetClass('violet'))}>
                          {props.selectedBranch?.subject}
                        </div>
                      </Show>

                      <div class="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                        <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass('brand'))}>
                          <div class="text-muted-foreground">Local branches</div>
                          <div class="mt-0.5 text-sm font-semibold text-foreground">{localBranches}</div>
                        </div>
                        <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass('violet'))}>
                          <div class="text-muted-foreground">Remote branches</div>
                          <div class="mt-0.5 text-sm font-semibold text-foreground">{remoteBranches}</div>
                        </div>
                      </div>
                    </section>
                  </div>

                  <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass('info'))}>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Repository Signals</div>
                        <div class="mt-1 text-[11px] text-muted-foreground">Fast repo context without leaving the current view.</div>
                      </div>
                      <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('info'))}>{repoSignals().length} signals</span>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <For each={repoSignals()}>
                        {(signal) => (
                          <div class={cn('inline-flex min-w-0 max-w-full items-center rounded-full border px-2.5 py-1 font-medium', gitToneBadgeClass(signal.tone))} title={signal.value}>
                            <span class="font-medium">{signal.label}</span>
                            <span class="mx-1 opacity-60">·</span>
                            <span class="min-w-0 truncate">{signal.value}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </section>

                  <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass(compareTone()))}>
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Compare Snapshot</div>
                        <div class="mt-1 text-[11px] text-muted-foreground">{compareHeadline(props.compare)}</div>
                      </div>
                      <Show when={props.compare}>
                        <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass(compareTone()))}>
                          {props.compare?.commits.length ?? 0} commits · {props.compare?.files.length ?? 0} files
                        </span>
                      </Show>
                    </div>

                    <Show when={props.compare}>
                      {(compareAccessor) => {
                        const compare = compareAccessor();
                        return (
                          <div class="mt-2 grid grid-cols-2 gap-1.5 text-[11px] lg:grid-cols-4">
                            <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass('brand'))}>
                              <div class="text-muted-foreground">Base</div>
                              <div class="mt-0.5 text-sm font-medium text-foreground">{compare.baseRef}</div>
                            </div>
                            <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass('violet'))}>
                              <div class="text-muted-foreground">Target</div>
                              <div class="mt-0.5 text-sm font-medium text-foreground">{compare.targetRef}</div>
                            </div>
                            <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(compareTone()))}>
                              <div class="text-muted-foreground">Ahead / Behind</div>
                              <div class="mt-0.5 text-sm font-medium text-foreground">↑{compare.targetAheadCount ?? 0} ↓{compare.targetBehindCount ?? 0}</div>
                            </div>
                            <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass('neutral'))}>
                              <div class="text-muted-foreground">Merge base</div>
                              <div class="mt-0.5 text-sm font-medium text-foreground">{compare.mergeBase ? compare.mergeBase.slice(0, 7) : '—'}</div>
                            </div>
                          </div>
                        );
                      }}
                    </Show>
                  </section>
                </div>
              );
            }}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
