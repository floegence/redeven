package config

// EnsureRuntimeIDs allocates local identifiers without changing an existing identity.
func (c *Config) EnsureRuntimeIDs() error {
	var err error
	if c.LocalEnvironmentPublicID == "" {
		c.LocalEnvironmentPublicID, err = newLocalEnvironmentPublicID()
		if err != nil {
			return err
		}
	}
	if c.AgentInstanceID == "" {
		c.AgentInstanceID, err = newAgentInstanceID()
	}
	return err
}

// ValidateGatewayManagement validates local membership only. It never grants
// Runtime Cloud authority or selects a network route.
func (c *Config) ValidateGatewayManagement() error {
	return c.ValidateLocalMinimal()
}
