package config

import (
	"errors"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// PrepareGatewayJoin records local membership and any explicit ownership choice
// in one transaction. It never spends or restores the previous Cloud authority.
func (c *Config) PrepareGatewayJoin(invitation gp.MemberInvitation, metadata gp.MemberMetadata, choice string) (*Config, error) {
	if c == nil || (choice != "" && choice != "preserve" && choice != "new") {
		return nil, gatewaymembership.ErrState
	}
	if c.Gateway != nil {
		if c.Gateway.Leaving || c.Gateway.GatewayID != invitation.GatewayID || c.Gateway.Delegation.InvitationID != invitation.InvitationID || c.GatewayEnvironmentChoice != choice {
			return nil, gatewaymembership.ErrConflict
		}
		next := *c
		return &next, nil
	}
	existing := c.EnvironmentID != "" || c.GatewayMigrationEvidence != nil
	if existing && choice == "" {
		return nil, errors.New("choose preserve or new for the existing Cloud environment")
	}
	if !existing && choice != "" {
		return nil, errors.New("no existing Cloud environment to migrate")
	}
	if choice == "preserve" && c.GatewayRejoinRequired && c.GatewayMigrationEvidence == nil {
		return nil, errors.New("the original binding proof is unavailable; reauthorize the environment or choose new")
	}
	next := *c
	if err := next.EnsureRuntimeIDs(); err != nil {
		return nil, err
	}
	member, err := gatewaymembership.PrepareRuntime(invitation, next.LocalEnvironmentPublicID, metadata)
	if err != nil {
		return nil, err
	}
	next.Gateway, next.GatewayEnvironmentChoice = member, choice
	if choice == "new" {
		next.Direct, next.ControlArtifactPool = nil, nil
	}
	return &next, nil
}

// PrepareGatewayReplacement selects one new path and retains only removal work
// for the previous member. A stopped old Gateway cannot force a direct fallback.
func (c *Config) PrepareGatewayReplacement(invitation gp.MemberInvitation, metadata gp.MemberMetadata, choice string) (*Config, error) {
	if c == nil || c.Gateway == nil || c.Gateway.Delegation.InvitationID == invitation.InvitationID {
		return nil, gatewaymembership.ErrConflict
	}
	if len(c.GatewayRemovalOutbox) >= 16 {
		return nil, errors.New("deliver pending Gateway removals before replacing more memberships")
	}
	next := *c
	if err := next.RetireGatewayPublication(); err != nil {
		return nil, err
	}
	next.GatewayRemovalOutbox = append(append([]gatewaymembership.RemovalDelivery(nil), c.GatewayRemovalOutbox...), c.Gateway.RemovalDelivery())
	next.Gateway = nil
	return next.PrepareGatewayJoin(invitation, metadata, choice)
}
