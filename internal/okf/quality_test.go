package okf

import "testing"

func TestValidateBundleQualityModes(t *testing.T) {
	t.Parallel()
	bundle := Bundle{
		RootIndex: RootIndex{Sections: []IndexSection{{Entries: []IndexEntry{{ConceptSummary: ConceptSummary{Path: "ai/example.md"}}}}}},
		Concepts: []Concept{{
			Path:        "ai/example.md",
			Summary:     "short",
			Legacy:      true,
			HasSummary:  false,
			HasContract: false,
			HasBounds:   false,
			HasEvidence: false,
		}},
	}
	report := ValidateBundleQuality(bundle, t.TempDir(), QualityReportMode)
	if report.Errors != 0 || report.Warnings == 0 {
		t.Fatalf("report mode=%#v", report)
	}
	strict := ValidateBundleQuality(bundle, t.TempDir(), QualityStrict)
	if strict.Errors == 0 {
		t.Fatalf("strict mode=%#v", strict)
	}
}

func TestParseConceptBodyExtractsSectionsAndEvidence(t *testing.T) {
	t.Parallel()
	parsed := parseConceptBody("# Summary\n\n" +
		"Authority and observable behavior are explicit. This summary is intentionally long enough to act as maintained retrieval content without requiring the detailed contract to be opened first.\n\n" +
		"# Contract\n\n## Flow\n\nThe current behavior is section aware.\n\n" +
		"# Boundaries\n\nEvidence is not returned by default.\n\n" +
		"# Evidence\n\n- `redeven:internal/okf/search.go:1` - Search implementation.\n")
	if parsed.Legacy || !parsed.HasSummary || !parsed.HasContract || !parsed.HasBounds || !parsed.HasEvidence {
		t.Fatalf("parsed layout=%#v", parsed)
	}
	if len(parsed.Sections) != 2 || parsed.Sections[0].ID != "contract" {
		t.Fatalf("sections=%#v", parsed.Sections)
	}
	if len(parsed.Evidence) != 1 || parsed.Evidence[0].Source != "redeven:internal/okf/search.go" || parsed.Evidence[0].Line != 1 {
		t.Fatalf("evidence=%#v", parsed.Evidence)
	}
}
