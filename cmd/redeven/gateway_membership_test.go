package main

import (
	"crypto/tls"
	"net"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/gatewaymembership"
	"github.com/floegence/redeven/internal/testutil/gatewayfixture"
)

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
			if cfg.Gateway == nil || !reflect.DeepEqual(cfg.PermissionPolicy, policy) {
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
