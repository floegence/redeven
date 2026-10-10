package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/gatewayservice"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

func TestStoppedGatewayUnpairPreservesOtherCloudOwner(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	root := t.TempDir()
	layout, err := resolveBootstrapTargetLayout(root)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for range 2 {
		reservation, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		address := reservation.Addr().String()
		_ = reservation.Close()
		hostToken := strings.Repeat("a", 43)
		gateway, err := gatewayservice.New(gatewayservice.Options{StateRoot: filepath.Join(t.TempDir(), "gateway"), HostAdminToken: hostToken, MemberURL: "https://" + address, MemberListen: address})
		if err != nil {
			t.Fatal(err)
		}
		server, _, err := gateway.Start(ctx, "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer server.Close()
		request := httptest.NewRequest(http.MethodPost, "http://localhost/gateway/v5/invitation-codes", strings.NewReader(`{"protocol_version":"redeven-gateway-v5"}`))
		request.RemoteAddr = "127.0.0.1:1234"
		request.Header.Set(gatewayservice.HostAdminHeader, hostToken)
		response := httptest.NewRecorder()
		gateway.Handler().ServeHTTP(response, request)
		var result struct {
			Data struct {
				Code      string `json:"code"`
				GatewayID string `json:"gateway_id"`
			} `json:"data"`
		}
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatal("invitation unavailable")
		}
		code, _, stderr := runCLITestWithStdin(t, result.Data.Code, "gateway", "join", "--state-root", root, "--gateway", "https://"+address, "--code-stdin", "--yes")
		if code != 0 {
			t.Fatalf("join: %s", stderr)
		}
		ids = append(ids, result.Data.GatewayID)
	}
	cfg, err := config.Load(layout.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	cloud := cfg.GatewayMember(ids[1]).Clone()
	cfg.GatewayCloudMemberID = cloud.MemberID
	if err := config.Save(layout.ConfigPath, cfg); err != nil {
		t.Fatal(err)
	}
	code, _, stderr := runCLITestWithStdin(t, "", "gateway", "leave", "--state-root", root, "--gateway-id", ids[0], "--yes")
	if code != 0 {
		t.Fatalf("leave: %s", stderr)
	}
	saved, err := config.Load(layout.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Gateways) != 1 || saved.CloudGateway() == nil || !reflect.DeepEqual(saved.CloudGateway(), cloud) {
		t.Fatal("unpairing retired another Gateway's Cloud owner")
	}
}

func TestRunningGatewayUnpairAcknowledgesOnlyObservedCloudImpact(t *testing.T) {
	root, err := os.MkdirTemp("/tmp", "gateway-cli-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	socket := filepath.Join(root, "control.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	acknowledgments := make(chan bool, 1)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/gateway/leave" {
			var body struct {
				Acknowledged bool `json:"cloud_impact_acknowledged"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			acknowledgments <- body.Acknowledged
		}
		_, _ = w.Write([]byte(`{"ok":true,"data":{"joined":true,"phase":"joined","memberships":[{"gateway_id":"one","member_id":"member","phase":"joined","joined":true}]}}`))
	})}
	go func() { _ = server.Serve(listener) }()
	defer server.Close()
	c := &cli{stdin: strings.NewReader(""), stdout: io.Discard, stderr: io.Discard}
	if code := c.gatewayRunningCommand(t.Context(), socket, "leave", "", "", "", "one", true); code != 0 {
		t.Fatal("leave failed")
	}
	if <-acknowledgments {
		t.Fatal("CLI acknowledged Cloud interruption absent from its confirmation")
	}
}

func TestGatewayJoinInitializesFreshRuntimeAndPreservesExistingPermissionCap(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	origin := "https://" + listener.Addr().String()
	store, _ := gatewayfixture.New(t, origin, listener.Addr().String())
	exchange, err := store.InvitationExchangeHandler()
	if err != nil {
		t.Fatal(err)
	}
	trust, err := store.TLSConfig()
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("GET "+gatewaymembership.InvitationExchangePath, exchange)
	server := &http.Server{Handler: mux, ReadHeaderTimeout: time.Second}
	done := make(chan struct{})
	go func() { defer close(done); _ = server.Serve(tls.NewListener(listener, trust)) }()
	t.Cleanup(func() { _ = server.Close(); <-done })
	for _, preset := range []string{"", "read_only"} {
		t.Run("permission_"+preset, func(t *testing.T) {
			root := t.TempDir()
			layout, err := resolveBootstrapTargetLayout(root)
			if err != nil {
				t.Fatal(err)
			}
			policy, err := config.ParsePermissionPolicyPreset(preset)
			if err != nil {
				t.Fatal(err)
			}
			if preset != "" {
				if err := config.Save(layout.ConfigPath, &config.Config{PermissionPolicy: policy}); err != nil {
					t.Fatal(err)
				}
			}
			delivery, err := store.IssueInvitationCode("admin")
			if err != nil {
				t.Fatal(err)
			}
			code, _, stderr := runCLITestWithStdin(t, delivery.Code+"\n", "gateway", "join", "--state-root", root, "--gateway", origin, "--code-stdin", "--yes")
			if code != 1 {
				t.Fatalf("pending enrollment code = %d: %s", code, stderr)
			}
			cfg, err := config.Load(layout.ConfigPath)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.GatewayMember("") == nil || !reflect.DeepEqual(cfg.PermissionPolicy, policy) {
				t.Fatal("confirmation lost local intent or changed Runtime permissions")
			}
			if err := cfg.ValidateGatewayManagement(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestGatewayRejectsRetiredFileFlagAndRequiresExplicitAutomationConsent(t *testing.T) {
	for _, args := range [][]string{{"gateway", "join", "--invitation-file", "invitation.json"}, {"gateway", "join", "--gateway", "https://gateway.example", "--code-stdin"}} {
		code, _, _ := runCLITestWithStdin(t, "secret", args...)
		if code != 2 {
			t.Fatalf("invalid flags accepted: %v", args)
		}
	}
}
