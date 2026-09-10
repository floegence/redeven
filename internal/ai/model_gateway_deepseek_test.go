package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/config"
)

func TestDeepSeekResponsesReplaysHistoricalSearchWithoutEnablingIt(t *testing.T) {
	var bodies []map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			t.Errorf("route=%s", r.URL.Path)
		}
		var body map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		bodies = append(bodies, body)
		// Historical response items remain readable even though current tools ignore hosted search.
		output := `[{"type":"reasoning","content":[{"type":"reasoning_text","text":"checking"}]},{"type":"web_search_call","id":"ws1","status":"completed","opaque_results":"receipt","action":{"type":"search","query":"docs"}},{"type":"function_call","id":"item1","call_id":"call1","name":"okf_index","arguments":"{}"}]`
		if len(bodies) > 1 {
			output = `[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"done"}]}]`
		}
		fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp\",\"status\":\"completed\",\"output\":%s}}\n\n", output)
	}))
	defer server.Close()
	base, err := newProviderAdapter("deepseek", server.URL, "secret", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := base.(*deepSeekProvider); !ok {
		t.Fatal("DeepSeek did not use Floret transport")
	}
	controls := ProviderControls{ReasoningSelection: config.AIReasoningSelection{Level: config.AIReasoningLevelOff}, ReasoningCapability: config.AIReasoningCapabilityForModel("deepseek", "deepseek-v4-pro")}
	adapter := newFloretProviderAdapter(base, "deepseek", "deepseek-v4-pro", controls, TurnBudgets{}, providerWebSearchModeDisabled)
	req := flprovider.Request{RunID: "run", PromptScopeID: "scope", Reasoning: controls.ReasoningSelection, Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "docs?"}}}
	// Use the same canonical dotted tool name the runtime exposes.
	req.Tools = deepSeekTestTools()
	stream, err := adapter.Stream(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	var state *flprovider.State
	var starts, results int
	var call flprovider.ToolCall
	for e := range stream {
		if e.Err != nil {
			t.Fatal(e.Err)
		}
		switch e.Type {
		case flprovider.EventHostedToolCall:
			starts++
		case flprovider.EventHostedToolResult:
			results++
		case flprovider.EventToolCalls:
			if len(e.ToolCalls) != 1 {
				t.Fatal(e)
			}
			call = e.ToolCalls[0]
		case flprovider.EventDone:
			state = e.ResponseState
		}
	}
	if starts != 1 || results != 1 || state == nil || call.Name != "okf.index" || call.Args != "{}" {
		t.Fatalf("search=%d/%d state=%v call=%+v", starts, results, state != nil, call)
	}
	req.PreviousState = state
	req.Messages = append(req.Messages, flprovider.Message{Role: flprovider.RoleAssistant, Reasoning: "checking", ToolCalls: []flprovider.ToolCall{call}}, flprovider.Message{Role: flprovider.RoleTool, ToolResult: &flprovider.ToolResult{CallID: call.ID, ToolName: call.Name, Text: "index"}})
	stream, err = adapter.Stream(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	for e := range stream {
		if e.Err != nil {
			t.Fatal(e.Err)
		}
	}
	for _, body := range bodies {
		var tools []struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(body["tools"], &tools); err != nil {
			t.Fatal(err)
		}
		for _, tool := range tools {
			if tool.Type != "function" {
				t.Fatalf("unexpected hosted tool: %s", tool.Type)
			}
		}
		if _, ok := body["messages"]; ok {
			t.Fatal("used chat")
		}
		if _, ok := body["previous_response_id"]; ok {
			t.Fatal("used server continuation")
		}
		if _, ok := body["enable_search"]; ok {
			t.Fatal("used chat search")
		}
		if string(body["reasoning"]) != `{"effort":"none"}` {
			t.Fatalf("reasoning=%s", body["reasoning"])
		}
	}
	if !strings.Contains(string(bodies[1]["input"]), `"opaque_results":"receipt"`) {
		t.Fatalf("lost search receipt: %s", bodies[1]["input"])
	}
}

func deepSeekTestTools() []fltools.ToolDefinition {
	return []fltools.ToolDefinition{{Name: "okf.index", InputSchema: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}}}
}

func TestDeepSeekShortRequestDoesNotEnableSearch(t *testing.T) {
	adapter := newFloretProviderAdapter(&deepSeekProvider{}, "deepseek", "deepseek-v4-pro", ProviderControls{}, TurnBudgets{}, providerWebSearchModeDisabled)
	request, err := adapter.turnRequest(context.Background(), flprovider.Request{Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "title"}}})
	if err != nil {
		t.Fatal(err)
	}
	if request.WebSearchMode != providerWebSearchModeDisabled {
		t.Fatalf("unexpected title search: %s", request.WebSearchMode)
	}
}

func TestDeepSeekVisionReasoningSelectionWireContract(t *testing.T) {
	for _, tc := range []struct {
		name  string
		level config.AIReasoningLevel
		want  string
	}{
		{name: "unspecified"},
		{name: "default", level: config.AIReasoningLevelDefault},
		{name: "off", level: config.AIReasoningLevelOff, want: `{"effort":"none"}`},
		{name: "low", level: config.AIReasoningLevelLow, want: `{"effort":"low"}`},
		{name: "high", level: config.AIReasoningLevelHigh, want: `{"effort":"high"}`},
		{name: "max", level: config.AIReasoningLevelMax, want: `{"effort":"max"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body map[string]json.RawMessage
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp\",\"status\":\"completed\",\"output\":[]}}\n\n")
			}))
			defer server.Close()
			base, err := newProviderAdapter("deepseek", server.URL, "test-key", nil)
			if err != nil {
				t.Fatal(err)
			}
			selection := config.AIReasoningSelection{Level: tc.level}
			capability := config.AIReasoningCapabilityForModel("deepseek", "deepseek-v4-flash-vision-exp")
			if !capability.SupportsLevel(tc.level) {
				t.Fatalf("catalog rejects %q", tc.level)
			}
			adapter := newFloretProviderAdapter(base, "deepseek", "deepseek-v4-flash-vision-exp", ProviderControls{ReasoningSelection: selection, ReasoningCapability: capability}, TurnBudgets{}, providerWebSearchModeDisabled)
			stream, err := adapter.Stream(context.Background(), flprovider.Request{
				RunID: "run", PromptScopeID: "scope", Reasoning: selection,
				Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "hello"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			for event := range stream {
				if event.Err != nil {
					t.Fatal(event.Err)
				}
			}
			if body == nil {
				t.Fatal("provider request was not sent")
			}
			if got := string(body["reasoning"]); got != tc.want {
				t.Fatalf("reasoning = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestDeepSeekVisionUsesPreparedImageAndPreservesToolContinuation(t *testing.T) {
	var bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		bodies = append(bodies, string(body))
		output := `[{"type":"function_call","id":"vision-item","call_id":"vision-call","name":"inspect","arguments":"{}"}]`
		if len(bodies) > 1 {
			output = `[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"image inspected"}]}]`
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"vision\",\"status\":\"completed\",\"output\":%s}}\n\n", output)
	}))
	defer server.Close()
	gateway, err := newProviderAdapter("deepseek", server.URL, "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	request := ModelGatewayRequest{Model: "deepseek-v4-flash-vision-exp", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Inspect this image"}, {Type: "image", FileURI: "data:image/png;base64,AQID", MimeType: "image/png"}}}}, Tools: []ToolDef{{Name: "inspect", InputSchema: json.RawMessage(`{"type":"object","properties":{}}`)}}}
	first, err := gateway.StreamTurn(context.Background(), request, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.ToolCalls) != 1 || first.ProviderState == nil || !strings.Contains(bodies[0], `"type":"input_image"`) || !strings.Contains(bodies[0], "data:image/png;base64,AQID") {
		t.Fatalf("missing vision/tool response: %+v %v", first, bodies)
	}
	state, _ := json.Marshal(first.ProviderState)
	if strings.Contains(string(state), "base64") {
		t.Fatal("image bytes leaked into opaque state")
	}
	request.PreviousState = first.ProviderState
	request.Messages = append(request.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "tool_call", ToolName: "inspect", ToolCallID: "vision-call", ArgsJSON: "{}"}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "vision-call", Text: "ready"}}})
	result, err := gateway.StreamTurn(context.Background(), request, nil)
	if err != nil || result.Text != "image inspected" {
		t.Fatalf("vision continuation failed: %+v %v", result, err)
	}
	request.Model = "deepseek-v4-pro"
	request.PreviousState = nil
	if _, err = gateway.StreamTurn(context.Background(), request, nil); err == nil {
		t.Fatal("pure text DeepSeek model accepted an image")
	}
}
