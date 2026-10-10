package config

import (
	"errors"
	"github.com/floegence/redeven/internal/gatewaymembership"
	gp "github.com/floegence/redeven/internal/runtimegateway/protocol"
)

// PrepareGatewayJoin adds local access only. Cloud authority is unchanged.
func (c *Config) PrepareGatewayJoin(invitation gp.EnrollmentDescriptor, metadata gp.MemberMetadata, choice string) (*Config, error) {
	if c == nil || choice != "" {
		return nil, gatewaymembership.ErrState
	}
	if current := c.GatewayMember(invitation.GatewayID); current != nil {
		if current.Leaving || current.Delegation.InvitationID != invitation.InvitationID {
			return nil, gatewaymembership.ErrConflict
		}
		next := *c
		return &next, nil
	}
	if len(c.Gateways) >= 16 {
		return nil, gatewaymembership.ErrCapacity
	}
	next := *c
	if err := next.EnsureRuntimeIDs(); err != nil {
		return nil, err
	}
	member, err := gatewaymembership.PrepareRuntime(invitation, next.LocalEnvironmentPublicID, metadata)
	if err != nil {
		return nil, err
	}
	next.SetGatewayMember(invitation.GatewayID, member)
	return &next, nil
}

// PrepareGatewayPublication is a separate explicit Cloud settings transaction.
func (c *Config) PrepareGatewayPublication(gatewayID, choice string) (*Config, error) {
	member := c.GatewayMember(gatewayID)
	if member == nil || member.Leaving || member.PendingJoin != nil || c.GatewayPublication != nil {
		return nil, gatewaymembership.ErrState
	}
	existing := c.EnvironmentID != "" || c.GatewayMigrationEvidence != nil
	if existing && choice != "preserve" && choice != "new" {
		return nil, errors.New("choose preserve or new for the existing Cloud environment")
	}
	if !existing && choice != "" {
		return nil, errors.New("no existing Cloud environment to migrate")
	}
	if choice == "preserve" && c.GatewayRejoinRequired && c.GatewayMigrationEvidence == nil {
		return nil, errors.New("the original binding proof is unavailable; reauthorize the environment or choose new")
	}
	next := *c
	next.GatewayCloudMemberID, next.GatewayEnvironmentChoice = member.MemberID, choice
	if choice == "new" {
		next.Direct, next.ControlArtifactPool = nil, nil
	}
	return &next, nil
}

// Replacement is retained only as an explicit single-member operation.
func (c *Config) PrepareGatewayReplacement(invitation gp.EnrollmentDescriptor, metadata gp.MemberMetadata, choice string) (*Config, error) {
	if c == nil || len(c.Gateways) != 1 || choice != "" {
		return nil, gatewaymembership.ErrConflict
	}
	if c.Gateways[0].Delegation.InvitationID == invitation.InvitationID {
		return c.PrepareGatewayJoin(invitation, metadata, choice)
	}
	if len(c.GatewayRemovalOutbox) >= 16 {
		return nil, gatewaymembership.ErrCapacity
	}
	next := *c
	if next.CloudGateway() != nil {
		if err := next.RetireGatewayPublication(); err != nil {
			return nil, err
		}
	}
	next.GatewayRemovalOutbox = append(append([]gatewaymembership.RemovalDelivery(nil), c.GatewayRemovalOutbox...), c.Gateways[0].RemovalDelivery())
	next.Gateways = nil
	return next.PrepareGatewayJoin(invitation, metadata, "")
}
