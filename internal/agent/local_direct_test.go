package agent

import (
	"testing"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/session"
)

func TestRegisterLocalDirectChannelStartsUnlockedWhenAccessAlreadyAuthorized(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	a := &Agent{accessGate: gate}

	meta := session.Meta{
		ChannelID:    "ch-local",
		EndpointID:   "env_local",
		FloeApp:      FloeAppRedevenAgent,
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_rpc",
		UserPublicID: "user_local",
	}

	cleanup := a.registerLocalDirectChannel(meta, LocalDirectSessionOptions{AccessUnlocked: true})
	defer cleanup()

	if !gate.IsChannelUnlocked(meta.ChannelID) {
		t.Fatalf("channel %q should start unlocked", meta.ChannelID)
	}

	cleanup()
	if gate.IsChannelUnlocked(meta.ChannelID) {
		t.Fatalf("channel %q should be removed after cleanup", meta.ChannelID)
	}
}
