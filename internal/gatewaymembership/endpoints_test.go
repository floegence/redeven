package gatewaymembership

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestEndpointProofCoversEveryConnectionOption(t *testing.T) {
	store, identity := membershipStore(t)
	invit, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	if len(invit.Endpoints) != 1 {
		t.Fatalf("expected one endpoint, got %d", len(invit.Endpoints))
	}

	tampered := invit
	tampered.Endpoints = append([]gp.GatewayEndpoint(nil), invit.Endpoints...)
	tampered.Endpoints[0].Address = "https://attacker.invalid"
	if VerifyInvitation(tampered, time.Now()) == nil {
		t.Fatal("endpoint address tampering was accepted")
	}

	duplicate := invit
	duplicate.Endpoints = append([]gp.GatewayEndpoint(nil), invit.Endpoints[0], invit.Endpoints[0])
	if err := SignInvitation(&duplicate, identity.PrivateKey); !errors.Is(err, ErrInvalidProof) {
		t.Fatalf("duplicate endpoint was accepted: %v", err)
	}

	invalidScope := invit
	invalidScope.Endpoints = append([]gp.GatewayEndpoint(nil), invit.Endpoints...)
	invalidScope.Endpoints[0].Scope = gp.GatewayEndpointScope("internet")
	if err := SignInvitation(&invalidScope, identity.PrivateKey); !errors.Is(err, ErrInvalidProof) {
		t.Fatalf("invalid endpoint scope was accepted: %v", err)
	}
}

func TestConnectionEndpointsPreferRecentSuccessThenPriority(t *testing.T) {
	config := &RuntimeConfig{
		GatewayEndpoints: []gp.GatewayEndpoint{
			{EndpointID: "z", Address: "https://z.example", Scope: gp.GatewayEndpointLAN, Priority: 1},
			{EndpointID: "a", Address: "https://a.example", Scope: gp.GatewayEndpointLAN, Priority: 0},
			{EndpointID: "b", Address: "https://b.example", Scope: gp.GatewayEndpointOverlay, Priority: 1},
		},
	}
	got := config.ConnectionEndpoints()
	want := []gp.GatewayEndpoint{config.GatewayEndpoints[1], config.GatewayEndpoints[2], config.GatewayEndpoints[0]}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("priority ordering = %#v, want %#v", got, want)
	}
	config.LastEndpointID = "b"
	got = config.ConnectionEndpoints()
	want = []gp.GatewayEndpoint{config.GatewayEndpoints[2], config.GatewayEndpoints[1], config.GatewayEndpoints[0]}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("recent endpoint ordering = %#v, want %#v", got, want)
	}
}

func TestRuntimeSourceDoesNotMutateApprovedEndpoints(t *testing.T) {
	config := &RuntimeConfig{
		MemberID: "member_test", MemberVersion: 1,
		ClientExpiresAtUnixMS: time.Now().Add(90 * 24 * time.Hour).UnixMilli(),
		Service:               gp.MemberService{ExpiresAtUnixMS: time.Now().Add(90 * 24 * time.Hour).UnixMilli()},
		GatewayEndpoints: []gp.GatewayEndpoint{
			{EndpointID: "lan", Address: "https://127.0.0.1:1", Scope: gp.GatewayEndpointLAN, Priority: 0},
			{EndpointID: "overlay", Address: "https://127.0.0.1:2", Scope: gp.GatewayEndpointOverlay, Priority: 1},
		},
		LastEndpointID: "lan",
	}
	original := config.Clone()
	source := &runtimeSource{
		current: func() *RuntimeConfig { return config }, memberID: config.MemberID,
		persist:             func(next *RuntimeConfig) error { config = next; return nil },
		attemptedEndpointID: "lan",
	}
	_, failure := source.Acquire(t.Context())
	if failure == nil {
		t.Fatal("unreachable endpoints unexpectedly produced an artifact")
	}
	if !reflect.DeepEqual(config, original) {
		t.Fatal("a connection attempt changed approved durable state")
	}
	source.attemptedEndpointID = "overlay"
	if err := source.connected(); err != nil {
		t.Fatal(err)
	}
	if config.LastEndpointID != "overlay" || len(config.GatewayEndpoints) != 2 || original.LastEndpointID != "lan" {
		t.Fatal("successful endpoint tracking mutated previous state or removed an endpoint")
	}
	if source.attemptedEndpointID != "overlay" {
		t.Fatal("reconnection lost the previously connected endpoint")
	}
}

func TestRuntimeEnrollmentFailsOverToSecondAdvertisedEndpoint(t *testing.T) {
	store, identity := membershipStore(t)
	unused, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	unusedAddress := unused.Addr().String()
	_ = unused.Close()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	store, err = NewStore(filepath.Join(t.TempDir(), "members.json"), identity, "https://"+listener.Addr().String(), listener.Addr().String(), store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	endpoints := []gp.GatewayEndpoint{
		{EndpointID: "lan-unavailable", Address: "https://" + unusedAddress, Scope: gp.GatewayEndpointLAN, Priority: 0},
		{EndpointID: "overlay-working", Address: "https://" + listener.Addr().String(), Scope: gp.GatewayEndpointOverlay, Priority: 1},
	}
	if err := store.UpdateEndpoints(endpoints); err != nil {
		t.Fatal(err)
	}
	tlsConfig, err := store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	store.RegisterMemberHandlers(mux)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: time.Second}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve(tls.NewListener(listener, tlsConfig)) }()
	t.Cleanup(func() { _ = server.Close(); <-done })

	invit, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := PrepareRuntime(invit, "runtime_failover", gp.MemberMetadata{Hostname: "Failover runtime"})
	if err != nil {
		t.Fatal(err)
	}
	var saved *RuntimeConfig
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	if err := runtime.Enroll(ctx, func(next *RuntimeConfig) error { saved = next.Clone(); return nil }); err != nil {
		t.Fatal(err)
	}
	if saved == nil || saved.PendingJoin != nil || saved.LastEndpointID != "overlay-working" {
		t.Fatalf("failover did not persist the working endpoint: %#v", saved)
	}
	if _, err := store.Authenticate(mustClientLeaf(t, saved)); err != nil {
		t.Fatalf("enrollment did not reach the second endpoint: %v", err)
	}
}

func mustClientLeaf(t *testing.T, runtime *RuntimeConfig) *x509.Certificate {
	t.Helper()
	pair, err := tls.X509KeyPair([]byte(runtime.ClientCertificatePEM), []byte(runtime.ClientPrivateKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	return pair.Leaf
}
