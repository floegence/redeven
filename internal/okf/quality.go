package okf

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

type QualityMode string

const (
	QualityOff        QualityMode = "off"
	QualityReportMode QualityMode = "report"
	QualityStrict     QualityMode = "strict"

	OKFSourceCharacterTarget  = 900_000
	OKFSourceCharacterLimit   = 1_000_000
	OKFConceptCharacterTarget = 840_000
	OKFIndexCharacterTarget   = 25_000
	OKFLogCharacterTarget     = 35_000
)

const (
	LifecycleContract        = "contract"
	LifecycleActiveEvidence  = "active_evidence"
	LifecycleRetainedHistory = "retained_history"
)

type QualityIssue struct {
	Level   string `json:"level"`
	Code    string `json:"code"`
	Path    string `json:"path"`
	Message string `json:"message"`
}

type QualityReport struct {
	Issues                   []QualityIssue           `json:"issues"`
	Errors                   int                      `json:"errors"`
	Warnings                 int                      `json:"warnings"`
	SourceCharacters         int                      `json:"source_characters"`
	SourceCharacterTarget    int                      `json:"source_character_target"`
	SourceCharacterLimit     int                      `json:"source_character_limit"`
	SourceCharactersRemain   int                      `json:"source_characters_remaining"`
	SourceCharacterBreakdown SourceCharacterBreakdown `json:"source_character_breakdown"`
}

type SourceCharacterBreakdown struct {
	Index    int `json:"index"`
	Log      int `json:"log"`
	Concepts int `json:"concepts"`
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
	return validateBundleQualityAt(bundle, sourceRoot, mode, time.Now())
}

func validateBundleQualityAt(bundle Bundle, sourceRoot string, mode QualityMode, now time.Time) QualityReport {
	report := QualityReport{
		SourceCharacterTarget: OKFSourceCharacterTarget,
		SourceCharacterLimit:  OKFSourceCharacterLimit,
	}
	if mode == QualityOff {
		return report
	}
	usage, err := countSourceCharacters(sourceRoot)
	if err != nil {
		report.add("error", "OKF024", "", "cannot count OKF source characters: "+err.Error())
	} else {
		report.SourceCharacters = usage.Total
		report.SourceCharactersRemain = OKFSourceCharacterLimit - usage.Total
		report.SourceCharacterBreakdown = SourceCharacterBreakdown{
			Index: usage.Index, Log: usage.Log, Concepts: usage.Concepts,
		}
		if usage.Total > OKFSourceCharacterTarget {
			report.add("warning", "OKF019", "", fmt.Sprintf("OKF source contains %d characters; target is %d", usage.Total, OKFSourceCharacterTarget))
		}
		for _, budget := range []struct {
			path   string
			name   string
			actual int
			target int
		}{
			{path: "index.md", name: "index", actual: usage.Index, target: OKFIndexCharacterTarget},
			{path: "log.md", name: "log", actual: usage.Log, target: OKFLogCharacterTarget},
			{path: "", name: "concepts", actual: usage.Concepts, target: OKFConceptCharacterTarget},
		} {
			if budget.actual > budget.target {
				report.add("warning", "OKF026", budget.path, fmt.Sprintf("OKF %s contain %d characters; target is %d", budget.name, budget.actual, budget.target))
			}
		}
		if usage.Total > OKFSourceCharacterLimit {
			level := "warning"
			if mode == QualityStrict {
				level = "error"
			}
			report.add(level, "OKF020", "", fmt.Sprintf("OKF source contains %d characters, exceeding the hard limit of %d by %d", usage.Total, OKFSourceCharacterLimit, usage.Total-OKFSourceCharacterLimit))
		}
	}
	validateLogRecency(&report, sourceRoot, mode, now)

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
		// A quality exception can explain a concept that exceeds the normal
		// 12,000-character budget, but it cannot make an over-20,000-character
		// concept acceptable. The repository authoring contract treats that
		// size as an absolute split boundary so the quality gate must continue
		// reporting it even when an exception is present.
		if bodyLength > 20000 {
			report.add(layoutLevel, "OKF011", path, fmt.Sprintf("normal concept body length is %d characters; maximum is 20000", bodyLength))
		}
		if len(concept.Evidence) > 30 {
			report.add("warning", "OKF012", path, fmt.Sprintf("concept contains %d evidence references; consider splitting or consolidating evidence", len(concept.Evidence)))
		}
		validateConceptLifecycle(&report, concept, mode, now)
		validateEvidence(&report, concept, sourceRoot, mode)
	}
	validateDuplicateParagraphs(&report, bundle, mode)
	return report
}

func validateLogRecency(report *QualityReport, sourceRoot string, mode QualityMode, now time.Time) {
	logPath := filepath.Join(sourceRoot, "log.md")
	data, err := os.ReadFile(logPath)
	if err != nil {
		level := "warning"
		if mode == QualityStrict {
			level = "error"
		}
		report.add(level, "OKF027", "log.md", "cannot read OKF update log: "+err.Error())
		return
	}
	level := "warning"
	if mode == QualityStrict {
		level = "error"
	}
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	cutoff := today.AddDate(0, 0, -30)
	for lineNumber, raw := range strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(raw)
		if !strings.HasPrefix(line, "## ") {
			continue
		}
		heading := strings.TrimSpace(strings.TrimPrefix(line, "## "))
		if len(heading) < len("2000-01-01") {
			report.add(level, "OKF027", "log.md", fmt.Sprintf("log heading on line %d must begin with a YYYY-MM-DD date", lineNumber+1))
			continue
		}
		date, ok := parseReviewDate(heading[:len("2000-01-01")])
		if !ok {
			report.add(level, "OKF027", "log.md", fmt.Sprintf("log heading on line %d must begin with a valid YYYY-MM-DD date", lineNumber+1))
			continue
		}
		if date.After(today) {
			report.add(level, "OKF027", "log.md", fmt.Sprintf("log heading on line %d cannot be in the future", lineNumber+1))
			continue
		}
		if date.Before(cutoff) {
			report.add(level, "OKF028", "log.md", fmt.Sprintf("log entry on line %d is older than 30 days; move durable knowledge to its concept and remove the entry", lineNumber+1))
		}
	}
}

type sourceCharacterUsage struct {
	Total    int
	Index    int
	Log      int
	Concepts int
}

func countSourceCharacters(sourceRoot string) (sourceCharacterUsage, error) {
	var usage sourceCharacterUsage
	root := filepath.Clean(sourceRoot)
	distRoot := filepath.Join(root, "dist")
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if path == distRoot {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.ToLower(filepath.Ext(entry.Name())) != ".md" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		characters := utf8.RuneCountInString(strings.ReplaceAll(string(data), "\r\n", "\n"))
		usage.Total += characters
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		switch filepath.ToSlash(relative) {
		case "index.md":
			usage.Index += characters
		case "log.md":
			usage.Log += characters
		default:
			usage.Concepts += characters
		}
		return nil
	})
	if err != nil {
		return sourceCharacterUsage{}, err
	}
	return usage, nil
}

func validateConceptLifecycle(report *QualityReport, concept Concept, mode QualityMode, now time.Time) {
	issueLevel := "warning"
	if mode == QualityStrict {
		issueLevel = "error"
	}
	lifecycle, _ := concept.Frontmatter["lifecycle"].(string)
	lifecycle = strings.TrimSpace(lifecycle)
	intervalDays := 0
	switch lifecycle {
	case LifecycleContract:
		intervalDays = 180
	case LifecycleActiveEvidence:
		intervalDays = 90
	case LifecycleRetainedHistory:
		intervalDays = 365
	default:
		report.add(issueLevel, "OKF021", concept.Path, "lifecycle must be contract, active_evidence, or retained_history")
		return
	}
	if lifecycle == LifecycleRetainedHistory {
		retentionReason, _ := concept.Frontmatter["retention_reason"].(string)
		if strings.TrimSpace(retentionReason) == "" {
			report.add(issueLevel, "OKF023", concept.Path, "retained history requires a concise retention_reason")
		}
	}
	reviewedAt, ok := parseReviewDate(concept.Frontmatter["reviewed_at"])
	if !ok {
		report.add(issueLevel, "OKF022", concept.Path, "reviewed_at must be a valid YYYY-MM-DD date")
		return
	}
	today := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	reviewDate := time.Date(reviewedAt.UTC().Year(), reviewedAt.UTC().Month(), reviewedAt.UTC().Day(), 0, 0, 0, 0, time.UTC)
	if reviewDate.After(today) {
		report.add(issueLevel, "OKF022", concept.Path, "reviewed_at cannot be in the future")
		return
	}
	dueDate := reviewDate.AddDate(0, 0, intervalDays)
	if !today.Before(dueDate) {
		report.add(issueLevel, "OKF025", concept.Path, fmt.Sprintf("review is overdue; %s content must be reviewed every %d days", lifecycle, intervalDays))
	}
}

func parseReviewDate(value any) (time.Time, bool) {
	switch date := value.(type) {
	case string:
		parsed, err := time.Parse("2006-01-02", strings.TrimSpace(date))
		return parsed, err == nil
	case time.Time:
		return date, true
	default:
		return time.Time{}, false
	}
}

func validateEvidence(report *QualityReport, concept Concept, sourceRoot string, mode QualityMode) {
	seen := make(map[string]struct{}, len(concept.Evidence))
	lineCounts := make(map[string]int)
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
		resolvedPath := filepath.Join(sourceRoot, path)
		if _, err := os.Stat(resolvedPath); err != nil {
			resolvedPath = filepath.Join(filepath.Dir(sourceRoot), path)
			if _, err := os.Stat(resolvedPath); err != nil {
				report.add("error", "OKF016", concept.Path, "evidence source does not exist: "+ref.Source)
				continue
			}
		}
		if ref.Line > 0 {
			lineCount, ok := lineCounts[resolvedPath]
			if !ok {
				data, err := os.ReadFile(resolvedPath)
				if err != nil {
					report.add("error", "OKF018", concept.Path, "evidence source cannot be read for line validation: "+ref.Source)
					continue
				}
				lineCount = 1 + strings.Count(string(data), "\n")
				if len(data) == 0 {
					lineCount = 0
				}
				lineCounts[resolvedPath] = lineCount
			}
			if ref.Line > lineCount {
				report.add("error", "OKF018", concept.Path, fmt.Sprintf("evidence line %d is outside source range 1-%d: %s", ref.Line, lineCount, ref.Source))
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
