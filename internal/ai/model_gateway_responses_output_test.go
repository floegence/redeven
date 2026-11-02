package ai

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResponsesTerminalCiphertextSurvivesAdapterRestart(t *testing.T) {
	for _, typ := range []string{"openai", "openai_compatible", "qwen", "chatgpt"} {
		t.Run(typ, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				requests++
				if requests == 2 && (!strings.Contains(string(body["input"]), "final-cipher") || strings.Contains(string(body["input"]), "first-cipher")) {
					t.Error("restart did not replay final opaque state")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				reasoning := map[string]any{"id": "reasoning", "type": "reasoning", "summary": []any{}, "encrypted_content": "first-cipher"}
				event, _ := json.Marshal(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": reasoning})
				fmt.Fprintf(w, "data: %s\n\n", event)
				reasoning["encrypted_content"] = "final-cipher"
				message := map[string]any{"type": "message", "id": "message", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "Completed successfully."}}}
				event, _ = json.Marshal(map[string]any{"type": "response.output_text.delta", "delta": "Completed successfully."})
				fmt.Fprintf(w, "data: %s\n\n", event)
				event, _ = json.Marshal(map[string]any{"type": "response.output_item.done", "output_index": 1, "item": message})
				fmt.Fprintf(w, "data: %s\n\n", event)
				event, _ = json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"id": "resp_final", "status": "completed", "output": []any{reasoning, message}}})
				fmt.Fprintf(w, "data: %s\n\n", event)
			}))
			defer server.Close()
			adapterType := typ
			if typ == "chatgpt" {
				adapterType = "openai"
			}
			makeAdapter := func() *openAIProvider {
				adapter, err := newProviderAdapter(adapterType, server.URL, "fixture", nil)
				if err != nil {
					t.Fatal(err)
				}
				p := adapter.(*openAIProvider)
				p.chatGPT = typ == "chatgpt"
				return p
			}
			req := ModelGatewayRequest{Model: "fixture-model", Protocol: "openai-responses", Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "test"}}}}}
			var shown strings.Builder
			result, err := makeAdapter().StreamTurn(t.Context(), req, func(event StreamEvent) {
				if event.Type == StreamEventTextDelta {
					shown.WriteString(event.Text)
				}
			})
			if err != nil || result.Text != "Completed successfully." || shown.String() != result.Text {
				t.Fatalf("completed answer rejected or altered: text=%q shown=%q err=%v", result.Text, shown.String(), err)
			}
			raw, err := json.Marshal(result.ProviderState)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(raw), "final-cipher") || strings.Contains(string(raw), "first-cipher") {
				t.Fatal("wrong ciphertext persisted")
			}
			var state ModelGatewayState
			if err = json.Unmarshal(raw, &state); err != nil {
				t.Fatal(err)
			}
			req.PreviousState = &state
			req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: result.Text}}}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "continue"}}})
			if _, err = makeAdapter().StreamTurn(t.Context(), req, nil); err != nil {
				t.Fatal(err)
			}
			if requests != 2 {
				t.Fatalf("unexpected retry: %d requests", requests)
			}
		})
	}
}

func TestOutputConflictFieldsAreBoundedAndSafe(t *testing.T) {
	cause := &providerValidationError{code: responseOutputConflict, outputFields: []string{"arguments", "content", "arguments", "private-sk-secret"}}
	diagnostic := cause.diagnostic("openai").sanitized()
	raw, _ := json.Marshal(diagnostic)
	if strings.Contains(string(raw), "private") || strings.Join(diagnostic.OutputFields, ",") != "arguments,content" {
		t.Fatalf("unsafe fields: %s", raw)
	}
	diagnostic.Code = "response_output_invalid"
	if len(diagnostic.sanitized().OutputFields) != 0 {
		t.Fatal("conflict fields attached to unrelated failure")
	}
}
