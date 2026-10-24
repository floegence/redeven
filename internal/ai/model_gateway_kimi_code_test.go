package ai

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/config"
)

func TestKimiCodeResponsesReplayAndReasoning(t *testing.T) {
	for _, effort := range []config.AIReasoningLevel{"low", "high", "max"} {
		t.Run(string(effort), func(t *testing.T) {
			wire := make(chan map[string]any, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/coding/v1/responses" || r.Header.Get("Authorization") != "Bearer subscription-fixture" || r.Header.Get("User-Agent") != "Redeven" {
					t.Errorf("incorrect subscription route or identity: %s %s", r.URL.Path, r.Header.Get("User-Agent"))
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				wire <- body
				w.Header().Set("Content-Type", "text/event-stream")
				f := w.(http.Flusher)
				writeOpenAISSEJSON(w, f, map[string]any{"type": "response.reasoning_summary_text.delta", "delta": "Preserved reasoning"})
				writeOpenAISSEJSON(w, f, map[string]any{"type": "response.completed", "response": map[string]any{"id": "kimi-response", "status": "completed", "output": []any{
					map[string]any{"type": "reasoning", "summary": []any{map[string]any{"type": "summary_text", "text": "Preserved reasoning"}}},
					map[string]any{"type": "function_call", "id": "fc_next", "call_id": "next", "name": "inspect", "arguments": "{}", "status": "completed"},
				}, "usage": map[string]any{"input_tokens": 120, "output_tokens": 30, "total_tokens": 150, "input_tokens_details": map[string]any{"cached_tokens": 40}, "output_tokens_details": map[string]any{"reasoning_tokens": 20}}}})
			}))
			defer server.Close()
			gateway, err := newProviderAdapter("kimi_code", server.URL+"/coding/v1", "subscription-fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			sampling := 0.2
			request := ModelGatewayRequest{Model: "k3.1-pro", Budgets: TurnBudgets{MaxOutputToken: 4096}, ProviderControls: ProviderControls{Temperature: &sampling, TopP: &sampling, ReasoningSelection: config.AIReasoningSelection{Level: effort}, ReasoningCapability: config.AIReasoningCapabilityForModel("kimi_code", "k3.1-pro")}, Tools: []ToolDef{{Name: "inspect", InputSchema: json.RawMessage("{\"type\":\"object\",\"properties\":{}}")}}, Messages: []Message{
				{Role: "system", Content: []ContentPart{{Type: "text", Text: "Inspect carefully."}}},
				{Role: "user", Content: []ContentPart{{Type: "text", Text: "Inspect the code."}}},
				{Role: "assistant", Content: []ContentPart{{Type: "reasoning", Text: "first "}, {Type: "reasoning", Text: "thought"}, {Type: "tool_call", ToolCallID: "prior", ToolName: "inspect", ArgsJSON: "{}"}}},
				{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "prior", ToolName: "inspect", Text: "result"}}},
				{Role: "assistant", Content: []ContentPart{{Type: "reasoning", Text: "second thought"}, {Type: "text", Text: "Reviewed."}}},
				{Role: "user", Content: []ContentPart{{Type: "text", Text: "Check again."}}},
			}}
			var events []StreamEvent
			result, err := gateway.StreamTurn(t.Context(), request, func(e StreamEvent) { events = append(events, e) })
			if err != nil {
				t.Fatal(err)
			}
			body := <-wire
			if body["model"] != "k3.1-pro" || body["max_output_tokens"] != float64(4096) || body["reasoning"].(map[string]any)["effort"] != string(effort) {
				t.Fatalf("wrong wire controls: %+v", body)
			}
			for _, field := range []string{"previous_response_id", "include", "prompt_cache_key", "store", "temperature", "top_p"} {
				if _, ok := body[field]; ok {
					t.Fatalf("unexpected %s", field)
				}
			}
			input := body["input"].([]any)
			if len(input) != 7 {
				t.Fatalf("lost canonical history: %+v", input)
			}
			for _, check := range []struct {
				index int
				text  string
			}{{1, "first thought"}, {4, "second thought"}} {
				item := input[check.index].(map[string]any)
				if item["type"] != "reasoning" || item["summary"].([]any)[0].(map[string]any)["text"] != check.text {
					t.Fatalf("reasoning replay lost: %+v", item)
				}
				if _, ok := item["id"]; ok {
					t.Fatal("must not invent a reasoning item identity")
				}
			}
			if input[2].(map[string]any)["call_id"] != "prior" || input[3].(map[string]any)["call_id"] != "prior" {
				t.Fatal("tool exchange lost pairing")
			}
			if result.ProviderState != nil || result.Reasoning != "Preserved reasoning" || len(result.ToolCalls) != 1 || result.ToolCalls[0].ID != "next" {
				t.Fatalf("invalid completion: %+v", result)
			}
			if result.Usage.InputTokens != 80 || result.Usage.CacheReadTokens != 40 || result.Usage.OutputTokens != 30 || result.Usage.ReasoningTokens != 20 {
				t.Fatalf("usage lost: %+v", result.Usage)
			}
			if strings.Join(streamEventTexts(events, StreamEventThinkingDelta), "") != "Preserved reasoning" {
				t.Fatal("reasoning did not stream")
			}
		})
	}
}

func TestKimiCodeRejectsModelAndThinkingDowngrades(t *testing.T) {
	gateway, err := newProviderAdapter("kimi_code", "https://api.kimi.com/coding/v1", "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, request := range []ModelGatewayRequest{
		{Model: "K3.1 Pro"},
		{Model: "k3.1-pro[1m]"},
		{Model: "k3.1-pro", Protocol: "openai-chat-completions"},
		{Model: "k3.1-pro", PreviousState: &ModelGatewayState{Kind: providerContinuationKindOpenAIResponses, ID: "old"}},
		{Model: "k3.1-pro", ProviderControls: ProviderControls{ReasoningSelection: config.AIReasoningSelection{Level: "off"}}},
	} {
		prepared, err := gateway.(modelGatewayRequestPreparer).prepareTurn(t.Context(), request)
		if err == nil {
			prepared.Close()
			t.Fatalf("accepted invalid subscription request: %+v", request)
		}
	}
}

func TestKimiCodeQuotaAndTransientErrors(t *testing.T) {
	for _, tc := range []struct {
		message   string
		permanent bool
	}{
		{"You've reached your 5-hour usage limit. Your quota will reset.", true},
		{"You've reached your weekly (7-day) usage limit", true},
		{"You've reached your monthly usage limit for this billing cycle", true},
		{"Your credit balance is insufficient", true},
		{"Your organization's Extra Usage balance has run out", true},
		{"You've reached the Extra Usage limit set for your account by your organization", true},
		{"You've reached your concurrent request limit", true},
		{"We're receiving too many requests at the moment. Please wait a moment and try again.", false},
		{"The engine is currently overloaded, please try again later", false},
	} {
		t.Run(tc.message, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "2")
				w.WriteHeader(429)
				json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": tc.message, "type": "rate_limit_error"}})
			}))
			defer server.Close()
			gateway, err := newProviderAdapter("kimi_code", server.URL+"/coding/v1", "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			_, err = gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "k3.1-pro"}, nil)
			var failure *providerFailure
			if !errors.As(err, &failure) || failure.diagnostic.Provider != "kimi_code" {
				t.Fatalf("lost error: %v", err)
			}
			advice := flprovider.RetryAdviceForError(err)
			if (advice.Category == flprovider.RetryPermanent) != tc.permanent {
				t.Fatalf("wrong retry: %+v", advice)
			}
			if !tc.permanent && advice.NotBefore.IsZero() {
				t.Fatal("lost server retry deadline")
			}
		})
	}
}

func TestKimiK31PlatformWireParameters(t *testing.T) {
	for _, model := range []string{"kimi-k3.1-pro", "kimi-k3.1-pro-highspeed"} {
		t.Run(model, func(t *testing.T) {
			gateway, err := newProviderAdapter("moonshot", "https://api.moonshot.cn/v1", "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			sampling := 0.2
			request := ModelGatewayRequest{Model: model, Budgets: TurnBudgets{MaxOutputToken: 8192}, ProviderControls: ProviderControls{Temperature: &sampling, TopP: &sampling, ReasoningSelection: config.AIReasoningSelection{Level: "max"}, ReasoningCapability: config.AIReasoningCapabilityForModel("moonshot", model)}}
			prepared, err := gateway.(modelGatewayRequestPreparer).prepareTurn(t.Context(), request)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			var body map[string]any
			if err := json.Unmarshal(prepared.(*preparedModelWire).payload, &body); err != nil {
				t.Fatal(err)
			}
			if body["model"] != model || body["max_completion_tokens"] != float64(8192) || body["reasoning_effort"] != "max" {
				t.Fatalf("incorrect K3.1 controls: %+v", body)
			}
			for _, field := range []string{"max_tokens", "temperature", "top_p"} {
				if _, ok := body[field]; ok {
					t.Fatalf("unsupported K3.1 parameter %s", field)
				}
			}
		})
	}
}

func TestKimiCodeIncompleteStreamDoesNotAdmitTools(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc((&openAIMissingCompletedMock{mode: "tool_call"}).handle))
	defer server.Close()
	gateway, err := newProviderAdapter("kimi_code", server.URL, "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "k3.1-pro"}, nil)
	if flprovider.RetryAdviceForError(err).Category != flprovider.RetryStreamInterrupted || len(result.ToolCalls) != 0 || result.ProviderState != nil {
		t.Fatalf("unfinished subscription result admitted: %+v %v", result, err)
	}
}
