package ai

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func (r *run) waitForCurrentFloretEffectApproval(ctx context.Context, policyRun *run, req flruntime.EffectAuthorizationRequest) (bool, string, error) {
	if r == nil || policyRun == nil {
		return false, "", errors.New("Floret effect approval is unavailable")
	}
	args, err := floretApprovalArgs(req)
	if err != nil {
		return false, "", err
	}
	policyRun.persistFloretToolPolicyEvent(req.ToolCallID, req.ToolName, args, "ask", "user_approval_required", policyRun.currentPermissionType())
	if policyRun.noUserInteraction {
		authority := policyRun.subagentParentAuthority
		if !policyRun.allowDelegatedApproval || authority == nil || authority.registerApproval == nil || authority.markApprovalUnavailable == nil {
			return false, "", errors.New("delegated tool approval is unavailable")
		}
		handle, _, err := authority.registerApproval(policyRun, req)
		if err != nil {
			return false, "", err
		}
		approved, err := handle.wait(ctx, authority.approvalTimeout)
		if err != nil {
			authority.markApprovalUnavailable(handle.action.ActionID, err.Error())
			return false, "", err
		}
		return approved, strings.TrimSpace(handle.action.ActionID), nil
	}
	approved, err := policyRun.waitForFloretToolApproval(ctx, req)
	if err != nil {
		return false, "", err
	}
	return approved, "effect_approval:" + strings.TrimSpace(req.EffectAttemptID), nil
}

func floretApprovalArgs(req flruntime.EffectAuthorizationRequest) (map[string]any, error) {
	args := make(map[string]any)
	resourcesByKind := make(map[string][]string)
	for _, resource := range req.Resources {
		kind := strings.TrimSpace(resource.Kind)
		value := strings.TrimSpace(resource.Value)
		if kind == "" || value == "" {
			return nil, errors.New("Floret effect approval resource is incomplete")
		}
		resourcesByKind[kind] = append(resourcesByKind[kind], value)
		switch kind {
		case "command":
			args["command"] = value
		case "working_directory":
			args["cwd"] = value
		}
	}
	for kind, values := range resourcesByKind {
		args["resource."+kind] = append([]string(nil), values...)
	}
	return args, nil
}

func (r *run) persistFloretToolPolicyEvent(toolID string, toolName string, args map[string]any, decision string, reason string, permissionType FlowerPermissionType) {
	if r == nil || strings.TrimSpace(toolName) != "terminal.exec" {
		return
	}
	commandProfile := aitools.InvocationCommandProfile(toolName, args)
	r.recordRunDiagnostic("tool.policy", RealtimeStreamKindLifecycle, map[string]any{
		"tool_id":                    strings.TrimSpace(toolID),
		"tool_name":                  strings.TrimSpace(toolName),
		"normalized_command":         strings.TrimSpace(commandProfile.NormalizedCommand),
		"command_risk":               strings.TrimSpace(string(commandProfile.Risk)),
		"command_effects":            append([]string(nil), commandProfile.Effects...),
		"classification_reason":      strings.TrimSpace(commandProfile.Reason),
		"policy_decision":            strings.TrimSpace(decision),
		"policy_reason":              strings.TrimSpace(reason),
		"policy_permission_type":     permissionTypeString(permissionType),
		"policy_no_user_interaction": r.noUserInteraction,
	})
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

func (r *run) waitForFloretToolApproval(ctx context.Context, req flruntime.EffectAuthorizationRequest) (bool, error) {
	toolID := strings.TrimSpace(req.ToolCallID)
	if toolID == "" {
		return false, errors.New("missing tool approval id")
	}
	toolName := strings.TrimSpace(req.ToolName)
	args, err := floretApprovalArgs(req)
	if err != nil {
		return false, err
	}
	ch := make(chan bool, 1)
	promoted := make(chan struct{})
	requestedAt := time.Now().UnixMilli()
	r.mu.Lock()
	r.toolApprovals[toolID] = &toolApprovalRequest{
		decision:      ch,
		promoted:      promoted,
		toolName:      toolName,
		argsHash:      strings.TrimSpace(req.ArgumentHash),
		command:       approvalCommandForTool(toolName, args),
		cwd:           approvalCwdForTool(toolName, args),
		effects:       floretApprovalEffects(req),
		flags:         floretApprovalFlags(req),
		targets:       floretApprovalTargets(req),
		requestedAtMs: requestedAt,
	}
	r.mu.Unlock()
	if r.host.hasPendingApprovals == nil {
		r.promoteToolApproval(toolID)
	}
	if err := r.syncPendingFloretApprovals(ctx, "approver_registered"); err != nil {
		return false, err
	}
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

func (r *run) setActiveFloretHost(host floretActiveRunHost) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.floretHost = host
	r.mu.Unlock()
}

func (r *run) activeFloretHost() floretActiveRunHost {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	host := r.floretHost
	r.mu.Unlock()
	return host
}

func (r *run) pendingToolSettlementOwner() floretPendingToolSettler {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	resolver := r.settlementOwnerResolver
	host := r.floretHost
	r.mu.Unlock()
	if resolver != nil {
		return resolver()
	}
	return host
}

func (r *run) setPendingToolSettlementOwnerResolver(resolver func() floretPendingToolSettler) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.settlementOwnerResolver = resolver
	r.mu.Unlock()
}

func (r *run) syncPendingFloretApprovals(ctx context.Context, reason string) error {
	if r == nil {
		return nil
	}
	host := r.activeFloretHost()
	if host == nil {
		return nil
	}
	threadID := strings.TrimSpace(r.threadID)
	if threadID == "" {
		return errors.New("pending approval sync requires thread id")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	pending, err := host.ListPendingApprovals(ctx, flruntime.ListPendingApprovalsRequest{ThreadID: flruntime.ThreadID(threadID)})
	if err != nil {
		return err
	}
	return r.publishFloretPendingApprovalSnapshot(pending, reason)
}

func (r *run) publishFloretPendingApprovalSnapshot(pending flruntime.PendingApprovals, reason string) error {
	if r == nil {
		return errors.New("pending approval projection requires run")
	}
	actions, err := r.flowerApprovalActionsFromFloretPending(pending)
	if err != nil {
		return err
	}
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
		resolvedState, err := flowerApprovalResolvedStateForFloretReason(reason)
		if err != nil {
			return err
		}
		action.Status = FlowerApprovalStatusResolved
		action.State = resolvedState
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
	return nil
}

func (r *run) flowerApprovalActionsFromFloretPending(pending flruntime.PendingApprovals) ([]FlowerApprovalAction, error) {
	if r == nil {
		return nil, nil
	}
	if err := pending.Validate(); err != nil {
		return nil, fmt.Errorf("invalid Floret pending approval snapshot: %w", err)
	}
	if strings.TrimSpace(string(pending.ThreadID)) != strings.TrimSpace(r.threadID) {
		return nil, errors.New("Floret pending approval snapshot thread identity mismatch")
	}
	if len(pending.Approvals) == 0 {
		return nil, nil
	}
	out := make([]FlowerApprovalAction, 0, len(pending.Approvals))
	for _, approval := range pending.Approvals {
		action, err := r.flowerApprovalActionFromFloretPending(approval)
		if err != nil {
			return nil, err
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
	return out, nil
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
	if r == nil || r.host.pendingLiveToolApprovals == nil {
		return nil
	}
	endpointID := strings.TrimSpace(r.endpointID)
	threadID := strings.TrimSpace(r.threadID)
	runID := strings.TrimSpace(r.id)
	if endpointID == "" || threadID == "" || runID == "" {
		return nil
	}
	return r.host.pendingLiveToolApprovals(runID)
}

func (r *run) publishRunningAfterApprovalIfNoPending(resolvedActionID string) {
	if r != nil && r.host.hasPendingApprovals != nil && r.host.hasPendingApprovals() {
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

func flowerApprovalResolvedStateForFloretReason(reason string) (FlowerApprovalState, error) {
	switch strings.TrimSpace(reason) {
	case string(floretEventToolApprovalApproved):
		return FlowerApprovalStateApproved, nil
	case string(floretEventToolApprovalRejected):
		return FlowerApprovalStateRejected, nil
	case string(floretEventToolApprovalTimedOut):
		return FlowerApprovalStateTimedOut, nil
	case string(floretEventToolApprovalCanceled):
		return FlowerApprovalStateCanceled, nil
	default:
		return "", fmt.Errorf("unknown Floret approval resolution reason %q", reason)
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
	if err := pending.Validate(); err != nil {
		return flruntime.PendingApproval{}, false, fmt.Errorf("invalid Floret pending approval snapshot: %w", err)
	}
	if strings.TrimSpace(string(pending.ThreadID)) != threadID {
		return flruntime.PendingApproval{}, false, errors.New("Floret pending approval snapshot thread identity mismatch")
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

func (r *run) flowerApprovalActionFromFloretPending(approval flruntime.PendingApproval) (FlowerApprovalAction, error) {
	if r == nil {
		return FlowerApprovalAction{}, errors.New("pending approval projection requires run")
	}
	if err := approval.Validate(); err != nil {
		return FlowerApprovalAction{}, err
	}
	if strings.TrimSpace(string(approval.ThreadID)) != strings.TrimSpace(r.threadID) || strings.TrimSpace(string(approval.RunID)) != strings.TrimSpace(r.id) {
		return FlowerApprovalAction{}, errors.New("Floret pending approval run identity mismatch")
	}
	toolID := strings.TrimSpace(approval.ToolCallID)
	state := normalizeFlowerApprovalState(approval.State)
	status := approvalStatusForState(state)
	if status != FlowerApprovalStatusPending || state != FlowerApprovalStateRequested {
		return FlowerApprovalAction{}, fmt.Errorf("unsupported Floret pending approval state %q", approval.State)
	}
	toolName := strings.TrimSpace(approval.ToolName)
	requestedAt := approval.RequestedAt.UnixMilli()
	revision := approval.Revision
	surfaceEpoch := approval.Epoch
	runID := strings.TrimSpace(string(approval.RunID))
	turnID := strings.TrimSpace(string(approval.TurnID))
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
		BatchSize:     approval.BatchSize,
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
	}, nil
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
	return out
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
	if r == nil || r.host.broadcastThreadState == nil || r.host.broadcastThreadSummary == nil {
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
	r.host.broadcastThreadState(runID, status, "", "")
	_ = r.host.broadcastThreadSummary()
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

func floretApprovalEffects(req flruntime.EffectAuthorizationRequest) []string {
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

func floretApprovalFlags(req flruntime.EffectAuthorizationRequest) []string {
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

func floretApprovalTargets(req flruntime.EffectAuthorizationRequest) []FlowerSafeTarget {
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
