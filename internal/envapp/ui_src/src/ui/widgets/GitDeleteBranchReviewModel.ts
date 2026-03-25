import type { GitBranchSummary, GitPreviewDeleteBranchResponse } from '../protocol/redeven_v1';

export type GitDeleteBranchDialogState = 'idle' | 'previewing' | 'deleting';
export type GitDeleteBranchMode = 'safe' | 'force';

export interface GitDeleteBranchDialogConfirmOptions {
  deleteMode: GitDeleteBranchMode;
  confirmBranchName?: string;
  removeLinkedWorktree: boolean;
  discardLinkedWorktreeChanges: boolean;
  planFingerprint?: string;
}

export interface ResolveDeleteBranchReviewOptions {
  branch?: GitBranchSummary | null;
  preview?: GitPreviewDeleteBranchResponse | null;
  previewError?: string;
  loading?: boolean;
  deleting?: boolean;
  blockingReason?: string;
  confirmBranchName?: string;
}

export interface GitDeleteBranchReviewState {
  canConfirm: boolean;
  confirmMode: GitDeleteBranchMode;
  disabledReason: string;
  forceDeleteAllowed: boolean;
  forceDeleteRequiresConfirm: boolean;
  expectedBranchName: string;
  confirmBranchNameMatches: boolean;
}

export const DELETE_REVIEW_LOADING_REASON = 'Reviewing branch deletion...';
export const DELETE_REVIEW_MISSING_REASON = 'Choose a branch to review its deletion plan.';
export const SAFE_DELETE_BLOCKED_REASON = 'Safe delete is blocked.';
export const FORCE_DELETE_CONFIRM_REASON = 'Type the exact branch name to enable force delete.';

export function trimDeleteBranchReason(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

export function expectedDeleteBranchName(
  branch?: GitBranchSummary | null,
  preview?: GitPreviewDeleteBranchResponse | null,
): string {
  return trimDeleteBranchReason(preview?.name) || trimDeleteBranchReason(branch?.name);
}

export function isExactDeleteBranchNameMatch(expectedName: string, providedName: string): boolean {
  if (!expectedName) return false;
  return trimDeleteBranchReason(providedName) === expectedName;
}

export function resolveDeleteBranchReview(options: ResolveDeleteBranchReviewOptions): GitDeleteBranchReviewState {
  if (options.deleting) {
    return {
      canConfirm: false,
      confirmMode: 'safe',
      disabledReason: '',
      forceDeleteAllowed: false,
      forceDeleteRequiresConfirm: false,
      expectedBranchName: '',
      confirmBranchNameMatches: false,
    };
  }

  if (options.loading) {
    return {
      canConfirm: false,
      confirmMode: 'safe',
      disabledReason: DELETE_REVIEW_LOADING_REASON,
      forceDeleteAllowed: false,
      forceDeleteRequiresConfirm: false,
      expectedBranchName: '',
      confirmBranchNameMatches: false,
    };
  }

  const previewError = trimDeleteBranchReason(options.previewError);
  if (previewError) {
    return {
      canConfirm: false,
      confirmMode: 'safe',
      disabledReason: previewError,
      forceDeleteAllowed: false,
      forceDeleteRequiresConfirm: false,
      expectedBranchName: '',
      confirmBranchNameMatches: false,
    };
  }

  const preview = options.preview ?? null;
  if (!options.branch || !preview) {
    return {
      canConfirm: false,
      confirmMode: 'safe',
      disabledReason: DELETE_REVIEW_MISSING_REASON,
      forceDeleteAllowed: false,
      forceDeleteRequiresConfirm: false,
      expectedBranchName: '',
      confirmBranchNameMatches: false,
    };
  }

  const blockingReason = trimDeleteBranchReason(options.blockingReason);
  const expectedBranchNameValue = expectedDeleteBranchName(options.branch, preview);
  const forceDeleteRequiresConfirm = Boolean(preview.forceDeleteRequiresConfirm);
  const confirmBranchNameMatches = forceDeleteRequiresConfirm
    ? isExactDeleteBranchNameMatch(expectedBranchNameValue, options.confirmBranchName ?? '')
    : true;

  if (preview.safeDeleteAllowed) {
    return {
      canConfirm: true,
      confirmMode: 'safe',
      disabledReason: '',
      forceDeleteAllowed: Boolean(preview.forceDeleteAllowed),
      forceDeleteRequiresConfirm,
      expectedBranchName: expectedBranchNameValue,
      confirmBranchNameMatches,
    };
  }

  if (blockingReason) {
    return {
      canConfirm: false,
      confirmMode: 'force',
      disabledReason: blockingReason,
      forceDeleteAllowed: false,
      forceDeleteRequiresConfirm,
      expectedBranchName: expectedBranchNameValue,
      confirmBranchNameMatches,
    };
  }

  if (!preview.forceDeleteAllowed) {
    return {
      canConfirm: false,
      confirmMode: 'force',
      disabledReason: trimDeleteBranchReason(preview.forceDeleteReason) || trimDeleteBranchReason(preview.safeDeleteReason) || SAFE_DELETE_BLOCKED_REASON,
      forceDeleteAllowed: false,
      forceDeleteRequiresConfirm,
      expectedBranchName: expectedBranchNameValue,
      confirmBranchNameMatches,
    };
  }

  if (!confirmBranchNameMatches) {
    const confirmReason = expectedBranchNameValue
      ? `Type ${expectedBranchNameValue} to enable force delete.`
      : FORCE_DELETE_CONFIRM_REASON;
    return {
      canConfirm: false,
      confirmMode: 'force',
      disabledReason: confirmReason,
      forceDeleteAllowed: true,
      forceDeleteRequiresConfirm,
      expectedBranchName: expectedBranchNameValue,
      confirmBranchNameMatches,
    };
  }

  return {
    canConfirm: true,
    confirmMode: 'force',
    disabledReason: '',
    forceDeleteAllowed: true,
    forceDeleteRequiresConfirm,
    expectedBranchName: expectedBranchNameValue,
    confirmBranchNameMatches,
  };
}
