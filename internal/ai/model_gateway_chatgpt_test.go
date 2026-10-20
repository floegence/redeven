package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/floegence/redeven/internal/chatgpt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	oresponses "github.com/openai/openai-go/v3/responses"
)

func TestChatGPTWireFullHistoryNamespaceAndNativeReplay(t *testing.T) {
	var bodies []map[string]any
	var rawBodies [][]byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		rawBodies = append(rawBodies, raw)
		var body map[string]any
		json.Unmarshal(raw, &body)
		bodies = append(bodies, body)
		if r.Header.Get("Authorization") != "Bearer rotating-access" {
			t.Error("current OAuth token not resolved")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		output := []any{map[string]any{"type": "reasoning", "id": "reasoning_1", "summary": []any{}, "encrypted_content": "opaque-encrypted"}, map[string]any{"type": "message", "id": "message_1", "role": "assistant", "status": "completed", "phase": "commentary", "content": []any{map[string]any{"type": "output_text", "text": "checking", "annotations": []any{}}}}, map[string]any{"type": "function_call", "id": "item_1", "call_id": "call_1", "name": "inspect", "namespace": "redeven", "arguments": "{}", "status": "completed"}}
		event := map[string]any{"type": "response.completed", "response": map[string]any{"id": "response_1", "model": "gpt-5.5", "status": "completed", "output": output}}
		encoded, _ := json.Marshal(event)
		fmt.Fprintf(w, "event: response.completed\ndata: %s\n\n", encoded)
	}))
	defer server.Close()
	adapter, err := newProviderAdapter("openai", server.URL+"/v1", "never-use-this-key", nil)
	if err != nil {
		t.Fatal(err)
	}
	provider := adapter.(*openAIProvider)
	provider.chatGPT = true
	provider.chatGPTToken = func(context.Context) (string, error) { return "rotating-access", nil }
	req := ModelGatewayRequest{Model: "gpt-5.5", Messages: []Message{{Role: "system", Content: []ContentPart{{Type: "text", Text: "system instructions"}}}, {Role: "user", Content: []ContentPart{{Type: "text", Text: "inspect the image"}, {Type: "image", MimeType: "image/png", FileURI: "https://example.com/image.png"}}}}, Tools: []ToolDef{{Name: "inspect", Strict: true, InputSchema: json.RawMessage(`{"type":"object","properties":{"content":{"type":"string"},"file_path":{"type":"string"}},"required":["file_path","content"],"additionalProperties":false}`)}}}
	first, err := provider.StreamTurn(context.Background(), req, nil)
	if err != nil {
		t.Fatal(err)
	}
	wire, _ := json.Marshal(bodies[0])
	if !strings.Contains(string(rawBodies[0]), `"properties":{"file_path":`) {
		t.Fatalf("namespace lost schema order: %s", rawBodies[0])
	}
	for _, field := range []string{"max_output_tokens", "temperature", "top_p", "previous_response_id", "metadata", "background", "conversation", "max_tool_calls", "prompt_cache_retention", "truncation", "safety_identifier"} {
		if _, ok := bodies[0][field]; ok {
			t.Errorf("unsupported field %s", field)
		}
	}
	if bodies[0]["store"] != false || bodies[0]["stream"] != true || bodies[0]["instructions"] != "system instructions" || !strings.Contains(string(wire), `"type":"namespace"`) || !strings.Contains(string(wire), `"name":"redeven"`) || !strings.Contains(string(wire), "input_image") || !strings.Contains(string(wire), "reasoning.encrypted_content") {
		t.Fatalf("invalid public ChatGPT wire: %s", wire)
	}
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: first.Text}, {Type: "tool_call", ToolCallID: "call_1", ToolName: "inspect", ArgsJSON: "{}"}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call_1", Text: "done"}}})
	req.PreviousState = first.ProviderState
	if _, err := provider.StreamTurn(context.Background(), req, nil); err != nil {
		t.Fatal(err)
	}
	replay, _ := json.Marshal(bodies[1])
	if !strings.Contains(string(replay), "opaque-encrypted") || !strings.Contains(string(replay), `"phase":"commentary"`) || !strings.Contains(string(replay), "function_call_output") || !strings.Contains(string(replay), "inspect the image") {
		t.Fatalf("incomplete replay %s", replay)
	}
	req.Messages = []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "compacted complete summary"}}}}
	if _, err := provider.StreamTurn(context.Background(), req, nil); err != nil {
		t.Fatal(err)
	}
	compacted, _ := json.Marshal(bodies[2])
	if strings.Contains(string(compacted), "opaque-encrypted") || !strings.Contains(string(compacted), "compacted complete summary") {
		t.Fatal("stale native output crossed compaction")
	}
}
func TestChatGPTStreamTerminalAndLateUsageFailures(t *testing.T) {
	for _, terminal := range []string{"response.failed", "response.incomplete", "disconnect"} {
		t.Run(terminal, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n")
				if terminal != "disconnect" {
					fmt.Fprintf(w, "data: {\"type\":%q,\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\"}}}\n\n", terminal)
				}
			}))
			defer server.Close()
			adapter, _ := newProviderAdapter("openai", server.URL+"/v1", "access", nil)
			p := adapter.(*openAIProvider)
			p.chatGPT = true
			result, err := p.StreamTurn(context.Background(), ModelGatewayRequest{Model: "gpt-5.5", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hello"}}}}}, nil)
			if err == nil || result.ProviderState != nil {
				t.Fatal("noncompleted response committed state")
			}
			if terminal == "response.failed" {
				var e *chatgpt.RequestError
				if !errors.As(err, &e) || chatgpt.Failure(e.Code).Action != "manage_usage" || classifyRunFailureCode(err, "") != runErrorCodeChatGPTUsage {
					t.Fatalf("wrong recovery: %v", err)
				}
			}
		})
	}
}

func TestChatGPTUsesCurrentWebSearchTool(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Tools []struct {
				Type string `json:"type"`
			} `json:"tools"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if len(body.Tools) != 1 || body.Tools[0].Type != "web_search" {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `{"detail":"Unsupported tool type: web_search_preview"}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"response\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"id\":\"answer\",\"role\":\"assistant\",\"status\":\"completed\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hello.\",\"annotations\":[]}]}]}}\n\n")
	}))
	defer server.Close()
	adapter, _ := newProviderAdapter("openai", server.URL+"/v1", "fixture", nil)
	p := adapter.(*openAIProvider)
	p.chatGPT = true
	result, err := p.StreamTurn(t.Context(), ModelGatewayRequest{Model: "gpt-6.1-sol", WebSearchMode: providerWebSearchModeOpenAIResponsesBuiltin, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}}}, nil)
	if err != nil || result.Text != "Hello." {
		t.Fatalf("current web search contract: result=%+v error=%v", result, err)
	}
}

func TestChatGPTCompletedItemsPreserveNativeOutput(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		raw, _ := io.ReadAll(r.Body)
		if requests == 2 && (!strings.Contains(string(raw), "opaque-streamed-reasoning") || !strings.Contains(string(raw), `"phase":"commentary"`) || !strings.Contains(string(raw), `\"optional\":null`)) {
			t.Error("continuation lost original streamed native output")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hello.\"}\n\n")
		items := []string{
			`{"type":"reasoning","id":"reasoning","summary":[],"encrypted_content":"opaque-streamed-reasoning"}`,
			`{"type":"message","id":"answer","role":"assistant","status":"completed","phase":"commentary","content":[{"type":"output_text","text":"Hello.","annotations":[]}]}`,
		}
		if requests == 1 {
			items = append(items, `{"type":"function_call","id":"item","call_id":"call","name":"inspect","namespace":"redeven","arguments":"{\"required\":\"value\",\"optional\":null}","status":"completed"}`)
		}
		for index, item := range items {
			fmt.Fprintf(w, "data: {\"type\":\"response.output_item.done\",\"output_index\":%d,\"item\":%s}\n\n", index, item)
		}
		fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"response\",\"status\":\"completed\",\"output\":[]}}\n\n")
	}))
	defer server.Close()
	adapter, _ := newProviderAdapter("openai", server.URL+"/v1", "fixture", nil)
	p := adapter.(*openAIProvider)
	p.chatGPT = true
	p.strictToolSchema = true
	req := ModelGatewayRequest{Model: "gpt-6.1-sol", Tools: []ToolDef{strictFixtureTool()}, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "hi"}}}}}
	result, err := p.StreamTurn(t.Context(), req, nil)
	if err != nil || result.Text != "Hello." || len(result.ToolCalls) != 1 {
		t.Fatalf("completed stream: result=%+v error=%v", result, err)
	}
	if _, exists := result.ToolCalls[0].Args["optional"]; exists {
		t.Fatal("synthetic null entered canonical output")
	}
	req.PreviousState = result.ProviderState
	req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: result.Text}, {Type: "tool_call", ToolCallID: "call", ToolName: "inspect", ArgsJSON: `{"required":"value"}`}}}, Message{Role: "tool", Content: []ContentPart{{Type: "tool_result", ToolCallID: "call", Text: "done"}}})
	if _, err := p.StreamTurn(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
}

func TestChatGPTCompletedItemBoundaries(t *testing.T) {
	item := func(raw string) oresponses.ResponseOutputItemUnion {
		var output oresponses.ResponseOutputItemUnion
		if err := json.Unmarshal([]byte(raw), &output); err != nil {
			t.Fatal(err)
		}
		return output
	}
	one := item(`{"type":"message","id":"one","role":"assistant","content":[]}`)
	two := item(`{"type":"message","id":"two","role":"assistant","content":[]}`)
	var c chatGPTCompletedItems
	if _, err := c.complete(nil); err == nil {
		t.Fatal("empty output accepted")
	}
	if err := c.add(1, two); err != nil {
		t.Fatal(err)
	}
	if _, err := c.complete(nil); err == nil {
		t.Fatal("missing output index accepted")
	}
	if err := c.add(0, one); err != nil {
		t.Fatal(err)
	}
	if err := c.add(0, one); err != nil {
		t.Fatal("identical completed item rejected")
	}
	if err := c.add(0, two); err == nil {
		t.Fatal("conflicting completed item accepted")
	}
	if _, err := c.complete([]oresponses.ResponseOutputItemUnion{one}); err == nil {
		t.Fatal("incomplete terminal snapshot accepted")
	}
	output, err := c.complete([]oresponses.ResponseOutputItemUnion{one, two})
	if err != nil || len(output) != 2 || output[0].RawJSON() != one.RawJSON() {
		t.Fatal("native bytes or output order changed")
	}
	c.bytes = 8 << 20
	if err := c.add(2, one); err == nil {
		t.Fatal("output limit exceeded")
	}
	if err := c.add(-1, one); err == nil {
		t.Fatal("negative output index accepted")
	}
}
