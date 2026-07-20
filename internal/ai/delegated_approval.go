package ai

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/session"
)

const (
	delegatedApprovalScopeParentRunWait       = "parent_run_wait"
	delegatedApprovalScopeThreadDelegatedWait = "thread_delegated_wait"
)

type delegatedApprovalHandle struct {
	mu           sync.Mutex
	done         chan struct{}
	promoted     chan struct{}
	promotedOnce sync.Once
	action       FlowerApprovalAction
	endpointID   string
	parentUser   string
	decided      bool
	canceled     bool
	allow        bool
}

func (h *delegatedApprovalHandle) wait(ctx context.Context, timeout time.Duration) (bool, error) {
	if h == nil {
		return false, errors.New("delegated approval unavailable")
	}
	select {
	case <-h.promoted:
	case <-h.done:
		return false, errors.New("delegated approval unavailable")
	case <-ctx.Done():
		return false, ctx.Err()
	}
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-h.done:
		h.mu.Lock()
		allow, decided, canceled := h.allow, h.decided, h.canceled
		h.mu.Unlock()
		if !decided || canceled {
			return false, errors.New("delegated approval unavailable")
		}
		return allow, nil
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timer.C:
		return false, errors.New("Approval timed out")
	}
}

func (h *delegatedApprovalHandle) promote() {
	if h != nil && h.promoted != nil {
		h.promotedOnce.Do(func() { close(h.promoted) })
	}
}

func (h *delegatedApprovalHandle) resolve(allow bool) error {
	if h == nil {
		return errors.New("delegated approval unavailable")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.decided {
		return approvalConflict("approval decision was already resolved")
	}
	h.allow = allow
	h.decided = true
	close(h.done)
	return nil
}

func (h *delegatedApprovalHandle) cancel() {
	if h == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.decided {
		return
	}
	h.canceled = true
	h.decided = true
	close(h.done)
}

func (s *Service) registerDelegatedApproval(parent *run, child *run, req flruntime.EffectAuthorizationRequest) (*delegatedApprovalHandle, bool, error) {
	if s == nil || parent == nil || child == nil {
		return nil, false, errors.New("delegated approval missing lineage")
	}
	ref := delegatedApprovalRef(parent, child, req)
	if !validDelegatedApprovalRef(ref) {
		return nil, false, errors.New("delegated approval missing identity")
	}
	if err := s.validateDelegatedApprovalSnapshotIdentity(parent, ref); err != nil {
		return nil, false, err
	}
	actionID := delegatedApprovalActionID(ref)
	now := time.Now().UnixMilli()
	expiresAt := int64(0)
	if parent.toolApprovalTO > 0 {
		expiresAt = now + parent.toolApprovalTO.Milliseconds()
	}
	action, err := delegatedApprovalAction(parent, child, req, ref, actionID, now, expiresAt)
	if err != nil {
		return nil, false, err
	}
	s.mu.Lock()
	if existing := s.delegatedApprovals[actionID]; existing != nil {
		s.mu.Unlock()
		return existing, false, nil
	}
	handle := &delegatedApprovalHandle{
		done: make(chan struct{}), promoted: make(chan struct{}), action: action,
		endpointID: strings.TrimSpace(parent.endpointID), parentUser: runUserPublicID(parent),
	}
	s.delegatedApprovals[actionID] = handle
	s.mu.Unlock()
	event := s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: strings.TrimSpace(parent.endpointID), ThreadID: strings.TrimSpace(parent.threadID),
		RunID: strings.TrimSpace(parent.id), TurnID: strings.TrimSpace(parent.messageID),
		Kind: FlowerLiveApprovalRequested, Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: action}),
	})
	var payload FlowerLiveApprovalPayload
	if decodeFlowerPayload(event.Payload, &payload) && payload.Action.ActionID == actionID {
		handle.mu.Lock()
		handle.action = payload.Action
		handle.mu.Unlock()
	}
	return handle, true, nil
}

func (s *Service) validateDelegatedApprovalSnapshotIdentity(parent *run, ref DelegatedApprovalRef) error {
	if s == nil {
		return errors.New("delegated approval service is unavailable")
	}
	if s.threadsDB == nil {
		return errors.New("delegated approval snapshot store is unavailable")
	}
	if parent == nil {
		return errors.New("delegated approval parent authority is unavailable")
	}
	endpointID := strings.TrimSpace(parent.endpointID)
	childThreadID := strings.TrimSpace(ref.ChildThreadID)
	childRunID := strings.TrimSpace(ref.ChildRunID)
	if endpointID == "" || childThreadID == "" || childRunID == "" {
		return errors.New("delegated approval child identity is incomplete")
	}
	timeout := s.persistOpTO
	if timeout <= 0 {
		timeout = defaultPersistOpTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	_, ok, err := s.threadsDB.GetFinalizedChildPermissionSnapshot(ctx, endpointID, childThreadID, childRunID)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("delegated approval child permission snapshot missing")
	}
	return nil
}

func (s *Service) submitDelegatedFlowerApproval(meta *session.Meta, req SubmitFlowerApprovalRequest) (*SubmitFlowerApprovalResponse, error) {
	if s == nil || meta == nil {
		return nil, errors.New("invalid delegated approval request")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	actionID := strings.TrimSpace(req.ActionID)
	if req.DelegatedRef == nil {
		return nil, errors.New("delegated approval ref is required")
	}
	if endpointID == "" || threadID == "" || actionID == "" || req.Version <= 0 || req.SurfaceEpoch <= 0 {
		return nil, errors.New("invalid delegated approval request")
	}
	s.mu.Lock()
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	queueErr := s.validateApprovalQueueSubmissionLocked(endpointID, threadID, actionID, req.QueueGeneration, req.QueueRevision)
	var action FlowerApprovalAction
	if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil {
		action = stream.State.ApprovalActions[actionID]
	}
	handle := s.delegatedApprovals[actionID]
	s.mu.Unlock()
	if req.ExpectedSeq > 0 && req.ExpectedSeq > cursor {
		return nil, approvalConflict("approval cursor changed")
	}
	if queueErr != nil {
		return nil, queueErr
	}
	if handle == nil || action.ActionID == "" {
		return nil, approvalConflict("delegated approval is no longer available")
	}
	if !delegatedApprovalOwnerMatches(meta, handle.parentUser) {
		return nil, errors.New("run not found")
	}
	if action.Origin != FlowerApprovalOriginDelegatedSubagent || action.Status != FlowerApprovalStatusPending || action.State != FlowerApprovalStateRequested || !action.CanApprove {
		return nil, approvalConflict(firstNonEmptyString(action.ReadOnlyReason, "approval is not available"))
	}
	if action.Version != req.Version || action.SurfaceEpoch != req.SurfaceEpoch || action.DelegatedRef == nil {
		return nil, approvalConflict("approval version changed")
	}
	if delegatedApprovalRefHash(*req.DelegatedRef) != delegatedApprovalRefHash(*action.DelegatedRef) {
		return nil, errors.New("delegated approval ref mismatch")
	}
	if err := handle.resolve(req.Approved); err != nil {
		return nil, normalizeApprovalDecisionError(err, "delegated approval decision was already resolved")
	}
	resolved := action
	resolved.State = FlowerApprovalStateRejected
	if req.Approved {
		resolved.State = FlowerApprovalStateApproved
	}
	resolved.Status = FlowerApprovalStatusResolved
	resolved.CanApprove = false
	resolved.ResolvedAtMs = time.Now().UnixMilli()
	resolved.Version++
	resolved.DeliveryState = FlowerApprovalDeliveryDelivered
	s.mu.Lock()
	delete(s.delegatedApprovals, actionID)
	s.mu.Unlock()
	event := s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID, ThreadID: threadID, RunID: delegatedApprovalParentRunID(resolved),
		TurnID: strings.TrimSpace(resolved.TurnID), Kind: FlowerLiveApprovalResolved,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: resolved}),
	})
	return &SubmitFlowerApprovalResponse{OK: true, CurrentCursor: event.Seq}, nil
}

func (s *Service) markDelegatedApprovalUnavailable(actionID string, reason string) {
	if s == nil {
		return
	}
	actionID = strings.TrimSpace(actionID)
	s.mu.Lock()
	handle := s.delegatedApprovals[actionID]
	delete(s.delegatedApprovals, actionID)
	s.mu.Unlock()
	if handle == nil {
		return
	}
	handle.cancel()
	action := handle.action
	action.Status = FlowerApprovalStatusUnavailable
	action.State = FlowerApprovalStateUnavailable
	action.CanApprove = false
	action.ReadOnlyReason = firstNonEmptyString(strings.TrimSpace(reason), "This delegated approval is no longer available.")
	action.DeliveryState = FlowerApprovalDeliveryUnavailable
	action.Version++
	if action.DelegatedRef != nil {
		s.appendFlowerLiveEvent(FlowerLiveEvent{
			EndpointID: strings.TrimSpace(handle.endpointID), ThreadID: strings.TrimSpace(action.DelegatedRef.ParentThreadID),
			RunID: delegatedApprovalParentRunID(action), TurnID: strings.TrimSpace(action.TurnID),
			Kind: FlowerLiveApprovalResolved, Payload: mustFlowerPayload(FlowerLiveApprovalPayload{Action: action}),
		})
	}
}

func runUserPublicID(r *run) string {
	if r == nil {
		return ""
	}
	if userPublicID := strings.TrimSpace(r.userPublicID); userPublicID != "" {
		return userPublicID
	}
	if r.sessionMeta != nil {
		return strings.TrimSpace(r.sessionMeta.UserPublicID)
	}
	return ""
}

func delegatedApprovalOwnerMatches(meta *session.Meta, parentUserPublicID string) bool {
	return meta != nil && strings.TrimSpace(parentUserPublicID) != "" && strings.TrimSpace(meta.UserPublicID) == strings.TrimSpace(parentUserPublicID)
}

func delegatedApprovalParentRunID(action FlowerApprovalAction) string {
	if runID := strings.TrimSpace(action.RunID); runID != "" {
		return runID
	}
	if action.DelegatedRef != nil {
		return strings.TrimSpace(action.DelegatedRef.ParentRunID)
	}
	return ""
}

func delegatedApprovalRef(parent *run, child *run, req flruntime.EffectAuthorizationRequest) DelegatedApprovalRef {
	childThreadID := firstNonEmptyString(
		strings.TrimSpace(child.threadID),
		strings.TrimSpace(req.Labels["host."+subagentToolHostContextChildThreadIDKey]),
		strings.TrimSpace(req.HostContext[subagentToolHostContextChildThreadIDKey]),
	)
	return DelegatedApprovalRef{
		ParentThreadID: strings.TrimSpace(parent.threadID), ParentRunID: strings.TrimSpace(parent.id), ParentTurnID: strings.TrimSpace(parent.messageID),
		ChildThreadID:   childThreadID,
		ChildRunID:      delegatedApprovalChildRunID(child, req, childThreadID, strings.TrimSpace(parent.id)),
		ChildTurnID:     strings.TrimSpace(child.messageID),
		ChildToolCallID: strings.TrimSpace(req.ToolCallID),
		ApprovalID:      strings.TrimSpace(req.EffectAttemptID),
	}
}

func delegatedApprovalChildRunID(child *run, req flruntime.EffectAuthorizationRequest, childThreadID string, parentRunID string) string {
	explicit := firstNonEmptyString(strings.TrimSpace(req.HostContext[subagentToolHostContextChildRunIDKey]), strings.TrimSpace(req.Labels["host."+subagentToolHostContextChildRunIDKey]))
	if explicit != "" && explicit != strings.TrimSpace(childThreadID) && explicit != strings.TrimSpace(parentRunID) {
		return explicit
	}
	return ""
}

func validDelegatedApprovalRef(ref DelegatedApprovalRef) bool {
	return strings.TrimSpace(ref.ParentThreadID) != "" && strings.TrimSpace(ref.ParentRunID) != "" && strings.TrimSpace(ref.ChildThreadID) != "" && strings.TrimSpace(ref.ChildRunID) != "" && strings.TrimSpace(ref.ChildToolCallID) != "" && strings.TrimSpace(ref.ApprovalID) != ""
}

func delegatedApprovalAction(parent *run, child *run, req flruntime.EffectAuthorizationRequest, ref DelegatedApprovalRef, actionID string, requestedAt int64, expiresAt int64) (FlowerApprovalAction, error) {
	args, err := floretApprovalArgs(req)
	if err != nil {
		return FlowerApprovalAction{}, err
	}
	toolName := firstNonEmptyString(strings.TrimSpace(req.ToolName), "tool")
	approval := &toolApprovalRequest{
		toolName: toolName, argsHash: strings.TrimSpace(req.ArgumentHash), command: approvalCommandForTool(toolName, args),
		cwd: approvalCwdForTool(toolName, args), effects: floretApprovalEffects(req), flags: floretApprovalFlags(req),
		targets: floretApprovalTargets(req), requestedAtMs: requestedAt, expiresAtMs: expiresAt,
	}
	description := toolApprovalDescription(approval)
	if childThreadID := strings.TrimSpace(ref.ChildThreadID); childThreadID != "" {
		description = "Subagent " + childThreadID + " requests approval. " + description
	}
	command, cwd := strings.TrimSpace(approval.command), strings.TrimSpace(approval.cwd)
	targets := append([]FlowerSafeTarget(nil), approval.targets...)
	return FlowerApprovalAction{
		ActionID: actionID, Origin: FlowerApprovalOriginDelegatedSubagent, TurnID: strings.TrimSpace(parent.messageID),
		ToolName: toolName, State: FlowerApprovalStateRequested, Status: FlowerApprovalStatusPending,
		Revision: 1, Version: 1, SurfaceEpoch: 1, SurfaceRole: FlowerApprovalSurfacePrimaryAction,
		Scope: delegatedApprovalScopeThreadDelegatedWait, RequestedAtMs: requestedAt, ExpiresAtMs: expiresAt,
		CanApprove: true, BatchIndex: req.BatchIndex, BatchSize: max(1, req.BatchSize), DelegatedRef: &ref,
		DeliveryState: FlowerApprovalDeliveryWaiting, ChildExecutionState: FlowerApprovalChildExecutionPending,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalDisplayLabel(toolName, toolApprovalPresentationArgs(toolName, command, cwd, targets)),
			Description: description, Command: command, Cwd: cwd, Effects: toolApprovalSummaryEffects(toolName, approval),
			Flags: append([]string(nil), approval.flags...), Targets: targets,
		},
		StepID: delegatedApprovalArgsHash(args),
	}, nil
}

func delegatedApprovalActionID(ref DelegatedApprovalRef) string {
	sum := sha256.Sum256([]byte(delegatedApprovalRefHash(ref)))
	return "dappr_" + base64.RawURLEncoding.EncodeToString(sum[:18])
}

func delegatedApprovalRefHash(ref DelegatedApprovalRef) string {
	payload, _ := json.Marshal(ref)
	sum := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func delegatedApprovalArgsHash(args map[string]any) string {
	if len(args) == 0 {
		return ""
	}
	payload, _ := json.Marshal(args)
	sum := sha256.Sum256(payload)
	return base64.RawURLEncoding.EncodeToString(sum[:12])
}
