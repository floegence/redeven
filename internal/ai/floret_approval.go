package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	fltools "github.com/floegence/floret/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func (r *run) approveFloretTool(ctx context.Context, req fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
	if r == nil {
		return fltools.PermissionDecisionDenied("tool approval unavailable"), nil
	}
	if r.noUserInteraction && r.allowDelegatedApproval && r.delegatedApprovalParent != nil {
		child := floretApprovalRunContext(r, req)
		if child == nil {
			child = r
		}
		parent := child.delegatedApprovalParent
		if parent == nil {
			parent = r.delegatedApprovalParent
		}
		return parent.approveDelegatedFloretTool(ctx, child, req)
	}
	args := floretApprovalArgs(req)
	toolID := strings.TrimSpace(req.ID)
	if toolID == "" {
		toolID = strings.TrimSpace(req.ApprovalID)
	}
	toolName := strings.TrimSpace(req.Name)
	decision, reason := r.floretToolPolicyDecision(toolName, args, req.HostContext)
	r.persistFloretToolPolicyEvent(toolID, toolName, args, decision, reason)
	switch decision {
	case "allow":
		return fltools.PermissionDecisionAllow, nil
	case "deny":
		return fltools.PermissionDecisionDenied(floretPolicyDenialMessage(reason)), nil
	case "ask":
		approved, err := r.waitForFloretToolApproval(ctx, req)
		if err != nil {
			return fltools.PermissionDecisionDeny, err
		}
		if !approved {
			return fltools.PermissionDecisionDenied("Rejected by user"), nil
		}
		return fltools.PermissionDecisionAllow, nil
	default:
		return fltools.PermissionDecisionDenied("tool approval denied by policy"), nil
	}
}

func (r *run) approveDelegatedFloretTool(ctx context.Context, child *run, req fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
	if r == nil {
		return fltools.PermissionDecisionDenied("delegated tool approval unavailable"), nil
	}
	if r.service == nil {
		return fltools.PermissionDecisionDenied("delegated tool approval unavailable"), nil
	}
	args := floretApprovalArgs(req)
	toolID := strings.TrimSpace(req.ID)
	if toolID == "" {
		toolID = strings.TrimSpace(req.ApprovalID)
	}
	toolName := strings.TrimSpace(req.Name)
	policyRun := child
	if policyRun == nil {
		policyRun = r
	}
	decision, reason := policyRun.floretToolPolicyDecision(toolName, args, req.HostContext)
	policyRun.persistFloretToolPolicyEvent(toolID, toolName, args, decision, reason)
	switch decision {
	case "allow":
		return fltools.PermissionDecisionAllow, nil
	case "deny":
		return fltools.PermissionDecisionDenied(floretPolicyDenialMessage(reason)), nil
	case "ask":
		handle, _, err := r.service.registerDelegatedApproval(r, child, req)
		if err != nil {
			return fltools.PermissionDecisionDeny, err
		}
		approved, err := handle.wait(ctx, r.toolApprovalTO)
		if err != nil {
			r.service.markDelegatedApprovalUnavailable(handle.action.ActionID, err.Error())
			return fltools.PermissionDecisionDeny, err
		}
		if !approved {
			return fltools.PermissionDecisionDenied("Rejected by user"), nil
		}
		return fltools.PermissionDecisionAllow, nil
	default:
		return fltools.PermissionDecisionDenied("tool approval denied by policy"), nil
	}
}

func floretApprovalArgs(req fltools.ApprovalRequest) map[string]any {
	if args, ok := req.ValidatedArgs.(map[string]any); ok {
		return cloneAnyMap(args)
	}
	call, err := flowerToolCallFromFloret(fltools.ToolCall{ID: req.ID, Name: req.Name, Args: req.Args})
	if err != nil {
		return map[string]any{}
	}
	return cloneAnyMap(call.Args)
}

func (r *run) floretToolPolicyDecision(toolName string, args map[string]any, hostContext ...map[string]string) (string, string) {
	decision, ok := r.permissionDecisionForToolFromSnapshot(toolName)
	if !ok {
		permissionType := r.permissionType
		if len(hostContext) > 0 {
			if raw := strings.TrimSpace(hostContext[0][subagentToolHostContextParentPermissionKey]); raw != "" {
				if normalized, err := normalizePermissionType(raw, permissionType); err == nil {
					permissionType = normalized
				}
			}
		}
		def := ToolDef{
			Name:             strings.TrimSpace(toolName),
			Mutating:         aitools.IsMutating(toolName),
			RequiresApproval: aitools.RequiresApproval(toolName),
			Visibility:       visibilityForToolName(toolName),
			Capabilities:     capabilitiesForToolName(toolName),
		}
		decision = permissionDecisionForTool(permissionType, def)
	}
	delegatedApprovalUnavailable := r.subagentDepth > 0 && decision == ApprovalDecisionAsk && !r.allowDelegatedApproval
	switch {
	case delegatedApprovalUnavailable:
		return "deny", "delegated_approval_unavailable"
	case decision == ApprovalDecisionDeny:
		return "deny", "permission_denied"
	case decision == ApprovalDecisionAsk:
		return "ask", "user_approval_required"
	default:
		return "allow", "none"
	}
}

func (r *run) permissionDecisionForToolFromSnapshot(toolName string) (ApprovalDecisionKind, bool) {
	if r == nil || !permissionSnapshotActive(r.permissionSnapshot) {
		return "", false
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return ApprovalDecisionDeny, true
	}
	policy, ok := r.permissionSnapshot.ToolPolicies[toolName]
	if !ok || !stringSliceContains(r.permissionSnapshot.FloretToolNames, toolName) {
		return ApprovalDecisionDeny, true
	}
	if policy.ApprovalDecision == "" {
		return ApprovalDecisionDeny, true
	}
	return policy.ApprovalDecision, true
}

func (r *run) persistFloretToolPolicyEvent(toolID string, toolName string, args map[string]any, decision string, reason string) {
	if r == nil || strings.TrimSpace(toolName) != "terminal.exec" {
		return
	}
	commandProfile := aitools.InvocationCommandProfile(toolName, args)
	terminalTimeoutDecision := resolveTerminalExecTimeoutDecision(r.cfg, readInt64Field(args, "timeout_ms", "timeoutMs"))
	r.persistRunEvent("tool.policy", RealtimeStreamKindLifecycle, map[string]any{
		"tool_id":                    strings.TrimSpace(toolID),
		"tool_name":                  strings.TrimSpace(toolName),
		"normalized_command":         strings.TrimSpace(commandProfile.NormalizedCommand),
		"command_risk":               strings.TrimSpace(string(commandProfile.Risk)),
		"command_effects":            append([]string(nil), commandProfile.Effects...),
		"classification_reason":      strings.TrimSpace(commandProfile.Reason),
		"policy_decision":            strings.TrimSpace(decision),
		"policy_reason":              strings.TrimSpace(reason),
		"policy_permission_type":     permissionTypeString(r.permissionType),
		"policy_no_user_interaction": r.noUserInteraction,
		"timeout_requested_ms":       terminalTimeoutDecision.RequestedMS,
		"timeout_effective_ms":       terminalTimeoutDecision.EffectiveMS,
		"timeout_default_ms":         terminalTimeoutDecision.DefaultMS,
		"timeout_max_ms":             terminalTimeoutDecision.MaxMS,
		"timeout_source":             terminalTimeoutDecision.Source,
	})
}

func floretPolicyDenialMessage(reason string) string {
	switch strings.TrimSpace(reason) {
	case "delegated_approval_unavailable":
		return "Subagent tool invocation requires user approval, but delegated approval is unavailable for this run"
	case "permission_denied":
		return "Tool invocation is not available under the current permission type"
	default:
		return "tool invocation denied by policy"
	}
}

func visibilityForToolName(toolName string) ToolVisibilityClass {
	switch strings.TrimSpace(toolName) {
	case "read_file", "read_files", "rgrep", "find", "web_fetch", "file.read":
		return ToolVisibilityReadonlyExclusive
	case "web.search", "okf.index", "okf.search", "okf.open":
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
	case "read_file", "read_files", "rgrep", "find", "file.read", "okf.index", "okf.search", "okf.open":
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

func (r *run) waitForFloretToolApproval(ctx context.Context, req fltools.ApprovalRequest) (bool, error) {
	toolID := strings.TrimSpace(req.ID)
	if toolID == "" {
		toolID = strings.TrimSpace(req.ApprovalID)
	}
	if toolID == "" {
		return false, errors.New("missing tool approval id")
	}
	toolName := strings.TrimSpace(req.Name)
	args := floretApprovalArgs(req)
	ch := make(chan bool, 1)
	requestedAt := time.Now().UnixMilli()
	expiresAt := int64(0)
	if r.toolApprovalTO > 0 {
		expiresAt = requestedAt + r.toolApprovalTO.Milliseconds()
	}
	r.mu.Lock()
	r.toolApprovals[toolID] = &toolApprovalRequest{
		decision:      ch,
		toolName:      toolName,
		argsHash:      strings.TrimSpace(req.ArgsHash),
		command:       approvalCommandForTool(toolName, args),
		cwd:           approvalCwdForTool(toolName, args),
		effects:       floretApprovalEffects(req),
		flags:         floretApprovalFlags(req),
		targets:       floretApprovalTargets(req),
		requestedAtMs: requestedAt,
		expiresAtMs:   expiresAt,
	}
	r.waitingApproval = true
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		delete(r.toolApprovals, toolID)
		r.waitingApproval = false
		r.mu.Unlock()
	}()

	timeout := r.toolApprovalTO
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case approved := <-ch:
		return approved, nil
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timer.C:
		return false, errors.New("Approval timed out")
	}
}

func approvalCommandForTool(toolName string, args map[string]any) string {
	if strings.TrimSpace(toolName) != "terminal.exec" {
		return ""
	}
	return strings.TrimSpace(anyToString(args["command"]))
}

func approvalCwdForTool(toolName string, args map[string]any) string {
	if strings.TrimSpace(toolName) != "terminal.exec" {
		return ""
	}
	return strings.TrimSpace(firstNonEmptyString(anyToString(args["cwd"]), anyToString(args["workdir"])))
}

func floretApprovalEffects(req fltools.ApprovalRequest) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(req.Effects))
	for _, effect := range req.Effects {
		value := strings.TrimSpace(string(effect))
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func floretApprovalFlags(req fltools.ApprovalRequest) []string {
	out := []string{}
	if req.ReadOnly {
		out = append(out, "read_only")
	}
	if req.Destructive {
		out = append(out, "destructive")
	}
	if req.OpenWorld {
		out = append(out, "open_world")
	}
	if hash := strings.TrimSpace(req.ArgsHash); hash != "" {
		out = append(out, "args_hash:"+hash)
	}
	return out
}

func floretApprovalTargets(req fltools.ApprovalRequest) []FlowerSafeTarget {
	seen := map[string]struct{}{}
	out := make([]FlowerSafeTarget, 0, len(req.Resources))
	for _, resource := range req.Resources {
		kind := strings.TrimSpace(resource.Kind)
		value := strings.TrimSpace(resource.Value)
		if kind == "" || value == "" {
			continue
		}
		key := kind + "\x00" + value
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		target := FlowerSafeTarget{Kind: kind, Label: value}
		if kind == "file" {
			target.URI = "file:" + value
		}
		out = append(out, target)
	}
	return out
}
