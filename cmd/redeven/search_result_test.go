package main

import (
	"encoding/json"
	"github.com/floegence/floret/v7/tools/websearch"
	"testing"
)

func TestSearchCLIOutputContract(t *testing.T) {
	result := cliSearchResult(websearch.Result{Provider: "brave", Query: "q", Results: []websearch.Item{{Title: "Title", URL: "https://example.com", Snippet: "Snippet", Summary: "Model only"}}})
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"provider":"brave","query":"q","results":[{"title":"Title","url":"https://example.com","snippet":"Snippet"}],"sources":[{"title":"Title","url":"https://example.com","snippet":"Snippet"}]}`
	if string(data) != want {
		t.Fatalf("CLI contract=%s", data)
	}
	empty, _ := json.Marshal(cliSearchResult(websearch.Result{Provider: "brave", Query: "q"}))
	if string(empty) != `{"provider":"brave","query":"q","results":[]}` {
		t.Fatalf("empty=%s", empty)
	}
}
