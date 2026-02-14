package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	aitools "github.com/floegence/redeven-agent/internal/ai/tools"
)

type builtInToolHandler struct {
	r        *run
	toolName string
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
			Summary:   "tool.success",
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

type useSkillToolHandler struct {
	r *run
}

func (h *useSkillToolHandler) Validate(_ context.Context, call ToolCall) error {
	if h == nil || h.r == nil {
		return fmt.Errorf("tool handler unavailable")
	}
	if strings.TrimSpace(call.Name) == "" {
		return fmt.Errorf("missing skill tool name")
	}
	name := strings.TrimSpace(anyToString(call.Args["name"]))
	if name == "" {
		return fmt.Errorf("missing required field: name")
	}
	return nil
}

func (h *useSkillToolHandler) Execute(_ context.Context, call ToolCall) (ToolResult, error) {
	if h == nil || h.r == nil {
		return ToolResult{}, fmt.Errorf("tool handler unavailable")
	}
	name := strings.TrimSpace(anyToString(call.Args["name"]))
	reason := strings.TrimSpace(anyToString(call.Args["reason"]))
	activation, alreadyActive, err := h.r.activateSkill(name)
	if err != nil {
		return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.error", Details: err.Error()}, nil
	}
	out := map[string]any{
		"name":           activation.Name,
		"activation_id":  activation.ActivationID,
		"already_active": alreadyActive,
		"content":        activation.Content,
		"content_ref":    activation.ContentRef,
		"root_dir":       activation.RootDir,
		"mode_hints":     activation.ModeHints,
	}
	if reason != "" {
		out["reason"] = reason
	}
	if len(activation.Dependencies) > 0 {
		deps := make([]map[string]any, 0, len(activation.Dependencies))
		for _, dep := range activation.Dependencies {
			deps = append(deps, map[string]any{
				"name":      dep.Name,
				"transport": dep.Transport,
				"command":   dep.Command,
				"url":       dep.URL,
			})
		}
		out["dependencies"] = deps
		out["dependency_degraded"] = true
	}
	return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusSuccess, Summary: "skill.activated", Details: "skill activated", Data: out}, nil
}

func (h *useSkillToolHandler) HandlePartial(_ context.Context, _ PartialToolCall) error {
	return nil
}

type delegateTaskToolHandler struct {
	r *run
}

func (h *delegateTaskToolHandler) Validate(_ context.Context, call ToolCall) error {
	if h == nil || h.r == nil {
		return fmt.Errorf("tool handler unavailable")
	}
	if strings.TrimSpace(anyToString(call.Args["objective"])) == "" {
		return fmt.Errorf("missing required field: objective")
	}
	return nil
}

func (h *delegateTaskToolHandler) Execute(ctx context.Context, call ToolCall) (ToolResult, error) {
	if h == nil || h.r == nil {
		return ToolResult{}, fmt.Errorf("tool handler unavailable")
	}
	out, err := h.r.delegateTask(ctx, cloneAnyMap(call.Args))
	if err != nil {
		return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.error", Details: err.Error()}, nil
	}
	return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusSuccess, Summary: "delegation.created", Details: "subagent task created", Data: out}, nil
}

func (h *delegateTaskToolHandler) HandlePartial(_ context.Context, _ PartialToolCall) error {
	return nil
}

type sendSubagentInputToolHandler struct {
	r *run
}

func (h *sendSubagentInputToolHandler) Validate(_ context.Context, call ToolCall) error {
	if h == nil || h.r == nil {
		return fmt.Errorf("tool handler unavailable")
	}
	if strings.TrimSpace(anyToString(call.Args["id"])) == "" {
		return fmt.Errorf("missing required field: id")
	}
	if strings.TrimSpace(anyToString(call.Args["message"])) == "" {
		return fmt.Errorf("missing required field: message")
	}
	return nil
}

func (h *sendSubagentInputToolHandler) Execute(_ context.Context, call ToolCall) (ToolResult, error) {
	if h == nil || h.r == nil {
		return ToolResult{}, fmt.Errorf("tool handler unavailable")
	}
	id := strings.TrimSpace(anyToString(call.Args["id"]))
	message := strings.TrimSpace(anyToString(call.Args["message"]))
	interrupt := false
	if raw, ok := call.Args["interrupt"].(bool); ok {
		interrupt = raw
	}
	out, err := h.r.sendSubagentInput(id, message, interrupt)
	if err != nil {
		return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.error", Details: err.Error()}, nil
	}
	return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusSuccess, Summary: "delegation.input_sent", Details: "input sent to subagent", Data: out}, nil
}

func (h *sendSubagentInputToolHandler) HandlePartial(_ context.Context, _ PartialToolCall) error {
	return nil
}

type waitSubagentsToolHandler struct {
	r *run
}

func (h *waitSubagentsToolHandler) Validate(_ context.Context, call ToolCall) error {
	if h == nil || h.r == nil {
		return fmt.Errorf("tool handler unavailable")
	}
	return nil
}

func (h *waitSubagentsToolHandler) Execute(ctx context.Context, call ToolCall) (ToolResult, error) {
	if h == nil || h.r == nil {
		return ToolResult{}, fmt.Errorf("tool handler unavailable")
	}
	timeoutMS := int64(30_000)
	if v, ok := call.Args["timeout_ms"].(float64); ok {
		timeoutMS = int64(v)
	}
	if v, ok := call.Args["timeout_ms"].(int64); ok {
		timeoutMS = v
	}
	if timeoutMS < 10_000 {
		timeoutMS = 10_000
	}
	if timeoutMS > 300_000 {
		timeoutMS = 300_000
	}
	ids := extractStringSlice(call.Args["ids"])
	waitCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMS)*time.Millisecond)
	defer cancel()
	out, timedOut := h.r.waitSubagents(waitCtx, ids)
	return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusSuccess, Summary: "delegation.wait", Details: "subagent wait completed", Data: map[string]any{"status": out, "timed_out": timedOut}}, nil
}

func (h *waitSubagentsToolHandler) HandlePartial(_ context.Context, _ PartialToolCall) error {
	return nil
}

type closeSubagentToolHandler struct {
	r *run
}

func (h *closeSubagentToolHandler) Validate(_ context.Context, call ToolCall) error {
	if h == nil || h.r == nil {
		return fmt.Errorf("tool handler unavailable")
	}
	if strings.TrimSpace(anyToString(call.Args["id"])) == "" {
		return fmt.Errorf("missing required field: id")
	}
	return nil
}

func (h *closeSubagentToolHandler) Execute(_ context.Context, call ToolCall) (ToolResult, error) {
	if h == nil || h.r == nil {
		return ToolResult{}, fmt.Errorf("tool handler unavailable")
	}
	id := strings.TrimSpace(anyToString(call.Args["id"]))
	out, err := h.r.closeSubagent(id)
	if err != nil {
		return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusError, Summary: "tool.error", Details: err.Error()}, nil
	}
	return ToolResult{ToolID: call.ID, ToolName: call.Name, Status: toolResultStatusSuccess, Summary: "delegation.closed", Details: "subagent closed", Data: out}, nil
}

func (h *closeSubagentToolHandler) HandlePartial(_ context.Context, _ PartialToolCall) error {
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
		if !truncated {
			return payload, false
		}
		return map[string]any{"raw": trimmed, "truncated": true}, true
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

func builtInToolDefinitions() []ToolDef {
	toSchema := func(m map[string]any) json.RawMessage {
		b, _ := json.Marshal(m)
		return b
	}
	defs := []ToolDef{
		{
			Name:             "apply_patch",
			Description:      "Apply a unified diff patch to files in the current workspace.",
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
			Description:      "Execute shell command in workspace. Prefer rg/sed/cat for investigation and use workdir instead of cd. Use stdin for multi-line scripts.",
			InputSchema:      toSchema(map[string]any{"type": "object", "properties": map[string]any{"command": map[string]any{"type": "string"}, "stdin": map[string]any{"type": "string", "maxLength": 200000}, "cwd": map[string]any{"type": "string"}, "workdir": map[string]any{"type": "string"}, "timeout_ms": map[string]any{"type": "integer", "minimum": 1, "maximum": 60000}, "description": map[string]any{"type": "string", "maxLength": 200}}, "required": []string{"command"}, "additionalProperties": false}),
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
			Name:             "write_todos",
			Description:      "Replace the current thread todo list snapshot. Keep at most one in_progress item.",
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
			Description:  "Ask user for clarification. Only use when you genuinely cannot determine the answer from available tools.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"question": map[string]any{"type": "string"}, "options": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}}, "required": []string{"question"}, "additionalProperties": false}),
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
			Name:         "delegate_task",
			Description:  "Delegate a task to a subagent.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"objective": map[string]any{"type": "string"}, "agent_type": map[string]any{"type": "string"}, "mode": map[string]any{"type": "string"}, "allowed_tools": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "task_id": map[string]any{"type": "string"}, "budget": map[string]any{"type": "object", "properties": map[string]any{"max_steps": map[string]any{"type": "integer", "minimum": 1}, "timeout_sec": map[string]any{"type": "integer", "minimum": 1}}, "additionalProperties": false}}, "required": []string{"objective"}, "additionalProperties": false}),
			ParallelSafe: true,
			Mutating:     false,
			Source:       "builtin",
			Namespace:    "builtin.subagent",
			Priority:     100,
		},
		{
			Name:         "send_subagent_input",
			Description:  "Send additional input to a running subagent.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}, "message": map[string]any{"type": "string"}, "interrupt": map[string]any{"type": "boolean"}}, "required": []string{"id", "message"}, "additionalProperties": false}),
			ParallelSafe: true,
			Mutating:     false,
			Source:       "builtin",
			Namespace:    "builtin.subagent",
			Priority:     100,
		},
		{
			Name:         "wait_subagents",
			Description:  "Wait for subagent tasks to reach terminal status or timeout.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"ids": map[string]any{"type": "array", "items": map[string]any{"type": "string"}}, "timeout_ms": map[string]any{"type": "integer", "minimum": 10000, "maximum": 300000}}, "additionalProperties": false}),
			ParallelSafe: true,
			Mutating:     false,
			Source:       "builtin",
			Namespace:    "builtin.subagent",
			Priority:     100,
		},
		{
			Name:         "close_subagent",
			Description:  "Close a subagent and return its last known status.",
			InputSchema:  toSchema(map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string"}}, "required": []string{"id"}, "additionalProperties": false}),
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
		if !r.allowSubagentDelegate {
			switch def.Name {
			case "delegate_task", "send_subagent_input", "wait_subagents", "close_subagent":
				continue
			}
		}
		handler := ToolHandler(&builtInToolHandler{r: r, toolName: def.Name})
		if def.Name == "task_complete" || def.Name == "ask_user" {
			handler = signalToolHandler{}
		}
		if def.Name == "use_skill" {
			handler = &useSkillToolHandler{r: r}
		}
		if def.Name == "delegate_task" {
			handler = &delegateTaskToolHandler{r: r}
		}
		if def.Name == "send_subagent_input" {
			handler = &sendSubagentInputToolHandler{r: r}
		}
		if def.Name == "wait_subagents" {
			handler = &waitSubagentsToolHandler{r: r}
		}
		if def.Name == "close_subagent" {
			handler = &closeSubagentToolHandler{r: r}
		}
		if err := reg.Register(def, handler); err != nil {
			return err
		}
	}
	return nil
}
