package config

import "testing"

func TestAIConfigValidate_RequiresModels(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		DefaultModel: AIModelRef{ProviderID: "openai", ModelName: "gpt-5-mini"},
		Providers: []AIProvider{
			{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1"},
		},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for missing models")
	}
}

func TestAIConfigValidate_DefaultMustBeInModels(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		DefaultModel: AIModelRef{ProviderID: "openai", ModelName: "gpt-5-mini"},
		Models: []AIModel{
			{ProviderID: "openai", ModelName: "gpt-4o-mini"},
		},
		Providers: []AIProvider{
			{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1"},
		},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for missing default model in models")
	}
}

func TestAIConfigValidate_OK(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		DefaultModel: AIModelRef{ProviderID: "openai", ModelName: "gpt-5-mini"},
		Models: []AIModel{
			{ProviderID: "openai", ModelName: "gpt-5-mini", Label: "GPT-5 Mini"},
			{ProviderID: "anthropic", ModelName: "claude-sonnet-4-5", Label: "Claude Sonnet 4.5"},
		},
		Providers: []AIProvider{
			{ID: "openai", Name: "OpenAI", Type: "openai", BaseURL: "https://api.openai.com/v1"},
			{ID: "anthropic", Name: "Anthropic", Type: "anthropic", BaseURL: "https://api.anthropic.com"},
		},
	}

	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
}
