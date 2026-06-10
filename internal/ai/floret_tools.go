package ai

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	flprovider "github.com/floegence/floret/provider"
	fltools "github.com/floegence/floret/tools"
)

type floretToolRuntimeState struct {
	mu    sync.Mutex
	state runtimeState
}

func newFloretToolRuntimeState(state runtimeState) *floretToolRuntimeState {
	return &floretToolRuntimeState{state: state}
}

func (s *floretToolRuntimeState) snapshot() runtimeState {
	if s == nil {
		return runtimeState{}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *floretToolRuntimeState) updateFromToolResult(call ToolCall, result ToolResult, round int) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := strings.TrimSpace(call.ID)
	if id != "" {
		if s.state.ToolCallLedger == nil {
			s.state.ToolCallLedger = map[string]string{}
		}
		s.state.ToolCallLedger[id] = "dispatched"
	}
	updateTodoRuntimeState(&s.state, []ToolCall{call}, []ToolResult{result}, round)
	if result.Status == toolResultStatusSuccess {
		if id != "" {
			s.state.ToolCallLedger[id] = "completed"
		}
		s.state.CompletedActionFacts = appendLimited(s.state.CompletedActionFacts, result.ToolName+": "+strings.TrimSpace(result.Summary), 12)
		return
	}
	if id != "" {
		if result.Status == toolResultStatusAborted {
			s.state.ToolCallLedger[id] = "aborted"
		} else {
			s.state.ToolCallLedger[id] = "failed"
		}
		s.state.BlockedEvidenceRefs = appendLimited(s.state.BlockedEvidenceRefs, "tool:"+id, 12)
	}
	detail := strings.TrimSpace(result.Details)
	if detail == "" && result.Error != nil {
		detail = strings.TrimSpace(result.Error.Message)
	}
	if detail == "" {
		detail = strings.TrimSpace(result.Summary)
	}
	s.state.BlockedActionFacts = appendLimited(s.state.BlockedActionFacts, result.ToolName+": "+detail, 12)
}

func buildFloretToolRegistry(r *run, activeTools []ToolDef, state *floretToolRuntimeState) (*fltools.Registry, error) {
	registry := fltools.NewRegistry()
	for _, def := range activeTools {
		name := strings.TrimSpace(def.Name)
		if name == "" || isFlowerControlTool(name) {
			continue
		}
		def := def
		tool := fltools.Define[map[string]any](
			floretToolDefinition(def),
			nil,
			nil,
			func(ctx context.Context, inv fltools.Invocation[map[string]any]) (fltools.Result, error) {
				call := ToolCall{
					ID:   strings.TrimSpace(inv.CallID),
					Name: strings.TrimSpace(inv.Name),
					Args: cloneAnyMap(inv.Args),
				}
				if call.Name == "" {
					call.Name = strings.TrimSpace(def.Name)
				}
				handler := &builtInToolHandler{r: r, toolName: call.Name}
				result, err := handler.Execute(ctx, call)
				if err != nil {
					return fltools.Result{}, err
				}
				if state != nil {
					state.updateFromToolResult(call, result, inv.Step)
				}
				return floretToolResultFromFlower(result), nil
			},
		)
		if err := registry.Register(tool); err != nil {
			return nil, err
		}
	}
	return registry, nil
}

func floretToolDefinition(def ToolDef) fltools.Definition {
	inputSchema := map[string]any{"type": "object", "additionalProperties": true}
	if len(def.InputSchema) > 0 {
		var parsed map[string]any
		if err := json.Unmarshal(def.InputSchema, &parsed); err == nil && parsed != nil {
			inputSchema = parsed
		}
	}
	effects := floretToolEffects(def)
	readOnly := !def.Mutating && def.Name != "terminal.exec"
	return fltools.Definition{
		Name:         strings.TrimSpace(def.Name),
		Title:        strings.TrimSpace(def.Name),
		Description:  strings.TrimSpace(def.Description),
		InputSchema:  inputSchema,
		Effects:      effects,
		ReadOnly:     readOnly,
		Destructive:  def.Mutating,
		OpenWorld:    false,
		ParallelSafe: floretToolParallelSafe(def, effects),
		Permission:   fltools.PermissionSpec{Mode: fltools.PermissionAllow},
		Annotations: map[string]any{
			"source":              strings.TrimSpace(def.Source),
			"namespace":           strings.TrimSpace(def.Namespace),
			"flower_policy_owner": "internal/ai.run.handleToolCall",
		},
	}
}

func floretToolParallelSafe(def ToolDef, effects []fltools.Effect) bool {
	if !def.ParallelSafe || def.Mutating {
		return false
	}
	if len(effects) == 0 {
		return false
	}
	for _, effect := range effects {
		if effect != fltools.EffectRead {
			return false
		}
	}
	return true
}

func floretToolEffects(def ToolDef) []fltools.Effect {
	name := strings.TrimSpace(def.Name)
	switch name {
	case "terminal.exec":
		return []fltools.Effect{fltools.EffectShell}
	case "web.search":
		return []fltools.Effect{fltools.EffectNetwork}
	case "file.edit", "file.write", "apply_patch":
		return []fltools.Effect{fltools.EffectWrite}
	default:
		return []fltools.Effect{fltools.EffectRead}
	}
}

func floretToolResultFromFlower(result ToolResult) fltools.Result {
	structured := map[string]any{
		"status":      strings.TrimSpace(result.Status),
		"summary":     strings.TrimSpace(result.Summary),
		"details":     strings.TrimSpace(result.Details),
		"truncated":   result.Truncated,
		"content_ref": strings.TrimSpace(result.ContentRef),
	}
	if result.Data != nil {
		structured["data"] = result.Data
	}
	if result.Error != nil {
		result.Error.Normalize()
		structured["error"] = result.Error
	}
	text, _ := json.Marshal(structured)
	return fltools.Result{
		CallID:     strings.TrimSpace(result.ToolID),
		Name:       strings.TrimSpace(result.ToolName),
		Text:       string(text),
		Structured: structured,
		IsError:    strings.TrimSpace(result.Status) != "" && strings.TrimSpace(result.Status) != toolResultStatusSuccess,
	}
}

func isFlowerControlTool(name string) bool {
	switch strings.TrimSpace(name) {
	case "ask_user", "task_complete", "exit_plan_mode":
		return true
	default:
		return false
	}
}

func floretControlDefinitionsFromTools(activeTools []ToolDef) []flprovider.ToolDefinition {
	defs := make([]flprovider.ToolDefinition, 0, 3)
	for _, def := range activeTools {
		name := strings.TrimSpace(def.Name)
		if !isFlowerControlTool(name) {
			continue
		}
		inputSchema := map[string]any{"type": "object", "additionalProperties": true}
		if len(def.InputSchema) > 0 {
			var parsed map[string]any
			if err := json.Unmarshal(def.InputSchema, &parsed); err == nil && parsed != nil {
				inputSchema = parsed
			}
		}
		defs = append(defs, flprovider.ToolDefinition{
			Name:        name,
			Title:       name,
			Description: strings.TrimSpace(def.Description),
			InputSchema: inputSchema,
			Strict:      true,
			Annotations: map[string]any{
				"kind":      "control",
				"source":    strings.TrimSpace(def.Source),
				"namespace": strings.TrimSpace(def.Namespace),
			},
		})
	}
	return defs
}

func floretControlToolsForContract(all []ToolDef, contract runCapabilityContract) []ToolDef {
	allowed := make(map[string]struct{}, len(contract.AllowedSignals))
	for _, name := range contract.AllowedSignals {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		allowed[name] = struct{}{}
	}
	if len(allowed) == 0 {
		return nil
	}
	out := make([]ToolDef, 0, len(allowed))
	seen := make(map[string]struct{}, len(allowed))
	for _, def := range all {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if _, ok := allowed[name]; !ok {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, def)
	}
	return out
}
