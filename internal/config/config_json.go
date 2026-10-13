package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

type configJSON Config

// Configuration loading never migrates or rewrites an unsupported protocol.
// The operator can keep the old state read-only and enroll a fresh state root.
func (c *Config) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	var version int
	if json.Unmarshal(raw["runtime_config_version"], &version) != nil || version != RuntimeConfigVersion {
		return errors.New("unsupported Runtime configuration; create a new state root and enroll the Runtime again; the existing configuration has not been changed")
	}
	for _, key := range []string{"gateway", "gateway_publication", "gateway_migration_evidence", "gateway_cloud_member_id", "gateway_environment_choice", "gateway_rejoin_required", "gateway_closure_outbox", "gateway_membership_schema_version", "direct", "provider_origin", "controlplane_base_url", "controlplane_provider_id"} {
		if _, exists := raw[key]; exists {
			return fmt.Errorf("retired Runtime configuration field %s; create a new state root and enroll again", key)
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var decoded configJSON
	if err := decoder.Decode(&decoded); err != nil {
		return fmt.Errorf("unsupported Runtime configuration; create a new state root: %w", err)
	}
	if decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid Runtime configuration document")
	}
	if decoded.CloudAssociation == nil && (decoded.CloudOrigin != "" || decoded.EnvironmentID != "" || decoded.ControlArtifactPool != nil) {
		return errors.New("cloud configuration requires an independent Runtime identity; create a new state root and enroll again")
	}
	if decoded.CloudAssociation != nil {
		if err := decoded.CloudAssociation.Validate(decoded.LocalEnvironmentPublicID); err != nil {
			return err
		}
	}
	// Indented configuration envelopes must not change opaque canonical artifact
	// bytes used by Flowersec or by the durable spend digest.
	if decoded.ControlArtifactPool != nil {
		for index := range decoded.ControlArtifactPool.Entries {
			entry := &decoded.ControlArtifactPool.Entries[index]
			if len(entry.ArtifactJSON) == 0 {
				continue
			}
			normalized, err := NormalizeControlArtifactJSON(entry.ArtifactJSON)
			if err != nil {
				return err
			}
			entry.ArtifactJSON = normalized
		}
	}
	*c = Config(decoded)
	return nil
}

func (c Config) MarshalJSON() ([]byte, error) {
	c.ConfigVersion = RuntimeConfigVersion
	return json.Marshal(configJSON(c))
}
