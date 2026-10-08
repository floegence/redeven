package agent

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaycloud"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
	"time"
)

func TestGatewayClosureOutboxSurvivesRemovalAndWaitsForActualSessionClosure(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	route, err := gatewaycloud.PrepareRuntime(member, gp.MemberCloudContext{ProtocolVersion: gp.Version, Allowed: true, GatewayID: member.GatewayID, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway"})
	if err != nil {
		t.Fatal(err)
	}
	route.Binding = &gc.Binding{MemberID: member.MemberID, MemberVersion: member.MemberVersion, PublicID: "binding", EnvPublicID: "env", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway", RuntimePublicID: "runtime", Region: "sg", Generation: 1, State: "active"}
	identity, err := route.Identity()
	if err != nil {
		t.Fatal(err)
	}
	public := base64.RawURLEncoding.EncodeToString(identity.PrivateKey.Public().(ed25519.PublicKey))
	attempts := 0
	relay := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if r.URL.Path != "/v5/member/cloud-closure" || len(r.TLS.PeerCertificates) != 0 {
			t.Error("receipt reused member access credentials")
			w.WriteHeader(403)
			return
		}
		var request gc.RuntimeClosureExchangeRequest
		if json.NewDecoder(r.Body).Decode(&request) != nil || request.Verify(public, time.Now()) != nil || !request.Closed {
			w.WriteHeader(403)
			return
		}
		if attempts == 1 {
			w.WriteHeader(503)
			return
		}
		_ = json.NewEncoder(w).Encode(gc.RuntimeClosureExchangeResponse{Accepted: true, Closure: &gc.Closure{BindingPublicID: "binding", Generation: 1, GatewayPublicID: "cloud_gateway", RuntimePublicID: "runtime", RuntimeClosed: true}})
	}))
	defer relay.Close()
	member.GatewayEndpoints = []gp.GatewayEndpoint{{EndpointID: "relay", Address: relay.URL, Scope: gp.GatewayEndpointLAN, Priority: 0}}
	member.GatewayTLSRootPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: relay.Certificate().Raw}))
	remote, cancel := context.WithCancel(t.Context())
	defer cancel()
	a := &Agent{configPath: filepath.Join(t.TempDir(), "config.json"), cfg: &config.Config{Gateway: member, GatewayPublication: route, LocalEnvironmentPublicID: "runtime"}, sessions: map[string]*activeSession{"remote": {cancel: cancel, gatewayBindingPublicID: "binding", gatewayBindingGeneration: 1}}}
	if err := a.LeaveGateway(); err != nil {
		t.Fatal(err)
	}
	if err := a.persistGatewayMember(nil); err != nil {
		t.Fatal(err)
	}
	a.drainGatewayClosure(t.Context(), 0)
	if remote.Err() == nil || attempts != 0 || a.cfg.GatewayClosureOutbox[0].Receipt.Closed {
		t.Fatal("receipt preceded actual session registry removal")
	}
	delete(a.sessions, "remote")
	a.drainGatewayClosure(t.Context(), 0)
	if attempts != 1 || len(a.cfg.GatewayClosureOutbox) != 1 || a.cfg.GatewayClosureOutbox[0].Evidence != nil {
		t.Fatal("failed delivery did not retain a sealed receipt")
	}
	saved, err := config.Load(a.configPath)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Gateway != nil || saved.GatewayPublication != nil || saved.GatewayClosureOutbox[0].Receipt.Signature == "" {
		t.Fatal("receipt restart restored access authority or lost delivery")
	}
	a.cfg = saved
	a.drainGatewayClosure(t.Context(), 0)
	if attempts != 2 || len(a.cfg.GatewayClosureOutbox) != 0 {
		t.Fatal("restart failed to deliver exact terminal receipt")
	}
	if _, err := gatewayProxy(a.cfg); err == nil {
		t.Fatal("receipt restored direct connectivity")
	}
}

func TestGatewayClosureFencesProcessWhenPersistenceFails(t *testing.T) {
	store, _ := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	route, err := gatewaycloud.PrepareRuntime(member, gp.MemberCloudContext{ProtocolVersion: gp.Version, Allowed: true, GatewayID: member.GatewayID, MemberID: member.MemberID, MemberVersion: member.MemberVersion, CloudOrigin: "https://cloud.example", RegionOrigin: "https://region.example", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway"})
	if err != nil {
		t.Fatal(err)
	}
	route.Binding = &gc.Binding{MemberID: member.MemberID, MemberVersion: member.MemberVersion, PublicID: "binding", EnvPublicID: "env", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway", RuntimePublicID: "runtime", Region: "sg", Generation: 1, State: "active"}
	relay := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(gc.RuntimeClosureExchangeResponse{Closure: &gc.Closure{BindingPublicID: "binding", Generation: 1, GatewayPublicID: "cloud_gateway", RuntimePublicID: "runtime"}})
	}))
	defer relay.Close()
	member.GatewayEndpoints = []gp.GatewayEndpoint{{EndpointID: "relay", Address: relay.URL, Scope: gp.GatewayEndpointLAN, Priority: 0}}
	member.GatewayTLSRootPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: relay.Certificate().Raw}))
	remote, cancel := context.WithCancel(t.Context())
	defer cancel()
	// An existing directory cannot be atomically replaced with a config file.
	a := &Agent{configPath: t.TempDir(), cfg: &config.Config{Gateway: member, GatewayPublication: route, LocalEnvironmentPublicID: "runtime"}, sessions: map[string]*activeSession{"remote": {cancel: cancel, gatewayBindingPublicID: "binding", gatewayBindingGeneration: 1}}}
	a.observeGatewayClosure(t.Context())
	if !a.cfg.GatewayPublication.Revoked || !a.controlBusinessRejected || remote.Err() == nil {
		t.Fatal("disk failure retained live access authority")
	}
	if len(a.cfg.GatewayClosureOutbox) != 1 || a.cfg.GatewayClosureOutbox[0].Receipt.Closed {
		t.Fatal("disk failure acknowledged session closure")
	}
	delete(a.sessions, "remote")
	a.drainGatewayClosure(t.Context(), 0)
	if a.cfg.GatewayClosureOutbox[0].Receipt.Closed {
		t.Fatal("receipt was sealed before revoked state could persist")
	}
}
