package config

import (
	"bytes"
	"encoding/json"
	"errors"

	"github.com/floegence/redeven/internal/gatewaycloud"
)

// retireLegacyGateway is a one-time reader, never a protocol compatibility path.
// Unknown legacy network fields are intentionally excluded from the evidence.
func (c *Config) retireLegacyGateway(raw map[string]json.RawMessage) error {
	legacy, present := raw["gateway_cloud"]
	pending, hasPending := raw["gateway_cloud_migration"]
	delete(raw, "gateway_cloud")
	delete(raw, "gateway_cloud_migration")
	nonnull := func(value []byte) bool {
		return len(value) != 0 && !bytes.Equal(bytes.TrimSpace(value), []byte("null"))
	}
	if (!present || !nonnull(legacy)) && (!hasPending || !nonnull(pending)) {
		return nil
	}
	if c.GatewayPublication != nil || c.Gateway != nil {
		return errors.New("mixed legacy and current Gateway configuration")
	}
	if nonnull(legacy) {
		var evidence gatewaycloud.MigrationEvidence
		if err := json.Unmarshal(legacy, &evidence); err != nil {
			return err
		}
		if _, err := evidence.Identity(); err == nil {
			c.GatewayMigrationEvidence = evidence.Clone()
		}
	}
	c.gatewayConfigMigrated = true
	c.GatewayRejoinRequired = true
	c.GatewayPublication = nil
	c.Direct, c.ControlArtifactPool = nil, nil
	return nil
}

// RetireGatewayPublication preserves only the previous binding proof. The
// caller persists this fence before delivering leave or starting another route.
func (c *Config) RetireGatewayPublication() error {
	if c == nil || c.GatewayPublication == nil {
		return nil
	}
	if err := c.QueueGatewayClosure(); err != nil {
		return err
	}
	if evidence := c.GatewayPublication.MigrationEvidence(); evidence != nil {
		c.GatewayMigrationEvidence = evidence
	}
	c.GatewayPublication = nil
	c.GatewayEnvironmentChoice = ""
	c.GatewayRejoinRequired = true
	c.Direct, c.ControlArtifactPool = nil, nil
	return nil
}

// QueueGatewayClosure records delivery intent before member credentials disappear.
// Receipt signing waits for the live Agent to confirm session registry closure.
func (c *Config) QueueGatewayClosure() error {
	if c == nil || c.GatewayPublication == nil || c.GatewayPublication.Binding == nil {
		return nil
	}
	fence := c.GatewayPublication.Fence()
	for _, existing := range c.GatewayClosureOutbox {
		if existing.Receipt.Binding == *fence {
			return nil
		}
	}
	if len(c.GatewayClosureOutbox) >= 16 {
		return errors.New("gateway closure receipts must be delivered before changing more bindings")
	}
	delivery, err := gatewaycloud.NewClosureDelivery(c.GatewayPublication, c.Gateway)
	if err != nil {
		return err
	}
	c.GatewayClosureOutbox = append(append([]gatewaycloud.ClosureDelivery(nil), c.GatewayClosureOutbox...), *delivery)
	return nil
}
