import { Show } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchDialog';
import { GitDeleteBranchConfirmButton, resolveDeleteBranchConfirmDisabledReason } from './GitDeleteBranchConfirmButton';
import { GitStatePane, GitSubtleNote } from './GitWorkbenchPrimitives';

export interface GitDeleteBranchConfirmDialogProps {
  open: boolean;
  branch?: GitBranchSummary | null;
  preview?: GitPreviewDeleteBranchResponse | null;
  previewError?: string;
  actionError?: string;
  state?: GitDeleteBranchDialogState;
  onClose: () => void;
  onRetryPreview?: (branch: GitBranchSummary) => void;
  onConfirm?: (branch: GitBranchSummary, options: GitDeleteBranchDialogConfirmOptions) => void;
}

export function GitDeleteBranchConfirmDialog(props: GitDeleteBranchConfirmDialogProps) {
  const layout = useLayout();

  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;
  const blockingReason = () => String(preview()?.blockingReason ?? '').trim();
  const state = () => props.state ?? 'idle';
  const loading = () => state() === 'previewing';
  const deleting = () => state() === 'deleting';
  const confirmDisabledReason = () => resolveDeleteBranchConfirmDisabledReason({
    branch: props.branch,
    preview: preview(),
    previewError: props.previewError,
    loading: loading(),
    deleting: deleting(),
    blockingReason: blockingReason(),
  });
  const canConfirm = () => Boolean(
    props.open
    && props.branch
    && preview()
    && !loading()
    && !deleting()
    && preview()?.safeDeleteAllowed
    && !blockingReason(),
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title="Delete Branch"
      description={`Delete ${branchName()} from this repository.`}
      footer={(
        <div class="border-t border-border/60 bg-background/88 px-4 pt-3 pb-4 backdrop-blur supports-[backdrop-filter]:bg-background/78">
          <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button size="sm" variant="outline" class="w-full sm:w-auto" disabled={loading() || deleting()} onClick={props.onClose}>
              Cancel
            </Button>
            <Show when={props.previewError && props.branch}>
              <Button
                size="sm"
                variant="outline"
                class="w-full sm:w-auto"
                disabled={loading() || deleting()}
                onClick={() => props.branch && props.onRetryPreview?.(props.branch)}
              >
                Retry
              </Button>
            </Show>
            <GitDeleteBranchConfirmButton
              label="Delete Branch"
              class="w-full sm:w-auto"
              disabled={!canConfirm()}
              disabledReason={confirmDisabledReason()}
              loading={deleting()}
              onClick={() => {
                const branch = props.branch;
                const currentPreview = preview();
                if (!branch || !currentPreview) return;
                props.onConfirm?.(branch, {
                  removeLinkedWorktree: false,
                  discardLinkedWorktreeChanges: false,
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
        layout.isMobile() ? 'w-[calc(100vw-0.5rem)] max-w-none' : 'w-[min(36rem,94vw)]',
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
                <GitSubtleNote class="border-border/55 bg-background/72 text-foreground">
                  <div class="space-y-2">
                    <div class="text-xs font-semibold text-foreground">This action will:</div>
                    <ul class="space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                      <li class="list-disc">
                        Delete the local branch reference for <span class="font-medium text-foreground">{branchName()}</span>.
                      </li>
                      <li class="list-disc">Leave your current worktree and uncommitted files untouched.</li>
                    </ul>
                  </div>
                </GitSubtleNote>

                <Show when={!preview()?.safeDeleteAllowed}>
                  <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">
                    {preview()?.safeDeleteReason || 'Safe delete is blocked.'}
                  </GitSubtleNote>
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
