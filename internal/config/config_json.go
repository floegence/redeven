package config

import (
	"encoding/json"
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
	for key := range configKnownJSONFields {
		delete(raw, key)
	}

	*c = Config(decoded)
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
