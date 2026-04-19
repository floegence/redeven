package gitrepo

import (
	"errors"
	"path"
	"sort"
	"strings"
)

func normalizeGitPathspec(pathValue string) (string, error) {
	item := strings.TrimSpace(strings.ReplaceAll(pathValue, "\\", "/"))
	if item == "" {
		return "", nil
	}
	cleaned := path.Clean(item)
	switch {
	case cleaned == ".":
		return "", nil
	case strings.HasPrefix(cleaned, "/"):
		return "", errors.New("invalid git path")
	case cleaned == "..":
		return "", errors.New("invalid git path")
	case strings.HasPrefix(cleaned, "../"):
		return "", errors.New("invalid git path")
	}
	return cleaned, nil
}

func normalizeGitDirectoryPath(pathValue string) (string, error) {
	cleaned, err := normalizeGitPathspec(pathValue)
	if err != nil {
		return "", err
	}
	return cleaned, nil
}

func normalizeGitPathspecs(paths []string) ([]string, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(paths))
	out := make([]string, 0, len(paths))
	for _, raw := range paths {
		cleaned, err := normalizeGitPathspec(raw)
		if err != nil {
			return nil, err
		}
		if cleaned == "" {
			continue
		}
		if _, ok := seen[cleaned]; ok {
			continue
		}
		seen[cleaned] = struct{}{}
		out = append(out, cleaned)
	}
	return out, nil
}

func workspacePathOrEmpty(pathValue string) string {
	cleaned, err := normalizeGitPathspec(pathValue)
	if err != nil {
		return ""
	}
	return cleaned
}

func workspaceChangeBrowsePath(change gitWorkspaceChange) string {
	for _, candidate := range []string{
		change.DisplayPath,
		change.Path,
		change.NewPath,
		change.OldPath,
	} {
		if cleaned := workspacePathOrEmpty(candidate); cleaned != "" {
			return cleaned
		}
	}
	return ""
}

func workspaceChangePathCandidates(change gitWorkspaceChange) []string {
	values := make([]string, 0, len(change.MutationPaths)+3)
	values = append(values, change.MutationPaths...)
	values = append(values, change.Path, change.NewPath, change.OldPath)
	out, err := normalizeGitPathspecs(values)
	if err != nil {
		return nil
	}
	return out
}

func workspaceChangeParentPath(change gitWorkspaceChange) string {
	browsePath := workspaceChangeBrowsePath(change)
	if browsePath == "" {
		return ""
	}
	parent := path.Dir(browsePath)
	if parent == "." || parent == browsePath {
		return ""
	}
	return parent
}

func workspacePathWithinDirectory(candidate string, directory string) bool {
	candidate = workspacePathOrEmpty(candidate)
	if candidate == "" {
		return false
	}
	directory = workspacePathOrEmpty(directory)
	if directory == "" {
		return true
	}
	return candidate == directory || strings.HasPrefix(candidate, directory+"/")
}

func workspaceImmediateChildPath(candidate string, directory string) string {
	candidate = workspacePathOrEmpty(candidate)
	directory = workspacePathOrEmpty(directory)
	if candidate == "" || !workspacePathWithinDirectory(candidate, directory) {
		return ""
	}
	remainder := candidate
	if directory != "" {
		if candidate == directory {
			return directory
		}
		remainder = strings.TrimPrefix(candidate, directory+"/")
	}
	if remainder == "" {
		return directory
	}
	segment := remainder
	if slash := strings.Index(segment, "/"); slash >= 0 {
		segment = segment[:slash]
	}
	if directory == "" {
		return segment
	}
	return directory + "/" + segment
}

func workspaceCanonicalMatchSet(paths []string) map[string]struct{} {
	if len(paths) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(paths))
	for _, item := range paths {
		if cleaned := workspacePathOrEmpty(item); cleaned != "" {
			out[cleaned] = struct{}{}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func sortWorkspaceChanges(items []gitWorkspaceChange) {
	sort.Slice(items, func(i int, j int) bool {
		left := workspaceChangeBrowsePath(items[i])
		right := workspaceChangeBrowsePath(items[j])
		if left == right {
			return workspaceEntrySortRank(items[i]) < workspaceEntrySortRank(items[j])
		}
		leftRank := workspaceEntrySortRank(items[i])
		rightRank := workspaceEntrySortRank(items[j])
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		return left < right
	})
}

func workspaceEntrySortRank(item gitWorkspaceChange) int {
	if strings.TrimSpace(item.EntryKind) == "directory" {
		return 0
	}
	return 1
}
