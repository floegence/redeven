package gatewaycloud

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
	gc "github.com/floegence/redeven/internal/gatewaycloud/protocol"
	"github.com/floegence/redeven/internal/gatewayegress"
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
		g, r := newEnrollmentFixture(t)
		g.config.ListenerURL = "https://10.242.73.2:7443"
		if err := createGatewayTLS(&g.config); err != nil {
			t.Fatal(err)
		}
		r.GatewayURL, r.GatewayTLSRootPEM = g.config.ListenerURL, g.config.RootPEM
		issued, err := g.enroll(gc.LocalEnrollment{RequestPublicID: r.RequestPublicID, EnrollmentToken: r.EnrollmentToken, RuntimePublicID: r.RuntimePublicID, CSRPEM: r.ClientCSRPEM})
		if err != nil {
			t.Fatal(err)
		}
		r.ClientCertificatePEM, r.ClientExpiresAtUnixMS = issued.ClientCertificatePEM, issued.ExpiresAtUnixMS
		cloud := GatewayConfig{ListenerURL: "https://cloud.gateway.test:8443"}
		if err := createGatewayTLS(&cloud); err != nil {
			t.Fatal(err)
		}
		for name, value := range map[string]any{"gateway.json": g.config, "runtime.json": r, "cloud.json": cloud} {
			if err := WriteState(filepath.Join(root, name), value); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.WriteFile(filepath.Join(root, "cloud-root.pem"), []byte(cloud.RootPEM), 0600); err != nil {
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
	var cfg GatewayConfig
	if err := ReadState(filepath.Join(root, "cloud.json"), &cfg); err != nil {
		t.Fatal(err)
	}
	cert, err := tls.X509KeyPair([]byte(cfg.ServerCertificatePEM), []byte(cfg.ServerKeyPEM))
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
	var cfg GatewayConfig
	if err := ReadState(filepath.Join(root, "gateway.json"), &cfg); err != nil {
		t.Fatal(err)
	}
	proxy, err := gatewayegress.New(gatewayegress.Options{AllowPrivateDestinations: true})
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	local := cfg.Members["request"]
	if err := proxy.ReplaceMembers([]gatewayegress.Member{{ID: local.RuntimePublicID, Generation: 1, CertificateSHA256: local.Fingerprint, Destinations: []string{"cloud.gateway.test:8443"}}}); err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AppendCertsFromPEM([]byte(cfg.RootPEM))
	cert, err := tls.X509KeyPair([]byte(cfg.ServerCertificatePEM), []byte(cfg.ServerKeyPEM))
	if err != nil {
		t.Fatal(err)
	}
	tlsConfig, err := gatewayegress.TLSConfig(cert, roots)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := tls.Listen("tcp", ":7443", tlsConfig)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 5 * time.Second}
	defer server.Close()
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
	var cfg RuntimeConfig
	if err := ReadState(filepath.Join(root, "runtime.json"), &cfg); err != nil {
		t.Fatal(err)
	}
	proxy, err := cfg.Proxy()
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
