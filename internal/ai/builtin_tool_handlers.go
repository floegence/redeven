package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

const terminalReadDescriptionMaxRunes = 120

type builtInToolHandler struct {
	r               *run
	toolName        string
	activityUpdater toolActivityUpdater
}

func toolSuccessSummary(toolName string) string {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return "terminal.exec"
	case "terminal.read":
		return "terminal.read"
	case "terminal.write":
		return "terminal.write"
	case "terminal.terminate":
		return "terminal.terminate"
	case "file.read":
		return "file.read"
	case "file.edit", "file.write":
		return "file.updated"
	case "apply_patch":
		return "apply_patch.applied"
	case "write_todos":
		return "todos.updated"
	case "web.search":
		return "web.search"
	case "okf.index":
		return "okf.index"
	case "okf.search":
		return "okf.knowledge.lookup"
	case "okf.open":
		return "okf.concept.opened"
	case "use_skill":
		return "skill.activated"
	case "subagents":
		return "delegation.managed"
	default:
		return "tool.success"
	}
}

func (h *builtInToolHandler) Validate(_ context.Context, call ToolCall) error {
	if h == nil || h.r == nil {
		return fmt.Errorf("tool handler unavailable")
	}
	if strings.TrimSpace(call.Name) == "" {
		return fmt.Errorf("missing tool name")
	}
	return nil
}

func (h *builtInToolHandler) Execute(ctx context.Context, call ToolCall) (ToolResult, error) {
	if h == nil || h.r == nil {
		return ToolResult{}, fmt.Errorf("tool handler unavailable")
	}
	toolName := strings.TrimSpace(call.Name)
	if toolName == "" {
		toolName = strings.TrimSpace(h.toolName)
	}
	outcome, err := h.r.handleToolCall(ctx, strings.TrimSpace(call.ID), toolName, cloneAnyMap(call.Args), h.activityUpdater)
	if err != nil {
		return ToolResult{}, err
	}
	if outcome == nil {
		return ToolResult{ToolID: call.ID, ToolName: toolName, Status: toolResultStatusError, Summary: "tool.error", Details: "empty tool outcome"}, nil
	}
	if outcome.Pending != nil {
		data, truncated := normalizeTruncatedToolPayload(toolName, outcome.Result)
		return ToolResult{
			ToolID:    strings.TrimSpace(call.ID),
			ToolName:  toolName,
			Status:    "pending",
			Summary:   strings.TrimSpace(outcome.Pending.Summary),
			Details:   strings.TrimSpace(outcome.Pending.Instruction),
			Data:      data,
			Pending:   outcome.Pending,
			Truncated: truncated,
		}, nil
	}
	if outcome.Success {
		data, truncated := normalizeTruncatedToolPayload(toolName, outcome.Result)
		return ToolResult{
			ToolID:    strings.TrimSpace(call.ID),
			ToolName:  toolName,
			Status:    toolResultStatusSuccess,
			Summary:   toolSuccessSummary(toolName),
			Details:   "tool execution completed",
			Data:      data,
			Truncated: truncated,
		}, nil
	}
	if outcome.ToolError != nil {
		outcome.ToolError.Normalize()
	}
	status := toolResultStatusError
	summary := "tool.error"
	details := ""
	if outcome.ToolError != nil {
		details = strings.TrimSpace(outcome.ToolError.Message)
		switch outcome.ToolError.Code {
		case aitools.ErrorCodeTimeout:
			status = toolResultStatusTimeout
			summary = "tool.timeout"
		case aitools.ErrorCodeCanceled:
			status = toolResultStatusAborted
			summary = "tool.aborted"
		case aitools.ErrorCodePermissionDenied:
			summary = "permission_denied"
		}
	}
	if details == "" {
		details = "tool execution failed"
	}
	data, truncated := normalizeTruncatedToolPayload(toolName, outcome.Result)
	return ToolResult{
		ToolID:    strings.TrimSpace(call.ID),
		ToolName:  toolName,
		Status:    status,
		Summary:   summary,
		Details:   details,
		Data:      data,
		Truncated: truncated,
		Error:     outcome.ToolError,
	}, nil
}

func (h *builtInToolHandler) HandlePartial(_ context.Context, _ PartialToolCall) error {
	return nil
}

func extractStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		if ss, ok := v.([]string); ok {
			out := make([]string, 0, len(ss))
			for _, item := range ss {
				item = strings.TrimSpace(item)
				if item != "" {
					out = append(out, item)
				}
			}
			return out
		}
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		s := strings.TrimSpace(anyToString(item))
		if s == "" {
			continue
		}
		out = append(out, s)
	}
	return out
}

func normalizeTruncatedToolPayload(toolName string, payload any) (any, bool) {
	toolName = strings.TrimSpace(toolName)
	switch toolName {
	case "terminal.exec":
		m, _ := payload.(map[string]any)
		if m == nil {
			return payload, false
		}
		truncated := false
		if stdout, ok := m["stdout"].(string); ok {
			trimmed, hit := truncateByRunes(stdout, 4000)
			m["stdout"] = trimmed
			truncated = truncated || hit
		}
		if stderr, ok := m["stderr"].(string); ok {
			trimmed, hit := truncateByRunes(stderr, 2000)
			m["stderr"] = trimmed
			truncated = truncated || hit
		}
		if output, ok := m["output"].(string); ok {
			trimmed, hit := truncateByRunes(output, 4000)
			m["output"] = trimmed
			truncated = truncated || hit
		}
		if latest, ok := m["latest_output"].(string); ok {
			trimmed, hit := truncateByRunes(latest, 4000)
			m["latest_output"] = trimmed
			truncated = truncated || hit
		}
		if truncated {
			m["truncated"] = true
		}
		return m, truncated
	case "file.read":
		return normalizeFileReadPayload(payload)
	case "file.edit", "file.write":
		return normalizeFileMutationPayload(payload)
	case "apply_patch":
		return normalizeApplyPatchPayload(payload)
	case "write_todos":
		return normalizeTodosPayload(payload)
	case "subagents":
		return normalizeSubagentsPayload(payload)
	case "okf.index", "okf.search", "okf.open":
		return normalizeJSONCompatibleToolPayload(payload)
	default:
		if payload == nil {
			return nil, false
		}
		b, err := json.Marshal(payload)
		if err != nil {
			return payload, false
		}
		trimmed, truncated := truncateByRunes(string(b), 4000)
		if truncated {
			return map[string]any{"raw": trimmed, "truncated": true}, true
		}
		var normalized any
		if err := json.Unmarshal(b, &normalized); err != nil {
			return payload, false
		}
		return normalized, false
	}
}

func normalizeJSONCompatibleToolPayload(payload any) (any, bool) {
	if payload == nil {
		return nil, false
	}
	b, err := json.Marshal(payload)
	if err != nil || len(b) == 0 {
		return payload, false
	}
	var normalized any
	if err := json.Unmarshal(b, &normalized); err != nil {
		return payload, false
	}
	return normalized, false
}

func normalizeFileReadPayload(payload any) (any, bool) {
	normalized, _ := normalizeJSONCompatibleToolPayload(payload)
	record, ok := normalized.(map[string]any)
	if !ok || record == nil {
		return normalized, false
	}
	truncated := false
	if readBoolField(record, "truncated") {
		truncated = true
	}
	if content, ok := record["content"].(string); ok {
		trimmed, hit := truncateByRunes(content, 4000)
		record["content"] = trimmed
		truncated = truncated || hit
	}
	if truncated {
		record["truncated"] = true
	}
	return record, truncated
}

func normalizeTodosPayload(payload any) (any, bool) {
	normalized, _ := normalizeJSONCompatibleToolPayload(payload)
	record, ok := normalized.(map[string]any)
	if !ok || record == nil {
		return normalized, false
	}
	truncated := false
	if todos, ok := record["todos"].([]any); ok {
		truncated = truncateTodoActivityItems(todos) || truncated
	}
	if result, ok := record["result"].(map[string]any); ok {
		if todos, ok := result["todos"].([]any); ok {
			truncated = truncateTodoActivityItems(todos) || truncated
		}
	}
	if args, ok := record["args"].(map[string]any); ok {
		if todos, ok := args["todos"].([]any); ok {
			truncated = truncateTodoActivityItems(todos) || truncated
		}
	}
	if explanation, ok := record["explanation"].(string); ok {
		trimmed, hit := truncateByRunes(explanation, 500)
		record["explanation"] = trimmed
		truncated = truncated || hit
	}
	if truncated {
		record["truncated"] = true
	}
	return record, truncated
}

func normalizeSubagentsPayload(payload any) (any, bool) {
	normalized, _ := normalizeJSONCompatibleToolPayload(payload)
	record, ok := normalized.(map[string]any)
	if !ok || record == nil {
		return normalized, false
	}
	record = projectSubagentToolResult(record)
	truncated := truncateSubagentsPayloadRecord(record)
	if truncated {
		record["truncated"] = true
	}
	return record, truncated
}

func truncateSubagentsPayloadRecord(record map[string]any) bool {
	truncated := false
	for _, field := range []string{"last_message", "result", "objective", "waiting_prompt", "message", "details"} {
		value, ok := record[field].(string)
		if !ok {
			continue
		}
		trimmed, hit := truncateByRunes(value, 3000)
		record[field] = trimmed
		truncated = truncated || hit
	}
	for _, field := range []string{"items"} {
		for _, raw := range toAnySlice(record[field]) {
			nested, ok := raw.(map[string]any)
			if !ok || nested == nil {
				continue
			}
			truncated = truncateSubagentsPayloadRecord(nested) || truncated
		}
	}
	return truncated
}

func truncateTodoActivityItems(items []any) bool {
	truncated := false
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || item == nil {
			continue
		}
		for _, field := range []string{"id", "content", "note"} {
			value, ok := item[field].(string)
			if !ok {
				continue
			}
			limit := 240
			if field == "id" {
				limit = 80
			}
			trimmed, hit := truncateByRunes(value, limit)
			item[field] = trimmed
			truncated = truncated || hit
		}
	}
	return truncated
}

func normalizeFileMutationPayload(payload any) (any, bool) {
	normalized, _ := normalizeJSONCompatibleToolPayload(payload)
	record, ok := normalized.(map[string]any)
	if !ok || record == nil {
		return normalized, false
	}
	truncated := truncateFileMutationRecord(record)
	return record, truncated
}

func normalizeApplyPatchPayload(payload any) (any, bool) {
	normalized, _ := normalizeJSONCompatibleToolPayload(payload)
	record, ok := normalized.(map[string]any)
	if !ok || record == nil {
		return normalized, false
	}
	truncated := false
	if mutations, ok := record["mutations"].([]any); ok {
		for _, raw := range mutations {
			mutation, ok := raw.(map[string]any)
			if !ok || mutation == nil {
				continue
			}
			truncated = truncateFileMutationRecord(mutation) || truncated
		}
	}
	if truncated {
		record["truncated"] = true
	}
	return record, truncated
}

func truncateFileMutationRecord(record map[string]any) bool {
	truncated := false
	if diff, ok := record["unified_diff"].(string); ok {
		trimmed, hit := truncateByRunes(diff, maxMutationPatchRunes)
		record["unified_diff"] = trimmed
		truncated = truncated || hit
	}
	if truncated {
		record["truncated"] = true
	}
	return truncated
}

func truncateByRunes(in string, max int) (string, bool) {
	if max <= 0 {
		return "", in != ""
	}
	runes := []rune(in)
	if len(runes) <= max {
		return in, false
	}
	return string(runes[:max]), true
}

func subagentsToolInputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{
				"type": "string",
				"enum": []string{"spawn", "send_input", "wait", "list", "inspect", "close", "close_all"},
			},
			"task_name": map[string]any{
				"type":        "string",
				"maxLength":   140,
				"description": "Short human-facing English name with 1-5 Title Case words, for example Safety Review or API Contract Review. Never use snake_case or kebab-case.",
			},
			"title": map[string]any{
				"type":        "string",
				"maxLength":   140,
				"description": "Legacy alias for task_name. New spawn calls should use task_name.",
			},
			"task_description": map[string]any{"type": "string", "maxLength": 500},
			"message":          map[string]any{"type": "string", "maxLength": 4000},
			"objective":        map[string]any{"type": "string", "maxLength": 4000},
			"agent_type":       map[string]any{"type": "string", "enum": []string{"explore", "worker", "reviewer"}},
			"context_mode": map[string]any{
				"type":        "string",
				"enum":        []string{subagentContextModeMissionOnly, subagentContextModeFullHistory},
				"description": "Controls whether the child starts with only the delegated mission or the parent's full thread history.",
			},
			"ids": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
			"timeout_ms":   map[string]any{"type": "integer", "minimum": 10000, "maximum": 1200000},
			"target":       map[string]any{"type": "string"},
			"interrupt":    map[string]any{"type": "boolean"},
			"scope":        map[string]any{"type": "string", "enum": []string{"current_run"}},
			"running_only": map[string]any{"type": "boolean"},
			"limit":        map[string]any{"type": "integer", "minimum": 1, "maximum": 200},
		},
		"required":             []string{"action"},
		"additionalProperties": false,
	}
}

func toolSchemaRaw(m map[string]any) json.RawMessage {
	b, _ := json.Marshal(m)
	return b
}

func redevenAskUserSignalInputSchema(base map[string]any) map[string]any {
	schema := cloneAnyMap(base)
	schema["type"] = "object"
	schema["properties"] = map[string]any{
		"questions": map[string]any{
			"type":        "array",
			"minItems":    1,
			"maxItems":    5,
			"description": "Structured user-input questions. Each question must be fully specified with id, question, response_mode, and the required choice contract for that mode.",
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id":                 map[string]any{"type": "string", "minLength": 1, "maxLength": 80, "description": "Stable question id, for example question_1."},
					"header":             map[string]any{"type": "string", "minLength": 1, "maxLength": 120},
					"question":           map[string]any{"type": "string", "minLength": 1, "maxLength": 400},
					"is_secret":          map[string]any{"type": "boolean"},
					"response_mode":      map[string]any{"type": "string", "enum": []string{"select", "write", "select_or_write"}, "description": "select requires fixed choices and choices_exhaustive=true; write must omit choices; select_or_write requires fixed choices and choices_exhaustive=false."},
					"choices_exhaustive": map[string]any{"type": "boolean", "description": "Required when choices are present. true only for exhaustive select; false for select_or_write with a custom text answer."},
					"write_label":        map[string]any{"type": "string", "maxLength": 200, "description": "For select_or_write, the label for the custom text answer. For write, the direct input label."},
					"write_placeholder":  map[string]any{"type": "string", "maxLength": 160},
					"choices": map[string]any{
						"type":        "array",
						"maxItems":    4,
						"description": "Fixed select choices only. Do not include Other/None as a choice; use response_mode=select_or_write with choices_exhaustive=false when custom text is allowed.",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"choice_id":   map[string]any{"type": "string", "minLength": 1, "maxLength": 64},
								"label":       map[string]any{"type": "string", "minLength": 1, "maxLength": 200},
								"description": map[string]any{"type": "string", "maxLength": 240},
								"kind":        map[string]any{"type": "string", "enum": []string{"select"}, "description": "Fixed options must use kind=select."},
								"actions": map[string]any{
									"type":     "array",
									"maxItems": 4,
									"items": map[string]any{
										"type": "object",
										"properties": map[string]any{
											"type": map[string]any{"type": "string", "enum": []string{"open_subagent"}},
										},
										"required":             []string{"type"},
										"additionalProperties": false,
									},
								},
							},
							"required":             []string{"choice_id", "label", "kind"},
							"additionalProperties": false,
						},
					},
				},
				"required":             []string{"id", "header", "question", "is_secret", "response_mode"},
				"additionalProperties": false,
			},
		},
		"reason_code": map[string]any{
			"type": "string",
			"enum": []string{
				"user_decision_required",
				"permission_blocked",
				"missing_external_input",
				"conflicting_constraints",
				"safety_confirmation",
			},
		},
		"required_from_user": map[string]any{
			"type":     "array",
			"minItems": 1,
			"maxItems": 8,
			"items":    map[string]any{"type": "string", "maxLength": 200},
		},
		"evidence_refs": map[string]any{
			"type":     "array",
			"maxItems": 12,
			"items":    map[string]any{"type": "string", "maxLength": 120},
		},
	}
	schema["required"] = []string{"questions", "reason_code", "required_from_user", "evidence_refs"}
	schema["additionalProperties"] = false
	return schema
}

func builtInToolDefinitions() []ToolDef {
	toSchema := toolSchemaRaw
	targetIDProperty := map[string]any{"type": "string", "description": "Optional target id used only when this thread explicitly routes builtin tools through a target executor. Under the normal local-runtime policy this field does not make the tool run remotely."}
	withTargetID := func(properties map[string]any) map[string]any {
		out := make(map[string]any, len(properties)+1)
		for key, value := range properties {
			out[key] = value
		}
		out["target_id"] = targetIDProperty
		return out
	}
	defs := []ToolDef{
		{
			Name:             "file.read",
			Description:      "Read a project-scoped file from disk. Use this as the primary file inspection tool before editing.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"file_path": map[string]any{"type": "string", "description": "Path to the file to read. Relative paths resolve from the current working directory; absolute paths must still stay inside the active project root."}, "offset": map[string]any{"type": "integer", "minimum": 0, "description": "Optional 1-based starting line for partial reads."}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": maxFileReadLimit, "description": "Optional maximum number of lines to return for partial reads."}}), "required": []string{"file_path"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityReadonlyExclusive,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "read_file",
			Description:      "Safely read a project-scoped regular text file. Available only in readonly permission.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"path": map[string]any{"type": "string"}, "offset": map[string]any{"type": "integer", "minimum": 0}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": maxFileReadLimit}}, "required": []string{"path"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityReadonlyExclusive,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.readonly",
			Priority:         100,
		},
		{
			Name:             "read_files",
			Description:      "Safely read multiple project-scoped regular text files with per-file status. Available only in readonly permission.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"paths": map[string]any{"type": "array", "minItems": 1, "maxItems": 50, "items": map[string]any{"type": "string"}}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": maxFileReadLimit}}, "required": []string{"paths"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityReadonlyExclusive,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.readonly",
			Priority:         100,
		},
		{
			Name:             "rgrep",
			Description:      "Search project-scoped regular text files without shell execution. Available only in readonly permission.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "paths": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "glob": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "case_sensitive": map[string]any{"type": "boolean"}, "fixed_strings": map[string]any{"type": "boolean"}, "max_matches": map[string]any{"type": "integer", "minimum": 1, "maximum": 1000}, "context_lines": map[string]any{"type": "integer", "minimum": 0, "maximum": 10}}, "required": []string{"query"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityReadonlyExclusive,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.readonly",
			Priority:         100,
		},
		{
			Name:             "find",
			Description:      "Find project-scoped files and directories without shell execution. Available only in readonly permission.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"root": map[string]any{"type": "string"}, "name": map[string]any{"type": "string"}, "type": map[string]any{"type": "string", "enum": []string{"file", "dir", "directory", "symlink", "any"}}, "max_results": map[string]any{"type": "integer", "minimum": 1, "maximum": 1000}, "max_depth": map[string]any{"type": "integer", "minimum": 0, "maximum": 32}, "include_hidden": map[string]any{"type": "boolean"}}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityReadonlyExclusive,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.readonly",
			Priority:         100,
		},
		{
			Name:             "web_fetch",
			Description:      "Fetch a public HTTP(S) text page with SSRF protections. Available only in readonly permission.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"url": map[string]any{"type": "string"}, "format": map[string]any{"type": "string", "enum": []string{"markdown", "text"}}, "timeout_seconds": map[string]any{"type": "integer", "minimum": 1, "maximum": 120}}, "required": []string{"url"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityReadonlyExclusive,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyNetwork},
			Source:           "builtin",
			Namespace:        "builtin.readonly",
			Priority:         100,
		},
		{
			Name:             "file.edit",
			Description:      "Edit a project-scoped text file by replacing an exact old_string with new_string. Use this as the primary deterministic in-place editing tool.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"file_path": map[string]any{"type": "string", "description": "Path to the file to edit. Relative paths resolve from the current working directory; absolute paths must still stay inside the active project root."}, "old_string": map[string]any{"type": "string", "minLength": 1, "description": "Exact text to replace."}, "new_string": map[string]any{"type": "string", "description": "Replacement text. It must differ from old_string."}, "replace_all": map[string]any{"type": "boolean", "description": "Replace every occurrence instead of requiring a single exact match."}}), "required": []string{"file_path", "old_string", "new_string"}, "additionalProperties": false}),
			Mutating:         true,
			RequiresApproval: true,
			Visibility:       ToolVisibilityStandard,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityMutation},
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "file.write",
			Description:      "Write the full content of a project-scoped text file. Use this to create files or replace an entire file deterministically.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"file_path": map[string]any{"type": "string", "description": "Path to the file to write. Relative paths resolve from the current working directory; absolute paths must still stay inside the active project root."}, "content": map[string]any{"type": "string", "description": "Full file content to write."}}), "required": []string{"file_path", "content"}, "additionalProperties": false}),
			Mutating:         true,
			RequiresApproval: true,
			Visibility:       ToolVisibilityStandard,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityMutation},
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "apply_patch",
			Description:      "Apply a canonical patch to project-scoped files. Use ONLY the canonical Begin/End Patch format with relative paths. The patch must be one document from `*** Begin Patch` to `*** End Patch` using `*** Add File:`, `*** Delete File:`, `*** Update File:`, optional `*** Move to:`, and `@@` hunks. In `*** Add File:` bodies, every content line must start with `+`.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"patch": map[string]any{"type": "string", "description": "Entire patch text in canonical Begin/End Patch format. Start with `*** Begin Patch`, end with `*** End Patch`, use relative paths, and include file operations such as `*** Update File:` plus `@@` hunks. For `*** Add File: path`, every new content line must begin with `+`, for example `+hello`."}}), "required": []string{"patch"}, "additionalProperties": false}),
			Mutating:         true,
			RequiresApproval: true,
			Visibility:       ToolVisibilityStandard,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityMutation},
			Source:           "builtin",
			Namespace:        "builtin.text",
			Priority:         100,
		},
		{
			Name:             "terminal.exec",
			Description:      "Start a PTY-backed shell command in the local AI runtime. Defaults to the run working directory. It waits briefly for yield_ms, returns final output if the process exits, or returns a running process_id for terminal.read, terminal.write, and terminal.terminate. The initial wait is not a hard timeout; use terminal.terminate to stop a running process. Do not treat thread target context as remote execution.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"command": map[string]any{"type": "string"}, "stdin": map[string]any{"type": "string", "maxLength": 200000}, "cwd": map[string]any{"type": "string"}, "workdir": map[string]any{"type": "string"}, "yield_ms": map[string]any{"type": "integer", "minimum": 0, "maximum": 30000, "description": "Preferred initial wait in milliseconds before returning output or a running process_id. This is not a hard runtime timeout."}, "description": map[string]any{"type": "string", "maxLength": 200}}, "required": []string{"command"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityStandard,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityShell, ToolCapabilityOpenWorld},
			Source:           "builtin",
			Namespace:        "builtin.terminal",
			Priority:         100,
		},
		{
			Name:             "terminal.read",
			Description:      "Read the latest output from a running or completed terminal process started by terminal.exec. Every call must include a concise user-facing description in the user's language that names the command or task whose output is being checked. For later polls, naturally say that the latest output is being checked again. Do not use generic labels such as 'Terminal output'. Use the returned last_seq as the next after_seq with wait_ms to poll for new output.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"process_id": map[string]any{"type": "string"}, "description": map[string]any{"type": "string", "minLength": 1, "maxLength": terminalReadDescriptionMaxRunes, "description": "Concise user-facing text in the user's language naming the command or task whose output is being checked. For a later poll, say that its latest output is being checked again. Never use a generic label such as 'Terminal output'."}, "after_seq": map[string]any{"type": "integer", "minimum": 0}, "wait_ms": map[string]any{"type": "integer", "minimum": 0, "maximum": 30000}, "max_bytes": map[string]any{"type": "integer", "minimum": 1, "maximum": 1000000}}, "required": []string{"process_id", "description"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityStandard,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityShell},
			Source:           "builtin",
			Namespace:        "builtin.terminal",
			Priority:         100,
		},
		{
			Name:             "terminal.write",
			Description:      "Send input to a running terminal process started by terminal.exec. Include trailing newlines when the shell program expects Enter.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"process_id": map[string]any{"type": "string"}, "input": map[string]any{"type": "string", "maxLength": 200000}}, "required": []string{"process_id", "input"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityStandard,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityShell},
			Source:           "builtin",
			Namespace:        "builtin.terminal",
			Priority:         100,
		},
		{
			Name:             "terminal.terminate",
			Description:      "Terminate a running terminal process started by terminal.exec.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"process_id": map[string]any{"type": "string"}}, "required": []string{"process_id"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityStandard,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityShell},
			Source:           "builtin",
			Namespace:        "builtin.terminal",
			Priority:         100,
		},
		{
			Name:             "web.search",
			Description:      "Search the web for discovery and return sources (URLs) with titles/snippets. Prefer direct requests to authoritative sources via terminal.exec/curl; use this tool only when you need discovery.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "provider": map[string]any{"type": "string"}, "count": map[string]any{"type": "integer", "minimum": 1, "maximum": 10}, "timeout_ms": map[string]any{"type": "integer", "minimum": 1, "maximum": 60000}}, "required": []string{"query"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilitySharedReadonly,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyNetwork, ToolCapabilityOpenWorld},
			Source:           "builtin",
			Namespace:        "builtin.web",
			Priority:         100,
		},
		{
			Name:             "okf.index",
			Description:      "Browse the embedded Redeven OKF index as a structured directory of maintained repository knowledge. Use this before okf.search when the user asks broad Redeven-internal questions and you need to discover the available OKF areas. OKF covers Redeven-maintained architecture, protocols, runtime/Desktop/gateway behavior, Workbench contracts, release automation, AI tool/runtime contracts, and maintained OKF concepts. OKF does not access the internet and must not be used for current, recent, news, market/pricing, third-party documentation, external, or general web facts. Use okf.open after selecting a concept that needs detailed evidence.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"section": map[string]any{"type": "string", "description": "Optional index section title or slug to narrow the returned directory entries."}}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilitySharedReadonly,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.okf",
			Priority:         100,
		},
		{
			Name:             "okf.search",
			Description:      "Search the embedded Redeven OKF bundle and return a bounded short structured list of matching concepts. Use this to discover which OKF concepts may answer a Redeven-internal architecture, protocol, runtime, Desktop, gateway, Workbench, release, AI tool, or maintained OKF question. Start with max_results=3 for broad questions; raise it only when more candidates are needed. has_more means additional candidate concepts exist beyond the returned short list; it is progressive disclosure, not content truncation. This tool returns summaries only: call okf.open before relying on a concept for detailed facts, boundaries, contracts, or user-facing conclusions. OKF does not access the internet and must not be used for current, recent, news, market/pricing, third-party documentation, external, or general web facts. Source-level conclusions must still be verified with file or terminal tools.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string", "description": "Search terms for Redeven-maintained OKF concepts."}, "max_results": map[string]any{"type": "integer", "minimum": 1, "maximum": 8, "description": "Maximum concept matches to return. Defaults to 3; use 3 for broad questions."}, "type": map[string]any{"type": "string", "description": "Optional exact OKF concept type filter, for example Runtime Contract, Gateway Contract, UI Contract, AI Tool Contract, Release Contract."}, "tags": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Optional tag filters. A concept matches when it has at least one requested tag."}}, "required": []string{"query"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilitySharedReadonly,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.okf",
			Priority:         100,
		},
		{
			Name:             "okf.open",
			Description:      "Open one embedded Redeven OKF concept by concept_id or path and return detailed concept content plus OKF graph context. Use this after okf.index or okf.search when a concept is relevant and you need exact maintained repository knowledge, boundaries, contracts, or workflow details. Prefer opening the most relevant concept before making final claims based on OKF. OKF content is repository knowledge only; it does not access the internet, is not internet data, and does not replace source-code verification for implementation-level conclusions.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"concept_id": map[string]any{"type": "string", "description": "Concept id returned by okf.index or okf.search. Exactly one of concept_id or path is required."}, "path": map[string]any{"type": "string", "description": "OKF concept path such as ai/okf-search-tool.md. Exactly one of concept_id or path is required."}, "body_offset": map[string]any{"type": "integer", "minimum": 0, "description": "Optional rune offset into the concept body."}, "body_limit": map[string]any{"type": "integer", "minimum": 1000, "maximum": 20000, "description": "Optional maximum body runes to return. Defaults to 12000."}}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilitySharedReadonly,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.okf",
			Priority:         100,
		},
		{
			Name:             "write_todos",
			Description:      "Replace the current thread todo list snapshot for actionable work. Track work items only, not control signals such as task_complete or ask_user. Keep at most one in_progress item, avoid empty lists unless explicitly clearing prior todos, and use at least 3 todos when the user asks for explicit planning/task breakdown.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"todos": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "content": map[string]any{"type": "string"}, "status": map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed", "cancelled"}}, "note": map[string]any{"type": "string"}}, "required": []string{"content", "status"}, "additionalProperties": false}}, "expected_version": map[string]any{"type": "integer", "minimum": 0}, "explanation": map[string]any{"type": "string", "maxLength": 500}}, "required": []string{"todos"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityInteraction,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityInteraction},
			Source:           "builtin",
			Namespace:        "builtin.state",
			Priority:         100,
		},
		{
			Name:         "use_skill",
			Description:  "Load and activate a skill by name.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": "string"}, "reason": map[string]any{"type": "string"}}, "required": []string{"name"}, "additionalProperties": false}),
			Mutating:     false,
			Visibility:   ToolVisibilityStandard,
			Capabilities: []ToolCapabilityClass{ToolCapabilityOpenWorld},
			Source:       "builtin",
			Namespace:    "builtin.skill",
			Priority:     100,
		},
		{
			Name:         "subagents",
			Description:  "Manage parent-owned subagents. Use spawn with a short 1-5 word English Title Case task_name such as Safety Review, required task_description, agent_type, and message to start a durable child thread. Never use snake_case or kebab-case names. Use wait/list/inspect to observe children, send_input to steer or interrupt, and close/close_all to stop child threads.",
			InputSchema:  toSchema(subagentsToolInputSchema()),
			Mutating:     false,
			Visibility:   ToolVisibilityDelegationControl,
			Capabilities: []ToolCapabilityClass{ToolCapabilityDelegation},
			Source:       "builtin",
			Namespace:    "builtin.subagent",
			Priority:     100,
		},
	}
	for i := range defs {
		defs[i].Presentation = aitools.MustPresentationSpec(defs[i].Name)
	}
	return defs
}

func builtInControlSignalDefinitions() []ToolDef {
	toSchema := toolSchemaRaw
	defs := make([]ToolDef, 0, 2)
	for _, core := range flruntime.CoreControlDefinitions(true) {
		name := strings.TrimSpace(core.Name)
		description := strings.TrimSpace(core.Description)
		inputSchema := core.InputSchema
		switch name {
		case flruntime.CoreControlAskUser:
			description = "Ask user for required structured input when the next step depends on a user decision, external input, approval, or a guided interaction turn. Preserve explicit interaction-shape constraints from the user, such as asking for fixed options, clickable choices, one-question-at-a-time, or indirect questioning. Each question must declare response_mode. Choice-based questions must also declare choices_exhaustive: use select only when choices_exhaustive=true, write for direct free text, and select_or_write when choices_exhaustive=false and custom text is allowed. If the user asks for answer choices, do not downgrade the question into pure write mode. choices[] should contain fixed options only. Do not use it to delegate tool-collectable work. Include reason_code, required_from_user, and evidence_refs for explainable policy checks."
			inputSchema = redevenAskUserSignalInputSchema(core.InputSchema)
		case flruntime.CoreControlTaskComplete:
			description = "Optionally report a detailed result summary when explicitly useful. A normal assistant final answer can complete the task without this signal."
		}
		defs = append(defs, ToolDef{
			Name:         name,
			Description:  description,
			InputSchema:  toSchema(inputSchema),
			Mutating:     false,
			Visibility:   ToolVisibilityControl,
			Capabilities: []ToolCapabilityClass{ToolCapabilityInteraction},
			Source:       "floret",
			Namespace:    "floret.core_signal",
			Priority:     100,
		})
	}
	for i := range defs {
		defs[i].Presentation = aitools.MustPresentationSpec(defs[i].Name)
	}
	return defs
}

func builtInModelCapabilityDefinitions() []ToolDef {
	tools := builtInToolDefinitions()
	signals := builtInControlSignalDefinitions()
	out := make([]ToolDef, 0, len(tools)+len(signals))
	out = append(out, tools...)
	out = append(out, signals...)
	return out
}

func registerBuiltInTools(reg *InMemoryToolRegistry, r *run) error {
	if reg == nil {
		return fmt.Errorf("nil tool registry")
	}
	for _, def := range builtInToolDefinitions() {
		if def.Name == "web.search" && (r == nil || !r.webSearchToolEnabled) {
			continue
		}
		if !r.allowSubagentDelegate {
			switch def.Name {
			case "subagents":
				continue
			}
		}
		handler := ToolHandler(&builtInToolHandler{r: r, toolName: def.Name})
		if err := reg.Register(def, handler); err != nil {
			return err
		}
	}
	return nil
}
