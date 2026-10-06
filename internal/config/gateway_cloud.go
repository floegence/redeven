package config

import (
	"encoding/json"
	"errors"
	"github.com/floegence/redeven/internal/gatewaycloud"
	"time"
)

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

// ApplyGatewayDelivery validates the same pool contract used by Runtime-link.
func (c *Config) ApplyGatewayDelivery(delivery *gatewaycloud.CredentialDelivery) error {
	if c == nil || c.GatewayPublication == nil || c.GatewayPublication.Binding == nil || delivery == nil || delivery.Binding != *c.GatewayPublication.Binding || delivery.DeliveryRequestID != c.GatewayPublication.DeliveryRequestID || delivery.CloudOrigin != c.GatewayPublication.CloudOrigin || delivery.RegionOrigin != c.GatewayPublication.RegionOrigin {
		return errors.New("gateway delivery binding mismatch")
	}
	var raw bootstrapControlArtifactPool
	if json.Unmarshal(delivery.ControlArtifactPool, &raw) != nil {
		return errors.New("invalid Gateway control pool")
	}
	pool, err := controlArtifactPoolFromDelivery(raw, delivery.Binding.Generation, time.Now(), false)
	if err != nil {
		return err
	}
	if pool.LogicalBindingID != "gateway-cloud-v2:"+delivery.Binding.PublicID {
		return errors.New("gateway control pool identity mismatch")
	}
	if c.ControlArtifactPool != nil && c.ControlArtifactPool.LogicalBindingID == pool.LogicalBindingID && c.ControlArtifactPool.BindingGeneration == pool.BindingGeneration {
		var highest uint64
		for _, entry := range c.ControlArtifactPool.Entries {
			if entry.Sequence > highest {
				highest = entry.Sequence
			}
		}
		if pool.Entries[0].Sequence <= highest {
			return errors.New("gateway credential delivery did not advance sequence")
		}
	}
	c.ProviderOrigin = delivery.CloudOrigin
	c.ControlplaneBaseURL = delivery.RegionOrigin
	c.ControlplaneProviderID = "redeven"
	c.EnvironmentID = delivery.Binding.EnvPublicID
	c.LocalEnvironmentPublicID = delivery.Binding.RuntimePublicID
	c.BindingGeneration = delivery.Binding.Generation
	c.ControlArtifactPool = pool
	c.Direct = nil
	next := *c.GatewayPublication
	next.DeliveryRequestID = ""
	next.Proven = true

	c.GatewayPublication = &next
	c.GatewayRejoinRequired = false
	c.GatewayMigrationEvidence = nil
	c.GatewayEnvironmentChoice = ""
	return nil
}

// validateGatewayBinding rejects partially changed paths before spending credentials.
func (c *Config) validateGatewayBinding() error {
	return c.validateGatewayPath(false)
}

// ValidateGatewayManagement permits the process to observe revocation or retry
// authenticated credential recovery. It does not authorize control or sessions.
func (c *Config) ValidateGatewayManagement() error {
	if c == nil || c.Gateway == nil || c.AgentInstanceID == "" {
		return errors.New("gateway management is not configured")
	}
	if err := c.ValidateLocalMinimal(); err != nil {
		return err
	}
	if err := c.Gateway.Validate(c.LocalEnvironmentPublicID); err != nil {
		return err
	}
	if c.GatewayPublication == nil {
		return nil
	}
	if c.GatewayPublication.Binding == nil {
		if err := c.GatewayPublication.ValidateMember(c.Gateway); err != nil {
			return err
		}
		_, err := c.GatewayPublication.Identity()
		return err
	}
	return c.validateGatewayPath(true)
}

func (c *Config) validateGatewayPath(allowRevoked bool) error {
	if c.GatewayPublication == nil {
		if c.Gateway != nil || c.GatewayMigrationEvidence != nil || c.GatewayRejoinRequired {
			return errors.New("gateway publication requires explicit binding approval")
		}
		return nil
	}
	r := c.GatewayPublication
	if err := r.ValidateMember(c.Gateway); err != nil {
		return err
	}
	if c.Gateway.Leaving && !allowRevoked {
		return errors.New("gateway membership is leaving")
	}
	if _, err := r.Identity(); err != nil {
		return err
	}
	b := r.Binding
	if (r.Revoked && !allowRevoked) || b == nil || c.ProviderOrigin != r.CloudOrigin || c.ControlplaneBaseURL != r.RegionOrigin || c.ControlplaneProviderID != "redeven" || c.EnvironmentID != b.EnvPublicID || c.LocalEnvironmentPublicID != b.RuntimePublicID || c.BindingGeneration != b.Generation || c.Direct != nil {
		return errors.New("gateway path and runtime binding do not match")
	}
	if c.ControlArtifactPool != nil && (c.ControlArtifactPool.LogicalBindingID != "gateway-cloud-v2:"+b.PublicID || c.ControlArtifactPool.BindingGeneration != b.Generation) {
		return errors.New("gateway path and control pool do not match")
	}
	return nil
}
