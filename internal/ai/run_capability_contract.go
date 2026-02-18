package ai

import "strings"

type runCapabilityContract struct {
	AllowUserInteraction  bool     `json:"allow_user_interaction"`
	AllowToolApprovalWait bool     `json:"allow_tool_approval_wait"`
	AllowedSignals        []string `json:"allowed_signals"`
	AllowedTools          []string `json:"allowed_tools"`
	PromptProfile         string   `json:"prompt_profile"`

	allowedSignalSet map[string]struct{}
}

func resolveRunCapabilityContract(r *run, tools []ToolDef) runCapabilityContract {
	allowUserInteraction := true
	if r != nil && r.noUserInteraction {
		allowUserInteraction = false
	}

	allowedSignals := []string{"task_complete"}
	if allowUserInteraction {
		allowedSignals = append(allowedSignals, "ask_user")
	}

	allowedTools := make([]string, 0, len(tools))
	seenTools := make(map[string]struct{}, len(tools))
	for _, def := range tools {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if _, ok := seenTools[name]; ok {
			continue
		}
		seenTools[name] = struct{}{}
		allowedTools = append(allowedTools, name)
	}

	contract := runCapabilityContract{
		AllowUserInteraction:  allowUserInteraction,
		AllowToolApprovalWait: allowUserInteraction,
		AllowedSignals:        append([]string(nil), allowedSignals...),
		AllowedTools:          append([]string(nil), allowedTools...),
		PromptProfile:         runPromptProfileMainInteractive,
		allowedSignalSet:      make(map[string]struct{}, len(allowedSignals)),
	}
	if !allowUserInteraction {
		contract.PromptProfile = runPromptProfileSubagentAutonomous
	}
	for _, signal := range allowedSignals {
		signal = strings.TrimSpace(signal)
		if signal == "" {
			continue
		}
		contract.allowedSignalSet[signal] = struct{}{}
	}
	return contract
}

func (c runCapabilityContract) allowsSignal(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	if len(c.allowedSignalSet) == 0 {
		return false
	}
	_, ok := c.allowedSignalSet[name]
	return ok
}

func (c runCapabilityContract) eventPayload() map[string]any {
	return map[string]any{
		"allow_user_interaction":   c.AllowUserInteraction,
		"allow_tool_approval_wait": c.AllowToolApprovalWait,
		"allowed_signals":          append([]string(nil), c.AllowedSignals...),
		"allowed_tools":            append([]string(nil), c.AllowedTools...),
		"prompt_profile":           strings.TrimSpace(c.PromptProfile),
	}
}
