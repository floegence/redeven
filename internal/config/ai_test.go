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

func boolPtr(v bool) *bool { return &v }
func intPtr(v int) *int    { return &v }

func TestAIConfig_EffectiveGuardDefaults(t *testing.T) {
	t.Parallel()

	if got := ((*AIConfig)(nil)).EffectiveGuardEnabled(); !got {
		t.Fatalf("EffectiveGuardEnabled nil=%v, want true", got)
	}
	if got := ((*AIConfig)(nil)).EffectiveGuardAutoContinueMax(); got != 1 {
		t.Fatalf("EffectiveGuardAutoContinueMax nil=%d, want 1", got)
	}

	cfg := &AIConfig{}
	if got := cfg.EffectiveGuardEnabled(); !got {
		t.Fatalf("EffectiveGuardEnabled empty=%v, want true", got)
	}
	if got := cfg.EffectiveGuardAutoContinueMax(); got != 1 {
		t.Fatalf("EffectiveGuardAutoContinueMax empty=%d, want 1", got)
	}

	cfg.GuardEnabled = boolPtr(false)
	cfg.GuardAutoContinueMax = intPtr(0)
	if got := cfg.EffectiveGuardEnabled(); got {
		t.Fatalf("EffectiveGuardEnabled false=%v, want false", got)
	}
	if got := cfg.EffectiveGuardAutoContinueMax(); got != 0 {
		t.Fatalf("EffectiveGuardAutoContinueMax explicit0=%d, want 0", got)
	}
}

func TestAIConfigValidate_RejectsInvalidGuardAutoContinueMax(t *testing.T) {
	t.Parallel()

	base := AIConfig{
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

	cfg1 := base
	cfg1.GuardAutoContinueMax = intPtr(-1)
	if err := cfg1.Validate(); err == nil {
		t.Fatalf("expected validation error for guard_auto_continue_max=-1")
	}

	cfg2 := base
	cfg2.GuardAutoContinueMax = intPtr(6)
	if err := cfg2.Validate(); err == nil {
		t.Fatalf("expected validation error for guard_auto_continue_max=6")
	}
}

func TestAIConfig_EffectiveToolRequiredIntents_DefaultAndDedupe(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{ToolRequiredIntents: []string{"  PWD  ", "pwd", "scan"}}
	got := cfg.EffectiveToolRequiredIntents()
	if len(got) != 2 {
		t.Fatalf("EffectiveToolRequiredIntents len=%d, want 2 (%v)", len(got), got)
	}
	if got[0] != "pwd" || got[1] != "scan" {
		t.Fatalf("EffectiveToolRequiredIntents=%v, want [pwd scan]", got)
	}

	nilCfg := (*AIConfig)(nil)
	defaults := nilCfg.EffectiveToolRequiredIntents()
	if len(defaults) == 0 {
		t.Fatalf("default intents should not be empty")
	}
}
