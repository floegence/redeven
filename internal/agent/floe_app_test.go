package agent

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
	"github.com/floegence/redeven/internal/accessgate"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestSupportedFloeAppsExcludeLegacyFlowerControlPlaneApp(t *testing.T) {
	tests := []struct {
		name    string
		floeApp string
		want    bool
	}{
		{name: "runtime app", floeApp: FloeAppRedevenAgent, want: true},
		{name: "code app", floeApp: FloeAppRedevenCode, want: true},
		{name: "port forward", floeApp: FloeAppRedevenPortForward, want: true},
		{name: "unknown app remains rejected", floeApp: "com.example.app", want: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isSupportedFloeApp(tt.floeApp); got != tt.want {
				t.Fatalf("isSupportedFloeApp(%q) = %v, want %v", tt.floeApp, got, tt.want)
			}
		})
	}
}

func TestGrantNotifyAcceptsValidRemoteSessionAndRegistersAccessGate(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	blockingTunnel := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		time.Sleep(5 * time.Second)
	}))
	t.Cleanup(blockingTunnel.Close)

	notify := session.GrantServerNotify{
		GrantServer: &controlv1.ChannelInitGrant{
			ChannelId: " ch_remote ",
			TunnelUrl: "ws" + strings.TrimPrefix(blockingTunnel.URL, "http") + "/tunnel/ws",
		},
		SessionMeta: &session.Meta{
			ChannelID:         "ch_remote",
			EndpointID:        "env_test",
			FloeApp:           FloeAppRedevenAgent,
			CodeSpaceID:       "env-ui",
			SessionKind:       "envapp_proxy",
			UserPublicID:      "u_remote",
			UserEmail:         "u_remote@example.test",
			NamespacePublicID: "ns_remote",
			CanRead:           true,
			CanWrite:          true,
			CanExecute:        true,
			CreatedAtUnixMs:   1_700_000_000_000,
		},
	}
	payload, err := json.Marshal(notify)
	if err != nil {
		t.Fatalf("json.Marshal notify: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	a := &Agent{
		cfg: &config.Config{
			EnvironmentID:       "env_test",
			ControlplaneBaseURL: "https://control.example.test",
			PermissionPolicy:    defaultPermissionPolicyForAgentTest(t),
		},
		log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		sessions:   map[string]*activeSession{},
		accessGate: gate,
	}

	a.handleGrantNotify(ctx, payload)

	var accepted *activeSession
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		a.mu.Lock()
		accepted = a.sessions["ch_remote"]
		a.mu.Unlock()
		if accepted != nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if accepted == nil {
		t.Fatalf("valid remote grant_server notify did not create an active session")
	}
	if accepted.meta.UserPublicID != "u_remote" || accepted.meta.NamespacePublicID != "ns_remote" {
		t.Fatalf("remote session identity was not preserved: %#v", accepted.meta)
	}
	if accepted.meta.FloeApp != FloeAppRedevenAgent || accepted.meta.EndpointID != "env_test" {
		t.Fatalf("remote session contract fields were not normalized: %#v", accepted.meta)
	}
	if status := gate.Status("ch_remote"); !status.PasswordRequired || status.Unlocked {
		t.Fatalf("remote session should be registered in a locked access gate state: %#v", status)
	}
}

func TestGrantNotifyRejectsMissingRemoteIdentityBeforeRegisteringAccessGate(t *testing.T) {
	gate := accessgate.New(accessgate.Options{Password: "secret"})
	a := &Agent{
		cfg: &config.Config{
			EnvironmentID:    "env_test",
			PermissionPolicy: defaultPermissionPolicyForAgentTest(t),
		},
		log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
		sessions:   map[string]*activeSession{},
		accessGate: gate,
	}

	notify := session.GrantServerNotify{
		GrantServer: &controlv1.ChannelInitGrant{
			ChannelId: "ch_missing_identity",
			TunnelUrl: "ws://127.0.0.1:1/tunnel/ws",
		},
		SessionMeta: &session.Meta{
			ChannelID:         "ch_missing_identity",
			EndpointID:        "env_test",
			FloeApp:           FloeAppRedevenAgent,
			NamespacePublicID: "ns_remote",
			CanRead:           true,
			CanWrite:          true,
			CanExecute:        true,
			CreatedAtUnixMs:   1_700_000_000_000,
		},
	}
	payload, err := json.Marshal(notify)
	if err != nil {
		t.Fatalf("json.Marshal notify: %v", err)
	}

	a.handleGrantNotify(context.Background(), payload)

	a.mu.Lock()
	accepted := a.sessions["ch_missing_identity"]
	a.mu.Unlock()
	if accepted != nil {
		t.Fatalf("remote grant_server without user_public_id was accepted: %#v", accepted.meta)
	}
	if unlock, err := gate.UnlockChannel("ch_missing_identity", "secret"); err == nil || unlock != nil {
		t.Fatalf("invalid remote session should not be unlockable because it must not be registered: unlock=%#v err=%v", unlock, err)
	}
}

func defaultPermissionPolicyForAgentTest(t *testing.T) *config.PermissionPolicy {
	t.Helper()
	policy, err := config.ParsePermissionPolicyPreset("")
	if err != nil {
		t.Fatalf("ParsePermissionPolicyPreset() error = %v", err)
	}
	return policy
}
