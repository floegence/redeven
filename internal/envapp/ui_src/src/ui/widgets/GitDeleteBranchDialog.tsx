import { Show } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse, GitWorkspaceSummary } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import { GitStatePane, GitSubtleNote } from './GitWorkbenchPrimitives';

export type GitDeleteBranchDialogState = 'idle' | 'previewing' | 'deleting';

export interface GitDeleteBranchDialogConfirmOptions {
  removeLinkedWorktree: boolean;
  discardLinkedWorktreeChanges: boolean;
  planFingerprint?: string;
}

export interface GitDeleteBranchDialogProps {
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

function formatPendingSummary(summary: GitWorkspaceSummary | null | undefined): string {
  const staged = Number(summary?.stagedCount ?? 0);
  const unstaged = Number(summary?.unstagedCount ?? 0);
  const untracked = Number(summary?.untrackedCount ?? 0);
  const conflicted = Number(summary?.conflictedCount ?? 0);

  const items: string[] = [];
  if (staged > 0) items.push(`${staged} staged`);
  if (unstaged > 0) items.push(`${unstaged} unstaged`);
  if (untracked > 0) items.push(`${untracked} untracked`);
  if (conflicted > 0) items.push(`${conflicted} conflicted`);

  if (items.length <= 0) return '';
  return items.join(' · ');
}

export function GitDeleteBranchDialog(props: GitDeleteBranchDialogProps) {
  const layout = useLayout();

  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;
  const linkedWorktree = () => preview()?.linkedWorktree;
  const blockingReason = () => String(preview()?.blockingReason ?? '').trim();
  const state = () => props.state ?? 'idle';
  const loading = () => state() === 'previewing';
  const deleting = () => state() === 'deleting';
  const requiresWorktreeRemoval = () => Boolean(preview()?.requiresWorktreeRemoval);
  const linkedWorktreePath = () => linkedWorktree()?.worktreePath || 'the linked worktree path';
  const worktreeAccessible = () => Boolean(linkedWorktree()?.accessible);
  const pendingChangeSummary = () => formatPendingSummary(linkedWorktree()?.summary);

  const canConfirm = () => {
    return Boolean(
      props.open
      && props.branch
      && preview()
      && !loading()
      && !deleting()
      && preview()?.safeDeleteAllowed
      && !blockingReason(),
    );
  };

  const confirmLabel = () => {
    if (deleting()) return 'Deleting...';
    return requiresWorktreeRemoval() ? 'Delete Branch and Worktree' : 'Delete Branch';
  };

  const changeImpact = () => {
    if (!requiresWorktreeRemoval()) return 'No worktree or uncommitted files will be removed.';
    if (!worktreeAccessible()) return 'The agent cannot inspect uncommitted changes in that worktree from here.';
    if (!pendingChangeSummary()) return 'No uncommitted files are currently detected in that worktree.';
    return `Uncommitted changes in that worktree will be discarded (${pendingChangeSummary()}).`;
  };

  const dialogWidthClass = () => {
    if (layout.isMobile()) return 'w-[calc(100vw-0.5rem)] max-w-none';
    return 'w-[min(34rem,94vw)]';
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title="Delete Branch"
      description={requiresWorktreeRemoval()
        ? `Delete ${branchName()} and its linked worktree.`
        : `Delete ${branchName()} from this repository.`}
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
                  removeLinkedWorktree: Boolean(currentPreview.requiresWorktreeRemoval),
                  discardLinkedWorktreeChanges: Boolean(currentPreview.requiresDiscardConfirmation),
                  planFingerprint: currentPreview.planFingerprint,
                });
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
        dialogWidthClass(),
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
                <GitSubtleNote class={cn('text-foreground', requiresWorktreeRemoval() ? 'border-error/20 bg-error/10' : 'border-border/55 bg-background/72')}>
                  <div class="space-y-2">
                    <div class="text-xs font-semibold text-foreground">This action will:</div>
                    <ul class="space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                      <li class="list-disc">
                        Delete the local branch reference for <span class="font-medium text-foreground">{branchName()}</span>.
                      </li>
                      <Show when={requiresWorktreeRemoval()}>
                        <li class="list-disc">
                          Remove the linked worktree at <span class="break-all font-medium text-foreground">{linkedWorktreePath()}</span>.
                        </li>
                      </Show>
                      <li class="list-disc">{changeImpact()}</li>
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
