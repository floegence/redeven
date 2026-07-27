package gitrepo

import (
	"errors"
	"path"
	"sort"
	"strings"
)

func normalizeGitPathspec(pathValue string) (string, error) {
	if pathValue == "" {
		return "", nil
	}
	if strings.IndexByte(pathValue, 0) >= 0 {
		return "", errors.New("invalid git path")
	}
	cleaned := path.Clean(pathValue)
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
		leftRank := workspaceEntrySortRank(items[i])
		rightRank := workspaceEntrySortRank(items[j])
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		left := workspaceChangeBrowsePath(items[i])
		right := workspaceChangeBrowsePath(items[j])
		if left != right {
			return left < right
		}
		if items[i].Section != items[j].Section {
			return workspaceSectionRank(items[i].Section) < workspaceSectionRank(items[j].Section)
		}
		if items[i].ChangeType != items[j].ChangeType {
			return items[i].ChangeType < items[j].ChangeType
		}
		if items[i].OldPath != items[j].OldPath {
			return items[i].OldPath < items[j].OldPath
		}
		return items[i].NewPath < items[j].NewPath
	})
}

func workspaceSectionRank(section string) int {
	switch section {
	case "unstaged":
		return 0
	case "untracked":
		return 1
	case "conflicted":
		return 2
	case "staged":
		return 3
	default:
		return 4
	}
}

func workspaceEntrySortRank(item gitWorkspaceChange) int {
	if strings.TrimSpace(item.EntryKind) == "directory" {
		return 0
	}
	return 1
}
