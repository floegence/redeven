package accessgate

import (
	"testing"

	"github.com/floegence/redeven-agent/internal/session"
)

func TestGate_UnlockAndResumeReusableToken(t *testing.T) {
	gate := New(Options{Password: "secret"})
	proxyMeta := session.Meta{
		ChannelID:    "ch-proxy",
		EndpointID:   "env_demo",
		FloeApp:      "com.floegence.redeven.agent",
		CodeSpaceID:  "env-ui",
		SessionKind:  "envapp_proxy",
		UserPublicID: "user_demo",
	}
	rpcMeta1 := proxyMeta
	rpcMeta1.ChannelID = "ch-rpc-1"
	rpcMeta1.SessionKind = "envapp_rpc"
	rpcMeta2 := proxyMeta
	rpcMeta2.ChannelID = "ch-rpc-2"
	rpcMeta2.SessionKind = "envapp_rpc"

	gate.RegisterChannel(proxyMeta)
	gate.RegisterChannel(rpcMeta1)
	gate.RegisterChannel(rpcMeta2)

	unlockResult, err := gate.UnlockChannel(proxyMeta.ChannelID, "secret")
	if err != nil {
		t.Fatalf("UnlockChannel() error = %v", err)
	}
	if unlockResult == nil || unlockResult.ResumeToken == "" {
		t.Fatalf("UnlockChannel() resume token missing: %#v", unlockResult)
	}
	if !gate.IsChannelUnlocked(proxyMeta.ChannelID) {
		t.Fatalf("proxy channel should be unlocked")
	}

	if err := gate.ResumeChannel(rpcMeta1.ChannelID, unlockResult.ResumeToken); err != nil {
		t.Fatalf("ResumeChannel(rpc1) error = %v", err)
	}
	if !gate.IsChannelUnlocked(rpcMeta1.ChannelID) {
		t.Fatalf("rpc channel 1 should be unlocked")
	}

	if err := gate.ResumeChannel(rpcMeta2.ChannelID, unlockResult.ResumeToken); err != nil {
		t.Fatalf("ResumeChannel(rpc2) error = %v", err)
	}
	if !gate.IsChannelUnlocked(rpcMeta2.ChannelID) {
		t.Fatalf("rpc channel 2 should be unlocked")
	}
}

func TestGate_LocalSessionLifecycle(t *testing.T) {
	gate := New(Options{Password: "secret"})

	result, err := gate.MintLocalSession("secret")
	if err != nil {
		t.Fatalf("MintLocalSession() error = %v", err)
	}
	if result == nil || result.SessionToken == "" {
		t.Fatalf("MintLocalSession() missing token: %#v", result)
	}
	if !result.Unlocked {
		t.Fatalf("MintLocalSession() should report unlocked: %#v", result)
	}
	if !gate.IsLocalSessionValid(result.SessionToken) {
		t.Fatalf("local session should be valid")
	}

	gate.RevokeLocalSession(result.SessionToken)
	if gate.IsLocalSessionValid(result.SessionToken) {
		t.Fatalf("local session should be revoked")
	}
}

func TestGate_UnlockRejectsWrongPassword(t *testing.T) {
	gate := New(Options{Password: "secret"})
	gate.RegisterChannel(session.Meta{ChannelID: "ch-1"})

	if _, err := gate.UnlockChannel("ch-1", "wrong"); err == nil {
		t.Fatalf("UnlockChannel() expected error for wrong password")
	}
}
