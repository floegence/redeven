package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/threadquery"
	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/session"
)

var ErrFlowerToolPreviewNotFound = errors.New("tool preview is unavailable")

const threadPreviewRowLimit = 10

type FlowerToolPreviewRequest struct {
	ThreadID   string `json:"-"`
	TurnID     string `json:"turn_id"`
	RunID      string `json:"run_id"`
	ToolCallID string `json:"tool_call_id"`
}

type FlowerToolPreview struct {
	ToolName           string                          `json:"tool_name"`
	Inputs             []fltools.StructuredActivityRow `json:"inputs"`
	Rows               []fltools.StructuredActivityRow `json:"rows"`
	Total              *int                            `json:"total,omitempty"`
	HasMore            bool                            `json:"has_more"`
	ContentUnavailable bool                            `json:"content_unavailable,omitempty"`
}

// ReadFlowerToolPreview projects an authorized confirmed result without changing
// the canonical journal or adding private query content to Activity snapshots.
func (s *Service) ReadFlowerToolPreview(ctx context.Context, meta *session.Meta, req FlowerToolPreviewRequest) (FlowerToolPreview, error) {
	if strings.TrimSpace(req.ThreadID) == "" || strings.TrimSpace(req.TurnID) == "" || strings.TrimSpace(req.RunID) == "" || strings.TrimSpace(req.ToolCallID) == "" {
		return FlowerToolPreview{}, ErrFlowerToolPreviewNotFound
	}
	settings, err := s.threadSettingsForRead(ctx, meta, req.ThreadID)
	if err != nil || settings == nil {
		return FlowerToolPreview{}, ErrFlowerToolPreviewNotFound
	}
	reader, ok := s.threadRuntime.(flruntime.ThreadToolResultReader)
	if !ok {
		return FlowerToolPreview{}, ErrFlowerToolPreviewNotFound
	}
	result, found, err := reader.LookupToolResult(ctx, flruntime.LookupToolResultInput{ThreadID: identity.ThreadID(req.ThreadID), TurnID: identity.TurnID(req.TurnID), RunID: identity.RunID(req.RunID), ToolCallID: req.ToolCallID})
	if err != nil || !found || !isThreadQueryTool(result.ToolName) {
		return FlowerToolPreview{}, ErrFlowerToolPreviewNotFound
	}
	return threadToolPreview(result)
}

func threadToolPreview(result flruntime.ThreadToolResult) (FlowerToolPreview, error) {
	preview := FlowerToolPreview{ToolName: result.ToolName, Inputs: []fltools.StructuredActivityRow{}, Rows: []fltools.StructuredActivityRow{}}
	row := func(title, content string) fltools.StructuredActivityRow {
		return fltools.StructuredActivityRow{Title: title, Content: content, Format: "text"}
	}
	var envelope struct {
		Status string          `json:"status"`
		Data   json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal([]byte(result.Content), &envelope); err != nil || envelope.Status != "success" || result.Status != "success" {
		return preview, ErrFlowerToolPreviewNotFound
	}
	switch result.ToolName {
	case "threads.query", "threads.aggregate":
		var input threadquery.AggregateInput
		input.Sort.Descending = result.ToolName == "threads.query"
		if err := json.Unmarshal([]byte(result.Arguments), &input); err != nil {
			return preview, ErrFlowerToolPreviewNotFound
		}
		for _, match := range []struct {
			name  string
			value threadquery.TextMatch
		}{{"query", input.Filter.Text}, {"title", input.Filter.Title}, {"arguments", input.Filter.Arguments}, {"result", input.Filter.Result}} {
			values := []string{}
			if match.value.Contains != "" {
				values = append(values, match.value.Contains)
			}
			if match.value.Phrase != "" {
				values = append(values, "\""+match.value.Phrase+"\"")
			}
			if len(match.value.Keywords) > 0 {
				separator := " ∧ "
				if match.value.AnyKeyword {
					separator = " ∨ "
				}
				values = append(values, strings.Join(match.value.Keywords, separator))
			}
			if len(values) > 0 {
				preview.Inputs = append(preview.Inputs, row(match.name, strings.Join(values, " · ")))
			}
		}
		preview.Inputs = append(preview.Inputs, row("object", string(input.Object)))
		limit := input.Limit
		if limit == 0 {
			limit = 50
		}
		preview.Inputs = append(preview.Inputs, row("limit", strconv.Itoa(limit)))
		sortKey := input.Sort.Key
		if sortKey == "" {
			sortKey = "key"
			if result.ToolName == "threads.query" {
				keys := threadQuerySortKeys(result.ToolName, input.Object)
				if len(keys) == 0 {
					return preview, ErrFlowerToolPreviewNotFound
				}
				sortKey = keys[0]
			}
		}
		direction := " ↑"
		if input.Sort.Descending {
			direction = " ↓"
		}
		preview.Inputs = append(preview.Inputs, row("sort", sortKey+direction))
		scope := "all"
		if len(input.Filter.ThreadIDs) > 0 {
			scope = strconv.Itoa(len(input.Filter.ThreadIDs))
		} else if len(input.Filter.ParentThreadIDs) > 0 || len(input.Filter.TurnIDs) > 0 || len(input.Filter.RunIDs) > 0 {
			scope = ""
		}
		if scope != "" {
			preview.Inputs = append(preview.Inputs, row("scope", scope))
		}
		for _, filter := range []struct {
			name   string
			values []string
		}{{"roles", input.Filter.Roles}, {"tool_names", input.Filter.ToolNames}, {"statuses", input.Filter.Statuses}, {"tool_kinds", input.Filter.ToolKinds}, {"activities", input.Filter.Activities}, {"outcomes", input.Filter.Outcomes}} {
			if len(filter.values) > 0 {
				preview.Inputs = append(preview.Inputs, row(filter.name, strings.Join(filter.values, ", ")))
			}
		}
		for _, span := range []struct {
			name  string
			value threadquery.TimeRange
		}{{"time", input.Filter.Time}, {"created", input.Filter.Created}, {"updated", input.Filter.Updated}, {"completed", input.Filter.Completed}} {
			if !span.value.From.IsZero() {
				preview.Inputs = append(preview.Inputs, row(span.name+".from", span.value.From.UTC().Format(time.RFC3339)))
			}
			if !span.value.To.IsZero() {
				preview.Inputs = append(preview.Inputs, row(span.name+".to", span.value.To.UTC().Format(time.RFC3339)))
			}
		}
		if input.GroupBy != "" {
			preview.Inputs = append(preview.Inputs, row("group_by", input.GroupBy))
		}
		if result.ToolName == "threads.query" {
			var page threadquery.Page
			if err := json.Unmarshal(envelope.Data, &page); err != nil {
				return preview, ErrFlowerToolPreviewNotFound
			}
			preview.Total = &page.Total
			preview.HasMore = page.NextCursor != ""
			for _, record := range page.Records {
				preview.Rows = append(preview.Rows, threadRecordPreviewRow(record))
			}
		} else {
			var page threadquery.AggregatePage
			if err := json.Unmarshal(envelope.Data, &page); err != nil {
				return preview, ErrFlowerToolPreviewNotFound
			}
			preview.Total = &page.Total
			preview.HasMore = page.NextCursor != ""
			for _, group := range page.Groups {
				title := group.Key
				if input.GroupBy == "thread" {
					title = ""
				}
				preview.Rows = append(preview.Rows, fltools.StructuredActivityRow{Title: title, Content: strconv.Itoa(group.Count), Format: "text"})
			}
		}
	case "threads.read":
		var page threadquery.ReadPage
		if err := json.Unmarshal(envelope.Data, &page); err != nil {
			return preview, ErrFlowerToolPreviewNotFound
		}
		preview.HasMore = page.NextCursor != ""
		if page.Record.Object != "" {
			preview.Inputs = append(preview.Inputs, row("object", string(page.Record.Object)))
		}
		if page.Record.Role != "" {
			preview.Inputs = append(preview.Inputs, row("roles", page.Record.Role))
		}
		if page.Record.ToolName != "" {
			preview.Inputs = append(preview.Inputs, row("tool_names", page.Record.ToolName))
		}
		title := page.Record.Title
		if title == "" {
			title = page.Record.ToolName
		}
		if title != "" {
			preview.Inputs = append(preview.Inputs, row("name", title))
		}
		// Show readable content only; references, context, presentation and opaque
		// identifiers are not useful content previews. Preserve chunk whitespace.
		field := ""
		end := -1
		for _, chunk := range page.Chunks {
			if chunk.Field != "body" && chunk.Field != "title" && chunk.Field != "arguments" && chunk.Field != "result" {
				continue
			}
			if chunk.Field == field && chunk.Offset == end && len(preview.Rows) > 0 {
				preview.Rows[len(preview.Rows)-1].Content += chunk.Text
			} else {
				preview.Rows = append(preview.Rows, row(chunk.Field, chunk.Text))
			}
			field = chunk.Field
			end = chunk.Offset + len(chunk.Text)
		}
		readable := []fltools.StructuredActivityRow{}
		for _, chunk := range preview.Rows {
			if chunk.Title == "arguments" || chunk.Title == "result" {
				readable = append(readable, threadToolContentRows(page.Record.ToolName, chunk.Title, chunk.Content)...)
			} else {
				readable = append(readable, chunk)
			}
		}
		preview.ContentUnavailable = len(page.Chunks) > 0 && len(readable) == 0
		preview.Rows = readable
	default:
		return preview, ErrFlowerToolPreviewNotFound
	}
	preview.Inputs, _ = boundedThreadPreviewRows(preview.Inputs, 24)
	var clipped bool
	preview.Rows, clipped = boundedThreadPreviewRows(preview.Rows, threadPreviewRowLimit)
	preview.HasMore = preview.HasMore || clipped
	return preview, nil
}

func threadRecordPreviewRow(record threadquery.Record) fltools.StructuredActivityRow {
	meta := []string{}
	for _, value := range []string{record.Role, record.Status} {
		if value != "" {
			meta = append(meta, value)
		}
	}
	if !record.Time.IsZero() {
		meta = append(meta, record.Time.UTC().Format(time.RFC3339))
	}
	return fltools.StructuredActivityRow{Title: firstNonEmptyString(record.Title, record.ToolName), Meta: strings.Join(meta, " · "), Content: record.Snippet, Format: "text"}
}

func boundedThreadPreviewRows(rows []fltools.StructuredActivityRow, limit int) ([]fltools.StructuredActivityRow, bool) {
	clipped := len(rows) > limit
	if clipped {
		rows = rows[:limit]
	}
	for i := range rows {
		for _, field := range []struct {
			value *string
			limit int
		}{{&rows[i].Title, 160}, {&rows[i].Meta, 240}, {&rows[i].Content, 1200}} {
			runes := []rune(*field.value)
			if len(runes) > field.limit {
				*field.value = string(runes[:field.limit-1]) + "…"
				rows[i].Truncated = true
				clipped = true
			}
		}
	}
	return rows, clipped
}

// Reuse the tool presentation allowlist when a read targets a tool call. Raw
// argument/result envelopes and unrelated metadata never become a JSON dump.
func threadToolContentRows(toolName, field, content string) []fltools.StructuredActivityRow {
	var data map[string]any
	if json.Unmarshal([]byte(content), &data) != nil {
		return nil
	}
	var rows []fltools.StructuredActivityRow
	if field == "arguments" {
		spec, ok := aitools.PresentationSpec(toolName)
		if ok {
			rows = structuredToolInputs(toolName, data, spec)
		}
		if len(rows) == 0 {
			for _, key := range []string{"description", "command", "query"} {
				if text, ok := data[key].(string); ok && text != "" {
					rows = append(rows, toolDetailRow(field, "", text, fltools.StructuredActivityRowFormatText, "", false))
					break
				}
			}
		}
	} else {
		payload, ok := data["data"].(map[string]any)
		if !ok {
			return nil
		}
		rows = structuredToolResults(toolName, payload, nil)
		if len(rows) == 0 {
			for _, key := range []string{"output", "content", "text", "summary"} {
				if text, ok := payload[key].(string); ok && text != "" {
					rows = append(rows, toolDetailRow(field, "", text, fltools.StructuredActivityRowFormatText, "", false))
					break
				}
			}
		}
	}
	for i := range rows {
		rows[i].Title = field
		rows[i].Format = fltools.StructuredActivityRowFormatText
	}
	return rows
}
