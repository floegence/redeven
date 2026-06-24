package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	flruntime "github.com/floegence/floret/runtime"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

type builtInToolHandler struct {
	r        *run
	toolName string
}

func toolSuccessSummary(toolName string) string {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return "terminal.exec"
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
	case "okf.search":
		return "okf.knowledge.lookup"
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
	outcome, err := h.r.handleToolCall(ctx, strings.TrimSpace(call.ID), toolName, cloneAnyMap(call.Args))
	if err != nil {
		return ToolResult{}, err
	}
	if outcome == nil {
		return ToolResult{ToolID: call.ID, ToolName: toolName, Status: toolResultStatusError, Summary: "tool.error", Details: "empty tool outcome"}, nil
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
	record = scrubSubagentForbiddenFields(record)
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
	for _, field := range []string{"snapshot", "subagent", "item"} {
		if nested, ok := record[field].(map[string]any); ok && nested != nil {
			truncated = truncateSubagentsPayloadRecord(nested) || truncated
		}
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
			"task_name":  map[string]any{"type": "string", "maxLength": 140},
			"title":      map[string]any{"type": "string", "maxLength": 140},
			"message":    map[string]any{"type": "string", "maxLength": 4000},
			"objective":  map[string]any{"type": "string", "maxLength": 4000},
			"agent_type": map[string]any{"type": "string", "enum": []string{"explore", "worker", "reviewer"}},
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
											"type": map[string]any{"type": "string", "enum": []string{"set_mode"}},
											"mode": map[string]any{"type": "string", "enum": []string{"act", "plan"}},
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
			ParallelSafe:     true,
			Mutating:         false,
			RequiresApproval: false,
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "file.edit",
			Description:      "Edit a project-scoped text file by replacing an exact old_string with new_string. Use this as the primary deterministic in-place editing tool.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"file_path": map[string]any{"type": "string", "description": "Path to the file to edit. Relative paths resolve from the current working directory; absolute paths must still stay inside the active project root."}, "old_string": map[string]any{"type": "string", "minLength": 1, "description": "Exact text to replace."}, "new_string": map[string]any{"type": "string", "description": "Replacement text. It must differ from old_string."}, "replace_all": map[string]any{"type": "boolean", "description": "Replace every occurrence instead of requiring a single exact match."}}), "required": []string{"file_path", "old_string", "new_string"}, "additionalProperties": false}),
			ParallelSafe:     false,
			Mutating:         true,
			RequiresApproval: true,
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "file.write",
			Description:      "Write the full content of a project-scoped text file. Use this to create files or replace an entire file deterministically.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"file_path": map[string]any{"type": "string", "description": "Path to the file to write. Relative paths resolve from the current working directory; absolute paths must still stay inside the active project root."}, "content": map[string]any{"type": "string", "description": "Full file content to write."}}), "required": []string{"file_path", "content"}, "additionalProperties": false}),
			ParallelSafe:     false,
			Mutating:         true,
			RequiresApproval: true,
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "apply_patch",
			Description:      "Apply a canonical patch to project-scoped files. Use ONLY the canonical Begin/End Patch format with relative paths. The patch must be one document from `*** Begin Patch` to `*** End Patch` using `*** Add File:`, `*** Delete File:`, `*** Update File:`, optional `*** Move to:`, and `@@` hunks. In `*** Add File:` bodies, every content line must start with `+`.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"patch": map[string]any{"type": "string", "description": "Entire patch text in canonical Begin/End Patch format. Start with `*** Begin Patch`, end with `*** End Patch`, use relative paths, and include file operations such as `*** Update File:` plus `@@` hunks. For `*** Add File: path`, every new content line must begin with `+`, for example `+hello`."}}), "required": []string{"patch"}, "additionalProperties": false}),
			ParallelSafe:     false,
			Mutating:         true,
			RequiresApproval: true,
			Source:           "builtin",
			Namespace:        "builtin.text",
			Priority:         100,
		},
		{
			Name:             "terminal.exec",
			Description:      "Execute a shell command in the local AI runtime. Defaults to the run working directory. Do not treat thread target context as remote execution; remote or target execution must come from explicit target tool/result provenance. When timeout_ms is omitted, the runtime applies a 2-minute default timeout; any requested timeout is capped at 10 minutes.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": withTargetID(map[string]any{"command": map[string]any{"type": "string"}, "stdin": map[string]any{"type": "string", "maxLength": 200000}, "cwd": map[string]any{"type": "string"}, "workdir": map[string]any{"type": "string"}, "timeout_ms": map[string]any{"type": "integer", "minimum": 1, "maximum": 600000}, "description": map[string]any{"type": "string", "maxLength": 200}}), "required": []string{"command"}, "additionalProperties": false}),
			ParallelSafe:     false,
			Mutating:         false,
			RequiresApproval: false,
			Source:           "builtin",
			Namespace:        "builtin.terminal",
			Priority:         100,
		},
		{
			Name:             "web.search",
			Description:      "Search the web for discovery and return sources (URLs) with titles/snippets. Prefer direct requests to authoritative sources via terminal.exec/curl; use this tool only when you need discovery.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "provider": map[string]any{"type": "string"}, "count": map[string]any{"type": "integer", "minimum": 1, "maximum": 10}, "timeout_ms": map[string]any{"type": "integer", "minimum": 1, "maximum": 60000}}, "required": []string{"query"}, "additionalProperties": false}),
			ParallelSafe:     true,
			Mutating:         false,
			RequiresApproval: false,
			Source:           "builtin",
			Namespace:        "builtin.web",
			Priority:         100,
		},
		{
			Name:             "okf.search",
			Description:      "Look up embedded Redeven repository knowledge from the OKF bundle and return scoped concept summaries. Use only for Redeven-internal architecture, protocol, runtime, Desktop, gateway, Workbench, release, and maintained OKF concepts. OKF does not access the internet and must not be used for current, recent, news, market/prices, third-party documentation, external, or general web facts.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "max_results": map[string]any{"type": "integer", "minimum": 1, "maximum": 8}, "tags": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}, "required": []string{"query"}, "additionalProperties": false}),
			ParallelSafe:     true,
			Mutating:         false,
			RequiresApproval: false,
			Source:           "builtin",
			Namespace:        "builtin.okf",
			Priority:         100,
		},
		{
			Name:             "write_todos",
			Description:      "Replace the current thread todo list snapshot for actionable work. Track work items only, not control signals such as task_complete, ask_user, or exit_plan_mode. Keep at most one in_progress item, avoid empty lists unless explicitly clearing prior todos, and use at least 3 todos when the user asks for explicit planning/task breakdown.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"todos": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "content": map[string]any{"type": "string"}, "status": map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed", "cancelled"}}, "note": map[string]any{"type": "string"}}, "required": []string{"content", "status"}, "additionalProperties": false}}, "expected_version": map[string]any{"type": "integer", "minimum": 0}, "explanation": map[string]any{"type": "string", "maxLength": 500}}, "required": []string{"todos"}, "additionalProperties": false}),
			ParallelSafe:     true,
			Mutating:         false,
			RequiresApproval: false,
			Source:           "builtin",
			Namespace:        "builtin.state",
			Priority:         100,
		},
		{
			Name:         "use_skill",
			Description:  "Load and activate a skill by name.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"name": map[string]any{"type": "string"}, "reason": map[string]any{"type": "string"}}, "required": []string{"name"}, "additionalProperties": false}),
			ParallelSafe: true,
			Mutating:     false,
			Source:       "builtin",
			Namespace:    "builtin.skill",
			Priority:     100,
		},
		{
			Name:         "subagents",
			Description:  "Manage parent-owned subagents. Use spawn with agent_type and message to start a durable child thread, wait/list/inspect to observe it, send_input to steer or interrupt, and close/close_all to stop child threads.",
			InputSchema:  toSchema(subagentsToolInputSchema()),
			ParallelSafe: true,
			Mutating:     false,
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
	defs := make([]ToolDef, 0, 3)
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
			ParallelSafe: true,
			Mutating:     false,
			Source:       "floret",
			Namespace:    "floret.core_signal",
			Priority:     100,
		})
	}
	defs = append(defs, ToolDef{
		Name:         "exit_plan_mode",
		Description:  "Request a deterministic switch prompt from plan mode into act mode when execution is needed. Use this instead of constructing a manual mode-switch ask_user payload.",
		InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"summary": map[string]any{"type": "string", "maxLength": 500, "description": "Short explanation of why act mode is needed."}, "allowed_prompts": map[string]any{"type": "array", "maxItems": 8, "items": map[string]any{"type": "object", "properties": map[string]any{"tool": map[string]any{"type": "string", "maxLength": 80}, "prompt": map[string]any{"type": "string", "maxLength": 240}}, "required": []string{"tool", "prompt"}, "additionalProperties": false}}}, "additionalProperties": false}),
		ParallelSafe: true,
		Mutating:     false,
		Source:       "builtin",
		Namespace:    "builtin.signal",
		Priority:     100,
	})
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
