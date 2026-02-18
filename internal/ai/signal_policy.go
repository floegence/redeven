package ai

import "strings"

type signalSplitResult struct {
	NormalCalls      []ToolCall
	TaskCompleteCall *ToolCall
	AskUserCall      *ToolCall
	ForbiddenSignals []ToolCall
}

func splitSignalsByPolicy(calls []ToolCall, capability runCapabilityContract) signalSplitResult {
	result := signalSplitResult{
		NormalCalls:      make([]ToolCall, 0, len(calls)),
		ForbiddenSignals: make([]ToolCall, 0, 1),
	}
	for i := range calls {
		call := calls[i]
		name := strings.TrimSpace(call.Name)
		switch name {
		case "task_complete":
			if !capability.allowsSignal(name) {
				result.ForbiddenSignals = append(result.ForbiddenSignals, call)
				continue
			}
			if result.TaskCompleteCall == nil {
				copyCall := call
				result.TaskCompleteCall = &copyCall
			}
		case "ask_user":
			if !capability.allowsSignal(name) {
				result.ForbiddenSignals = append(result.ForbiddenSignals, call)
				continue
			}
			if result.AskUserCall == nil {
				copyCall := call
				result.AskUserCall = &copyCall
			}
		default:
			result.NormalCalls = append(result.NormalCalls, call)
		}
	}
	return result
}

func firstAskUserSignal(calls []ToolCall) (askUserSignal, bool) {
	for _, call := range calls {
		if strings.TrimSpace(call.Name) != "ask_user" {
			continue
		}
		signal := askUserSignal{
			Question:         extractSignalText(call, "question"),
			Options:          extractSignalStringList(call, "options"),
			ReasonCode:       extractSignalText(call, "reason_code"),
			RequiredFromUser: extractSignalStringList(call, "required_from_user"),
			EvidenceRefs:     extractSignalStringList(call, "evidence_refs"),
		}
		return signal, true
	}
	return askUserSignal{}, false
}
