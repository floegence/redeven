package redevpluginintegration

import (
	"context"
	"errors"
	"testing"

	processruntime "github.com/floegence/redevplugin/v3/pkg/process"
)

func TestProcessOwnerAuthorizationUsesAuthenticatedSessionScope(t *testing.T) {
	sessions := newSessionPermissionCache()
	sessions.Put(resolvedSession{context: ioTestSessionContext(true, true)})
	adapter := &sessionAdapter{resolver: &sessionResolver{cache: sessions}}
	owner := processruntime.Owner{
		PluginInstanceID: "plugin_process",
		UserScope:        "user_io",
		EnvironmentScope: "env_io",
	}
	if err := adapter.authorizeProcessOwner(context.Background(), owner); err != nil {
		t.Fatalf("authorized owner rejected: %v", err)
	}

	unknown := owner
	unknown.UserScope = "user_other"
	if err := adapter.authorizeProcessOwner(context.Background(), unknown); !errors.Is(err, processruntime.ErrPermissionDenied) {
		t.Fatalf("unknown owner error = %v, want permission denied", err)
	}

	foreignEnvironment := owner
	foreignEnvironment.EnvironmentScope = "env_other"
	if err := adapter.authorizeProcessOwner(context.Background(), foreignEnvironment); !errors.Is(err, processruntime.ErrPermissionDenied) {
		t.Fatalf("foreign environment error = %v, want permission denied", err)
	}
}

func TestProcessOwnerAuthorizationAllowsOnlyValidatedBackgroundScope(t *testing.T) {
	sessions := newSessionPermissionCache()
	adapter := &sessionAdapter{resolver: &sessionResolver{cache: sessions}}
	owner := processruntime.Owner{
		PluginInstanceID: "plugin_process",
		UserScope:        backgroundUserScope,
		EnvironmentScope: "env_background",
	}
	if err := adapter.authorizeProcessOwner(context.Background(), owner); err != nil {
		t.Fatalf("background owner rejected: %v", err)
	}

	invalid := owner
	invalid.PluginInstanceID = ""
	if err := adapter.authorizeProcessOwner(context.Background(), invalid); !errors.Is(err, processruntime.ErrPermissionDenied) {
		t.Fatalf("invalid background owner error = %v, want permission denied", err)
	}
}
