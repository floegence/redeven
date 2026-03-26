import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Refresh } from '@floegence/floe-webapp-core/icons';
import { Button } from '@floegence/floe-webapp-core/ui';
import type {
  GitDiffFileContent,
  GitPreviewApplyStashResponse,
  GitPreviewDropStashResponse,
  GitRepoSummaryResponse,
  GitStashSummary,
  GitWorkspaceSummary,
} from '../protocol/redeven_v1';
import { useRedevenRpc } from '../protocol/redeven_v1';
import {
  changeDisplayPath,
  gitDiffEntryIdentity,
  repoDisplayName,
  seedGitDiffContent,
  shortGitHash,
  summarizeWorkspaceCount,
  workspaceHealthLabel,
  type GitSeededCommitFileSummary,
  type GitSeededStashDetail,
  type GitStashWindowSource,
  type GitStashWindowTab,
} from '../utils/gitWorkbench';
import { gitToneActionButtonClass, gitToneSelectableCardClass, workspaceSectionTone } from './GitChrome';
import { GitPatchViewer } from './GitPatchViewer';
import {
  GitChecklistItem,
  GitLabelBlock,
  GitMetaPill,
  GitPrimaryTitle,
  GitSection,
  GitStatePane,
  GitSubtleNote,
} from './GitWorkbenchPrimitives';
import { PreviewWindow } from './PreviewWindow';

export type GitStashReviewState =
  | {
    kind: 'apply';
    removeAfterApply: boolean;
    preview: GitPreviewApplyStashResponse;
  }
  | {
    kind: 'drop';
    preview: GitPreviewDropStashResponse;
  };

export interface GitStashWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: GitStashWindowTab;
  onTabChange: (tab: GitStashWindowTab) => void;
  repoRootPath?: string;
  source?: GitStashWindowSource;
  repoSummary?: GitRepoSummaryResponse | null;
  workspaceSummary?: GitWorkspaceSummary | null;
  contextLoading?: boolean;
  contextError?: string;
  stashes: GitStashSummary[];
  stashesLoading?: boolean;
  stashesError?: string;
  selectedStashId?: string;
  onSelectStash?: (id: string) => void;
  stashDetail?: GitSeededStashDetail | null;
  stashDetailLoading?: boolean;
  stashDetailError?: string;
  saveMessage?: string;
  includeUntracked?: boolean;
  keepIndex?: boolean;
  saveBusy?: boolean;
  applyBusy?: boolean;
  dropBusy?: boolean;
  reviewLoading?: boolean;
  review?: GitStashReviewState | null;
  reviewError?: string;
  onSaveMessageChange?: (value: string) => void;
  onIncludeUntrackedChange?: (value: boolean) => void;
  onKeepIndexChange?: (value: boolean) => void;
  onSave?: () => void;
  onRefreshStashes?: () => void;
  onRequestApply?: (removeAfterApply: boolean) => void;
  onRequestDrop?: () => void;
  onConfirmReview?: () => void;
  onCancelReview?: () => void;
}

function tabButtonClass(active: boolean): string {
  return cn(
    'cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150',
    active ? 'git-browser-selection-chip' : 'text-muted-foreground hover:bg-background/80 hover:text-foreground',
  );
}

function formatStashTime(value?: number): string {
  if (!value || !Number.isFinite(value)) return 'Unknown time';
  return new Date(value).toLocaleString();
}

function contextTone(summary?: GitWorkspaceSummary | null): ReturnType<typeof workspaceSectionTone> {
  if ((summary?.conflictedCount ?? 0) > 0) return 'danger';
  if ((summary?.stagedCount ?? 0) > 0) return 'success';
  if (summarizeWorkspaceCount(summary) > 0) return 'warning';
  return 'neutral';
}

function sourceLabel(source?: GitStashWindowSource): string {
  switch (source) {
    case 'changes':
      return 'Opened from Changes';
    case 'branch_status':
      return 'Opened from Branch Status';
    case 'merge_blocker':
      return 'Opened from Merge Review';
    case 'header':
    default:
      return 'Repository stash stack';
  }
}

export function GitStashWindow(props: GitStashWindowProps) {
  let rpc: ReturnType<typeof useRedevenRpc> | null = null;
  try {
    rpc = useRedevenRpc();
  } catch {
    rpc = null;
  }
  const [selectedFileKey, setSelectedFileKey] = createSignal('');
  const [selectedFileDiff, setSelectedFileDiff] = createSignal<GitDiffFileContent | null>(null);
  const [selectedFileDiffLoading, setSelectedFileDiffLoading] = createSignal(false);
  const [selectedFileDiffError, setSelectedFileDiffError] = createSignal('');
  const [selectedFileDiffLoadedKey, setSelectedFileDiffLoadedKey] = createSignal('');
  let selectedFileDiffReqSeq = 0;

  const repoPath = () => String(props.repoRootPath ?? props.repoSummary?.repoRootPath ?? '').trim();
  const repoName = () => repoDisplayName(repoPath());
  const workspaceTotal = () => summarizeWorkspaceCount(props.workspaceSummary);
  const canSave = createMemo(() => Boolean(
    repoPath()
    && !props.contextLoading
    && workspaceTotal() > 0
    && !props.saveBusy
  ));
  const selectedStash = createMemo(() => {
    const selectedId = String(props.selectedStashId ?? '').trim();
    if (selectedId && props.stashDetail?.id === selectedId) return props.stashDetail;
    if (selectedId) return props.stashes.find((item) => item.id === selectedId) ?? null;
    return props.stashes[0] ?? null;
  });
  const detailFiles = createMemo(() => props.stashDetail?.files ?? []);
  const selectedFile = createMemo<GitSeededCommitFileSummary | null>(() => {
    const files = detailFiles();
    if (files.length === 0) return null;
    return files.find((item) => gitDiffEntryIdentity(item) === selectedFileKey()) ?? files[0] ?? null;
  });
  const selectedFileRequestKey = createMemo(() => JSON.stringify({
    repoRootPath: repoPath(),
    stashId: selectedStash()?.id ?? '',
    file: {
      changeType: selectedFile()?.changeType ?? '',
      path: selectedFile()?.path ?? '',
      oldPath: selectedFile()?.oldPath ?? '',
      newPath: selectedFile()?.newPath ?? '',
    },
  }));
  const seededSelectedFileDiff = createMemo(() => seedGitDiffContent(selectedFile()));
  const reviewMatchesSelection = createMemo(() => {
    const review = props.review;
    const stashId = selectedStash()?.id;
    if (!review || !stashId) return false;
    return review.preview.stash?.id === stashId;
  });
  const reviewBlockingReason = createMemo(() => {
    const review = props.review;
    if (!reviewMatchesSelection() || !review) return '';
    if (review.kind !== 'apply') return '';
    return String(review.preview.blockingReason ?? review.preview.blocking?.reason ?? '').trim();
  });
  const canConfirmReview = createMemo(() => {
    const review = props.review;
    if (!reviewMatchesSelection() || !review || props.reviewLoading) return false;
    if (review.kind === 'apply') {
      return !reviewBlockingReason() && !props.applyBusy;
    }
    return !props.dropBusy;
  });

  createEffect(() => {
    const files = detailFiles();
    if (files.length === 0) {
      setSelectedFileKey('');
      return;
    }
    const current = selectedFileKey();
    if (current && files.some((item) => gitDiffEntryIdentity(item) === current)) return;
    setSelectedFileKey(gitDiffEntryIdentity(files[0]));
  });

  createEffect(on(() => [props.open, props.tab, selectedFileRequestKey()] as const, () => {
    selectedFileDiffReqSeq += 1;
    setSelectedFileDiff(seededSelectedFileDiff());
    setSelectedFileDiffLoading(false);
    setSelectedFileDiffError('');
    setSelectedFileDiffLoadedKey(seededSelectedFileDiff() ? selectedFileRequestKey() : '');
  }, { defer: true }));

  createEffect(on(() => [props.open, props.tab, selectedStash()?.id, selectedFile(), selectedFileRequestKey()] as const, ([open, tab, stashId, file, requestKey]) => {
    if (!open || tab !== 'stashes' || !stashId || !file || !repoPath()) return;
    if (seededSelectedFileDiff()) return;
    if (!rpc?.git?.getDiffContent) return;
    if (selectedFileDiffLoadedKey() === requestKey || selectedFileDiffLoading()) return;

    const seq = ++selectedFileDiffReqSeq;
    setSelectedFileDiffLoading(true);
    setSelectedFileDiffError('');

    void rpc.git.getDiffContent({
      repoRootPath: repoPath(),
      sourceKind: 'stash',
      stashId,
      mode: 'preview',
      file: {
        changeType: file.changeType,
        path: file.path,
        oldPath: file.oldPath,
        newPath: file.newPath,
      },
    }).then((resp) => {
      if (seq !== selectedFileDiffReqSeq || selectedFileRequestKey() !== requestKey) return;
      setSelectedFileDiff(resp.file ?? null);
      setSelectedFileDiffLoadedKey(requestKey);
    }).catch((err) => {
      if (seq !== selectedFileDiffReqSeq || selectedFileRequestKey() !== requestKey) return;
      setSelectedFileDiff(null);
      setSelectedFileDiffError(err instanceof Error ? err.message : String(err ?? 'Failed to load stash patch.'));
    }).finally(() => {
      if (seq === selectedFileDiffReqSeq) setSelectedFileDiffLoading(false);
    });
  }, { defer: true }));

  return (
    <PreviewWindow
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={`Stashes · ${repoName()}`}
      persistenceKey="git-stash-window"
      defaultSize={{ width: 1040, height: 760 }}
      minSize={{ width: 720, height: 520 }}
      floatingClass="bg-background"
      mobileClass="bg-background"
    >
      <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <div class="shrink-0 border-b border-border/60 px-4 pt-3 pb-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <GitLabelBlock
              class="min-w-0 flex-1"
              label="Git Stash"
              tone="violet"
              meta={<GitMetaPill tone="neutral">{sourceLabel(props.source)}</GitMetaPill>}
            >
              <div class="flex flex-wrap items-center gap-2">
                <GitPrimaryTitle>{repoName()}</GitPrimaryTitle>
                <GitMetaPill tone="violet">{props.stashes.length} stash{props.stashes.length === 1 ? '' : 'es'}</GitMetaPill>
              </div>
              <div class="min-w-0 truncate text-[11px] text-muted-foreground">{repoPath() || 'Repository path unavailable'}</div>
            </GitLabelBlock>

            <div
              class="grid w-full grid-cols-2 rounded-lg border border-border/65 bg-muted/[0.16] p-0.5 shadow-sm shadow-black/5 sm:w-[16rem]"
              role="tablist"
              aria-label="Stash tabs"
            >
              <button type="button" role="tab" aria-selected={props.tab === 'save'} class={tabButtonClass(props.tab === 'save')} onClick={() => props.onTabChange('save')}>
                Save Changes
              </button>
              <button type="button" role="tab" aria-selected={props.tab === 'stashes'} class={tabButtonClass(props.tab === 'stashes')} onClick={() => props.onTabChange('stashes')}>
                Saved Stashes
              </button>
            </div>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden">
          <Show
            when={props.tab === 'save'}
            fallback={(
              <div class="flex h-full min-h-0 flex-col overflow-hidden px-4 py-4">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <GitSubtleNote class="flex-1">
                    Review the shared stash stack, inspect file patches, then apply or remove entries safely.
                  </GitSubtleNote>
                  <Button size="sm" variant="outline" class={gitToneActionButtonClass()} icon={Refresh} onClick={() => props.onRefreshStashes?.()}>
                    Refresh
                  </Button>
                </div>

                <Show when={!props.stashesLoading} fallback={<GitStatePane loading message="Loading stash list..." surface class="h-full" />}>
                  <Show when={!props.stashesError} fallback={<GitStatePane tone="error" message={props.stashesError ?? 'Failed to load stashes.'} surface class="h-full" />}>
                    <div class="grid h-full min-h-0 gap-3 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
                      <div class="min-h-0 overflow-auto rounded-md border border-border/65 bg-card p-2">
                        <Show
                          when={props.stashes.length > 0}
                          fallback={<GitStatePane message="No stashes yet. Save a snapshot from the other tab to see it here." class="h-full" surface />}
                        >
                          <div class="space-y-2">
                            <For each={props.stashes}>
                              {(stash) => {
                                const active = () => stash.id === selectedStash()?.id;
                                return (
                                  <button
                                    type="button"
                                    class={cn(
                                      'flex w-full cursor-pointer flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors duration-150',
                                      gitToneSelectableCardClass('violet', active()),
                                    )}
                                    onClick={() => props.onSelectStash?.(stash.id)}
                                  >
                                    <div class="flex items-center justify-between gap-2">
                                      <div class="min-w-0 truncate text-xs font-semibold text-foreground">{stash.message || stash.ref || 'Unnamed stash'}</div>
                                      <GitMetaPill tone="neutral">{stash.fileCount ?? 0} file{(stash.fileCount ?? 0) === 1 ? '' : 's'}</GitMetaPill>
                                    </div>
                                    <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                      <GitMetaPill tone="violet">{stash.ref || shortGitHash(stash.id)}</GitMetaPill>
                                      <Show when={stash.branchName}>
                                        <GitMetaPill tone="neutral">{stash.branchName}</GitMetaPill>
                                      </Show>
                                      <Show when={stash.hasUntracked}>
                                        <GitMetaPill tone="warning">Untracked</GitMetaPill>
                                      </Show>
                                    </div>
                                    <div class="text-[10px] text-muted-foreground">{formatStashTime(stash.createdAtUnixMs)}</div>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      </div>

                      <div class="min-h-0 overflow-hidden">
                        <Show
                          when={!props.stashDetailLoading}
                          fallback={<GitStatePane loading message="Loading stash detail..." surface class="h-full" />}
                        >
                          <Show when={!props.stashDetailError} fallback={<GitStatePane tone="error" message={props.stashDetailError ?? 'Failed to load stash detail.'} surface class="h-full" />}>
                            <Show
                              when={props.stashDetail}
                              fallback={<GitStatePane message="Select a stash to inspect its files and actions." surface class="h-full" />}
                            >
                              <div class="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
                                <div class="flex min-h-0 flex-col gap-3 overflow-hidden">
                                  <GitSection
                                    label="Selected Stash"
                                    tone="violet"
                                    aside={<GitMetaPill tone="violet">{props.stashDetail?.ref || shortGitHash(props.stashDetail?.id)}</GitMetaPill>}
                                  >
                                    <div class="space-y-2">
                                      <div class="text-sm font-semibold text-foreground">{props.stashDetail?.message || 'Unnamed stash'}</div>
                                      <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                        <Show when={props.stashDetail?.branchName}>
                                          <GitMetaPill tone="neutral">{props.stashDetail?.branchName}</GitMetaPill>
                                        </Show>
                                        <Show when={props.stashDetail?.headCommit}>
                                          <GitMetaPill tone="neutral">{shortGitHash(props.stashDetail?.headCommit)}</GitMetaPill>
                                        </Show>
                                        <Show when={props.stashDetail?.hasUntracked}>
                                          <GitMetaPill tone="warning">Includes untracked</GitMetaPill>
                                        </Show>
                                      </div>
                                      <div class="text-[11px] text-muted-foreground">{formatStashTime(props.stashDetail?.createdAtUnixMs)}</div>
                                    </div>
                                  </GitSection>

                                  <div class="rounded-md border border-border/65 bg-card p-2">
                                    <div class="mb-2 flex items-center justify-between gap-2 px-1">
                                      <div class="text-xs font-semibold text-foreground">Changed Files</div>
                                      <GitMetaPill tone="neutral">{detailFiles().length} file{detailFiles().length === 1 ? '' : 's'}</GitMetaPill>
                                    </div>
                                    <div class="min-h-0 max-h-[16rem] space-y-1 overflow-auto">
                                      <For each={detailFiles()}>
                                        {(file) => {
                                          const active = () => gitDiffEntryIdentity(file) === gitDiffEntryIdentity(selectedFile());
                                          return (
                                            <button
                                              type="button"
                                              class={cn(
                                                'flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors duration-150',
                                                gitToneSelectableCardClass(workspaceSectionTone(file.changeType), active()),
                                              )}
                                              onClick={() => setSelectedFileKey(gitDiffEntryIdentity(file))}
                                            >
                                              <div class="min-w-0">
                                                <div class="truncate text-[11px] font-medium text-foreground">{changeDisplayPath(file)}</div>
                                                <div class="truncate text-[10px] text-muted-foreground">{file.changeType || 'modified'}</div>
                                              </div>
                                              <GitMetaPill tone="neutral">{shortGitHash(props.stashDetail?.id)}</GitMetaPill>
                                            </button>
                                          );
                                        }}
                                      </For>
                                    </div>
                                  </div>

                                  <div class="grid gap-2 sm:grid-cols-3">
                                    <Button size="sm" variant="default" class="rounded-md" disabled={props.reviewLoading || props.applyBusy || props.dropBusy} onClick={() => props.onRequestApply?.(false)}>
                                      {props.applyBusy && props.review?.kind === 'apply' && !props.review?.removeAfterApply ? 'Applying...' : 'Apply'}
                                    </Button>
                                    <Button size="sm" variant="outline" class="rounded-md" disabled={props.reviewLoading || props.applyBusy || props.dropBusy} onClick={() => props.onRequestApply?.(true)}>
                                      {props.applyBusy && props.review?.kind === 'apply' && props.review?.removeAfterApply ? 'Applying...' : 'Apply & Remove'}
                                    </Button>
                                    <Button size="sm" variant="ghost" class="rounded-md text-destructive hover:text-destructive" disabled={props.reviewLoading || props.applyBusy || props.dropBusy} onClick={() => props.onRequestDrop?.()}>
                                      {props.dropBusy ? 'Deleting...' : 'Delete'}
                                    </Button>
                                  </div>

                                  <Show when={reviewMatchesSelection()}>
                                    <GitChecklistItem
                                      title={props.review?.kind === 'drop' ? 'Delete this stash entry' : (props.review?.removeAfterApply ? 'Apply and remove this stash' : 'Apply this stash')}
                                      detail={reviewBlockingReason()
                                        ? reviewBlockingReason()
                                        : props.review?.kind === 'drop'
                                          ? 'Confirm deletion to remove this stash from the shared stack.'
                                          : 'Confirm the reviewed apply plan before mutating the current worktree.'}
                                      tone={reviewBlockingReason() ? 'warning' : 'violet'}
                                      complete={!reviewBlockingReason()}
                                      required
                                    >
                                      <Show when={props.reviewError}>
                                        <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.reviewError}</GitSubtleNote>
                                      </Show>
                                      <div class="flex flex-wrap gap-2">
                                        <Button size="sm" variant="outline" class="rounded-md" onClick={() => props.onCancelReview?.()}>
                                          Cancel
                                        </Button>
                                        <Button size="sm" variant="default" class="rounded-md" disabled={!canConfirmReview()} loading={Boolean(props.reviewLoading || props.applyBusy || props.dropBusy)} onClick={() => props.onConfirmReview?.()}>
                                          {props.review?.kind === 'drop' ? 'Confirm Delete' : (props.review?.removeAfterApply ? 'Confirm Apply & Remove' : 'Confirm Apply')}
                                        </Button>
                                      </div>
                                    </GitChecklistItem>
                                  </Show>
                                </div>

                                <Show
                                  when={!selectedFileDiffLoading()}
                                  fallback={<GitStatePane loading message="Loading stash patch..." surface class="min-h-0" />}
                                >
                                  <Show when={!selectedFileDiffError()} fallback={<GitStatePane tone="error" message={selectedFileDiffError() || 'Failed to load stash patch.'} surface class="min-h-0" />}>
                                    <GitPatchViewer
                                      class="min-h-0"
                                      item={selectedFileDiff()}
                                      emptyMessage="Select a stash file to inspect its patch."
                                      unavailableMessage={(item) => item.isBinary ? 'Binary file changed. Inline text diff is not available.' : undefined}
                                    />
                                  </Show>
                                </Show>
                              </div>
                            </Show>
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </Show>
                </Show>
              </div>
            )}
          >
            <div class="flex h-full min-h-0 flex-col overflow-hidden px-4 py-4">
              <Show when={!props.contextLoading} fallback={<GitStatePane loading message="Loading stash save context..." surface class="h-full" />}>
                <Show when={!props.contextError} fallback={<GitStatePane tone="error" message={props.contextError ?? 'Failed to load stash context.'} surface class="h-full" />}>
                  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
                    <GitSection
                      label="Target Workspace"
                      tone={contextTone(props.workspaceSummary)}
                      aside={<GitMetaPill tone="neutral">{sourceLabel(props.source)}</GitMetaPill>}
                    >
                      <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <GitPrimaryTitle>{repoName()}</GitPrimaryTitle>
                          <GitMetaPill tone={contextTone(props.workspaceSummary)}>{workspaceTotal()} file{workspaceTotal() === 1 ? '' : 's'}</GitMetaPill>
                          <Show when={(props.repoSummary?.stashCount ?? 0) > 0}>
                            <GitMetaPill tone="violet">{props.repoSummary?.stashCount} stash{props.repoSummary?.stashCount === 1 ? '' : 'es'}</GitMetaPill>
                          </Show>
                        </div>
                        <div class="text-[11px] text-muted-foreground">{repoPath() || 'Repository path unavailable'}</div>
                        <GitSubtleNote>{workspaceHealthLabel(props.workspaceSummary)}</GitSubtleNote>
                      </div>
                    </GitSection>

                    <GitSection
                      label="Save Changes"
                      tone="warning"
                      description={<>Create a temporary snapshot so you can continue work without losing the current workspace state.</>}
                    >
                      <div class="space-y-3">
                        <label class="block space-y-1">
                          <div class="text-[11px] font-medium text-foreground">Message</div>
                          <input
                            type="text"
                            class="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring"
                            value={props.saveMessage ?? ''}
                            placeholder="Optional stash message"
                            onInput={(event) => props.onSaveMessageChange?.(event.currentTarget.value)}
                          />
                        </label>

                        <div class="grid gap-2 sm:grid-cols-2">
                          <label class="flex cursor-pointer items-start gap-2 rounded-md border border-border/55 bg-background/72 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={Boolean(props.includeUntracked)}
                              onChange={(event) => props.onIncludeUntrackedChange?.(event.currentTarget.checked)}
                            />
                            <div>
                              <div class="text-[11px] font-medium text-foreground">Include untracked files</div>
                              <div class="text-[10px] text-muted-foreground">Save new files alongside tracked edits.</div>
                            </div>
                          </label>

                          <label class="flex cursor-pointer items-start gap-2 rounded-md border border-border/55 bg-background/72 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={Boolean(props.keepIndex)}
                              onChange={(event) => props.onKeepIndexChange?.(event.currentTarget.checked)}
                            />
                            <div>
                              <div class="text-[11px] font-medium text-foreground">Keep staged changes ready to commit</div>
                              <div class="text-[10px] text-muted-foreground">Leave the index intact after stashing.</div>
                            </div>
                          </label>
                        </div>

                        <Show when={workspaceTotal() <= 0}>
                          <GitSubtleNote>No local changes are available to stash in this worktree.</GitSubtleNote>
                        </Show>

                        <div class="flex flex-wrap gap-2">
                          <Button size="sm" variant="default" class="rounded-md" disabled={!canSave()} loading={Boolean(props.saveBusy)} onClick={() => props.onSave?.()}>
                            Stash Changes
                          </Button>
                          <Button size="sm" variant="outline" class={gitToneActionButtonClass()} onClick={() => props.onTabChange('stashes')}>
                            View Saved Stashes
                          </Button>
                        </div>
                      </div>
                    </GitSection>
                  </div>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </PreviewWindow>
  );
}
