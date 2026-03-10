import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitBranchSummary, GitCommitFileSummary, GitGetBranchCompareResponse } from '../protocol/redeven_v1';
import { branchDisplayName, branchStatusSummary, changeMetricsText, changeSecondaryPath, compareHeadline, gitDiffEntryIdentity, syncStatusLabel } from '../utils/gitWorkbench';
import { GitPatchViewer } from './GitPatchViewer';
import { gitBranchTone, gitChangeTone, gitCompareTone, gitToneSelectableCardClass } from './GitChrome';
import { GitMetaPill, GitSection, GitStatStrip, GitSubtleNote } from './GitWorkbenchPrimitives';

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

  const selectedFile = createMemo<GitCommitFileSummary | null>(() => {
    const key = selectedFileKey();
    if (!key) return null;
    return props.compare?.files.find((file) => compareFileKey(file) === key) ?? null;
  });

  createEffect(() => {
    props.selectedBranch?.fullName;
    setSelectedFileKey('');
  });

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show when={!props.branchesLoading} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Loading branches...</div>}>
        <Show when={!props.branchesError} fallback={<div class="flex-1 px-3 py-4 text-xs break-words text-error">{props.branchesError}</div>}>
          <Show when={props.selectedBranch} fallback={<div class="flex-1 px-3 py-4 text-xs text-muted-foreground">Choose a branch from the left rail to inspect compare details.</div>}>
            {(branchAccessor) => {
              const branch = branchAccessor();
              const branchTone = () => gitBranchTone(branch);
              const compareTone = () => gitCompareTone(props.compare?.targetAheadCount, props.compare?.targetBehindCount);

              return (
                <div class="flex-1 min-h-0 overflow-auto px-3 py-3 sm:px-4 sm:py-4">
                  <div class="space-y-3">
                    <div class="grid gap-3 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
                      <GitSection
                        label="Branch Snapshot"
                        description={branchStatusSummary(branch)}
                        aside={`↑${branch.aheadCount ?? 0} ↓${branch.behindCount ?? 0}`}
                        tone={branchTone()}
                      >
                        <div class="space-y-3">
                          <div class="flex flex-wrap items-center gap-1.5">
                            <GitMetaPill tone={branchTone()}>{branchDisplayName(branch)}</GitMetaPill>
                            <Show when={branch.upstreamRef}>
                              <GitMetaPill tone="violet">{branch.upstreamRef}</GitMetaPill>
                            </Show>
                            <GitMetaPill tone="neutral">{syncStatusLabel(branch.aheadCount, branch.behindCount)}</GitMetaPill>
                          </div>
                          <GitStatStrip
                            columnsClass="grid-cols-1 sm:grid-cols-2"
                            items={[
                              { label: 'Branch', value: branchDisplayName(branch) },
                              { label: 'Type', value: branch.kind || 'local' },
                              { label: 'Updated', value: formatAbsoluteTime(branch.authorTimeMs) },
                              { label: 'Tracking', value: branch.upstreamRef || 'No upstream' },
                            ]}
                          />
                          <Show when={branch.subject}>
                            <GitSubtleNote class="text-foreground">{branch.subject}</GitSubtleNote>
                          </Show>
                        </div>
                      </GitSection>

                      <GitSection
                        label="Compare Summary"
                        description={compareHeadline(props.compare)}
                        aside={props.compare ? `${props.compare.commits.length} commits · ${props.compare.files.length} files` : undefined}
                        tone={compareTone()}
                      >
                        <Show when={!props.compareLoading} fallback={<div class="text-xs text-muted-foreground">Loading compare summary...</div>}>
                          <Show when={!props.compareError} fallback={<div class="text-xs break-words text-error">{props.compareError}</div>}>
                            <Show when={props.compare} fallback={<div class="text-xs text-muted-foreground">Choose a branch from the left rail to load compare data.</div>}>
                              {(compareAccessor) => {
                                const compare = compareAccessor();
                                return (
                                  <div class="space-y-3">
                                    <div class="flex flex-wrap items-center gap-1.5">
                                      <GitMetaPill tone="neutral">{compare.baseRef}</GitMetaPill>
                                      <GitMetaPill tone={compareTone()}>{compare.targetRef}</GitMetaPill>
                                      <GitMetaPill tone={compareTone()}>{syncStatusLabel(compare.targetAheadCount, compare.targetBehindCount)}</GitMetaPill>
                                    </div>
                                    <GitStatStrip
                                      columnsClass="grid-cols-1 sm:grid-cols-2"
                                      items={[
                                        { label: 'Base', value: compare.baseRef },
                                        { label: 'Target', value: compare.targetRef },
                                        { label: 'Ahead / Behind', value: `↑${compare.targetAheadCount ?? 0} ↓${compare.targetBehindCount ?? 0}` },
                                        { label: 'Merge base', value: compare.mergeBase ? compare.mergeBase.slice(0, 7) : '—' },
                                      ]}
                                    />
                                  </div>
                                );
                              }}
                            </Show>
                          </Show>
                        </Show>
                      </GitSection>
                    </div>

                    <div class="grid gap-3 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]">
                      <div class="space-y-3">
                        <GitSection label="Commit Range" description="Commits that differ from the current branch." aside={String(props.compare?.commits.length ?? 0)} tone="brand">
                          <Show when={(props.compare?.commits.length ?? 0) > 0} fallback={<GitSubtleNote>No compare commits for this branch.</GitSubtleNote>}>
                            <div class="max-h-[18rem] space-y-1 overflow-auto pr-1">
                              <For each={props.compare?.commits ?? []}>
                                {(commit) => (
                                  <div class="rounded-lg border border-border/45 bg-muted/[0.14] px-3 py-2.5 text-xs">
                                    <div class="flex flex-wrap items-center gap-1.5">
                                      <span class="min-w-0 flex-1 truncate font-medium text-foreground">{commit.subject || '(no subject)'}</span>
                                      <GitMetaPill tone="neutral">{commit.shortHash}</GitMetaPill>
                                      <Show when={(commit.parents?.length ?? 0) > 1}>
                                        <GitMetaPill tone="violet">Merge</GitMetaPill>
                                      </Show>
                                    </div>
                                    <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                      <span>{commit.authorName || 'Unknown author'}</span>
                                      <span aria-hidden="true">·</span>
                                      <span>{formatAbsoluteTime(commit.authorTimeMs)}</span>
                                    </div>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </GitSection>

                        <GitSection label="Changed Files" description="Select a file to inspect the compare patch on the right." aside={String(props.compare?.files.length ?? 0)} tone="info">
                          <Show when={(props.compare?.files.length ?? 0) > 0} fallback={<GitSubtleNote>No compare files are available for this branch.</GitSubtleNote>}>
                            <div class="max-h-[22rem] overflow-auto pr-1">
                              <div class="grid grid-cols-1 gap-1">
                                <For each={props.compare?.files ?? []}>
                                  {(file) => {
                                    const active = () => selectedFileKey() === compareFileKey(file);
                                    const tone = () => gitChangeTone(file.changeType);
                                    return (
                                      <button
                                        type="button"
                                        class={cn('w-full rounded-lg px-3 py-2.5 text-left text-xs', gitToneSelectableCardClass(tone(), active()))}
                                        onClick={() => setSelectedFileKey(compareFileKey(file))}
                                      >
                                        <div class="space-y-1">
                                          <div class="truncate font-medium text-current" title={changeSecondaryPath(file)}>{changeSecondaryPath(file)}</div>
                                          <div class="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                            <GitMetaPill tone={tone()} class="capitalize">{file.changeType || 'modified'}</GitMetaPill>
                                            <span>{file.isBinary ? `Binary · ${changeMetricsText(file)}` : changeMetricsText(file)}</span>
                                          </div>
                                        </div>
                                      </button>
                                    );
                                  }}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </GitSection>
                      </div>

                      <GitSection
                        class="min-h-[24rem]"
                        label="Diff Inspector"
                        description={selectedFile() ? changeSecondaryPath(selectedFile()) : 'Choose a changed file to render the compare patch.'}
                        aside={selectedFile() ? changeMetricsText(selectedFile()) : 'No file'}
                        tone={selectedFile() ? gitChangeTone(selectedFile()?.changeType) : 'neutral'}
                      >
                        <GitPatchViewer
                          item={selectedFile()}
                          emptyMessage="Select a compare file to inspect its patch."
                          unavailableMessage={(file) => (file.isBinary ? 'Binary file changed. Inline text diff is not available.' : undefined)}
                        />
                      </GitSection>
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
