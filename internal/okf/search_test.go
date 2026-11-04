package okf

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNarrativeEvidenceSurvivesBundleAndExplicitOpen(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.md"), []byte("---\nokf_version: \"0.2\"\n---\n## Tests\n\n- [Result](result.md)\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	narrative := "Historical failure: CAPTURE_LAYOUT_UNSUPPORTED. " + strings.Repeat("Qualified only on the recorded fixture. ", 40)
	source := "---\ntype: Acceptance Record\ntitle: Retained qualification\n---\n# Summary\n\nCurrent scope.\n\n# Contract\n\nPreserve adverse outcomes.\n\n# Boundaries\n\nNo broader qualification.\n\n# Evidence\n\n" + narrative + "\n\n- `fixture.log` - Original failed run.\n"
	if err := os.WriteFile(filepath.Join(root, "result.md"), []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	built, err := BuildFromSource(root)
	if err != nil {
		t.Fatal(err)
	}
	var bundle Bundle
	if err := json.Unmarshal(built.BundleJSON, &bundle); err != nil {
		t.Fatal(err)
	}
	result, err := OpenBundle(bundle, OpenRequest{Path: "result.md"})
	if err != nil || !result.EvidenceOmitted || strings.Contains(result.Body, "CAPTURE_LAYOUT") || len(result.Evidence) != 0 {
		t.Fatalf("default open must omit evidence: %#v, %v", result, err)
	}
	search := SearchBundle(bundle, SearchRequest{Query: "CAPTURE_LAYOUT_UNSUPPORTED"})
	if len(search.Matches) != 1 || search.Matches[0].SectionID != "evidence" {
		t.Fatalf("narrative evidence is not searchable: %#v", search)
	}
	opened, err := OpenBundle(bundle, OpenRequest{Path: "result.md", Section: "Evidence", BodyLimit: 1000})
	if err != nil || opened.EvidenceOmitted || len(opened.Evidence) != 1 || !opened.Truncated || !strings.HasPrefix(opened.Body, "Historical failure:") {
		t.Fatalf("explicit evidence open: %#v, %v", opened, err)
	}
	tail, err := OpenBundle(bundle, OpenRequest{Path: "result.md", Section: "evidence", BodyOffset: opened.ReturnedBodyLength, BodyLimit: 1000})
	if err != nil || opened.Body+tail.Body != narrative+"\n\n- `fixture.log` - Original failed run." {
		t.Fatalf("evidence pagination lost content: %#v, %v", tail, err)
	}
	count := 0
	for _, section := range opened.Sections {
		if section.ID == "evidence" {
			count++
			if section.CharCount != opened.BodyLength {
				t.Fatalf("evidence length=%d, want %d", section.CharCount, opened.BodyLength)
			}
		}
	}
	if count != 1 {
		t.Fatalf("evidence appears %d times in section catalog", count)
	}
	withReferences, err := OpenBundle(bundle, OpenRequest{Path: "result.md", IncludeEvidence: true})
	if err != nil || len(withReferences.Evidence) != 1 || strings.Contains(withReferences.Body, "CAPTURE_LAYOUT") {
		t.Fatalf("reference flag must retain the selected summary: %#v, %v", withReferences, err)
	}
	if err := os.WriteFile(filepath.Join(root, "result.md"), []byte(strings.ReplaceAll(source, "\n\n- `fixture.log` - Original failed run.", "")), 0o600); err != nil {
		t.Fatal(err)
	}
	narrativeOnly, err := BuildFromSource(root)
	if err != nil {
		t.Fatal(err)
	}
	bundle = Bundle{}
	if err := json.Unmarshal(narrativeOnly.BundleJSON, &bundle); err != nil {
		t.Fatal(err)
	}
	result, err = OpenBundle(bundle, OpenRequest{Path: "result.md"})
	if err != nil || !result.EvidenceOmitted {
		t.Fatalf("narrative-only evidence must be discoverable: %#v, %v", result, err)
	}
	opened, err = OpenBundle(bundle, OpenRequest{Path: "result.md", Section: "evidence", BodyLimit: 20000})
	if err != nil || opened.Body != strings.TrimSpace(narrative) || len(opened.Evidence) != 0 || opened.EvidenceOmitted {
		t.Fatalf("narrative-only evidence open: %#v, %v", opened, err)
	}
}

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

	bundle := testBundle(t)
	result := IndexBundle(bundle, IndexRequest{})
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
			for _, concept := range bundle.Concepts {
				if concept.Path == entry.Path && entry.Summary != concept.Summary {
					t.Fatalf("index summary=%q, want canonical concept summary %q", entry.Summary, concept.Summary)
				}
			}
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("AI section did not resolve okf search concept: %#v", ai.Entries)
	}

	filtered := IndexBundle(bundle, IndexRequest{Section: "AI"})
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
