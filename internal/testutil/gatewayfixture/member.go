// Package gatewayfixture creates real member identities for cross-package tests.
package gatewayfixture

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func New(t testing.TB, origin, listen string) (*gatewaymembership.Store, gatewaymembership.GatewayIdentity) {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	hooks, err := gatewaymembership.NewPolicyHooks(gatewaymembership.HookConfig{})
	if err != nil {
		t.Fatal(err)
	}
	identity := gatewaymembership.GatewayIdentity{ID: "gateway_test", PrivateKey: key}
	store, err := gatewaymembership.NewStore(filepath.Join(t.TempDir(), "members.json"), identity, origin, listen, hooks)
	if err != nil {
		t.Fatal(err)
	}
	return store, identity
}

func Enroll(t testing.TB, store *gatewaymembership.Store, runtimeID string) *gatewaymembership.RuntimeConfig {
	t.Helper()
	invitation, err := store.Invite("desktop_admin")
	if err != nil {
		t.Fatal(err)
	}
	member, err := gatewaymembership.PrepareRuntime(invitation, runtimeID, gp.MemberMetadata{Hostname: runtimeID})
	if err != nil {
		t.Fatal(err)
	}
	response, err := store.Join(context.Background(), *member.PendingJoin)
	if err != nil {
		t.Fatal(err)
	}
	member.MemberVersion, member.ClientCertificatePEM, member.ClientExpiresAtUnixMS = response.MemberVersion, response.ClientCertificatePEM, response.ClientExpiresAtUnixMS
	member.PendingJoin = nil
	if err := member.Validate(runtimeID); err != nil {
		t.Fatal(err)
	}
	return member
}
