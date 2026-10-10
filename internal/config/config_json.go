package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

var configKnownJSONFields = map[string]struct{}{
	"remote_desktop":                    {},
	"cloud_origin":                      {},
	"access_point_origin":               {},
	"cloud_id":                          {},
	"environment_id":                    {},
	"local_environment_public_id":       {},
	"binding_generation":                {},
	"agent_instance_id":                 {},
	"direct":                            {},
	"gateway":                           {},
	"gateways":                          {},
	"gateway_membership_schema_version": {},
	"gateway_cloud_member_id":           {},
	"gateway_migration_evidence":        {},
	"gateway_rejoin_required":           {},
	"gateway_removal_outbox":            {},
	"gateway_closure_outbox":            {},
	"gateway_environment_choice":        {},
	"gateway_publication":               {},
	"control_artifact_pool":             {},
	"ai":                                {},
	"permission_policy":                 {},
	"agent_home_dir":                    {},
	"filesystem_scope":                  {},
	"shell":                             {},
	"log_format":                        {},
	"log_level":                         {},
	"code_server_port_min":              {},
	"code_server_port_max":              {},
}

type configJSON Config

func (c *Config) UnmarshalJSON(data []byte) error {
	type alias configJSON
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	var retired alias
	if err := json.Unmarshal(data, &retired); err != nil {
		return err
	}
	if err := (*Config)(&retired).retireLegacyGateway(raw); err != nil {
		return err
	}
	if retired.gatewayConfigMigrated {
		delete(raw, "direct")
		delete(raw, "control_artifact_pool")
	}
	migrated, err := migrateCloudConfigJSON(raw)
	if err != nil {
		return err
	}
	memberMigrated, err := migrateGatewayMembers(raw)
	if err != nil {
		return err
	}
	normalized, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	var decoded alias
	if err := json.Unmarshal(normalized, &decoded); err != nil {
		return err
	}
	decoded.cloudConfigMigrated = migrated
	if retired.gatewayConfigMigrated {
		decoded.gatewayConfigMigrated = true
		decoded.GatewayRejoinRequired = retired.GatewayRejoinRequired
		decoded.GatewayMigrationEvidence = retired.GatewayMigrationEvidence
	}
	for key := range configKnownJSONFields {
		delete(raw, key)
	}

	*c = Config(decoded)
	c.gatewayConfigMigrated = c.gatewayConfigMigrated || memberMigrated
	for _, member := range c.Gateways {
		if member == nil {
			return fmt.Errorf("missing Gateway membership")
		}
		if member.MigrateLegacyState() {
			c.gatewayConfigMigrated = true
		}
	}
	// json.RawMessage encodes a nil value as the literal `null`. Keep terminal
	// artifact tombstones truly byte-empty after a restart so validation cannot
	// mistake the JSON marker for retained opaque credential material.
	if c.Direct != nil && bytes.Equal(bytes.TrimSpace(c.Direct.ArtifactJSON), []byte("null")) {
		c.Direct.ArtifactJSON = nil
	}
	if c.ControlArtifactPool != nil {
		for index := range c.ControlArtifactPool.Entries {
			entry := &c.ControlArtifactPool.Entries[index]
			if bytes.Equal(bytes.TrimSpace(entry.ArtifactJSON), []byte("null")) {
				entry.ArtifactJSON = nil
				continue
			}
			if len(entry.ArtifactJSON) != 0 {
				normalized, err := NormalizeControlArtifactJSON(entry.ArtifactJSON)
				if err != nil {
					return err
				}
				entry.ArtifactJSON = normalized
			}
		}
	}
	if len(raw) > 0 {
		c.extra = raw
	} else {
		c.extra = nil
	}
	return nil
}

// Retired names are accepted only here, before current configuration validation.
func migrateCloudConfigJSON(raw map[string]json.RawMessage) (bool, error) {
	migrated := false
	for _, names := range [][2]string{
		{"provider_origin", "cloud_origin"},
		{"controlplane_base_url", "access_point_origin"},
		{"controlplane_provider_id", "cloud_id"},
	} {
		changed, err := migrateCloudString(raw, names[0], names[1])
		if err != nil {
			return false, err
		}
		migrated = migrated || changed
	}
	if poolBytes, exists := raw["control_artifact_pool"]; exists && !bytes.Equal(bytes.TrimSpace(poolBytes), []byte("null")) {
		var pool map[string]json.RawMessage
		if err := json.Unmarshal(poolBytes, &pool); err != nil {
			return false, err
		}
		var version int
		if err := json.Unmarshal(pool["schema_version"], &version); err != nil {
			return false, err
		}
		if version != 1 && version != ControlArtifactPoolSchemaVersion {
			return false, fmt.Errorf("unsupported control_artifact_pool schema_version %d", version)
		}
		if version == 1 {
			if _, err := migrateCloudString(pool, "logical_provider_binding_id", "logical_cloud_binding_id"); err != nil {
				return false, err
			}
			pool["schema_version"], _ = json.Marshal(ControlArtifactPoolSchemaVersion)
			raw["control_artifact_pool"], _ = json.Marshal(pool)
			migrated = true
		} else if _, retired := pool["logical_provider_binding_id"]; retired {
			return false, fmt.Errorf("retired binding field in current control_artifact_pool schema")
		}
	}
	return migrated, nil
}

func migrateCloudString(raw map[string]json.RawMessage, oldName, newName string) (bool, error) {
	oldBytes, exists := raw[oldName]
	if !exists {
		return false, nil
	}
	var oldValue string
	if err := json.Unmarshal(oldBytes, &oldValue); err != nil {
		return false, fmt.Errorf("invalid retired field %s: %w", oldName, err)
	}
	if newBytes, exists := raw[newName]; exists {
		var newValue string
		if err := json.Unmarshal(newBytes, &newValue); err != nil {
			return false, err
		}
		if newValue != oldValue {
			return false, fmt.Errorf("conflicting Cloud configuration fields %s and %s", oldName, newName)
		}
	} else {
		raw[newName] = oldBytes
	}
	delete(raw, oldName)
	return true, nil
}

func (c Config) MarshalJSON() ([]byte, error) {
	type alias configJSON
	baseBytes, err := json.Marshal(alias(c))
	if err != nil {
		return nil, err
	}

	var out map[string]json.RawMessage
	if err := json.Unmarshal(baseBytes, &out); err != nil {
		return nil, err
	}
	for key, value := range c.extra {
		if _, known := configKnownJSONFields[key]; known {
			continue
		}
		if len(value) == 0 {
			continue
		}
		out[key] = value
	}
	out["gateway_membership_schema_version"] = json.RawMessage("3")
	return json.Marshal(out)
}

// The v1 singleton becomes the v2 collection without changing credentials,
// pending deliveries, or the already approved Cloud publication owner. The v3
// edge retires an implicit publication selection without a persisted Cloud request.
func migrateGatewayMembers(raw map[string]json.RawMessage) (bool, error) {
	version := 1
	if encoded, ok := raw["gateway_membership_schema_version"]; ok {
		if json.Unmarshal(encoded, &version) != nil || version < 1 || version > 3 {
			return false, fmt.Errorf("unsupported Gateway membership schema")
		}
	}
	legacy, old := raw["gateway"]
	if version >= 2 {
		if old {
			return false, fmt.Errorf("singleton Gateway in current membership schema")
		}
		if version == 3 {
			return false, nil
		}
	}
	if version == 1 {
		if _, exists := raw["gateways"]; exists {
			return false, fmt.Errorf("Gateway membership schema drift")
		}
		if old && !bytes.Equal(bytes.TrimSpace(legacy), []byte("null")) {
			var member struct {
				MemberID string `json:"member_id"`
			}
			if err := json.Unmarshal(legacy, &member); err != nil || member.MemberID == "" {
				return false, fmt.Errorf("invalid legacy Gateway member")
			}
			raw["gateways"] = append(append([]byte("["), legacy...), ']')
			raw["gateway_cloud_member_id"], _ = json.Marshal(member.MemberID)
		}
		delete(raw, "gateway")
		raw["gateway_membership_schema_version"] = json.RawMessage("2")
	}
	if publication := bytes.TrimSpace(raw["gateway_publication"]); len(publication) == 0 || bytes.Equal(publication, []byte("null")) {
		// Validate the old selection before retiring it; malformed source state
		// must not become valid merely because the selected owner is removed.
		var source configJSON
		encoded, err := json.Marshal(raw)
		if err != nil {
			return false, err
		}
		if err := json.Unmarshal(encoded, &source); err != nil {
			return false, err
		}
		for _, member := range source.Gateways {
			member.MigrateLegacyState()
		}
		if err := (*Config)(&source).ValidateLocalMinimal(); err != nil {
			return false, fmt.Errorf("invalid Gateway membership migration source: %w", err)
		}
		if source.ControlArtifactPool != nil && strings.HasPrefix(source.ControlArtifactPool.LogicalBindingID, "gateway-cloud-v2:") {
			return false, fmt.Errorf("Gateway credential pool has no publication binding")
		}
		delete(raw, "gateway_cloud_member_id")
		delete(raw, "gateway_environment_choice")
	}
	raw["gateway_membership_schema_version"] = json.RawMessage("3")
	return old || version == 2, nil
}
