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

func TestAIConfigValidate_RequiresCurrentModel(t *testing.T) {
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
		t.Fatalf("expected validation error for missing current model")
	}
}

func TestAIConfigValidate_RejectsInvalidCurrentModel(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "openai/gpt-unknown",
		Providers: []AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini"}, {ModelName: "gpt-5"}},
			},
		},
	}

	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid current model")
	}
}

func TestAIConfigValidate_MoonshotRequiresBaseURL(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "moonshot/kimi-k2.5",
		Providers: []AIProvider{
			{
				ID:     "moonshot",
				Name:   "Moonshot",
				Type:   "moonshot",
				Models: []AIProviderModel{{ModelName: "kimi-k2.5"}},
			},
		},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for moonshot without base_url")
	}

	cfg.Providers[0].BaseURL = "https://api.moonshot.cn/v1"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate moonshot: %v", err)
	}
}

func TestAIConfigValidate_ProviderTypeBaseURLRequirements(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		typ       string
		baseURL   string
		wantError bool
	}{
		{name: "openai_without_base_url", typ: "openai", baseURL: "", wantError: false},
		{name: "anthropic_without_base_url", typ: "anthropic", baseURL: "", wantError: false},
		{name: "openai_compatible_without_base_url", typ: "openai_compatible", baseURL: "", wantError: true},
		{name: "moonshot_without_base_url", typ: "moonshot", baseURL: "", wantError: true},
		{name: "chatglm_without_base_url", typ: "chatglm", baseURL: "", wantError: true},
		{name: "deepseek_without_base_url", typ: "deepseek", baseURL: "", wantError: true},
		{name: "qwen_without_base_url", typ: "qwen", baseURL: "", wantError: true},
		{name: "chatglm_with_base_url", typ: "chatglm", baseURL: "https://open.bigmodel.cn/api/paas/v4/", wantError: false},
		{name: "deepseek_with_base_url", typ: "deepseek", baseURL: "https://api.deepseek.com", wantError: false},
		{name: "qwen_with_base_url", typ: "qwen", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", wantError: false},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			cfg := &AIConfig{
				CurrentModelID: "provider/test-model",
				Providers: []AIProvider{
					{
						ID:      "provider",
						Name:    "Provider",
						Type:    tc.typ,
						BaseURL: tc.baseURL,
						Models:  []AIProviderModel{{ModelName: "test-model"}},
					},
				},
			}
			err := cfg.Validate()
			if tc.wantError && err == nil {
				t.Fatalf("expected validation error, got nil")
			}
			if !tc.wantError && err != nil {
				t.Fatalf("expected no validation error, got %v", err)
			}
		})
	}
}

func TestAIConfigValidate_OpenAICompatibleRequiresContextWindow(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "compat/test-model",
		Providers: []AIProvider{
			{
				ID:      "compat",
				Name:    "Compat",
				Type:    "openai_compatible",
				BaseURL: "https://example.com/v1",
				Models:  []AIProviderModel{{ModelName: "test-model"}},
			},
		},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for missing context_window on openai_compatible model")
	}

	cfg.Providers[0].Models[0].ContextWindow = 128000
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate openai_compatible with context_window: %v", err)
	}
}

func TestAIProviderModel_EffectiveInputWindowTokens(t *testing.T) {
	t.Parallel()

	model := AIProviderModel{ContextWindow: 200000}
	if got := model.EffectiveInputWindowTokens(); got != 190000 {
		t.Fatalf("EffectiveInputWindowTokens default=%d, want 190000", got)
	}

	model.EffectiveContextWindowPercent = 80
	if got := model.EffectiveInputWindowTokens(); got != 160000 {
		t.Fatalf("EffectiveInputWindowTokens percent=80 got=%d, want 160000", got)
	}
}

func TestAIConfigValidate_OK(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini"}, {ModelName: "gpt-4o-mini"}},
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
		Mode:           "oops",
		CurrentModelID: "openai/gpt-5-mini",
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
		CurrentModelID:    "openai/gpt-5-mini",
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

func TestAIConfig_ResolvedCurrentModelID_FallbacksToFirstModel(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "openai/missing",
		Providers: []AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini"}, {ModelName: "gpt-5"}},
			},
		},
	}

	modelID, ok := cfg.ResolvedCurrentModelID()
	if !ok {
		t.Fatalf("ResolvedCurrentModelID should return a fallback model")
	}
	if modelID != "openai/gpt-5-mini" {
		t.Fatalf("ResolvedCurrentModelID=%q, want %q", modelID, "openai/gpt-5-mini")
	}
}

func TestAIConfig_NormalizeCurrentModelID(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "openai/missing",
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

	if ok := cfg.NormalizeCurrentModelID(); !ok {
		t.Fatalf("NormalizeCurrentModelID should set current_model_id")
	}
	if cfg.CurrentModelID != "openai/gpt-5-mini" {
		t.Fatalf("CurrentModelID=%q, want %q", cfg.CurrentModelID, "openai/gpt-5-mini")
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
		CurrentModelID: "openai/gpt-5-mini",
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
