import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitBranchSummary, GitCommitFileSummary, GitGetBranchCompareResponse } from '../protocol/redeven_v1';
import { branchDisplayName, branchStatusSummary, changeMetricsText, changeSecondaryPath, compareHeadline, gitDiffEntryIdentity } from '../utils/gitWorkbench';
import { GitDiffDialog } from './GitDiffDialog';
import { gitBranchTone, gitChangeTone, gitCompareTone, gitToneSelectableCardClass } from './GitChrome';
import { GitSection, GitStatStrip, GitSubtleNote } from './GitWorkbenchPrimitives';

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
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show when={!props.branchesLoading} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Loading branches...</div>}>
        <Show when={!props.branchesError} fallback={<div class="flex-1 px-3 py-4 text-xs break-words text-error">{props.branchesError}</div>}>
          <Show when={props.selectedBranch} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Choose a branch from the sidebar to load compare context.</div>}>
            {(branchAccessor) => {
              const branch = branchAccessor();
              const branchTone = () => gitBranchTone(branch);
              const compareTone = () => gitCompareTone(props.compare?.targetAheadCount, props.compare?.targetBehindCount);

              return (
                <>
                  <div class="flex-1 min-h-0 overflow-auto px-3 py-3">
                    <div class="space-y-1.5 sm:space-y-2">
                      <GitSection
                        label="Branch Scope"
                        description={branchStatusSummary(branch)}
                        aside={`↑${branch.aheadCount ?? 0} ↓${branch.behindCount ?? 0}`}
                        tone={branchTone()}
                      >
                        <div class="flex flex-wrap items-center gap-1.5">
                          <div class="min-w-0 truncate text-xs font-medium text-foreground">{branchDisplayName(branch)}</div>
                          <Show when={branch.current}>
                            <span class="text-[10px] text-muted-foreground">Current</span>
                          </Show>
                        </div>
                        <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Show when={branch.kind}>
                            <span class="capitalize">{branch.kind}</span>
                            <span aria-hidden="true">·</span>
                          </Show>
                          <Show when={branch.upstreamRef}>
                            <span>Upstream {branch.upstreamRef}</span>
                            <span aria-hidden="true">·</span>
                          </Show>
                          <span>{formatAbsoluteTime(branch.authorTimeMs)}</span>
                        </div>

                        <Show when={branch.subject}>
                          <GitSubtleNote class="mt-2 text-foreground">{branch.subject}</GitSubtleNote>
                        </Show>

                        <GitStatStrip
                          class="mt-2"
                          columnsClass="grid-cols-1 sm:grid-cols-2"
                          items={[
                            { label: 'Reference', value: branch.fullName || branch.name || '—' },
                            { label: 'Latest commit', value: branch.headCommit ? branch.headCommit.slice(0, 7) : '—' },
                            { label: 'Last updated', value: formatAbsoluteTime(branch.authorTimeMs) },
                            { label: 'Linked worktree', value: branch.worktreePath || '—' },
                          ]}
                        />
                      </GitSection>

                      <GitSection
                        label="Compare Snapshot"
                        description={compareHeadline(props.compare)}
                        aside={props.compare ? `${props.compare.commits.length} commits · ${props.compare.files.length} files` : undefined}
                        tone={compareTone()}
                      >
                        <Show when={!props.compareLoading} fallback={<div class="text-xs text-muted-foreground">Loading compare summary...</div>}>
                          <Show when={!props.compareError} fallback={<div class="text-xs break-words text-error">{props.compareError}</div>}>
                            <Show when={props.compare} fallback={<div class="text-xs text-muted-foreground">Compare details appear here after you choose a branch from the sidebar.</div>}>
                              {(compareAccessor) => {
                                const compare = compareAccessor();
                                return (
                                  <GitStatStrip
                                    columnsClass="grid-cols-1 sm:grid-cols-2"
                                    items={[
                                      { label: 'Base', value: compare.baseRef },
                                      { label: 'Target', value: compare.targetRef },
                                      { label: 'Ahead / Behind', value: `↑${compare.targetAheadCount ?? 0} ↓${compare.targetBehindCount ?? 0}` },
                                      { label: 'Merge base', value: compare.mergeBase ? compare.mergeBase.slice(0, 7) : '—' },
                                    ]}
                                  />
                                );
                              }}
                            </Show>
                          </Show>
                        </Show>
                      </GitSection>

                      <GitSection
                        label="Changed Files"
                        description="Select a changed file to open its floating diff."
                        aside={String(props.compare?.files.length ?? 0)}
                        tone="info"
                      >
                        <Show when={!props.compareLoading} fallback={<div class="text-xs text-muted-foreground">Loading compare files...</div>}>
                          <Show when={!props.compareError} fallback={<div class="text-xs break-words text-error">{props.compareError}</div>}>
                            <Show when={(props.compare?.files.length ?? 0) > 0} fallback={<div class="text-xs text-muted-foreground">No compare files are available for this branch.</div>}>
                              <div class="grid grid-cols-1 gap-1 xl:grid-cols-2">
                                <For each={props.compare?.files ?? []}>
                                  {(file) => {
                                    const active = () => selectedFileKey() === compareFileKey(file);
                                    const tone = () => gitChangeTone(file.changeType);
                                    return (
                                      <button
                                        type="button"
                                        class={cn('w-full rounded-md px-2.5 py-2.5 text-left text-xs sm:py-1.5', gitToneSelectableCardClass(tone(), active()))}
                                        onClick={() => openFileDiff(file)}
                                      >
                                        <div class="flex flex-wrap items-start justify-between gap-2">
                                          <div class="min-w-0 flex-1">
                                            <div class="truncate font-medium text-current" title={changeSecondaryPath(file)}>{changeSecondaryPath(file)}</div>
                                            <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                              <span class="capitalize">{file.changeType || 'modified'}</span>
                                              <span aria-hidden="true">·</span>
                                              <span>{file.isBinary ? `Binary · ${changeMetricsText(file)}` : changeMetricsText(file)}</span>
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
                      </GitSection>
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
