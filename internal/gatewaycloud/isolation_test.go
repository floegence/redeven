package gatewaycloud

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"github.com/floegence/redeven/internal/gatewaystate"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	"github.com/floegence/redeven/internal/gatewayegress"
	"github.com/floegence/redeven/internal/gatewayflow"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

// TestGatewayNetworkIsolationProcess runs only through check_gateway_cloud_isolation.sh.
// Containers have separate networks: the Runtime can reach only the Gateway.
func TestGatewayNetworkIsolationProcess(t *testing.T) {
	role := os.Getenv("REDEVEN_GATEWAY_ISOLATION_ROLE")
	if role == "" {
		t.Skip("Docker isolation qualification only")
	}
	root := os.Getenv("REDEVEN_GATEWAY_ISOLATION_STATE")
	if root == "" {
		t.Fatal("missing test state")
	}
	switch role {
	case "prepare":
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		stable := gatewaymembership.GatewayIdentity{ID: "gateway_isolation", PrivateKey: key}
		hooks, _ := gatewaymembership.NewPolicyHooks(gatewaymembership.HookConfig{})
		members, err := gatewaymembership.NewStore(filepath.Join(root, "members.json"), stable, "https://10.242.73.2:7443", ":7443", hooks)
		if err != nil {
			t.Fatal(err)
		}
		invitation, err := members.Invite("isolation_admin")
		if err != nil {
			t.Fatal(err)
		}
		member, err := gatewaymembership.PrepareRuntime(invitation, "runtime_isolation", gp.MemberMetadata{})
		if err != nil {
			t.Fatal(err)
		}
		cloud, _ := gatewayfixture.New(t, "https://cloud.gateway.test:8443", ":8443")
		endpoint := cloud.Endpoint()
		for name, value := range map[string]any{"gateway.json": stable, "runtime.json": member, "cloud.json": endpoint} {
			if err := gatewaystate.Write(filepath.Join(root, name), value); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(filepath.Join(root, "cloud-root.pem"), []byte(endpoint.RootPEM), 0600); err != nil {
			t.Fatal(err)
		}

	case "cloud":
		runIsolationCloud(t, root)
	case "gateway":
		runIsolationGateway(t, root)
	case "runtime":
		runIsolationRuntime(t, root)
	default:
		t.Fatal("invalid role")
	}
}

func runIsolationCloud(t *testing.T, root string) {
	var cfg gatewaymembership.Endpoint
	if err := gatewaystate.Read(filepath.Join(root, "cloud.json"), &cfg); err != nil {
		t.Fatal(err)
	}
	cert, err := tls.X509KeyPair([]byte(cfg.CertificatePEM), []byte(cfg.PrivateKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	endpoints, err := controlplane.NewEndpointSet(controlplane.EndpointConfig{ID: "wss", URL: "wss://cloud.gateway.test:8443" + flowersec.WebSocketDirectPath, TLS: controlplane.CAPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	issued, err := controlplane.NewIssuer().IssueDirect(controlplane.DirectIssueOptions{Session: controlplane.SessionOptions{ChannelID: "gateway-isolation", ExpiresAt: time.Now().Add(4 * time.Minute)}, Endpoints: endpoints, RendezvousGroupID: "isolation", ListenerAudience: "isolation", UpstreamAddress: "127.0.0.1:23998"})
	if err != nil {
		t.Fatal(err)
	}
	handlers, err := flowersec.NewSessionHandlers(flowersec.SessionHandlerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := handlers.HandleRPC(7001, func(_ context.Context, raw json.RawMessage) (any, *flowersec.RPCError) {
		return json.RawMessage(raw), nil
	}); err != nil {
		t.Fatal(err)
	}
	acceptor, err := flowersec.NewAcceptor(flowersec.AcceptorOptions{
		AllowedOrigins: []string{"https://runtime.gateway.test"},
		Authorize: func(_ context.Context, req controlplane.RuntimeAuthorizationRequest) (controlplane.AuthorizationResponse, error) {
			return controlplane.AuthorizeRuntime(req, issued.AuthorizationRecord(), "isolation-lease")
		},
		ResolveHandlers: func(context.Context, controlplane.RuntimeAuthorizationRequest) (*flowersec.SessionHandlers, error) {
			return handlers, nil
		},
		OnSession: func(ctx context.Context, _ flowersec.Session, _ string) error {
			<-ctx.Done()
			return context.Cause(ctx)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	application := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/credential" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(issued.ArtifactJSON())
	})
	server, err := flowersec.NewWebSocketHTTPServer(flowersec.WebSocketHTTPServerOptions{Handler: acceptor.Handler(), ApplicationHandler: application, TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS13}})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", ":8443")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	if err := os.WriteFile(filepath.Join(root, "cloud.ready"), []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	_ = server.Serve(listener)
}

func runIsolationGateway(t *testing.T, root string) {
	var stable gatewaymembership.GatewayIdentity
	if err := gatewaystate.Read(filepath.Join(root, "gateway.json"), &stable); err != nil {
		t.Fatal(err)
	}
	hooks, _ := gatewaymembership.NewPolicyHooks(gatewaymembership.HookConfig{})
	members, err := gatewaymembership.NewStore(filepath.Join(root, "members.json"), stable, "https://10.242.73.2:7443", ":7443", hooks)
	if err != nil {
		t.Fatal(err)
	}
	budget := gatewayflow.New(gp.MaxMemberConnections, gp.MaxGatewayConnections)
	connections := gatewaymembership.NewConnections(budget)
	proxy, err := gatewayegress.New(gatewayegress.Options{Budget: budget, AllowPrivateDestinations: true})
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	members.SetCommitHandler(func(records []gatewaymembership.MemberRecord, policy gp.GatewayPolicy) {
		connections.Apply(records, policy)
		policies := []gatewayegress.Member{}
		for _, record := range records {
			m := record.Member
			if m.State == "active" {
				policies = append(policies, gatewayegress.Member{ID: m.MemberID, MemberVersion: uint64(m.MemberVersion), Generation: 1, CertificateSHA256: record.ClientCertificateSHA256, Destinations: []string{"cloud.gateway.test:8443"}})
			}
		}
		if err := proxy.ReplaceMembers(policies); err != nil {
			t.Error(err)
		}
	})
	memberListener, err := gatewaymembership.NewListener(members, connections, func(string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	tlsConfig, err := members.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	server, err := memberListener.Server(tlsConfig, proxy)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	listener, err := net.Listen("tcp", ":7443")
	if err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(root, "gateway.ready"), []byte("ready"), 0600); err != nil {
		t.Fatal(err)
	}
	_ = server.Serve(listener)
}

func runIsolationRuntime(t *testing.T, root string) {
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	for _, address := range []string{"10.241.73.20:8443", "1.1.1.1:443"} {
		conn, err := (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "tcp", address)
		if err == nil {
			conn.Close()
			t.Fatalf("Runtime escaped isolated network: %s", address)
		}
	}
	lookupCtx, stop := context.WithTimeout(ctx, time.Second)
	_, err := net.DefaultResolver.LookupHost(lookupCtx, "cloud.gateway.test")
	stop()
	if err == nil {
		t.Fatal("Runtime unexpectedly resolved Cloud DNS")
	}
	var cfg gatewaymembership.RuntimeConfig
	if err := gatewaystate.Read(filepath.Join(root, "runtime.json"), &cfg); err != nil {
		t.Fatal(err)
	}
	if err := cfg.Enroll(ctx, func(member *gatewaymembership.RuntimeConfig) error {
		return gatewaystate.Write(filepath.Join(root, "runtime.json"), member)
	}); err != nil {
		t.Fatal(err)
	}
	association, err := PrepareRuntime(&cfg, gp.MemberCloudContext{ProtocolVersion: gp.Version, Allowed: true, GatewayID: cfg.GatewayID, MemberID: cfg.MemberID, MemberVersion: cfg.MemberVersion, CloudOrigin: "https://cloud.gateway.test:8443", RegionOrigin: "https://cloud.gateway.test:8443", NamespacePublicID: "namespace", GatewayPublicID: "cloud_gateway"})
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := association.Proxy(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	transport := proxy.HTTPTransport()
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", "https://cloud.gateway.test:8443/credential", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	if err != nil || resp.StatusCode != 200 {
		t.Fatal("credential fetch", err, resp.StatusCode)
	}
	artifact, err := flowersec.ParseArtifact(raw)
	if err != nil {
		t.Fatal(err)
	}
	lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	session, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{HTTPSProxy: proxy, Origin: "https://runtime.gateway.test", ConnectTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	var response string
	if err := session.RPC().Call(ctx, 7001, "private-payload", &response); err != nil || response != "private-payload" {
		t.Fatal("encrypted RPC failed", err)
	}
	// The proxy's valid outer certificate cannot replace inner service trust.
	empty := proxy.HTTPTransport()
	defer empty.CloseIdleConnections()
	empty.TLSClientConfig = &tls.Config{RootCAs: x509.NewCertPool(), MinVersion: tls.VersionTLS13}
	bad := &http.Client{Transport: empty, Timeout: 5 * time.Second}
	if resp, err := bad.Do(req.Clone(ctx)); err == nil {
		resp.Body.Close()
		t.Fatal("wrong inner TLS trust accepted")
	}
	block, _ := pem.Decode([]byte(cfg.GatewayTLSRootPEM))
	if block == nil {
		t.Fatal("missing Gateway root")
	}
	fmt.Println("PASS: isolated Runtime, no public DNS or direct egress, inner HTTPS and Flowersec RPC through authenticated Gateway")
}
