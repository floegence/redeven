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

func TestAIConfig_EffectiveToolRecoveryDefaults(t *testing.T) {
	t.Parallel()

	nilCfg := (*AIConfig)(nil)
	if got := nilCfg.EffectiveToolRecoveryEnabled(); !got {
		t.Fatalf("EffectiveToolRecoveryEnabled nil=%v, want true", got)
	}
	if got := nilCfg.EffectiveToolRecoveryMaxSteps(); got != 3 {
		t.Fatalf("EffectiveToolRecoveryMaxSteps nil=%d, want 3", got)
	}
	if got := nilCfg.EffectiveToolRecoveryAllowPathRewrite(); !got {
		t.Fatalf("EffectiveToolRecoveryAllowPathRewrite nil=%v, want true", got)
	}
	if got := nilCfg.EffectiveToolRecoveryAllowProbeTools(); !got {
		t.Fatalf("EffectiveToolRecoveryAllowProbeTools nil=%v, want true", got)
	}
	if got := nilCfg.EffectiveToolRecoveryFailOnRepeatedSignature(); !got {
		t.Fatalf("EffectiveToolRecoveryFailOnRepeatedSignature nil=%v, want true", got)
	}

	cfg := &AIConfig{}
	if got := cfg.EffectiveToolRecoveryEnabled(); !got {
		t.Fatalf("EffectiveToolRecoveryEnabled empty=%v, want true", got)
	}
	if got := cfg.EffectiveToolRecoveryMaxSteps(); got != 3 {
		t.Fatalf("EffectiveToolRecoveryMaxSteps empty=%d, want 3", got)
	}
	if got := cfg.EffectiveToolRecoveryAllowPathRewrite(); !got {
		t.Fatalf("EffectiveToolRecoveryAllowPathRewrite empty=%v, want true", got)
	}
	if got := cfg.EffectiveToolRecoveryAllowProbeTools(); !got {
		t.Fatalf("EffectiveToolRecoveryAllowProbeTools empty=%v, want true", got)
	}
	if got := cfg.EffectiveToolRecoveryFailOnRepeatedSignature(); !got {
		t.Fatalf("EffectiveToolRecoveryFailOnRepeatedSignature empty=%v, want true", got)
	}

	cfg.ToolRecoveryEnabled = boolPtr(false)
	cfg.ToolRecoveryMaxSteps = intPtr(0)
	cfg.ToolRecoveryAllowPathRewrite = boolPtr(false)
	cfg.ToolRecoveryAllowProbeTools = boolPtr(false)
	cfg.ToolRecoveryFailOnRepeatedSignature = boolPtr(false)
	if got := cfg.EffectiveToolRecoveryEnabled(); got {
		t.Fatalf("EffectiveToolRecoveryEnabled explicit=%v, want false", got)
	}
	if got := cfg.EffectiveToolRecoveryMaxSteps(); got != 0 {
		t.Fatalf("EffectiveToolRecoveryMaxSteps explicit=%d, want 0", got)
	}
	if got := cfg.EffectiveToolRecoveryAllowPathRewrite(); got {
		t.Fatalf("EffectiveToolRecoveryAllowPathRewrite explicit=%v, want false", got)
	}
	if got := cfg.EffectiveToolRecoveryAllowProbeTools(); got {
		t.Fatalf("EffectiveToolRecoveryAllowProbeTools explicit=%v, want false", got)
	}
	if got := cfg.EffectiveToolRecoveryFailOnRepeatedSignature(); got {
		t.Fatalf("EffectiveToolRecoveryFailOnRepeatedSignature explicit=%v, want false", got)
	}
}

func TestAIConfigValidate_RejectsInvalidToolRecoveryMaxSteps(t *testing.T) {
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
	cfg1.ToolRecoveryMaxSteps = intPtr(-1)
	if err := cfg1.Validate(); err == nil {
		t.Fatalf("expected validation error for tool_recovery_max_steps=-1")
	}

	cfg2 := base
	cfg2.ToolRecoveryMaxSteps = intPtr(9)
	if err := cfg2.Validate(); err == nil {
		t.Fatalf("expected validation error for tool_recovery_max_steps=9")
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
