import type {
  GitPreviewApplyStashResponse,
  GitPreviewDropStashResponse,
  GitRepoSummaryResponse,
  GitStashSummary,
} from '../protocol/redeven_v1';

export type GitStashReviewContext = {
  repoRootPath: string;
  headRef?: string;
  headCommit?: string;
  stashId: string;
  stashHeadCommit?: string;
};

export type GitStashReviewState =
  | {
    kind: 'apply';
    removeAfterApply: boolean;
    preview: GitPreviewApplyStashResponse;
    reviewContext: GitStashReviewContext;
  }
  | {
    kind: 'drop';
    preview: GitPreviewDropStashResponse;
    reviewContext: GitStashReviewContext;
  };

type GitStashReviewTarget = {
  repoRootPath?: string | null;
  repoSummary?: Pick<GitRepoSummaryResponse, 'headRef' | 'headCommit'> | null;
  stash?: Pick<GitStashSummary, 'id' | 'headCommit'> | null;
};

function normalizeValue(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function buildGitStashReviewContext(
  repoRootPath: string,
  headRef: string | null | undefined,
  headCommit: string | null | undefined,
  stash: Pick<GitStashSummary, 'id' | 'headCommit'> | null | undefined,
): GitStashReviewContext {
  return {
    repoRootPath: normalizeValue(repoRootPath),
    headRef: normalizeValue(headRef) || undefined,
    headCommit: normalizeValue(headCommit) || undefined,
    stashId: normalizeValue(stash?.id),
    stashHeadCommit: normalizeValue(stash?.headCommit) || undefined,
  };
}

export function buildGitStashReviewContextFromApplyPreview(preview: GitPreviewApplyStashResponse): GitStashReviewContext {
  return buildGitStashReviewContext(preview.repoRootPath, preview.headRef, preview.headCommit, preview.stash);
}

export function buildGitStashReviewContextFromDropPreview(preview: GitPreviewDropStashResponse): GitStashReviewContext {
  return buildGitStashReviewContext(preview.repoRootPath, preview.headRef, preview.headCommit, preview.stash);
}

function valuesConflict(expected: string | null | undefined, current: string | null | undefined): boolean {
  const normalizedExpected = normalizeValue(expected);
  const normalizedCurrent = normalizeValue(current);
  return Boolean(normalizedExpected && normalizedCurrent && normalizedExpected !== normalizedCurrent);
}

export function stashReviewMatchesTarget(review: GitStashReviewState | null | undefined, target: GitStashReviewTarget): boolean {
  const reviewContext = review?.reviewContext;
  const repoRootPath = normalizeValue(target.repoRootPath);
  const stashId = normalizeValue(target.stash?.id);
  if (!reviewContext || !repoRootPath || !stashId) return false;
  if (repoRootPath !== normalizeValue(reviewContext.repoRootPath)) return false;
  if (stashId !== normalizeValue(reviewContext.stashId)) return false;
  if (valuesConflict(reviewContext.headRef, target.repoSummary?.headRef)) return false;
  if (valuesConflict(reviewContext.headCommit, target.repoSummary?.headCommit)) return false;
  if (valuesConflict(reviewContext.stashHeadCommit, target.stash?.headCommit)) return false;
  return true;
}
