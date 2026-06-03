package session

import (
	"errors"
	"fmt"
	"strings"
)

// ValidateGrantServerNotifyRemote validates a remote control-plane grant notification.
//
// Local direct sessions are initiated by the runtime itself and must not be routed through
// this remote grant_server contract.
func ValidateGrantServerNotifyRemote(n *GrantServerNotify, expectedEndpointID string) error {
	if n == nil {
		return errors.New("missing notify")
	}
	if n.GrantServer == nil {
		return errors.New("missing grant_server")
	}
	meta := n.SessionMeta
	if meta == nil {
		return errors.New("missing session_meta")
	}

	channelID := strings.TrimSpace(meta.ChannelID)
	if channelID == "" {
		return errors.New("missing session_meta.channel_id")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return errors.New("missing session_meta.endpoint_id")
	}
	expectedEndpointID = strings.TrimSpace(expectedEndpointID)
	if endpointID != expectedEndpointID {
		return fmt.Errorf("session_meta.endpoint_id mismatch: got %q want %q", endpointID, expectedEndpointID)
	}
	if strings.TrimSpace(meta.FloeApp) == "" {
		return errors.New("missing session_meta.floe_app")
	}
	if strings.TrimSpace(meta.UserPublicID) == "" {
		return errors.New("missing session_meta.user_public_id")
	}
	if strings.TrimSpace(meta.NamespacePublicID) == "" {
		return errors.New("missing session_meta.namespace_public_id")
	}
	if meta.CreatedAtUnixMs <= 0 {
		return errors.New("invalid session_meta.created_at_unix_ms")
	}

	grantChannelID := strings.TrimSpace(n.GrantServer.ChannelId)
	if grantChannelID == "" {
		return errors.New("missing grant_server.channel_id")
	}
	if grantChannelID != channelID {
		return fmt.Errorf("grant_server.channel_id mismatch: got %q want %q", grantChannelID, channelID)
	}
	return nil
}
