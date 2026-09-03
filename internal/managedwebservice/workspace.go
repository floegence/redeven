package managedwebservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/floegence/redeven/internal/filesystemscope"
	pfregistry "github.com/floegence/redeven/internal/portforward/registry"
)

const (
	workspaceOwnershipPending        = "pending"
	workspaceOwnershipRedevenCreated = "redeven_created"
	workspaceOwnershipUserSelected   = "user_selected"
)

// resolveInstallWorkspace validates a workspace choice without creating it.
// Catalog and request validation stay read-only; the install worker owns the
// only directory-creation transition.
func (m *Manager) resolveInstallWorkspace(path string) (filesystemscope.ResolvedPath, string, error) {
	path = strings.TrimSpace(path)
	if path == "" || !filepath.IsAbs(path) {
		return filesystemscope.ResolvedPath{}, "", serviceError("WORKSPACE_UNAVAILABLE", "Select an absolute workspace directory inside a writable Environment root.", 400, false, nil)
	}
	resolved, err := m.scope.ResolveTarget(path, filesystemscope.ResolveOptions{ForWrite: true})
	if err != nil {
		return filesystemscope.ResolvedPath{}, "", serviceError("WORKSPACE_UNAVAILABLE", "The workspace directory is not writable or is outside this Environment's allowed roots.", 400, false, err)
	}
	info, statErr := os.Stat(resolved.LogicalAbs)
	switch {
	case statErr == nil:
		if !info.IsDir() {
			return filesystemscope.ResolvedPath{}, "", serviceError("WORKSPACE_UNAVAILABLE", "The selected workspace path is not a directory.", 400, false, nil)
		}
		existing, resolveErr := m.scope.Resolve(resolved.LogicalAbs, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true, ForWrite: true})
		if resolveErr != nil {
			return filesystemscope.ResolvedPath{}, "", serviceError("WORKSPACE_UNAVAILABLE", "The workspace directory is not writable or is outside this Environment's allowed roots.", 400, false, resolveErr)
		}
		return existing, workspaceOwnershipUserSelected, nil
	case errors.Is(statErr, os.ErrNotExist):
		return resolved, workspaceOwnershipPending, nil
	default:
		return filesystemscope.ResolvedPath{}, "", serviceError("WORKSPACE_UNAVAILABLE", "The workspace directory cannot be inspected.", 400, false, statErr)
	}
}

func (m *Manager) ensureInstallWorkspace(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil {
		return serviceError("WORKSPACE_CREATE_FAILED", "The workspace directory could not be prepared.", 500, true, nil)
	}
	path := filepath.Clean(strings.TrimSpace(service.WorkspacePath))
	if path == "" || !filepath.IsAbs(path) {
		return serviceError("WORKSPACE_CREATE_FAILED", "The workspace directory could not be prepared.", 409, false, nil)
	}

	ownership := strings.TrimSpace(service.WorkspaceOwnership)
	if ownership != workspaceOwnershipPending && ownership != workspaceOwnershipRedevenCreated && ownership != workspaceOwnershipUserSelected {
		return serviceError("WORKSPACE_CREATE_FAILED", "The saved workspace ownership is invalid.", 409, false, nil)
	}

	created := false
	if ownership == workspaceOwnershipPending {
		if info, err := os.Lstat(path); err == nil {
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return serviceError("WORKSPACE_CREATE_FAILED", "The workspace path was occupied before deployment began.", 409, false, nil)
			}
			ownership = workspaceOwnershipUserSelected
		} else if !errors.Is(err, os.ErrNotExist) {
			return serviceError("WORKSPACE_CREATE_FAILED", "The workspace directory could not be inspected.", 500, true, err)
		} else {
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				return serviceError("WORKSPACE_CREATE_FAILED", "The workspace directory could not be created.", 500, true, err)
			}
			if err := os.Mkdir(path, 0o700); err == nil {
				created = true
				ownership = workspaceOwnershipRedevenCreated
			} else if errors.Is(err, os.ErrExist) {
				ownership = workspaceOwnershipUserSelected
			} else {
				return serviceError("WORKSPACE_CREATE_FAILED", "The workspace directory could not be created.", 500, true, err)
			}
		}
	}

	resolved, err := m.scope.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true, ForWrite: true})
	if err != nil || filepath.Clean(resolved.RealAbs) != path {
		if created {
			_ = os.Remove(path)
		}
		return serviceError("WORKSPACE_CREATE_FAILED", "The workspace identity changed while deployment was starting.", 409, true, err)
	}
	if ownership != service.WorkspaceOwnership {
		if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{WorkspaceOwnership: &ownership}); err != nil {
			if created {
				_ = os.Remove(path)
			}
			return serviceError("WORKSPACE_CREATE_FAILED", "The workspace ownership could not be saved.", 500, true, err)
		}
		service.WorkspaceOwnership = ownership
	}
	return nil
}

func (m *Manager) deleteServiceWorkspace(ctx context.Context, service pfregistry.ManagedService) error {
	path := filepath.Clean(strings.TrimSpace(service.WorkspacePath))
	if path == "" || !filepath.IsAbs(path) {
		return serviceError("WORKSPACE_DELETE_UNSAFE", "The saved workspace path is not safe to delete.", 409, false, nil)
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return serviceError("WORKSPACE_DELETE_FAILED", "The workspace directory could not be inspected before deletion.", 500, true, err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return serviceError("WORKSPACE_DELETE_UNSAFE", "The saved workspace path is not a regular directory.", 409, false, nil)
	}
	resolved, err := m.scope.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true, ForWrite: true})
	if err != nil || filepath.Clean(resolved.RealAbs) != path {
		return serviceError("WORKSPACE_DELETE_UNSAFE", "The workspace identity changed and was not deleted.", 409, false, err)
	}
	if m.workspaceDeletionIsBroad(path) {
		return serviceError("WORKSPACE_DELETE_UNSAFE", "The selected workspace is a protected root and was not deleted.", 409, false, nil)
	}
	services, err := m.registry.ListManagedServices(ctx)
	if err != nil {
		return serviceError("WORKSPACE_DELETE_FAILED", "Other managed-service workspaces could not be checked.", 500, true, err)
	}
	for _, other := range services {
		if other.ServiceID == service.ServiceID {
			continue
		}
		if pathsOverlap(path, other.WorkspacePath) {
			return serviceError("WORKSPACE_IN_USE", "Another managed Web Service uses this workspace or a directory inside it.", 409, false, nil)
		}
	}
	if err := os.RemoveAll(path); err != nil {
		return serviceError("WORKSPACE_DELETE_FAILED", "The workspace directory could not be deleted.", 500, true, err)
	}
	if _, err := os.Lstat(path); err == nil || !errors.Is(err, os.ErrNotExist) {
		return serviceError("WORKSPACE_DELETE_FAILED", "The workspace directory still exists after deletion.", 500, true, err)
	}
	return nil
}

func (m *Manager) workspaceDeletionIsBroad(path string) bool {
	path = filepath.Clean(path)
	volumeRoot := filepath.Clean(filepath.VolumeName(path) + string(os.PathSeparator))
	if path == volumeRoot || pathsOverlap(path, m.stateDir) {
		return true
	}
	context := m.scope.PathContext()
	if path == filepath.Clean(context.HomePathAbs) {
		return true
	}
	for _, root := range context.Roots {
		if path == filepath.Clean(root.PathAbs) || path == filepath.Clean(root.PathReal) {
			return true
		}
	}
	return false
}

func pathsOverlap(left, right string) bool {
	left, right = filepath.Clean(strings.TrimSpace(left)), filepath.Clean(strings.TrimSpace(right))
	if left == "" || right == "" {
		return false
	}
	return left == right || isParentPath(left, right) || isParentPath(right, left)
}

func isParentPath(parent, child string) bool {
	rel, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(child))
	if err != nil {
		return false
	}
	rel = filepath.Clean(rel)
	return rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
