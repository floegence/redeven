import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { GitBranchSummary, GitPreviewDeleteBranchResponse, GitWorkspaceSummary } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import { GitDeleteBranchReviewDialog } from './GitDeleteBranchReviewDialog';
import { type GitDeleteBranchDialogConfirmOptions, type GitDeleteBranchDialogState } from './GitDeleteBranchReviewModel';

export type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchReviewModel';

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
  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;
  const linkedWorktree = () => preview()?.linkedWorktree;
  const requiresWorktreeRemoval = () => Boolean(preview()?.requiresWorktreeRemoval);
  const linkedWorktreePath = () => linkedWorktree()?.worktreePath || 'the linked worktree path';
  const worktreeAccessible = () => Boolean(linkedWorktree()?.accessible);
  const pendingChangeSummary = () => formatPendingSummary(linkedWorktree()?.summary);

  const changeImpact = () => {
    if (!requiresWorktreeRemoval()) return 'No worktree or uncommitted files will be removed.';
    if (!worktreeAccessible()) return 'The agent cannot inspect uncommitted changes in that worktree from here.';
    if (!pendingChangeSummary()) return 'No uncommitted files are currently detected in that worktree.';
    return `Uncommitted changes in that worktree will be discarded (${pendingChangeSummary()}).`;
  };

  return (
    <GitDeleteBranchReviewDialog
      open={props.open}
      branch={props.branch}
      preview={props.preview}
      previewError={props.previewError}
      actionError={props.actionError}
      state={props.state}
      description={`Delete ${branchName()} and its linked worktree.`}
      safeConfirmLabel="Delete Branch and Worktree"
      forceConfirmLabel="Force Delete Branch and Worktree"
      dialogDesktopWidthClass="w-[min(34rem,94vw)]"
      summaryNoteClass={cn('text-foreground', requiresWorktreeRemoval() ? 'border-error/20 bg-error/10' : 'border-border/55 bg-background/72')}
      safeSummary={(
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
      )}
      forceDeleteSummary={(
        <ul class="space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li class="list-disc">
            The local branch reference for <span class="font-medium text-foreground">{branchName()}</span> will be permanently removed.
          </li>
          <li class="list-disc">
            The linked worktree at <span class="break-all font-medium text-foreground">{linkedWorktreePath()}</span> will be removed.
          </li>
          <li class="list-disc">{changeImpact()}</li>
          <li class="list-disc">
            Your current repository worktree at <span class="break-all font-medium text-foreground">{preview()?.repoRootPath || 'the current repository root'}</span> will not be modified.
          </li>
        </ul>
      )}
      onClose={props.onClose}
      onRetryPreview={props.onRetryPreview}
      onConfirm={props.onConfirm}
    />
  );
}
