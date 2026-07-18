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
		if match.Summary == "" || match.SectionID == "" || match.SectionTitle == "" || match.Snippet == "" {
			t.Fatalf("match missing progressive-disclosure metadata: %#v", match)
		}
	}
	if result.Filters.Type != "Gateway Contract" || len(result.Filters.Tags) != 1 || result.Filters.Tags[0] != "gateway" {
		t.Fatalf("filters=%#v", result.Filters)
	}
}

func TestSearchBundleShortListIsNotTruncation(t *testing.T) {
	t.Parallel()

	bundle := testBundle(t)
	result := SearchBundle(bundle, SearchRequest{Query: "Redeven"})
	if result.MaxResults != defaultSearchResults {
		t.Fatalf("max_results=%d, want %d", result.MaxResults, defaultSearchResults)
	}
	if result.MatchCount != len(result.Matches) {
		t.Fatalf("match_count=%d, len(matches)=%d", result.MatchCount, len(result.Matches))
	}
	if result.TotalMatches < result.MatchCount {
		t.Fatalf("total_matches=%d, match_count=%d", result.TotalMatches, result.MatchCount)
	}
	if result.OmittedCount != result.TotalMatches-result.MatchCount {
		t.Fatalf("omitted_count=%d, want total_matches-match_count=%d", result.OmittedCount, result.TotalMatches-result.MatchCount)
	}
	if result.HasMore != (result.OmittedCount > 0) {
		t.Fatalf("has_more=%v, omitted_count=%d", result.HasMore, result.OmittedCount)
	}
	if result.HasMore && result.Truncated {
		t.Fatalf("bounded search result should not report truncation: %#v", result)
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
	if result.SectionID != "summary" || result.SectionTitle != "Summary" || result.Summary == "" {
		t.Fatalf("default open should return summary: %#v", result)
	}
	if len(result.Sections) == 0 || !result.EvidenceOmitted {
		t.Fatalf("default open should return section catalog and omit evidence: %#v", result)
	}
	if len(result.Backlinks) == 0 {
		t.Fatalf("expected backlinks from index or concepts")
	}

	contract, err := OpenBundle(bundle, OpenRequest{
		Path:    "ai/okf-search-tool.md",
		Section: "contract",
	})
	if err != nil {
		t.Fatalf("OpenBundle contract: %v", err)
	}
	if contract.SectionID != "contract" || contract.Body == "" || contract.Body == result.Body {
		t.Fatalf("contract section=%#v", contract)
	}

	evidence, err := OpenBundle(bundle, OpenRequest{
		Path:            "ai/okf-search-tool.md",
		Section:         "evidence",
		IncludeEvidence: true,
	})
	if err != nil {
		t.Fatalf("OpenBundle evidence: %v", err)
	}
	if evidence.SectionID != "evidence" || len(evidence.Evidence) == 0 || evidence.EvidenceOmitted {
		t.Fatalf("evidence section=%#v", evidence)
	}

	_, err = OpenBundle(bundle, OpenRequest{Path: "ai/okf-search-tool.md", Section: "missing"})
	if err == nil {
		t.Fatal("expected missing section error")
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
