package gitrepo

import (
	"context"
	"errors"
	"strings"

	"github.com/floegence/redeven/internal/gitutil"
)

type gitCommitDiffMode string

const (
	gitCommitDiffModePlain       gitCommitDiffMode = "plain"
	gitCommitDiffModeFirstParent gitCommitDiffMode = "first_parent"
)

type gitCommitDiffPresentation struct {
	Mode        gitCommitDiffMode `json:"mode,omitempty"`
	MergeCommit bool              `json:"merge_commit,omitempty"`
	ParentCount int               `json:"parent_count,omitempty"`
}

func buildCommitDiffPresentation(detail gitCommitDetail) gitCommitDiffPresentation {
	parentCount := 0
	for _, parent := range detail.Parents {
		if strings.TrimSpace(parent) == "" {
			continue
		}
		parentCount += 1
	}
	presentation := gitCommitDiffPresentation{
		Mode:        gitCommitDiffModePlain,
		MergeCommit: parentCount > 1,
		ParentCount: parentCount,
	}
	if parentCount > 1 {
		presentation.Mode = gitCommitDiffModeFirstParent
	}
	return presentation
}

func (s *Service) readCommitDiffPresentation(ctx context.Context, repoRoot string, commit string) (gitCommitDiffPresentation, error) {
	commit = strings.TrimSpace(commit)
	if commit == "" {
		return gitCommitDiffPresentation{}, errors.New("missing commit")
	}
	out, err := gitutil.RunCombinedOutput(ctx, repoRoot, nil, "show", "-s", "--format=%P", commit)
	if err != nil {
		return gitCommitDiffPresentation{}, err
	}
	return buildCommitDiffPresentation(gitCommitDetail{Parents: strings.Fields(strings.TrimSpace(string(out)))}), nil
}

func appendCommitDiffMergeArgs(args []string, presentation gitCommitDiffPresentation) []string {
	if presentation.Mode == gitCommitDiffModeFirstParent {
		return append(args, "--diff-merges=first-parent")
	}
	return args
}

func buildCommitDiffMetadataArgs(commit string, presentation gitCommitDiffPresentation) ([]string, []string) {
	nameStatusArgs := []string{
		"show",
		"--format=",
		"--name-status",
		"-z",
		"--find-renames",
		"--find-copies",
		"--no-ext-diff",
		"--root",
	}
	nameStatusArgs = appendCommitDiffMergeArgs(nameStatusArgs, presentation)
	nameStatusArgs = append(nameStatusArgs, commit)

	numstatArgs := []string{
		"show",
		"--format=",
		"--numstat",
		"-z",
		"--find-renames",
		"--find-copies",
		"--no-ext-diff",
		"--root",
	}
	numstatArgs = appendCommitDiffMergeArgs(numstatArgs, presentation)
	numstatArgs = append(numstatArgs, commit)
	return nameStatusArgs, numstatArgs
}

func buildCommitDiffPatchArgs(commit string, pathspecs []string, unifiedArg string, presentation gitCommitDiffPresentation) []string {
	args := []string{
		"show",
		"--format=",
		"--patch",
		"--find-renames",
		"--find-copies",
		"--no-ext-diff",
		"--binary",
		"--root",
	}
	args = appendCommitDiffMergeArgs(args, presentation)
	if unifiedArg != "" {
		args = append(args, unifiedArg)
	}
	args = append(args, commit)
	if len(pathspecs) > 0 {
		args = append(args, "--")
		args = append(args, pathspecs...)
	}
	return args
}
