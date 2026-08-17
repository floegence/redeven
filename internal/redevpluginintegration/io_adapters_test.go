package redevpluginintegration

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redevplugin/v3/pkg/host"
	"github.com/floegence/redevplugin/v3/pkg/sessionctx"
)

func TestFileSystemAdapterMapsAuthenticatedSessionMounts(t *testing.T) {
	home := t.TempDir()
	workspace := t.TempDir()
	sessions := newSessionPermissionCache()
	sessionContext := ioTestSessionContext(true, true)
	sessions.Put(resolvedSession{
		context:     sessionContext,
		permissions: sessionPermissions{read: true, write: true},
		codeSpaceID: "space_1",
	})
	adapter, err := newFileSystemAdapter(home, sessions, func(_ context.Context, codeSpaceID string) (string, bool, error) {
		if codeSpaceID != "space_1" {
			t.Fatalf("workspace lookup code space = %q, want space_1", codeSpaceID)
		}
		return workspace, true, nil
	})
	if err != nil {
		t.Fatalf("newFileSystemAdapter() error = %v", err)
	}

	for _, test := range []struct {
		mountID string
		path    string
	}{
		{mountID: "home", path: home},
		{mountID: "workspace", path: workspace},
		{mountID: "environment", path: string(filepath.Separator)},
	} {
		mount, err := adapter.ResolveMount(context.Background(), host.MountRequest{
			Session: sessionContext,
			Plugin:  host.PluginRef{PluginID: "com.example.io", PluginInstanceID: "plugini_io"},
			MountID: test.mountID,
		})
		if err != nil {
			t.Fatalf("ResolveMount(%q) error = %v", test.mountID, err)
		}
		if mount.ID != test.mountID || mount.Path != filepath.Clean(test.path) || mount.ReadOnly {
			t.Fatalf("ResolveMount(%q) = %+v", test.mountID, mount)
		}
	}
}

func TestFileSystemAdapterDoesNotInventEnvUIWorkspace(t *testing.T) {
	sessions := newSessionPermissionCache()
	sessionContext := ioTestSessionContext(true, true)
	sessions.Put(resolvedSession{
		context:     sessionContext,
		permissions: sessionPermissions{read: true, write: true},
		codeSpaceID: "env-ui",
	})
	lookupCalled := false
	adapter, err := newFileSystemAdapter(t.TempDir(), sessions, func(context.Context, string) (string, bool, error) {
		lookupCalled = true
		return "", false, nil
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = adapter.ResolveMount(context.Background(), host.MountRequest{
		Session: sessionContext,
		Plugin:  host.PluginRef{PluginID: "com.example.io", PluginInstanceID: "plugini_io"},
		MountID: "workspace",
	})
	if !errors.Is(err, host.ErrMountUnavailable) {
		t.Fatalf("ResolveMount(workspace) error = %v, want MOUNT_UNAVAILABLE", err)
	}
	if lookupCalled {
		t.Fatal("Env App synthetic code space reached workspace registry")
	}
}

func TestFileSystemAdapterKeepsSessionReadWriteCeilings(t *testing.T) {
	home := t.TempDir()
	sessions := newSessionPermissionCache()
	sessionContext := ioTestSessionContext(true, false)
	sessions.Put(resolvedSession{
		context:     sessionContext,
		permissions: sessionPermissions{read: true},
		codeSpaceID: "env-ui",
	})
	adapter, err := newFileSystemAdapter(home, sessions, func(context.Context, string) (string, bool, error) {
		return "", false, nil
	})
	if err != nil {
		t.Fatal(err)
	}

	mount, err := adapter.ResolveMount(context.Background(), host.MountRequest{
		Session: sessionContext,
		Plugin:  host.PluginRef{PluginID: "com.example.io", PluginInstanceID: "plugini_io"},
		MountID: "home",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !mount.ReadOnly {
		t.Fatalf("read-only session received writable mount: %+v", mount)
	}

	unauthenticated := ioTestSessionContext(false, false)
	if _, err := adapter.ListMounts(context.Background(), host.MountListRequest{Session: unauthenticated}); !errors.Is(err, errMountPermissionDenied) {
		t.Fatalf("ListMounts() error = %v, want permission denied", err)
	}
}

func TestNetworkPolicyAdapterUsesAuthenticatedSessionBoundary(t *testing.T) {
	sessions := newSessionPermissionCache()
	sessionContext := ioTestSessionContext(true, true)
	sessions.Put(resolvedSession{context: sessionContext, permissions: sessionPermissions{read: true, write: true}})
	adapter := newNetworkPolicyAdapter(sessions)

	err := adapter.AuthorizeNetwork(context.Background(), host.NetworkAuthorizationRequest{
		Session:     sessionContext,
		Plugin:      host.PluginRef{PluginID: "com.example.io", PluginInstanceID: "plugini_io"},
		Operation:   "net.http.fetch",
		Destination: host.NetworkDestination{Transport: "http", Scheme: "https", Host: "example.com", Port: 443, URL: "https://example.com/data"},
	})
	if err != nil {
		t.Fatalf("AuthorizeNetwork() error = %v", err)
	}

	unknown := ioTestSessionContext(true, true)
	unknown.OwnerSessionHash = "session_unknown"
	if err := adapter.AuthorizeNetwork(context.Background(), host.NetworkAuthorizationRequest{Session: unknown}); !errors.Is(err, errNetworkPolicyDenied) {
		t.Fatalf("unknown session error = %v, want policy denied", err)
	}
}

func TestIOModuleWiresOnlyReleasedHostAdapters(t *testing.T) {
	sessions := newSessionPermissionCache()
	module, err := newIOModule(t.TempDir(), sessions, func(context.Context, string) (string, bool, error) {
		return "", false, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if module == nil || module.FileSystem == nil || module.NetworkPolicy == nil {
		t.Fatalf("I/O module is incomplete: %+v", module)
	}
	var _ host.FileSystemAdapter = module.FileSystem
	var _ host.NetworkPolicyAdapter = module.NetworkPolicy
}

func ioTestSessionContext(canRead, canWrite bool) sessionctx.Context {
	return sessionctx.Context{
		OwnerSessionHash:     "session_io",
		OwnerUserHash:        "user_io",
		OwnerEnvHash:         "env_io",
		SessionChannelIDHash: "channel_io",
		CanRead:              canRead,
		CanWrite:             canWrite,
	}
}
