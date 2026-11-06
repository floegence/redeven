package ai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
)

func TestProviderToolNameGuidanceUsesRegisteredAliases(t *testing.T) {
	definitions := []ToolDef{
		{Name: "web.search", Description: "Search the web."},
		{Name: "plugin.lookup"},
		{Name: "plugin.nested.read", Description: "Read plugin.lookup; preserve ui.ref('plugin.lookup').click()."},
		{Name: "inspect", Description: "Inspect without renaming."},
	}
	aliases, err := newOpenAIProviderToolAliases(definitions)
	if err != nil {
		t.Fatal(err)
	}
	wanted := []string{"web_search_tool", "plugin_lookup", "plugin_nested_read", "inspect"}
	responses := buildOpenAITools(definitions, false, aliases)
	chat := buildOpenAIChatTools(definitions, false, aliases)
	for i, definition := range definitions {
		for _, actual := range []struct{ name, description string }{
			{responses[i].OfFunction.Name, responses[i].OfFunction.Description.Value},
			{chat[i].OfFunction.Function.Name, chat[i].OfFunction.Function.Description.Value},
		} {
			if actual.name != wanted[i] {
				t.Fatalf("callable name=%q, want %q", actual.name, wanted[i])
			}
			if definition.Name == actual.name {
				if actual.description != definition.Description {
					t.Error("unchanged tool acquired name guidance")
				}
				continue
			}
			if !strings.HasPrefix(actual.description, definition.Description) || !strings.Contains(actual.description, "`"+definition.Name+"`") || !strings.Contains(actual.description, "Invoke it as `"+wanted[i]+"`") {
				t.Errorf("description omits registered mapping: %q", actual.description)
			}
		}
	}
}

func TestProviderToolNameGuidanceAtWireBoundary(t *testing.T) {
	cases := []struct {
		provider, model, protocol string
		chatGPT                   bool
	}{
		{provider: "openai", model: "gpt-4o", protocol: "openai-responses"},
		{provider: "openai", model: "gpt-4o", protocol: "openai-chat-completions"},
		{provider: "openai", model: "gpt-5.5", chatGPT: true},
		{provider: "deepseek", model: "deepseek-v4-pro"},
		{provider: "moonshot", model: "kimi-k2.6"},
		{provider: "kimi_code", model: "k3.1-pro"},
		{provider: "google", model: "gemini-model"},
		{provider: "openrouter", model: "openai/gpt-4o"},
		{provider: "xai", model: "fixture"},
		{provider: "groq", model: "fixture"},
		{provider: "ollama", model: "local-model"},
		{provider: "qwen", model: "qwen-model"},
		{provider: "chatglm", model: "glm-5.1"},
		{provider: "openai_compatible", model: "fixture"},
		{provider: "anthropic", model: "fixture"},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%s/%s/chatgpt=%v", tc.provider, tc.protocol, tc.chatGPT), func(t *testing.T) {
			var bodies [][]byte
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				bodies = append(bodies, raw)
				writeToolNameGuidanceResponse(w, r, tc.provider, tc.chatGPT)
			}))
			defer server.Close()
			gateway, err := newProviderAdapter(tc.provider, server.URL+"/v1", "fixture-key", nil)
			if err != nil {
				t.Fatal(err)
			}
			if tc.chatGPT {
				p := gateway.(*openAIProvider)
				p.chatGPT = true
				p.chatGPTToken = func(context.Context) (string, error) { return "fixture-oauth", nil }
			}
			request := toolNameGuidanceRequest()
			request.Model, request.Protocol = tc.model, tc.protocol
			before, err := json.Marshal(request)
			if err != nil {
				t.Fatal(err)
			}
			prepared, err := gateway.(modelGatewayRequestPreparer).prepareTurn(t.Context(), request)
			if err != nil {
				t.Fatal(err)
			}
			defer prepared.Close()
			if len(bodies) != 0 {
				t.Fatal("preparing name guidance dispatched a request")
			}
			var observedNames []string
			onEvent := func(event StreamEvent) {
				if event.ToolCall != nil {
					observedNames = append(observedNames, event.ToolCall.Name)
				}
			}
			result, err := prepared.StreamTurn(t.Context(), onEvent)
			if err != nil {
				t.Fatal(err)
			}
			if len(bodies) != 1 {
				t.Fatalf("requests=%d", len(bodies))
			}
			assertToolNameGuidanceWire(t, bodies[0], request, tc.provider == "anthropic")
			if prepared.RenderedPayloadFingerprint() != fmt.Sprintf("sha256:%x", sha256.Sum256(bodies[0])) {
				t.Fatal("guidance was added after freezing the request")
			}
			if len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != "computer.exec" {
				t.Fatalf("returned calls lost canonical identity: %+v", result.ToolCalls)
			}
			if len(observedNames) == 0 {
				t.Fatal("missing tool-call stream observations")
			}
			for _, name := range observedNames {
				if name != "computer.exec" {
					t.Fatalf("stream leaked callable alias %q", name)
				}
			}
			replay, err := prepared.(interface {
				replay(context.Context, flprovider.Request) (preparedModelGatewayTurn, error)
			}).replay(t.Context(), flprovider.Request{AttemptID: "retry", AttemptEpoch: 2})
			if err != nil {
				t.Fatal(err)
			}
			defer replay.Close()
			if _, err := replay.StreamTurn(t.Context(), nil); err != nil {
				t.Fatal(err)
			}
			if len(bodies) != 2 || !bytes.Equal(bodies[0], bodies[1]) || replay.RenderedPayloadFingerprint() != prepared.RenderedPayloadFingerprint() {
				t.Fatal("transport retry changed tool name guidance")
			}
			after, err := json.Marshal(request)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("provider rendering mutated canonical tool definitions or messages")
			}
		})
	}
}

func toolNameGuidanceRequest() ModelGatewayRequest {
	wanted := map[string]bool{"computer.exec": true, "computer.select_target": true, "attachment.materialize": true, "file.present": true, "file.edit": true, "terminal.exec": true}
	var definitions []ToolDef
	for _, definition := range builtInToolDefinitions() {
		if wanted[definition.Name] {
			definitions = append(definitions, definition)
		}
	}
	definitions = append(definitions, ToolDef{Name: "inspect", Description: "Inspect an item.", InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)})
	return ModelGatewayRequest{
		Messages: []Message{
			{Role: "system", Content: []ContentPart{{Type: "text", Text: buildFlowerSystemPrompt()}}},
			{Role: "user", Content: []ContentPart{{Type: "text", Text: "Inspect the document. Preserve literal computer.exec in /workspace/computer.exec.txt."}}},
		},
		Tools: definitions,
	}
}

func assertToolNameGuidanceWire(t *testing.T, raw []byte, request ModelGatewayRequest, canonicalNames bool) {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	var functions []map[string]any
	var collect func([]any)
	collect = func(items []any) {
		for _, item := range items {
			tool := item.(map[string]any)
			if nested, ok := tool["tools"].([]any); ok {
				collect(nested)
			} else if function, ok := tool["function"].(map[string]any); ok {
				functions = append(functions, function)
			} else {
				functions = append(functions, tool)
			}
		}
	}
	collect(body["tools"].([]any))
	if len(functions) != len(request.Tools) {
		t.Fatalf("functions=%d, want %d", len(functions), len(request.Tools))
	}
	for i, definition := range request.Tools {
		name := definition.Name
		if !canonicalNames {
			name = openAIWireToolName(name)
		}
		fn := functions[i]
		if fn["name"] != name {
			t.Fatalf("callable name=%v, want %q", fn["name"], name)
		}
		description, _ := fn["description"].(string)
		if name == definition.Name {
			if description != definition.Description {
				t.Errorf("unchanged name %q acquired guidance: %q", name, description)
			}
		} else {
			if !strings.HasPrefix(description, definition.Description+"\n\n") || !strings.Contains(description, "`"+definition.Name+"`") || !strings.Contains(description, "`"+name+"`") {
				t.Errorf("%s description does not explain canonical-to-callable mapping", name)
			}
		}
		var schema any
		if err := json.Unmarshal(definition.InputSchema, &schema); err != nil {
			t.Fatal(err)
		}
		renderedSchema := fn["parameters"]
		if canonicalNames {
			renderedSchema = fn["input_schema"]
		}
		if !reflect.DeepEqual(schema, renderedSchema) {
			t.Errorf("name guidance changed %s argument schema", name)
		}
	}
	for _, message := range request.Messages {
		for _, part := range message.Content {
			encoded, _ := json.Marshal(part.Text)
			if !bytes.Contains(raw, encoded) {
				t.Error("name guidance rewrote original prompt or user content")
			}
		}
	}
}

func writeToolNameGuidanceResponse(w http.ResponseWriter, r *http.Request, provider string, chatGPT bool) {
	w.Header().Set("Content-Type", "text/event-stream")
	args := `{"code":"await ui.snapshot();","description":"Inspect"}`
	if provider == "anthropic" {
		emit := func(value map[string]any) {
			raw, _ := json.Marshal(value)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", value["type"], raw)
			w.(http.Flusher).Flush()
		}
		emit(map[string]any{"type": "message_start", "message": map[string]any{"id": "response", "type": "message", "role": "assistant", "model": "fixture", "content": []any{}, "usage": map[string]any{"input_tokens": 1, "output_tokens": 0}}})
		emit(map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "tool_use", "id": "call", "name": "computer.exec", "input": map[string]any{}}})
		emit(map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "input_json_delta", "partial_json": args}})
		emit(map[string]any{"type": "content_block_stop", "index": 0})
		emit(map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": "tool_use"}, "usage": map[string]any{"output_tokens": 1}})
		emit(map[string]any{"type": "message_stop"})
		return
	}
	if strings.HasSuffix(r.URL.Path, "/responses") {
		item := map[string]any{"type": "function_call", "id": "item", "call_id": "call", "name": "computer_exec", "arguments": args, "status": "completed"}
		if chatGPT {
			item["namespace"] = chatGPTToolNamespace
		}
		writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
		writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
		writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"type": "response.completed", "response": map[string]any{"id": "response", "status": "completed", "output": []any{item}}})
		return
	}
	writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"id": "response", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call", "type": "function", "function": map[string]any{"name": "computer_exec", "arguments": args}}}}, "finish_reason": nil}}})
	writeOpenAISSEJSON(w, w.(http.Flusher), map[string]any{"id": "response", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{}, "finish_reason": "tool_calls"}}})
	fmt.Fprint(w, "data: [DONE]\n\n")
}
