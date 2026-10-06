package localui

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/gatewayservice"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
	"github.com/pquerna/otp/totp"
)

// Exercise the real public Runtime application without Runtime TCP listeners,
// Cloud, URL profiles, HTTP rewriting, or global Chromium certificate overrides.
func TestGatewayMemberBrowserSession(t *testing.T) {
	if os.Getenv("REDEVEN_GATEWAY_ACCESS_BROWSER") != "1" {
		t.Skip("run scripts/check_gateway_access_browser.sh")
	}
	state := t.TempDir()
	workspace := filepath.Join(state, "workspace")
	if err := os.MkdirAll(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "gateway-member.txt"), []byte("Gateway editor qualification\n"), 0600); err != nil {
		t.Fatal(err)
	}
	webService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		if r.Method == http.MethodPost {
			_, _ = io.Copy(w, r.Body)
			return
		}
		_, _ = w.Write([]byte("Gateway web service qualification"))
	}))
	defer webService.Close()
	reservation, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	memberAddress := reservation.Addr().String()
	reservation.Close()
	hostToken := strings.Repeat("a", 43)
	gateway, err := gatewayservice.New(gatewayservice.Options{StateRoot: filepath.Join(state, "gateway"), PairingCode: "qualification-code", HostAdminToken: hostToken, MemberURL: "https://" + memberAddress, MemberListen: memberAddress})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	server, listeners, err := gateway.Start(ctx, "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	start := func(mfa bool) (*Server, []string) {
		state := t.TempDir()
		hash, err := accessgate.HashPassword("gateway-fixture-password")
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
		runtime.log = slog.Default()
		runtime.a = newRuntimeHealthTestAgent(t, runtime.configPath, gate)
		runtime.appServer = runtime.a.CodeAppServer()
		request := httptest.NewRequest(http.MethodPost, "http://localhost/gateway/v4/invitations", strings.NewReader(`{"protocol_version":"redeven-gateway-v4"}`))
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set(gatewayservice.HostAdminHeader, hostToken)
		response := httptest.NewRecorder()
		gateway.Handler().ServeHTTP(response, request)
		var envelope struct {
			OK   bool                `json:"ok"`
			Data gp.MemberInvitation `json:"data"`
		}
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &envelope) != nil {
			t.Fatal("invitation unavailable", response.Code)
		}
		if err := runtime.a.JoinGateway(envelope.Data, ""); err != nil {
			t.Fatal(err)
		}
		if err := runtime.StartGatewayOnly(ctx); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { runtime.Close(); gate.Close() })
		if runtime.Port() != 0 || len(runtime.listeners) != 0 || runtime.desktopBridgeListener != nil || runtime.runtimeControl.ln != nil {
			t.Fatal("Runtime opened TCP ingress")
		}
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) && runtime.a.GatewayMembershipStatus().Phase != "joined" {
			time.Sleep(25 * time.Millisecond)
		}
		if runtime.a.GatewayMembershipStatus().Phase != "joined" {
			t.Fatal("outbound membership did not connect")
		}
		var recovery []string
		if mfa {
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
			recovery = verified.RecoveryCodes
		}
		return runtime, recovery
	}
	plain, _ := start(false)
	secure, recovery := start(true)
	fixture := map[string]any{"gateway": "http://" + listeners[0].Addr().String() + "/", "plainMember": plain.a.GatewayMembership().MemberID, "secureMember": secure.a.GatewayMembership().MemberID, "recoveryCodes": recovery, "state": state, "goPID": os.Getpid(), "workspace": workspace, "webService": webService.URL}
	configPath := filepath.Join(state, "fixture.json")
	raw, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(configPath, raw, 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, "node", "../../desktop/scripts/check-gateway-access-electron.mjs", configPath)
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		t.Fatal("Gateway member Electron qualification", err)
	}
}
