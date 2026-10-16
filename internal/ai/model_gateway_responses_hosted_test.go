package ai

import (
	"encoding/json"
	"testing"

	flprovider "github.com/floegence/floret/v7/provider"
	fltools "github.com/floegence/floret/v7/tools"
	oresponses "github.com/openai/openai-go/v3/responses"
)

func TestResponsesHostedEventsPreserveSearchDetails(t *testing.T) {
	for _, tc := range []struct {
		name, status, action, wantArgs string
		provided                       bool
		resultCount                    int
	}{
		{"queries and URL-only source", "completed", ` {"type":"search","queries":["agent news","agent releases"],"sources":[{"type":"url","url":"https://example.com/news"}],"private":"discard"}`, `{"type":"search","queries":["agent news","agent releases"]}`, true, 1},
		{"explicit empty sources", "completed", `{"type":"search","query":"agent","sources":[]}`, `{"type":"search","query":"agent"}`, true, 0},
		{"missing sources", "completed", `{"type":"search","query":"agent"}`, `{"type":"search","query":"agent"}`, false, 0},
		{"open page", "completed", `{"type":"open_page","url":"https://example.com"}`, `{"type":"open_page","url":"https://example.com"}`, false, 0},
		{"find in page", "completed", `{"type":"find_in_page","url":"https://example.com","pattern":"agent"}`, `{"type":"find_in_page","url":"https://example.com","pattern":"agent"}`, false, 0},
		{"failed search", "failed", `{"type":"search","query":"agent"}`, `{"type":"search","query":"agent"}`, false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var item oresponses.ResponseOutputItemUnion
			if err := json.Unmarshal([]byte(`{"type":"web_search_call","id":"search1","status":"`+tc.status+`","action":`+tc.action+`}`), &item); err != nil {
				t.Fatal(err)
			}
			var events []flprovider.Event
			hosted := newResponsesHostedEvents(func(event StreamEvent) {
				if event.HostedToolEvent != nil {
					events = append(events, *event.HostedToolEvent)
				}
			})
			hosted.item(item)
			hosted.item(item)
			if len(events) != 2 || events[0].Type != flprovider.EventHostedToolCall || events[1].Type != flprovider.EventHostedToolResult {
				t.Fatalf("unexpected hosted events: %+v", events)
			}
			var got, want any
			if err := json.Unmarshal([]byte(events[1].HostedToolCall.Args), &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(tc.wantArgs), &want); err != nil {
				t.Fatal(err)
			}
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(want)
			if string(gotJSON) != string(wantJSON) {
				t.Fatalf("action lost or private data leaked: got %s, want %s", gotJSON, wantJSON)
			}
			result := events[1].HostedResult
			if result.ResultsProvided != tc.provided || len(result.Results) != tc.resultCount {
				t.Fatalf("source presence lost: %+v", result)
			}
			if tc.resultCount > 0 && (result.Results[0].URL != "https://example.com/news" || result.Results[0].Title != "") {
				t.Fatalf("URL-only source changed: %+v", result.Results)
			}
			presentation := &fltools.ActivityPresentation{Renderer: fltools.ActivityRendererWebSearch, Payload: fltools.WebSearchActivityPayload{ResultsProvided: result.ResultsProvided}}
			payload := presentation.Payload.(fltools.WebSearchActivityPayload)
			for _, source := range result.Results {
				payload.Results = append(payload.Results, fltools.WebSearchActivityResult{Title: source.Title, URL: source.URL, Snippet: source.Snippet})
			}
			presentation.Payload = payload
			if err := presentation.Validate(); err != nil {
				t.Fatalf("provider sources rejected by published Floret: %v", err)
			}

			if (result.Error != nil) != (tc.status == "failed") {
				t.Fatalf("failure status changed: %+v", result)
			}
		})
	}
}
