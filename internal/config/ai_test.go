package config

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAIConfigValidate_AllowsPermissionOnly(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{PermissionType: AIPermissionReadonly}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate permission-only config: %v", err)
	}
	if cfg.HasModelProfile() {
		t.Fatalf("HasModelProfile=true for permission-only config")
	}

	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if strings.Contains(string(raw), "current_model_id") {
		t.Fatalf("permission-only config serialized current_model_id: %s", raw)
	}
}

func TestAIConfigValidate_RejectsPartialModelProfiles(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		cfg  AIConfig
	}{
		{name: "current_model_only", cfg: AIConfig{CurrentModelID: "openai/gpt-5-mini"}},
		{name: "providers_only", cfg: AIConfig{Providers: []AIProvider{{
			ID: "openai", Type: "openai", Models: []AIProviderModel{{ModelName: "gpt-5-mini"}},
		}}}},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if err := tt.cfg.Validate(); err == nil {
				t.Fatalf("Validate accepted partial model profile: %#v", tt.cfg)
			}
			if tt.cfg.HasModelProfile() {
				t.Fatalf("HasModelProfile=true for partial model profile: %#v", tt.cfg)
			}
		})
	}
}

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
		t.Fatalf("expected validation error for invalid current_model_id")
	}
}

func TestAIConfigValidate_AllowsSlashOnlyInWireModelName(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "groq/gpt-oss-120b",
		Providers: []AIProvider{
			{
				ID:      "groq",
				Name:    "Groq",
				Type:    "groq",
				BaseURL: "https://api.groq.com/openai/v1",
				Models: []AIProviderModel{{
					ModelName:     "gpt-oss-120b",
					WireModelName: "openai/gpt-oss-120b",
					ContextWindow: 131072,
				}},
			},
		},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate with wire_model_name containing slash: %v", err)
	}

	cfg.Providers[0].Models[0].ModelName = "openai/gpt-oss-120b"
	cfg.CurrentModelID = "groq/openai/gpt-oss-120b"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("Validate accepted model_name containing slash")
	}
}

func TestAIConfigValidate_MoonshotRequiresBaseURL(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "moonshot/kimi-k2.6",
		Providers: []AIProvider{
			{
				ID:     "moonshot",
				Name:   "Moonshot",
				Type:   "moonshot",
				Models: []AIProviderModel{{ModelName: "kimi-k2.6"}},
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
		modelName string
		wantError bool
	}{
		{name: "openai_without_base_url", typ: "openai", baseURL: "", wantError: false},
		{name: "anthropic_without_base_url", typ: "anthropic", baseURL: "", wantError: false},
		{name: "openai_compatible_without_base_url", typ: "openai_compatible", baseURL: "", wantError: true},
		{name: "moonshot_without_base_url", typ: "moonshot", baseURL: "", wantError: true},
		{name: "chatglm_without_base_url", typ: "chatglm", baseURL: "", wantError: true},
		{name: "deepseek_without_base_url", typ: "deepseek", baseURL: "", wantError: true},
		{name: "qwen_without_base_url", typ: "qwen", baseURL: "", wantError: true},
		{name: "openrouter_without_base_url", typ: "openrouter", baseURL: "", wantError: true},
		{name: "xai_without_base_url", typ: "xai", baseURL: "", wantError: true},
		{name: "groq_without_base_url", typ: "groq", baseURL: "", wantError: true},
		{name: "ollama_without_base_url", typ: "ollama", baseURL: "", wantError: true},
		{name: "chatglm_with_base_url", typ: "chatglm", baseURL: "https://open.bigmodel.cn/api/paas/v4/", modelName: "glm-5.1", wantError: false},
		{name: "chatglm_glm52_with_base_url", typ: "chatglm", baseURL: "https://api.z.ai/api/paas/v4/", modelName: "glm-5.2", wantError: false},
		{name: "deepseek_with_base_url", typ: "deepseek", baseURL: "https://api.deepseek.com", modelName: "deepseek-v4-pro", wantError: false},
		{name: "qwen_with_base_url", typ: "qwen", baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", modelName: "qwen3.6-plus", wantError: false},
		{name: "openrouter_with_base_url", typ: "openrouter", baseURL: "https://openrouter.ai/api/v1", modelName: "gpt-oss-120b", wantError: false},
		{name: "xai_with_base_url", typ: "xai", baseURL: "https://api.x.ai/v1", modelName: "grok-4.3", wantError: false},
		{name: "groq_with_base_url", typ: "groq", baseURL: "https://api.groq.com/openai/v1", modelName: "gpt-oss-120b", wantError: false},
		{name: "ollama_with_base_url", typ: "ollama", baseURL: "http://127.0.0.1:11434/v1", modelName: "gpt-oss", wantError: false},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			modelName := tc.modelName
			if modelName == "" {
				modelName = "test-model"
			}
			contextWindow := 0
			if !tc.wantError {
				contextWindow = 128000
			}
			cfg := &AIConfig{
				CurrentModelID: "provider/" + modelName,
				Providers: []AIProvider{
					{
						ID:      "provider",
						Name:    "Provider",
						Type:    tc.typ,
						BaseURL: tc.baseURL,
						Models:  []AIProviderModel{{ModelName: modelName, ContextWindow: contextWindow}},
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

func TestAIConfigValidate_CuratedNativeProviderModels(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		typ       string
		models    []string
		baseURL   string
		wantError bool
	}{
		{name: "moonshot_current", typ: "moonshot", models: []string{"kimi-k2.6"}, baseURL: "https://api.moonshot.cn/v1"},
		{name: "moonshot_legacy_removed", typ: "moonshot", models: []string{"kimi-k2.5"}, baseURL: "https://api.moonshot.cn/v1", wantError: true},
		{name: "glm_current", typ: "chatglm", models: []string{"glm-5.2", "glm-5.1"}, baseURL: "https://api.z.ai/api/paas/v4/"},
		{name: "glm_legacy_removed", typ: "chatglm", models: []string{"glm-4.5"}, baseURL: "https://api.z.ai/api/paas/v4/", wantError: true},
		{name: "deepseek_current", typ: "deepseek", models: []string{"deepseek-v4-pro", "deepseek-v4-flash"}, baseURL: "https://api.deepseek.com"},
		{name: "deepseek_legacy_removed", typ: "deepseek", models: []string{"deepseek-chat"}, baseURL: "https://api.deepseek.com", wantError: true},
		{name: "qwen_current", typ: "qwen", models: []string{"qwen3.6-plus", "qwen3.6-plus-2026-04-02", "qwen3.6-flash", "qwen3.6-flash-2026-04-16"}, baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"},
		{name: "qwen_preview_without_builtin_tools_removed", typ: "qwen", models: []string{"qwen3.6-max-preview"}, baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", wantError: true},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			models := make([]AIProviderModel, 0, len(tc.models))
			for _, modelName := range tc.models {
				models = append(models, AIProviderModel{ModelName: modelName, ContextWindow: 1000000})
			}
			cfg := &AIConfig{
				CurrentModelID: "provider/" + tc.models[0],
				Providers: []AIProvider{
					{
						ID:      "provider",
						Type:    tc.typ,
						BaseURL: tc.baseURL,
						Models:  models,
					},
				},
			}
			err := cfg.Validate()
			if tc.wantError && err == nil {
				t.Fatalf("expected validation error")
			}
			if !tc.wantError && err != nil {
				t.Fatalf("Validate: %v", err)
			}
		})
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

func TestAIProviderModel_InputModalities(t *testing.T) {
	t.Parallel()

	textOnly := AIProviderModel{}
	if got := textOnly.NormalizedInputModalities(); len(got) != 1 || got[0] != AIInputModalityText {
		t.Fatalf("NormalizedInputModalities default=%v, want [text]", got)
	}
	if textOnly.SupportsImageInput() {
		t.Fatalf("SupportsImageInput default=true, want false")
	}

	vision := AIProviderModel{InputModalities: []string{" text ", "image", "image"}}
	if got := vision.NormalizedInputModalities(); len(got) != 2 || got[0] != AIInputModalityText || got[1] != AIInputModalityImage {
		t.Fatalf("NormalizedInputModalities vision=%v, want [text image]", got)
	}
	if !vision.SupportsImageInput() {
		t.Fatalf("SupportsImageInput vision=false, want true")
	}
}

func TestAIConfigValidate_InputModalities(t *testing.T) {
	t.Parallel()

	base := AIConfig{
		CurrentModelID: "openai/gpt-5-mini",
		Providers: []AIProvider{
			{
				ID:      "openai",
				Name:    "OpenAI",
				Type:    "openai",
				BaseURL: "https://api.openai.com/v1",
				Models:  []AIProviderModel{{ModelName: "gpt-5-mini", InputModalities: []string{AIInputModalityText, AIInputModalityImage}}},
			},
		},
	}
	if err := base.Validate(); err != nil {
		t.Fatalf("Validate explicit modalities: %v", err)
	}

	withoutText := base
	withoutText.Providers = []AIProvider{base.Providers[0]}
	withoutText.Providers[0].Models = []AIProviderModel{{ModelName: "gpt-5-mini", InputModalities: []string{AIInputModalityImage}}}
	if err := withoutText.Validate(); err == nil {
		t.Fatalf("expected validation error when input_modalities omits text")
	}

	unknown := base
	unknown.Providers = []AIProvider{base.Providers[0]}
	unknown.Providers[0].Models = []AIProviderModel{{ModelName: "gpt-5-mini", InputModalities: []string{AIInputModalityText, "audio"}}}
	if err := unknown.Validate(); err == nil {
		t.Fatalf("expected validation error for unsupported modality")
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

func TestAIConfigValidate_RejectsInvalidPermissionType(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		PermissionType: "oops",
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
		t.Fatalf("expected validation error for invalid permission_type")
	}
}

func TestAIConfig_EffectivePermissionTypeDefaultsApprovalRequired(t *testing.T) {
	t.Parallel()

	if got := ((*AIConfig)(nil)).EffectivePermissionType(); got != AIPermissionApprovalRequired {
		t.Fatalf("EffectivePermissionType nil=%q, want %q", got, AIPermissionApprovalRequired)
	}

	cfg := &AIConfig{}
	if got := cfg.EffectivePermissionType(); got != AIPermissionApprovalRequired {
		t.Fatalf("EffectivePermissionType empty=%q, want %q", got, AIPermissionApprovalRequired)
	}

	cfg.PermissionType = AIPermissionReadonly
	if got := cfg.EffectivePermissionType(); got != AIPermissionReadonly {
		t.Fatalf("EffectivePermissionType readonly=%q, want %q", got, AIPermissionReadonly)
	}

	cfg.PermissionType = AIPermissionFullAccess
	if got := cfg.EffectivePermissionType(); got != AIPermissionFullAccess {
		t.Fatalf("EffectivePermissionType full_access=%q, want %q", got, AIPermissionFullAccess)
	}
}

func boolPtr(v bool) *bool { return &v }

func TestAIConfigValidate_ProviderScopedWebSearch(t *testing.T) {
	t.Parallel()

	cfg := &AIConfig{
		CurrentModelID: "compat/custom-model",
		Providers: []AIProvider{
			{
				ID:        "compat",
				Name:      "Compat",
				Type:      "openai_compatible",
				BaseURL:   "https://example.com/v1",
				WebSearch: &AIProviderWebSearch{Mode: AIProviderWebSearchModeBrave},
				Models:    []AIProviderModel{{ModelName: "custom-model", ContextWindow: 128000}},
			},
		},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate openai_compatible brave web_search: %v", err)
	}

	cfg.Providers[0].WebSearch.Mode = AIProviderWebSearchModeOpenAIBuiltin
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate openai_compatible openai_builtin web_search: %v", err)
	}

	cfg.Providers[0].WebSearch.Mode = "auto"
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for invalid provider web_search.mode")
	}

	cfg.Providers[0].Type = "openai"
	cfg.Providers[0].BaseURL = "https://api.openai.com/v1"
	cfg.Providers[0].WebSearch.Mode = AIProviderWebSearchModeBrave
	if err := cfg.Validate(); err == nil {
		t.Fatalf("expected validation error for native provider web_search.mode")
	}

	cfg.Providers[0].WebSearch.Mode = AIProviderWebSearchModeDisabled
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate disabled native provider web_search: %v", err)
	}
}

func TestAIConfig_EffectiveToolRecoveryDefaults(t *testing.T) {
	t.Parallel()

	nilCfg := (*AIConfig)(nil)
	if got := nilCfg.EffectiveToolRecoveryEnabled(); !got {
		t.Fatalf("EffectiveToolRecoveryEnabled nil=%v, want true", got)
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
	cfg.ToolRecoveryAllowPathRewrite = boolPtr(false)
	cfg.ToolRecoveryAllowProbeTools = boolPtr(false)
	cfg.ToolRecoveryFailOnRepeatedSignature = boolPtr(false)
	if got := cfg.EffectiveToolRecoveryEnabled(); got {
		t.Fatalf("EffectiveToolRecoveryEnabled explicit=%v, want false", got)
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
