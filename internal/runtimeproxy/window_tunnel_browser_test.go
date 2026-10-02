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
	"github.com/gorilla/websocket"
)

// A real encrypted tunnel joins the browser controller and a Go endpoint.
// The controlled upstream supplies arbitrary text/binary frames, never a direct
// host URL to the browser. Product ownership is tested by Local UI separately.
func TestWindowTunnelBrowserE2E(t *testing.T) {
	if os.Getenv("REDEVEN_WINDOW_BROWSER_ACCEPTANCE") != "1" {
		t.Skip("explicit browser acceptance")
	}
	const controllerOrigin = "https://rt-window.region.test.invalid"
	const appOrigin = "https://app-window.region.test.invalid"
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	var mediaFrames atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/state" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		if r.URL.Path != "/control" && r.URL.Path != "/media" {
			http.NotFound(w, r)
			return
		}
		upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == appOrigin }}
		connection, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer connection.Close()
		connection.SetReadLimit(MaxWSFrameBytes)
		for {
			kind, data, err := connection.ReadMessage()
			if err != nil {
				return
			}
			if r.URL.Path == "/media" {
				mediaFrames.Add(1)
			}
			if err := connection.WriteMessage(kind, data); err != nil {
				return
			}
		}
	}))
	defer upstream.Close()
	handlers, err := flowersec.NewStreamHandlers(flowersec.StreamHandlerOptions{})
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := RegisterStreamHandlers(handlers, Options{Upstream: upstream.URL, UpstreamOrigin: appOrigin, OnError: func(err error) { t.Logf("proxy: %v", err) }})
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
		Session:   controlplane.SessionOptions{ChannelID: "window-tunnel", ExpiresAt: time.Now().Add(2 * time.Minute), MaxInboundStreams: 32},
		Endpoints: endpoints, RendezvousGroupID: "window-group", ListenerAudience: "window-relay", FirstEndpointID: "browser", SecondEndpointID: "host",
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
	script, err := filepath.Abs("../codeapp/ui_src/scripts/checkWindowTunnel.mjs")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, "node", script)
	command.Env = append(os.Environ(), "REDEVEN_WINDOW_TUNNEL_FIXTURE="+string(payload))
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("native tunnel browser: %v\n%s", err, output)
	}
	if count := mediaFrames.Load(); count != 1 {
		t.Fatalf("only the in-bounds media frame may reach the upstream, received %d", count)
	}
	t.Log(string(output))
}
