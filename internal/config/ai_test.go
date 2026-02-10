package config

import "testing"

func TestAIConfigValidate_RequiresProviderModels(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		Providers: []AIProvider{
			{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1"},
		},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for missing providers[].models[]")
	}
}

func TestAIConfigValidate_RequiresDefaultModel(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		Providers: []AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini"}},
			},
		},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for missing default model")
	}
}

func TestAIConfigValidate_RejectsMultipleDefaults(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		Providers: []AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}, {ModelName: "gpt-5", IsDefault: true}},
			},
		},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for multiple default models")
	}
}

func TestAIConfigValidate_OK(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		Providers: []AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini", Label: "GPT-5 Mini", IsDefault: true}, {ModelName: "gpt-4o-mini", Label: "Fast"}},
			},
			{
				ID:      "anthropic",
				Name:    "Anthropic",
				Type:    "anthropic",
				BaseURL: "https://api.anthropic.com",
				Models:  []AIProviderModel{{ModelName: "claude-3-5-sonnet-latest", Label: "Claude Sonnet"}},
			},
		},
	}

	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
}

func TestAIConfigValidate_RejectsInvalidMode(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		Mode: "oops",
		Providers: []AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}},
			},
		},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid mode")
	}
}

func TestAIConfig_EffectiveMode_DefaultsBuild(t *testing.T) {
	t.Parallel()

	if got := ((*AIConfig)(nil)).EffectiveMode(); got != AIModeBuild {
		t.Fatalf("EffectiveMode nil=%q, want %q", got, AIModeBuild)
	}

	cfg := &AIConfig{}
	if got := cfg.EffectiveMode(); got != AIModeBuild {
		t.Fatalf("EffectiveMode empty=%q, want %q", got, AIModeBuild)
	}

	cfg.Mode = AIModePlan
	if got := cfg.EffectiveMode(); got != AIModePlan {
		t.Fatalf("EffectiveMode plan=%q, want %q", got, AIModePlan)
	}
}
