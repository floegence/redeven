package ai

import (
	"encoding/json"
	"testing"
)

func boolPtr(v bool) *bool { return &v }

func TestBuildOpenAITools_RespectsStrictFlag(t *testing.T) {
	t.Parallel()

	defs := []ToolDef{
		{
			Name:        "ask_user",
			InputSchema: json.RawMessage(`{"type":"object","properties":{"question":{"type":"string"}},"required":["question"],"additionalProperties":false}`),
		},
	}

	toolsStrict, _ := buildOpenAITools(defs, true)
	if len(toolsStrict) != 1 || toolsStrict[0].OfFunction == nil {
		t.Fatalf("expected one function tool in strict mode")
	}
	if !toolsStrict[0].OfFunction.Strict.Valid() || !toolsStrict[0].OfFunction.Strict.Value {
		t.Fatalf("expected strict=true for strict mode")
	}

	toolsCompat, _ := buildOpenAITools(defs, false)
	if len(toolsCompat) != 1 || toolsCompat[0].OfFunction == nil {
		t.Fatalf("expected one function tool in compatible mode")
	}
	if !toolsCompat[0].OfFunction.Strict.Valid() || toolsCompat[0].OfFunction.Strict.Value {
		t.Fatalf("expected strict=false for compatible mode")
	}
}

func TestNewProviderAdapter_OpenAIStrictPolicy(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		typ      string
		baseURL  string
		override *bool
		expected bool
	}{
		{name: "openai", typ: "openai", baseURL: "https://api.openai.com/v1", expected: true},
		{name: "openai_official_default_base_url", typ: "openai", baseURL: "", expected: true},
		{name: "openai_custom_gateway", typ: "openai", baseURL: "https://codex-api.packycode.com/v1", expected: false},
		{name: "openai_compatible", typ: "openai_compatible", baseURL: "https://example.com/v1", expected: false},
		{name: "openai_custom_gateway_override_true", typ: "openai", baseURL: "https://gateway.example/v1", override: boolPtr(true), expected: true},
		{name: "openai_official_override_false", typ: "openai", baseURL: "https://api.openai.com/v1", override: boolPtr(false), expected: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			provider, err := newProviderAdapter(tc.typ, tc.baseURL, "sk-test", tc.override)
			if err != nil {
				t.Fatalf("newProviderAdapter error: %v", err)
			}
			openAIProvider, ok := provider.(*openAIProvider)
			if !ok {
				t.Fatalf("expected *openAIProvider, got %T", provider)
			}
			if openAIProvider.strictToolSchema != tc.expected {
				t.Fatalf("strictToolSchema mismatch, got=%v want=%v", openAIProvider.strictToolSchema, tc.expected)
			}
		})
	}
}
