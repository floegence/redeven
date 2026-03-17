import { For, Show, createSignal } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitCommitFileSummary, GitPreviewMergeBranchResponse, GitWorkspaceSummary } from '../protocol/redeven_v1';
import { branchDisplayName, changeSecondaryPath, gitDiffEntryIdentity } from '../utils/gitWorkbench';
import { gitChangePathClass } from './GitChrome';
import { GitDiffDialog } from './GitDiffDialog';
import {
  GIT_CHANGED_FILES_CELL_CLASS,
  GIT_CHANGED_FILES_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_HEAD_CLASS,
  GIT_CHANGED_FILES_HEADER_ROW_CLASS,
  GIT_CHANGED_FILES_SECONDARY_PATH_CLASS,
  GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS,
  GIT_CHANGED_FILES_TABLE_CLASS,
  GitChangedFilesActionButton,
  GitChangeMetrics,
  GitChangeStatusPill,
  GitMetaPill,
  GitStatePane,
  GitSubtleNote,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';

export type GitMergeBranchDialogState = 'idle' | 'previewing' | 'merging';

export interface GitMergeBranchDialogConfirmOptions {
  planFingerprint?: string;
}

export interface GitMergeBranchDialogProps {
  open: boolean;
  branch?: GitBranchSummary | null;
  preview?: GitPreviewMergeBranchResponse | null;
  previewError?: string;
  actionError?: string;
  state?: GitMergeBranchDialogState;
  onClose: () => void;
  onRetryPreview?: (branch: GitBranchSummary) => void;
  onConfirm?: (branch: GitBranchSummary, options: GitMergeBranchDialogConfirmOptions) => void;
}

function mergePreviewFilePath(item: GitCommitFileSummary): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || '(unknown path)';
}

function formatWorkspaceSummary(summary: GitWorkspaceSummary | null | undefined): string {
  const parts: string[] = [];
  const staged = Number(summary?.stagedCount ?? 0);
  const unstaged = Number(summary?.unstagedCount ?? 0);
  const untracked = Number(summary?.untrackedCount ?? 0);
  const conflicted = Number(summary?.conflictedCount ?? 0);
  if (staged > 0) parts.push(`${staged} staged`);
  if (unstaged > 0) parts.push(`${unstaged} unstaged`);
  if (untracked > 0) parts.push(`${untracked} untracked`);
  if (conflicted > 0) parts.push(`${conflicted} conflicted`);
  return parts.join(' · ');
}

function outcomeLabel(outcome: string | undefined): string {
  switch (outcome) {
    case 'up_to_date':
      return 'Up to date';
    case 'fast_forward':
      return 'Fast-forward';
    case 'merge_commit':
      return 'Merge commit';
    case 'blocked':
      return 'Blocked';
    default:
      return 'Preview';
  }
}

function outcomeTone(outcome: string | undefined): 'neutral' | 'info' | 'success' | 'warning' | 'violet' {
  switch (outcome) {
    case 'up_to_date':
      return 'success';
    case 'fast_forward':
      return 'info';
    case 'merge_commit':
      return 'violet';
    case 'blocked':
      return 'warning';
    default:
      return 'neutral';
  }
}

function outcomeDetail(outcome: string | undefined, currentRef: string, sourceName: string): string {
  switch (outcome) {
    case 'up_to_date':
      return `${currentRef} already contains ${sourceName}.`;
    case 'fast_forward':
      return `${currentRef} can advance without creating a merge commit.`;
    case 'merge_commit':
      return `${sourceName} will be merged into ${currentRef} with a merge commit.`;
    case 'blocked':
      return 'This merge cannot run until the blocking issue is resolved.';
    default:
      return 'Review the merge plan before applying it.';
  }
}

export function GitMergeBranchDialog(props: GitMergeBranchDialogProps) {
  const layout = useLayout();

  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitCommitFileSummary | null>(null);

  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;
  const state = () => props.state ?? 'idle';
  const loading = () => state() === 'previewing';
  const merging = () => state() === 'merging';
  const currentRef = () => String(preview()?.currentRef ?? '').trim() || 'current branch';
  const sourceName = () => String(preview()?.sourceName ?? '').trim() || branchName();
  const blockingReason = () => String(preview()?.blockingReason ?? '').trim();
  const files = () => preview()?.files ?? [];
  const selectedKey = () => gitDiffEntryIdentity(diffDialogItem());
  const canConfirm = () => {
    const outcome = preview()?.outcome;
    return Boolean(
      props.open
      && props.branch
      && preview()
      && !loading()
      && !merging()
      && !blockingReason()
      && (outcome === 'fast_forward' || outcome === 'merge_commit')
    );
  };
  const confirmLabel = () => {
    if (merging()) return 'Merging...';
    const outcome = preview()?.outcome;
    if (outcome === 'up_to_date') return 'Already Up to Date';
    if (outcome === 'fast_forward') return `Fast-Forward ${currentRef()}`;
    return `Merge Into ${currentRef()}`;
  };
  const linkedWorktreeNote = () => {
    const linkedWorktree = preview()?.linkedWorktree;
    if (!linkedWorktree?.worktreePath) return '';
    if (!linkedWorktree.summary) return `A linked worktree exists at ${linkedWorktree.worktreePath}.`;
    const summaryText = formatWorkspaceSummary(linkedWorktree.summary);
    if (!summaryText) {
      return `A linked worktree exists at ${linkedWorktree.worktreePath}. Its pending files are not part of this merge.`;
    }
    return `Pending files in ${linkedWorktree.worktreePath} stay outside this merge (${summaryText}).`;
  };

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        title="Merge Branch"
        description={`Merge ${branchName()} into ${currentRef()}.`}
        footer={(
          <div class="border-t border-border/60 bg-background/88 px-4 pt-3 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/78">
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button size="sm" variant="outline" class="w-full sm:w-auto" disabled={loading() || merging()} onClick={props.onClose}>
                Close
              </Button>
              <Show when={props.previewError && props.branch}>
                <Button
                  size="sm"
                  variant="outline"
                  class="w-full sm:w-auto"
                  disabled={loading() || merging()}
                  onClick={() => props.branch && props.onRetryPreview?.(props.branch)}
                >
                  Retry
                </Button>
              </Show>
              <Button
                size="sm"
                variant="default"
                class="w-full sm:w-auto"
                disabled={!canConfirm()}
                loading={merging()}
                onClick={() => {
                  const branch = props.branch;
                  const currentPreview = preview();
                  if (!branch || !currentPreview) return;
                  props.onConfirm?.(branch, { planFingerprint: currentPreview.planFingerprint });
                }}
              >
                {confirmLabel()}
              </Button>
            </div>
          </div>
        )}
        class={cn(
          'flex max-w-none flex-col overflow-hidden rounded-md p-0',
          '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
          '[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0',
          layout.isMobile() ? 'w-[calc(100vw-0.5rem)] max-w-none' : 'w-[min(60rem,96vw)]',
        )}
      >
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Show
            when={!loading()}
            fallback={<GitStatePane loading message="Reviewing merge plan..." class="m-4" surface />}
          >
            <Show when={!props.previewError} fallback={<GitStatePane tone="error" message={props.previewError ?? 'Merge preview failed.'} class="m-4" surface />}>
              <Show when={props.branch && preview()} fallback={<GitStatePane message="Choose a branch to review its merge plan." class="m-4" surface />}>
                <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-4">
                  <div class="flex flex-col gap-3">
                    <GitSubtleNote class="border-border/55 bg-background/72 text-foreground">
                      <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="text-xs font-semibold text-foreground">{sourceName()}</div>
                          <GitMetaPill tone={outcomeTone(preview()?.outcome)}>{outcomeLabel(preview()?.outcome)}</GitMetaPill>
                        </div>
                        <div class="text-[11px] leading-relaxed text-muted-foreground">
                          {outcomeDetail(preview()?.outcome, currentRef(), sourceName())}
                        </div>
                        <div class="grid gap-1 rounded-md bg-muted/[0.12] p-1 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                          <div class="rounded bg-background/75 px-2 py-1">
                            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Target</div>
                            <div class="mt-0.5 font-medium text-foreground">{currentRef()}</div>
                          </div>
                          <div class="rounded bg-background/75 px-2 py-1">
                            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Source</div>
                            <div class="mt-0.5 font-medium text-foreground">{sourceName()}</div>
                          </div>
                          <div class="rounded bg-background/75 px-2 py-1">
                            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Ahead / Behind</div>
                            <div class="mt-0.5 font-medium text-foreground">↑{preview()?.sourceAheadCount ?? 0} ↓{preview()?.sourceBehindCount ?? 0}</div>
                          </div>
                          <div class="rounded bg-background/75 px-2 py-1">
                            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Merge base</div>
                            <div class="mt-0.5 font-medium text-foreground">{preview()?.mergeBase ? preview()?.mergeBase?.slice(0, 7) : '—'}</div>
                          </div>
                        </div>
                      </div>
                    </GitSubtleNote>

                    <Show when={linkedWorktreeNote()}>
                      <GitSubtleNote class="border-border/55 bg-background/72 text-muted-foreground">
                        {linkedWorktreeNote()}
                      </GitSubtleNote>
                    </Show>
                    <Show when={blockingReason()}>
                      <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{blockingReason()}</GitSubtleNote>
                    </Show>
                    <Show when={props.actionError}>
                      <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.actionError}</GitSubtleNote>
                    </Show>

                    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                      <div class="flex items-center justify-between gap-2">
                        <div>
                          <div class="text-xs font-semibold text-foreground">Changed Files</div>
                          <div class="text-[11px] text-muted-foreground">Open any file to inspect the merge diff.</div>
                        </div>
                        <GitMetaPill tone="neutral">{files().length} file{files().length === 1 ? '' : 's'}</GitMetaPill>
                      </div>

                      <div class="flex min-h-0 flex-1 overflow-hidden">
                        <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border/65 bg-card">
                          <Show
                            when={files().length > 0}
                            fallback={(
                              <div class="px-4 py-8">
                                <GitSubtleNote>No changed files were found in this merge preview.</GitSubtleNote>
                              </div>
                            )}
                          >
                            <div class="min-h-0 flex-1 overflow-auto">
                              <table class={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[46rem] md:min-w-0`}>
                                <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
                                  <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Path</th>
                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Status</th>
                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>Changes</th>
                                    <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>Action</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <For each={files()}>
                                    {(item) => {
                                      const active = () => selectedKey() === gitDiffEntryIdentity(item);
                                      return (
                                        <tr aria-selected={active()} class={gitChangedFilesRowClass(active())}>
                                          <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                            <div class="min-w-0">
                                              <button
                                                type="button"
                                                class={`block max-w-full cursor-pointer truncate text-left text-[11px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 ${gitChangePathClass(item.changeType)}`}
                                                title={changeSecondaryPath(item)}
                                                onClick={() => {
                                                  setDiffDialogItem(item);
                                                  setDiffDialogOpen(true);
                                                }}
                                              >
                                                {mergePreviewFilePath(item)}
                                              </button>
                                              <Show when={changeSecondaryPath(item) !== mergePreviewFilePath(item)}>
                                                <div class={GIT_CHANGED_FILES_SECONDARY_PATH_CLASS} title={changeSecondaryPath(item)}>{changeSecondaryPath(item)}</div>
                                              </Show>
                                            </div>
                                          </td>
                                          <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                            <GitChangeStatusPill change={item.changeType} />
                                          </td>
                                          <td class={GIT_CHANGED_FILES_CELL_CLASS}>
                                            <GitChangeMetrics additions={item.additions} deletions={item.deletions} />
                                          </td>
                                          <td class={gitChangedFilesStickyCellClass(active())}>
                                            <GitChangedFilesActionButton
                                              onClick={() => {
                                                setDiffDialogItem(item);
                                                setDiffDialogOpen(true);
                                              }}
                                            >
                                              View Diff
                                            </GitChangedFilesActionButton>
                                          </td>
                                        </tr>
                                      );
                                    }}
                                  </For>
                                </tbody>
                              </table>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </Show>
            </Show>
          </Show>
        </div>
      </Dialog>

      <GitDiffDialog
        open={diffDialogOpen()}
        onOpenChange={(open) => {
          setDiffDialogOpen(open);
          if (!open) setDiffDialogItem(null);
        }}
        item={diffDialogItem()}
        title="Merge Preview Diff"
        description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : 'Review the selected merge diff.'}
        emptyMessage="Select a changed file to inspect its diff."
      />
    </>
  );
}
