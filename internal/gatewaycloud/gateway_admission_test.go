package gatewaycloud

import (
	"bufio"
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayegress"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestGatewayAdmissionExpiryClosesActiveForwardingWithoutCloud(t *testing.T) {
	store, stable := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	member := gatewayfixture.Enroll(t, store, "runtime")
	if err := store.SetCloudNamespace(t.Context(), "namespace"); err != nil {
		t.Fatal(err)
	}
	if err := store.UpdateMemberPolicy(t.Context(), gp.MemberPolicyUpdate{MemberID: member.MemberID, ExpectedMemberVersion: 1, CloudPermission: gp.CloudAllow}); err != nil {
		t.Fatal(err)
	}
	budget := gatewayflow.New(0, 0)
	connections := gatewaymembership.NewConnections(budget)
	defer connections.Close()
	g, err := NewGateway(t.TempDir(), stable, store, connections, budget, nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = g.egress.Close()
	g.egress, err = gatewayegress.New(gatewayegress.Options{Budget: budget, AllowPrivateDestinations: true})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		g.mu.Lock()
		if g.admissionTimer != nil {
			g.admissionTimer.Stop()
		}
		g.mu.Unlock()
		_ = g.egress.Close()
	}()
	target, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	go func() {
		conn, err := target.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = io.Copy(conn, conn)
	}()
	g.config.GatewayPublicID = "gateway"
	g.status = &gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "gateway", GatewayID: stable.ID, State: "active", IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}, AdmissionDestinations: []string{target.Addr().String()}}
	records, policy, _ := store.Snapshot()
	g.Apply(records, policy)
	proxy := httptest.NewUnstartedServer(g)
	proxy.TLS, err = store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	proxy.StartTLS()
	defer proxy.Close()
	trust, err := member.TLSConfig(true)
	if err != nil {
		t.Fatal(err)
	}
	trust.ServerName = "gateway.internal"
	conn, err := tls.Dial("tcp", proxy.Listener.Addr().String(), trust)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	_, _ = io.WriteString(conn, "CONNECT "+target.Addr().String()+" HTTP/1.1\r\nHost: "+target.Addr().String()+"\r\n\r\n")
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil || response.StatusCode != 200 {
		t.Fatal("forwarding failed", err, response)
	}
	_, _ = conn.Write([]byte("hello"))
	raw := make([]byte, 5)
	if _, err := io.ReadFull(reader, raw); err != nil || string(raw) != "hello" {
		t.Fatal("inner bytes did not arrive", err)
	}
	records[0].ClientExpiresAtUnixMS = time.Now().Add(50 * time.Millisecond).UnixMilli()
	g.Apply(records, policy)
	if _, err := reader.ReadByte(); err == nil {
		t.Fatal("expired member forwarding stayed active")
	}
	if g.egress.MemberCount() != 0 {
		t.Fatal("expired admission was retained")
	}
}

func TestGatewaySnapshotsNeverRegressManagementVersions(t *testing.T) {
	forwarding, err := gatewayegress.New(gatewayegress.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer forwarding.Close()
	g := &Gateway{stable: gatewaymembership.GatewayIdentity{ID: "machine"}, config: GatewayConfig{GatewayPublicID: "gateway"}, egress: forwarding}
	current := gc.GatewayStatus{Gateway: gc.Gateway{PublicID: "gateway", GatewayID: "machine", NamespacePublicID: "namespace", State: "active", AuthorizationRevision: 3, DirectoryRevision: 9, Policy: gc.GatewayPolicy{Revision: 5}, IdentityExpiresAtUnixMS: time.Now().Add(time.Hour).UnixMilli()}}
	if !g.acceptSnapshotLocked(&current) {
		t.Fatal("current snapshot rejected")
	}
	for _, field := range []string{"authority", "directory", "policy", "namespace", "state", "machine"} {
		old := current
		switch field {
		case "authority":
			old.Gateway.AuthorizationRevision--
		case "directory":
			old.Gateway.DirectoryRevision--
		case "policy":
			old.Gateway.Policy.Revision--
		case "namespace":
			old.Gateway.NamespacePublicID = "other"
		case "state":
			old.Gateway.State = "revoked"
		case "machine":
			old.Gateway.GatewayID = "other"
		}
		if g.acceptSnapshotLocked(&old) || g.status != &current {
			t.Fatalf("stale %s snapshot replaced current management state", field)
		}
	}
	revoked := current
	revoked.Gateway.AuthorizationRevision++
	revoked.Gateway.State = "revoked"
	if !g.acceptSnapshotLocked(&revoked) || g.status.Gateway.State != "revoked" {
		t.Fatal("new authority revocation rejected")
	}
	if g.acceptSnapshotLocked(&current) {
		t.Fatal("reconnect restored old admission")
	}
}

func TestGatewayUnconfiguredOwnerStopsOnCancellation(t *testing.T) {
	store, stable := gatewayfixture.New(t, "https://gateway.internal:7443", "127.0.0.1:7443")
	budget := gatewayflow.New(0, 0)
	connections := gatewaymembership.NewConnections(budget)
	defer connections.Close()
	g, err := NewGateway(t.TempDir(), stable, store, connections, budget, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() { defer close(done); g.Run(ctx) }()
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("unconfigured owner leaked on shutdown")
	}
}
