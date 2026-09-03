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

type workspacePreparationMode uint8

const (
	workspaceAllowMissing workspacePreparationMode = iota
	workspaceVerifyExisting
	workspaceCreateIfMissing
)

type workspacePreparation struct {
	resolved filesystemscope.ResolvedPath
	created  bool
	exists   bool
}

// resolveInstallWorkspace validates a workspace choice without creating it.
// Catalog and request validation stay read-only; the install worker owns the
// only directory-creation transition.
func (m *Manager) resolveInstallWorkspace(path string) (filesystemscope.ResolvedPath, string, error) {
	prepared, err := m.prepareWorkspace(path, workspaceAllowMissing)
	if err != nil {
		return filesystemscope.ResolvedPath{}, "", err
	}
	if prepared.exists {
		return prepared.resolved, workspaceOwnershipUserSelected, nil
	}
	return prepared.resolved, workspaceOwnershipPending, nil
}

func (m *Manager) ensureInstallWorkspace(ctx context.Context, service *pfregistry.ManagedService) error {
	if service == nil {
		return serviceError("WORKSPACE_CREATE_FAILED", "The workspace directory could not be prepared.", 500, true, nil)
	}
	ownership := strings.TrimSpace(service.WorkspaceOwnership)
	if ownership != workspaceOwnershipPending && ownership != workspaceOwnershipRedevenCreated && ownership != workspaceOwnershipUserSelected {
		return serviceError("WORKSPACE_CREATE_FAILED", "The saved workspace ownership is invalid.", 409, false, nil)
	}
	prepared, err := m.prepareWorkspace(service.WorkspacePath, workspaceCreateIfMissing)
	if err != nil {
		return err
	}
	if ownership == workspaceOwnershipPending {
		if prepared.created {
			ownership = workspaceOwnershipRedevenCreated
		} else {
			ownership = workspaceOwnershipUserSelected
		}
	}
	if ownership != service.WorkspaceOwnership {
		if err := m.registry.UpdateManagedService(ctx, service.ServiceID, pfregistry.ManagedServicePatch{WorkspaceOwnership: &ownership}); err != nil {
			if prepared.created {
				_ = os.Remove(filepath.Clean(strings.TrimSpace(service.WorkspacePath)))
			}
			return serviceError("WORKSPACE_CREATE_FAILED", "The workspace ownership could not be saved.", 500, true, err)
		}
		service.WorkspaceOwnership = ownership
	}
	return nil
}

func (m *Manager) prepareWorkspace(rawPath string, mode workspacePreparationMode) (workspacePreparation, error) {
	path := filepath.Clean(strings.TrimSpace(rawPath))
	invalidStatus := 409
	if mode == workspaceAllowMissing {
		invalidStatus = 400
	}
	if path == "." || !filepath.IsAbs(path) {
		return workspacePreparation{}, serviceError("WORKSPACE_UNAVAILABLE", "The saved workspace path is invalid.", invalidStatus, false, nil)
	}
	resolvedTarget, err := m.scope.ResolveTarget(path, filesystemscope.ResolveOptions{ForWrite: true})
	if err != nil || filepath.Clean(resolvedTarget.RealAbs) != path {
		return workspacePreparation{}, serviceError("WORKSPACE_UNAVAILABLE", "The saved workspace is outside this Environment's writable roots or its identity changed.", invalidStatus, false, err)
	}

	created := false
	info, statErr := os.Lstat(path)
	switch {
	case statErr == nil:
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return workspacePreparation{}, serviceError("WORKSPACE_UNAVAILABLE", "The saved workspace path is not a regular directory.", invalidStatus, false, nil)
		}
	case errors.Is(statErr, os.ErrNotExist):
		if mode == workspaceAllowMissing {
			return workspacePreparation{resolved: resolvedTarget}, nil
		}
		if mode == workspaceVerifyExisting {
			return workspacePreparation{}, serviceError("WORKSPACE_MISSING", "The saved workspace directory is missing.", 409, true, statErr)
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return workspacePreparation{}, serviceError("WORKSPACE_CREATE_FAILED", "The workspace directory could not be created.", 500, true, err)
		}
		if err := os.Mkdir(path, 0o700); err == nil {
			created = true
		} else if !errors.Is(err, os.ErrExist) {
			return workspacePreparation{}, serviceError("WORKSPACE_CREATE_FAILED", "The workspace directory could not be created.", 500, true, err)
		}
	default:
		return workspacePreparation{}, serviceError("WORKSPACE_UNAVAILABLE", "The saved workspace directory could not be inspected.", invalidStatus, true, statErr)
	}

	resolved, err := m.scope.Resolve(path, filesystemscope.ResolveOptions{RequireExisting: true, RequireDir: true, ForWrite: true})
	if err != nil || filepath.Clean(resolved.RealAbs) != path {
		if created {
			_ = os.Remove(path)
		}
		return workspacePreparation{}, serviceError("WORKSPACE_UNAVAILABLE", "The saved workspace is unavailable or its identity changed.", invalidStatus, true, err)
	}
	return workspacePreparation{resolved: resolved, created: created, exists: true}, nil
}

func (m *Manager) startRuntime(ctx context.Context, service *pfregistry.ManagedService, driver deploymentDriver) (string, error) {
	if service == nil {
		return "", serviceError("WORKSPACE_UNAVAILABLE", "The saved workspace directory is unavailable.", 409, false, nil)
	}
	if _, err := m.prepareWorkspace(service.WorkspacePath, workspaceVerifyExisting); err != nil {
		return "", err
	}
	return driver.Start(ctx, service)
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
