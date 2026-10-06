package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/pem"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"testing"

	"github.com/floegence/redeven/internal/gatewayegress"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/runtimegateway/trust"
	"net"
	"path/filepath"
)

// This fixture runs the real Cloud synchronization and forwarding service in
// Docker. Only the test binary permits the private addresses of the Cloud test
// stack. Production binaries have no flag or environment override for this.
func TestGatewayCloudProductProcess(t *testing.T) {
	root := os.Getenv("REDEVEN_GATEWAY_PRODUCT_TEST_STATE")
	if root == "" {
		t.Skip("isolated product qualification only")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	trustStore := trust.NewStore(filepath.Join(root, "gateway-trust.json"))
	if err := trustStore.Initialize(); err != nil {
		t.Fatal(err)
	}
	metadata, _, err := trustStore.GatewayMetadata("")
	if err != nil {
		t.Fatal(err)
	}
	private, err := trustStore.GatewayPrivateKey()
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode([]byte(private))
	if block == nil {
		t.Fatal("missing machine identity")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	stable := gatewaymembership.GatewayIdentity{ID: metadata.GatewayID, PrivateKey: parsed.(ed25519.PrivateKey)}
	hooks, _ := gatewaymembership.NewPolicyHooks(gatewaymembership.HookConfig{})
	members, err := gatewaymembership.NewStore(filepath.Join(root, "members.json"), stable, os.Getenv("REDEVEN_GATEWAY_PRODUCT_MEMBER_URL"), ":7443", hooks)
	if err != nil {
		t.Fatal(err)
	}
	budget := gatewayflow.New(gp.MaxMemberConnections, gp.MaxGatewayConnections)
	connections := gatewaymembership.NewConnections(budget)
	defer connections.Close()
	cloud, err := NewGateway(root, stable, members, connections, budget, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	_ = cloud.egress.Close()
	cloud.egress, err = gatewayegress.New(gatewayegress.Options{Budget: budget, AllowPrivateDestinations: true})
	if err != nil {
		t.Fatal(err)
	}
	members.SetCommitHandler(func(records []gatewaymembership.MemberRecord, policy gp.GatewayPolicy) {
		connections.Apply(records, policy)
		cloud.Apply(records, policy)
	})
	listener, err := gatewaymembership.NewListener(members, connections, func(string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	tlsConfig, err := members.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	server, err := listener.Server(tlsConfig, cloud)
	if err != nil {
		t.Fatal(err)
	}
	socket, err := net.Listen("tcp", members.Endpoint().ListenAddress)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	done := make(chan struct{})
	go func() { defer close(done); cloud.Run(ctx) }()
	go func() { _ = server.Serve(socket) }()

	<-ctx.Done()
	<-done
}
