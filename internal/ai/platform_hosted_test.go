package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	flprovider "github.com/floegence/floret/v7/provider"
	"github.com/floegence/redeven/internal/config"
)

func TestPlatformHostedSearchPreservesFloretEventsAndReasoning(t *testing.T) {
	for _, incremental := range []bool{false, true} {
		t.Run(fmt.Sprintf("incremental=%t", incremental), func(t *testing.T) {
			testPlatformHostedSearch(t, incremental)
		})
	}
}

func testPlatformHostedSearch(t *testing.T, incremental bool) {
	edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/ai/v1/leases/renew":
			_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: "lease", RenewalToken: "renewal", ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
		case "/api/ai/v1/catalog":
			_, _ = w.Write([]byte(`{"models":[{"model_id":"test-model","available":true,"capabilities":["responses","web_search"]}]}`))
		case "/api/ai/v1/requests":
			var in platformGatewayRunRequest
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
				return
			}
			var body map[string]json.RawMessage
			if err := json.Unmarshal(in.Payload, &body); err != nil {
				t.Error(err)
				return
			}
			if !strings.Contains(string(body["tools"]), "web_search") || !strings.Contains(string(body["reasoning"]), `"low"`) {
				t.Error("hosted tools or reasoning lost")
			}
			w.Header().Set("Content-Type", "text/event-stream")
			if incremental {
				_, _ = fmt.Fprint(w, `data: {"type":"response.output_item.added","item":{"type":"web_search_call","id":"search1","status":"in_progress","action":{"type":"search","query":"reference"}}}`+"\n\n")
				_, _ = fmt.Fprint(w, `data: {"type":"response.output_item.done","item":{"type":"web_search_call","id":"search1","status":"completed","action":{"type":"search","query":"reference","sources":[{"url":"https://example.com","title":"Reference"}]}}}`+"\n\n")
				w.(http.Flusher).Flush()
			}
			_, _ = fmt.Fprint(w, "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"Checking sources\"}\n\n")
			_, _ = fmt.Fprint(w, `data: {"type":"response.completed","response":{"id":"resp_rd_search","status":"completed","output":[{"type":"web_search_call","id":"search1","status":"completed","action":{"type":"search","query":"reference"}},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Sourced answer","annotations":[{"type":"url_citation","url":"https://example.com","title":"Reference","start_index":0,"end_index":6}]}]}],"usage":{"input_tokens":12,"output_tokens":8,"output_tokens_details":{"reasoning_tokens":2}}}}`+"\n\n")
		default:
			w.WriteHeader(404)
		}
	}))
	defer edge.Close()
	gateway, err := newPlatformGatewayProvider(edge.URL, "lease", "test-model", 1)
	if err != nil {
		t.Fatal(err)
	}
	capability := config.AIReasoningCapabilityForModel("openai", "gpt-5-mini")
	adapter := newFloretProviderAdapter(gateway, platformGatewayProviderType, "test-model", ProviderControls{ReasoningCapability: capability}, TurnBudgets{MaxOutputToken: 2048}, config.AIWebSearchOpenAI)
	stream, err := adapter.Stream(t.Context(), flprovider.Request{ThreadID: "thread", RunID: "run", TurnID: "turn", PromptScopeID: "scope", LogicalRequestID: "logical", AttemptID: "attempt", AttemptEpoch: 1, Reasoning: config.AIReasoningSelection{Level: config.AIReasoningLevelLow}, Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "Find reference"}}, HostedTools: []flprovider.HostedToolDefinition{{Name: "web_search", Type: "web_search"}}})
	if err != nil {
		t.Fatal(err)
	}
	counts := map[flprovider.EventType]int{}
	var reasoning strings.Builder
	for event := range stream {
		if event.Err != nil {
			t.Fatal(event.Err)
		}
		counts[event.Type]++
		switch event.Type {
		case flprovider.EventReasoning:
			reasoning.WriteString(event.Text)
		case flprovider.EventHostedToolCall, flprovider.EventHostedToolResult:
			if event.HostedToolCall == nil || event.HostedToolCall.ID != "search1" || !strings.Contains(event.HostedToolCall.Args, "reference") {
				t.Fatalf("hosted identity/action lost: %+v", event)
			}
			if event.Type == flprovider.EventHostedToolResult && (event.HostedResult == nil || event.HostedResult.Error != nil || incremental && len(event.HostedResult.Results) != 1) {
				t.Fatalf("hosted result lost: %+v", event.HostedResult)
			}
		case flprovider.EventSources:
			if len(event.Sources) != 1 || event.Sources[0].URL != "https://example.com" {
				t.Fatalf("citations lost: %+v", event.Sources)
			}
		case flprovider.EventUsage:
			if event.Usage.InputTokens != 12 || event.Usage.OutputTokens != 8 || event.Usage.ReasoningTokens != 2 {
				t.Fatalf("usage lost: %+v", event.Usage)
			}
		}
		if event.Type == flprovider.EventDone && (event.ResponseState == nil || event.ResponseState.ID != "resp_rd_search") {
			t.Fatal("continuation lost")
		}
	}
	for _, event := range []flprovider.EventType{flprovider.EventHostedToolCall, flprovider.EventHostedToolResult, flprovider.EventReasoning, flprovider.EventSources, flprovider.EventUsage, flprovider.EventDone} {
		if counts[event] != 1 {
			t.Fatalf("Floret %s event count=%d, want 1", event, counts[event])
		}
	}
	if reasoning.String() != "Checking sources" || counts[flprovider.EventToolCalls] != 0 {
		t.Fatal("reasoning or hosted/local tool ownership changed")
	}
}

func TestPlatformGatewayRequiresTerminalEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, protocol, stream string
		wantError              bool
	}{
		{"responses-disconnect", "responses", `data: {"type":"response.output_text.delta","delta":"partial"}`, true},
		{"chat-disconnect", "chat", `data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}`, true},
		{"responses-failure", "responses", `data: {"type":"response.failed","response":{"status":"failed"}}`, true},
		{"responses-truncated", "responses", `data: {"type":"response.incomplete","response":{"status":"incomplete","id":"resp_rd_partial","output":[{"type":"message","content":[{"type":"output_text","text":"partial"}]}]}}`, false},
		{"responses-filtered", "responses", `data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"content_filter"},"id":"resp_rd_partial","output":[{"type":"message","content":[{"type":"output_text","text":"partial"}]}]}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			edge := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/api/ai/v1/leases/renew":
					_ = json.NewEncoder(w).Encode(platformGatewayLease{Token: "lease", RenewalToken: "renewal", ExpiresAtUnix: time.Now().Add(time.Minute).Unix(), EntitlementVersion: 1})
				case "/api/ai/v1/catalog":
					_, _ = fmt.Fprintf(w, `{"models":[{"model_id":"test-model","available":true,"capabilities":[%q]}]}`, tc.protocol)
				case "/api/ai/v1/requests":
					calls++
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = fmt.Fprint(w, tc.stream+"\n\n")
				}
			}))
			defer edge.Close()
			gateway, err := newPlatformGatewayProvider(edge.URL, "lease", "test-model", 1)
			if err != nil {
				t.Fatal(err)
			}
			result, err := gateway.StreamTurn(t.Context(), platformTestRequest(), nil)
			if (err != nil) != tc.wantError || calls != 1 {
				t.Fatalf("terminal/retry boundary: calls=%d err=%v", calls, err)
			}
			wantReason := "length"
			if tc.name == "responses-filtered" {
				wantReason = "content_filter"
			}
			if !tc.wantError && (result.FinishReason != wantReason || result.ProviderState == nil || result.ProviderState.ID != "resp_rd_partial") {
				t.Fatalf("truncation/continuation lost: %+v", result)
			}
		})
	}
}
