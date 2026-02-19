package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
)

type builtInToolHandler struct {
	r        *run
	toolName string
}

func toolSuccessSummary(toolName string) string {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return "terminal.exec"
	case "apply_patch":
		return "apply_patch.applied"
	case "write_todos":
		return "todos.updated"
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
	return ToolResult{
		ToolID:   strings.TrimSpace(call.ID),
		ToolName: toolName,
		Status:   status,
		Summary:  summary,
		Details:  details,
		Error:    outcome.ToolError,
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

func builtInToolDefinitions() []ToolDef {
	toSchema := func(m map[string]any) json.RawMessage {
		b, _ := json.Marshal(m)
		return b
	}
	defs := []ToolDef{
		{
			Name:             "apply_patch",
			Description:      "Apply a unified diff patch to files on the local machine. Paths are resolved relative to the run working directory unless absolute.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"patch": map[string]any{"type": "string"}}, "required": []string{"patch"}, "additionalProperties": false}),
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
			Description:      "Search the embedded Redeven knowledge bundle and return the most relevant cards with evidence refs.",
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
			Description:  "Ask user for clarification only for true external blockers. Include reason_code, required_from_user, and evidence_refs for explainable policy checks.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"question": map[string]any{"type": "string"}, "options": map[string]any{"type": "array", "items": map[string]any{"type": "string", "maxLength": 200}, "minItems": 1, "maxItems": 4}, "reason_code": map[string]any{"type": "string", "enum": []string{"user_decision_required", "permission_blocked", "missing_external_input", "conflicting_constraints", "safety_confirmation"}}, "required_from_user": map[string]any{"type": "array", "items": map[string]any{"type": "string", "maxLength": 200}, "minItems": 1, "maxItems": 8}, "evidence_refs": map[string]any{"type": "array", "items": map[string]any{"type": "string", "maxLength": 120}, "maxItems": 12}}, "required": []string{"question", "reason_code", "required_from_user", "evidence_refs"}, "additionalProperties": false}),
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
			Description:  "Manage subagents with actions: create, wait, list, inspect, steer, terminate, terminate_all. Create requires a strict delegation contract (deliverables, definition_of_done, output_schema). Subagent timeout is fixed at 900 seconds.",
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
		if def.Name == "ask_user" && r != nil && r.noUserInteraction {
			continue
		}
		if !r.allowSubagentDelegate {
			switch def.Name {
			case "subagents":
				continue
			}
		}
		handler := ToolHandler(&builtInToolHandler{r: r, toolName: def.Name})
		if def.Name == "task_complete" || def.Name == "ask_user" {
			handler = signalToolHandler{}
		}
		if err := reg.Register(def, handler); err != nil {
			return err
		}
	}
	return nil
}
