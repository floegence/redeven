package agent

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
)

func TestGatewayReapprovalAdoptsOnlySamePathAndRetiresOldCredentials(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	requestID := gc.CandidateID("gateway", member.MemberID)
	binding := gc.Binding{MemberID: member.MemberID, MemberVersion: member.MemberVersion, PublicID: "binding", EnvPublicID: "env", GatewayPublicID: "gateway", NamespacePublicID: "namespace", RuntimePublicID: "runtime", Region: "sg", Generation: 1, State: "active"}
	a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{Gateway: member, LocalEnvironmentPublicID: member.RuntimePublicID, BindingGeneration: 1, ControlArtifactPool: config.NewControlArtifactPool(1), GatewayPublication: &gatewaycloud.RuntimeConfig{MemberID: member.MemberID, MemberVersion: member.MemberVersion, RequestPublicID: requestID, GatewayPublicID: "gateway", NamespacePublicID: "namespace", RuntimePublicID: "runtime", Binding: &binding, Revoked: true, DeliveryRequestID: "retired"}}}
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	a.cfg.GatewayPublication.ProtocolVersion = gc.ProtocolVersion
	a.cfg.GatewayPublication.CloudOrigin, a.cfg.GatewayPublication.RegionOrigin = "https://cloud.example", "https://sg.cloud.example"
	a.cfg.GatewayPublication.PrivateKeyB64u = base64.RawURLEncoding.EncodeToString(key)
	approved := binding
	approved.Generation = 3
	status := gc.RuntimeStatus{Candidate: gc.Candidate{RequestPublicID: requestID, State: "published", Binding: &approved}}
	for _, mutate := range []func(*gc.Binding){
		func(b *gc.Binding) { b.EnvPublicID = "another-env" },
		func(b *gc.Binding) { b.GatewayPublicID = "another-gateway" },
		func(b *gc.Binding) { b.NamespacePublicID = "another-namespace" },
		func(b *gc.Binding) { b.Generation = 1 },
		func(b *gc.Binding) { b.State = "revoked" },
	} {
		invalid := approved
		mutate(&invalid)
		status.Candidate.Binding = &invalid
		if err := a.adoptGatewayReapproval(&status); err == nil {
			t.Fatal("adopted an unrelated or stale approval")
		}
	}
	status.Candidate.Binding = &approved
	if err := a.adoptGatewayReapproval(&status); err != nil {
		t.Fatal(err)
	}
	loaded, err := config.Load(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.BindingGeneration != 3 || loaded.ControlArtifactPool != nil || loaded.GatewayPublication.Revoked || loaded.GatewayPublication.DeliveryRequestID != "" {
		t.Fatal("reapproval did not persist a clean new generation")
	}
}

func TestGatewayClosureLeavesLocalAndNewlyApprovedSessionsRunning(t *testing.T) {
	old, cancelOld := context.WithCancel(context.Background())
	defer cancelOld()
	newer, cancelNew := context.WithCancel(context.Background())
	defer cancelNew()
	local, cancelLocal := context.WithCancel(context.Background())
	defer cancelLocal()
	a := &Agent{sessions: map[string]*activeSession{
		"old":   {cancel: cancelOld, gatewayBindingPublicID: "binding", gatewayBindingGeneration: 1},
		"new":   {cancel: cancelNew, gatewayBindingPublicID: "binding", gatewayBindingGeneration: 3},
		"local": {cancel: cancelLocal},
	}}
	if a.closeGatewaySessions("binding", 1) {
		t.Fatal("reported closed before session cleanup")
	}
	if old.Err() == nil || newer.Err() != nil || local.Err() != nil {
		t.Fatal("closure crossed its binding generation")
	}
	delete(a.sessions, "old")
	if !a.closeGatewaySessions("binding", 1) {
		t.Fatal("unrelated sessions blocked acknowledgement")
	}
}

func TestGatewayControlSourceRejectsChangedGenerationBeforeSpending(t *testing.T) {
	a := &Agent{cfg: &config.Config{EnvironmentID: "env", BindingGeneration: 1, GatewayPublication: &gatewaycloud.RuntimeConfig{
		Binding: &gc.Binding{PublicID: "binding", Generation: 1},
	}}}
	expected := a.remoteConfigSnapshot()
	a.cfg.BindingGeneration = 2
	a.cfg.GatewayPublication.Binding.Generation = 2
	if expected.GatewayPublication.Binding.Generation != 1 {
		t.Fatal("controller snapshot was mutated by the new binding")
	}
	source := controlArtifactSource{agent: a, expectedConfig: expected}
	if _, err := source.Acquire(t.Context()); err == nil {
		t.Fatal("old controller acquired a credential for the new generation")
	}
	a.cfg.BindingGeneration = 1
	a.cfg.GatewayPublication.Binding.Generation = 1
	a.cfg.GatewayPublication.Revoked = true
	if _, err := source.Acquire(t.Context()); err == nil {
		t.Fatal("revoked controller acquired a credential")
	}
}

func TestGatewayRecoveryContinuesAfterReapprovalWithoutController(t *testing.T) {
	if !controlLoopStopped(nil) {
		t.Fatal("reapproved access cannot retry a failed first credential delivery")
	}
	done := make(chan struct{})
	if controlLoopStopped(done) {
		t.Fatal("started duplicate recovery while the controller owns it")
	}
	close(done)
	if !controlLoopStopped(done) {
		t.Fatal("exhausted controller cannot recover")
	}
}
