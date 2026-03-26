package gitrepo

import (
	"context"
	"fmt"
	"strings"
)

const maxCheckoutHistoryLookback = 12

func findReattachBranch(ctx context.Context, repoRoot string) *gitBranchSummary {
	for offset := 1; offset <= maxCheckoutHistoryLookback; offset += 1 {
		refExpr := fmt.Sprintf("@{-%d}", offset)
		fullName := strings.TrimSpace(readGitOptional(ctx, repoRoot, "rev-parse", "--symbolic-full-name", refExpr))
		if !strings.HasPrefix(fullName, "refs/heads/") {
			continue
		}
		if !gitRefExists(ctx, repoRoot, fullName) {
			continue
		}
		name := strings.TrimPrefix(fullName, "refs/heads/")
		if strings.TrimSpace(name) == "" {
			continue
		}
		return &gitBranchSummary{
			Name:       name,
			FullName:   fullName,
			Kind:       "local",
			HeadCommit: readGitOptional(ctx, repoRoot, "rev-parse", "--verify", fullName+"^{commit}"),
		}
	}
	return nil
}
