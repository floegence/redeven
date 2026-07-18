package okf

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type QualityMode string

const (
	QualityOff        QualityMode = "off"
	QualityReportMode QualityMode = "report"
	QualityStrict     QualityMode = "strict"
)

type QualityIssue struct {
	Level   string `json:"level"`
	Code    string `json:"code"`
	Path    string `json:"path"`
	Message string `json:"message"`
}

type QualityReport struct {
	Issues   []QualityIssue `json:"issues"`
	Errors   int            `json:"errors"`
	Warnings int            `json:"warnings"`
}

func (r *QualityReport) add(level, code, path, message string) {
	r.Issues = append(r.Issues, QualityIssue{Level: level, Code: code, Path: path, Message: message})
	if level == "error" {
		r.Errors++
	} else {
		r.Warnings++
	}
}

func ValidateBundleQuality(bundle Bundle, sourceRoot string, mode QualityMode) QualityReport {
	var report QualityReport
	if mode == QualityOff {
		return report
	}

	indexCounts := make(map[string]int)
	for _, section := range bundle.RootIndex.Sections {
		for _, entry := range section.Entries {
			indexCounts[entry.Path]++
		}
	}

	for _, concept := range bundle.Concepts {
		path := concept.Path
		layoutLevel := "warning"
		if mode == QualityStrict {
			layoutLevel = "error"
		}
		if indexCounts[path] == 0 {
			report.add(layoutLevel, "OKF001", path, "concept is not linked from okf/index.md")
		}
		if indexCounts[path] > 1 {
			report.add(layoutLevel, "OKF002", path, "concept is listed more than once in okf/index.md")
		}
		if concept.Legacy {
			report.add(layoutLevel, "OKF003", path, "concept uses the legacy body layout; add Summary, Contract, Boundaries, and Evidence sections")
		}
		if !concept.HasSummary {
			report.add(layoutLevel, "OKF004", path, "missing top-level Summary section")
		}
		if !concept.HasContract {
			report.add(layoutLevel, "OKF005", path, "missing top-level Contract section")
		}
		if !concept.HasBounds {
			report.add(layoutLevel, "OKF006", path, "missing top-level Boundaries section")
		}
		if !concept.HasEvidence {
			report.add(layoutLevel, "OKF007", path, "missing top-level Evidence section")
		}

		summaryLength := len([]rune(strings.TrimSpace(concept.Summary)))
		if summaryLength < 250 || summaryLength > 800 {
			report.add(layoutLevel, "OKF008", path, fmt.Sprintf("Summary length is %d characters; expected 250-800", summaryLength))
		}

		bodyLength := 0
		for _, section := range concept.Sections {
			bodyLength += section.CharCount
		}
		if bodyLength > 8000 {
			report.add("warning", "OKF009", path, fmt.Sprintf("contract and boundary body length is %d characters; target is at most 8000", bodyLength))
		}
		qualityException, _ := concept.Frontmatter["quality_exception"].(string)
		if bodyLength > 12000 && strings.TrimSpace(qualityException) == "" {
			report.add(layoutLevel, "OKF010", path, fmt.Sprintf("contract and boundary body length is %d characters; split or document an exception", bodyLength))
		}
		if bodyLength > 20000 && strings.TrimSpace(qualityException) == "" {
			report.add(layoutLevel, "OKF011", path, fmt.Sprintf("normal concept body length is %d characters; maximum is 20000", bodyLength))
		}
		if len(concept.Evidence) > 30 {
			report.add("warning", "OKF012", path, fmt.Sprintf("concept contains %d evidence references; consider splitting or consolidating evidence", len(concept.Evidence)))
		}
		validateEvidence(&report, concept, sourceRoot, mode)
	}
	validateDuplicateParagraphs(&report, bundle, mode)
	return report
}

func validateEvidence(report *QualityReport, concept Concept, sourceRoot string, mode QualityMode) {
	seen := make(map[string]struct{}, len(concept.Evidence))
	for _, ref := range concept.Evidence {
		if _, ok := seen[ref.ID]; ok {
			level := "warning"
			if mode == QualityStrict {
				level = "error"
			}
			report.add(level, "OKF013", concept.Path, "duplicate evidence reference: "+ref.ID)
		}
		seen[ref.ID] = struct{}{}
		if strings.TrimSpace(ref.Description) == "" {
			report.add("error", "OKF014", concept.Path, "evidence reference has an empty description")
		}
		path := strings.TrimPrefix(strings.TrimSpace(ref.Source), "redeven:")
		if path == "" {
			report.add("error", "OKF015", concept.Path, "evidence reference has an empty source")
			continue
		}
		if _, err := os.Stat(filepath.Join(sourceRoot, path)); err != nil {
			if _, err := os.Stat(filepath.Join(filepath.Dir(sourceRoot), path)); err != nil {
				report.add("error", "OKF016", concept.Path, "evidence source does not exist: "+ref.Source)
			}
		}
	}
}

func validateDuplicateParagraphs(report *QualityReport, bundle Bundle, mode QualityMode) {
	type paragraphOwner struct {
		path string
	}
	seen := make(map[string]paragraphOwner)
	for _, concept := range bundle.Concepts {
		for _, section := range concept.Sections {
			for _, raw := range strings.Split(section.Body, "\n\n") {
				text := normalizeQualityText(raw)
				if len([]rune(text)) < 200 {
					continue
				}
				if previous, ok := seen[text]; ok && previous.path != concept.Path {
					level := "warning"
					if len([]rune(text)) >= 500 && mode == QualityStrict {
						level = "error"
					}
					report.add(level, "OKF017", concept.Path, fmt.Sprintf("duplicate paragraph also appears in %s", previous.path))
					continue
				}
				seen[text] = paragraphOwner{path: concept.Path}
			}
		}
	}
}

var qualityWhitespace = regexp.MustCompile(`\s+`)

func normalizeQualityText(value string) string {
	return qualityWhitespace.ReplaceAllString(strings.ToLower(strings.TrimSpace(value)), " ")
}

func (r QualityReport) SortedIssues() []QualityIssue {
	out := append([]QualityIssue(nil), r.Issues...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Path == out[j].Path {
			return out[i].Code < out[j].Code
		}
		return out[i].Path < out[j].Path
	})
	return out
}
