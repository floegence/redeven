package config

import (
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
	next.GatewayRemovalOutbox = append(append([]gatewaymembership.RemovalDelivery(nil), c.GatewayRemovalOutbox...), c.Gateways[0].RemovalDelivery())
	next.Gateways = nil
	return next.PrepareGatewayJoin(invitation, metadata, "")
}
