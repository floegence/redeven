package localui

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
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
