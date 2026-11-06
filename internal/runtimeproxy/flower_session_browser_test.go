package runtimeproxy

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	flowersec "github.com/floegence/flowersec/flowersec-go/v5"
	"github.com/floegence/flowersec/flowersec-go/v5/controlplane"
)

// This acceptance joins the published browser client and Go server over one
// real encrypted tunnel, exercising the product HTTP binding and boot SSE parser.
func TestFlowerSessionBoundBrowserE2E(t *testing.T) {
	if os.Getenv("REDEVEN_FLOWER_SESSION_ACCEPTANCE") != "1" {
		t.Skip("explicit browser acceptance")
	}
	const controllerOrigin = "https://rt-flower.region.test.invalid"
	const appOrigin = "https://app-flower.region.test.invalid"
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Minute)
	defer cancel()
	var commands, cancellations atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wait := func(duration time.Duration) bool {
			select {
			case <-time.After(duration):
				return true
			case <-r.Context().Done():
				cancellations.Add(1)
				return false
			}
		}
		switch r.URL.Path {
		case "/command":
			commands.Add(1)
			if !wait(55 * time.Second) {
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(202)
			w.(http.Flusher).Flush()
			if !wait(75 * time.Second) {
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"accepted":true}}`))
		case "/events":
			if !wait(55 * time.Second) {
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("data: ready\n\n"))
			w.(http.Flusher).Flush()
			if !wait(55 * time.Second) {
				return
			}
			_, _ = w.Write([]byte("data: completed\n\n"))
		case "/hold":
			<-r.Context().Done()
			cancellations.Add(1)
		case "/oversize":
			_, _ = w.Write(make([]byte, 2048))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := RegisterStreamHandlers(handlers, Options{Upstream: upstream.URL, UpstreamOrigin: appOrigin,
		SessionBoundRequests: true, DefaultHTTPRequestTimeout: 10 * time.Millisecond, MaxHTTPRequestTimeout: 10 * time.Millisecond,
		MaxBodyBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	defer proxy.Close()
	records := make(map[string]controlplane.AuthorizationRecord)
	tunnel, err := flowersec.NewTunnelRuntime(flowersec.TunnelRuntimeOptions{
		AllowedOrigins: []string{controllerOrigin}, Listeners: []flowersec.TunnelListener{flowersec.NewWebSocketTunnelListener()},
		Authorize: func(_ context.Context, request controlplane.RuntimeAuthorizationRequest) (controlplane.TunnelAuthorizationResponse, error) {
			record, ok := records[request.LookupKey()]
			if !ok {
				return controlplane.TunnelAuthorizationResponse{}, fmt.Errorf("unknown fixture artifact")
			}
			return controlplane.AuthorizeTunnelRuntime(request, record, "window-"+request.LookupKey()[:8])
		},
		Release: func(context.Context, string) {},
	})
	if err != nil {
		t.Fatal(err)
	}
	identity := httptest.NewTLSServer(http.NotFoundHandler())
	certificate, roots := identity.TLS.Certificates[0], x509.NewCertPool()
	roots.AddCert(identity.Certificate())
	identity.Close()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	relay, err := flowersec.NewWebSocketHTTPServer(flowersec.WebSocketHTTPServerOptions{Handler: tunnel.Handler(), TLSConfig: &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{certificate}}})
	if err != nil {
		listener.Close()
		t.Fatal(err)
	}
	defer relay.Close()
	go func() { _ = relay.Serve(listener) }()
	endpoints, err := controlplane.NewEndpointSet(controlplane.EndpointConfig{ID: "relay", URL: "wss://" + listener.Addr().String() + flowersec.WebSocketTunnelPath, TLS: controlplane.CAPolicy()})
	if err != nil {
		t.Fatal(err)
	}
	pair, err := controlplane.NewIssuer().IssueTunnelPair(controlplane.TunnelIssueOptions{
		Session:   controlplane.SessionOptions{ChannelID: "flower-weaknet", ExpiresAt: time.Now().Add(4 * time.Minute), IdleTimeout: 3 * time.Minute, MaxInboundStreams: 32},
		Endpoints: endpoints, RendezvousGroupID: "flower-group", ListenerAudience: "window-relay", FirstEndpointID: "browser", SecondEndpointID: "host",
	})
	if err != nil {
		t.Fatal(err)
	}
	records[pair.First.LookupKey()], records[pair.Second.LookupKey()] = pair.First.AuthorizationRecord(), pair.Second.AuthorizationRecord()
	serverDone := make(chan error, 1)
	go func() {
		artifact, err := flowersec.ParseArtifact(pair.Second.ArtifactJSON())
		if err != nil {
			serverDone <- err
			return
		}
		lease, err := flowersec.NewArtifactLease(artifact, func(context.Context) error { return nil })
		if err != nil {
			serverDone <- err
			return
		}
		current, err := flowersec.Connect(ctx, lease, flowersec.ConnectorOptions{TrustRoots: roots, Origin: controllerOrigin})
		if err != nil {
			t.Logf("host tunnel connect: %v", err)
			serverDone <- err
			return
		}
		defer current.Close()
		serverDone <- handlers.Serve(ctx, current)
	}()
	defer func() {
		cancel()
		select {
		case <-serverDone:
		case <-time.After(5 * time.Second):
			t.Error("tunnel endpoint did not stop")
		}
	}()
	payload, err := json.Marshal(map[string]any{"artifact": string(pair.First.ArtifactJSON()), "controllerOrigin": controllerOrigin, "appOrigin": appOrigin})
	if err != nil {
		t.Fatal(err)
	}
	script, err := filepath.Abs("../envapp/ui_src/scripts/checkFlowerSessionLifetime.mjs")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, "node", script)
	command.Env = append(os.Environ(), "REDEVEN_FLOWER_SESSION_FIXTURE="+string(payload))
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Flower session browser: %v\n%s", err, output)
	}
	if commands.Load() != 1 {
		t.Fatalf("command dispatched %d times", commands.Load())
	}
	deadline := time.Now().Add(2 * time.Second)
	for cancellations.Load() != 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if cancellations.Load() != 2 {
		t.Fatalf("cancelled requests released: %d", cancellations.Load())
	}
	t.Log(string(output))
}
