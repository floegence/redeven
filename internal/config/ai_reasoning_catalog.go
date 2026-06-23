package config

import "strings"

func aiReasoningBoolPtr(v bool) *bool {
	return &v
}

func AIReasoningCapabilityForModel(providerType string, modelName string) AIReasoningCapability {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	switch providerType {
	case "openai":
		switch modelName {
		case "gpt-5.5":
			return openAIGPT55ReasoningCapability()
		case "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano":
			return openAIGPT54ReasoningCapability(modelName)
		case "gpt-5.2", "gpt-5.2-mini":
			return openAIGPT52ReasoningCapability()
		case "gpt-5.2-codex":
			return openAIGPT52CodexReasoningCapability()
		case "gpt-5.2-pro":
			return openAIGPT52ProReasoningCapability()
		case "gpt-5", "gpt-5-mini", "gpt-5-nano":
			return openAIGPT5ReasoningCapability()
		}
	case "openrouter":
		return openRouterDynamicReasoningCapability()
	case "anthropic":
		if modelName == "claude-opus-4-7" {
			return anthropicOpus47ReasoningCapability()
		}
		if modelName == "claude-sonnet-4-6" {
			return anthropicSonnet46ReasoningCapability()
		}
	case "moonshot":
		if strings.HasPrefix(modelName, "kimi-k2.7") {
			return kimiAlwaysOnReasoningCapability()
		}
		if strings.HasPrefix(modelName, "kimi-k2.6") || strings.HasPrefix(modelName, "kimi-k2.5") {
			return kimiToggleReasoningCapability()
		}
	case "chatglm":
		if strings.HasPrefix(modelName, "glm-5.2") {
			return glmReasoningEffortCapability()
		}
		if strings.HasPrefix(modelName, "glm-") {
			return glmToggleReasoningCapability()
		}
	case "deepseek":
		if strings.HasPrefix(modelName, "deepseek-v4") {
			return deepSeekReasoningCapability()
		}
	case "qwen":
		if strings.HasPrefix(modelName, "qwen3") {
			return qwenThinkingBudgetCapability()
		}
	case "xai":
		if modelName == "grok-4.3" {
			return xAIReasoningCapability()
		}
	case "groq":
		switch modelName {
		case "qwen/qwen3-32b", "qwen/qwen3.6-27b":
			return groqQwenReasoningCapability()
		case "openai/gpt-oss-20b", "openai/gpt-oss-120b":
			return groqGPTOSSReasoningCapability()
		}
	case "ollama":
		return ollamaDynamicReasoningCapability()
	case "openai_compatible":
		switch {
		case strings.Contains(modelName, "gemini-3"):
			return gemini3ReasoningCapability()
		case strings.Contains(modelName, "gemini-2.5-pro"):
			return gemini25ProBudgetCapability()
		case strings.Contains(modelName, "gemini-2.5-flash"):
			return gemini25FlashBudgetCapability()
		}
	}
	return AIReasoningCapability{}
}

func openAIReasoningCapability(supportedLevels []string, defaultLevel string, sourceURLs []string, fixture string, disableSupported bool) AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                    "effort",
		SupportedLevels:         supportedLevels,
		DefaultLevel:            defaultLevel,
		DisableSupported:        disableSupported,
		WireShape:               "openai_responses_reasoning_effort",
		DisableShape:            "openai_reasoning_effort_none",
		ResponseReasoningFields: []string{"completion_tokens_details.reasoning_tokens"},
		SourceURLs:              sourceURLs,
		SourceCheckedAt:         aiReasoningSourceCheckedAt,
		Fixture:                 fixture,
	}.Normalize()
}

func openAIGPT55ReasoningCapability() AIReasoningCapability {
	return openAIReasoningCapability(
		[]string{"low", "medium", "high", "xhigh"},
		"medium",
		[]string{"https://developers.openai.com/api/docs/models/gpt-5.5", "https://developers.openai.com/api/docs/guides/latest-model", "https://developers.openai.com/api/docs/guides/reasoning"},
		"openai_gpt_55_reasoning_effort",
		true,
	)
}

func openAIGPT54ReasoningCapability(modelName string) AIReasoningCapability {
	sourceURL := "https://developers.openai.com/api/docs/models/gpt-5.4"
	switch {
	case strings.HasPrefix(modelName, "gpt-5.4-mini"):
		sourceURL = "https://developers.openai.com/api/docs/models/gpt-5.4-mini"
	case strings.HasPrefix(modelName, "gpt-5.4-nano"):
		sourceURL = "https://developers.openai.com/api/docs/models/gpt-5.4-nano"
	}
	return openAIReasoningCapability(
		[]string{"low", "medium", "high", "xhigh"},
		"off",
		[]string{sourceURL, "https://developers.openai.com/api/docs/guides/reasoning"},
		"openai_gpt_54_reasoning_effort",
		true,
	)
}

func openAIGPT52ReasoningCapability() AIReasoningCapability {
	return openAIReasoningCapability(
		[]string{"low", "medium", "high", "xhigh"},
		"off",
		[]string{"https://developers.openai.com/api/docs/models/gpt-5.2", "https://developers.openai.com/api/docs/guides/reasoning"},
		"openai_gpt_52_reasoning_effort",
		true,
	)
}

func openAIGPT52CodexReasoningCapability() AIReasoningCapability {
	return openAIReasoningCapability(
		[]string{"low", "medium", "high", "xhigh"},
		"medium",
		[]string{"https://developers.openai.com/api/docs/models/gpt-5.2-codex", "https://developers.openai.com/api/docs/guides/reasoning"},
		"openai_gpt_52_codex_reasoning_effort",
		false,
	)
}

func openAIGPT52ProReasoningCapability() AIReasoningCapability {
	return openAIReasoningCapability(
		[]string{"medium", "high", "xhigh"},
		"medium",
		[]string{"https://developers.openai.com/api/docs/models/gpt-5.2-pro", "https://developers.openai.com/api/docs/guides/reasoning"},
		"openai_gpt_52_pro_reasoning_effort",
		false,
	)
}

func openAIGPT5ReasoningCapability() AIReasoningCapability {
	return openAIReasoningCapability(
		[]string{"minimal", "low", "medium", "high"},
		"medium",
		[]string{"https://developers.openai.com/api/docs/models/gpt-5", "https://developers.openai.com/api/docs/models/gpt-5-mini", "https://developers.openai.com/api/docs/guides/reasoning"},
		"openai_gpt_5_reasoning_effort",
		false,
	)
}

func anthropicOpus47ReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:             "effort",
		SupportedLevels:  []string{"low", "medium", "high", "xhigh", "max"},
		DefaultLevel:     "off",
		DisableSupported: true,
		WireShape:        "anthropic_output_config_effort",
		DisableShape:     "anthropic_thinking_disabled",
		SourceURLs:       []string{"https://platform.claude.com/docs/en/build-with-claude/effort", "https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking", "https://platform.claude.com/docs/en/api/messages/create"},
		SourceCheckedAt:  aiReasoningSourceCheckedAt,
		Fixture:          "anthropic_opus_47_adaptive_effort",
	}.Normalize()
}

func anthropicSonnet46ReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:             "effort_budget",
		SupportedLevels:  []string{"low", "medium", "high", "max"},
		DefaultLevel:     "high",
		DisableSupported: true,
		WireShape:        "anthropic_output_config_effort",
		DisableShape:     "anthropic_thinking_disabled",
		BudgetShape:      "anthropic_thinking_budget",
		MinBudgetTokens:  1024,
		SourceURLs:       []string{"https://platform.claude.com/docs/en/build-with-claude/effort", "https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking", "https://platform.claude.com/docs/en/api/messages/create", "https://platform.claude.com/docs/en/about-claude/models/migration-guide"},
		SourceCheckedAt:  aiReasoningSourceCheckedAt,
		Fixture:          "anthropic_sonnet_46_adaptive_effort_budget",
	}.Normalize()
}

func gemini3ReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:            "effort",
		SupportedLevels: []string{"minimal", "low", "medium", "high"},
		DefaultLevel:    "medium",
		WireShape:       "gemini_thinking_level",
		SourceURLs:      []string{"https://ai.google.dev/gemini-api/docs/generate-content/thinking", "https://ai.google.dev/gemini-api/docs/openai"},
		SourceCheckedAt: aiReasoningSourceCheckedAt,
		Fixture:         "gemini_3_thinking_level",
	}.Normalize()
}

func gemini25ProBudgetCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:            "budget",
		DefaultEnabled:  aiReasoningBoolPtr(true),
		WireShape:       "gemini_openai_thinking_budget",
		BudgetShape:     "gemini_thinking_budget",
		MinBudgetTokens: 128,
		MaxBudgetTokens: 32768,
		SourceURLs:      []string{"https://ai.google.dev/gemini-api/docs/generate-content/thinking", "https://ai.google.dev/gemini-api/docs/openai"},
		SourceCheckedAt: aiReasoningSourceCheckedAt,
		Fixture:         "gemini_2_5_pro_thinking_budget",
	}.Normalize()
}

func gemini25FlashBudgetCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:             "toggle_budget",
		DisableSupported: true,
		DefaultEnabled:   aiReasoningBoolPtr(true),
		WireShape:        "gemini_openai_thinking_budget",
		DisableShape:     "gemini_thinking_budget_zero",
		BudgetShape:      "gemini_thinking_budget",
		MaxBudgetTokens:  24576,
		SourceURLs:       []string{"https://ai.google.dev/gemini-api/docs/generate-content/thinking", "https://ai.google.dev/gemini-api/docs/openai"},
		SourceCheckedAt:  aiReasoningSourceCheckedAt,
		Fixture:          "gemini_2_5_flash_thinking_budget",
	}.Normalize()
}

func openRouterDynamicReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                    "dynamic",
		DynamicProviderMetadata: true,
		WireShape:               "openrouter_reasoning_metadata",
		SourceURLs:              []string{"https://openrouter.ai/docs/api-reference/parameters", "https://openrouter.ai/docs/guides/best-practices/reasoning-tokens", "https://openrouter.ai/api/v1/models"},
		SourceCheckedAt:         aiReasoningSourceCheckedAt,
		Fixture:                 "openrouter_model_reasoning_metadata",
	}.Normalize()
}

func kimiToggleReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                      "toggle",
		DefaultLevel:              "default",
		DisableSupported:          true,
		DefaultEnabled:            aiReasoningBoolPtr(true),
		WireShape:                 "kimi_thinking_type",
		DisableShape:              "kimi_thinking_disabled",
		ResponseReasoningFields:   []string{"reasoning_content"},
		HistoryReplayRequirements: []string{"reasoning_content"},
		SourceURLs:                []string{"https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart", "https://platform.moonshot.cn/docs/guide/use-kimi-k2-thinking-model"},
		SourceCheckedAt:           aiReasoningSourceCheckedAt,
		Fixture:                   "kimi_thinking_type",
	}.Normalize()
}

func kimiAlwaysOnReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                      "always_on",
		DefaultEnabled:            aiReasoningBoolPtr(true),
		WireShape:                 "kimi_always_on",
		ResponseReasoningFields:   []string{"reasoning_content"},
		HistoryReplayRequirements: []string{"reasoning_content"},
		SourceURLs:                []string{"https://platform.kimi.ai/docs/guide/use-kimi-k2-thinking-model", "https://platform.kimi.ai/docs/api/chat"},
		SourceCheckedAt:           aiReasoningSourceCheckedAt,
		Fixture:                   "kimi_always_on",
	}.Normalize()
}

func glmToggleReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:             "toggle",
		DefaultLevel:     "default",
		DisableSupported: true,
		DefaultEnabled:   aiReasoningBoolPtr(true),
		WireShape:        "glm_thinking_type",
		DisableShape:     "glm_thinking_disabled",
		SourceURLs:       []string{"https://docs.z.ai/guides/capabilities/thinking", "https://docs.z.ai/api-reference/llm/chat-completion"},
		SourceCheckedAt:  aiReasoningSourceCheckedAt,
		Fixture:          "glm_thinking_type",
	}.Normalize()
}

func glmReasoningEffortCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:             "effort",
		SupportedLevels:  []string{"minimal", "low", "medium", "high", "xhigh", "max"},
		DefaultLevel:     "max",
		DisableSupported: true,
		WireShape:        "glm_reasoning_effort",
		DisableShape:     "glm_reasoning_effort_none",
		SourceURLs:       []string{"https://docs.z.ai/guides/overview/concept-param", "https://docs.z.ai/api-reference/llm/chat-completion"},
		SourceCheckedAt:  aiReasoningSourceCheckedAt,
		Fixture:          "glm_5_2_reasoning_effort",
	}.Normalize()
}

func deepSeekReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                      "effort",
		SupportedLevels:           []string{"high", "max"},
		DefaultLevel:              "high",
		DisableSupported:          true,
		WireShape:                 "deepseek_reasoning_effort",
		DisableShape:              "deepseek_thinking_disabled",
		ResponseReasoningFields:   []string{"reasoning_content", "completion_tokens_details.reasoning_tokens"},
		HistoryReplayRequirements: []string{"reasoning_content"},
		SourceURLs:                []string{"https://api-docs.deepseek.com/api/create-chat-completion", "https://api-docs.deepseek.com/guides/thinking_mode"},
		SourceCheckedAt:           aiReasoningSourceCheckedAt,
		Fixture:                   "deepseek_reasoning_effort",
	}.Normalize()
}

func qwenThinkingBudgetCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                      "toggle_budget",
		DefaultLevel:              "default",
		DisableSupported:          true,
		DefaultEnabled:            aiReasoningBoolPtr(true),
		WireShape:                 "qwen_enable_thinking",
		DisableShape:              "qwen_enable_thinking_false",
		BudgetShape:               "qwen_thinking_budget",
		ResponseReasoningFields:   []string{"reasoning_content", "completion_tokens_details.reasoning_tokens"},
		HistoryReplayRequirements: []string{"reasoning_content", "preserve_thinking"},
		SourceURLs:                []string{"https://help.aliyun.com/zh/model-studio/deep-thinking", "https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope", "https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions"},
		SourceCheckedAt:           aiReasoningSourceCheckedAt,
		Fixture:                   "qwen_enable_thinking_budget",
	}.Normalize()
}

func xAIReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:             "effort",
		SupportedLevels:  []string{"low", "medium", "high"},
		DefaultLevel:     "low",
		DisableSupported: true,
		WireShape:        "xai_reasoning_effort",
		DisableShape:     "xai_reasoning_effort_none",
		SourceURLs:       []string{"https://docs.x.ai/developers/model-capabilities/text/reasoning"},
		SourceCheckedAt:  aiReasoningSourceCheckedAt,
		Fixture:          "xai_grok_4_3_reasoning_effort",
	}.Normalize()
}

func groqQwenReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:             "effort",
		DefaultLevel:     "default",
		DisableSupported: true,
		WireShape:        "groq_qwen_reasoning_effort",
		DisableShape:     "groq_reasoning_none",
		SourceURLs:       []string{"https://console.groq.com/docs/reasoning", "https://console.groq.com/docs/api-reference"},
		SourceCheckedAt:  aiReasoningSourceCheckedAt,
		Fixture:          "groq_qwen_reasoning_default",
	}.Normalize()
}

func groqGPTOSSReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:            "effort",
		SupportedLevels: []string{"low", "medium", "high"},
		DefaultLevel:    "medium",
		WireShape:       "groq_gpt_oss_reasoning_effort",
		SourceURLs:      []string{"https://console.groq.com/docs/reasoning", "https://console.groq.com/docs/api-reference"},
		SourceCheckedAt: aiReasoningSourceCheckedAt,
		Fixture:         "groq_gpt_oss_reasoning_effort",
	}.Normalize()
}

func ollamaDynamicReasoningCapability() AIReasoningCapability {
	return AIReasoningCapability{
		Kind:                    "dynamic",
		DynamicProviderMetadata: true,
		WireShape:               "ollama_model_family_think",
		SourceURLs:              []string{"https://docs.ollama.com/capabilities/thinking", "https://docs.ollama.com/api/chat"},
		SourceCheckedAt:         aiReasoningSourceCheckedAt,
		Fixture:                 "ollama_model_family_think",
	}.Normalize()
}
