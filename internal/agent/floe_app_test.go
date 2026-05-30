package agent

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

func TestSupportedFloeAppsIncludeFlowerExplicitly(t *testing.T) {
	tests := []struct {
		name    string
		floeApp string
		want    bool
	}{
		{name: "runtime app", floeApp: FloeAppRedevenAgent, want: true},
		{name: "code app", floeApp: FloeAppRedevenCode, want: true},
		{name: "port forward", floeApp: FloeAppRedevenPortForward, want: true},
		{name: "flower host", floeApp: FloeAppRedevenFlower, want: true},
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

func TestFlowerHostSessionUsesDedicatedHandler(t *testing.T) {
	a := &Agent{
		log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	meta := &session.Meta{
		ChannelID:   "ch_flower_handler",
		FloeApp:     FloeAppRedevenFlower,
		CodeSpaceID: "flower-host",
		SessionKind: sessionKindFlowerHostRPC,
		CanRead:     true,
		CanWrite:    true,
		CanExecute:  true,
	}

	err := a.serveFlowerHostSession(t.Context(), nil, meta)
	if err == nil || err.Error() != "missing session" {
		t.Fatalf("serveFlowerHostSession(nil) error = %v, want missing session", err)
	}
}

func TestFlowerHostGrantNotifyAppliesLocalPermissionClamp(t *testing.T) {
	fullAccess := config.PermissionSet{Read: true, Write: true, Execute: true}
	a := &Agent{
		cfg: &config.Config{
			EnvironmentID: "env_test",
			PermissionPolicy: &config.PermissionPolicy{
				SchemaVersion: 1,
				LocalMax:      &fullAccess,
			},
		},
		log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		sessions: map[string]*activeSession{},
	}

	notify := session.GrantServerNotify{
		GrantServer: &controlv1.ChannelInitGrant{ChannelId: "ch_flower"},
		SessionMeta: &session.Meta{
			ChannelID:    "ch_flower",
			EndpointID:   "env_test",
			FloeApp:      FloeAppRedevenFlower,
			CodeSpaceID:  "flower-host",
			SessionKind:  sessionKindFlowerHostRPC,
			UserPublicID: "u_test",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
	}
	payload, err := json.Marshal(notify)
	if err != nil {
		t.Fatalf("json.Marshal notify: %v", err)
	}

	a.handleGrantNotify(t.Context(), payload)

	a.mu.Lock()
	defer a.mu.Unlock()
	got := a.sessions["ch_flower"]
	if got == nil {
		t.Fatalf("Flower Host session was not accepted")
	}
	if !got.meta.CanRead || !got.meta.CanWrite || !got.meta.CanExecute {
		t.Fatalf("clamped permissions = R:%v W:%v X:%v, want full access", got.meta.CanRead, got.meta.CanWrite, got.meta.CanExecute)
	}
}

func TestFlowerHostGrantNotifyRejectsLocalPermissionClampBelowRWX(t *testing.T) {
	readOnly := config.PermissionSet{Read: true, Write: false, Execute: false}
	a := &Agent{
		cfg: &config.Config{
			EnvironmentID: "env_test",
			PermissionPolicy: &config.PermissionPolicy{
				SchemaVersion: 1,
				LocalMax:      &readOnly,
			},
		},
		log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		sessions: map[string]*activeSession{},
	}

	notify := session.GrantServerNotify{
		GrantServer: &controlv1.ChannelInitGrant{ChannelId: "ch_flower_read_only"},
		SessionMeta: &session.Meta{
			ChannelID:    "ch_flower_read_only",
			EndpointID:   "env_test",
			FloeApp:      FloeAppRedevenFlower,
			CodeSpaceID:  "flower-host",
			SessionKind:  sessionKindFlowerHostRPC,
			UserPublicID: "u_test",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   true,
		},
	}
	payload, err := json.Marshal(notify)
	if err != nil {
		t.Fatalf("json.Marshal notify: %v", err)
	}

	a.handleGrantNotify(t.Context(), payload)

	a.mu.Lock()
	defer a.mu.Unlock()
	if got := a.sessions["ch_flower_read_only"]; got != nil {
		t.Fatalf("Flower Host session below RWX was accepted: %#v", got.meta)
	}
}

func TestFlowerHostGrantNotifyNormalizesFloeAppBeforePermissionChecks(t *testing.T) {
	a := &Agent{
		cfg: &config.Config{
			EnvironmentID: "env_test",
		},
		log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		sessions: map[string]*activeSession{},
	}

	notify := session.GrantServerNotify{
		GrantServer: &controlv1.ChannelInitGrant{ChannelId: "ch_flower_trimmed"},
		SessionMeta: &session.Meta{
			ChannelID:    "ch_flower_trimmed",
			EndpointID:   "env_test",
			FloeApp:      " " + FloeAppRedevenFlower + " ",
			CodeSpaceID:  "flower-host",
			SessionKind:  sessionKindFlowerHostRPC,
			UserPublicID: "u_test",
			CanRead:      true,
			CanWrite:     true,
			CanExecute:   false,
		},
	}
	payload, err := json.Marshal(notify)
	if err != nil {
		t.Fatalf("json.Marshal notify: %v", err)
	}

	a.handleGrantNotify(t.Context(), payload)

	a.mu.Lock()
	defer a.mu.Unlock()
	if got := a.sessions["ch_flower_trimmed"]; got != nil {
		t.Fatalf("Flower Host session without execute permission was accepted after floe_app trim: %#v", got.meta)
	}
}

func TestFlowerHostGrantNotifyRejectsInvalidBinding(t *testing.T) {
	a := &Agent{
		cfg: &config.Config{
			EnvironmentID: "env_test",
		},
		log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		sessions: map[string]*activeSession{},
	}

	notify := session.GrantServerNotify{
		GrantServer: &controlv1.ChannelInitGrant{ChannelId: "ch_flower"},
		SessionMeta: &session.Meta{
			ChannelID:    "ch_flower",
			EndpointID:   "env_test",
			FloeApp:      FloeAppRedevenFlower,
			CodeSpaceID:  reservedEnvUICodeSpaceID,
			SessionKind:  sessionKindFlowerHostRPC,
			UserPublicID: "u_test",
			CanRead:      true,
		},
	}
	payload, err := json.Marshal(notify)
	if err != nil {
		t.Fatalf("json.Marshal notify: %v", err)
	}

	a.handleGrantNotify(t.Context(), payload)

	a.mu.Lock()
	defer a.mu.Unlock()
	if got := a.sessions["ch_flower"]; got != nil {
		t.Fatalf("invalid Flower Host binding was accepted: %#v", got.meta)
	}
}

func TestFlowerHostSessionBindingRequiresDedicatedSessionKind(t *testing.T) {
	tests := []struct {
		name string
		meta session.Meta
		want bool
	}{
		{
			name: "valid Flower Host RPC session",
			meta: session.Meta{FloeApp: FloeAppRedevenFlower, CodeSpaceID: "flower-host", SessionKind: sessionKindFlowerHostRPC},
			want: true,
		},
		{
			name: "env ui code space rejected",
			meta: session.Meta{FloeApp: FloeAppRedevenFlower, CodeSpaceID: reservedEnvUICodeSpaceID, SessionKind: sessionKindFlowerHostRPC},
			want: false,
		},
		{
			name: "env app rpc session kind rejected",
			meta: session.Meta{FloeApp: FloeAppRedevenFlower, CodeSpaceID: "flower-host", SessionKind: "envapp_rpc"},
			want: false,
		},
		{
			name: "invalid code space id rejected",
			meta: session.Meta{FloeApp: FloeAppRedevenFlower, CodeSpaceID: "../flower", SessionKind: sessionKindFlowerHostRPC},
			want: false,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := isValidFlowerHostSessionBinding(&tt.meta); got != tt.want {
				t.Fatalf("isValidFlowerHostSessionBinding(%#v) = %v, want %v", tt.meta, got, tt.want)
			}
		})
	}
}
