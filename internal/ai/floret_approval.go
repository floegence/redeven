package ai

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func (r *run) approveFloretTool(ctx context.Context, req fltools.ApprovalRequest) (fltools.PermissionDecision, error) {
	if r == nil {
		return fltools.PermissionDecisionDenied("tool approval unavailable"), nil
	}
	if r.noUserInteraction && r.allowDelegatedApproval && r.delegatedApprovalParent != nil {
		child, err := floretApprovalRunContext(r, req)
		if err != nil {
			return fltools.PermissionDecisionDeny, err
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
	promoted := make(chan struct{})
	requestedAt := time.Now().UnixMilli()
	r.mu.Lock()
	r.toolApprovals[toolID] = &toolApprovalRequest{
		decision:      ch,
		promoted:      promoted,
		toolName:      toolName,
		argsHash:      strings.TrimSpace(req.ArgsHash),
		command:       approvalCommandForTool(toolName, args),
		cwd:           approvalCwdForTool(toolName, args),
		effects:       floretApprovalEffects(req),
		flags:         floretApprovalFlags(req),
		targets:       floretApprovalTargets(req),
		requestedAtMs: requestedAt,
	}
	r.mu.Unlock()
	if r.service == nil {
		r.promoteToolApproval(toolID)
	}
	r.syncPendingFloretApprovals(ctx, "approver_registered")
	defer func() {
		r.mu.Lock()
		delete(r.toolApprovals, toolID)
		r.mu.Unlock()
	}()
	select {
	case <-promoted:
	case <-ctx.Done():
		return false, ctx.Err()
	}

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
		return false, context.DeadlineExceeded
	}
}

func (r *run) promoteToolApproval(toolID string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	approval := r.toolApprovals[strings.TrimSpace(toolID)]
	if approval != nil && approval.promoted != nil {
		approval.promotedOnce.Do(func() { close(approval.promoted) })
	}
	r.mu.Unlock()
}

func (r *run) publishControlConfirmationRequested(toolID string) {
	action, ok := r.snapshotControlConfirmationApproval(toolID)
	if !ok {
		return
	}
	r.sendStreamEvent(streamEventApprovalAction{Type: "approval-action", Action: action})
	r.publishThreadApprovalState(string(RunStateWaitingApproval))
}

func (r *run) setActiveFloretHost(host flruntime.Host) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.floretHost = host
	r.mu.Unlock()
}

func (r *run) activeFloretHost() flruntime.Host {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	host := r.floretHost
	r.mu.Unlock()
	return host
}

func (r *run) syncPendingFloretApprovals(ctx context.Context, reason string) {
	if r == nil || r.service == nil {
		return
	}
	host := r.activeFloretHost()
	if host == nil {
		return
	}
	threadID := strings.TrimSpace(r.threadID)
	if threadID == "" {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	pending, err := host.ListPendingApprovals(ctx, flruntime.ListPendingApprovalsRequest{ThreadID: flruntime.ThreadID(threadID)})
	if err != nil {
		if r.log != nil {
			r.log.Warn("list floret pending approvals failed", "thread_id", threadID, "run_id", r.id, "reason", strings.TrimSpace(reason), "error", err)
		}
		return
	}
	r.publishFloretPendingApprovalSnapshot(pending, reason)
}

func (r *run) publishFloretPendingApprovalSnapshot(pending flruntime.PendingApprovals, reason string) {
	if r == nil {
		return
	}
	actions := r.flowerApprovalActionsFromFloretPending(pending)
	active := make(map[string]FlowerApprovalAction, len(actions))
	for _, action := range actions {
		active[action.ActionID] = action
		r.sendStreamEvent(streamEventApprovalAction{Type: "approval-action", Action: action})
	}
	pendingLive := r.pendingLiveToolApprovals()
	for _, action := range pendingLive {
		if _, ok := active[action.ActionID]; ok {
			continue
		}
		action.Status = FlowerApprovalStatusResolved
		action.State = flowerApprovalResolvedStateForFloretReason(reason)
		action.CanApprove = false
		action.ResolvedAtMs = time.Now().UnixMilli()
		action.ReadOnlyReason = strings.TrimSpace(reason)
		r.sendStreamEvent(streamEventApprovalAction{Type: "approval-action", Action: action})
	}
	if len(actions) > 0 {
		r.publishThreadApprovalState(string(RunStateWaitingApproval))
	} else if len(pendingLive) > 0 {
		r.publishThreadApprovalState(string(RunStateRunning))
	}
}

func (r *run) flowerApprovalActionsFromFloretPending(pending flruntime.PendingApprovals) []FlowerApprovalAction {
	if r == nil || len(pending.Approvals) == 0 {
		return nil
	}
	out := make([]FlowerApprovalAction, 0, len(pending.Approvals))
	for _, approval := range pending.Approvals {
		action, ok := r.flowerApprovalActionFromFloretPending(approval)
		if !ok {
			continue
		}
		out = append(out, action)
	}
	sort.SliceStable(out, func(i, j int) bool {
		left, right := out[i], out[j]
		if left.RunID != right.RunID {
			return left.RunID < right.RunID
		}
		if left.StepID != right.StepID {
			return flowerApprovalStepNumber(left.StepID) < flowerApprovalStepNumber(right.StepID)
		}
		if left.BatchIndex != right.BatchIndex {
			return left.BatchIndex < right.BatchIndex
		}
		return left.ActionID < right.ActionID
	})
	return out
}

func flowerApprovalStepNumber(stepID string) int {
	raw := strings.TrimPrefix(strings.TrimSpace(stepID), "step:")
	step, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return step
}

func (r *run) pendingLiveToolApprovals() []FlowerApprovalAction {
	if r == nil || r.service == nil {
		return nil
	}
	endpointID := strings.TrimSpace(r.endpointID)
	threadID := strings.TrimSpace(r.threadID)
	runID := strings.TrimSpace(r.id)
	if endpointID == "" || threadID == "" || runID == "" {
		return nil
	}
	r.service.mu.Lock()
	stream := r.service.flowerLiveByThread[runThreadKey(endpointID, threadID)]
	if stream == nil || len(stream.State.ApprovalActions) == 0 {
		r.service.mu.Unlock()
		return nil
	}
	out := make([]FlowerApprovalAction, 0, len(stream.State.ApprovalActions))
	for _, action := range stream.State.ApprovalActions {
		if action.Origin != FlowerApprovalOriginMainTool ||
			strings.TrimSpace(action.RunID) != runID ||
			action.Status != FlowerApprovalStatusPending ||
			action.State != FlowerApprovalStateRequested {
			continue
		}
		out = append(out, action)
	}
	r.service.mu.Unlock()
	return out
}

func (r *run) publishRunningAfterApprovalIfNoPending(resolvedActionID string) {
	if r != nil && r.service != nil && r.service.threadHasPendingApprovals(r.endpointID, r.threadID) {
		return
	}
	resolvedActionID = strings.TrimSpace(resolvedActionID)
	for _, action := range r.pendingLiveToolApprovals() {
		if strings.TrimSpace(action.ActionID) == resolvedActionID {
			continue
		}
		return
	}
	r.publishThreadApprovalState(string(RunStateRunning))
}

func flowerApprovalResolvedStateForFloretReason(reason string) FlowerApprovalState {
	switch strings.TrimSpace(reason) {
	case floretEventToolApprovalApproved:
		return FlowerApprovalStateApproved
	case floretEventToolApprovalRejected:
		return FlowerApprovalStateRejected
	case floretEventToolApprovalTimedOut:
		return FlowerApprovalStateTimedOut
	case floretEventToolApprovalCanceled:
		return FlowerApprovalStateCanceled
	default:
		return FlowerApprovalStateCanceled
	}
}

func (r *run) pendingFloretApproval(ctx context.Context, toolID string) (flruntime.PendingApproval, bool, error) {
	if r == nil {
		return flruntime.PendingApproval{}, false, nil
	}
	host := r.activeFloretHost()
	if host == nil {
		return flruntime.PendingApproval{}, false, nil
	}
	threadID := strings.TrimSpace(r.threadID)
	toolID = strings.TrimSpace(toolID)
	if threadID == "" || toolID == "" {
		return flruntime.PendingApproval{}, false, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	pending, err := host.ListPendingApprovals(ctx, flruntime.ListPendingApprovalsRequest{ThreadID: flruntime.ThreadID(threadID)})
	if err != nil {
		return flruntime.PendingApproval{}, false, err
	}
	for _, approval := range pending.Approvals {
		if floretPendingApprovalMatchesTool(approval, toolID) {
			return approval, true, nil
		}
	}
	return flruntime.PendingApproval{}, false, nil
}

func floretPendingApprovalMatchesTool(approval flruntime.PendingApproval, toolID string) bool {
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return false
	}
	return strings.TrimSpace(approval.ToolCallID) == toolID ||
		strings.TrimSpace(approval.ApprovalID) == toolID
}

func (r *run) flowerApprovalActionFromFloretPending(approval flruntime.PendingApproval) (FlowerApprovalAction, bool) {
	if r == nil {
		return FlowerApprovalAction{}, false
	}
	toolID := firstNonEmptyString(strings.TrimSpace(approval.ToolCallID), strings.TrimSpace(approval.ApprovalID))
	if toolID == "" {
		return FlowerApprovalAction{}, false
	}
	state := normalizeFlowerApprovalState(approval.State)
	if state == "" {
		state = FlowerApprovalStateRequested
	}
	status := approvalStatusForState(state)
	if status != FlowerApprovalStatusPending || state != FlowerApprovalStateRequested {
		return FlowerApprovalAction{}, false
	}
	toolName := strings.TrimSpace(approval.ToolName)
	if toolName == "" {
		toolName = "tool"
	}
	requestedAt := approval.RequestedAt.UnixMilli()
	if requestedAt <= 0 {
		requestedAt = time.Now().UnixMilli()
	}
	revision := approval.Revision
	if revision <= 0 {
		revision = 1
	}
	surfaceEpoch := approval.Epoch
	if surfaceEpoch <= 0 {
		surfaceEpoch = 1
	}
	runID := strings.TrimSpace(r.id)
	turnID := firstNonEmptyString(strings.TrimSpace(string(approval.TurnID)), strings.TrimSpace(string(approval.RunID)), strings.TrimSpace(r.messageID))
	command := floretPendingApprovalCommand(approval)
	cwd := floretPendingApprovalCwd(approval)
	targets := floretPendingApprovalTargets(approval)
	return FlowerApprovalAction{
		ActionID:      flowerApprovalActionID(runID, toolID),
		Origin:        FlowerApprovalOriginMainTool,
		RunID:         runID,
		TurnID:        turnID,
		StepID:        floretApprovalStepID(approval),
		ToolID:        toolID,
		ToolName:      toolName,
		State:         state,
		Status:        status,
		Revision:      revision,
		Version:       revision,
		SurfaceEpoch:  surfaceEpoch,
		BatchIndex:    approval.BatchIndex,
		BatchSize:     max(1, approval.BatchSize),
		RequestedAtMs: requestedAt,
		CanApprove:    true,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalDisplayLabel(toolName, toolApprovalPresentationArgs(toolName, command, cwd, targets)),
			Description: floretPendingApprovalDescription(approval),
			Command:     command,
			Cwd:         cwd,
			Effects:     floretPendingApprovalEffects(approval, toolName),
			Flags:       floretPendingApprovalFlags(approval),
			Targets:     targets,
		},
	}, true
}

func floretApprovalStepID(approval flruntime.PendingApproval) string {
	if approval.Step <= 0 {
		return ""
	}
	return "step:" + strconv.Itoa(approval.Step)
}

func floretPendingApprovalDescription(approval flruntime.PendingApproval) string {
	for _, target := range floretPendingApprovalTargets(approval) {
		if label := strings.TrimSpace(target.Label); label != "" {
			return "Review access to " + label + " before this tool runs."
		}
	}
	return "Review this tool before it runs."
}

func floretPendingApprovalCommand(approval flruntime.PendingApproval) string {
	return floretPendingApprovalResourceValue(approval, "command")
}

func floretPendingApprovalCwd(approval flruntime.PendingApproval) string {
	return floretPendingApprovalResourceValue(approval, "working_directory")
}

func floretPendingApprovalResourceValue(approval flruntime.PendingApproval, kind string) string {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return ""
	}
	for _, resource := range approval.Resources {
		if strings.TrimSpace(resource.Kind) == kind {
			return strings.TrimSpace(resource.Value)
		}
	}
	return ""
}

func floretPendingApprovalEffects(approval flruntime.PendingApproval, toolName string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(approval.Effects))
	for _, effect := range approval.Effects {
		value := strings.TrimSpace(effect)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	if len(out) > 0 {
		return out
	}
	return toolApprovalEffects(toolName)
}

func floretPendingApprovalFlags(approval flruntime.PendingApproval) []string {
	out := []string{}
	if approval.ReadOnly {
		out = append(out, "read_only")
	}
	if approval.Destructive {
		out = append(out, "destructive")
	}
	if approval.OpenWorld {
		out = append(out, "open_world")
	}
	return out
}

func floretPendingApprovalTargets(approval flruntime.PendingApproval) []FlowerSafeTarget {
	seen := map[string]struct{}{}
	out := make([]FlowerSafeTarget, 0, len(approval.Resources))
	for _, resource := range approval.Resources {
		kind := strings.TrimSpace(resource.Kind)
		value := strings.TrimSpace(resource.Value)
		if kind == "" || value == "" || kind == "command" || kind == "working_directory" {
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

func (r *run) publishToolApprovalResolved(toolID string, state FlowerApprovalState, reason string) {
	action, ok := r.resolvedToolApprovalAction(toolID, state, reason)
	if !ok {
		return
	}
	r.sendStreamEvent(streamEventApprovalAction{Type: "approval-action", Action: action})
}

func (r *run) resolvedToolApprovalAction(toolID string, state FlowerApprovalState, reason string) (FlowerApprovalAction, bool) {
	if r == nil {
		return FlowerApprovalAction{}, false
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return FlowerApprovalAction{}, false
	}
	r.mu.Lock()
	approval := r.toolApprovals[toolID]
	if approval == nil {
		r.mu.Unlock()
		return FlowerApprovalAction{}, false
	}
	approval.resolved = true
	action := r.controlConfirmationApprovalActionLocked(toolID, approval)
	r.mu.Unlock()
	if state == "" {
		state = FlowerApprovalStateCanceled
	}
	action.State = state
	action.Status = FlowerApprovalStatusResolved
	action.CanApprove = false
	action.ResolvedAtMs = time.Now().UnixMilli()
	action.ReadOnlyReason = strings.TrimSpace(reason)
	return action, true
}

func (r *run) publishThreadApprovalState(status string) {
	if r == nil || r.service == nil {
		return
	}
	status = strings.TrimSpace(status)
	if status == "" {
		return
	}
	endpointID := strings.TrimSpace(r.endpointID)
	threadID := strings.TrimSpace(r.threadID)
	runID := strings.TrimSpace(r.id)
	if endpointID == "" || threadID == "" || runID == "" {
		return
	}
	db := r.threadsDB
	if db != nil {
		persistTO := r.persistOpTimeout
		if persistTO <= 0 {
			persistTO = defaultPersistOpTimeout
		}
		ctx, cancel := context.WithTimeout(context.Background(), persistTO)
		if err := db.UpdateThreadRunState(ctx, endpointID, threadID, status, "", "", "", runUserPublicID(r), ""); err != nil && r.log != nil {
			r.log.Warn("update thread approval state failed", "thread_id", threadID, "run_id", runID, "status", status, "error", err)
		}
		cancel()
	}
	r.service.broadcastThreadState(endpointID, threadID, runID, status, "", "")
	r.service.broadcastThreadSummary(endpointID, threadID)
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
