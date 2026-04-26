import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';
import { GitDeleteBranchDialog } from './GitDeleteBranchDialog';
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
  return (
    <GitDeleteBranchDialog
      open={props.open}
      branch={props.branch}
      preview={props.preview}
      previewError={props.previewError}
      actionError={props.actionError}
      state={props.state}
      worktreeMode={false}
      onClose={props.onClose}
      onRetryPreview={props.onRetryPreview}
      onConfirm={props.onConfirm}
    />
  );
}
