package config

import (
	"encoding/json"
	"testing"
)

func TestAIProviderEnablementPreservesConfigurationAndControlsAdmission(t *testing.T) {
	for _, state := range []struct {
		name, field string
		allowed     bool
	}{
		{"omitted", "", true},
		{"enabled", `,"enabled":true`, true},
		{"disabled", `,"enabled":false`, false},
	} {
		t.Run(state.name, func(t *testing.T) {
			var cfg AIConfig
			if err := json.Unmarshal([]byte(`{"current_model_id":"local/agent","providers":[{"id":"local","type":"openai_compatible","base_url":"http://localhost:1234/v1","models":[{"model_name":"agent","context_window":32768}]`+state.field+`}]}`), &cfg); err != nil {
				t.Fatal(err)
			}
			if err := cfg.Validate(); err != nil {
				t.Fatal(err)
			}
			if cfg.IsAllowedModelID(cfg.CurrentModelID) != state.allowed {
				t.Fatal("provider enablement did not control model admission")
			}
			_, _, found := cfg.ProviderModelByID(cfg.CurrentModelID)
			if found != state.allowed {
				t.Fatal("disabled provider resolved for execution")
			}
			if len(cfg.Providers[0].EffectiveModels()) != 1 || cfg.CurrentModelID != "local/agent" {
				t.Fatal("enablement discarded saved model intent")
			}
			encoded, err := json.Marshal(cfg)
			if err != nil {
				t.Fatal(err)
			}
			var restored AIConfig
			if err := json.Unmarshal(encoded, &restored); err != nil {
				t.Fatal(err)
			}
			if restored.IsAllowedModelID(cfg.CurrentModelID) != state.allowed {
				t.Fatal("enablement was lost on reload")
			}
		})
	}
}
