package okf

import (
	"path/filepath"
	"testing"
)

func testBundle(t *testing.T) Bundle {
	t.Helper()
	bundle, _, err := LoadSourceBundle(filepath.Join("..", "..", "okf"))
	if err != nil {
		t.Fatalf("LoadSourceBundle: %v", err)
	}
	return bundle
}

func TestIndexBundleReturnsDeterministicSections(t *testing.T) {
	t.Parallel()

	result := IndexBundle(testBundle(t), IndexRequest{})
	if result.OKFVersion != OKFVersion {
		t.Fatalf("okf version=%q", result.OKFVersion)
	}
	if result.TotalSections == 0 || len(result.Sections) == 0 {
		t.Fatalf("sections=%#v", result.Sections)
	}
	var ai *IndexSection
	for i := range result.Sections {
		if result.Sections[i].Slug == "ai" {
			ai = &result.Sections[i]
			break
		}
	}
	if ai == nil {
		t.Fatalf("AI section missing: %#v", result.Sections)
	}
	found := false
	for _, entry := range ai.Entries {
		if entry.Path == "ai/okf-search-tool.md" && entry.ConceptID == "ai.okf-search-tool" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("AI section did not resolve okf search concept: %#v", ai.Entries)
	}

	filtered := IndexBundle(testBundle(t), IndexRequest{Section: "AI"})
	if len(filtered.Sections) != 1 || filtered.Sections[0].Slug != "ai" {
		t.Fatalf("filtered sections=%#v", filtered.Sections)
	}
}

func TestSearchBundleFiltersTypeTagsAndCapsResults(t *testing.T) {
	t.Parallel()

	bundle := testBundle(t)
	result := SearchBundle(bundle, SearchRequest{
		Query:      "gateway",
		MaxResults: 20,
		Type:       "Gateway Contract",
		Tags:       []string{"gateway"},
	})
	if len(result.Matches) == 0 {
		t.Fatalf("expected gateway matches")
	}
	if len(result.Matches) > maxSearchResults {
		t.Fatalf("matches len=%d, want <= %d", len(result.Matches), maxSearchResults)
	}
	for _, match := range result.Matches {
		if match.Type != "Gateway Contract" {
			t.Fatalf("match type=%q, want Gateway Contract", match.Type)
		}
		if !hasAnyTag(match.Tags, map[string]struct{}{"gateway": {}}) {
			t.Fatalf("match tags=%#v, want gateway", match.Tags)
		}
	}
	if result.Filters.Type != "Gateway Contract" || len(result.Filters.Tags) != 1 || result.Filters.Tags[0] != "gateway" {
		t.Fatalf("filters=%#v", result.Filters)
	}
}

func TestOpenBundleReturnsBodyWindowAndGraph(t *testing.T) {
	t.Parallel()

	bundle := testBundle(t)
	result, err := OpenBundle(bundle, OpenRequest{
		Path:      "ai/okf-search-tool.md",
		BodyLimit: 1000,
	})
	if err != nil {
		t.Fatalf("OpenBundle: %v", err)
	}
	if result.Concept.ConceptID != "ai.okf-search-tool" || result.Concept.Path != "ai/okf-search-tool.md" {
		t.Fatalf("concept=%#v", result.Concept)
	}
	if result.Body == "" || result.BodyLength <= 0 || result.ReturnedBodyLength <= 0 {
		t.Fatalf("body metadata=%#v", result)
	}
	if len(result.Backlinks) == 0 {
		t.Fatalf("expected backlinks from index or concepts")
	}

	_, err = OpenBundle(bundle, OpenRequest{})
	if err == nil {
		t.Fatal("expected missing identifier error")
	}
	_, err = OpenBundle(bundle, OpenRequest{ConceptID: "ai.okf-search-tool", Path: "ai/okf-search-tool.md"})
	if err == nil {
		t.Fatal("expected ambiguous identifier error")
	}
}
