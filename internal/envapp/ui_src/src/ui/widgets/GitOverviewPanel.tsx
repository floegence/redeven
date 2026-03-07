import { For, Show } from 'solid-js';
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
                <div class="space-y-4">
                  <div class="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_1fr_1fr]">
                    <section class={gitToneSurfaceClass(workspaceCount > 0 ? 'warning' : 'success') + ' rounded-2xl border p-4 shadow-sm'}>
                      <div class="flex flex-wrap items-center gap-2">
                        <span class={gitToneBadgeClass(workspaceCount > 0 ? 'warning' : 'success') + ' rounded-full border px-2.5 py-1 text-[10px] font-medium'}>
                          Workspace Attention
                        </span>
                      </div>
                      <div class="mt-3 flex flex-wrap items-end gap-3">
                        <div class="text-4xl font-semibold tracking-tight text-foreground">{workspaceCount}</div>
                        <div class="pb-1 text-xs text-muted-foreground">{workspaceCount > 0 ? 'Files currently need review.' : 'Working tree is clean.'}</div>
                      </div>
                      <div class="mt-4 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-4">
                        <div class={gitToneInsetClass(workspaceSectionTone('staged')) + ' rounded-xl border px-3 py-2'}>
                          <div class="text-muted-foreground">Staged</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.stagedCount ?? 0}</div>
                        </div>
                        <div class={gitToneInsetClass(workspaceSectionTone('unstaged')) + ' rounded-xl border px-3 py-2'}>
                          <div class="text-muted-foreground">Unstaged</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.unstagedCount ?? 0}</div>
                        </div>
                        <div class={gitToneInsetClass(workspaceSectionTone('untracked')) + ' rounded-xl border px-3 py-2'}>
                          <div class="text-muted-foreground">Untracked</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.untrackedCount ?? 0}</div>
                        </div>
                        <div class={gitToneInsetClass(workspaceSectionTone('conflicted')) + ' rounded-xl border px-3 py-2'}>
                          <div class="text-muted-foreground">Conflicted</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{workspaceSummary?.conflictedCount ?? 0}</div>
                        </div>
                      </div>
                    </section>

                    <section class={gitToneSurfaceClass(compareTone()) + ' rounded-2xl border p-4 shadow-sm'}>
                      <span class={gitToneBadgeClass(compareTone()) + ' rounded-full border px-2.5 py-1 text-[10px] font-medium'}>Branch Sync</span>
                      <div class="mt-3 text-2xl font-semibold tracking-tight text-foreground">↑{summary.aheadCount ?? 0} ↓{summary.behindCount ?? 0}</div>
                      <div class="mt-1 text-[11px] text-muted-foreground">{summary.upstreamRef ? `Tracking ${summary.upstreamRef}` : 'No upstream configured.'}</div>
                      <div class="mt-4 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                        <div class={gitToneInsetClass('brand') + ' rounded-xl border px-3 py-2'}>
                          <div class="text-muted-foreground">Local branches</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{localBranches}</div>
                        </div>
                        <div class={gitToneInsetClass('violet') + ' rounded-xl border px-3 py-2'}>
                          <div class="text-muted-foreground">Remote branches</div>
                          <div class="mt-1 text-base font-semibold text-foreground">{remoteBranches}</div>
                        </div>
                      </div>
                    </section>

                    <section class={gitToneSurfaceClass(props.selectedBranch ? 'violet' : 'neutral') + ' rounded-2xl border p-4 shadow-sm'}>
                      <span class={gitToneBadgeClass(props.selectedBranch ? 'violet' : 'neutral') + ' rounded-full border px-2.5 py-1 text-[10px] font-medium'}>Selected Branch</span>
                      <div class="mt-3 text-base font-semibold text-foreground">{props.selectedBranch ? branchDisplayName(props.selectedBranch) : 'No branch selected yet'}</div>
                      <div class="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {props.selectedBranch ? branchStatusSummary(props.selectedBranch) : 'Open Branches to inspect compare details for a target branch.'}
                      </div>
                      <Show when={props.selectedBranch?.subject}>
                        <div class={gitToneInsetClass('violet') + ' mt-3 rounded-xl border px-3 py-2 text-[11px] leading-5 text-foreground'}>
                          {props.selectedBranch?.subject}
                        </div>
                      </Show>
                    </section>
                  </div>

                  <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    <section class={gitToneSurfaceClass('neutral') + ' rounded-2xl border p-4 shadow-sm'}>
                      <div class="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Repository Signals</div>
                      <div class="mt-3 flex flex-wrap gap-2">
                        <For each={repoSignals()}>
                          {(signal) => (
                            <div class={gitToneBadgeClass(signal.tone) + ' inline-flex items-center rounded-full border px-3 py-1.5 text-[11px]'}>
                              <span class="font-medium">{signal.label}</span>
                              <span class="mx-1.5 opacity-60">·</span>
                              <span class="min-w-0 truncate">{signal.value}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>

                    <section class={gitToneSurfaceClass(compareTone()) + ' rounded-2xl border p-4 shadow-sm'}>
                      <div class="flex flex-wrap items-center gap-2">
                        <span class={gitToneBadgeClass(compareTone()) + ' rounded-full border px-2.5 py-1 text-[10px] font-medium'}>Compare Snapshot</span>
                        <Show when={props.compare}>
                          <span class={gitToneBadgeClass('neutral') + ' rounded-full border px-2 py-0.5 text-[10px] font-medium'}>
                            {props.compare?.commits.length ?? 0} commits · {props.compare?.files.length ?? 0} files
                          </span>
                        </Show>
                      </div>
                      <div class="mt-3 text-sm text-foreground">{compareHeadline(props.compare)}</div>
                      <Show when={props.compare}>
                        {(compareAccessor) => {
                          const compare = compareAccessor();
                          return (
                            <div class="mt-4 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                              <div class={gitToneInsetClass('brand') + ' rounded-xl border px-3 py-2'}>
                                <div class="text-muted-foreground">Base</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.baseRef}</div>
                              </div>
                              <div class={gitToneInsetClass('violet') + ' rounded-xl border px-3 py-2'}>
                                <div class="text-muted-foreground">Target</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.targetRef}</div>
                              </div>
                              <div class={gitToneInsetClass('neutral') + ' rounded-xl border px-3 py-2'}>
                                <div class="text-muted-foreground">Ahead / Behind</div>
                                <div class="mt-1 text-sm font-medium text-foreground">↑{compare.targetAheadCount ?? 0} ↓{compare.targetBehindCount ?? 0}</div>
                              </div>
                              <div class={gitToneInsetClass('neutral') + ' rounded-xl border px-3 py-2'}>
                                <div class="text-muted-foreground">Merge base</div>
                                <div class="mt-1 text-sm font-medium text-foreground">{compare.mergeBase ? compare.mergeBase.slice(0, 7) : '—'}</div>
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
