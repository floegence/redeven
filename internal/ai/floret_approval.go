package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	fltools "github.com/floegence/floret/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
	"github.com/floegence/redeven/internal/config"
)

func (r *run) approveFloretTool(ctx context.Context, req fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
	if r == nil {
		return fltools.PermissionDecisionDenied("tool approval unavailable"), nil
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
	requireUserApproval := r.cfg.EffectiveRequireUserApproval()
	blockDangerousCommands := r.cfg.EffectiveBlockDangerousCommands()
	mode := strings.TrimSpace(r.runMode)
	if len(hostContext) > 0 {
		if labelMode := strings.TrimSpace(hostContext[0][subagentToolHostContextParentModeKey]); labelMode != "" {
			mode = normalizeRunMode(labelMode, mode)
		}
	}
	isPlanMode := strings.EqualFold(strings.TrimSpace(mode), config.AIModePlan)
	commandProfile := aitools.InvocationCommandProfile(toolName, args)
	commandRisk := strings.TrimSpace(string(commandProfile.Risk))
	readonlyRisk := string(aitools.TerminalCommandRiskReadonly)
	denyReadonlyExec := r.forceReadonlyExec && toolName == "terminal.exec" && commandRisk != "" && commandRisk != readonlyRisk
	denyDangerous := blockDangerousCommands && isDangerousInvocation(toolName, args)
	denyPlanMutating := isPlanMode && isMutatingInvocation(toolName, args)
	needsApproval := requiresApproval(toolName, args)
	requireApprovalForInvocation := requireUserApproval && needsApproval && !denyReadonlyExec
	denyNoUserInteractionApproval := r.noUserInteraction && requireApprovalForInvocation
	switch {
	case denyNoUserInteractionApproval:
		if r.subagentDepth > 0 {
			return "deny", "subagent_no_user_interaction_policy"
		}
		return "deny", "no_user_interaction_policy"
	case denyReadonlyExec:
		return "deny", "subagent_readonly_guard_blocked"
	case denyDangerous:
		return "deny", "dangerous_command_blocked"
	case denyPlanMutating:
		return "deny", "plan_mode_readonly_blocked"
	case requireApprovalForInvocation:
		return "ask", "user_approval_required"
	default:
		return "allow", "none"
	}
}

func (r *run) persistFloretToolPolicyEvent(toolID string, toolName string, args map[string]any, decision string, reason string) {
	if r == nil || strings.TrimSpace(toolName) != "terminal.exec" {
		return
	}
	commandProfile := aitools.InvocationCommandProfile(toolName, args)
	terminalTimeoutDecision := resolveTerminalExecTimeoutDecision(r.cfg, readInt64Field(args, "timeout_ms", "timeoutMs"))
	r.persistRunEvent("tool.policy", RealtimeStreamKindLifecycle, map[string]any{
		"tool_id":                         strings.TrimSpace(toolID),
		"tool_name":                       strings.TrimSpace(toolName),
		"normalized_command":              strings.TrimSpace(commandProfile.NormalizedCommand),
		"command_risk":                    strings.TrimSpace(string(commandProfile.Risk)),
		"command_effects":                 append([]string(nil), commandProfile.Effects...),
		"classification_reason":           strings.TrimSpace(commandProfile.Reason),
		"policy_decision":                 strings.TrimSpace(decision),
		"policy_reason":                   strings.TrimSpace(reason),
		"policy_force_readonly_exec":      r.forceReadonlyExec,
		"policy_require_user_approval":    r.cfg.EffectiveRequireUserApproval(),
		"policy_no_user_interaction":      r.noUserInteraction,
		"policy_plan_mode_readonly":       strings.EqualFold(strings.TrimSpace(r.runMode), config.AIModePlan),
		"policy_block_dangerous_commands": r.cfg.EffectiveBlockDangerousCommands(),
		"timeout_requested_ms":            terminalTimeoutDecision.RequestedMS,
		"timeout_effective_ms":            terminalTimeoutDecision.EffectiveMS,
		"timeout_default_ms":              terminalTimeoutDecision.DefaultMS,
		"timeout_max_ms":                  terminalTimeoutDecision.MaxMS,
		"timeout_source":                  terminalTimeoutDecision.Source,
	})
}

func floretPolicyDenialMessage(reason string) string {
	switch strings.TrimSpace(reason) {
	case "no_user_interaction_policy":
		return "Tool invocation requires user approval, but user interaction is disabled in this run"
	case "subagent_readonly_guard_blocked":
		return "terminal.exec command is blocked by subagent readonly policy"
	case "subagent_no_user_interaction_policy":
		return "Subagent tool invocation requires user approval, but subagents cannot request user authorization; choose an allowed non-approval path or report the blocker"
	case "dangerous_command_blocked":
		return "Command blocked by dangerous-command policy"
	case "plan_mode_readonly_blocked":
		return "Mutating tool call blocked by plan-mode readonly policy"
	default:
		return "tool invocation denied by policy"
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
