package tessiven

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type TextEdit struct {
	OldString string `json:"old_string"`
	NewString string `json:"new_string"`
}
type EditRequest struct {
	RequestID       string     `json:"request_id"`
	CanvasID        string     `json:"canvas_id"`
	ExpectedVersion int64      `json:"expected_version"`
	Edits           []TextEdit `json:"edits"`
	Summary         string     `json:"summary"`
}

type EditMatchError struct {
	Index   int
	Matches int
}

func (e *EditMatchError) Error() string {
	return fmt.Sprintf("Tessiven edit %d requires exactly one old_string match; found %d. Read or search the expected version and include more surrounding text.", e.Index, e.Matches)
}
func (e *EditMatchError) InvalidArgumentsCode() string { return "tessiven.edit_match" }
func (e *EditMatchError) InvalidArgumentsMeta() map[string]any {
	return map[string]any{"edit_index": e.Index, "matches": e.Matches}
}

// Edit applies exact replacements to an immutable base. Save remains the only
// write boundary, so validation, version conflicts, retries and publication use
// the same transaction as a full save. Unchanged YAML is preserved byte for
// byte, except for a reviewed DSL upgrade.
func (s *Service) Edit(ctx context.Context, req EditRequest) (SaveResult, error) {
	if !requestIDPattern.MatchString(req.RequestID) || req.CanvasID == "" || req.ExpectedVersion <= 0 || len(req.Edits) == 0 || len(req.Edits) > 50 || len(req.Summary) > 2000 {
		return SaveResult{}, ErrInvalidRequest
	}
	base, err := s.Version(ctx, req.CanvasID, req.ExpectedVersion)
	if err != nil {
		return SaveResult{}, err
	}
	document := base.DocumentYAML
	for index, edit := range req.Edits {
		if edit.OldString == "" || edit.OldString == edit.NewString || len(edit.OldString) > MaxDocumentBytes || len(edit.NewString) > MaxDocumentBytes {
			return SaveResult{}, ErrInvalidRequest
		}
		matches := strings.Count(document, edit.OldString)
		if matches != 1 {
			return SaveResult{}, &EditMatchError{Index: index, Matches: matches}
		}
		document = strings.Replace(document, edit.OldString, edit.NewString, 1)
		if len(document) > MaxDocumentBytes {
			return SaveResult{}, ErrInvalidRequest
		}
	}
	if document == base.DocumentYAML {
		return SaveResult{}, ErrInvalidRequest
	}
	raw, _ := json.Marshal(struct {
		EditRequest
		Operation string
	}{req, "tessiven.edit"})
	return s.save(ctx, SaveRequest{RequestID: req.RequestID, CanvasID: req.CanvasID, ExpectedVersion: req.ExpectedVersion, DocumentYAML: document, Summary: req.Summary}, "flower", digest(string(raw)))
}

type ReadRequest struct {
	CanvasID  string `json:"canvas_id"`
	Version   int64  `json:"version,omitempty"`
	StartLine int    `json:"start_line,omitempty"`
	LineCount int    `json:"line_count,omitempty"`
}
type ReadResult struct {
	DSLVersion   string         `json:"dsl_version"`
	Migrations   []DSLMigration `json:"migrations,omitempty"`
	CanvasID     string         `json:"canvas_id"`
	Title        string         `json:"title"`
	Version      int64          `json:"version"`
	Digest       string         `json:"digest"`
	Summary      string         `json:"summary"`
	DocumentYAML string         `json:"document_yaml"`
	StartLine    int            `json:"start_line"`
	EndLine      int            `json:"end_line"`
	TotalLines   int            `json:"total_lines"`
	HasMore      bool           `json:"has_more"`
	Diagnostics  []Diagnostic   `json:"diagnostics,omitempty"`
}

func (s *Service) Read(ctx context.Context, req ReadRequest) (ReadResult, error) {
	if req.CanvasID == "" || req.Version < 0 || req.StartLine < 0 || req.LineCount < 0 || req.LineCount > 500 {
		return ReadResult{}, ErrInvalidRequest
	}
	if req.StartLine == 0 {
		req.StartLine = 1
	}
	if req.LineCount == 0 {
		req.LineCount = 200
	}
	version, err := s.Version(ctx, req.CanvasID, req.Version)
	if err != nil {
		return ReadResult{}, err
	}
	lines := strings.SplitAfter(version.DocumentYAML, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if req.StartLine > len(lines) {
		return ReadResult{}, fmt.Errorf("%w: start_line exceeds the document's %d lines", ErrInvalidRequest, len(lines))
	}
	end := min(req.StartLine-1+req.LineCount, len(lines))
	text := strings.Join(lines[req.StartLine-1:end], "")
	if len(text) > 65536 {
		return ReadResult{}, fmt.Errorf("%w: requested range exceeds 65536 bytes; read fewer lines or use tessiven.search for a bounded excerpt", ErrInvalidRequest)
	}
	return ReadResult{DSLVersion: version.DSLVersion, Migrations: version.Migrations, CanvasID: version.CanvasID, Title: version.Document.Metadata.Title, Version: version.Number, Digest: version.Digest, Summary: version.Summary, DocumentYAML: text, StartLine: req.StartLine, EndLine: end, TotalLines: len(lines), HasMore: end < len(lines), Diagnostics: version.Diagnostics}, nil
}

type SearchRequest struct {
	CanvasID  string `json:"canvas_id"`
	Version   int64  `json:"version,omitempty"`
	Query     string `json:"query"`
	StartLine int    `json:"start_line,omitempty"`
	Limit     int    `json:"limit,omitempty"`
}
type SearchMatch struct {
	Line      int    `json:"line"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated,omitempty"`
}
type SearchResult struct {
	CanvasID string        `json:"canvas_id"`
	Title    string        `json:"title"`
	Version  int64         `json:"version"`
	Matches  []SearchMatch `json:"matches"`
	NextLine int           `json:"next_line,omitempty"`
}

func (s *Service) Search(ctx context.Context, req SearchRequest) (SearchResult, error) {
	if req.CanvasID == "" || req.Version < 0 || req.Query == "" || len(req.Query) > 2000 || strings.ContainsAny(req.Query, "\r\n") || req.StartLine < 0 || req.Limit < 0 || req.Limit > 50 {
		return SearchResult{}, ErrInvalidRequest
	}
	if req.StartLine == 0 {
		req.StartLine = 1
	}
	if req.Limit == 0 {
		req.Limit = 20
	}
	version, err := s.Version(ctx, req.CanvasID, req.Version)
	if err != nil {
		return SearchResult{}, err
	}
	result := SearchResult{CanvasID: version.CanvasID, Title: version.Document.Metadata.Title, Version: version.Number, Matches: []SearchMatch{}}
	for index, line := range strings.Split(version.DocumentYAML, "\n") {
		if index+1 < req.StartLine {
			continue
		}
		offset := strings.Index(line, req.Query)
		if offset < 0 {
			continue
		}
		if len(result.Matches) == req.Limit {
			result.NextLine = index + 1
			break
		}
		// Return a literal excerpt around the match, including valid UTF-8 boundaries.
		start, end := max(0, offset-120), min(len(line), offset+len(req.Query)+240)
		for start > 0 && line[start]&0xc0 == 0x80 {
			start--
		}
		for end < len(line) && line[end]&0xc0 == 0x80 {
			end++
		}
		result.Matches = append(result.Matches, SearchMatch{Line: index + 1, Text: line[start:end], Truncated: start > 0 || end < len(line)})
	}
	return result, nil
}
