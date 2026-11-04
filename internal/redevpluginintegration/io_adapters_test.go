package redevpluginintegration

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/floegence/redevplugin/v3/pkg/connectivity"
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

func TestPrivateNetworkRequiresEffectiveAdministratorAndExplicitPrefixes(t *testing.T) {
	full := sessionPermissions{read: true, write: true, execute: true, admin: true}
	for _, tc := range []struct {
		name     string
		perms    sessionPermissions
		prefixes []string
		host     string
		unknown  bool
		allowed  bool
	}{
		{"approved loopback", full, []string{"127.0.0.1/32"}, "127.0.0.1", false, true},
		{"approved private subnet", full, []string{"192.168.1.0/24"}, "192.168.1.2", false, true},
		{"no explicit prefix", full, nil, "127.0.0.1", false, false},
		{"wrong endpoint", full, []string{"127.0.0.1/32"}, "127.0.0.2", false, false},
		{"metadata denied", full, []string{"169.254.169.254/32"}, "169.254.169.254", false, false},
		{"global prefix denied", full, []string{"0.0.0.0/0"}, "127.0.0.1", false, false},
		{"unknown session", full, []string{"127.0.0.1/32"}, "127.0.0.1", true, false},
		{"read only", sessionPermissions{read: true}, []string{"127.0.0.1/32"}, "127.0.0.1", false, false},
		{"not administrator", sessionPermissions{read: true, write: true, execute: true}, []string{"127.0.0.1/32"}, "127.0.0.1", false, false},
		{"execution capped", sessionPermissions{read: true, write: true, admin: true}, []string{"127.0.0.1/32"}, "127.0.0.1", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sessions := newSessionPermissionCache()
			session := ioTestSessionContext(true, true)
			sessions.Put(resolvedSession{context: session, permissions: tc.perms})
			if tc.unknown {
				session.OwnerSessionHash = "unknown"
			}
			err := newNetworkPolicyAdapter(sessions).AuthorizePrivateNetwork(context.Background(), host.PrivateNetworkRequest{Session: session, Destination: connectivity.Destination{Transport: "http", Scheme: "http", Host: tc.host, Port: 8080}, PrivatePrefixes: tc.prefixes})
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%t error=%v", tc.allowed, err)
			}
		})
	}
}
func TestConnectionManagementPermissionTiers(t *testing.T) {
	for _, action := range []host.ManagementAction{host.ManagementActionReviewConnection, host.ManagementActionApproveConnection, host.ManagementActionCancelConnectionReview, host.ManagementActionRevokeConnection} {
		if !permissionsAllowAction(sessionPermissions{read: true, write: true, execute: true, admin: true}, action) {
			t.Fatalf("denied full administrator %s", action)
		}
		for _, p := range []sessionPermissions{{}, {read: true}, {read: true, write: true, execute: true}, {admin: true}, {read: true, write: true, admin: true}, {read: true, execute: true, admin: true}, {write: true, execute: true, admin: true}} {
			if permissionsAllowAction(p, action) {
				t.Fatalf("allowed partial permissions %+v for %s", p, action)
			}
		}
	}
	if !permissionsAllowAction(sessionPermissions{read: true}, host.ManagementActionListConnections) || permissionsAllowAction(sessionPermissions{admin: true}, host.ManagementActionListConnections) {
		t.Fatal("connection inventory must require read")
	}
}
