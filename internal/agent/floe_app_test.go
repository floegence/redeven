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

func TestSupportedFloeAppsExcludeLegacyFlowerControlPlaneApp(t *testing.T) {
	tests := []struct {
		name    string
		floeApp string
		want    bool
	}{
		{name: "runtime app", floeApp: FloeAppRedevenAgent, want: true},
		{name: "code app", floeApp: FloeAppRedevenCode, want: true},
		{name: "port forward", floeApp: FloeAppRedevenPortForward, want: true},
		{name: "legacy flower app", floeApp: legacyFlowerFloeAppForTest(), want: false},
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

func TestGrantNotifyRejectsLegacyFlowerControlPlaneSession(t *testing.T) {
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
			FloeApp:      legacyFlowerFloeAppForTest(),
			CodeSpaceID:  "flower-host",
			SessionKind:  legacyFlowerSessionKindForTest(),
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
	if got := a.sessions["ch_flower"]; got != nil {
		t.Fatalf("legacy Flower control-plane session was accepted: %#v", got.meta)
	}
}

func legacyFlowerFloeAppForTest() string {
	return "com.floegence.redeven." + "flower"
}

func legacyFlowerSessionKindForTest() string {
	return "flower_host_" + "rpc"
}
