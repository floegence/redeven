package redevpluginintegration

import (
	"context"
	"errors"
	"io/fs"
	"path/filepath"
	"strings"

	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
)

var (
	errMountPermissionDenied = errors.New("mount permission denied")
)

type workspacePathResolver func(context.Context, string) (string, bool, error)

type fileSystemAdapter struct {
	homePath      string
	sessions      *sessionPermissionCache
	workspacePath workspacePathResolver
}

func newFileSystemAdapter(homePath string, sessions *sessionPermissionCache, workspacePath workspacePathResolver) (*fileSystemAdapter, error) {
	homePath = strings.TrimSpace(homePath)
	if homePath == "" || !filepath.IsAbs(homePath) || filepath.Clean(homePath) != homePath {
		return nil, errors.New("plugin home path must be an absolute canonical path")
	}
	if sessions == nil {
		return nil, errors.New("plugin session cache is required")
	}
	if workspacePath == nil {
		workspacePath = func(context.Context, string) (string, bool, error) { return "", false, nil }
	}
	return &fileSystemAdapter{homePath: homePath, sessions: sessions, workspacePath: workspacePath}, nil
}

func (adapter *fileSystemAdapter) ResolveMount(ctx context.Context, request host.MountRequest) (host.Mount, error) {
	resolved, ok := adapter.resolveSession(request.Session)
	if !ok || !resolved.context.CanRead {
		return host.Mount{}, errMountPermissionDenied
	}
	path, err := adapter.pathForMount(ctx, resolved, request.MountID)
	if err != nil {
		return host.Mount{}, err
	}
	return host.Mount{ID: request.MountID, Path: path, ReadOnly: !resolved.context.CanWrite}, nil
}

func (adapter *fileSystemAdapter) ListMounts(ctx context.Context, request host.MountListRequest) ([]host.Mount, error) {
	resolved, ok := adapter.resolveSession(request.Session)
	if !ok || !resolved.context.CanRead {
		return nil, errMountPermissionDenied
	}
	mounts := make([]host.Mount, 0, 3)
	for _, mountID := range []string{"home", "workspace", "environment"} {
		path, err := adapter.pathForMount(ctx, resolved, mountID)
		if errors.Is(err, host.ErrMountUnavailable) || errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		mounts = append(mounts, host.Mount{ID: mountID, Path: path, ReadOnly: !resolved.context.CanWrite})
	}
	return mounts, nil
}

func (adapter *fileSystemAdapter) resolveSession(session sessionctx.Context) (resolvedSession, bool) {
	if adapter == nil || adapter.sessions == nil || !session.Valid() {
		return resolvedSession{}, false
	}
	return adapter.sessions.Get(session)
}

func (adapter *fileSystemAdapter) pathForMount(ctx context.Context, resolved resolvedSession, mountID string) (string, error) {
	switch strings.TrimSpace(mountID) {
	case "home":
		return adapter.homePath, nil
	case "environment":
		return string(filepath.Separator), nil
	case "workspace":
		if resolved.codeSpaceID == "" || resolved.codeSpaceID == "env-ui" {
			return "", host.ErrMountUnavailable
		}
		path, ok, err := adapter.workspacePath(ctx, resolved.codeSpaceID)
		if err != nil {
			return "", err
		}
		if !ok || strings.TrimSpace(path) == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
			return "", host.ErrMountUnavailable
		}
		return path, nil
	default:
		return "", fs.ErrNotExist
	}
}
