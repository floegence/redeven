package ai

import (
	"strings"
	"time"
)

func visibilityForToolName(toolName string) ToolVisibilityClass {
	switch strings.TrimSpace(toolName) {
	case "read_file", "read_files", "rgrep", "find", "web_fetch", "file.read":
		return ToolVisibilityReadonlyExclusive
	case "web.search", "okf.index", "okf.search", "okf.open", "attachment.read":
		return ToolVisibilitySharedReadonly
	case "write_todos":
		return ToolVisibilityInteraction
	case "ask_user", "task_complete":
		return ToolVisibilityControl
	case "subagents":
		return ToolVisibilityDelegationControl
	default:
		return ToolVisibilityStandard
	}
}

func capabilitiesForToolName(toolName string) []ToolCapabilityClass {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return []ToolCapabilityClass{ToolCapabilityShell, ToolCapabilityOpenWorld}
	case "file.edit", "file.write", "apply_patch":
		return []ToolCapabilityClass{ToolCapabilityMutation}
	case "read_file", "read_files", "rgrep", "find", "file.read", "okf.index", "okf.search", "okf.open", "attachment.read":
		return []ToolCapabilityClass{ToolCapabilityReadonlyLocal}
	case "web_fetch", "web.search":
		return []ToolCapabilityClass{ToolCapabilityReadonlyNetwork, ToolCapabilityOpenWorld}
	case "write_todos", "ask_user", "task_complete":
		return []ToolCapabilityClass{ToolCapabilityInteraction}
	case "subagents":
		return []ToolCapabilityClass{ToolCapabilityDelegation}
	case "use_skill":
		return []ToolCapabilityClass{ToolCapabilityOpenWorld}
	default:
		return nil
	}
}

func (run *run) promoteToolApproval(toolID string) {
	if run == nil {
		return
	}
	run.mu.Lock()
	approval := run.toolApprovals[strings.TrimSpace(toolID)]
	if approval != nil && approval.promoted != nil {
		approval.promotedOnce.Do(func() { close(approval.promoted) })
	}
	run.mu.Unlock()
}

func (run *run) publishControlConfirmationRequested(toolID string) {
	action, ok := run.snapshotControlConfirmationApproval(toolID)
	if ok {
		run.sendStreamEvent(streamEventApprovalAction{Type: "approval-action", Action: action})
	}
}

func (run *run) publishToolApprovalResolved(toolID string, state FlowerApprovalState, reason string) {
	action, ok := run.resolvedToolApprovalAction(toolID, state, reason)
	if ok {
		run.sendStreamEvent(streamEventApprovalAction{Type: "approval-action", Action: action})
	}
}

func (run *run) resolvedToolApprovalAction(toolID string, state FlowerApprovalState, reason string) (FlowerApprovalAction, bool) {
	if run == nil || strings.TrimSpace(toolID) == "" {
		return FlowerApprovalAction{}, false
	}
	run.mu.Lock()
	approval := run.toolApprovals[strings.TrimSpace(toolID)]
	if approval == nil {
		run.mu.Unlock()
		return FlowerApprovalAction{}, false
	}
	approval.resolved = true
	action := run.controlConfirmationApprovalActionLocked(toolID, approval)
	run.mu.Unlock()
	if state == "" {
		state = FlowerApprovalStateCanceled
	}
	action.State, action.Status, action.CanApprove = state, FlowerApprovalStatusResolved, false
	action.ResolvedAtMs = time.Now().UnixMilli()
	action.ReadOnlyReason = strings.TrimSpace(reason)
	return action, true
}

func (run *run) hasPendingControlConfirmation() bool {
	if run == nil {
		return false
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	for _, approval := range run.toolApprovals {
		if approval != nil && !approval.resolved && approval.decision != nil {
			return true
		}
	}
	return false
}
