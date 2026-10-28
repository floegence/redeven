package localui

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/webbinding"
)

func TestGatewayOnlyOwnerCanManageMembershipWithoutTCP(t *testing.T) {
	s := newTestServer(t, accessgate.New(accessgate.Options{}))
	s.a = newRuntimeHealthTestAgent(t, s.configPath, s.accessGate)
	socketDir, err := os.MkdirTemp("/tmp", "rdv-member-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(socketDir)
	s.runtimeControlSockPath = filepath.Join(socketDir, "control.sock")
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	if err := s.StartGatewayOnly(ctx); err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	info, err := os.Stat(s.runtimeControlSockPath)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("management socket is not owner-only", err)
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", s.runtimeControlSockPath)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: time.Second}
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:1/v2/gateway/status", nil)
	request.Header.Set("X-Redeven-Runtime-Control-Protocol", runtimeControlProtocolVersion)
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("owner status: %d", response.StatusCode)
	}
	request.Header.Set("Origin", "https://member.example")
	response, err = client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatal("browser request acquired owner authority")
	}
	// The same route without the socket capability remains token authenticated.
	record := httptest.NewRecorder()
	request.Header.Del("Origin")
	request.RemoteAddr = "127.0.0.1:1234"
	s.runtimeControl.routes().ServeHTTP(record, request)
	if record.Code != http.StatusUnauthorized {
		t.Fatalf("application path acquired owner authority: %d", record.Code)
	}
}

func TestWebBindingConsentRequiresOwnerSocket(t *testing.T) {
	s := newTestServer(t, accessgate.New(accessgate.Options{Password: "test password"}))
	s.a = newRuntimeHealthTestAgent(t, s.configPath, s.accessGate)
	store, err := webbinding.Open(t.TempDir(), s.a.RuntimePublicID())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	control, err := newRuntimeControlServer(s.a, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	control.webBindings = store
	cert := webConnectorCertificate(t)
	binding := webbinding.Binding{ID: "entry", RuntimeID: s.a.RuntimePublicID(), AppScope: "envapp", Origin: "https://env.example.com", PublicKeySHA256: webbinding.PublicKeyFingerprint(cert.Leaf), Enabled: true}
	raw, _ := json.Marshal(binding)
	call := func(owner bool, origin, token string, body []byte) *httptest.ResponseRecorder {
		req := httptest.NewRequest("PUT", "http://127.0.0.1:1/v2/runtime/web-bindings", strings.NewReader(string(body)))
		req.Header.Set("Origin", origin)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Redeven-Runtime-Control-Protocol", runtimeControlProtocolVersion)
		rec := httptest.NewRecorder()
		if owner {
			control.ownerSocketHandler().ServeHTTP(rec, req)
		} else {
			control.routes().ServeHTTP(rec, req)
		}
		return rec
	}
	if rec := call(false, "", control.token, raw); rec.Code != 403 {
		t.Fatalf("native token acquired binding authority: %d", rec.Code)
	}
	if rec := call(true, "https://env.example.com", "", raw); rec.Code != 403 {
		t.Fatal("browser acquired owner authority")
	}
	if rec := call(true, "", "", raw); rec.Code != 200 {
		t.Fatalf("owner binding: %d %s", rec.Code, rec.Body.String())
	}
	if rec := call(true, "", "", raw); rec.Code != 409 {
		t.Fatal("stale consent accepted")
	}
	binding.RuntimeID = "different-runtime"
	raw, _ = json.Marshal(binding)
	if rec := call(true, "", "", raw); rec.Code != 400 {
		t.Fatal("foreign Runtime accepted")
	}
}
