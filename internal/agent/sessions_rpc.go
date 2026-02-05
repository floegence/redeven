package agent

import (
	"context"
	"sort"
	"strings"

	"github.com/floegence/flowersec/flowersec-go/rpc"
	rpctyped "github.com/floegence/flowersec/flowersec-go/rpc/typed"
	"github.com/floegence/redeven-agent/internal/session"
)

const (
	// TypeID_SESSIONS_LIST_ACTIVE returns currently active Flowersec channel sessions on the agent (server side).
	//
	// NOTE: This is a UI/auditing endpoint and MUST NOT be used as an authorization source of truth.
	//
	// The type_id must match Env App: internal/envapp/ui_src/src/ui/protocol/redeven_v1/typeIds.ts.
	TypeID_SESSIONS_LIST_ACTIVE uint32 = 5001
)

type sessionsListActiveReq struct{}

type sessionsListActiveResp struct {
	Sessions []sessionsActiveSession `json:"sessions"`
}

type sessionsActiveSession struct {
	ChannelID string `json:"channel_id"`

	UserPublicID string `json:"user_public_id"`
	UserEmail    string `json:"user_email"`

	FloeApp     string `json:"floe_app"`
	CodeSpaceID string `json:"code_space_id,omitempty"`
	SessionKind string `json:"session_kind,omitempty"`
	TunnelURL   string `json:"tunnel_url"`

	CreatedAtUnixMs   int64 `json:"created_at_unix_ms"`
	ConnectedAtUnixMs int64 `json:"connected_at_unix_ms"`

	CanRead    bool `json:"can_read"`
	CanWrite   bool `json:"can_write"`
	CanExecute bool `json:"can_execute"`
}

func (a *Agent) registerSessionsRPC(r *rpc.Router, meta *session.Meta) {
	if a == nil || r == nil {
		return
	}

	rpctyped.Register[sessionsListActiveReq, sessionsListActiveResp](r, TypeID_SESSIONS_LIST_ACTIVE, func(_ctx context.Context, _ *sessionsListActiveReq) (*sessionsListActiveResp, error) {
		// This is a read-only observability endpoint that returns session metadata.
		// Gate it by read permission to avoid leaking user identities / connection metadata
		// when the session is clamped to no permissions.
		if meta == nil || !meta.CanRead {
			return nil, &rpc.Error{Code: 403, Message: "read permission denied"}
		}
		return &sessionsListActiveResp{Sessions: a.listActiveSessionsSnapshot()}, nil
	})
}

func (a *Agent) listActiveSessionsSnapshot() []sessionsActiveSession {
	if a == nil {
		return nil
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	out := make([]sessionsActiveSession, 0, len(a.sessions))
	for channelID, s := range a.sessions {
		if s == nil {
			continue
		}
		connectedAt := s.connectedAtUnixMs
		if connectedAt <= 0 {
			// Only expose sessions that have successfully connected to the tunnel.
			continue
		}

		m := s.meta
		out = append(out, sessionsActiveSession{
			ChannelID:         strings.TrimSpace(channelID),
			UserPublicID:      strings.TrimSpace(m.UserPublicID),
			UserEmail:         strings.TrimSpace(m.UserEmail),
			FloeApp:           strings.TrimSpace(m.FloeApp),
			CodeSpaceID:       strings.TrimSpace(m.CodeSpaceID),
			SessionKind:       strings.TrimSpace(m.SessionKind),
			TunnelURL:         strings.TrimSpace(s.tunnelURL),
			CreatedAtUnixMs:   m.CreatedAtUnixMs,
			ConnectedAtUnixMs: connectedAt,
			CanRead:           m.CanRead,
			CanWrite:          m.CanWrite,
			CanExecute:        m.CanExecute,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].ConnectedAtUnixMs > out[j].ConnectedAtUnixMs
	})

	return out
}
