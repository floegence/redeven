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
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini", IsDefault: true}, {ModelName: "gpt-4o-mini"}},
			},
			{
				ID:      "anthropic",
				Name:    "Anthropic",
				Type:    "anthropic",
				BaseURL: "https://api.anthropic.com",
				Models:  []AIProviderModel{{ModelName: "claude-3-5-sonnet-latest"}},
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

func TestAIConfig_EffectiveMode_DefaultsAct(t *testing.T) {
	t.Parallel()

	if got := ((*AIConfig)(nil)).EffectiveMode(); got != AIModeAct {
		t.Fatalf("EffectiveMode nil=%q, want %q", got, AIModeAct)
	}

	cfg := &AIConfig{}
	if got := cfg.EffectiveMode(); got != AIModeAct {
		t.Fatalf("EffectiveMode empty=%q, want %q", got, AIModeAct)
	}

	cfg.Mode = AIModePlan
	if got := cfg.EffectiveMode(); got != AIModePlan {
		t.Fatalf("EffectiveMode plan=%q, want %q", got, AIModePlan)
	}
}

func boolPtr(v bool) *bool { return &v }
func intPtr(v int) *int    { return &v }

func TestAIConfig_EffectiveWebSearchProvider_DefaultsPreferOpenAI(t *testing.T) {
	t.Parallel()

	nilCfg := (*AIConfig)(nil)
	if got := nilCfg.EffectiveWebSearchProvider(); got != "prefer_openai" {
		t.Fatalf("EffectiveWebSearchProvider nil=%q, want %q", got, "prefer_openai")
	}

	cfg := &AIConfig{}
	if got := cfg.EffectiveWebSearchProvider(); got != "prefer_openai" {
		t.Fatalf("EffectiveWebSearchProvider empty=%q, want %q", got, "prefer_openai")
	}

	cfg.WebSearchProvider = "brave"
	if got := cfg.EffectiveWebSearchProvider(); got != "brave" {
		t.Fatalf("EffectiveWebSearchProvider brave=%q, want %q", got, "brave")
	}

	cfg.WebSearchProvider = "invalid"
	if got := cfg.EffectiveWebSearchProvider(); got != "prefer_openai" {
		t.Fatalf("EffectiveWebSearchProvider invalid=%q, want %q", got, "prefer_openai")
	}
}

func TestAIConfigValidate_RejectsLegacyWebSearchProviderValues(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		WebSearchProvider: "auto",
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
		t.Fatalf("expected validation error for legacy web_search_provider=auto")
	}

	cfg.WebSearchProvider = "openai"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for legacy web_search_provider=openai")
	}

	cfg.WebSearchProvider = "prefer_openai"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate prefer_openai: %v", err)
	}
}

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

func TestAIConfig_EffectiveExecutionPolicyDefaults(t *testing.T) {
	t.Parallel()

	nilCfg := (*AIConfig)(nil)
	if got := nilCfg.EffectiveRequireUserApproval(); got {
		t.Fatalf("EffectiveRequireUserApproval nil=%v, want false", got)
	}
	if got := nilCfg.EffectiveEnforcePlanModeGuard(); got {
		t.Fatalf("EffectiveEnforcePlanModeGuard nil=%v, want false", got)
	}
	if got := nilCfg.EffectiveBlockDangerousCommands(); got {
		t.Fatalf("EffectiveBlockDangerousCommands nil=%v, want false", got)
	}

	cfg := &AIConfig{}
	if got := cfg.EffectiveRequireUserApproval(); got {
		t.Fatalf("EffectiveRequireUserApproval empty=%v, want false", got)
	}
	if got := cfg.EffectiveEnforcePlanModeGuard(); got {
		t.Fatalf("EffectiveEnforcePlanModeGuard empty=%v, want false", got)
	}
	if got := cfg.EffectiveBlockDangerousCommands(); got {
		t.Fatalf("EffectiveBlockDangerousCommands empty=%v, want false", got)
	}

	cfg.ExecutionPolicy = &AIExecutionPolicy{
		RequireUserApproval:    true,
		EnforcePlanModeGuard:   true,
		BlockDangerousCommands: true,
	}
	if got := cfg.EffectiveRequireUserApproval(); !got {
		t.Fatalf("EffectiveRequireUserApproval explicit=%v, want true", got)
	}
	if got := cfg.EffectiveEnforcePlanModeGuard(); !got {
		t.Fatalf("EffectiveEnforcePlanModeGuard explicit=%v, want true", got)
	}
	if got := cfg.EffectiveBlockDangerousCommands(); !got {
		t.Fatalf("EffectiveBlockDangerousCommands explicit=%v, want true", got)
	}
}
