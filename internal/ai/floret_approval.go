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
)

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

func (r *run) pendingToolSettlementOwner(ctx context.Context) (floretPendingToolSettler, error) {
	if r == nil {
		return nil, errors.New("pending tool settlement owner is unavailable")
	}
	r.mu.Lock()
	resolver := r.settlementOwnerResolver
	r.mu.Unlock()
	if resolver != nil {
		owner := resolver()
		if owner == nil {
			return nil, errors.New("pending tool settlement owner is unavailable")
		}
		return owner, nil
	}
	host := r.activeFloretHost()
	if host == nil {
		return nil, errors.New("active pending tool settlement owner is unavailable")
	}
	return host, nil
}

func (r *run) setPendingToolSettlementOwnerResolver(resolver func() floretPendingToolSettler) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.settlementOwnerResolver = resolver
	r.mu.Unlock()
}

func (r *run) syncFloretApprovalQueue(ctx context.Context) error {
	if r == nil {
		return nil
	}
	host := r.activeFloretHost()
	if host == nil {
		return nil
	}
	rootThreadID := strings.TrimSpace(r.host.authorityThreadID)
	if rootThreadID == "" {
		return errors.New("approval queue sync requires root thread id")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	queue, err := host.ReadApprovalQueue(ctx, flruntime.ReadApprovalQueueRequest{ThreadID: flruntime.ThreadID(rootThreadID)})
	if err != nil {
		return err
	}
	return r.publishFloretApprovalQueueSnapshot(queue)
}

func (r *run) publishFloretApprovalQueueSnapshot(queue flruntime.ApprovalQueue) error {
	if r == nil {
		return errors.New("approval queue projection requires run")
	}
	actions, err := r.flowerApprovalActionsFromFloretQueue(queue)
	if err != nil {
		return err
	}
	flowerQueue, err := flowerApprovalQueueFromFloret(queue, actions)
	if err != nil {
		return err
	}
	r.sendStreamEvent(streamEventApprovalQueue{Type: "approval-queue", Actions: actions, ApprovalQueue: *flowerQueue})
	if !r.isDetached() {
		r.publishThreadApprovalStateForCanonicalQueue(actions)
	}
	return nil
}

func (r *run) flowerApprovalActionsFromFloretQueue(queue flruntime.ApprovalQueue) ([]FlowerApprovalAction, error) {
	if r == nil {
		return nil, nil
	}
	if err := queue.Validate(); err != nil {
		return nil, fmt.Errorf("invalid Floret approval queue: %w", err)
	}
	if strings.TrimSpace(string(queue.RootThreadID)) != strings.TrimSpace(r.host.authorityThreadID) && strings.TrimSpace(r.host.authorityThreadID) != "" {
		return nil, errors.New("Floret approval queue root identity mismatch")
	}
	if len(queue.Items) == 0 {
		return nil, nil
	}
	out := make([]FlowerApprovalAction, 0, len(queue.Items))
	for _, approval := range queue.Items {
		action, err := r.flowerApprovalActionFromFloretRecord(approval, queue)
		if err != nil {
			return nil, err
		}
		out = append(out, action)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].QueueOrder < out[j].QueueOrder
	})
	return out, nil
}

func (r *run) currentFloretApproval(ctx context.Context, actionID string, runID string, toolID string) (flruntime.ApprovalQueue, flruntime.ApprovalRecord, bool, error) {
	if r == nil {
		return flruntime.ApprovalQueue{}, flruntime.ApprovalRecord{}, false, nil
	}
	host := r.activeFloretHost()
	if host == nil {
		return flruntime.ApprovalQueue{}, flruntime.ApprovalRecord{}, false, nil
	}
	rootThreadID := strings.TrimSpace(r.host.authorityThreadID)
	actionID = strings.TrimSpace(actionID)
	runID = strings.TrimSpace(runID)
	toolID = strings.TrimSpace(toolID)
	if rootThreadID == "" || actionID == "" || runID == "" || toolID == "" {
		return flruntime.ApprovalQueue{}, flruntime.ApprovalRecord{}, false, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	queue, err := host.ReadApprovalQueue(ctx, flruntime.ReadApprovalQueueRequest{ThreadID: flruntime.ThreadID(rootThreadID)})
	if err != nil {
		return flruntime.ApprovalQueue{}, flruntime.ApprovalRecord{}, false, err
	}
	if err := queue.Validate(); err != nil {
		return flruntime.ApprovalQueue{}, flruntime.ApprovalRecord{}, false, fmt.Errorf("invalid Floret approval queue: %w", err)
	}
	if strings.TrimSpace(string(queue.RootThreadID)) != rootThreadID {
		return flruntime.ApprovalQueue{}, flruntime.ApprovalRecord{}, false, errors.New("Floret approval queue root identity mismatch")
	}
	for _, approval := range queue.Items {
		if approval.ApprovalID == queue.CurrentApprovalID && strings.TrimSpace(string(approval.RunID)) == runID &&
			strings.TrimSpace(approval.ToolCallID) == toolID && flowerApprovalActionID(runID, toolID) == actionID {
			return queue, approval, true, nil
		}
	}
	return queue, flruntime.ApprovalRecord{}, false, nil
}

func (r *run) flowerApprovalActionFromFloretRecord(approval flruntime.ApprovalRecord, queue flruntime.ApprovalQueue) (FlowerApprovalAction, error) {
	if r == nil {
		return FlowerApprovalAction{}, errors.New("approval queue projection requires run")
	}
	if err := queue.Validate(); err != nil {
		return FlowerApprovalAction{}, fmt.Errorf("invalid Floret approval queue: %w", err)
	}
	if err := approval.Validate(); err != nil {
		return FlowerApprovalAction{}, err
	}
	if approval.RootThreadID != queue.RootThreadID {
		return FlowerApprovalAction{}, errors.New("Floret approval queue item root identity mismatch")
	}
	toolID := strings.TrimSpace(approval.ToolCallID)
	readOnlyReason := ""
	switch strings.TrimSpace(approval.State) {
	case "requested":
	case "decision_submitted":
		readOnlyReason = "Approval decision is being applied"
	default:
		return FlowerApprovalAction{}, fmt.Errorf("unsupported Floret queue approval state %q", approval.State)
	}
	toolName := strings.TrimSpace(approval.ToolName)
	requestedAt := approval.RequestedAt.UnixMilli()
	revision := approval.Revision
	runID := strings.TrimSpace(string(approval.RunID))
	turnID := strings.TrimSpace(string(approval.TurnID))
	origin := FlowerApprovalOriginMainTool
	if approval.ThreadID != queue.RootThreadID {
		if strings.TrimSpace(string(approval.ParentThreadID)) == "" {
			return FlowerApprovalAction{}, errors.New("Floret child approval is missing parent identity")
		}
		origin = FlowerApprovalOriginDelegatedSubagent
	} else if strings.TrimSpace(string(approval.ParentThreadID)) != "" {
		return FlowerApprovalAction{}, errors.New("Floret root approval unexpectedly carries parent identity")
	}
	command := floretApprovalRecordCommand(approval)
	cwd := floretApprovalRecordCwd(approval)
	targets := floretApprovalRecordTargets(approval)
	canApprove := approval.ApprovalID == queue.CurrentApprovalID && approval.State == "requested"
	if !canApprove && approval.State == "requested" {
		readOnlyReason = "Queued for approval"
	}
	return FlowerApprovalAction{
		ActionID:        flowerApprovalActionID(runID, toolID),
		Origin:          origin,
		RunID:           runID,
		TurnID:          turnID,
		StepID:          floretApprovalStepID(approval),
		ToolID:          toolID,
		ToolName:        toolName,
		State:           FlowerApprovalStateRequested,
		Status:          FlowerApprovalStatusPending,
		Revision:        revision,
		Version:         revision,
		SurfaceEpoch:    queue.Generation,
		Scope:           "thread:" + strings.TrimSpace(string(approval.ThreadID)),
		QueueGeneration: queue.Generation,
		QueueOrder:      approval.QueueSequence,
		BatchIndex:      approval.BatchIndex,
		BatchSize:       approval.BatchSize,
		RequestedAtMs:   requestedAt,
		CanApprove:      canApprove,
		ReadOnlyReason:  readOnlyReason,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalDisplayLabel(toolName, toolApprovalPresentationArgs(toolName, command, cwd, targets)),
			Description: floretApprovalRecordDescription(approval),
			Command:     command,
			Cwd:         cwd,
			Effects:     floretApprovalRecordEffects(approval),
			Flags:       floretApprovalRecordFlags(approval),
			Targets:     targets,
		},
	}, nil
}

func flowerApprovalQueueFromFloret(queue flruntime.ApprovalQueue, actions []FlowerApprovalAction) (*FlowerApprovalQueue, error) {
	if err := queue.Validate(); err != nil {
		return nil, err
	}
	currentActionID := ""
	currentPosition := 0
	for index, approval := range queue.Items {
		if approval.ApprovalID == queue.CurrentApprovalID {
			currentActionID = flowerApprovalActionID(string(approval.RunID), approval.ToolCallID)
			if index != 0 {
				return nil, errors.New("Floret approval queue current item is not first")
			}
			currentPosition = 1
			break
		}
	}
	return &FlowerApprovalQueue{
		Generation: queue.Generation, Revision: queue.Revision, CurrentActionID: currentActionID,
		CurrentPosition: currentPosition, Total: len(actions), UnresolvedCount: len(actions),
	}, nil
}

func floretApprovalStepID(approval flruntime.ApprovalRecord) string {
	if approval.Step <= 0 {
		return ""
	}
	return "step:" + strconv.Itoa(approval.Step)
}

func floretApprovalRecordDescription(approval flruntime.ApprovalRecord) string {
	for _, target := range floretApprovalRecordTargets(approval) {
		if label := strings.TrimSpace(target.Label); label != "" {
			return "Review access to " + label + " before this tool runs."
		}
	}
	return "Review this tool before it runs."
}

func floretApprovalRecordCommand(approval flruntime.ApprovalRecord) string {
	return floretApprovalRecordResourceValue(approval, "command")
}

func floretApprovalRecordCwd(approval flruntime.ApprovalRecord) string {
	return floretApprovalRecordResourceValue(approval, "working_directory")
}

func floretApprovalRecordResourceValue(approval flruntime.ApprovalRecord, kind string) string {
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

func floretApprovalRecordEffects(approval flruntime.ApprovalRecord) []string {
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

func floretApprovalRecordFlags(approval flruntime.ApprovalRecord) []string {
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

func floretApprovalRecordTargets(approval flruntime.ApprovalRecord) []FlowerSafeTarget {
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

func (r *run) publishThreadApprovalStateForCanonicalQueue(actions []FlowerApprovalAction) {
	if r == nil || r.isDetached() {
		return
	}
	if len(actions) > 0 || r.hasPendingControlConfirmation() {
		r.publishThreadApprovalState(string(RunStateWaitingApproval))
		return
	}
	r.publishThreadApprovalState(string(RunStateRunning))
	// A control confirmation can be registered concurrently with a canonical
	// empty-queue projection. Recheck after the running broadcast so either
	// this path or the control request leaves waiting_approval as the final state.
	if r.hasPendingControlConfirmation() {
		r.publishThreadApprovalState(string(RunStateWaitingApproval))
	}
}

func (r *run) hasPendingControlConfirmation() bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, approval := range r.toolApprovals {
		if approval != nil && !approval.resolved && approval.decision != nil {
			return true
		}
	}
	return false
}
