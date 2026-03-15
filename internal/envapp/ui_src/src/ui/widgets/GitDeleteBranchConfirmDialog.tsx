import { Show } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Shield, Trash } from '@floegence/floe-webapp-core/icons';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchDialog';
import { GitLabelBlock, GitMetaPill, GitPrimaryTitle, GitSection, GitStatePane, GitStatStrip, GitSubtleNote } from './GitWorkbenchPrimitives';

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
    && !blockingReason(),
  );

  const deleteStatusValue = () => {
    if (!preview()?.safeDeleteAllowed || blockingReason()) return <span class="text-warning">Blocked</span>;
    return <span class="text-success">Ready to delete</span>;
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title="Delete Branch"
      description="Confirm the local branch deletion after reviewing the safe delete status."
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
                Retry Review
              </Button>
            </Show>
            <Button
              size="sm"
              variant="destructive"
              class="w-full sm:w-auto"
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
                <GitSection
                  label="Delete Plan"
                  tone={preview()?.safeDeleteAllowed ? 'neutral' : 'warning'}
                  description="This flow removes only the local branch reference. Your current working tree stays intact."
                  aside={<GitMetaPill tone={preview()?.safeDeleteAllowed ? 'success' : 'warning'}>{preview()?.safeDeleteAllowed ? 'Safe delete ready' : 'Review blocked'}</GitMetaPill>}
                  class="border-border/70 shadow-sm shadow-black/5 ring-1 ring-black/[0.02]"
                  bodyClass="space-y-3"
                >
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
                      Git will refuse the delete if this branch is not fully merged into the selected base reference.
                    </div>
                  </GitLabelBlock>

                  <GitStatStrip
                    columnsClass="grid-cols-1 gap-1 sm:grid-cols-3"
                    items={[
                      { label: 'Branch', value: branchName() },
                      { label: 'Scope', value: 'Local branch only' },
                      { label: 'Delete status', value: deleteStatusValue() },
                    ]}
                  />
                </GitSection>

                <GitSection
                  label="Delete Safety"
                  tone={preview()?.safeDeleteAllowed && !blockingReason() ? 'success' : 'warning'}
                  description={preview()?.safeDeleteAllowed && !blockingReason()
                    ? 'The branch passed Git safe delete checks and can be removed.'
                    : 'Git safe delete has not cleared yet, so the action remains unavailable.'}
                  aside={(
                    <div class="inline-flex items-center gap-1.5">
                      <Shield class="h-3.5 w-3.5 shrink-0" />
                      <span>{preview()?.safeDeleteAllowed && !blockingReason() ? 'Ready' : 'Blocked'}</span>
                    </div>
                  )}
                  bodyClass="space-y-3"
                >
                  <Show
                    when={preview()?.safeDeleteAllowed}
                    fallback={<GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{preview()?.safeDeleteReason || 'Safe delete is blocked.'}</GitSubtleNote>}
                  >
                    <GitSubtleNote class="border-success/30 bg-success/14 text-foreground">
                      <div class="flex items-start gap-2">
                        <Shield class="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                        <div class="space-y-1">
                          <div class="text-[11px] font-semibold text-success">Safe delete ready</div>
                          <div class="text-[11px] leading-relaxed text-muted-foreground">
                            Git can remove this branch with `git branch -d`.
                          </div>
                        </div>
                      </div>
                    </GitSubtleNote>
                  </Show>
                  <Show when={blockingReason()}>
                    <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{blockingReason()}</GitSubtleNote>
                  </Show>
                  <Show when={props.actionError}>
                    <GitSubtleNote class="border-warning/25 bg-warning/10 text-warning-foreground">{props.actionError}</GitSubtleNote>
                  </Show>
                </GitSection>

                <div class="rounded-lg border border-error/20 bg-error/5 px-3 py-3">
                  <div class="flex items-start gap-3">
                    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-error/20 bg-background/75 text-error">
                      <Trash class="h-3.5 w-3.5" />
                    </div>
                    <div class="space-y-1">
                      <div class="text-xs font-semibold text-foreground">Final action</div>
                      <div class="text-[11px] leading-relaxed text-muted-foreground">
                        Confirming this dialog deletes the local branch reference only. No linked worktree cleanup or file discard is involved.
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
  );
}
