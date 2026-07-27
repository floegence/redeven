import { describe, expect, it } from 'vitest';

import {
  buildGitStashReviewContextFromApplyPreview,
  stashReviewMatchesTarget,
  type GitStashReviewState,
} from './gitStashReview';

describe('gitStashReview', () => {
  it('preserves the exact repository root in review context', () => {
    const reviewContext = buildGitStashReviewContextFromApplyPreview({
      repoRootPath: '/workspace/repo ',
      headRef: 'main',
      headCommit: 'abc123',
      stash: { id: 'stash@{0}', headCommit: 'def456' },
      planFingerprint: 'plan-1',
    });

    expect(reviewContext.repoRootPath).toBe('/workspace/repo ');
  });

  it('fails closed when repository roots differ only by trailing whitespace', () => {
    const review: GitStashReviewState = {
      kind: 'apply',
      removeAfterApply: false,
      preview: {
        repoRootPath: '/workspace/repo ',
        headRef: 'main',
        headCommit: 'abc123',
        stash: { id: 'stash@{0}', headCommit: 'def456' },
        planFingerprint: 'plan-1',
      },
      reviewContext: {
        repoRootPath: '/workspace/repo ',
        headRef: 'main',
        headCommit: 'abc123',
        stashId: 'stash@{0}',
        stashHeadCommit: 'def456',
      },
    };

    expect(stashReviewMatchesTarget(review, {
      repoRootPath: '/workspace/repo',
      repoSummary: { headRef: 'main', headCommit: 'abc123' },
      stash: { id: 'stash@{0}', headCommit: 'def456' },
    })).toBe(false);
    expect(stashReviewMatchesTarget(review, {
      repoRootPath: '/workspace/repo ',
      repoSummary: { headRef: 'main', headCommit: 'abc123' },
      stash: { id: 'stash@{0}', headCommit: 'def456' },
    })).toBe(true);
  });
});
