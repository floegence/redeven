package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/v7/runtime"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

const terminalDescriptionMaxRunes = 120

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
	case "attachment.read", "image.read":
		return toolName
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

func (h *builtInToolHandler) Execute(ctx context.Context, call ToolCall) (result ToolResult, err error) {
	if h == nil || h.r == nil {
		return ToolResult{}, fmt.Errorf("tool handler unavailable")
	}
	toolName := strings.TrimSpace(call.Name)
	if toolName == "" {
		toolName = strings.TrimSpace(h.toolName)
	}
	defer func() {
		if strings.HasPrefix(toolName, "terminal.") {
			result.activityInput = terminalActivityInput(call.Args)
		} else {
			result.activityInput = cloneAnyMap(call.Args)
		}
	}()
	if h.activityUpdater != nil && (toolName == "terminal.read" || toolName == "terminal.write" || toolName == "terminal.terminate") {
		displayArgs := terminalActivityInput(call.Args)
		if proc, lookupErr := h.r.terminalProcessForTool(anyToString(call.Args["process_id"])); lookupErr == nil {
			displayArgs["command"] = proc.Snapshot().Command
		}
		h.activityUpdater(floretActivityForToolCall(toolName, displayArgs), nil)
	}
	outcome, err := h.r.handleToolCall(ctx, strings.TrimSpace(call.ID), toolName, cloneAnyMap(call.Args), h.activityUpdater)
	if err != nil {
		return ToolResult{}, err
	}
	if outcome != nil {
		defer func() { result.executionFacts = outcome.executionFacts }()
	}
	if outcome == nil {
		return ToolResult{ToolID: call.ID, ToolName: toolName, Status: toolResultStatusError, Summary: "Tool failed", Details: "empty tool outcome"}, nil
	}
	if outcome.Pending != nil {
		data, truncated := outcome.Result, isComputerUseTool(toolName) && computerSourceTruncated(outcome.Result)
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
		data, truncated := outcome.Result, isComputerUseTool(toolName) && computerSourceTruncated(outcome.Result)
		return ToolResult{
			ToolID:      strings.TrimSpace(call.ID),
			ToolName:    toolName,
			Status:      toolResultStatusSuccess,
			Summary:     toolSuccessSummary(toolName),
			Details:     "tool execution completed",
			Data:        data,
			Truncated:   truncated,
			Attachments: append([]ToolAttachment(nil), outcome.Attachments...),
		}, nil
	}
	if outcome.ToolError != nil {
		outcome.ToolError.Normalize()
	}
	status := toolResultStatusError
	summary := "Tool failed"
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
	data, truncated := outcome.Result, isComputerUseTool(toolName) && computerSourceTruncated(outcome.Result)
	return ToolResult{
		ToolID:                strings.TrimSpace(call.ID),
		ToolName:              toolName,
		Status:                status,
		Summary:               summary,
		Details:               details,
		Data:                  data,
		Truncated:             truncated,
		Attachments:           append([]ToolAttachment(nil), outcome.Attachments...),
		Error:                 outcome.ToolError,
		cancellationConfirmed: outcome.cancellationConfirmed,
		dispatchErr:           outcome.dispatchErr,
		effectUncertain:       outcome.effectUncertain,
		executionFacts:        outcome.executionFacts,
	}, nil
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

func normalizeTruncatedToolPayload(toolName string, payload any) (any, bool, error) {
	toolName = strings.TrimSpace(toolName)
	if isComputerUseTool(toolName) {
		return payload, false, nil
	}
	normalized, err := normalizeJSONCompatibleToolPayload(payload)
	if err != nil {
		return nil, false, err
	}
	payload = normalized
	switch toolName {
	case "terminal.exec", "terminal.read", "terminal.terminate":
		m, _ := payload.(map[string]any)
		if m == nil {
			return payload, false, nil
		}
		m = cloneAnyMap(m)
		truncated := false
		if output, ok := m["output"].(string); ok {
			limit := 4000
			if toolName == "terminal.read" {
				limit = terminalProcessModelReadBytes
			}
			trimmed, hit := truncateByRunes(output, limit)
			m["output"] = trimmed
			truncated = truncated || hit
		}
		if truncated {
			m["truncated"] = true
		}
		return m, truncated, nil
	case "attachment.read", "image.read":
		return payload, false, nil
	case "file.edit", "file.write":
		return normalizeFileMutationPayload(payload)
	case "apply_patch":
		return normalizeApplyPatchPayload(payload)
	case "write_todos":
		return normalizeTodosPayload(payload)
	case "subagents":
		return payload, false, nil
	case "report_to_parent", "subagent_events", "threads.query", "threads.read", "threads.aggregate", "okf.index", "okf.search", "okf.open", "rgrep", "find", "read_file", "read_files", "use_skill", "sources", "tessiven.runtimes", "tessiven.runtime.inspect", "tessiven.runtime.action", "tessiven.schema", "tessiven.list", "tessiven.read", "tessiven.search", "tessiven.versions", "tessiven.validate", "tessiven.save", "tessiven.edit":
		// These executors already bound their content. Keep the typed shape;
		// truncating an entire JSON object destroys every usable result field.
		return payload, false, nil
	default:
		if payload == nil {
			return nil, false, nil
		}
		b, err := json.Marshal(payload)
		if err != nil {
			return nil, false, err
		}
		trimmed, truncated := truncateByRunes(string(b), 4000)
		if truncated {
			return map[string]any{"raw": trimmed, "truncated": true}, true, nil
		}
		normalized, err := decodeToolJSON(b)
		if err != nil {
			return nil, false, err
		}
		return normalized, false, nil
	}
}

func decodeToolJSON(raw []byte) (any, error) {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func normalizeJSONCompatibleToolPayload(payload any) (any, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return decodeToolJSON(raw)
}

func normalizeTodosPayload(payload any) (any, bool, error) {
	normalized := payload
	record, ok := normalized.(map[string]any)
	if !ok || record == nil {
		return normalized, false, nil
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
	return record, truncated, nil
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

func normalizeFileMutationPayload(payload any) (any, bool, error) {
	normalized := payload
	record, ok := normalized.(map[string]any)
	if !ok || record == nil {
		return normalized, false, nil
	}
	truncated := truncateFileMutationRecord(record)
	return record, truncated, nil
}

func normalizeApplyPatchPayload(payload any) (any, bool, error) {
	normalized := payload
	record, ok := normalized.(map[string]any)
	if !ok || record == nil {
		return normalized, false, nil
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
	return record, truncated, nil
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
				"enum": []string{"spawn", "send_input", "wait", "list", "status", "inspect", "close", "close_all"},
			},
			"task_name": map[string]any{
				"type":        "string",
				"maxLength":   140,
				"description": "1-5 English Title Case words.",
			},
			"task_description": map[string]any{"type": "string", "maxLength": 500},
			"message":          map[string]any{"type": "string", "maxLength": 4000},
			"agent_type":       map[string]any{"type": "string", "enum": []string{"explore", "worker", "reviewer"}},
			"context_mode": map[string]any{
				"type": "string",
				"enum": []string{subagentContextModeMissionOnly, subagentContextModeFullHistory},
			},
			"ids": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
			"timeout_ms":   map[string]any{"type": "integer", "minimum": 10000, "maximum": 1200000},
			"target":       map[string]any{"type": "string"},
			"scope":        map[string]any{"type": "string", "enum": []string{"current_run"}},
			"running_only": map[string]any{"type": "boolean"},
			"limit":        map[string]any{"type": "integer", "minimum": 1, "maximum": 200},
		},
		"required":             []string{"action"},
		"additionalProperties": false,
	}
}

func toolSchemaRaw(m map[string]any) json.RawMessage {
	b, _ := json.Marshal(normalizeToolSchemaValue(m))
	return b
}

// normalizeToolSchemaValue is the single construction boundary for provider
// tool schemas. JSON Schema's required keyword is an array when present; a
// nil Go slice must never become JSON null in a provider request.
func normalizeToolSchemaValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, item := range typed {
			if key == "required" && isNilToolSchemaValue(item) {
				out[key] = []string{}
				continue
			}
			out[key] = normalizeToolSchemaValue(item)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, item := range typed {
			out[i] = normalizeToolSchemaValue(item)
		}
		return out
	default:
		return value
	}
}

func isNilToolSchemaValue(value any) bool {
	if value == nil {
		return true
	}
	switch typed := value.(type) {
	case []string:
		return typed == nil
	case []any:
		return typed == nil
	default:
		return false
	}
}

func redevenAskUserSignalInputSchema(base map[string]any) map[string]any {
	schema := cloneAnyMap(base)
	schema["type"] = "object"
	schema["properties"] = map[string]any{
		"questions": map[string]any{
			"type":     "array",
			"minItems": 1,
			"maxItems": 5,
			"items": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"id":                 map[string]any{"type": "string", "minLength": 1, "maxLength": 80},
					"header":             map[string]any{"type": "string", "minLength": 1, "maxLength": 120},
					"question":           map[string]any{"type": "string", "minLength": 1, "maxLength": 400},
					"is_secret":          map[string]any{"type": "boolean"},
					"response_mode":      map[string]any{"type": "string", "enum": []string{"select", "write", "select_or_write"}, "description": "select requires fixed choices and choices_exhaustive=true; write must omit choices; select_or_write requires fixed choices and choices_exhaustive=false."},
					"choices_exhaustive": map[string]any{"type": "boolean", "description": "Required with choices; true for select, false for select_or_write."},
					"write_label":        map[string]any{"type": "string", "maxLength": 200, "description": "Custom/direct text input label."},
					"write_placeholder":  map[string]any{"type": "string", "maxLength": 160},
					"choices": map[string]any{
						"type":        "array",
						"maxItems":    4,
						"description": "Fixed choices; custom text uses select_or_write instead of an Other choice.",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"choice_id":   map[string]any{"type": "string", "minLength": 1, "maxLength": 64},
								"label":       map[string]any{"type": "string", "minLength": 1, "maxLength": 200},
								"description": map[string]any{"type": "string", "maxLength": 240},
								"kind":        map[string]any{"type": "string", "enum": []string{"select"}},
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
			"type":        "array",
			"description": "Actual blocking tool call IDs, or an empty array when there is no tool evidence.",
			"maxItems":    12,
			"items":       map[string]any{"type": "string", "maxLength": 120},
		},
	}
	schema["required"] = []string{"questions", "reason_code", "required_from_user", "evidence_refs"}
	schema["additionalProperties"] = false
	return schema
}

func builtInToolDefinitions() []ToolDef {
	toSchema := toolSchemaRaw
	targetIDProperty := map[string]any{"type": "string", "description": "Used only when this thread explicitly routes tools to a target executor; otherwise execution is local."}
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
			Name:             "attachment.read",
			Description:      "Read a UTF-8 thread attachment by manifest locator. Continue with next_cursor while truncated.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"locator": map[string]any{"type": "string", "minLength": 1, "maxLength": 1024}, "cursor": map[string]any{"type": "string", "maxLength": 2048}, "max_bytes": map[string]any{"type": "integer", "minimum": 1}, "max_lines": map[string]any{"type": "integer", "minimum": 1}}, "required": []string{"locator"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilitySharedReadonly,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.attachment",
			Priority:         100,
		},
		{
			Name:         "image.read",
			Description:  "Inspect a PNG, JPEG, WebP or first GIF frame. Supply exactly one of file_path or a media:v1 locator. Locator reads return the original thread snapshot and reject target_id.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"locator": map[string]any{"type": "string", "pattern": "^media:v1:[a-f0-9]{64}$", "description": "Snapshot locator from threads.read or compaction."}, "file_path": map[string]any{"type": "string", "minLength": 1, "description": "Working-directory-relative or authorized absolute image path."}}), "additionalProperties": false}),
			Visibility:   ToolVisibilitySharedReadonly,
			Capabilities: []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:       "builtin", Namespace: "builtin.image", Priority: 100,
		},
		{
			Name:             "read_file",
			Description:      "Read a regular text file.",
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
			Description:      "Read multiple text files with per-file status.",
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
			Description:      "Search text files without a shell.",
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
			Description:      "Find files and directories without a shell.",
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
			Name:             "file.edit",
			Description:      "Replace exact text in a file; requires a unique match unless replace_all.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"file_path": map[string]any{"type": "string", "description": "Working-directory-relative or authorized absolute path."}, "old_string": map[string]any{"type": "string", "minLength": 1}, "new_string": map[string]any{"type": "string", "description": "Must differ from old_string."}, "replace_all": map[string]any{"type": "boolean"}}), "required": []string{"file_path", "old_string", "new_string"}, "additionalProperties": false}),
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
			Description:      "Create or overwrite a text file with its full content.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"file_path": map[string]any{"type": "string", "description": "Working-directory-relative or authorized absolute path."}, "content": map[string]any{"type": "string"}}), "required": []string{"file_path", "content"}, "additionalProperties": false}),
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
			Description:      "Apply a Begin/End Patch document. Relative paths cannot escape the run working directory.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"patch": map[string]any{"type": "string", "description": "*** Begin Patch / *** End Patch envelope; relative paths in *** Add File:, *** Delete File:, *** Update File:, optional *** Move to:, and @@ hunks. Prefix added lines with +."}}), "required": []string{"patch"}, "additionalProperties": false}),
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
			Description:      "Run a PTY shell locally; defaults to the run working directory. Returns exit_code or a running process_id for terminal.read/write/terminate.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"command": map[string]any{"type": "string"}, "stdin": map[string]any{"type": "string", "maxLength": 200000, "description": "Interactive PTY input; does not close stdin or send EOF. Echo alone is not command completion."}, "cwd": map[string]any{"type": "string"}, "workdir": map[string]any{"type": "string"}, "yield_ms": map[string]any{"type": "integer", "minimum": 0, "maximum": 30000, "description": "Initial wait, not a runtime timeout."}, "description": map[string]any{"type": "string", "maxLength": 200}}, "required": []string{"command"}, "additionalProperties": false}),
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
			Description:      "Read new output after after_seq. If has_more, read again; status=running remains active even with empty output.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"process_id": map[string]any{"type": "string"}, "description": map[string]any{"type": "string", "minLength": 1, "maxLength": terminalDescriptionMaxRunes, "description": "User-facing command/task description in the user's language."}, "after_seq": map[string]any{"type": "integer", "minimum": 0, "description": "0 for the first read; then the previous result's last_seq unchanged."}}, "required": []string{"process_id", "description", "after_seq"}, "additionalProperties": false}),
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
			Description:      "Send PTY input; include a trailing newline to submit a line.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"process_id": map[string]any{"type": "string"}, "input": map[string]any{"type": "string", "maxLength": 200000}, "description": map[string]any{"type": "string", "minLength": 1, "maxLength": terminalDescriptionMaxRunes, "description": "User-facing intent in the user's language; omit input values and secrets."}}, "required": []string{"process_id", "input", "description"}, "additionalProperties": false}),
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
			Description:      "Terminate a terminal process.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"process_id": map[string]any{"type": "string"}, "description": map[string]any{"type": "string", "minLength": 1, "maxLength": terminalDescriptionMaxRunes, "description": "User-facing command/task being stopped, in the user's language."}}, "required": []string{"process_id", "description"}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilityStandard,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityShell},
			Source:           "builtin",
			Namespace:        "builtin.terminal",
			Priority:         100,
		},
		{
			Name:             "okf.index",
			Description:      "Browse the embedded Redeven repository knowledge index.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"section": map[string]any{"type": "string", "description": "Section title or slug."}}, "additionalProperties": false}),
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
			Description:      "Search embedded Redeven knowledge. Returns candidate summaries and snippets; open a concept with okf.open for details. has_more indicates additional candidates.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "max_results": map[string]any{"type": "integer", "minimum": 1, "maximum": 8, "description": "Default 3."}, "type": map[string]any{"type": "string", "description": "Exact concept type filter."}, "tags": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Matches any requested tag."}}, "required": []string{"query"}, "additionalProperties": false}),
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
			Description:      "Open exactly one concept_id or path. Omit section for Summary and the section catalog; otherwise read that section.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"concept_id": map[string]any{"type": "string", "description": "ID from okf.index/search."}, "path": map[string]any{"type": "string", "description": "OKF concept path."}, "section": map[string]any{"type": "string", "description": "Section id or title."}, "include_evidence": map[string]any{"type": "boolean", "description": "Include structured Evidence references."}, "body_offset": map[string]any{"type": "integer", "minimum": 0, "description": "Rune offset into the section."}, "body_limit": map[string]any{"type": "integer", "minimum": 1000, "maximum": 20000, "description": "Maximum section runes; default 12000."}}, "additionalProperties": false}),
			Mutating:         false,
			RequiresApproval: false,
			Visibility:       ToolVisibilitySharedReadonly,
			Capabilities:     []ToolCapabilityClass{ToolCapabilityReadonlyLocal},
			Source:           "builtin",
			Namespace:        "builtin.okf",
			Priority:         100,
		},
		{
			Name:         "use_skill",
			Description:  "Read current skill instructions by name and record activation. Repeated calls return the full body.",
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
			Description:  "Manage this thread's direct children; inherited history does not transfer ownership. spawn requires task_name, task_description, agent_type and message. list discovers children; status requires target or ids (at most 200) and returns metadata only. inspect/wait return full reports in handoffs[].content and failures in items[].failure. send_input guides children; close/close_all stops them.",
			InputSchema:  toSchema(subagentsToolInputSchema()),
			Mutating:     false,
			Visibility:   ToolVisibilityDelegationControl,
			Capabilities: []ToolCapabilityClass{ToolCapabilityDelegation},
			Source:       "builtin",
			Namespace:    "builtin.subagent",
			Priority:     100,
		},
	}
	defs = append(defs, builtInTessivenToolDefinitions()...)
	defs = append(defs, builtInThreadQueryToolDefinitions()...)
	defs = append(defs, builtInParentEventToolDefinitions()...)
	defs = append(defs, builtInComputerToolDefinitions()...)
	defs = append(defs, floretNativeToolDefinitions()...)
	for i := range defs {
		defs[i].Strict = true
		defs[i].Presentation = aitools.MustPresentationSpec(defs[i].Name)
	}
	return defs
}

func builtInControlSignalDefinitions() []ToolDef {
	toSchema := toolSchemaRaw
	defs := make([]ToolDef, 0, 1)
	for _, core := range flruntime.CoreControlDefinitions() {
		name := strings.TrimSpace(core.Name)
		inputSchema := core.InputSchema
		switch name {
		case flruntime.CoreControlAskUser:
			inputSchema = redevenAskUserSignalInputSchema(core.InputSchema)
		}
		defs = append(defs, ToolDef{
			Name:         name,
			Description:  strings.TrimSpace(core.Description),
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
		defs[i].Strict = true
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

func registerBuiltInTools(reg *InMemoryToolRegistry, r *run, webBindings ...map[string]webToolBinding) error {
	if reg == nil {
		return fmt.Errorf("nil tool registry")
	}
	for _, def := range builtInToolDefinitions() {
		if def.Name == "report_to_parent" && (r == nil || r.subagentDepth == 0) {
			continue
		}
		if isComputerUseToolName(def.Name) && r != nil && r.cfg != nil && !r.cfg.IsComputerUseEnabled() {
			continue
		}
		if def.Name == "attachment.read" && (r == nil || r.host.openLiveAttachment == nil || !r.attachmentToolReadEnabled) {
			continue
		}
		if isFloretNativeTool(def.Name) && len(webBindings) > 0 {
			binding, ok := webBindings[0][def.Name]
			if !ok {
				continue
			}
			def = nativeWebToolDefinition(def.Name, binding)
		} else if def.Name == "web.search" && (r == nil || !r.webSearch.LocalTool()) {
			continue
		}
		if !r.allowSubagentDelegate {
			switch def.Name {
			case "subagents":
				continue
			}
		}
		if err := reg.Register(def); err != nil {
			return err
		}
	}
	return nil
}
