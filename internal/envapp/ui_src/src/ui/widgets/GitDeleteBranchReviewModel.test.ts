import { describe, expect, it } from 'vitest';
import { resolveDeleteBranchReview } from './GitDeleteBranchReviewModel';

describe('Git deletion authorization', () => {
  it('blocks removal even when the branch is merged', () => {
    const review = resolveDeleteBranchReview({
      branch: { name: 'feature', kind: 'local' },
      preview: {
        repoRootPath: '/repo', name: 'feature', requiresWorktreeRemoval: true,
        requiresDiscardConfirmation: false, safeDeleteAllowed: true,
        forceDeleteAllowed: false, forceDeleteRequiresConfirm: true,
      },
      blockingReason: 'The primary worktree cannot be removed.',
    });
    expect(review.canConfirm).toBe(false);
    expect(review.disabledReason).toBe('The primary worktree cannot be removed.');
  });
});
