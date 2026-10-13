package config

import "github.com/floegence/redeven/internal/gatewaymembership"

// GatewayMember resolves an explicit identity. An omitted identity is accepted
// only when the collection has one member, never by selecting an arbitrary route.
func (c *Config) GatewayMember(id string) *gatewaymembership.RuntimeConfig {
	if c == nil {
		return nil
	}
	if id == "" && len(c.Gateways) == 1 {
		return c.Gateways[0]
	}
	for _, member := range c.Gateways {
		if member != nil && member.GatewayID == id {
			return member
		}
	}
	return nil
}

// CloudGateway returns only the explicitly selected transport member.
func (c *Config) CloudGateway() *gatewaymembership.RuntimeConfig {
	return c.CloudRouteMember()
}

func (c *Config) CloneGateways() []*gatewaymembership.RuntimeConfig {
	if c == nil {
		return nil
	}
	members := make([]*gatewaymembership.RuntimeConfig, len(c.Gateways))
	for i, member := range c.Gateways {
		members[i] = member.Clone()
	}
	return members
}

// SetGatewayMember copies the collection so a failed save leaves its owner intact.
func (c *Config) SetGatewayMember(id string, member *gatewaymembership.RuntimeConfig) {
	members := make([]*gatewaymembership.RuntimeConfig, 0, len(c.Gateways)+1)
	found := false
	for _, current := range c.Gateways {
		if current.GatewayID != id {
			members = append(members, current)
			continue
		}
		found = true
		if member != nil {
			members = append(members, member.Clone())
		}
	}
	if !found && member != nil {
		members = append(members, member.Clone())
	}
	c.Gateways = members
}
