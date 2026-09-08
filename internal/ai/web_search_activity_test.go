package ai

import (
	"testing"

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
	}
}
