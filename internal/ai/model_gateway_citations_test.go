package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	oresponses "github.com/openai/openai-go/v3/responses"
)

func TestFlowerTimelineCitationBlocksPreserveExactCanonicalText(t *testing.T) {
	text := " 你好😀 \uE200cite\uE202turn1view5\uE201 "
	start, end := 5, utf8.RuneCountInString(text)-1
	raw, visible, err := typedThreadItemMessage("thread", flruntime.ThreadItem{
		ID: "answer", Kind: flruntime.ThreadItemAssistant, TurnID: "turn", RunID: "run", Text: text,
		Sources: []flprovider.Source{{Title: "Reference", URL: "https://example.com/docs", StartIndex: &start, EndIndex: &end}},
	})
	if err != nil || !visible {
		t.Fatalf("visible=%v err=%v", visible, err)
	}
	var message struct {
		Content string                   `json:"content"`
		Blocks  []persistedMarkdownBlock `json:"blocks"`
	}
	if err := json.Unmarshal(raw, &message); err != nil {
		t.Fatal(err)
	}
	if message.Content != text || len(message.Blocks) != 1 || message.Blocks[0].Content != text || len(message.Blocks[0].Sources) != 1 || *message.Blocks[0].Sources[0].StartIndex != start {
		t.Fatalf("citation block drifted: %s", raw)
	}
}

func TestOpenAIURLCitationsKeepUnicodePartOffsetsAndOccurrences(t *testing.T) {
	var response oresponses.Response
	raw := `{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"你好😀 ","annotations":[]},{"type":"output_text","text":"cite  cite ","annotations":[{"type":"url_citation","title":"first","url":"https://example.com","start_index":0,"end_index":4},{"type":"url_citation","title":"again","url":"https://example.com","start_index":6,"end_index":10},{"type":"url_citation","url":"https://example.com/unlocated"}]}]}]}`
	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		t.Fatal(err)
	}
	if text := extractOpenAIResponseText(response); text != "你好😀 cite  cite " {
		t.Fatalf("text=%q", text)
	}
	refs := extractOpenAIURLSources(response)
	if len(refs) != 3 || *refs[0].StartIndex != 4 || *refs[0].EndIndex != 8 || *refs[1].StartIndex != 10 || *refs[1].EndIndex != 14 || refs[2].StartIndex != nil {
		t.Fatalf("refs=%+v", refs)
	}
	mapped := flowerSourcesToFloret(refs)
	encoded, err := json.Marshal(ModelGatewayResult{Text: "你好😀 cite  cite ", Sources: refs})
	if err != nil {
		t.Fatal(err)
	}
	var roundTrip ModelGatewayResult
	if err = json.Unmarshal(encoded, &roundTrip); err != nil {
		t.Fatal(err)
	}
	if *mapped[0].StartIndex != 4 || *roundTrip.Sources[1].EndIndex != 14 {
		t.Fatal("transport lost positions")
	}
}

func TestOpenAICitationsAddressExactlyEmittedText(t *testing.T) {
	const marker = "\uE200cite\uE202turn1view5\uE201"
	const final = " 你好😀 " + marker + " "
	for _, tc := range []struct {
		name, delta, want string
		located           bool
	}{
		{"complete", final, final, true},
		{"missing-suffix", " 你好😀 ", final, true},
		{"only-whitespace-streamed", " ", final, true},
		{"no-deltas", "", final, true},
		{"different-final-text", "Other " + marker, "Other " + marker, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				f := w.(http.Flusher)
				if tc.delta != "" {
					writeOpenAISSEJSON(w, f, map[string]any{"type": "response.output_text.delta", "delta": tc.delta})
				}
				writeOpenAISSEJSON(w, f, map[string]any{"type": "response.completed", "response": map[string]any{
					"id": "citation-response", "status": "completed", "output": []any{map[string]any{
						"type": "message", "role": "assistant", "content": []any{map[string]any{
							"type": "output_text", "text": final, "annotations": []any{map[string]any{
								"type": "url_citation", "title": "Reference", "url": "https://example.com",
								"start_index": 5, "end_index": 5 + utf8.RuneCountInString(marker),
							}},
						}},
					}},
				}})
			}))
			defer server.Close()
			gateway, err := newProviderAdapter("openai", server.URL, "test", nil)
			if err != nil {
				t.Fatal(err)
			}
			adapter := newFloretProviderAdapter(gateway, "openai", "gpt-5-mini", ProviderControls{}, TurnBudgets{}, providerWebSearchModeDisabled)
			stream, err := adapter.Stream(t.Context(), flprovider.Request{RunID: "run", PromptScopeID: "scope", Messages: []flprovider.Message{{Role: flprovider.RoleUser, Text: "Find sources"}}})
			if err != nil {
				t.Fatal(err)
			}
			var text strings.Builder
			var sources []flprovider.Source
			for event := range stream {
				if event.Err != nil {
					t.Fatal(event.Err)
				}
				if event.Type == flprovider.EventDelta {
					text.WriteString(event.Text)
				}
				if event.Type == flprovider.EventSources {
					sources = event.Sources
				}
			}
			if text.String() != tc.want || len(sources) != 1 {
				t.Fatalf("text=%q sources=%+v", text.String(), sources)
			}
			if tc.located {
				if sources[0].StartIndex == nil || *sources[0].StartIndex != 5 || *sources[0].EndIndex != 5+utf8.RuneCountInString(marker) {
					t.Fatalf("citation lost its exact position: %+v", sources[0])
				}
			} else if sources[0].StartIndex != nil || sources[0].EndIndex != nil {
				t.Fatalf("citation bound to a different transcript: %+v", sources[0])
			}
		})
	}
}
