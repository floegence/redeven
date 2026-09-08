package ai

import (
	"encoding/json"
	"testing"

	"github.com/floegence/floret/v7/observation"
	fltools "github.com/floegence/floret/v7/tools"
	"github.com/floegence/redeven/internal/websearch"
)

func TestWebSearchActivityPreservesCanonicalSources(t *testing.T) {
	for _, populated := range []bool{false, true} {
		data := websearch.SearchResult{Query: "weather", Provider: "brave", Results: []websearch.ResultItem{}}
		if populated {
			data.Results = append(data.Results, websearch.ResultItem{Title: "Weather", URL: "https://example.com", Snippet: "Sunny"})
		}
		activity, err := floretActivityForToolResult(nil, ToolResult{ToolID: "search", ToolName: "web.search", Status: toolResultStatusSuccess, Data: data})
		if err != nil {
			t.Fatal(err)
		}
		if activity == nil {
			t.Fatal("missing activity")
		}
		p := activity.Payload.(fltools.WebSearchActivityPayload)
		if p.Query != "weather" || p.Operation != "search" || !p.ResultsProvided {
			t.Fatalf("missing search facts: %+v", p)
		}
		if populated && (len(p.Results) != 1 || p.Results[0].Snippet != "Sunny") {
			t.Fatalf("source lost: %+v", p)
		}
		if !populated && len(p.Results) != 0 {
			t.Fatalf("invented sources: %+v", p)
		}
		assertWebSearchPublicProjection(t, activity)
	}
}

func TestWebSearchActivityPublicProjectionPreservesCanonicalFacts(t *testing.T) {
	// The open-page fixture reproduces a completed native call whose canonical
	// URL was discarded by the product payload allowlist before reaching Flower.
	for name, payload := range map[string]string{
		"open page":           `{"operation":"open_page","url":"https://example.com/news#ws_call_id=call_open","status":"success"}`,
		"find in page":        `{"operation":"find_in_page","url":"https://example.com/news","pattern":"agent","status":"success"}`,
		"search sources":      `{"operation":"search","query":"agent news\nagent research","results_provided":true,"results":[{"title":"Research","url":"https://example.com/research","snippet":"Recent agent research."}],"status":"success"}`,
		"empty sources":       `{"operation":"search","query":"agent news","results_provided":true,"status":"success"}`,
		"unavailable sources": `{"operation":"search","query":"agent news","status":"success"}`,
		"unknown details":     `{"status":"success"}`,
		"status only start":   `{"status":"running"}`,
		"failed page":         `{"operation":"open_page","url":"https://example.com/news","status":"error","error":{"message":"Page unavailable"}}`,
		"canceled page":       `{"operation":"open_page","url":"https://example.com/news","status":"canceled"}`,
	} {
		t.Run(name, func(t *testing.T) {
			var presentation fltools.ActivityPresentation
			if err := json.Unmarshal([]byte(`{"label":"Web search","renderer":"web_search","payload":`+payload+`}`), &presentation); err != nil {
				t.Fatal(err)
			}
			assertWebSearchPublicProjection(t, &presentation)
		})
	}
}

func assertWebSearchPublicProjection(t *testing.T, presentation *fltools.ActivityPresentation) {
	t.Helper()
	wantPayload, err := json.Marshal(presentation.Payload)
	if err != nil {
		t.Fatal(err)
	}
	payload := presentation.Payload.(fltools.WebSearchActivityPayload)
	item := observation.ActivityItem{
		ItemID: "hosted:call_web", ToolID: "call_web", ToolName: "web_search",
		Kind: observation.ActivityKindHosted, Status: observation.ActivityStatus(payload.Status),
		Presentation: presentation,
	}
	// Both live items and reopened timeline blocks pass through the product
	// sanitizer. Include the wire round trip consumed by the Flower mapper.
	for name, projected := range map[string]observation.ActivityItem{
		"live item": publicActivityItem(item),
		"timeline":  newActivityTimelineBlock(observation.ActivityTimeline{Items: []observation.ActivityItem{item}}, nil).Items[0],
	} {
		raw, err := json.Marshal(projected)
		if err != nil {
			t.Fatal(err)
		}
		var restored observation.ActivityItem
		if err := json.Unmarshal(raw, &restored); err != nil {
			t.Fatal(err)
		}
		if restored.Presentation == nil {
			t.Fatalf("%s lost the web presentation: %s", name, raw)
		}
		gotPayload, err := json.Marshal(restored.Presentation.Payload)
		if err != nil {
			t.Fatal(err)
		}
		if string(gotPayload) != string(wantPayload) {
			t.Fatalf("%s lost canonical web facts: got %s, want %+v", name, raw, presentation.Payload)
		}
		if restored.ToolID != item.ToolID || restored.ItemID != item.ItemID || restored.Status != item.Status {
			t.Fatalf("%s changed call identity or status: %+v", name, restored)
		}
	}
}
