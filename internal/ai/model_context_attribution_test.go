package ai

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
)

func TestRenderedContextAttributionProtocols(t *testing.T) {
	for _, tc := range []struct{ provider, model, protocol string }{
		{"openai", "gpt-4o", "openai-responses"}, {"openai", "gpt-4o", "openai-chat-completions"},
		{"anthropic", "claude-sonnet", ""}, {"moonshot", "kimi-k2.6", ""}, {"google", "gemini-model", ""},
		{"openrouter", "openai/gpt-4o", ""}, {"ollama", "local-model", ""}, {"qwen", "qwen-model", ""}, {"openai_compatible", "gpt-4o", ""},
	} {
		t.Run(tc.provider+tc.protocol, func(t *testing.T) {
			gateway, err := newProviderAdapter(tc.provider, "https://example.invalid/v1", "test-key", nil)
			if err != nil {
				t.Fatal(err)
			}
			req := ModelGatewayRequest{Model: tc.model, Protocol: tc.protocol, Messages: []Message{
				{Role: "system", Content: []ContentPart{{Type: "text", Text: "System principles."}}},
				{Role: "system", Content: []ContentPart{{Type: "text", Text: "\u3000技能目录\u3000"}}, Attribution: &flprovider.MessageAttribution{Category: "model_context", Parts: []flprovider.ContentAttributionPart{{Start: 0, End: len("\u3000技能目录\u3000"), Key: "skills"}}}},
				{Role: "user", Content: []ContentPart{{Type: "text", Text: "\u3000规则\u3000"}, {Type: "text", Text: "\n环境\n"}}, Attribution: &flprovider.MessageAttribution{Category: "model_context", Parts: []flprovider.ContentAttributionPart{{Start: 0, End: len("\u3000规则\u3000"), Key: "repository_rules"}, {Start: len("\u3000规则\u3000"), End: len("\u3000规则\u3000\n环境\n"), Key: "execution_environment"}}}},
				{Role: "user", Content: []ContentPart{{Type: "text", Text: "Hi"}}},
			}, Tools: []ToolDef{{Name: "docs.search", Source: "mcp", Namespace: "docs", InputSchema: json.RawMessage(`{"type":"object","properties":{}}`)}}}
			prepared, err := gateway.(modelGatewayRequestPreparer).prepareTurn(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			estimate := prepared.TokenEstimate()
			b := estimate.Breakdown
			if b.Source == "" || b.Diagnostic != "" || b.ModelContextTokens <= 0 || b.SystemTokens <= 0 || b.Details == nil {
				t.Fatalf("missing source distribution: %+v", b)
			}
			keys := map[string]bool{}
			for _, item := range b.Details.Items {
				keys[item.Key] = true
				if item.Category == "tool_definition" && (item.Key != "docs.search" || item.Source != "mcp" || item.Namespace != "docs") {
					t.Fatalf("lost tool origin: %+v", item)
				}
			}
			for _, key := range []string{"skills", "repository_rules", "execution_environment", "docs.search"} {
				if !keys[key] {
					t.Errorf("missing source %q: %+v", key, b.Details)
				}
			}
			wire := prepared.(*preparedModelWire).payload
			estimate.Breakdown.Details.Items[0].Key = "mutated-by-consumer"
			if reflect.DeepEqual(estimate, prepared.TokenEstimate()) {
				t.Fatal("consumer mutation changed frozen estimate")
			}
			for _, metadata := range []string{"attribution", "repository_rules", "execution_environment", `"source":"mcp"`} {
				if strings.Contains(string(wire), metadata) {
					t.Errorf("source metadata entered wire: %s", metadata)
				}
			}
		})
	}
}

func TestRenderedContextAttributionMismatchKeepsBudget(t *testing.T) {
	req := ModelGatewayRequest{Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "expected"}}, Attribution: &flprovider.MessageAttribution{Category: "model_context"}}}}
	raw := []byte(`{"messages":[{"role":"user","content":"different"}]}`)
	estimate, err := flprovider.EstimateRenderedRequest(flprovider.RenderedRequest{Provider: "openai", Model: "gpt-4o", Format: flprovider.RequestFormatOpenAIChat, Payload: raw, Attribution: renderedContextAttribution(flprovider.RequestFormatOpenAIChat, raw, req, providerToolAliases{})})
	if err != nil || estimate.EstimatedInputTokens <= 0 || estimate.Breakdown.Source != "" || estimate.Breakdown.Diagnostic != "attribution_mismatch" {
		t.Fatalf("optional attribution affected execution budget: %+v %v", estimate, err)
	}
}

func TestRenderedContextAttributionAfterChatToolImages(t *testing.T) {
	gateway, err := newProviderAdapter("openai_compatible", "https://example.invalid/v1", "test-key", nil)
	if err != nil {
		t.Fatal(err)
	}
	req := ModelGatewayRequest{Model: "gpt-4o", Messages: []Message{
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "Inspect the image"}}},
		{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "screen", ToolName: "screen", Text: "captured"}, {Type: "image", FileURI: "https://example.invalid/screen.png", MimeType: "image/png"}}},
		{Role: "user", Content: []ContentPart{{Type: "text", Text: "Current environment"}}, Attribution: &flprovider.MessageAttribution{Category: "model_context", Parts: []flprovider.ContentAttributionPart{{Start: 0, End: len("Current environment"), Key: "execution_environment"}}}},
	}}
	prepared, err := gateway.(modelGatewayRequestPreparer).prepareTurn(t.Context(), req)
	if err != nil {
		t.Fatal(err)
	}
	defer prepared.Close()
	estimate := prepared.TokenEstimate()
	if estimate.Breakdown.Diagnostic != "" || estimate.Breakdown.Source == "" || estimate.Breakdown.Quality != "token_estimate" || estimate.Breakdown.AttributionCoverage != "partial" || estimate.Breakdown.AttachmentTokens != 0 || estimate.Breakdown.Details == nil {
		t.Fatalf("lost distribution after synthetic image message: %+v", estimate.Breakdown)
	}
	for _, item := range estimate.Breakdown.Details.Items {
		if item.Category == "model_context" && item.Key == "execution_environment" && item.Tokens > 0 {
			return
		}
	}
	t.Fatalf("lost managed source after tool image: %+v", estimate.Breakdown.Details)
}
