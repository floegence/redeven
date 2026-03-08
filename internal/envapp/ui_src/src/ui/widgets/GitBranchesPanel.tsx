import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitBranchSummary, GitCommitFileSummary, GitGetBranchCompareResponse } from '../protocol/redeven_v1';
import { branchDisplayName, branchStatusSummary, changeMetricsText, changeSecondaryPath, compareHeadline, gitDiffEntryIdentity } from '../utils/gitWorkbench';
import { GitDiffDialog } from './GitDiffDialog';
import { gitBranchTone, gitChangeTone, gitCompareTone, gitToneBadgeClass, gitToneInsetClass, gitToneSelectableCardClass, gitToneSurfaceClass } from './GitChrome';

export interface GitBranchesPanelProps {
  repoRootPath?: string;
  selectedBranch?: GitBranchSummary | null;
  branchesLoading?: boolean;
  branchesError?: string;
  compare?: GitGetBranchCompareResponse | null;
  compareLoading?: boolean;
  compareError?: string;
}

function compareFileKey(file: GitCommitFileSummary | null | undefined): string {
  return gitDiffEntryIdentity(file);
}

function formatAbsoluteTime(ms?: number): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

export function GitBranchesPanel(props: GitBranchesPanelProps) {
  const [selectedFileKey, setSelectedFileKey] = createSignal('');
  const [diffOpen, setDiffOpen] = createSignal(false);

  const selectedFile = createMemo<GitCommitFileSummary | null>(() => {
    const key = selectedFileKey();
    if (!key) return null;
    return props.compare?.files.find((file) => compareFileKey(file) === key) ?? null;
  });

  createEffect(() => {
    props.selectedBranch?.fullName;
    setSelectedFileKey('');
    setDiffOpen(false);
  });

  const openFileDiff = (file: GitCommitFileSummary) => {
    setSelectedFileKey(compareFileKey(file));
    setDiffOpen(true);
  };

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <Show when={!props.branchesLoading} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Loading branches...</div>}>
        <Show when={!props.branchesError} fallback={<div class="flex-1 px-3 py-4 text-xs break-words text-error">{props.branchesError}</div>}>
          <Show when={props.selectedBranch} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Select a branch from the sidebar to inspect compare details.</div>}>
            {(branchAccessor) => {
              const branch = branchAccessor();
              const branchTone = () => gitBranchTone(branch);
              const compareTone = () => gitCompareTone(props.compare?.targetAheadCount, props.compare?.targetBehindCount);

              return (
                <>
                  <div class="flex-1 min-h-0 overflow-auto px-3 py-3">
                    <div class="space-y-1.5 sm:space-y-2">
                      <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass(branchTone()))}>
                        <div class="flex flex-wrap items-start justify-between gap-2">
                          <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-center gap-1.5">
                              <div class="min-w-0 truncate text-sm font-semibold text-foreground">{branchDisplayName(branch)}</div>
                              <Show when={branch.current}>
                                <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('brand'))}>Current</span>
                              </Show>
                              <Show when={branch.kind}>
                                <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize', gitToneBadgeClass(branch.kind === 'remote' ? 'violet' : 'neutral'))}>{branch.kind}</span>
                              </Show>
                            </div>
                            <div class="mt-1 text-[11px] text-muted-foreground">{branchStatusSummary(branch)}</div>
                            <Show when={branch.subject}>
                              <div class={cn('mt-2 rounded-xl border px-2 py-1.5 text-[11px] leading-5 text-foreground', gitToneInsetClass(branchTone()))}>{branch.subject}</div>
                            </Show>
                          </div>

                          <div class="flex flex-wrap justify-end gap-1.5 text-[10px] text-muted-foreground">
                            <Show when={branch.upstreamRef}>
                              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass('violet'))}>Upstream {branch.upstreamRef}</span>
                            </Show>
                            <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(compareTone()))}>↑{branch.aheadCount ?? 0} ↓{branch.behindCount ?? 0}</span>
                          </div>
                        </div>
                      </section>

                      <div class="grid grid-cols-1 gap-1.5 sm:gap-2 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
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

                          <Show when={!props.compareLoading} fallback={<div class="mt-3 text-xs text-muted-foreground">Loading compare summary...</div>}>
                            <Show when={!props.compareError} fallback={<div class="mt-3 text-xs break-words text-error">{props.compareError}</div>}>
                              <Show when={props.compare} fallback={<div class="mt-3 text-xs text-muted-foreground">Select a branch to load compare details.</div>}>
                                {(compareAccessor) => {
                                  const compare = compareAccessor();
                                  return (
                                    <div class="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
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
                            </Show>
                          </Show>
                        </section>

                        <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass(branch.worktreePath ? 'info' : 'neutral'))}>
                          <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Branch State</div>
                          <div class="mt-2 grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2">
                            <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass('neutral'))}>
                              <div class="text-muted-foreground">Reference</div>
                              <div class="mt-0.5 break-all text-sm font-medium text-foreground">{branch.fullName || branch.name || '—'}</div>
                            </div>
                            <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass('neutral'))}>
                              <div class="text-muted-foreground">Last updated</div>
                              <div class="mt-0.5 text-sm font-medium text-foreground">{formatAbsoluteTime(branch.authorTimeMs)}</div>
                            </div>
                            <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass('brand'))}>
                              <div class="text-muted-foreground">Latest commit</div>
                              <div class="mt-0.5 break-all text-sm font-medium text-foreground">{branch.headCommit ? branch.headCommit.slice(0, 7) : '—'}</div>
                            </div>
                            <div class={cn('rounded-xl border px-2 py-1.5', gitToneInsetClass(branch.worktreePath ? 'info' : 'neutral'))}>
                              <div class="text-muted-foreground">Linked worktree</div>
                              <div class="mt-0.5 break-all text-sm font-medium text-foreground">{branch.worktreePath || '—'}</div>
                            </div>
                          </div>
                        </section>
                      </div>

                      <section class={cn('rounded-2xl border p-2 sm:p-2.5', gitToneSurfaceClass('info'))}>
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div class="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">Changed Files</div>
                            <div class="mt-1 text-[11px] text-muted-foreground">Select a changed file to open its floating diff.</div>
                          </div>
                          <span class={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', gitToneBadgeClass('info'))}>{props.compare?.files.length ?? 0}</span>
                        </div>

                        <Show when={!props.compareLoading} fallback={<div class="mt-3 text-xs text-muted-foreground">Loading compare files...</div>}>
                          <Show when={!props.compareError} fallback={<div class="mt-3 text-xs break-words text-error">{props.compareError}</div>}>
                            <Show when={(props.compare?.files.length ?? 0) > 0} fallback={<div class="mt-3 text-xs text-muted-foreground">No changed files in compare.</div>}>
                              <div class="mt-2 grid grid-cols-1 gap-1.5 xl:grid-cols-2">
                                <For each={props.compare?.files ?? []}>
                                  {(file) => {
                                    const active = () => selectedFileKey() === compareFileKey(file);
                                    const tone = () => gitChangeTone(file.changeType);
                                    return (
                                      <button
                                        type="button"
                                        class={cn('w-full rounded-xl border px-2.5 py-2 text-left text-[12px]', gitToneSelectableCardClass(tone(), active()))}
                                        onClick={() => openFileDiff(file)}
                                      >
                                        <div class="flex flex-wrap items-start justify-between gap-2">
                                          <div class="min-w-0 flex-1">
                                            <div class="truncate font-medium text-current" title={changeSecondaryPath(file)}>{changeSecondaryPath(file)}</div>
                                            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                                              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(tone()))}>{file.changeType || 'modified'}</span>
                                              <span class={cn('rounded-full border px-2 py-0.5 font-medium', gitToneBadgeClass(file.isBinary ? 'warning' : 'neutral'))}>
                                                {file.isBinary ? `Binary · ${changeMetricsText(file)}` : changeMetricsText(file)}
                                              </span>
                                            </div>
                                          </div>
                                          <span class="text-[10px] font-medium text-muted-foreground">Open Diff</span>
                                        </div>
                                      </button>
                                    );
                                  }}
                                </For>
                              </div>
                            </Show>
                          </Show>
                        </Show>
                      </section>
                    </div>
                  </div>

                  <GitDiffDialog
                    open={diffOpen()}
                    onOpenChange={setDiffOpen}
                    item={selectedFile()}
                    title="Branch Compare Diff"
                    description={props.compare ? `${props.compare.baseRef} → ${props.compare.targetRef}` : undefined}
                    emptyMessage="Open a compare file to inspect its diff."
                  />
                </>
              );
            }}
          </Show>
        </Show>
      </Show>
    </div>
  );
}
