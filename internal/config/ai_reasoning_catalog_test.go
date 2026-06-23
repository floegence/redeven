package config

import "testing"

func TestAIReasoningCatalogRowsHaveProvenance(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		providerType string
		modelName    string
		wantWire     string
		wantLevels   []string
		wantDisable  bool
	}{
		{name: "openai_gpt_55", providerType: "openai", modelName: "gpt-5.5", wantWire: "openai_responses_reasoning_effort", wantLevels: []string{"low", "medium", "high", "xhigh"}, wantDisable: true},
		{name: "openai_gpt_54", providerType: "openai", modelName: "gpt-5.4", wantWire: "openai_responses_reasoning_effort", wantLevels: []string{"low", "medium", "high", "xhigh"}, wantDisable: true},
		{name: "openai_gpt_52", providerType: "openai", modelName: "gpt-5.2", wantWire: "openai_responses_reasoning_effort", wantLevels: []string{"low", "medium", "high", "xhigh"}, wantDisable: true},
		{name: "openai_gpt_52_codex", providerType: "openai", modelName: "gpt-5.2-codex", wantWire: "openai_responses_reasoning_effort", wantLevels: []string{"low", "medium", "high", "xhigh"}},
		{name: "openai_gpt_52_pro", providerType: "openai", modelName: "gpt-5.2-pro", wantWire: "openai_responses_reasoning_effort", wantLevels: []string{"medium", "high", "xhigh"}},
		{name: "openai_gpt_5", providerType: "openai", modelName: "gpt-5", wantWire: "openai_responses_reasoning_effort", wantLevels: []string{"minimal", "low", "medium", "high"}},
		{name: "anthropic", providerType: "anthropic", modelName: "claude-opus-4-7", wantWire: "anthropic_output_config_effort", wantLevels: []string{"low", "medium", "high", "xhigh", "max"}, wantDisable: true},
		{name: "anthropic_sonnet", providerType: "anthropic", modelName: "claude-sonnet-4-6", wantWire: "anthropic_output_config_effort", wantLevels: []string{"low", "medium", "high", "max"}, wantDisable: true},
		{name: "gemini3", providerType: "openai_compatible", modelName: "gemini-3-pro-preview", wantWire: "gemini_thinking_level", wantLevels: []string{"minimal", "low", "medium", "high"}},
		{name: "kimi_toggle", providerType: "moonshot", modelName: "kimi-k2.6", wantWire: "kimi_thinking_type", wantDisable: true},
		{name: "glm_effort", providerType: "chatglm", modelName: "glm-5.2", wantWire: "glm_reasoning_effort", wantLevels: []string{"minimal", "low", "medium", "high", "xhigh", "max"}, wantDisable: true},
		{name: "deepseek", providerType: "deepseek", modelName: "deepseek-v4-pro", wantWire: "deepseek_reasoning_effort", wantLevels: []string{"high", "max"}, wantDisable: true},
		{name: "qwen", providerType: "qwen", modelName: "qwen3.6-plus", wantWire: "qwen_enable_thinking", wantDisable: true},
		{name: "openrouter", providerType: "openrouter", modelName: "gpt-oss-120b", wantWire: "openrouter_reasoning_metadata"},
		{name: "xai", providerType: "xai", modelName: "grok-4.3", wantWire: "xai_reasoning_effort", wantLevels: []string{"low", "medium", "high"}, wantDisable: true},
		{name: "groq_qwen", providerType: "groq", modelName: "qwen/qwen3-32b", wantWire: "groq_qwen_reasoning_effort", wantDisable: true},
		{name: "groq_gpt_oss", providerType: "groq", modelName: "openai/gpt-oss-120b", wantWire: "groq_gpt_oss_reasoning_effort", wantLevels: []string{"low", "medium", "high"}},
		{name: "ollama", providerType: "ollama", modelName: "gpt-oss", wantWire: "ollama_model_family_think"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			capability := AIReasoningCapabilityForModel(tc.providerType, tc.modelName)
			if capability.IsZero() {
				t.Fatalf("capability is zero")
			}
			if err := capability.Validate(); err != nil {
				t.Fatalf("Validate: %v", err)
			}
			if capability.WireShape != tc.wantWire {
				t.Fatalf("wire_shape=%q, want %q", capability.WireShape, tc.wantWire)
			}
			if capability.DisableSupported != tc.wantDisable {
				t.Fatalf("disable_supported=%v, want %v", capability.DisableSupported, tc.wantDisable)
			}
			if got := capability.SupportedLevels; !sameStringSlice(got, tc.wantLevels) {
				t.Fatalf("supported_levels=%v, want %v", got, tc.wantLevels)
			}
			if capability.SourceCheckedAt != aiReasoningSourceCheckedAt || len(capability.SourceURLs) == 0 || capability.Fixture == "" {
				t.Fatalf("missing provenance: %+v", capability)
			}
		})
	}
}

func TestAIReasoningCatalogDoesNotGuessDynamicCompatibleModels(t *testing.T) {
	t.Parallel()

	for _, modelName := range []string{
		"openrouter/openai/gpt-oss-120b",
		"groq/qwen-qwq-32b",
		"ollama/deepseek-r1",
		"custom-gpt-oss",
		"gpt-5.2-future",
		"claude-future-4-8",
	} {
		if capability := AIReasoningCapabilityForModel("openai_compatible", modelName); !capability.IsZero() {
			t.Fatalf("%s capability=%+v, want zero without explicit provider metadata", modelName, capability)
		}
	}
}

func TestValidateAIReasoningSelectionRejectsOpenAIGPT52ProUnsupportedValues(t *testing.T) {
	t.Parallel()

	capability := AIReasoningCapabilityForModel("openai", "gpt-5.2-pro")
	for _, selection := range []AIReasoningSelection{
		{Level: AIReasoningLevelOff},
		{Level: AIReasoningLevelLow},
	} {
		if err := ValidateAIReasoningSelection(capability, selection); err == nil {
			t.Fatalf("%+v accepted for GPT-5.2 Pro, want unsupported level error", selection)
		}
	}
}

func TestValidateAIReasoningSelectionRejectsOpenAIGPT52CodexOff(t *testing.T) {
	t.Parallel()

	capability := AIReasoningCapabilityForModel("openai", "gpt-5.2-codex")
	if err := ValidateAIReasoningSelection(capability, AIReasoningSelection{Level: AIReasoningLevelOff}); err == nil {
		t.Fatalf("off accepted for GPT-5.2 Codex, want unsupported level error")
	}
}

func TestAIReasoningCatalogDoesNotGuessProviderFamilies(t *testing.T) {
	t.Parallel()

	tests := []struct {
		providerType string
		modelName    string
	}{
		{providerType: "openai", modelName: "gpt-5.4-pro"},
		{providerType: "openai", modelName: "gpt-5.2-future"},
		{providerType: "anthropic", modelName: "claude-haiku-4-5-20251001"},
		{providerType: "anthropic", modelName: "claude-future-4-8"},
		{providerType: "groq", modelName: "qwen-qwq-32b"},
		{providerType: "groq", modelName: "custom-gpt-oss"},
		{providerType: "xai", modelName: "grok-4.3-mini"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.providerType+"/"+tc.modelName, func(t *testing.T) {
			t.Parallel()
			if capability := AIReasoningCapabilityForModel(tc.providerType, tc.modelName); !capability.IsZero() {
				t.Fatalf("capability=%+v, want zero for unlisted model", capability)
			}
		})
	}
}

func TestValidateAIReasoningSelectionRejectsUnsupportedLevel(t *testing.T) {
	t.Parallel()

	capability := AIReasoningCapabilityForModel("deepseek", "deepseek-v4-pro")
	if err := ValidateAIReasoningSelection(capability, AIReasoningSelection{Level: AIReasoningLevelLow}); err == nil {
		t.Fatalf("low accepted for DeepSeek V4, want unsupported level error")
	}
}

func TestValidateAIReasoningSelectionRejectsLegacyNoneLevel(t *testing.T) {
	t.Parallel()

	capability := AIReasoningCapabilityForModel("openai", "gpt-5.5")
	if err := ValidateAIReasoningSelection(capability, AIReasoningSelection{Level: AIReasoningLevel("none")}); err == nil {
		t.Fatalf("none accepted as product reasoning level, want explicit off instead")
	}
}

func TestValidateAIReasoningSelectionRejectsOffWithBudget(t *testing.T) {
	t.Parallel()

	capability := AIReasoningCapabilityForModel("qwen", "qwen3.6-plus")
	if err := ValidateAIReasoningSelection(capability, AIReasoningSelection{Level: AIReasoningLevelOff, BudgetTokens: 4096}); err == nil {
		t.Fatalf("off+budget accepted for Qwen, want invalid selection")
	}
}

func TestValidateAIReasoningSelectionRejectsAnthropicOpusBudget(t *testing.T) {
	t.Parallel()

	capability := AIReasoningCapabilityForModel("anthropic", "claude-opus-4-7")
	if err := ValidateAIReasoningSelection(capability, AIReasoningSelection{Level: AIReasoningLevelHigh, BudgetTokens: 4096}); err == nil {
		t.Fatalf("budget accepted for Claude Opus 4.7, want invalid selection")
	}
}

func TestValidateAIReasoningSelectionAcceptsAnthropicSonnetBudget(t *testing.T) {
	t.Parallel()

	capability := AIReasoningCapabilityForModel("anthropic", "claude-sonnet-4-6")
	if capability.BudgetShape != "anthropic_thinking_budget" || capability.MinBudgetTokens != 1024 {
		t.Fatalf("capability budget shape=%q min=%d, want Anthropic manual budget support", capability.BudgetShape, capability.MinBudgetTokens)
	}
	if err := ValidateAIReasoningSelection(capability, AIReasoningSelection{Level: AIReasoningLevelHigh, BudgetTokens: 4096}); err != nil {
		t.Fatalf("budget rejected for Claude Sonnet 4.6: %v", err)
	}
}

func sameStringSlice(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
