package gatewaymembership

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

func TestRuntimeEnrollmentAndRotationRecoverLostPersistence(t *testing.T) {
	store, identity := membershipStore(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	store, err = NewStore(filepath.Join(t.TempDir(), "members.json"), identity, "https://"+listener.Addr().String(), listener.Addr().String(), store.hooks)
	if err != nil {
		t.Fatal(err)
	}
	config, err := store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	store.RegisterMemberHandlers(mux)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: time.Second}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve(tls.NewListener(listener, config)) }()
	t.Cleanup(func() { _ = server.Close(); <-done })
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := PrepareRuntime(invitation, "runtime_a", gp.MemberMetadata{Hostname: "A"})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	lost := errors.New("simulated local persistence failure")
	if err := runtime.Enroll(ctx, func(*RuntimeConfig) error { return lost }); !errors.Is(err, lost) {
		t.Fatalf("lost enrollment: %v", err)
	}
	if runtime.PendingJoin == nil {
		t.Fatal("pending enrollment discarded before durable delivery")
	}
	var durable *RuntimeConfig
	persist := func(next *RuntimeConfig) error { durable = next.Clone(); return nil }
	if err := runtime.Enroll(ctx, persist); err != nil {
		t.Fatal(err)
	}
	if durable.PendingJoin != nil || durable.MemberVersion != 1 {
		t.Fatal("enrollment did not commit")
	}
	oldPair, err := tls.X509KeyPair([]byte(runtime.ClientCertificatePEM), []byte(runtime.ClientPrivateKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	oldLeaf := oldPair.Leaf
	if _, err := store.Authenticate(oldLeaf); err != nil {
		t.Fatal(err)
	}
	calls := 0
	if err := runtime.Rotate(ctx, func(next *RuntimeConfig) error {
		calls++
		if calls == 2 {
			return lost
		}
		return persist(next)
	}); !errors.Is(err, lost) {
		t.Fatalf("lost rotation: %v", err)
	}
	if _, err := store.Authenticate(oldLeaf); !errors.Is(err, ErrDenied) {
		t.Fatal("old certificate still authorizes new operations")
	}
	restarted := durable.Clone()
	if restarted.PendingRotation == nil {
		t.Fatal("rotation request was not persisted before delivery")
	}
	if err := restarted.Rotate(ctx, persist); err != nil {
		t.Fatal("exact rotation recovery failed", err)
	}
	if restarted.PendingRotation != nil || restarted.ClientCertificatePEM == certPEM(oldLeaf.Raw) {
		t.Fatal("rotation was not completed")
	}
	if err := store.Remove(restarted.MemberID, restarted.MemberVersion); err != nil {
		t.Fatal(err)
	}
	if err := restarted.Rotate(ctx, persist); err == nil {
		t.Fatal("removed member rotated credentials")
	}
}

func TestServingLeafRenewsWithoutReplacingTrust(t *testing.T) {
	store, identity := membershipStore(t)
	before := store.Endpoint()
	// Renewing the leaf preserves the authority, stable Gateway identity and
	// invitation trust, while rotating only the serving key and certificate.
	after, err := renewEndpoint(before)
	if err != nil {
		t.Fatal(err)
	}
	if before.RootPEM != after.RootPEM || before.RootKeyPEM != after.RootKeyPEM || before.PrivateKeyPEM == after.PrivateKeyPEM {
		t.Fatal("leaf renewal replaced trust or reused its key")
	}
	store.mu.Lock()
	next := store.clone()
	next.Endpoint = after
	err = store.commit(next)
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(store.path, identity, "", "", store.hooks); err != nil {
		t.Fatal(err)
	}
}
