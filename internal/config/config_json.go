package config

import (
	"encoding/json"
	"strings"

	directv1 "github.com/floegence/flowersec/flowersec-go/gen/flowersec/direct/v1"
)

var configKnownJSONFields = map[string]struct{}{
	"provider_origin":             {},
	"controlplane_base_url":       {},
	"controlplane_provider_id":    {},
	"environment_id":              {},
	"local_environment_public_id": {},
	"binding_generation":          {},
	"agent_instance_id":           {},
	"direct":                      {},
	"ai":                          {},
	"permission_policy":           {},
	"agent_home_dir":              {},
	"filesystem_scope":            {},
	"shell":                       {},
	"log_format":                  {},
	"log_level":                   {},
	"code_server_port_min":        {},
	"code_server_port_max":        {},
}

type configJSON Config

type persistedDirectConnectInfo struct {
	WsURL                    string         `json:"ws_url"`
	ChannelID                string         `json:"channel_id"`
	ChannelInitExpireAtUnixS int64          `json:"channel_init_expire_at_unix_s"`
	DefaultSuite             directv1.Suite `json:"default_suite"`
	E2eePSKSet               bool           `json:"e2ee_psk_set"`
	LegacyE2eePSKB64U        string         `json:"e2ee_psk_b64u,omitempty"`
}

func (c *Config) UnmarshalJSON(data []byte) error {
	type alias configJSON
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	directRaw := raw["direct"]
	for key := range configKnownJSONFields {
		delete(raw, key)
	}

	*c = Config(decoded)
	if len(directRaw) > 0 && string(directRaw) != "null" {
		var persisted persistedDirectConnectInfo
		if err := json.Unmarshal(directRaw, &persisted); err != nil {
			return err
		}
		c.directPSKSet = persisted.E2eePSKSet || strings.TrimSpace(persisted.LegacyE2eePSKB64U) != ""
	}
	if len(raw) > 0 {
		c.extra = raw
	} else {
		c.extra = nil
	}
	return nil
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
	if c.Direct != nil {
		directBytes, err := json.Marshal(persistedDirectConnectInfo{
			WsURL:                    c.Direct.WsUrl,
			ChannelID:                c.Direct.ChannelId,
			ChannelInitExpireAtUnixS: c.Direct.ChannelInitExpireAtUnixS,
			DefaultSuite:             c.Direct.DefaultSuite,
			E2eePSKSet:               c.directPSKSet || strings.TrimSpace(c.Direct.E2eePskB64u) != "",
		})
		if err != nil {
			return nil, err
		}
		out["direct"] = directBytes
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
	return json.Marshal(out)
}
