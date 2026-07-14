import { For, Show, createSignal } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitCommitFileSummary, GitPreviewMergeBranchResponse, GitWorkspaceSummary } from '../protocol/redeven_v1';
import { branchDisplayName, changeSecondaryPath, gitDiffEntryIdentity, type GitStashWindowRequest } from '../utils/gitWorkbench';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
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
  GitTableFrame,
  gitChangedFilesRowClass,
  gitChangedFilesStickyCellClass,
} from './GitWorkbenchPrimitives';
import { useI18n } from '../i18n';

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
  onOpenStash?: (request: GitStashWindowRequest) => void;
  onConfirm?: (branch: GitBranchSummary, options: GitMergeBranchDialogConfirmOptions) => void;
}

function mergePreviewFilePath(item: GitCommitFileSummary, i18n: ReturnType<typeof useI18n>): string {
  return String(item.displayPath || item.path || item.newPath || item.oldPath || '').trim() || i18n.t('filePreview.unknownPath');
}

function formatWorkspaceSummary(summary: GitWorkspaceSummary | null | undefined, i18n: ReturnType<typeof useI18n>): string {
  const parts: string[] = [];
  const staged = Number(summary?.stagedCount ?? 0);
  const unstaged = Number(summary?.unstagedCount ?? 0);
  const untracked = Number(summary?.untrackedCount ?? 0);
  const conflicted = Number(summary?.conflictedCount ?? 0);
  if (staged > 0) parts.push(`${i18n.t('git.common.staged')}: ${staged}`);
  if (unstaged > 0) parts.push(`${i18n.t('git.common.unstaged')}: ${unstaged}`);
  if (untracked > 0) parts.push(`${i18n.t('git.common.untracked')}: ${untracked}`);
  if (conflicted > 0) parts.push(`${i18n.t('git.common.conflicted')}: ${conflicted}`);
  return parts.join(' · ');
}

function outcomeLabel(outcome: string | undefined, i18n: ReturnType<typeof useI18n>): string {
  switch (outcome) {
    case 'up_to_date':
      return i18n.t('git.notifications.upToDateTitle');
    case 'fast_forward':
      return i18n.t('git.notifications.fastForwardedTitle');
    case 'merge_commit':
      return i18n.t('gitPresentation.mergeCommit');
    case 'blocked':
      return i18n.t('uiCopy.plugin.blocked');
    default:
      return i18n.t('uiCopy.preview.eyebrow');
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

function outcomeDetail(outcome: string | undefined, currentRef: string, sourceName: string, i18n: ReturnType<typeof useI18n>): string {
  switch (outcome) {
    case 'up_to_date':
      return i18n.t('git.notifications.branchAlreadyIncluded', { target: currentRef, branch: sourceName });
    case 'fast_forward':
      return i18n.t('git.notifications.fastForwardedTitle');
    case 'merge_commit':
      return i18n.t('uiCopy.git.mergeDescription', { branch: sourceName, target: currentRef });
    case 'blocked':
      return i18n.t('common.status.failed');
    default:
      return i18n.t('uiCopy.git.reviewingMergePlan');
  }
}

export function GitMergeBranchDialog(props: GitMergeBranchDialogProps) {
  const i18n = useI18n();
  const layout = useLayout();
  const outlineControlClass = redevenSurfaceRoleClass('control');

  const [diffDialogOpen, setDiffDialogOpen] = createSignal(false);
  const [diffDialogItem, setDiffDialogItem] = createSignal<GitCommitFileSummary | null>(null);

  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;
  const state = () => props.state ?? 'idle';
  const loading = () => state() === 'previewing';
  const merging = () => state() === 'merging';
  const currentRef = () => String(preview()?.currentRef ?? '').trim() || i18n.t('git.notifications.currentBranchFallback');
  const sourceName = () => String(preview()?.sourceName ?? '').trim() || branchName();
  const blockingReason = () => String(preview()?.blockingReason ?? preview()?.blocking?.reason ?? '').trim();
  const stashBlockerPath = () => String(preview()?.blocking?.workspacePath ?? '').trim();
  const canOpenStashShortcut = () => Boolean(
    props.onOpenStash
    && preview()?.blocking?.canStashWorkspace
    && stashBlockerPath()
  );
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
    if (merging()) return i18n.t('uiCopy.git.mergeBranch');
    const outcome = preview()?.outcome;
    if (outcome === 'up_to_date') return i18n.t('git.notifications.upToDateTitle');
    if (outcome === 'fast_forward') return i18n.t('uiCopy.git.fastForwardTarget', { target: currentRef() });
    return i18n.t('uiCopy.git.mergeIntoTarget', { target: currentRef() });
  };
  const linkedWorktreeNote = () => {
    const linkedWorktree = preview()?.linkedWorktree;
    if (!linkedWorktree?.worktreePath) return '';
    if (!linkedWorktree.summary) return `${i18n.t('git.overview.linkedWorktree')}: ${linkedWorktree.worktreePath}`;
    const summaryText = formatWorkspaceSummary(linkedWorktree.summary, i18n);
    if (!summaryText) {
      return `${i18n.t('git.overview.linkedWorktree')}: ${linkedWorktree.worktreePath}`;
    }
    return `${i18n.t('git.overview.linkedWorktree')}: ${linkedWorktree.worktreePath} · ${summaryText}`;
  };

  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onClose();
        }}
        title={i18n.t('uiCopy.git.mergeBranch')}
        description={i18n.t('uiCopy.git.mergeDescription', { branch: branchName(), target: currentRef() })}
        footer={(
          <div class={cn('border-t px-4 pt-3 pb-4 backdrop-blur', redevenDividerRoleClass('strong'), redevenSurfaceRoleClass('inset'), 'supports-[backdrop-filter]:bg-background/78')}>
            <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button size="sm" variant="outline" class={cn('w-full sm:w-auto', outlineControlClass)} disabled={loading() || merging()} onClick={props.onClose}>
                {i18n.t('common.actions.close')}
              </Button>
              <Show when={props.previewError && props.branch}>
                <Button
                  size="sm"
                  variant="outline"
                  class={cn('w-full sm:w-auto', outlineControlClass)}
                  disabled={loading() || merging()}
                  onClick={() => props.branch && props.onRetryPreview?.(props.branch)}
                >
                  {i18n.t('common.actions.retry')}
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
          'flex max-w-none flex-col overflow-hidden rounded-md border border-border/60 p-0 shadow-xl',
          '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
          '[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0',
          layout.isMobile() ? 'w-[calc(100vw-0.5rem)] max-w-none' : 'w-[min(60rem,96vw)]',
        )}
      >
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Show
            when={!loading()}
            fallback={<GitStatePane loading message={i18n.t('uiCopy.git.reviewingMergePlan')} class="m-4" surface />}
          >
            <Show when={!props.previewError} fallback={<GitStatePane tone="error" message={props.previewError ?? i18n.t('uiCopy.git.mergePreviewFailed')} class="m-4" surface />}>
              <Show when={props.branch && preview()} fallback={<GitStatePane message={i18n.t('uiCopy.git.chooseBranchMergePlan')} class="m-4" surface />}>
                <div class="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-4">
                  <div class="flex flex-col gap-3">
                    <GitSubtleNote class="text-foreground">
                      <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                          <div class="text-xs font-semibold text-foreground">{sourceName()}</div>
                          <GitMetaPill tone={outcomeTone(preview()?.outcome)}>{outcomeLabel(preview()?.outcome, i18n)}</GitMetaPill>
                        </div>
                        <div class="text-[11px] leading-relaxed text-muted-foreground">
                          {outcomeDetail(preview()?.outcome, currentRef(), sourceName(), i18n)}
                        </div>
                        <div class="grid gap-1 rounded-md bg-muted/[0.12] p-1 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                          <div class={cn('rounded border px-2 py-1', redevenSurfaceRoleClass('controlMuted'))}>
                            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{i18n.t('git.common.target')}</div>
                            <div class="mt-0.5 font-medium text-foreground">{currentRef()}</div>
                          </div>
                          <div class={cn('rounded border px-2 py-1', redevenSurfaceRoleClass('controlMuted'))}>
                            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{i18n.t('skillsSettings.table.source')}</div>
                            <div class="mt-0.5 font-medium text-foreground">{sourceName()}</div>
                          </div>
                          <div class={cn('rounded border px-2 py-1', redevenSurfaceRoleClass('controlMuted'))}>
                            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{i18n.t('git.common.aheadBehind')}</div>
                            <div class="mt-0.5 font-medium text-foreground">↑{preview()?.sourceAheadCount ?? 0} ↓{preview()?.sourceBehindCount ?? 0}</div>
                          </div>
                          <div class={cn('rounded border px-2 py-1', redevenSurfaceRoleClass('controlMuted'))}>
                            <div class="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{i18n.t('git.common.mergeBase')}</div>
                            <div class="mt-0.5 font-medium text-foreground">{preview()?.mergeBase ? preview()?.mergeBase?.slice(0, 7) : '—'}</div>
                          </div>
                        </div>
                      </div>
                    </GitSubtleNote>

                    <Show when={linkedWorktreeNote()}>
                      <GitSubtleNote>
                        {linkedWorktreeNote()}
                      </GitSubtleNote>
                    </Show>
                    <Show when={blockingReason()}>
                      <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <span>{blockingReason()}</span>
                          <Show when={canOpenStashShortcut()}>
                            <Button
                              size="sm"
                              variant="outline"
                              class={cn('rounded-md', outlineControlClass)}
                              disabled={loading() || merging()}
                              onClick={() => {
                                const repoRootPath = stashBlockerPath();
                                if (!repoRootPath) return;
                                props.onOpenStash?.({
                                  tab: 'save',
                                  repoRootPath,
                                  source: 'merge_blocker',
                                });
                              }}
                            >
                              {i18n.t('uiCopy.git.stashCurrentChanges')}
                            </Button>
                          </Show>
                        </div>
                      </GitSubtleNote>
                    </Show>
                    <Show when={props.actionError}>
                      <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.actionError}</GitSubtleNote>
                    </Show>

                    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                      <div class="flex items-center justify-between gap-2">
                        <div>
                          <div class="text-xs font-semibold text-foreground">{i18n.t('uiCopy.git.changedFiles')}</div>
                          <div class="text-[11px] text-muted-foreground">{i18n.t('uiCopy.git.openMergeFileDiff')}</div>
                        </div>
                        <GitMetaPill tone="neutral">{i18n.tn('git.common.fileCount', files().length)}</GitMetaPill>
                      </div>

                      <div class="flex min-h-0 flex-1 overflow-hidden">
                        <GitTableFrame class="flex min-h-0 flex-1 flex-col">
                          <Show
                            when={files().length > 0}
                            fallback={(
                              <div class="px-4 py-8">
                                <GitSubtleNote>{i18n.t('uiCopy.git.noMergeFiles')}</GitSubtleNote>
                              </div>
                            )}
                          >
                            <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="min-h-0 flex-1 overflow-auto">
                              <table class={`${GIT_CHANGED_FILES_TABLE_CLASS} min-w-[46rem] md:min-w-0`}>
                                <thead class={GIT_CHANGED_FILES_HEAD_CLASS}>
                                  <tr class={GIT_CHANGED_FILES_HEADER_ROW_CLASS}>
                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.path')}</th>
                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.status')}</th>
                                    <th class={GIT_CHANGED_FILES_HEADER_CELL_CLASS}>{i18n.t('git.common.changes')}</th>
                                    <th class={GIT_CHANGED_FILES_STICKY_HEADER_CELL_CLASS}>{i18n.t('git.common.action')}</th>
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
                                                {mergePreviewFilePath(item, i18n)}
                                              </button>
                                              <Show when={changeSecondaryPath(item) !== mergePreviewFilePath(item, i18n)}>
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
                                              {i18n.t('files.menuViewDiff')}
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
                        </GitTableFrame>
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
        source={diffDialogItem() && preview() ? {
          kind: 'compare',
          repoRootPath: String(preview()?.repoRootPath ?? '').trim(),
          baseRef: String(preview()?.currentRef ?? '').trim(),
          targetRef: String(preview()?.sourceName ?? '').trim() || branchName(),
        } : null}
        title={i18n.t('uiCopy.git.mergePreviewDiff')}
        description={diffDialogItem() ? changeSecondaryPath(diffDialogItem()) : i18n.t('uiCopy.git.reviewSelectedMergeDiff')}
        emptyMessage={i18n.t('uiCopy.git.selectChangedFile')}
      />
    </>
  );
}
