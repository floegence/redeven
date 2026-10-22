package okf

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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

func TestValidateBundleQualityRejectsOversizedConceptDespiteException(t *testing.T) {
	t.Parallel()
	bundle := Bundle{
		Concepts: []Concept{{
			Path: "architecture/oversized.md",
			Frontmatter: map[string]any{
				"quality_exception": "Cross-domain contract retained temporarily.",
			},
			Sections: []ConceptSection{{CharCount: 20001}},
		}},
	}

	report := ValidateBundleQuality(bundle, t.TempDir(), QualityReportMode)
	if !hasQualityIssue(report, "OKF011", "architecture/oversized.md") {
		t.Fatalf("report mode did not flag absolute size boundary: %#v", report)
	}
	strict := ValidateBundleQuality(bundle, t.TempDir(), QualityStrict)
	issue, ok := findQualityIssue(strict, "OKF011", "architecture/oversized.md")
	if !ok || issue.Level != "error" {
		t.Fatalf("strict mode did not reject absolute size boundary: %#v", strict)
	}
}

func hasQualityIssue(report QualityReport, code, path string) bool {
	_, ok := findQualityIssue(report, code, path)
	return ok
}

func findQualityIssue(report QualityReport, code, path string) (QualityIssue, bool) {
	for _, issue := range report.Issues {
		if issue.Code == code && issue.Path == path {
			return issue, true
		}
	}
	return QualityIssue{}, false
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

func TestValidateBundleQualityRejectsEvidenceLineOutsideSource(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	sourcePath := filepath.Join(root, "source.go")
	if err := os.WriteFile(sourcePath, []byte("package source\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	bundle := Bundle{Concepts: []Concept{{
		Path:     "ai/example.md",
		Evidence: []EvidenceRef{{Source: "redeven:source.go", Line: 3, Description: "source evidence"}},
	}}}
	report := ValidateBundleQuality(bundle, root, QualityReportMode)
	issue, ok := findQualityIssue(report, "OKF018", "ai/example.md")
	if !ok || issue.Level != "error" {
		t.Fatalf("report=%#v", report)
	}
}

func TestCountSourceCharactersIncludesAuthoredMarkdownAndSkipsDist(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	files := map[string]string{
		"index.md":             "A\r\n你😀",
		"log.md":               "x\r\n",
		"ai/current.md":        "é",
		"ai/dist/generated.md": "nested generated content",
		"dist/generated.md":    "ignored generated content",
	}
	for name, content := range files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	usage, err := countSourceCharacters(root)
	if err != nil {
		t.Fatal(err)
	}
	if usage != (sourceCharacterUsage{Total: 31, Index: 4, Log: 2, Concepts: 25}) {
		t.Fatalf("usage=%#v", usage)
	}
}

func TestValidateBundleQualitySourceCharacterThresholds(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name          string
		characters    int
		wantHardError bool
	}{
		{name: "target", characters: OKFSourceCharacterTarget},
		{name: "target exceeded", characters: OKFSourceCharacterTarget + 1},
		{name: "hard limit", characters: OKFSourceCharacterLimit},
		{name: "hard limit exceeded", characters: OKFSourceCharacterLimit + 1, wantHardError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "index.md"), make([]byte, test.characters), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "log.md"), nil, 0o600); err != nil {
				t.Fatal(err)
			}
			bundle := Bundle{
				RootIndex: RootIndex{Sections: []IndexSection{{Entries: []IndexEntry{{ConceptSummary: ConceptSummary{Path: "ai/example.md"}}}}}},
				Concepts: []Concept{{
					Path:        "ai/example.md",
					Summary:     strings.Repeat("x", 250),
					Frontmatter: map[string]any{"lifecycle": LifecycleContract, "reviewed_at": "2026-10-21", "quality_exception": "Temporary per-concept exception."},
					HasSummary:  true,
					HasContract: true,
					HasBounds:   true,
					HasEvidence: true,
				}},
			}
			report := validateBundleQualityAt(bundle, root, QualityStrict, time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC))
			if report.SourceCharacters != test.characters || report.SourceCharactersRemain != OKFSourceCharacterLimit-test.characters {
				t.Fatalf("character metrics=%#v", report)
			}
			issue, found := findQualityIssue(report, "OKF020", "")
			if found != test.wantHardError {
				t.Fatalf("hard limit issue=(%#v, %t), want error=%t", issue, found, test.wantHardError)
			}
			if found && issue.Level != "error" {
				t.Fatalf("hard limit level=%q", issue.Level)
			}
			if test.characters == OKFSourceCharacterLimit && found {
				t.Fatal("exact hard limit must be accepted")
			}
			if test.characters == OKFSourceCharacterLimit && report.Errors != 0 {
				t.Fatalf("exact hard limit produced strict errors: %#v", report.Issues)
			}
			if test.wantHardError {
				reportMode := validateBundleQualityAt(bundle, root, QualityReportMode, time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC))
				issue, found := findQualityIssue(reportMode, "OKF020", "")
				if !found || issue.Level != "warning" {
					t.Fatalf("report mode hard-limit issue=%#v, found=%t", issue, found)
				}
			}
		})
	}
}

func TestValidateLogRecencyUsesDatedHeadingsAndThirtyDayBoundary(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	log := "# Updates\n\n## 2026-09-21\n- At the exact 30-day boundary.\n\n## 2026-09-20\n- Older than 30 days.\n\n## 2026-10-22\n- Future entry.\n\n## 2026-02-30\n- Invalid date.\n"
	if err := os.WriteFile(filepath.Join(root, "log.md"), []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	var report QualityReport
	validateLogRecency(&report, root, QualityStrict, now)
	if len(report.Issues) != 3 {
		t.Fatalf("issues=%#v, want expired, future, and invalid-date issues", report.Issues)
	}
	if !hasQualityIssue(report, "OKF028", "log.md") {
		t.Fatalf("30-day-old heading boundary was not checked: %#v", report.Issues)
	}
	for _, issue := range report.Issues {
		if issue.Level != "error" {
			t.Fatalf("strict issue level=%q, want error: %#v", issue.Level, issue)
		}
	}
}

func TestValidateLogRecencyReportModeWarnsAndAcceptsRecentDate(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	log := "## 2026-10-21\n- Current.\n\n## 2026-09-20\n- Stale.\n"
	if err := os.WriteFile(filepath.Join(root, "log.md"), []byte(log), 0o600); err != nil {
		t.Fatal(err)
	}
	var report QualityReport
	validateLogRecency(&report, root, QualityReportMode, time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC))
	issue, ok := findQualityIssue(report, "OKF028", "log.md")
	if !ok || issue.Level != "warning" || report.Errors != 0 {
		t.Fatalf("report=%#v", report)
	}
}

func TestValidateConceptLifecycleReviewDeadlines(t *testing.T) {
	t.Parallel()
	checkingDate := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name        string
		frontmatter map[string]any
		wantDue     bool
		wantInvalid bool
	}{
		{
			name:        "contract before deadline",
			frontmatter: map[string]any{"lifecycle": LifecycleContract, "reviewed_at": "2026-04-25"},
		},
		{
			name:        "contract at deadline",
			frontmatter: map[string]any{"lifecycle": LifecycleContract, "reviewed_at": "2026-04-24"},
			wantDue:     true,
		},
		{
			name:        "active evidence deadline",
			frontmatter: map[string]any{"lifecycle": LifecycleActiveEvidence, "reviewed_at": "2026-07-23"},
			wantDue:     true,
		},
		{
			name:        "active evidence before deadline",
			frontmatter: map[string]any{"lifecycle": LifecycleActiveEvidence, "reviewed_at": "2026-07-24"},
		},
		{
			name:        "retained history requires reason",
			frontmatter: map[string]any{"lifecycle": LifecycleRetainedHistory, "reviewed_at": "2026-10-21"},
			wantInvalid: true,
		},
		{
			name: "retained history accepts reason before deadline",
			frontmatter: map[string]any{
				"lifecycle":        LifecycleRetainedHistory,
				"reviewed_at":      "2025-10-22",
				"retention_reason": "Preserves a compatibility decision and its counterexample.",
			},
		},
		{
			name: "retained history expires at 365 days",
			frontmatter: map[string]any{
				"lifecycle":        LifecycleRetainedHistory,
				"reviewed_at":      "2025-10-21",
				"retention_reason": "Preserves a compatibility decision and its counterexample.",
			},
			wantDue: true,
		},
		{
			name:        "invalid lifecycle value",
			frontmatter: map[string]any{"lifecycle": "measurement", "reviewed_at": "2026-10-21"},
			wantInvalid: true,
		},
		{
			name:        "invalid calendar date",
			frontmatter: map[string]any{"lifecycle": LifecycleContract, "reviewed_at": "2026-02-30"},
			wantInvalid: true,
		},
		{
			name:        "future review date",
			frontmatter: map[string]any{"lifecycle": LifecycleContract, "reviewed_at": "2026-10-22"},
			wantInvalid: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			concept := Concept{Path: "ai/example.md", Frontmatter: test.frontmatter}
			var report QualityReport
			validateConceptLifecycle(&report, concept, QualityStrict, checkingDate)
			due := hasQualityIssue(report, "OKF025", concept.Path)
			if due != test.wantDue {
				t.Fatalf("due=%t, want %t; report=%#v", due, test.wantDue, report)
			}
			invalid := hasQualityIssue(report, "OKF021", concept.Path) || hasQualityIssue(report, "OKF022", concept.Path) || hasQualityIssue(report, "OKF023", concept.Path)
			if invalid != test.wantInvalid {
				t.Fatalf("invalid=%t, want %t; report=%#v", invalid, test.wantInvalid, report)
			}
		})
	}
}

func TestValidateConceptLifecycleReportModeUsesWarnings(t *testing.T) {
	t.Parallel()
	concept := Concept{Path: "operations/example.md", Frontmatter: map[string]any{
		"lifecycle":   LifecycleActiveEvidence,
		"reviewed_at": "2026-07-22",
	}}
	var report QualityReport
	validateConceptLifecycle(&report, concept, QualityReportMode, time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC))
	issue, ok := findQualityIssue(report, "OKF025", concept.Path)
	if !ok || issue.Level != "warning" || report.Errors != 0 {
		t.Fatalf("report=%#v", report)
	}
}
