package session

import (
	"strings"
	"testing"

	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
)

func TestValidateGrantServerNotifyRemote(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		mutate    func(*GrantServerNotify)
		wantError string
	}{
		{
			name: "accepts remote session without email",
			mutate: func(n *GrantServerNotify) {
				n.GrantServer.ChannelId = " ch_remote "
				n.SessionMeta.UserEmail = ""
			},
		},
		{
			name: "rejects missing user public id",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta.UserPublicID = " \t "
			},
			wantError: "user_public_id",
		},
		{
			name: "rejects missing namespace public id",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta.NamespacePublicID = ""
			},
			wantError: "namespace_public_id",
		},
		{
			name: "rejects missing endpoint id",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta.EndpointID = " "
			},
			wantError: "endpoint_id",
		},
		{
			name: "rejects missing floe app",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta.FloeApp = "\t"
			},
			wantError: "floe_app",
		},
		{
			name: "rejects zero created at",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta.CreatedAtUnixMs = 0
			},
			wantError: "created_at_unix_ms",
		},
		{
			name: "rejects negative created at",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta.CreatedAtUnixMs = -1
			},
			wantError: "created_at_unix_ms",
		},
		{
			name: "trims matching grant channel id",
			mutate: func(n *GrantServerNotify) {
				n.GrantServer.ChannelId = "  ch_remote  "
			},
		},
		{
			name: "rejects mismatched grant channel id",
			mutate: func(n *GrantServerNotify) {
				n.GrantServer.ChannelId = "ch_other"
			},
			wantError: "grant_server.channel_id mismatch",
		},
		{
			name: "rejects endpoint mismatch",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta.EndpointID = "env_other"
			},
			wantError: "endpoint_id mismatch",
		},
		{
			name: "rejects missing grant server",
			mutate: func(n *GrantServerNotify) {
				n.GrantServer = nil
			},
			wantError: "grant_server",
		},
		{
			name: "rejects missing session meta",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta = nil
			},
			wantError: "session_meta",
		},
		{
			name: "rejects missing session channel id",
			mutate: func(n *GrantServerNotify) {
				n.SessionMeta.ChannelID = " "
			},
			wantError: "channel_id",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			notify := validRemoteNotifyForTest()
			if tt.mutate != nil {
				tt.mutate(&notify)
			}

			err := ValidateGrantServerNotifyRemote(&notify, "env_test")
			if tt.wantError == "" {
				if err != nil {
					t.Fatalf("ValidateGrantServerNotifyRemote() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf("ValidateGrantServerNotifyRemote() error = %v, want containing %q", err, tt.wantError)
			}
		})
	}
}

func TestValidateGrantServerNotifyRemoteRejectsMissingNotify(t *testing.T) {
	t.Parallel()

	err := ValidateGrantServerNotifyRemote(nil, "env_test")
	if err == nil || !strings.Contains(err.Error(), "missing notify") {
		t.Fatalf("ValidateGrantServerNotifyRemote(nil) error = %v, want missing notify", err)
	}
}

func validRemoteNotifyForTest() GrantServerNotify {
	return GrantServerNotify{
		GrantServer: &controlv1.ChannelInitGrant{
			ChannelId: "ch_remote",
			TunnelUrl: "https://tunnel.example.test/ch_remote",
		},
		SessionMeta: &Meta{
			ChannelID:         "ch_remote",
			EndpointID:        "env_test",
			FloeApp:           "com.floegence.redeven.agent",
			CodeSpaceID:       "env-ui",
			SessionKind:       "envapp_proxy",
			UserPublicID:      "user_test",
			UserEmail:         "user@example.test",
			NamespacePublicID: "ns_test",
			CanRead:           true,
			CanWrite:          true,
			CanExecute:        true,
			CreatedAtUnixMs:   1_700_000_000_000,
		},
	}
}
