import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';
import { branchDisplayName } from '../utils/gitWorkbench';
import { GitDeleteBranchReviewDialog } from './GitDeleteBranchReviewDialog';
import type { GitDeleteBranchDialogConfirmOptions, GitDeleteBranchDialogState } from './GitDeleteBranchReviewModel';

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
  const branchName = () => branchDisplayName(props.branch);
  const preview = () => props.preview ?? null;

  return (
    <GitDeleteBranchReviewDialog
      open={props.open}
      branch={props.branch}
      preview={props.preview}
      previewError={props.previewError}
      actionError={props.actionError}
      state={props.state}
      description={`Delete ${branchName()} from this repository.`}
      safeConfirmLabel="Delete Branch"
      forceConfirmLabel="Force Delete Branch"
      dialogDesktopWidthClass="w-[min(36rem,94vw)]"
      summaryNoteClass="border-border/55 bg-background/72 text-foreground"
      safeSummary={(
        <div class="space-y-2">
          <div class="text-xs font-semibold text-foreground">This action will:</div>
          <ul class="space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
            <li class="list-disc">
              Delete the local branch reference for <span class="font-medium text-foreground">{branchName()}</span>.
            </li>
            <li class="list-disc">Leave your current worktree and uncommitted files untouched.</li>
          </ul>
        </div>
      )}
      forceDeleteSummary={(
        <ul class="space-y-1.5 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li class="list-disc">
            The local branch reference for <span class="font-medium text-foreground">{branchName()}</span> will be permanently removed.
          </li>
          <li class="list-disc">
            Commits that are only reachable from this branch may become difficult to recover after the branch ref is deleted.
          </li>
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
