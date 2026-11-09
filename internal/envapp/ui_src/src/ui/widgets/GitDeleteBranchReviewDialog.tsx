import { StableText, Button, Input } from '@floegence/floe-webapp-core/ui';
import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { cn, useLayout, useNotification } from '@floegence/floe-webapp-core';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';
import { Dialog } from '../primitives/EnvAppModal';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import { writeTextToClipboard } from '../utils/clipboard';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { GitDeleteBranchConfirmButton } from './GitDeleteBranchConfirmButton';
import { GitStatePane, GitSubtleNote } from './GitWorkbenchPrimitives';
import { expectedDeleteBranchName, resolveDeleteBranchReview, trimDeleteBranchReason, type GitDeleteBranchDialogConfirmOptions, type GitDeleteBranchDialogState } from './GitDeleteBranchReviewModel';
import { useI18n, type EnvAppTranslationKey } from '../i18n';

const worktreeBlockingKeys: Record<string, EnvAppTranslationKey> = {
  primary_worktree: 'git.deleteBranchReview.primaryWorktree',
  locked_worktree: 'git.deleteBranchReview.lockedWorktree',
  nested_worktree: 'git.deleteBranchReview.nestedWorktree',
  inaccessible_worktree: 'git.deleteBranch.runtimeCannotInspectWorktree',
  worktree_identity_changed: 'git.errors.scopeChanged',
};

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
  const i18n = useI18n();
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
  const blockingReason = () => {
    const key = worktreeBlockingKeys[preview()?.blockingCode ?? ''];
    return key ? i18n.t(key) : trimDeleteBranchReason(preview()?.blockingReason);
  };
  const forceDeleteReason = () => blockingReason() || trimDeleteBranchReason(preview()?.forceDeleteReason);
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
  const showForceDeleteConfirmation = () => showForceDeleteReview() && !blockingReason() && Boolean(preview()?.forceDeleteAllowed);
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
    if (deleting()) return i18n.t('git.deleteBranchReview.deleting');
    return review().confirmMode === 'force' ? props.forceConfirmLabel : props.safeConfirmLabel;
  };

  const handleCopyBranchName = async () => {
    const value = requiredBranchName();
    if (!value) return;
    try {
      await writeTextToClipboard(value);
    } catch (error) {
      notification.error(i18n.t('git.deleteBranchReview.copyFailedTitle'), error instanceof Error ? error.message : i18n.t('git.deleteBranchReview.failedToCopyBranchName'));
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
        if (!open && !deleting()) props.onClose();
      }}
      title={i18n.t('git.deleteBranchReview.title')}
      bodyDescription={props.description}
      contentClass="git-dialog-body"
      footer={(
        <>
          <div class="git-dialog-actions">
            <Button size="md" variant="outline" class={cn('w-full sm:w-auto', outlineControlClass)} disabled={loading() || deleting()} onClick={props.onClose}>
              {i18n.t('common.actions.cancel')}
            </Button>
            <Show when={props.previewError && props.branch}>
              <Button
                size="md"
                variant="outline"
                class={cn('w-full sm:w-auto', outlineControlClass)}
                disabled={loading() || deleting()}
                onClick={() => props.branch && props.onRetryPreview?.(props.branch)}
              >
                {i18n.t('terminal.retry')}
              </Button>
            </Show>
            <GitDeleteBranchConfirmButton
              label={<StableText reserve={[props.forceConfirmLabel, props.safeConfirmLabel, i18n.t('git.deleteBranchReview.deleting')]}>{confirmLabel()}</StableText>}
              class="w-full sm:w-auto"
              disabled={!canConfirm()}
              disabledReason={loading() ? i18n.t('git.deleteBranchReview.reviewing')
                : showForceDeleteConfirmation() && !review().confirmBranchNameMatches ? i18n.t('git.deleteBranchReview.exactMatchHint')
                  : review().disabledReason}
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
        </>
      )}
      class={cn(
        'git-operation-dialog max-w-none',
        layout.isMobile() ? 'w-[calc(100vw-0.5rem)] max-w-none' : props.dialogDesktopWidthClass,
      )}
    >
      <div class="min-w-0">
        <Show
          when={!loading()}
          fallback={<GitStatePane loading loadingVariant="comparison" loadingRows={4} message={i18n.t('git.deleteBranchReview.reviewing')} surface />}
        >
          <Show when={!props.previewError} fallback={<GitStatePane tone="error" message={props.previewError ?? i18n.t('git.deleteBranchReview.reviewFailed')} surface />}>
            <Show when={props.branch && preview()} fallback={<GitStatePane message={i18n.t('git.deleteBranchReview.chooseBranch')} surface />}>
              <div class="flex min-w-0 flex-col gap-3">
                <Show when={!blockingReason() && !showForceDeleteConfirmation()}>
                  <GitSubtleNote class={props.summaryNoteClass}>{props.safeSummary}</GitSubtleNote>
                </Show>

                <Show when={!preview()?.safeDeleteAllowed && !blockingReason()}>
                  <GitSubtleNote tone="warning">
                    <div>{i18n.t('git.deleteBranchReview.safeDeleteBlocked')}</div>
                    <Show when={preview()?.safeDeleteReason}>
                      <details class="git-review-details">
                        <summary>{i18n.t('git.deleteBranchReview.technicalDetails')}</summary>
                        <p>{preview()?.safeDeleteReason}</p>
                      </details>
                    </Show>
                  </GitSubtleNote>
                </Show>

                <Show when={showForceDeleteConfirmation()}>
                  <GitSubtleNote tone="danger">
                    <div class="space-y-3">
                      <div class="space-y-2">
                        <div data-git-review-heading class="font-semibold text-foreground">{i18n.t('git.deleteBranchReview.forceConsequences')}</div>
                        {props.forceDeleteSummary}
                      </div>
                      <div class="space-y-1.5">
                        <div class="flex flex-wrap items-center gap-1.5">
                          <label for={confirmBranchInputId} id={confirmBranchLabelId} class="min-w-0 font-medium text-foreground">
                            {i18n.t('git.deleteBranchReview.type')}{' '}
                            <code class="break-all font-mono">{requiredBranchName()}</code>{' '}
                            {i18n.t('git.deleteBranchReview.confirmForceDeleteSuffix')}
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            class="shrink-0"
                            disabled={deleting()}
                            aria-label={branchNameCopied() ? i18n.t('git.deleteBranchReview.branchNameCopied') : i18n.t('git.deleteBranchReview.copyBranchName')}
                            title={branchNameCopied() ? i18n.t('git.deleteBranchReview.branchNameCopied') : i18n.t('git.deleteBranchReview.copyBranchName')}
                            onClick={() => void handleCopyBranchName()}
                          >
                            <Show when={branchNameCopied()} fallback={<Copy class="size-3.5" />}>
                              <Check class="size-3.5" />
                            </Show>
                          </Button>
                        </div>
                        <Input
                          id={confirmBranchInputId}
                          type="text"
                          size="md"
                          disabled={deleting()}
                          autocomplete="off"
                          spellcheck={false}
                          value={confirmBranchName()}
                          placeholder={requiredBranchName()}
                          aria-labelledby={confirmBranchLabelId}
                          aria-describedby="git-delete-branch-confirm-hint"
                          onInput={(event) => setConfirmBranchName(event.currentTarget.value)}
                          autofocus
                        />
                        <div id="git-delete-branch-confirm-hint" class="text-[length:var(--floe-type-caption)] leading-relaxed text-muted-foreground">
                          {i18n.t('git.deleteBranchReview.exactMatchHint')}
                        </div>
                      </div>
                    </div>
                  </GitSubtleNote>
                </Show>

                <Show when={showForceDeleteBlockedReason()}>
                  <GitSubtleNote tone="warning">{forceDeleteReason()}</GitSubtleNote>
                </Show>
                <Show when={blockingReason()}>
                  <GitSubtleNote tone="warning">{blockingReason()}</GitSubtleNote>
                </Show>
                <Show when={props.actionError}>
                  <GitSubtleNote tone="warning">{props.actionError}</GitSubtleNote>
                </Show>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </Dialog>
  );
}
