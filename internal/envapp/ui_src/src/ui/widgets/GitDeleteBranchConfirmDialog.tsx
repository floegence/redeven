import { Show } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchDialog';
import { GitLabelBlock, GitMetaPill, GitPrimaryTitle, GitStatePane, GitSubtleNote } from './GitWorkbenchPrimitives';

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
  const canConfirm = () => Boolean(
    props.open
    && props.branch
    && preview()
    && !loading()
    && !deleting()
    && preview()?.safeDeleteAllowed
    && !blockingReason()
  );

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title="Delete Branch"
      description="Confirm the local branch deletion after reviewing the safe delete status."
      footer={(
        <div class="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" disabled={loading() || deleting()} onClick={props.onClose}>
            Cancel
          </Button>
          <Show when={props.previewError && props.branch}>
            <Button size="sm" variant="outline" disabled={loading() || deleting()} onClick={() => props.branch && props.onRetryPreview?.(props.branch)}>
              Retry Review
            </Button>
          </Show>
          <Button
            size="sm"
            variant="destructive"
            disabled={!canConfirm()}
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
          >
            Delete Branch
          </Button>
        </div>
      )}
      class={cn(
        'flex max-w-none flex-col overflow-hidden rounded-md p-0',
        '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
        '[&>div:last-child]:min-h-0 [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col [&>div:last-child]:!overflow-hidden [&>div:last-child]:!p-0',
        layout.isMobile() ? 'w-[calc(100vw-0.5rem)] max-w-none' : 'w-[min(32rem,94vw)]',
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
                <section class="rounded-md border border-border/70 bg-card px-3 py-2.5 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]">
                  <GitLabelBlock label="Branch" tone={preview()?.safeDeleteAllowed ? 'neutral' : 'warning'}>
                    <div class="flex flex-wrap items-center gap-2.5">
                      <GitPrimaryTitle>{branchName()}</GitPrimaryTitle>
                      <Show when={preview()?.safeDeleteBaseRef}>
                        <GitMetaPill tone={preview()?.safeDeleteAllowed ? 'success' : 'warning'}>
                          Delete base {preview()?.safeDeleteBaseRef}
                        </GitMetaPill>
                      </Show>
                    </div>
                    <div class="text-[11px] leading-relaxed text-muted-foreground">
                      Git will use safe delete semantics and refuse the action if this branch is not fully merged.
                    </div>
                  </GitLabelBlock>
                </section>

                <div class="space-y-3 rounded-md border border-border/65 bg-card px-3 py-2.5">
                  <div class="text-xs font-medium text-foreground">Delete Safety</div>
                  <Show
                    when={preview()?.safeDeleteAllowed}
                    fallback={<GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{preview()?.safeDeleteReason || 'Safe delete is blocked.'}</GitSubtleNote>}
                  >
                    <GitSubtleNote class="border-success/25 bg-success/10 text-success-foreground">
                      Safe delete is ready. Git can remove this branch with `git branch -d`.
                    </GitSubtleNote>
                  </Show>
                  <Show when={blockingReason()}>
                    <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{blockingReason()}</GitSubtleNote>
                  </Show>
                  <Show when={props.actionError}>
                    <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.actionError}</GitSubtleNote>
                  </Show>
                </div>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </Dialog>
  );
}
