import { For, Show, createEffect, createMemo, createSignal, on, type JSX } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Refresh } from '@floegence/floe-webapp-core/icons';
import { Button, SegmentedControl } from '@floegence/floe-webapp-core/ui';
import type {
  GitPreviewApplyStashResponse,
  GitPreviewDropStashResponse,
  GitRepoSummaryResponse,
  GitStashSummary,
  GitWorkspaceSummary,
} from '../protocol/redeven_v1';
import {
  changeDisplayPath,
  changeSecondaryPath,
  gitDiffEntryIdentity,
  repoDisplayName,
  shortGitHash,
  summarizeWorkspaceCount,
  workspaceHealthLabel,
  type GitSeededCommitFileSummary,
  type GitSeededStashDetail,
  type GitStashWindowSource,
  type GitStashWindowTab,
} from '../utils/gitWorkbench';
import { Tooltip } from '../primitives/Tooltip';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { gitChangePathClass, gitSelectedChipClass, gitSelectedSecondaryTextClass, gitToneActionButtonClass, gitToneSelectableCardClass, workspaceSectionTone } from './GitChrome';
import { GitDiffDialog } from './GitDiffDialog';
import { GitVirtualTable } from './GitVirtualTable';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChecklistItem,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitLabelBlock,
  GitMetaPill,
  GitPrimaryTitle,
  GitSection,
  GitStatePane,
  GitSubtleNote,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';
import { PREVIEW_WINDOW_Z_INDEX, PreviewWindow } from './PreviewWindow';

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

type StashPatchErrorState = {
  message: string;
  detail?: string;
};

type StashActionTooltipKey = 'apply' | 'applyRemove' | 'delete';

const STASH_DIFF_DIALOG_Z_INDEX = PREVIEW_WINDOW_Z_INDEX + 10;
const STASH_ACTION_TOOLTIP_COPY: Record<StashActionTooltipKey, string> = {
  apply: 'Review and apply this stash to the current workspace. After confirmation, the stash entry stays available.',
  applyRemove: 'Review and apply this stash to the current workspace. After a successful confirmation, the stash entry is removed.',
  delete: 'Review deletion of this stash entry. After confirmation, it is permanently removed without applying its changes.',
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

function buildStashPatchErrorState(error: unknown): StashPatchErrorState {
  const raw = typeof error === 'string'
    ? error.trim()
    : error instanceof Error
      ? String(error.message ?? '').trim()
      : String(error ?? '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('stash not found')) {
    return {
      message: 'The selected stash is no longer available.',
      detail: 'Refresh the stash list to load the latest shared stash stack.',
    };
  }
  if (lower.includes('file not found in diff')) {
    return {
      message: 'This file is no longer available inside the selected stash.',
      detail: 'Refresh the stash list and choose another file if needed.',
    };
  }
  return {
    message: 'Could not load the selected stash patch.',
    detail: 'Refresh the stash list and try again.',
  };
}

interface StashActionButtonProps {
  mobile: boolean;
  tooltip: string;
  disabled?: boolean;
  children: JSX.Element;
}

function StashActionButton(props: StashActionButtonProps) {
  return (
    <Show when={!props.mobile} fallback={props.children}>
      <Tooltip content={props.tooltip} placement="top" delay={0}>
        <span class={cn('inline-flex', props.disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
          {props.children}
        </span>
      </Tooltip>
    </Show>
  );
}

export function GitStashWindow(props: GitStashWindowProps) {
  const layout = useLayout();
  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitSeededCommitFileSummary | null>(null);
  const [diffDialogStashId, setDiffDialogStashId] = createSignal('');

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
  const actionsDisabled = createMemo(() => Boolean(props.reviewLoading || props.applyBusy || props.dropBusy));
  const isMobile = createMemo(() => layout.isMobile());
  const stashTabOptions = createMemo(() => [
    { value: 'save', label: 'Save Changes' },
    { value: 'stashes', label: 'Saved Stashes' },
  ]);
  const handleTabChange = (value: string) => {
    props.onTabChange(value === 'stashes' ? 'stashes' : 'save');
  };

  const closeDiffDialog = () => {
    setDiffDialogOpen(false);
    setDiffDialogItem(null);
    setDiffDialogStashId('');
  };
  const openDiffDialog = (file: GitSeededCommitFileSummary) => {
    setDiffDialogItem(file);
    setDiffDialogStashId(String(selectedStash()?.id ?? '').trim());
    setDiffDialogOpen(true);
  };

  createEffect(on(() => [props.open, props.tab] as const, ([open, tab]) => {
    if (open && tab === 'stashes') return;
    closeDiffDialog();
  }));

  createEffect(on(() => selectedStash()?.id ?? '', (stashId) => {
    const activeDialogStashId = diffDialogStashId();
    if (!activeDialogStashId) return;
    if (stashId && stashId === activeDialogStashId) return;
    closeDiffDialog();
  }));

  createEffect(() => {
    const item = diffDialogItem();
    if (!item) return;
    if (detailFiles().some((file) => gitDiffEntryIdentity(file) === gitDiffEntryIdentity(item))) return;
    closeDiffDialog();
  });

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
        <div class={cn('shrink-0 border-b px-4 pt-3 pb-3', redevenDividerRoleClass('strong'))}>
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

            <SegmentedControl
              value={props.tab}
              onChange={handleTabChange}
              size="md"
              aria-label="Stash tabs"
              class={cn(
                'grid w-full grid-cols-2 rounded-lg shadow-sm shadow-black/5 sm:w-[16rem] [&_button]:w-full',
                redevenSurfaceRoleClass('segmented'),
              )}
              options={stashTabOptions()}
            />
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
                    <div class="flex h-full min-h-0 flex-col gap-3 overflow-auto xl:grid xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] xl:overflow-hidden">
                      <div class={cn('min-h-0 overflow-auto rounded-md p-2', redevenSurfaceRoleClass('panelStrong'))}>
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
                                    <div class={cn('min-w-0 truncate text-xs font-semibold', active() ? 'text-current' : 'text-foreground')}>{stash.message || stash.ref || 'Unnamed stash'}</div>
                                    <div class={cn('flex flex-wrap items-center gap-1.5 text-[11px]', gitSelectedSecondaryTextClass(active()))}>
                                      <GitMetaPill tone="violet" class={gitSelectedChipClass(active())}>{stash.ref || shortGitHash(stash.id)}</GitMetaPill>
                                      <Show when={stash.branchName}>
                                        <GitMetaPill tone="neutral" class={gitSelectedChipClass(active())}>{stash.branchName}</GitMetaPill>
                                      </Show>
                                      <Show when={stash.hasUntracked}>
                                        <GitMetaPill tone="warning" class={gitSelectedChipClass(active())}>Untracked</GitMetaPill>
                                      </Show>
                                    </div>
                                    <div class={cn('text-[10px]', gitSelectedSecondaryTextClass(active()))}>{formatStashTime(stash.createdAtUnixMs)}</div>
                                  </button>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      </div>

                      <div class="min-h-0 xl:overflow-auto">
                        <Show
                          when={!props.stashDetailLoading}
                          fallback={<GitStatePane loading message="Loading stash detail..." surface class="h-full" />}
                        >
                          <Show when={!props.stashDetailError} fallback={<GitStatePane tone="error" message={props.stashDetailError ?? 'Failed to load stash detail.'} surface class="h-full" />}>
                            <Show
                              when={props.stashDetail}
                              fallback={<GitStatePane message="Select a stash to inspect its files and actions." surface class="h-full" />}
                            >
                              <div class="flex flex-col gap-3">
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

                                <section class={cn('rounded-md border px-3 py-2.5 shadow-sm shadow-black/[0.05] ring-1 ring-black/[0.02]', redevenSurfaceRoleClass('panelStrong'))}>
                                  <GitLabelBlock class="min-w-0" label="Changed Files" tone="info" meta={<GitMetaPill tone="neutral">{String(detailFiles().length)}</GitMetaPill>}>
                                    <div class="text-xs leading-relaxed text-muted-foreground">Click a file to inspect its diff in a dialog.</div>
                                  </GitLabelBlock>
                                  <Show when={detailFiles().length > 0} fallback={<GitSubtleNote class="mt-2.5">No changed files are available for this stash.</GitSubtleNote>}>
                                    <div class={cn('mt-2.5 overflow-hidden rounded-md border', redevenSurfaceRoleClass('panelStrong'))}>
                                      <GitVirtualTable
                                        items={detailFiles()}
                                        tableClass={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[34rem] sm:min-w-[42rem] md:min-w-0`}
                                        header={(
                                          <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                                            <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                                            <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                                            <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
                                            <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
                                          </tr>
                                        )}
                                        renderRow={(file) => {
                                          const active = () => (
                                            diffDialogOpen()
                                            && diffDialogStashId() === String(selectedStash()?.id ?? '').trim()
                                            && gitDiffEntryIdentity(diffDialogItem()) === gitDiffEntryIdentity(file)
                                          );
                                          const primaryPath = changeDisplayPath(file);
                                          const secondaryPath = changeSecondaryPath(file);
                                          return (
                                            <tr
                                              aria-selected={active()}
                                              class={`${gitChangedFilesRowClass(active())} cursor-pointer`}
                                              onClick={() => openDiffDialog(file)}
                                            >
                                              <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                                <div class="min-w-0">
                                                  <button
                                                    type="button"
                                                    class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(file.changeType)}`}
                                                    title={secondaryPath}
                                                    onClick={(event) => {
                                                      event.stopPropagation();
                                                      openDiffDialog(file);
                                                    }}
                                                  >
                                                    {primaryPath}
                                                  </button>
                                                  <Show when={secondaryPath !== primaryPath}>
                                                    <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={secondaryPath}>{secondaryPath}</div>
                                                  </Show>
                                                </div>
                                              </td>
                                              <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeStatusPill change={file.changeType} /></td>
                                              <td class={GIT_CHANGED_FILES_CELL_CLASS}><GitChangeMetrics additions={file.additions} deletions={file.deletions} /></td>
                                              <td class={gitChangedFilesStickyCellClass(active())}>
                                                <GitChangedFilesActionButton
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    openDiffDialog(file);
                                                  }}
                                                >
                                                  View Diff
                                                </GitChangedFilesActionButton>
                                              </td>
                                            </tr>
                                          );
                                        }}
                                      />
                                    </div>
                                  </Show>
                                </section>

                                <div class="grid gap-2 sm:grid-cols-3">
                                  <StashActionButton mobile={isMobile()} tooltip={STASH_ACTION_TOOLTIP_COPY.apply} disabled={actionsDisabled()}>
                                    <Button size="sm" variant="default" class="rounded-md" disabled={actionsDisabled()} onClick={() => props.onRequestApply?.(false)}>
                                      {props.applyBusy && props.review?.kind === 'apply' && !props.review?.removeAfterApply ? 'Applying...' : 'Apply'}
                                    </Button>
                                  </StashActionButton>
                                  <StashActionButton mobile={isMobile()} tooltip={STASH_ACTION_TOOLTIP_COPY.applyRemove} disabled={actionsDisabled()}>
                                    <Button size="sm" variant="outline" class={cn('rounded-md', redevenSurfaceRoleClass('control'))} disabled={actionsDisabled()} onClick={() => props.onRequestApply?.(true)}>
                                      {props.applyBusy && props.review?.kind === 'apply' && props.review?.removeAfterApply ? 'Applying...' : 'Apply & Remove'}
                                    </Button>
                                  </StashActionButton>
                                  <StashActionButton mobile={isMobile()} tooltip={STASH_ACTION_TOOLTIP_COPY.delete} disabled={actionsDisabled()}>
                                    <Button size="sm" variant="ghost" class="rounded-md text-destructive hover:text-destructive" disabled={actionsDisabled()} onClick={() => props.onRequestDrop?.()}>
                                      {props.dropBusy ? 'Deleting...' : 'Delete'}
                                    </Button>
                                  </StashActionButton>
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
                                      <Button size="sm" variant="outline" class={cn('rounded-md', redevenSurfaceRoleClass('control'))} onClick={() => props.onCancelReview?.()}>
                                        Cancel
                                      </Button>
                                      <Button size="sm" variant="default" class="rounded-md" disabled={!canConfirmReview()} loading={Boolean(props.reviewLoading || props.applyBusy || props.dropBusy)} onClick={() => props.onConfirmReview?.()}>
                                        {props.review?.kind === 'drop' ? 'Confirm Delete' : (props.review?.removeAfterApply ? 'Confirm Apply & Remove' : 'Confirm Apply')}
                                      </Button>
                                    </div>
                                  </GitChecklistItem>
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
                            class={cn('w-full rounded-md bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-ring', redevenSurfaceRoleClass('control'))}
                            value={props.saveMessage ?? ''}
                            placeholder="Optional stash message"
                            onInput={(event) => props.onSaveMessageChange?.(event.currentTarget.value)}
                          />
                        </label>

                        <div class="grid gap-2 sm:grid-cols-2">
                          <label class={cn('flex cursor-pointer items-start gap-2 rounded-md px-3 py-2', redevenSurfaceRoleClass('controlMuted'))}>
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

                          <label class={cn('flex cursor-pointer items-start gap-2 rounded-md px-3 py-2', redevenSurfaceRoleClass('controlMuted'))}>
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

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          if (open) {
            setDiffDialogOpen(true);
            return;
          }
          closeDiffDialog();
        }}
        item={diffDialogItem()}
        source={diffDialogItem() && diffDialogStashId() ? {
          kind: 'stash',
          repoRootPath: repoPath(),
          stashId: diffDialogStashId(),
        } : null}
        title="Stash Diff"
        description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : 'Review the selected stash file diff.'}
        emptyMessage="Select a changed stash file to inspect its diff."
        unavailableMessage={(item) => (item.isBinary ? 'Binary file changed. Inline text diff is not available.' : undefined)}
        errorFormatter={(error) => buildStashPatchErrorState(error)}
        desktopWindowZIndex={STASH_DIFF_DIALOG_Z_INDEX}
      />
    </PreviewWindow>
  );
}
