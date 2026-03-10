package gitrepo

import (
	"context"
	"errors"
	"path"
	"strings"

	"github.com/floegence/redeven-agent/internal/gitutil"
)

func normalizeGitPathspecs(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, raw := range paths {
		item := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
		if item == "" {
			continue
		}
		cleaned := path.Clean(item)
		switch {
		case cleaned == ".":
			continue
		case strings.HasPrefix(cleaned, "/"):
			return nil, errors.New("invalid git path")
		case cleaned == "..":
			return nil, errors.New("invalid git path")
		case strings.HasPrefix(cleaned, "../"):
			return nil, errors.New("invalid git path")
		}
		if _, ok := seen[cleaned]; ok {
			continue
		}
		seen[cleaned] = struct{}{}
		out = append(out, cleaned)
	}
	return out, nil
}

func (s *Service) stageWorkspacePaths(ctx context.Context, repo repoContext, paths []string) error {
	pathspecs, err := normalizeGitPathspecs(paths)
	if err != nil {
		return err
	}
	args := []string{"add", "-A"}
	if len(pathspecs) > 0 {
		args = append(args, "--")
		args = append(args, pathspecs...)
	}
	_, err = gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...)
	return err
}

func (s *Service) unstageWorkspacePaths(ctx context.Context, repo repoContext, paths []string) error {
	if strings.TrimSpace(repo.headCommit) == "" {
		return errors.New("cannot unstage before the first commit")
	}
	pathspecs, err := normalizeGitPathspecs(paths)
	if err != nil {
		return err
	}
	args := []string{"reset", "--quiet", "--"}
	if len(pathspecs) == 0 {
		args = append(args, ".")
	} else {
		args = append(args, pathspecs...)
	}
	_, err = gitutil.RunCombinedOutput(ctx, repo.repoRootReal, nil, args...)
	return err
}

func (s *Service) commitWorkspace(ctx context.Context, repo repoContext, message string) (*commitWorkspaceResp, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return nil, errors.New("commit message is required")
	}
	status, err := s.readWorkspaceStatus(ctx, repo.repoRootReal)
	if err != nil {
		return nil, err
	}
	if len(status.Staged) == 0 {
		return nil, errors.New("no staged changes to commit")
	}
	_, err = gitutil.RunCombinedOutput(ctx, repo.repoRootReal, []string{"GIT_EDITOR=:"}, "commit", "--message", message, "--cleanup=strip")
	if err != nil {
		return nil, err
	}
	updatedRepo, err := s.loadRepoContext(ctx, repo.repoRootReal, repo.repoRootVirtual)
	if err != nil {
		return nil, err
	}
	return &commitWorkspaceResp{
		RepoRootPath: updatedRepo.repoRootVirtual,
		HeadRef:      updatedRepo.headRef,
		HeadCommit:   updatedRepo.headCommit,
	}, nil
}
