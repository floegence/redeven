package ai

import (
	"encoding/json"
	"strings"
	"testing"

	anthropic "github.com/anthropics/anthropic-sdk-go"
	"github.com/floegence/redeven/internal/config"
	openai "github.com/openai/openai-go"
	oresponses "github.com/openai/openai-go/responses"
	oshared "github.com/openai/openai-go/shared"
)

func TestApplyResponsesReasoningOpenAIEffort(t *testing.T) {
	t.Parallel()

	params := oresponses.ResponseNewParams{
		Model: oshared.ResponsesModel("gpt-5.4"),
		Input: oresponses.ResponseNewParamsInputUnion{
			OfString: openai.String("hello"),
		},
	}
	if err := applyResponsesReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelXHigh},
		ReasoningCapability: config.AIReasoningCapabilityForModel("openai", "gpt-5.4"),
	}); err != nil {
		t.Fatalf("applyResponsesReasoning: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"reasoning":{"effort":"xhigh"}`) {
		t.Fatalf("payload missing OpenAI reasoning effort: %s", payload)
	}
}

func TestApplyResponsesReasoningRejectsOpenAIGPT54Minimal(t *testing.T) {
	t.Parallel()

	params := oresponses.ResponseNewParams{
		Model: oshared.ResponsesModel("gpt-5.4"),
		Input: oresponses.ResponseNewParamsInputUnion{
			OfString: openai.String("hello"),
		},
	}
	err := applyResponsesReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelMinimal},
		ReasoningCapability: config.AIReasoningCapabilityForModel("openai", "gpt-5.4"),
	})
	if err == nil {
		t.Fatalf("applyResponsesReasoning accepted minimal for GPT-5.4")
	}
}

func TestApplyResponsesReasoningQwenOffAndRejectsBudget(t *testing.T) {
	t.Parallel()

	params := oresponses.ResponseNewParams{
		Model: oshared.ResponsesModel("qwen3.6-plus"),
		Input: oresponses.ResponseNewParamsInputUnion{
			OfString: openai.String("hello"),
		},
	}
	err := applyResponsesReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelDefault, BudgetTokens: 4096},
		ReasoningCapability: config.AIReasoningCapabilityForModel("qwen", "qwen3.6-plus"),
	})
	if err == nil {
		t.Fatalf("applyResponsesReasoning accepted qwen budget on Responses route")
	}

	params = oresponses.ResponseNewParams{
		Model: oshared.ResponsesModel("qwen3.6-plus"),
		Input: oresponses.ResponseNewParamsInputUnion{
			OfString: openai.String("hello"),
		},
	}
	if err := applyResponsesReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelOff},
		ReasoningCapability: config.AIReasoningCapabilityForModel("qwen", "qwen3.6-plus"),
	}); err != nil {
		t.Fatalf("applyResponsesReasoning qwen off: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"reasoning":{"effort":"none"}`) {
		t.Fatalf("payload=%s, want qwen Responses reasoning none", payload)
	}
}

func TestApplyChatReasoningQwenBudgetAndOff(t *testing.T) {
	t.Parallel()

	capability := config.AIReasoningCapabilityForModel("qwen", "qwen3.6-plus")
	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("qwen3.6-plus"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelDefault, BudgetTokens: 4096},
		ReasoningCapability: capability,
	}); err != nil {
		t.Fatalf("applyChatReasoning budget: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	for _, want := range []string{`"enable_thinking":true`, `"thinking_budget":4096`} {
		if !strings.Contains(payload, want) {
			t.Fatalf("payload missing %s: %s", want, payload)
		}
	}

	params = openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("qwen3.6-plus"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelOff},
		ReasoningCapability: capability,
	}); err != nil {
		t.Fatalf("applyChatReasoning off: %v", err)
	}
	payload = mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"enable_thinking":false`) || strings.Contains(payload, `"thinking_budget"`) {
		t.Fatalf("payload=%s, want qwen off without thinking_budget", payload)
	}
}

func TestApplyChatReasoningRejectsQwenOffWithBudget(t *testing.T) {
	t.Parallel()

	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("qwen3.6-plus"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelOff, BudgetTokens: 4096},
		ReasoningCapability: config.AIReasoningCapabilityForModel("qwen", "qwen3.6-plus"),
	})
	if err == nil {
		t.Fatalf("applyChatReasoning accepted qwen off+budget")
	}
}

func TestApplyChatReasoningRejectsUnsupportedGroqQwenLow(t *testing.T) {
	t.Parallel()

	capability := config.AIReasoningCapabilityForModel("groq", "qwen/qwen3-32b")
	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("qwen/qwen3-32b"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelLow},
		ReasoningCapability: capability,
	})
	if err == nil {
		t.Fatalf("applyChatReasoning accepted low for Groq Qwen")
	}
}

func TestApplyChatReasoningGroqQwenDefaultAndOff(t *testing.T) {
	t.Parallel()

	capability := config.AIReasoningCapabilityForModel("groq", "qwen/qwen3-32b")
	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("qwen/qwen3-32b"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelDefault},
		ReasoningCapability: capability,
	}); err != nil {
		t.Fatalf("applyChatReasoning default: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	if strings.Contains(payload, `"reasoning_effort"`) {
		t.Fatalf("payload=%s, want Groq Qwen default to omit effort", payload)
	}

	params = openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("qwen/qwen3-32b"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelOff},
		ReasoningCapability: capability,
	}); err != nil {
		t.Fatalf("applyChatReasoning off: %v", err)
	}
	payload = mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"reasoning_effort":"none"`) {
		t.Fatalf("payload=%s, want Groq Qwen none effort", payload)
	}
}

func TestApplyChatReasoningDeepSeekOff(t *testing.T) {
	t.Parallel()

	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("deepseek-v4-pro"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelOff},
		ReasoningCapability: config.AIReasoningCapabilityForModel("deepseek", "deepseek-v4-pro"),
	}); err != nil {
		t.Fatalf("applyChatReasoning: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"thinking":{"type":"disabled"}`) {
		t.Fatalf("payload missing DeepSeek disabled thinking: %s", payload)
	}
}

func TestApplyChatReasoningRejectsDeepSeekNone(t *testing.T) {
	t.Parallel()

	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("deepseek-v4-pro"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelMinimal},
		ReasoningCapability: config.AIReasoningCapabilityForModel("deepseek", "deepseek-v4-pro"),
	})
	if err == nil {
		t.Fatalf("applyChatReasoning accepted minimal for DeepSeek")
	}
}

func TestApplyChatReasoningXAIOffAndHigh(t *testing.T) {
	t.Parallel()

	capability := config.AIReasoningCapabilityForModel("xai", "grok-4.3")
	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("grok-4.3"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelOff},
		ReasoningCapability: capability,
	}); err != nil {
		t.Fatalf("applyChatReasoning off: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"reasoning_effort":"none"`) {
		t.Fatalf("payload=%s, want xAI none effort", payload)
	}

	params = openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("grok-4.3"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelHigh},
		ReasoningCapability: capability,
	}); err != nil {
		t.Fatalf("applyChatReasoning high: %v", err)
	}
	payload = mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"reasoning_effort":"high"`) {
		t.Fatalf("payload=%s, want xAI high effort", payload)
	}
}

func TestApplyChatReasoningGeminiBudget(t *testing.T) {
	t.Parallel()

	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("gemini-2.5-pro"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelDefault, BudgetTokens: 1024},
		ReasoningCapability: config.AIReasoningCapabilityForModel("openai_compatible", "gemini-2.5-pro"),
	}); err != nil {
		t.Fatalf("applyChatReasoning: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"thinking_budget":1024`) {
		t.Fatalf("payload=%s, want Gemini thinking budget", payload)
	}
}

func TestApplyChatReasoningGeminiOffUsesBudgetZero(t *testing.T) {
	t.Parallel()

	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("gemini-2.5-flash"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelOff},
		ReasoningCapability: config.AIReasoningCapabilityForModel("openai_compatible", "gemini-2.5-flash"),
	}); err != nil {
		t.Fatalf("applyChatReasoning: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"thinking_budget":0`) {
		t.Fatalf("payload=%s, want Gemini thinking_budget=0", payload)
	}
	if strings.Contains(payload, `"reasoning_effort":"none"`) {
		t.Fatalf("payload=%s, want no reasoning_effort fallback", payload)
	}
}

func TestApplyChatReasoningGLM52Effort(t *testing.T) {
	t.Parallel()

	params := openai.ChatCompletionNewParams{
		Model:    oshared.ChatModel("glm-5.2"),
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("hello")},
	}
	if err := applyChatReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelXHigh},
		ReasoningCapability: config.AIReasoningCapabilityForModel("chatglm", "glm-5.2"),
	}); err != nil {
		t.Fatalf("applyChatReasoning: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	if !strings.Contains(payload, `"reasoning_effort":"xhigh"`) {
		t.Fatalf("payload=%s, want GLM 5.2 xhigh effort", payload)
	}
}

func TestApplyAnthropicReasoningSonnetBudgetAndEffort(t *testing.T) {
	t.Parallel()

	params := anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_20250514,
		MaxTokens: 2048,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("hello"))},
	}
	if err := applyAnthropicReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelMedium, BudgetTokens: 1024},
		ReasoningCapability: config.AIReasoningCapabilityForModel("anthropic", "claude-sonnet-4-6"),
	}); err != nil {
		t.Fatalf("applyAnthropicReasoning: %v", err)
	}
	payload := mustMarshalPayload(t, params)
	for _, want := range []string{`"budget_tokens":1024`, `"type":"enabled"`, `"output_config":{"effort":"medium"}`} {
		if !strings.Contains(payload, want) {
			t.Fatalf("payload missing %s: %s", want, payload)
		}
	}
}

func TestApplyAnthropicReasoningRejectsOpusBudget(t *testing.T) {
	t.Parallel()

	params := anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_1_20250805,
		MaxTokens: 8192,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("hello"))},
	}
	err := applyAnthropicReasoning(&params, ProviderControls{
		ReasoningSelection:  config.AIReasoningSelection{Level: config.AIReasoningLevelHigh, BudgetTokens: 4096},
		ReasoningCapability: config.AIReasoningCapabilityForModel("anthropic", "claude-opus-4-7"),
	})
	if err == nil {
		t.Fatalf("applyAnthropicReasoning accepted manual budget for Opus 4.7")
	}
}

func mustMarshalPayload(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	return string(raw)
}
