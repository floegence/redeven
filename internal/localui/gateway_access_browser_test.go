package localui

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/pquerna/otp/totp"
)

// Opt-in qualification uses production public Runtime handlers, Gateway routes
// and Desktop transport with real Electron cookies, HTTPS and proxy auth.
func TestGatewayAccessBrowserSession(t *testing.T) {
	if os.Getenv("REDEVEN_GATEWAY_ACCESS_BROWSER") != "1" {
		t.Skip("run scripts/check_gateway_access_browser.sh")
	}
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	var host string
	for _, address := range addresses {
		if network, ok := address.(*net.IPNet); ok && network.IP.To4() != nil && network.IP.IsPrivate() && !network.IP.IsLoopback() {
			host = network.IP.String()
			break
		}
	}
	if host == "" {
		t.Fatal("Gateway qualification requires a private IPv4 interface")
	}
	const password = "gateway-fixture-password"
	start := func(secure bool) (string, *Server) {
		state := t.TempDir()
		hash, err := accessgate.HashPassword(password)
		if err != nil {
			t.Fatal(err)
		}
		if err := accessgate.WritePasswordHash(state, hash); err != nil {
			t.Fatal(err)
		}
		gate, err := accessgate.OpenPersistent(state)
		if err != nil {
			t.Fatal(err)
		}
		runtime := newTestServer(t, gate)
		listener, err := net.Listen("tcp4", net.JoinHostPort(host, "0"))
		if err != nil {
			t.Fatal(err)
		}
		runtime.bind, err = ParseBind(listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		if !secure {
			runtime.protocol = "http"
		}
		runtime.a = newRuntimeHealthTestAgent(t, runtime.configPath, gate)
		runtime.appServer = runtime.a.CodeAppServer()
		if err := runtime.StartOnListeners(t.Context(), []net.Listener{listener}, nil); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = runtime.Close(); _ = gate.Close() })
		return runtime.protocol + "://" + listener.Addr().String(), runtime
	}
	plain, _ := start(false)
	secure, runtime := start(true)
	gate := runtime.accessGate
	setup, err := gate.Manage("fixture-owner", "Gateway qualification", accessgate.SecurityRequest{Action: "setup"})
	if err != nil {
		t.Fatal(err)
	}
	code, err := totp.GenerateCode(setup.Secret, time.Now().Add(-30*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	verified, err := gate.Manage("fixture-owner", "Gateway qualification", accessgate.SecurityRequest{Action: "verify", OperationID: setup.OperationID, Code: code})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := gate.Manage("fixture-owner", "Gateway qualification", accessgate.SecurityRequest{Action: "commit", OperationID: setup.OperationID, Saved: true}); err != nil {
		t.Fatal(err)
	}
	state := t.TempDir()
	deploymentDir := os.Getenv("REDEVEN_GATEWAY_DEPLOYMENT_FIXTURE")
	gateway, err := gatewayservice.New(gatewayservice.Options{
		StateRoot: filepath.Join(state, "gateway"), PairingCode: "qualification-code",
		ProfileWriteEnabled: true, AllowPrivateProfileTargets: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	listen := "127.0.0.1:0"
	if deploymentDir != "" {
		listen = "0.0.0.0:19400"
	}
	server, listeners, err := gateway.Start(ctx, listen)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	certificate, err := x509.ParseCertificate(runtime.publicAccessSnapshot().certificate.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	certificateHash := sha256.Sum256(certificate.RawSubjectPublicKeyInfo)
	fixture := map[string]any{
		"gateway": "http://" + listeners[0].Addr().String() + "/", "plain": plain,
		"secure": secure, "recoveryCodes": verified.RecoveryCodes,
		"certificateSPKI": base64.StdEncoding.EncodeToString(certificateHash[:]),
		"state":           state, "goPID": os.Getpid(),
	}
	if deploymentDir != "" {
		fixture["transport"] = startGatewayTransportFixture(t, host)
		fixture["deployment"] = true
	}
	configuration, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(state, "fixture.json")
	if err := os.WriteFile(configPath, configuration, 0600); err != nil {
		t.Fatal(err)
	}
	if deploymentDir != "" {
		// The host runner owns the only published port and the Electron process.
		// No Runtime port is published outside this container's network namespace.
		configPath = filepath.Join(deploymentDir, "fixture.json")
		if err := os.WriteFile(configPath, configuration, 0600); err != nil {
			t.Fatal(err)
		}
		gatewayStopped := false
		for {
			if _, err := os.Stat(filepath.Join(deploymentDir, "finish")); err == nil {
				return
			}
			if _, err := os.Stat(filepath.Join(deploymentDir, "stop-gateway")); err == nil && !gatewayStopped {
				cancel()
				_ = server.Close()
				gatewayStopped = true
				if err := os.WriteFile(filepath.Join(deploymentDir, "gateway-stopped"), nil, 0600); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case <-t.Context().Done():
				t.Fatal("deployment fixture exceeded its lifetime")
			case <-time.After(50 * time.Millisecond):
			}
		}
	}
	command := exec.CommandContext(t.Context(), "node", "../../desktop/scripts/check-gateway-access-electron.mjs", configPath)
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		t.Fatalf("Gateway Electron qualification: %v", err)
	}
}

// A separate transport fixture exercises large bodies, redirects and flushing
// without adding test routes to the production Runtime.
func startGatewayTransportFixture(t *testing.T, host string) string {
	t.Helper()
	listener, err := net.Listen("tcp4", net.JoinHostPort(host, "0"))
	if err != nil {
		t.Fatal(err)
	}
	origin := "http://" + listener.Addr().String()
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/echo":
			body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20))
			if err != nil {
				http.Error(w, "Invalid fixture body", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(body)
		case "/redirect":
			http.Redirect(w, r, origin+"/echo", http.StatusFound)
		case "/stream":
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: ready\n\n")
			w.(http.Flusher).Flush()
			<-r.Context().Done()
		default:
			http.NotFound(w, r)
		}
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	return origin
}
