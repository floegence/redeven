package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
	"testing"
)

func TestGatewayObserverClientLifetimeFollowsIdentityNotRequest(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	route := &gatewaycloud.RuntimeConfig{ProtocolVersion: gc.ProtocolVersion, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://sg.cloud.example", NamespacePublicID: "namespace", GatewayPublicID: "gateway", RequestPublicID: gc.CandidateID("gateway", member.MemberID), RuntimePublicID: "runtime", PrivateKeyB64u: base64.RawURLEncoding.EncodeToString(key)}
	a := &Agent{runCtx: t.Context(), cfg: &config.Config{GatewayPublication: route, Gateways: []*gatewaymembership.RuntimeConfig{member}}}
	defer a.closeGatewayStatusClient()
	requestCtx, cancel := context.WithCancel(t.Context())
	first, err := a.acquireGatewayStatusClient(requestCtx, route, member)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if first.ctx.Err() != nil {
		t.Fatal("request cancellation retired identity transport")
	}
	second, err := a.acquireGatewayStatusClient(t.Context(), route, member)
	if err != nil || second != first {
		t.Fatal("stable identity did not reuse transport")
	}
	next := *a.cfg
	next.ControlArtifactPool = config.NewControlArtifactPool(1)
	a.mu.Lock()
	a.setRemoteConfigLocked(&next)
	a.mu.Unlock()
	if a.gatewayStatusClient != first {
		t.Fatal("artifact state changed transport lifetime")
	}
	next.GatewayPublication = route.Clone()
	next.GatewayPublication.Revoked = true
	a.mu.Lock()
	a.setRemoteConfigLocked(&next)
	a.mu.Unlock()
	if first.ctx.Err() == nil || a.gatewayStatusClient != nil {
		t.Fatal("revocation retained old requests")
	}
	third, err := a.acquireGatewayStatusClient(t.Context(), next.GatewayPublication, member)
	if err != nil {
		t.Fatal(err)
	}
	next.Gateways = next.CloneGateways()
	next.Gateways[0].ClientCertificatePEM = "changed-certificate"
	a.mu.Lock()
	a.setRemoteConfigLocked(&next)
	a.mu.Unlock()
	if third.ctx.Err() == nil || a.gatewayStatusClient != nil {
		t.Fatal("certificate change retained old requests")
	}
}
