package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProviderArgumentFragmentsPreserveBytesAndLateIdentity(t *testing.T) {
	const first = `{"content":"中文\n`
	const last = `\ud83d\ude00"}`
	for _, providerType := range []string{"openai", "google", "moonshot", "anthropic", "deepseek"} {
		t.Run(providerType, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				emit := func(value any) {
					raw, _ := json.Marshal(value)
					if providerType == "anthropic" {
						fmt.Fprintf(w, "event: %s\n", value.(map[string]any)["type"])
					}
					fmt.Fprintf(w, "data: %s\n\n", raw)
					w.(http.Flusher).Flush()
				}
				switch providerType {
				case "google", "moonshot":
					chunk := func(call map[string]any, finish any) {
						emit(map[string]any{"id": "response", "object": "chat.completion.chunk", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{call}}, "finish_reason": finish}}})
					}
					chunk(map[string]any{"index": 0, "function": map[string]any{"arguments": first}}, nil)
					chunk(map[string]any{"index": 0, "id": "call", "type": "function", "function": map[string]any{"name": "inspect"}}, nil)
					chunk(map[string]any{"index": 0, "function": map[string]any{"arguments": last}}, "tool_calls")
				case "anthropic":
					emit(map[string]any{"type": "message_start", "message": map[string]any{"id": "response", "type": "message", "role": "assistant", "model": "claude-sonnet-4-6", "content": []any{}, "usage": map[string]any{"input_tokens": 1, "output_tokens": 0}}})
					emit(map[string]any{"type": "content_block_start", "index": 0, "content_block": map[string]any{"type": "tool_use", "id": "call", "name": "inspect", "input": map[string]any{}}})
					for _, fragment := range []string{first, last} {
						emit(map[string]any{"type": "content_block_delta", "index": 0, "delta": map[string]any{"type": "input_json_delta", "partial_json": fragment}})
					}
					emit(map[string]any{"type": "content_block_stop", "index": 0})
					emit(map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": "tool_use"}, "usage": map[string]any{"output_tokens": 10}})
					emit(map[string]any{"type": "message_stop"})
				default:
					item := map[string]any{"type": "function_call", "id": "item", "call_id": "call", "name": "inspect", "arguments": ""}
					emit(map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
					for _, fragment := range []string{first, last} {
						emit(map[string]any{"type": "response.function_call_arguments.delta", "item_id": "item", "output_index": 0, "delta": fragment})
					}
					emit(map[string]any{"type": "response.function_call_arguments.done", "item_id": "item", "output_index": 0, "arguments": first + last})
					item["arguments"] = first + last
					emit(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
					emit(map[string]any{"type": "response.completed", "response": map[string]any{"id": "response", "status": "completed", "output": []any{item}, "usage": map[string]any{"input_tokens": 1, "output_tokens": 10}}})
				}
			}))
			defer server.Close()
			gateway, err := newProviderAdapter(providerType, server.URL, "fixture", nil)
			if err != nil {
				t.Fatal(err)
			}
			model := map[string]string{"openai": "gpt-5-mini", "google": "gemini-3.8-flash", "moonshot": "kimi-k2.6", "anthropic": "claude-sonnet-4-6", "deepseek": "deepseek-v4-flash"}[providerType]
			var arguments strings.Builder
			var fragments []string
			ends := 0
			result, err := gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: model, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Inspect"}}}}, Tools: []ToolDef{{Name: "inspect", InputSchema: json.RawMessage(`{"type":"object","properties":{"content":{"type":"string"}},"required":["content"]}`)}}}, func(event StreamEvent) {
				if event.Type == StreamEventToolCallDelta {
					arguments.WriteString(event.Text)
					fragments = append(fragments, event.Text)
					if event.ToolCall.Name != "inspect" {
						t.Errorf("wrong tool identity")
					}
				}
				if event.Type == StreamEventToolCallEnd {
					ends++
				}
			})
			if err != nil {
				t.Fatal(err)
			}
			if arguments.String() != first+last || len(fragments) != 2 || fragments[0] != first || fragments[1] != last || ends != 1 {
				t.Fatalf("fragments=%q ends=%d", fragments, ends)
			}
			if len(result.ToolCalls) != 1 || result.ToolCalls[0].Args["content"] != "中文\n😀" {
				t.Fatalf("final arguments changed: %+v", result.ToolCalls)
			}
		})
	}
}

func TestOpenAIArgumentSnapshotRejectsChangedStreamPrefix(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []map[string]any{
			{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"type": "function_call", "id": "item", "call_id": "call", "name": "inspect", "arguments": ""}},
			{"type": "response.function_call_arguments.delta", "item_id": "item", "delta": `{"content":"old`},
			{"type": "response.function_call_arguments.done", "item_id": "item", "arguments": `{"content":"new"}`},
		} {
			raw, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", raw)
		}
	}))
	defer server.Close()
	gateway, err := newProviderAdapter("openai", server.URL, "fixture", nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = gateway.StreamTurn(t.Context(), ModelGatewayRequest{Model: "gpt-5-mini", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Inspect"}}}}}, nil)
	if err == nil || !strings.Contains(err.Error(), "changed streamed prefix") {
		t.Fatalf("changed snapshot error=%v", err)
	}
}
