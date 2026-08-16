package agent

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"testing"
	"time"

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

	notify := session.GrantServerNotify{
		GrantServer: &session.ChannelInitGrant{
			ChannelID:              " ch_remote ",
			ArtifactJSON:           []byte(controlArtifactFixture),
			ArtifactExpiresAtUnixS: time.Now().Add(2 * time.Minute).Unix(),
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

	// Exact duplicates are idempotent. A conflicting artifact for the same
	// channel cannot replace the active owner.
	a.handleGrantNotify(ctx, payload)
	conflict := notify
	conflictGrant := *notify.GrantServer
	conflictGrant.ArtifactJSON = []byte(`{"conflicting":true}`)
	conflict.GrantServer = &conflictGrant
	conflictPayload, err := json.Marshal(conflict)
	if err != nil {
		t.Fatal(err)
	}
	a.handleGrantNotify(ctx, conflictPayload)
	a.mu.Lock()
	afterConflict := a.sessions["ch_remote"]
	a.mu.Unlock()
	if afterConflict != accepted || afterConflict.grantDigest != sha256.Sum256(notify.GrantServer.ArtifactJSON) {
		t.Fatal("conflicting grant replaced the active session owner")
	}
}

func TestGrantNotifyRejectsUnknownFields(t *testing.T) {
	a := &Agent{
		cfg:      &config.Config{EnvironmentID: "env_test", PermissionPolicy: defaultPermissionPolicyForAgentTest(t)},
		log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		sessions: map[string]*activeSession{},
	}
	payload := []byte(`{
  "grant_server":{"channel_id":"ch_unknown","artifact_json":{"v":2},"artifact_expires_at_unix_s":` + fmt.Sprint(time.Now().Add(2*time.Minute).Unix()) + `},
  "session_meta":{"channel_id":"ch_unknown","endpoint_id":"env_test","floe_app":"com.floegence.redeven.agent","user_public_id":"user_test","namespace_public_id":"ns_test","created_at_unix_ms":1700000000000,"legacy":true}
}`)
	a.handleGrantNotify(context.Background(), payload)
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.sessions) != 0 {
		t.Fatal("grant notification with an unknown nested field was accepted")
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
		GrantServer: &session.ChannelInitGrant{
			ChannelID:              "ch_missing_identity",
			ArtifactJSON:           []byte(controlArtifactFixture),
			ArtifactExpiresAtUnixS: time.Now().Add(2 * time.Minute).Unix(),
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

func TestGrantNotifyRejectsSessionAfterShutdownAdmissionCloses(t *testing.T) {
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
	a.beginSessionShutdown()

	notify := session.GrantServerNotify{
		GrantServer: &session.ChannelInitGrant{
			ChannelID:              "ch_after_shutdown",
			ArtifactJSON:           []byte(controlArtifactFixture),
			ArtifactExpiresAtUnixS: time.Now().Add(2 * time.Minute).Unix(),
		},
		SessionMeta: &session.Meta{
			ChannelID:         "ch_after_shutdown",
			EndpointID:        "env_test",
			FloeApp:           FloeAppRedevenAgent,
			CodeSpaceID:       "env-ui",
			SessionKind:       "envapp_proxy",
			UserPublicID:      "u_remote",
			NamespacePublicID: "ns_remote",
			CanRead:           true,
			CanWrite:          true,
			CanExecute:        true,
			CreatedAtUnixMs:   1_700_000_000_000,
		},
	}
	payload, err := json.Marshal(notify)
	if err != nil {
		t.Fatal(err)
	}
	a.handleGrantNotify(context.Background(), payload)

	a.mu.Lock()
	_, exists := a.sessions["ch_after_shutdown"]
	a.mu.Unlock()
	if exists {
		t.Fatal("shutdown admission gate accepted a remote session")
	}
	if !a.waitForSessions(50 * time.Millisecond) {
		t.Fatal("shutdown admission rejection changed the session wait group")
	}
	if status := gate.Status("ch_after_shutdown"); status.FloeApp != "" {
		t.Fatalf("rejected session was registered in access gate: %#v", status)
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
