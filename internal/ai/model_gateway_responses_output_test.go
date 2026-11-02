package ai

import (
	"encoding/json"
	"fmt"
	flprovider "github.com/floegence/floret/v7/provider"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResponsesCompletedCiphertextSurvivesAdapterRestart(t *testing.T) {
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
				if requests == 2 && (!strings.Contains(string(body["input"]), "first-cipher") || strings.Contains(string(body["input"]), "final-cipher")) {
					t.Error("restart did not replay completed opaque state")
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
			if !strings.Contains(string(raw), "first-cipher") || strings.Contains(string(raw), "final-cipher") {
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

func TestResponsesSearchAuthorityCitationsAndContinuation(t *testing.T) {
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
				if requests == 2 {
					var input []map[string]any
					_ = json.Unmarshal(body["input"], &input)
					found := false
					for _, item := range input {
						if item["type"] == "web_search_call" {
							found = true
							sources := item["action"].(map[string]any)["sources"].([]any)
							if len(sources) != 1 {
								t.Error("continuation replaced completed source list")
							}
						}
					}
					if !found {
						t.Error("continuation lost native search")
					}
				}
				w.Header().Set("Content-Type", "text/event-stream")
				send := func(v any) { raw, _ := json.Marshal(v); fmt.Fprintf(w, "data: %s\n\n", raw) }
				search := map[string]any{"type": "web_search_call", "id": "search", "status": "completed", "action": map[string]any{"type": "search", "queries": []string{"fixture"}, "sources": []any{map[string]any{"type": "url", "url": "https://example.com/done"}}}}
				message := map[string]any{"type": "message", "id": "answer", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "Report", "annotations": []any{map[string]any{"type": "url_citation", "title": "Extra source", "url": "https://example.com/terminal-only", "start_index": 0, "end_index": 6}}}}}
				send(map[string]any{"type": "response.output_item.done", "output_index": 0, "item": search})
				send(map[string]any{"type": "response.output_text.delta", "delta": "Report"})
				send(map[string]any{"type": "response.output_item.done", "output_index": 1, "item": message})
				search["action"].(map[string]any)["sources"] = []any{map[string]any{"type": "url", "url": "https://example.com/done"}, map[string]any{"type": "url", "url": "https://example.com/terminal-only"}}
				send(map[string]any{"type": "response.completed", "response": map[string]any{"id": "resp_fixture", "status": "completed", "output": []any{search, message}}})
			}))
			defer server.Close()
			makeAdapter := func() *openAIProvider {
				kind := typ
				if kind == "chatgpt" {
					kind = "openai"
				}
				a, err := newProviderAdapter(kind, server.URL, "fixture", nil)
				if err != nil {
					t.Fatal(err)
				}
				p := a.(*openAIProvider)
				p.chatGPT = typ == "chatgpt"
				return p
			}
			req := ModelGatewayRequest{Model: "fixture", Protocol: "openai-responses", WebSearchMode: providerWebSearchModeOpenAIResponsesBuiltin, Messages: []Message{{Role: "user", Content: []ContentPart{{Type: "text", Text: "Find sources"}}}}}
			var shown strings.Builder
			results := 0
			got, err := makeAdapter().StreamTurn(t.Context(), req, func(e StreamEvent) {
				if e.Type == StreamEventTextDelta {
					shown.WriteString(e.Text)
				}
				if e.HostedToolEvent != nil && e.HostedToolEvent.Type == flprovider.EventHostedToolResult {
					results++
					if len(e.HostedToolEvent.HostedResult.Results) != 1 {
						t.Error("Activity changed completed sources")
					}
				}
			})
			if err != nil {
				t.Fatal(err)
			}
			if results != 1 || shown.String() != "Report" || got.Text != "Report" || got.ProviderState == nil || len(got.Sources) != 1 || got.Sources[0].URL != "https://example.com/terminal-only" || got.Sources[0].StartIndex == nil || *got.Sources[0].EndIndex != 6 {
				t.Fatalf("incomplete visible result: results=%d sources=%+v", results, got.Sources)
			}
			details, ok := got.RawProviderDiag["output_reconciliation"].([]responsesOutputDiagnostic)
			if !ok || len(details) != 1 || details[0].Selected != "response.output_item.done" {
				t.Fatal("selection diagnostics missing")
			}
			raw, _ := json.Marshal(got.ProviderState)
			var restored ModelGatewayState
			if err = json.Unmarshal(raw, &restored); err != nil {
				t.Fatal(err)
			}
			req.PreviousState = &restored
			req.Messages = append(req.Messages, Message{Role: "assistant", Content: []ContentPart{{Type: "text", Text: got.Text}}}, Message{Role: "user", Content: []ContentPart{{Type: "text", Text: "continue"}}})
			if _, err = makeAdapter().StreamTurn(t.Context(), req, nil); err != nil {
				t.Fatal(err)
			}
			if requests != 2 {
				t.Fatal("unexpected retry")
			}
		})
	}
}

func TestResponsesOutputNestedDiagnosticsAreSafe(t *testing.T) {
	count := 2
	cause := &providerValidationError{code: responseOutputConflict, outputDetail: &responsesOutputDiagnostic{OutputIndex: 7, ItemType: "web_search_call", PreviousEvent: "response.output_item.done", CurrentEvent: "terminal_snapshot", Paths: []string{"action.url", "action.sources", "private-sk-secret"}, Difference: "value_changed", SourcesBefore: &count, SourcesAfter: &count}}
	d := cause.diagnostic("openai").sanitized()
	raw, _ := json.Marshal(d)
	if strings.Contains(string(raw), "private") || d.OutputDetail == nil || len(d.OutputDetail.Paths) != 2 || !strings.Contains(d.Message, "final verification failed") {
		t.Fatalf("unsafe or vague diagnostic: %s", raw)
	}
	d.Code = "other"
	if d.sanitized().OutputDetail != nil {
		t.Fatal("detail leaked into unrelated failure")
	}
}
