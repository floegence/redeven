package ai

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	fltools "github.com/floegence/floret/v7/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

// Map product tool facts directly to the published presentation contract. Code
// must not pass through the smaller generic metadata/string projection first.
func structuredToolInputs(toolName string, args map[string]any, spec aitools.ToolPresentationSpec) []fltools.StructuredActivityRow {
	if toolName == "computer.exec" {
		if code, ok := args["code"].(string); ok && code != "" {
			return []fltools.StructuredActivityRow{toolDetailRow("", "", code, fltools.StructuredActivityRowFormatCode, "javascript", false)}
		}
		return nil
	}
	rows := []fltools.StructuredActivityRow{}
	for _, field := range spec.CallPayloadFields {
		// Typed text may be a secret; identifiers never explain the operation.
		if slices.Contains(spec.Redaction.ArgFields, field) || field == "description" || field == "target_id" || field == "concept_id" || field == "root_ref" {
			continue
		}
		value, exists := args[field]
		if !exists || value == nil {
			continue
		}
		text := toolDetailValue(value)
		if field == "path" || field == "root" {
			text = displayNameForFilePath(text)
		}
		if field == "paths" {
			paths := []string{}
			for _, path := range toAnySlice(value) {
				paths = append(paths, displayNameForFilePath(anyToString(path)))
			}
			text = strings.Join(paths, "\n")
		}
		if text != "" {
			rows = append(rows, toolDetailRow(field, "", text, fltools.StructuredActivityRowFormatText, "", false))
		}
	}
	return rows
}

func toolDetailValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	body, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(body)
}

func toolDetailRow(title, meta, content string, format fltools.StructuredActivityRowFormat, language string, truncated bool) fltools.StructuredActivityRow {
	title, _ = contractSafeString(title, activityPayloadStringLimit)
	meta, _ = contractSafeString(meta, activityPayloadStringLimit)
	if format == fltools.StructuredActivityRowFormatCode {
		if len(content) > 65536 {
			end := 65536
			for end > 0 && !utf8.RuneStart(content[end]) {
				end--
			}
			content, truncated = content[:end], true
		}
	} else {
		var shortened bool
		content, shortened = contractSafeString(content, activityPayloadStringLimit)
		truncated = truncated || shortened
	}
	return fltools.StructuredActivityRow{Title: title, Meta: meta, Content: content, Format: format, Language: language, Truncated: truncated}
}

func structuredToolResults(toolName string, data any, existing []fltools.StructuredActivityRow) []fltools.StructuredActivityRow {
	value, _ := normalizeJSONCompatibleToolPayload(data)
	payload, _ := value.(map[string]any)
	rows := []fltools.StructuredActivityRow{}
	omitted := false
	add := func(title, meta, content string, format fltools.StructuredActivityRowFormat, language string, truncated bool) {
		if title == "" && content == "" {
			return
		}
		if len(rows) >= structuredActivityRowLimit {
			omitted = true
			return
		}
		rows = append(rows, toolDetailRow(title, meta, content, format, language, truncated))
	}
	if isComputerUseTool(toolName) {
		logs := []string{}
		for _, line := range toAnySlice(payload["logs"]) {
			if parts, ok := line.([]any); ok {
				text := []string{}
				for _, part := range parts {
					text = append(text, toolDetailValue(part))
				}
				logs = append(logs, strings.Join(text, " "))
			} else {
				logs = append(logs, toolDetailValue(line))
			}
		}
		if len(logs) > 0 {
			add("", "", strings.Join(logs, "\n"), fltools.StructuredActivityRowFormatCode, "text", readBoolField(payload, "truncated"))
		}
		observation := payload
		if nested, ok := payload["observation"].(map[string]any); ok {
			observation = nested
		}
		lines := []string{}
		for _, node := range toAnySlice(observation["nodes"]) {
			record, _ := node.(map[string]any)
			parts := []string{}
			for _, key := range []string{"role", "name", "text", "value"} {
				if text := strings.TrimSpace(anyToString(record[key])); text != "" && (len(parts) == 0 || parts[len(parts)-1] != text) {
					parts = append(parts, text)
				}
			}
			if len(parts) > 0 {
				lines = append(lines, strings.Join(parts, " · "))
			}
		}
		title := anyToString(observation["title"])
		url := anyToString(observation["url"])
		if url != "" {
			lines = append([]string{url}, lines...)
		}
		add(title, "", strings.Join(lines, "\n"), fltools.StructuredActivityRowFormatText, "", readBoolField(observation, "truncated"))
		if payload["completed"] == false {
			// Confirmed operations remain inspectable after a partial failure.
			add("", "", strings.Join(extractStringSlice(payload["completed_actions"]), "\n"), fltools.StructuredActivityRowFormatCode, "text", false)
		}
		return rows
	}
	switch toolName {
	case "rgrep":
		for _, value := range toAnySlice(payload["matches"]) {
			match, _ := value.(map[string]any)
			content := anyToString(match["text"])
			if context := toAnySlice(match["context"]); len(context) > 0 {
				lines := []string{}
				for _, value := range context {
					line, _ := value.(map[string]any)
					lines = append(lines, fmt.Sprintf("%d: %s", readIntField(line, "line"), anyToString(line["text"])))
				}
				content = strings.Join(lines, "\n")
			}
			add(firstNonEmptyString(anyToString(match["display_name"]), displayNameForFilePath(anyToString(match["path"]))), fmt.Sprint(readIntField(match, "line")), content, fltools.StructuredActivityRowFormatCode, "text", false)
		}
	case "find":
		for _, value := range toAnySlice(payload["results"]) {
			item, _ := value.(map[string]any)
			add(firstNonEmptyString(anyToString(item["display_name"]), displayNameForFilePath(anyToString(item["path"]))), "", "", fltools.StructuredActivityRowFormatText, "", false)
		}
	case "read_files":
		for _, value := range toAnySlice(payload["files"]) {
			file, _ := value.(map[string]any)
			result, _ := file["result"].(map[string]any)
			name := firstNonEmptyString(anyToString(result["display_name"]), displayNameForFilePath(anyToString(file["path"])))
			content := anyToString(result["content"])
			if failure := anyToString(file["error"]); failure != "" {
				content = failure
			}
			add(name, "", content, fltools.StructuredActivityRowFormatCode, "text", readBoolField(result, "truncated"))
		}
	case "use_skill":
		add(anyToString(payload["name"]), anyToString(payload["reason"]), anyToString(payload["content"]), fltools.StructuredActivityRowFormatMarkdown, "", readBoolField(payload, "truncated"))
	default:
		if len(existing) > 0 && readBoolField(payload, "truncated") {
			existing[len(existing)-1].Truncated = true
		}
		return existing
	}
	if len(rows) > 0 && (readBoolField(payload, "truncated") || omitted) {
		rows[len(rows)-1].Truncated = true
	}
	return rows
}
