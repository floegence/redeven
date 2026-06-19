package ai

import "strings"

type runCapabilityContract struct {
	AllowUserInteraction           bool     `json:"allow_user_interaction"`
	AllowToolApprovalWait          bool     `json:"allow_tool_approval_wait"`
	AllowedSignals                 []string `json:"allowed_signals"`
	AllowedTools                   []string `json:"allowed_tools"`
	PromptProfile                  string   `json:"prompt_profile"`
	SupportsAskUserQuestionBatches bool     `json:"supports_ask_user_question_batches"`

	allowedSignalSet map[string]struct{}
}

func resolveRunCapabilityContract(r *run, tools []ToolDef, signals []ToolDef, supportsAskUserQuestionBatches bool) runCapabilityContract {
	allowUserInteraction := true
	if r != nil && r.noUserInteraction {
		allowUserInteraction = false
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
	allowedSignals := make([]string, 0, 3)
	seenSignals := make(map[string]struct{}, len(signals))
	for _, def := range signals {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		seenSignals[name] = struct{}{}
	}
	for _, signal := range []string{"task_complete", "ask_user", "exit_plan_mode"} {
		if _, ok := seenSignals[signal]; !ok {
			continue
		}
		if signal != "task_complete" && !allowUserInteraction {
			continue
		}
		allowedSignals = append(allowedSignals, signal)
	}

	contract := runCapabilityContract{
		AllowUserInteraction:           allowUserInteraction,
		AllowToolApprovalWait:          allowUserInteraction,
		AllowedSignals:                 append([]string(nil), allowedSignals...),
		AllowedTools:                   append([]string(nil), allowedTools...),
		PromptProfile:                  resolveRunPromptProfile("", r, allowUserInteraction),
		SupportsAskUserQuestionBatches: supportsAskUserQuestionBatches,
		allowedSignalSet:               make(map[string]struct{}, len(allowedSignals)),
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
		"allow_user_interaction":             c.AllowUserInteraction,
		"allow_tool_approval_wait":           c.AllowToolApprovalWait,
		"allowed_signals":                    append([]string(nil), c.AllowedSignals...),
		"allowed_tools":                      append([]string(nil), c.AllowedTools...),
		"prompt_profile":                     strings.TrimSpace(c.PromptProfile),
		"supports_ask_user_question_batches": c.SupportsAskUserQuestionBatches,
	}
}
