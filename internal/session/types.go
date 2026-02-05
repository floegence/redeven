package session

import (
	controlv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/controlplane/v1"
)

// Meta is the authoritative session metadata delivered by control plane over the direct control channel.
//
// Agents must NOT trust any permissions or app identifiers claimed by the browser on the data plane.
type Meta struct {
	ChannelID         string `json:"channel_id"`
	EndpointID        string `json:"endpoint_id"`
	FloeApp           string `json:"floe_app"`
	CodeSpaceID       string `json:"code_space_id,omitempty"`
	SessionKind       string `json:"session_kind,omitempty"`
	UserPublicID      string `json:"user_public_id"`
	UserEmail         string `json:"user_email"`
	NamespacePublicID string `json:"namespace_public_id"`
	CanRead           bool   `json:"can_read"`
	CanWrite          bool   `json:"can_write"`
	CanExecute        bool   `json:"can_execute"`
	// CanAdmin gates management actions on the data plane (e.g. codespace create/delete/rename).
	//
	// NOTE: this is the namespace-level "admin" bit computed by service metadata and delivered by control plane.
	// It is NOT part of the local permission_policy RWX clamp.
	CanAdmin        bool  `json:"can_admin"`
	CreatedAtUnixMs int64 `json:"created_at_unix_ms"`
}

// GrantServerNotify is a control-channel notification:
// - grant_server: tunnel server grant for the agent
// - session_meta: immutable permissions and routing info
type GrantServerNotify struct {
	GrantServer *controlv1.ChannelInitGrant `json:"grant_server"`
	SessionMeta *Meta                       `json:"session_meta"`
}
