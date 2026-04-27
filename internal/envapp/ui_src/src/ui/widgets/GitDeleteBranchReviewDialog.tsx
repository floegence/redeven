import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn, useLayout, useNotification } from '@floegence/floe-webapp-core';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import { writeTextToClipboard } from '../utils/clipboard';
import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { GitDeleteBranchConfirmButton } from './GitDeleteBranchConfirmButton';
import { GitStatePane, GitSubtleNote } from './GitWorkbenchPrimitives';
import { expectedDeleteBranchName, resolveDeleteBranchReview, trimDeleteBranchReason, type GitDeleteBranchDialogConfirmOptions, type GitDeleteBranchDialogState } from './GitDeleteBranchReviewModel';

export interface GitDeleteBranchReviewDialogProps {
  open: boolean;
  branch?: GitBranchSummary | null;
  preview?: GitPreviewDeleteBranchResponse | null;
  previewError?: string;
  actionError?: string;
  state?: GitDeleteBranchDialogState;
  description: string;
  safeConfirmLabel: string;
  forceConfirmLabel: string;
  dialogDesktopWidthClass: string;
  summaryNoteClass: string;
  safeSummary: JSX.Element;
  forceDeleteSummary: JSX.Element;
  onClose: () => void;
  onRetryPreview?: (branch: GitBranchSummary) => void;
  onConfirm?: (branch: GitBranchSummary, options: GitDeleteBranchDialogConfirmOptions) => void;
}

export function GitDeleteBranchReviewDialog(props: GitDeleteBranchReviewDialogProps) {
  const layout = useLayout();
  const notification = useNotification();
  const [confirmBranchName, setConfirmBranchName] = createSignal('');
  const [branchNameCopied, setBranchNameCopied] = createSignal(false);
  const outlineControlClass = redevenSurfaceRoleClass('control');
  const confirmBranchInputId = 'git-delete-branch-confirm-name-input';
  const confirmBranchLabelId = 'git-delete-branch-confirm-name-label';
  let branchCopyResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;
  const requiredBranchName = () => expectedDeleteBranchName(props.branch, preview()) || branchName();
  const blockingReason = () => trimDeleteBranchReason(preview()?.blockingReason);
  const forceDeleteReason = () => trimDeleteBranchReason(preview()?.forceDeleteReason);
  const state = () => props.state ?? 'idle';
  const loading = () => state() === 'previewing';
  const deleting = () => state() === 'deleting';
  const review = () => resolveDeleteBranchReview({
    branch: props.branch,
    preview: preview(),
    previewError: props.previewError,
    loading: loading(),
    deleting: deleting(),
    blockingReason: blockingReason(),
    confirmBranchName: confirmBranchName(),
  });
  const showForceDeleteReview = () => Boolean(preview() && !preview()?.safeDeleteAllowed);
  const showForceDeleteConfirmation = () => showForceDeleteReview() && review().forceDeleteAllowed;
  const showForceDeleteBlockedReason = () => showForceDeleteReview()
    && !review().forceDeleteAllowed
    && forceDeleteReason()
    && forceDeleteReason() !== blockingReason();
  const canConfirm = () => Boolean(
    props.open
    && !loading()
    && !deleting()
    && review().canConfirm,
  );

  const clearBranchNameCopied = () => {
    if (branchCopyResetTimer !== undefined) {
      globalThis.clearTimeout(branchCopyResetTimer);
      branchCopyResetTimer = undefined;
    }
    setBranchNameCopied(false);
  };

  createEffect(() => {
    void props.open;
    void props.branch?.name;
    void props.branch?.fullName;
    void requiredBranchName();
    void preview()?.planFingerprint;
    setConfirmBranchName('');
    clearBranchNameCopied();
  });

  onCleanup(() => {
    clearBranchNameCopied();
  });

  const confirmLabel = () => {
    if (deleting()) return 'Deleting...';
    return review().confirmMode === 'force' ? props.forceConfirmLabel : props.safeConfirmLabel;
  };

  const handleCopyBranchName = async () => {
    const value = requiredBranchName();
    if (!value) return;
    try {
      await writeTextToClipboard(value);
    } catch (error) {
      notification.error('Copy failed', error instanceof Error ? error.message : 'Failed to copy branch name.');
      return;
    }
    setBranchNameCopied(true);
    if (branchCopyResetTimer !== undefined) {
      globalThis.clearTimeout(branchCopyResetTimer);
    }
    branchCopyResetTimer = globalThis.setTimeout(() => {
      branchCopyResetTimer = undefined;
      setBranchNameCopied(false);
    }, 1600);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title="Delete Branch"
      description={props.description}
      footer={(
        <div class={cn('border-t px-4 pt-3 pb-4 backdrop-blur', redevenDividerRoleClass('strong'), redevenSurfaceRoleClass('inset'), 'supports-[backdrop-filter]:bg-background/78')}>
          <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button size="sm" variant="outline" class={cn('w-full sm:w-auto', outlineControlClass)} disabled={loading() || deleting()} onClick={props.onClose}>
              Cancel
            </Button>
            <Show when={props.previewError && props.branch}>
              <Button
                size="sm"
                variant="outline"
                class={cn('w-full sm:w-auto', outlineControlClass)}
                disabled={loading() || deleting()}
                onClick={() => props.branch && props.onRetryPreview?.(props.branch)}
              >
                Retry
              </Button>
            </Show>
            <GitDeleteBranchConfirmButton
              label={confirmLabel()}
              class="w-full sm:w-auto"
              disabled={!canConfirm()}
              disabledReason={review().disabledReason}
              loading={deleting()}
              onClick={() => {
                const branch = props.branch;
                const currentPreview = preview();
                if (!branch || !currentPreview) return;
                props.onConfirm?.(branch, {
                  deleteMode: review().confirmMode,
                  confirmBranchName: review().confirmMode === 'force' ? confirmBranchName() : undefined,
                  removeLinkedWorktree: Boolean(currentPreview.requiresWorktreeRemoval),
                  discardLinkedWorktreeChanges: Boolean(currentPreview.requiresDiscardConfirmation),
                  planFingerprint: currentPreview.planFingerprint,
                });
              }}
            />
          </div>
        </div>
      )}
      class={cn(
        'flex max-w-none flex-col overflow-hidden rounded-md p-0',
        '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
        '[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0',
        layout.isMobile() ? 'w-[calc(100vw-0.5rem)] max-w-none' : props.dialogDesktopWidthClass,
      )}
    >
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Show
          when={!loading()}
          fallback={<GitStatePane loading message="Reviewing branch deletion..." class="m-4" surface />}
        >
          <Show when={!props.previewError} fallback={<GitStatePane tone="error" message={props.previewError ?? 'Delete review failed.'} class="m-4" surface />}>
            <Show when={props.branch && preview()} fallback={<GitStatePane message="Choose a branch to review its deletion plan." class="m-4" surface />}>
              <div class="flex flex-col gap-3 px-4 pt-2 pb-4">
                <GitSubtleNote class={props.summaryNoteClass}>
                  {props.safeSummary}
                </GitSubtleNote>

                <Show when={!preview()?.safeDeleteAllowed}>
                  <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">
                    {preview()?.safeDeleteReason || 'Safe delete is blocked.'}
                  </GitSubtleNote>
                </Show>

                <Show when={showForceDeleteConfirmation()}>
                  <GitSubtleNote class="border-error/25 bg-error/10 text-foreground">
                    <div class="space-y-3">
                      <div class="space-y-2">
                        <div class="text-xs font-semibold text-foreground">Force delete consequences</div>
                        {props.forceDeleteSummary}
                      </div>
                      <div class="space-y-1.5">
                        <div id={confirmBranchLabelId} class="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-foreground">
                          <span>Type</span>
                          <button
                            type="button"
                            class="inline-flex min-w-0 max-w-full cursor-pointer items-center rounded-md bg-background/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground shadow-sm ring-1 ring-border/60 transition-colors duration-150 hover:bg-background hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                            title={branchNameCopied() ? 'Branch name copied' : 'Copy branch name'}
                            aria-label={`Copy branch name ${requiredBranchName()}`}
                            onClick={() => void handleCopyBranchName()}
                          >
                            <span class="min-w-0 truncate">{requiredBranchName()}</span>
                          </button>
                          <button
                            type="button"
                            class={cn(
                              'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                              branchNameCopied() ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-background hover:text-foreground',
                            )}
                            aria-label={branchNameCopied() ? 'Branch name copied' : 'Copy branch name'}
                            title={branchNameCopied() ? 'Branch name copied' : 'Copy branch name'}
                            onClick={() => void handleCopyBranchName()}
                          >
                            <Show when={branchNameCopied()} fallback={<Copy class="size-3.5" />}>
                              <Check class="size-3.5" />
                            </Show>
                          </button>
                          <span>to confirm force delete</span>
                        </div>
                        <input
                          id={confirmBranchInputId}
                          type="text"
                          class={cn('w-full rounded-md border bg-background px-3 py-2 text-xs text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/70', outlineControlClass)}
                          value={confirmBranchName()}
                          placeholder={requiredBranchName()}
                          aria-labelledby={confirmBranchLabelId}
                          onInput={(event) => setConfirmBranchName(event.currentTarget.value)}
                          autofocus
                        />
                        <div class="text-[11px] leading-relaxed text-muted-foreground">
                          Branch name must match exactly.
                        </div>
                      </div>
                    </div>
                  </GitSubtleNote>
                </Show>

                <Show when={showForceDeleteBlockedReason()}>
                  <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{forceDeleteReason()}</GitSubtleNote>
                </Show>
                <Show when={blockingReason()}>
                  <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{blockingReason()}</GitSubtleNote>
                </Show>
                <Show when={props.actionError}>
                  <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.actionError}</GitSubtleNote>
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </Dialog>
  );
}
