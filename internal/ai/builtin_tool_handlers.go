package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

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
	case "exit_plan_mode":
		return "plan.exit.requested"
	case "web.search":
		return "web.search"
	case "knowledge.search":
		return "knowledge.search"
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

type signalToolHandler struct{}

func (h signalToolHandler) Validate(_ context.Context, call ToolCall) error {
	if strings.TrimSpace(call.Name) == "" {
		return fmt.Errorf("missing signal tool name")
	}
	return nil
}

func (h signalToolHandler) Execute(_ context.Context, call ToolCall) (ToolResult, error) {
	return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusSuccess, Summary: "signal.accepted", Data: cloneAnyMap(call.Args)}, nil
}

func (h signalToolHandler) HandlePartial(_ context.Context, _ PartialToolCall) error {
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
				"enum": []string{"create", "wait", "list", "inspect", "steer", "terminate", "terminate_all"},
			},
			"title":          map[string]any{"type": "string", "maxLength": 140},
			"objective":      map[string]any{"type": "string", "minLength": 1},
			"agent_type":     map[string]any{"type": "string", "enum": []string{"explore", "worker", "reviewer"}},
			"trigger_reason": map[string]any{"type": "string", "minLength": 1},
			"context_mode": map[string]any{
				"type": "string",
				"enum": []string{"isolated", "minimal_pack", "thread_compact", "thread_full"},
			},
			"inputs": map[string]any{
				"type": "array",
				"items": map[string]any{
					"oneOf": []any{
						map[string]any{"type": "string"},
						map[string]any{
							"type": "object",
							"properties": map[string]any{
								"kind":   map[string]any{"type": "string"},
								"value":  map[string]any{"type": "string"},
								"source": map[string]any{"type": "string"},
							},
							"required":             []string{"value"},
							"additionalProperties": false,
						},
					},
				},
			},
			"deliverables": map[string]any{
				"type":     "array",
				"minItems": 1,
				"items":    map[string]any{"type": "string", "minLength": 1},
			},
			"definition_of_done": map[string]any{
				"type":     "array",
				"minItems": 1,
				"items":    map[string]any{"type": "string", "minLength": 1},
			},
			"output_schema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"type": map[string]any{
						"type": "string",
						"enum": []string{"object"},
					},
					"required": map[string]any{
						"type":     "array",
						"minItems": 1,
						"items":    map[string]any{"type": "string", "minLength": 1},
					},
					"properties": map[string]any{
						"type":                 "object",
						"additionalProperties": false,
						"patternProperties": map[string]any{
							"^.{1,120}$": map[string]any{
								"type": "object",
								"properties": map[string]any{
									"type": map[string]any{
										"type": "string",
										"enum": []string{"string", "number", "integer", "boolean", "array", "object"},
									},
									"description": map[string]any{"type": "string", "maxLength": 400},
									"enum": map[string]any{
										"type":     "array",
										"items":    map[string]any{"type": "string"},
										"minItems": 1,
									},
									"items": map[string]any{
										"type":                 "object",
										"additionalProperties": false,
										"properties": map[string]any{
											"type": map[string]any{
												"type": "string",
												"enum": []string{"string", "number", "integer", "boolean", "array", "object"},
											},
											"description": map[string]any{"type": "string", "maxLength": 400},
										},
									},
								},
								"required":             []string{"type"},
								"additionalProperties": false,
							},
						},
					},
					"additionalProperties": map[string]any{"type": "boolean"},
				},
				"required":             []string{"type", "required", "properties"},
				"additionalProperties": false,
			},
			"mode": map[string]any{"type": "string"},
			"allowed_tools": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
			"budget": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"max_steps":   map[string]any{"type": "integer", "minimum": 1},
					"timeout_sec": map[string]any{"type": "integer", "minimum": 1},
				},
				"additionalProperties": false,
			},
			"ids": map[string]any{
				"type":  "array",
				"items": map[string]any{"type": "string"},
			},
			"timeout_ms":   map[string]any{"type": "integer", "minimum": 10000, "maximum": 300000},
			"target":       map[string]any{"type": "string"},
			"message":      map[string]any{"type": "string", "maxLength": 4000},
			"interrupt":    map[string]any{"type": "boolean"},
			"scope":        map[string]any{"type": "string", "enum": []string{"current_run"}},
			"running_only": map[string]any{"type": "boolean"},
			"limit":        map[string]any{"type": "integer", "minimum": 1, "maximum": 200},
		},
		"required":             []string{"action"},
		"additionalProperties": false,
	}
}

func askUserToolInputSchema() map[string]any {
	questionBase := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"id":                 map[string]any{"type": "string", "maxLength": 80},
			"header":             map[string]any{"type": "string", "minLength": 1, "maxLength": 120},
			"question":           map[string]any{"type": "string", "minLength": 1, "maxLength": 400},
			"is_secret":          map[string]any{"type": "boolean"},
			"response_mode":      map[string]any{"type": "string", "enum": []string{"select", "write", "select_or_write"}},
			"choices_exhaustive": map[string]any{"type": "boolean", "description": "For choice-based questions, true means the fixed choices are genuinely exhaustive; false means the user may need a typed fallback beyond the listed choices."},
			"write_label":        map[string]any{"type": "string", "maxLength": 200, "description": "For select_or_write, this is the standardized typed fallback label such as None of the above. For write, it can label the direct input."},
			"write_placeholder":  map[string]any{"type": "string", "maxLength": 160},
			"choices": map[string]any{
				"type":     "array",
				"maxItems": 4,
				"items": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"choice_id":   map[string]any{"type": "string", "maxLength": 64},
						"label":       map[string]any{"type": "string", "maxLength": 200},
						"description": map[string]any{"type": "string", "maxLength": 240},
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
					"required":             []string{"choice_id", "label"},
					"additionalProperties": false,
				},
			},
		},
		"required":             []string{"id", "header", "question", "is_secret", "response_mode"},
		"additionalProperties": false,
	}
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"questions": map[string]any{
				"type":     "array",
				"minItems": 1,
				"maxItems": 5,
				"items": map[string]any{
					"allOf": []any{
						questionBase,
						map[string]any{
							"oneOf": []any{
								map[string]any{
									"properties": map[string]any{
										"response_mode":      map[string]any{"const": "select"},
										"choices_exhaustive": map[string]any{"const": true},
										"choices":            map[string]any{"type": "array", "minItems": 1, "maxItems": 4},
									},
									"required": []string{"choices", "choices_exhaustive"},
								},
								map[string]any{
									"properties": map[string]any{
										"response_mode": map[string]any{"const": "write"},
									},
								},
								map[string]any{
									"properties": map[string]any{
										"response_mode":      map[string]any{"const": "select_or_write"},
										"choices_exhaustive": map[string]any{"const": false},
										"choices":            map[string]any{"type": "array", "minItems": 1, "maxItems": 4},
									},
									"required": []string{"choices", "choices_exhaustive"},
								},
							},
						},
					},
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
		},
		"required":             []string{"questions", "reason_code", "required_from_user", "evidence_refs"},
		"additionalProperties": false,
	}
}

func builtInToolDefinitions() []ToolDef {
	toSchema := func(m map[string]any) json.RawMessage {
		b, _ := json.Marshal(m)
		return b
	}
	defs := []ToolDef{
		{
			Name:             "file.read",
			Description:      "Read a workspace-scoped file from disk. Use this as the primary file inspection tool before editing.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"file_path": map[string]any{"type": "string", "description": "Path to the file to read. Relative paths resolve from the current working directory; absolute paths must stay within the runtime home."}, "offset": map[string]any{"type": "integer", "minimum": 0, "description": "Optional 1-based starting line for partial reads."}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": maxFileReadLimit, "description": "Optional maximum number of lines to return for partial reads."}}, "required": []string{"file_path"}, "additionalProperties": false}),
			ParallelSafe:     true,
			Mutating:         false,
			RequiresApproval: false,
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "file.edit",
			Description:      "Edit a workspace-scoped text file by replacing an exact old_string with new_string. Use this as the primary deterministic in-place editing tool.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"file_path": map[string]any{"type": "string", "description": "Path to the file to edit. Relative paths resolve from the current working directory; absolute paths must stay within the runtime home."}, "old_string": map[string]any{"type": "string", "minLength": 1, "description": "Exact text to replace."}, "new_string": map[string]any{"type": "string", "description": "Replacement text. It must differ from old_string."}, "replace_all": map[string]any{"type": "boolean", "description": "Replace every occurrence instead of requiring a single exact match."}}, "required": []string{"file_path", "old_string", "new_string"}, "additionalProperties": false}),
			ParallelSafe:     false,
			Mutating:         true,
			RequiresApproval: true,
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "file.write",
			Description:      "Write the full content of a workspace-scoped text file. Use this to create files or replace an entire file deterministically.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"file_path": map[string]any{"type": "string", "description": "Path to the file to write. Relative paths resolve from the current working directory; absolute paths must stay within the runtime home."}, "content": map[string]any{"type": "string", "description": "Full file content to write."}}, "required": []string{"file_path", "content"}, "additionalProperties": false}),
			ParallelSafe:     false,
			Mutating:         true,
			RequiresApproval: true,
			Source:           "builtin",
			Namespace:        "builtin.file",
			Priority:         100,
		},
		{
			Name:             "apply_patch",
			Description:      "Apply a patch to files on the local machine. This is a compatibility editing tool; prefer file.edit or file.write for normal changes. Use ONLY the canonical Begin/End Patch format with relative paths. The patch must be one document from `*** Begin Patch` to `*** End Patch` using `*** Add File:`, `*** Delete File:`, `*** Update File:`, optional `*** Move to:`, and `@@` hunks.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"patch": map[string]any{"type": "string", "description": "Entire patch text in canonical Begin/End Patch format. Start with `*** Begin Patch`, end with `*** End Patch`, use relative paths, and include file operations such as `*** Update File:` plus `@@` hunks."}}, "required": []string{"patch"}, "additionalProperties": false}),
			ParallelSafe:     false,
			Mutating:         true,
			RequiresApproval: true,
			Source:           "builtin",
			Namespace:        "builtin.text",
			Priority:         100,
		},
		{
			Name:             "terminal.exec",
			Description:      "Execute a shell command on the local machine. Defaults to the run working directory, but you may set cwd/workdir or use absolute paths to operate outside the workspace when needed.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"command": map[string]any{"type": "string"}, "stdin": map[string]any{"type": "string", "maxLength": 200000}, "cwd": map[string]any{"type": "string"}, "workdir": map[string]any{"type": "string"}, "timeout_ms": map[string]any{"type": "integer", "minimum": 1, "maximum": 1800000}, "description": map[string]any{"type": "string", "maxLength": 200}}, "required": []string{"command"}, "additionalProperties": false}),
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
			Name:             "knowledge.search",
			Description:      "Search the embedded Redeven knowledge bundle and return scoped card summaries without internal file-level evidence details.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}, "max_results": map[string]any{"type": "integer", "minimum": 1, "maximum": 8}, "tags": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}, "required": []string{"query"}, "additionalProperties": false}),
			ParallelSafe:     true,
			Mutating:         false,
			RequiresApproval: false,
			Source:           "builtin",
			Namespace:        "builtin.knowledge",
			Priority:         100,
		},
		{
			Name:             "write_todos",
			Description:      "Replace the current thread todo list snapshot for actionable work. Keep at most one in_progress item, avoid empty lists unless explicitly clearing prior todos, and use at least 3 todos when the user asks for explicit planning/task breakdown.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"todos": map[string]any{"type": "array", "items": map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "content": map[string]any{"type": "string"}, "status": map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed", "cancelled"}}, "note": map[string]any{"type": "string"}}, "required": []string{"content", "status"}, "additionalProperties": false}}, "expected_version": map[string]any{"type": "integer", "minimum": 0}, "explanation": map[string]any{"type": "string", "maxLength": 500}}, "required": []string{"todos"}, "additionalProperties": false}),
			ParallelSafe:     true,
			Mutating:         false,
			RequiresApproval: false,
			Source:           "builtin",
			Namespace:        "builtin.state",
			Priority:         100,
		},
		{
			Name:         "task_complete",
			Description:  "You MUST call this tool when the task is done. Provide a detailed result summary describing what was accomplished.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"result": map[string]any{"type": "string"}, "evidence_refs": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "remaining_risks": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "next_actions": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}, "required": []string{"result"}, "additionalProperties": false}),
			ParallelSafe: true,
			Mutating:     false,
			Source:       "builtin",
			Namespace:    "builtin.signal",
			Priority:     100,
		},
		{
			Name:         "ask_user",
			Description:  "Ask user for required structured input when the next step depends on a user decision, external input, approval, or a guided interaction turn. Preserve explicit interaction-shape constraints from the user, such as asking for fixed options, clickable choices, one-question-at-a-time, or indirect questioning. Each question must declare response_mode. Choice-based questions must also declare choices_exhaustive: use select only when choices_exhaustive=true, write for direct free text, and select_or_write when choices_exhaustive=false so the UI keeps a standardized typed fallback such as None of the above. If the user asks for answer choices, do not downgrade the question into pure write mode. choices[] should contain fixed options only. Do not use it to delegate tool-collectable work. Include reason_code, required_from_user, and evidence_refs for explainable policy checks.",
			InputSchema:  toSchema(askUserToolInputSchema()),
			ParallelSafe: true,
			Mutating:     false,
			Source:       "builtin",
			Namespace:    "builtin.signal",
			Priority:     100,
		},
		{
			Name:         "exit_plan_mode",
			Description:  "Request a deterministic switch prompt from plan mode into act mode when execution is needed. Use this instead of constructing a manual mode-switch ask_user payload.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"summary": map[string]any{"type": "string", "maxLength": 500, "description": "Short explanation of why act mode is needed."}, "allowed_prompts": map[string]any{"type": "array", "maxItems": 8, "items": map[string]any{"type": "object", "properties": map[string]any{"tool": map[string]any{"type": "string", "maxLength": 80}, "prompt": map[string]any{"type": "string", "maxLength": 240}}, "required": []string{"tool", "prompt"}, "additionalProperties": false}}}, "additionalProperties": false}),
			ParallelSafe: true,
			Mutating:     false,
			Source:       "builtin",
			Namespace:    "builtin.signal",
			Priority:     100,
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
			Description:  "Manage subagents with actions: create, wait, list, inspect, steer, terminate, terminate_all. Create requires a strict delegation contract with objective, trigger_reason, deliverables, definition_of_done, and output_schema. Subagent timeout is fixed at 900 seconds.",
			InputSchema:  toSchema(subagentsToolInputSchema()),
			ParallelSafe: true,
			Mutating:     false,
			Source:       "builtin",
			Namespace:    "builtin.subagent",
			Priority:     100,
		},
	}
	return defs
}

func registerBuiltInTools(reg *InMemoryToolRegistry, r *run) error {
	if reg == nil {
		return fmt.Errorf("nil tool registry")
	}
	for _, def := range builtInToolDefinitions() {
		if def.Name == "web.search" && (r == nil || !r.webSearchToolEnabled) {
			continue
		}
		if (def.Name == "ask_user" || def.Name == "exit_plan_mode") && r != nil && r.noUserInteraction {
			continue
		}
		if !r.allowSubagentDelegate {
			switch def.Name {
			case "subagents":
				continue
			}
		}
		handler := ToolHandler(&builtInToolHandler{r: r, toolName: def.Name})
		if def.Name == "task_complete" || def.Name == "ask_user" || def.Name == "exit_plan_mode" {
			handler = signalToolHandler{}
		}
		if err := reg.Register(def, handler); err != nil {
			return err
		}
	}
	return nil
}
