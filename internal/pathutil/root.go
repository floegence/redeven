package pathutil

import (
	"errors"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// ResolvedPath represents a virtual path mapped into the agent root.
type ResolvedPath struct {
	Virtual string
	Real    string
}

// ResolveVirtualPath maps a POSIX-like virtual path into an absolute path inside root.
func ResolveVirtualPath(root string, virtualPath string) (ResolvedPath, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "" {
		return ResolvedPath{}, errors.New("empty root")
	}

	virtualPath = strings.TrimSpace(virtualPath)
	if virtualPath == "" {
		virtualPath = "/"
	}
	virtualPath = strings.ReplaceAll(virtualPath, "\\", "/")
	if !strings.HasPrefix(virtualPath, "/") {
		virtualPath = "/" + virtualPath
	}

	normalizedVirtual := path.Clean(virtualPath)
	if normalizedVirtual == "." {
		normalizedVirtual = "/"
	}
	if !strings.HasPrefix(normalizedVirtual, "/") {
		normalizedVirtual = "/" + normalizedVirtual
	}

	rel := strings.TrimPrefix(normalizedVirtual, "/")
	relOS := filepath.FromSlash(rel)
	if relOS != "" && filepath.IsAbs(relOS) {
		return ResolvedPath{}, errors.New("invalid absolute path")
	}

	abs := filepath.Clean(filepath.Join(root, relOS))
	ok, err := IsWithinRoot(abs, root)
	if err != nil {
		return ResolvedPath{}, err
	}
	if !ok {
		return ResolvedPath{}, errors.New("path escapes root")
	}

	return ResolvedPath{Virtual: normalizedVirtual, Real: abs}, nil
}

// RealPathToVirtual converts an absolute path inside root back to a virtual POSIX path.
func RealPathToVirtual(root string, absPath string) (string, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	absPath = filepath.Clean(strings.TrimSpace(absPath))
	if root == "" || absPath == "" {
		return "", errors.New("invalid path")
	}
	ok, err := IsWithinRoot(absPath, root)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("path escapes root")
	}
	if absPath == root {
		return "/", nil
	}
	rel, err := filepath.Rel(root, absPath)
	if err != nil {
		return "", err
	}
	rel = filepath.Clean(rel)
	if rel == "." || rel == "" {
		return "/", nil
	}
	return "/" + filepath.ToSlash(rel), nil
}

// IsWithinRoot reports whether absPath stays within root.
func IsWithinRoot(absPath string, root string) (bool, error) {
	absPath = filepath.Clean(strings.TrimSpace(absPath))
	root = filepath.Clean(strings.TrimSpace(root))
	if absPath == "" || root == "" {
		return false, errors.New("invalid path")
	}
	rel, err := filepath.Rel(root, absPath)
	if err != nil {
		return false, err
	}
	rel = filepath.Clean(rel)
	if rel == "." {
		return true, nil
	}
	if rel == ".." {
		return false, nil
	}
	if strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return false, nil
	}
	return true, nil
}
