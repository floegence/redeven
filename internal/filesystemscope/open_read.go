package filesystemscope

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// OpenRead opens the canonical authorized path through pinned directory handles.
// A changed path component cannot redirect a read after policy resolution.
func (r *Registry) OpenRead(path string) (*os.File, error) {
	resolved, err := r.Resolve(path, ResolveOptions{RequireExisting: true})
	if err != nil {
		return nil, err
	}
	return r.openResolvedRead(resolved)
}

func (r *Registry) openResolvedRead(resolved ResolvedPath) (*os.File, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	current, err := r.resolveRealLocked(resolved.InputPath, resolved.LogicalAbs, resolved.RealAbs)
	if err != nil {
		return nil, err
	}
	if !current.Permissions.Read {
		return nil, ErrReadDenied
	}
	if current.RootID != resolved.RootID {
		return nil, ErrPathOutsideScope
	}
	policy := r.byID[current.RootID]
	relative, err := filepath.Rel(policy.PathReal, current.RealAbs)
	if err != nil || !filepath.IsLocal(relative) {
		return nil, ErrPathOutsideScope
	}
	volumeRoot := filepath.VolumeName(policy.PathReal) + string(filepath.Separator)
	root, err := os.OpenRoot(volumeRoot)
	if err != nil {
		return nil, err
	}
	defer func() { _ = root.Close() }()
	canonicalRelative, err := filepath.Rel(volumeRoot, current.RealAbs)
	if err != nil || !filepath.IsLocal(canonicalRelative) {
		return nil, ErrPathOutsideScope
	}
	parts := strings.Split(canonicalRelative, string(filepath.Separator))
	for _, part := range parts[:len(parts)-1] {
		info, err := root.Lstat(part)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, ErrPathOutsideScope
		}
		child, err := root.OpenRoot(part)
		if err != nil {
			return nil, err
		}
		opened, err := child.Stat(".")
		if err != nil || !os.SameFile(info, opened) {
			child.Close()
			return nil, errors.New("authorized directory changed while opening")
		}
		root.Close()
		root = child
	}
	name := parts[len(parts)-1]
	info, err := root.Lstat(name)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || (!info.Mode().IsRegular() && !info.IsDir()) {
		return nil, ErrPathOutsideScope
	}
	handle, err := root.Open(name)
	if err != nil {
		return nil, err
	}
	opened, err := handle.Stat()
	if err != nil || !os.SameFile(info, opened) {
		handle.Close()
		return nil, errors.New("authorized file changed while opening")
	}
	return handle, nil
}
