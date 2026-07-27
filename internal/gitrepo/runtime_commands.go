package gitrepo

import (
	"context"
	"errors"

	"github.com/floegence/redeven/internal/gitruntime"
)

func (s *Service) runGitRead(ctx context.Context, repoRoot string, args ...string) ([]byte, error) {
	return s.runGitReadAllowExitCodes(ctx, repoRoot, nil, args...)
}

func (s *Service) runGitReadAllowExitCodes(ctx context.Context, repoRoot string, allowedExitCodes []int, args ...string) ([]byte, error) {
	result, err := s.runtime.RunRead(ctx, repoRoot, nil, args...)
	if err == nil {
		return result.Stdout, nil
	}
	var commandErr *gitruntime.CommandError
	if errors.As(err, &commandErr) && !commandErr.UnknownOutcome && !commandErr.BudgetExceeded {
		for _, allowed := range allowedExitCodes {
			if commandErr.ExitCode == allowed {
				return result.Stdout, nil
			}
		}
	}
	return nil, err
}
