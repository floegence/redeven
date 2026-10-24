package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	flconfig "github.com/floegence/floret/v7/config"
	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/config"
)

// Catalog exposure must follow qualification in the checksummed upstream release.
func TestPublishedFloretMoonshotK31MatchesHostCatalog(t *testing.T) {
	for _, model := range []string{"kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"} {
		t.Run(model, func(t *testing.T) {
			entry, ok := config.AIModelCatalogEntry("moonshot", model)
			if !ok {
				t.Fatalf("missing host model %s", model)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/v1/chat/completions" || body["model"] != entry.EffectiveWireModelName() || body["max_completion_tokens"] != float64(4096) || body["max_tokens"] != nil || body["reasoning_effort"] != "high" {
					t.Errorf("published Floret does not support host model %s: %+v", model, body)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": "upstream verified"}, "finish_reason": "stop"}}})
			}))
			defer server.Close()
			capabilities := floretModelGatewayCapabilities(config.AIReasoningCapabilityForModel("moonshot", model))
			capabilities.AttachmentPayload = flprovider.AttachmentDescriptors
			gateway, err := flprovider.NewOpenAICompatible(flprovider.OpenAICompatibleOptions{
				Provider: "moonshot", Model: entry.EffectiveWireModelName(), BaseURL: server.URL + "/v1", APIKey: "fixture",
				StateCompatibilityKey: "moonshot:" + model, HTTPClient: server.Client(), Capabilities: capabilities,
			})
			if err != nil {
				t.Fatal(err)
			}
			stream, err := gateway.Stream(t.Context(), flprovider.Request{
				RunID: "catalog-adoption", PromptScopeID: "catalog-adoption", MaxOutputTokens: 4096,
				Reasoning: flconfig.ReasoningSelection{Level: flconfig.ReasoningLevelHigh},
				Messages:  []flprovider.Message{{Role: flprovider.RoleUser, Text: "Verify the upstream transport"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			var answer string
			for event := range stream {
				if event.Type == flprovider.EventError {
					t.Fatalf("upstream failed: %v", event.Err)
				}
				if event.Type == flprovider.EventDelta {
					answer += event.Text
				}
			}
			if answer != "upstream verified" {
				t.Fatalf("unexpected upstream output %q", answer)
			}
		})
	}
}
