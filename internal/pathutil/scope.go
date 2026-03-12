package pathutil

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CanonicalizeExistingPathAbs returns a clean absolute path for an existing filesystem entry.
func CanonicalizeExistingPathAbs(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("missing path")
	}
	if !filepath.IsAbs(path) {
		abs, err := filepath.Abs(path)
		if err != nil {
			return "", err
		}
		path = abs
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	return filepath.Clean(resolved), nil
}

// CanonicalizeExistingDirAbs returns a clean absolute path for an existing directory.
func CanonicalizeExistingDirAbs(path string) (string, error) {
	resolved, err := CanonicalizeExistingPathAbs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("path must be a directory")
	}
	return resolved, nil
}

// NormalizeUserPathInput expands "~/" against agentHomeAbs and requires an absolute path.
func NormalizeUserPathInput(path string, agentHomeAbs string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("missing path")
	}
	if path == "~" || strings.HasPrefix(path, "~/") {
		agentHomeAbs = strings.TrimSpace(agentHomeAbs)
		if agentHomeAbs == "" {
			return "", errors.New("missing agent home")
		}
		if path == "~" {
			path = agentHomeAbs
		} else {
			path = filepath.Join(agentHomeAbs, strings.TrimPrefix(path, "~/"))
		}
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("path must be absolute")
	}
	return filepath.Clean(path), nil
}

// ResolveExistingScopedPath validates an existing path under agentHomeAbs.
func ResolveExistingScopedPath(path string, agentHomeAbs string) (string, error) {
	normalized, err := NormalizeUserPathInput(path, agentHomeAbs)
	if err != nil {
		return "", err
	}
	resolved, err := CanonicalizeExistingPathAbs(normalized)
	if err != nil {
		return "", err
	}
	return validateWithinScope(resolved, agentHomeAbs)
}

// ResolveExistingScopedDir validates an existing directory under agentHomeAbs.
func ResolveExistingScopedDir(path string, agentHomeAbs string) (string, error) {
	resolved, err := ResolveExistingScopedPath(path, agentHomeAbs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("path must be a directory")
	}
	return resolved, nil
}

// ResolveTargetScopedPath validates a destination path under agentHomeAbs.
//
// The destination itself may not exist yet, so the nearest existing ancestor is
// canonicalized first to prevent symlink escapes.
func ResolveTargetScopedPath(path string, agentHomeAbs string) (string, error) {
	normalized, err := NormalizeUserPathInput(path, agentHomeAbs)
	if err != nil {
		return "", err
	}
	resolved, err := resolvePathViaExistingAncestor(normalized)
	if err != nil {
		return "", err
	}
	return validateWithinScope(resolved, agentHomeAbs)
}

// IsWithinScope reports whether pathAbs stays inside agentHomeAbs.
func IsWithinScope(pathAbs string, agentHomeAbs string) (bool, error) {
	pathAbs = filepath.Clean(strings.TrimSpace(pathAbs))
	agentHomeAbs = filepath.Clean(strings.TrimSpace(agentHomeAbs))
	if pathAbs == "" || agentHomeAbs == "" {
		return false, errors.New("invalid path")
	}
	if !filepath.IsAbs(pathAbs) || !filepath.IsAbs(agentHomeAbs) {
		return false, errors.New("path must be absolute")
	}
	rel, err := filepath.Rel(agentHomeAbs, pathAbs)
	if err != nil {
		return false, err
	}
	rel = filepath.Clean(rel)
	if rel == "." {
		return true, nil
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false, nil
	}
	return true, nil
}

func validateWithinScope(pathAbs string, agentHomeAbs string) (string, error) {
	agentHomeAbs, err := CanonicalizeExistingDirAbs(agentHomeAbs)
	if err != nil {
		return "", err
	}
	ok, err := IsWithinScope(pathAbs, agentHomeAbs)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("path escapes agent home")
	}
	return filepath.Clean(pathAbs), nil
}

func resolvePathViaExistingAncestor(path string) (string, error) {
	path = filepath.Clean(strings.TrimSpace(path))
	if path == "" {
		return "", errors.New("missing path")
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("path must be absolute")
	}

	current := path
	tail := make([]string, 0, 4)
	for {
		if _, err := os.Lstat(current); err == nil {
			resolved, err := filepath.EvalSymlinks(current)
			if err != nil {
				return "", err
			}
			resolved = filepath.Clean(resolved)
			for i := len(tail) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, tail[i])
			}
			return filepath.Clean(resolved), nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}

		parent := filepath.Dir(current)
		if parent == current {
			return "", fmt.Errorf("failed to resolve existing ancestor for %q", path)
		}
		tail = append(tail, filepath.Base(current))
		current = parent
	}
}
