package gatewaymembership

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/redeven/internal/gatewayflow"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// The Runtime in this fixture has no TCP listener. Only its outbound connection
// can carry requests, including the nested TLS handshake and streaming response.
func TestReverseAccessOverOutboundMembership(t *testing.T) {
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
	budget := gatewayflow.New(0, 0)
	connections := NewConnections(budget)
	defer connections.Close()
	store.SetCommitHandler(connections.Apply)
	var revoked atomic.Bool
	endpoint, err := NewListener(store, connections, func(key string) bool { return key == "desktop" && !revoked.Load() || key == "other-desktop" })
	if err != nil {
		t.Fatal(err)
	}
	trust, err := store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	server, err := endpoint.Server(trust, nil)
	if err != nil {
		t.Fatal(err)
	}
	serverDone := make(chan struct{})
	go func() { defer close(serverDone); _ = server.Serve(listener) }()
	defer func() { _ = server.Close(); <-serverDone }()
	invitation, err := store.Invite("admin")
	if err != nil {
		t.Fatal(err)
	}
	state, err := PrepareRuntime(invitation, "runtime_reverse", gp.MemberMetadata{Hostname: "Runtime"})
	if err != nil {
		t.Fatal(err)
	}
	var stateMu sync.Mutex
	current := func() *RuntimeConfig { stateMu.Lock(); defer stateMu.Unlock(); return state.Clone() }
	persist := func(next *RuntimeConfig) error {
		stateMu.Lock()
		defer stateMu.Unlock()
		state = next.Clone()
		return nil
	}
	runtime, err := NewRuntimeConnection(current, persist)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	runtimeDone := make(chan error, 1)
	applicationCalled := make(chan struct{}, 8)
	go func() {
		runtimeDone <- runtime.Run(ctx, func(origin string) RuntimeApplication {
			applicationCalled <- struct{}{}
			return RuntimeApplication{WebSocketHandler: endpoint.acceptor.Handler(), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.TLS == nil || "https://"+r.Host != origin {
					http.Error(w, "wrong authority", http.StatusForbidden)
					return
				}
				if r.URL.Path == "/stream" {
					w.WriteHeader(http.StatusOK)
					_, _ = w.Write([]byte("ready\n"))
					w.(http.Flusher).Flush()
					<-r.Context().Done()
					return
				}
				_, _ = io.WriteString(w, "private-runtime-content")
			})}
		})
	}()
	defer func() { cancel(); <-runtimeDone }()
	observed := runtime.Snapshot()
	for observed.State != flowersec.ConnectionConnected {
		if observed.Failure != nil {
			cause := observed.Failure.Error
			for errors.Unwrap(cause) != nil {
				cause = errors.Unwrap(cause)
			}
			t.Fatalf("member connection failed: %v", cause)
		}
		observed, err = runtime.controller.WaitForSnapshotChange(ctx, observed)
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := runtime.controller.WaitForSession(ctx); err != nil {
		t.Fatalf("member connection: %v; snapshot=%+v", err, runtime.Snapshot())
	}
	for !connections.IsConnected(current().MemberID) {
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-time.After(time.Millisecond):
		}
	}
	member := current()
	offer, err := store.AccessOffer(ctx, member.MemberID, "desktop")
	if err != nil {
		t.Fatal(err)
	}
	artifact, err := flowersec.ParseArtifact(offer.Artifact)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(member.GatewayTLSRootPEM))
	desktop, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{TrustRoots: roots, Origin: member.ConnectionEndpoints()[0].Address})
	if err != nil {
		t.Fatal(err)
	}
	defer desktop.Close()
	serviceRoots := x509.NewCertPool()
	serviceRoots.AppendCertsFromPEM([]byte(offer.Service.CertificatePEM))
	origin, _ := url.Parse(offer.Service.Origin)
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, TLSClientConfig: &tls.Config{RootCAs: serviceRoots, MinVersion: tls.VersionTLS13}, DialContext: func(ctx context.Context, _, target string) (net.Conn, error) {
		if target != origin.Host+":443" {
			return nil, ErrDenied
		}
		stream, err := desktop.OpenStream(ctx, gp.MemberAccessStream, flowersec.EmptyStreamMetadata())
		if err != nil {
			return nil, err
		}
		return flowersec.NewByteStreamConn(context.Background(), stream)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	response, err := client.Get(offer.Service.Origin + "/app")
	if err != nil {
		t.Fatalf("reverse request: %v; application calls=%d", err, len(applicationCalled))
	}
	body, err := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK || string(body) != "private-runtime-content" {
		t.Fatalf("reverse response: status=%d body=%q err=%v", response.StatusCode, body, err)
	}
	streaming, err := client.Get(offer.Service.Origin + "/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer streaming.Body.Close()
	prefix := make([]byte, len("ready\n"))
	if _, err := io.ReadFull(streaming.Body, prefix); err != nil {
		t.Fatal(err)
	}
	pendingOffer, err := store.AccessOffer(ctx, member.MemberID, "desktop")
	if err != nil {
		t.Fatal(err)
	}
	otherOffer, err := store.AccessOffer(ctx, member.MemberID, "other-desktop")
	if err != nil {
		t.Fatal(err)
	}
	otherArtifact, err := flowersec.ParseArtifact(otherOffer.Artifact)
	if err != nil {
		t.Fatal(err)
	}
	otherLease, err := flowersec.NewArtifactLease(otherArtifact, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	otherSession, err := flowersec.Connect(ctx, otherLease, flowersec.ConnectorOptions{TrustRoots: roots, Origin: member.ConnectionEndpoints()[0].Address})
	if err != nil {
		t.Fatal(err)
	}
	defer otherSession.Close()
	revoked.Store(true)
	endpoint.RevokeClient("desktop")
	interrupted := make(chan error, 1)
	go func() { _, err := io.ReadAll(streaming.Body); interrupted <- err }()
	select {
	case err := <-interrupted:
		if err == nil {
			t.Fatal("revocation did not interrupt stream")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("revoked stream remains open")
	}
	pendingArtifact, err := flowersec.ParseArtifact(pendingOffer.Artifact)
	if err != nil {
		t.Fatal(err)
	}
	pendingLease, err := flowersec.NewArtifactLease(pendingArtifact, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if rejected, err := flowersec.Connect(ctx, pendingLease, flowersec.ConnectorOptions{TrustRoots: roots, Origin: member.ConnectionEndpoints()[0].Address}); err == nil {
		_ = rejected.Close()
		t.Fatal("revoked pending ticket connected")
	}
	if !connections.IsConnected(member.MemberID) || runtime.Snapshot().State != flowersec.ConnectionConnected {
		t.Fatal("client revocation disconnected Runtime membership")
	}
	originalDesktop := desktop
	desktop = otherSession
	if response, err := client.Get(offer.Service.Origin + "/app"); err != nil {
		t.Fatal("other client access was interrupted", err)
	} else {
		body, err := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if err != nil || string(body) != "private-runtime-content" {
			t.Fatal("other client failed", err)
		}
	}
	streaming, err = client.Get(offer.Service.Origin + "/stream")
	if err != nil {
		t.Fatal(err)
	}
	defer streaming.Body.Close()
	if _, err := io.ReadFull(streaming.Body, prefix); err != nil {
		t.Fatal(err)
	}
	defer originalDesktop.Close()
	if err := store.Remove(member.MemberID, member.MemberVersion); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadAll(streaming.Body); err == nil {
		t.Fatal("removal failed to interrupt the live stream")
	}
	if _, err := client.Get(offer.Service.Origin + "/app"); err == nil {
		t.Fatal("removed membership opened another reverse stream")
	}
	for budget.Count(member.MemberID, 0, "") != 0 {
		select {
		case <-ctx.Done():
			t.Fatal("forwarding workers retained budget after removal")
		case <-time.After(time.Millisecond):
		}
	}
}
