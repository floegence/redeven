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

	fltools "github.com/floegence/floret/tools"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/session"
)

const (
	delegatedApprovalScopeParentRunWait       = "parent_run_wait"
	delegatedApprovalScopeThreadDelegatedWait = "thread_delegated_wait"
)

type delegatedApprovalHandle struct {
	mu         sync.Mutex
	done       chan struct{}
	action     FlowerApprovalAction
	endpointID string
	decided    bool
	allow      bool
}

func (h *delegatedApprovalHandle) wait(ctx context.Context, timeout time.Duration) (bool, error) {
	if h == nil {
		return false, errors.New("delegated approval unavailable")
	}
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-h.done:
		h.mu.Lock()
		allow := h.allow
		decided := h.decided
		h.mu.Unlock()
		if !decided {
			return false, errors.New("delegated approval unavailable")
		}
		return allow, nil
	case <-ctx.Done():
		return false, ctx.Err()
	case <-timer.C:
		return false, errors.New("Approval timed out")
	}
}

func (h *delegatedApprovalHandle) resolve(allow bool) error {
	if h == nil {
		return errors.New("delegated approval unavailable")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.decided {
		return ErrRunChanged
	}
	h.allow = allow
	h.decided = true
	close(h.done)
	return nil
}

func (s *Service) registerDelegatedApproval(parent *run, child *run, req fltools.ApprovalRequest) (*delegatedApprovalHandle, bool, error) {
	if s == nil {
		return nil, false, errors.New("nil service")
	}
	if parent == nil || child == nil {
		return nil, false, errors.New("delegated approval missing lineage")
	}
	ref := delegatedApprovalRef(parent, child, req)
	if !validDelegatedApprovalRef(ref) {
		return nil, false, errors.New("delegated approval missing identity")
	}
	actionID := delegatedApprovalActionID(ref)
	now := time.Now().UnixMilli()
	expiresAt := int64(0)
	if parent.toolApprovalTO > 0 {
		expiresAt = now + parent.toolApprovalTO.Milliseconds()
	}
	action := delegatedApprovalAction(parent, child, req, ref, actionID, now, expiresAt)
	if s.threadsDB != nil {
		ctx, cancel := s.delegatedApprovalPersistContext()
		err := s.threadsDB.UpsertDelegatedApprovalRequest(ctx, delegatedApprovalRecordFromAction(strings.TrimSpace(parent.endpointID), action))
		cancel()
		if err != nil {
			return nil, false, err
		}
		ctx, cancel = s.delegatedApprovalPersistContext()
		rec, ok, err := s.threadsDB.GetDelegatedApprovalRequest(ctx, strings.TrimSpace(parent.endpointID), strings.TrimSpace(parent.threadID), actionID)
		cancel()
		if err != nil {
			return nil, false, err
		}
		if ok && rec.Status != string(FlowerApprovalStatusPending) {
			return nil, false, errors.New("delegated approval is no longer pending")
		}
	}

	s.mu.Lock()
	if s.delegatedApprovals == nil {
		s.delegatedApprovals = map[string]*delegatedApprovalHandle{}
	}
	if existing := s.delegatedApprovals[actionID]; existing != nil {
		s.mu.Unlock()
		return existing, false, nil
	}
	handle := &delegatedApprovalHandle{
		done:       make(chan struct{}),
		action:     action,
		endpointID: strings.TrimSpace(parent.endpointID),
	}
	s.delegatedApprovals[actionID] = handle
	s.mu.Unlock()

	s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: strings.TrimSpace(parent.endpointID),
		ThreadID:   strings.TrimSpace(parent.threadID),
		RunID:      strings.TrimSpace(parent.id),
		TurnID:     strings.TrimSpace(parent.messageID),
		Kind:       FlowerLiveApprovalRequested,
		Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: action}),
	})
	return handle, true, nil
}

func (s *Service) submitDelegatedFlowerApproval(meta *session.Meta, req SubmitFlowerApprovalRequest) (*SubmitFlowerApprovalResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	actionID := strings.TrimSpace(req.ActionID)
	if endpointID == "" || threadID == "" || actionID == "" || req.Version <= 0 || req.SurfaceEpoch <= 0 {
		return nil, errors.New("invalid delegated approval request")
	}
	if req.DelegatedRef == nil {
		return nil, errors.New("delegated approval ref is required")
	}

	s.mu.Lock()
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	var liveAction FlowerApprovalAction
	if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil && stream.State.ApprovalActions != nil {
		liveAction = stream.State.ApprovalActions[actionID]
	}
	handle := s.delegatedApprovals[actionID]
	s.mu.Unlock()

	if req.ExpectedSeq > 0 && req.ExpectedSeq > cursor {
		return nil, ErrRunChanged
	}
	var storedAction FlowerApprovalAction
	var storedRec threadstore.DelegatedApprovalRecord
	if s.threadsDB != nil {
		ctx, cancel := s.delegatedApprovalPersistContext()
		rec, ok, err := s.threadsDB.GetDelegatedApprovalRequest(ctx, endpointID, threadID, actionID)
		cancel()
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errors.New("delegated approval is no longer available")
		}
		storedRec = rec
		storedAction = delegatedApprovalActionFromRecord(rec)
		if storedAction.ActionID == "" {
			return nil, ErrRunChanged
		}
		if storedAction.DelegatedRef == nil || delegatedApprovalRefHash(*req.DelegatedRef) != delegatedApprovalRefHash(*storedAction.DelegatedRef) {
			return nil, errors.New("delegated approval ref mismatch")
		}
		if liveAction.ActionID == "" {
			liveAction = storedAction
		}
		if storedRec.Status != string(FlowerApprovalStatusPending) {
			if resp, replayed, err := s.replayDelegatedApprovalDecision(meta, req, storedAction, cursor); err != nil || replayed {
				return resp, err
			}
			return nil, ErrRunChanged
		}
	}
	if handle == nil {
		if s.threadsDB != nil {
			s.markDelegatedApprovalRecordUnavailable(endpointID, threadID, actionID, "delegated approval channel is unavailable")
		}
		return nil, errors.New("delegated approval is no longer available")
	}
	if liveAction.ActionID == "" {
		return nil, ErrRunChanged
	}
	if liveAction.Origin != FlowerApprovalOriginDelegatedSubagent {
		return nil, errors.New("approval action is not delegated")
	}
	if liveAction.Status != FlowerApprovalStatusPending || liveAction.State != FlowerApprovalStateRequested {
		return nil, errors.New("approval no longer pending")
	}
	if !liveAction.CanApprove {
		return nil, errors.New(firstNonEmptyString(liveAction.ReadOnlyReason, "approval is not available"))
	}
	if liveAction.Version != req.Version || liveAction.SurfaceEpoch != req.SurfaceEpoch {
		return nil, ErrRunChanged
	}
	if liveAction.DelegatedRef == nil {
		return nil, ErrRunChanged
	}
	if req.DelegatedRef == nil {
		return nil, errors.New("delegated approval ref is required")
	}
	if delegatedApprovalRefHash(*req.DelegatedRef) != delegatedApprovalRefHash(*liveAction.DelegatedRef) {
		return nil, errors.New("delegated approval ref mismatch")
	}

	state := FlowerApprovalStateRejected
	if req.Approved {
		state = FlowerApprovalStateApproved
	}
	resolved := liveAction
	resolved.State = state
	resolved.CanApprove = false
	resolved.ResolvedAtMs = time.Now().UnixMilli()
	resolved.Version++
	resolved.DeliveryState = FlowerApprovalDeliveryPending

	if s.threadsDB != nil {
		nextActionJSON := string(mustFlowerPayload(resolved))
		actorScope := delegatedApprovalActorScope(meta, threadID)
		ctx, cancel := s.delegatedApprovalPersistContext()
		result, err := s.threadsDB.SubmitDelegatedApprovalDecisionCAS(ctx, threadstore.DelegatedApprovalDecisionRequest{
			EndpointID:       endpointID,
			ParentThreadID:   threadID,
			ActionID:         actionID,
			Version:          req.Version,
			SurfaceEpoch:     req.SurfaceEpoch,
			Approved:         req.Approved,
			NextActionJSON:   nextActionJSON,
			NextVersion:      resolved.Version,
			ResolvedAtUnixMs: resolved.ResolvedAtMs,
			ActorScope:       actorScope,
			IdempotencyKey:   strings.TrimSpace(req.IdempotencyKey),
			ResponseJSON:     `{"ok":true}`,
		})
		cancel()
		if err != nil {
			return nil, err
		}
		if result.Conflict {
			return nil, errors.New("delegated approval idempotency conflict")
		}
		if !result.Accepted {
			return nil, ErrRunChanged
		}
		if result.Replayed {
			deliveredAction := delegatedApprovalActionFromRecord(result.Record)
			return &SubmitFlowerApprovalResponse{OK: true, CurrentCursor: firstPositiveInt64(cursor, deliveredAction.ExpectedSeq)}, nil
		}
		storedRec = result.Record
	}

	if err := handle.resolve(req.Approved); err != nil {
		if s.threadsDB != nil {
			s.markDelegatedApprovalRecordUnavailable(endpointID, threadID, actionID, err.Error())
		}
		return nil, err
	}
	resolved.Status = FlowerApprovalStatusResolved
	resolved.DeliveryState = FlowerApprovalDeliveryDelivered
	if s.threadsDB != nil {
		version := resolved.Version
		if storedRec.Version > 0 {
			version = storedRec.Version
		}
		ctx, cancel := s.delegatedApprovalPersistContext()
		_, err := s.threadsDB.MarkDelegatedApprovalDelivered(ctx, endpointID, threadID, actionID, version, string(mustFlowerPayload(resolved)), time.Now().UnixMilli())
		cancel()
		if err != nil {
			return nil, err
		}
	}

	s.mu.Lock()
	delete(s.delegatedApprovals, actionID)
	s.mu.Unlock()

	event := s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID,
		ThreadID:   threadID,
		RunID:      strings.TrimSpace(resolved.RunID),
		TurnID:     strings.TrimSpace(resolved.TurnID),
		Kind:       FlowerLiveApprovalResolved,
		Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: resolved}),
	})
	return &SubmitFlowerApprovalResponse{OK: true, CurrentCursor: event.Seq}, nil
}

func (s *Service) replayDelegatedApprovalDecision(meta *session.Meta, req SubmitFlowerApprovalRequest, action FlowerApprovalAction, cursor int64) (*SubmitFlowerApprovalResponse, bool, error) {
	if s == nil || s.threadsDB == nil || strings.TrimSpace(req.IdempotencyKey) == "" {
		return nil, false, nil
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	threadID := strings.TrimSpace(req.ThreadID)
	actionID := strings.TrimSpace(req.ActionID)
	if endpointID == "" || threadID == "" || actionID == "" {
		return nil, false, nil
	}
	ctx, cancel := s.delegatedApprovalPersistContext()
	result, err := s.threadsDB.SubmitDelegatedApprovalDecisionCAS(ctx, threadstore.DelegatedApprovalDecisionRequest{
		EndpointID:       endpointID,
		ParentThreadID:   threadID,
		ActionID:         actionID,
		Version:          req.Version,
		SurfaceEpoch:     req.SurfaceEpoch,
		Approved:         req.Approved,
		NextActionJSON:   string(mustFlowerPayload(action)),
		NextVersion:      req.Version + 1,
		ResolvedAtUnixMs: time.Now().UnixMilli(),
		ActorScope:       delegatedApprovalActorScope(meta, threadID),
		IdempotencyKey:   strings.TrimSpace(req.IdempotencyKey),
		ResponseJSON:     `{"ok":true}`,
	})
	cancel()
	if err != nil {
		return nil, false, err
	}
	if result.Conflict {
		return nil, true, errors.New("delegated approval idempotency conflict")
	}
	if !result.Replayed {
		return nil, false, nil
	}
	return &SubmitFlowerApprovalResponse{OK: true, CurrentCursor: cursor}, true, nil
}

func (s *Service) markDelegatedApprovalUnavailable(actionID string, reason string) {
	if s == nil {
		return
	}
	actionID = strings.TrimSpace(actionID)
	if actionID == "" {
		return
	}
	s.mu.Lock()
	handle := s.delegatedApprovals[actionID]
	if handle != nil {
		delete(s.delegatedApprovals, actionID)
	}
	s.mu.Unlock()
	if handle == nil {
		return
	}
	action := handle.action
	action.Status = FlowerApprovalStatusUnavailable
	action.State = FlowerApprovalStateUnavailable
	action.CanApprove = false
	action.ReadOnlyReason = firstNonEmptyString(strings.TrimSpace(reason), "This delegated approval is no longer available.")
	action.DeliveryState = FlowerApprovalDeliveryUnavailable
	action.Version++
	if action.DelegatedRef == nil {
		return
	}
	if s.threadsDB != nil {
		ctx, cancel := s.delegatedApprovalPersistContext()
		_, _ = s.threadsDB.MarkDelegatedApprovalUnavailable(ctx, strings.TrimSpace(handle.endpointID), strings.TrimSpace(action.DelegatedRef.ParentThreadID), actionID, reason, string(mustFlowerPayload(action)), time.Now().UnixMilli())
		cancel()
	}
	s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: strings.TrimSpace(handle.endpointID),
		ThreadID:   strings.TrimSpace(action.DelegatedRef.ParentThreadID),
		RunID:      strings.TrimSpace(action.RunID),
		TurnID:     strings.TrimSpace(action.TurnID),
		Kind:       FlowerLiveApprovalResolved,
		Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: action}),
	})
}

func (s *Service) markDelegatedApprovalRecordUnavailable(endpointID string, threadID string, actionID string, reason string) {
	if s == nil || s.threadsDB == nil {
		return
	}
	ctx, cancel := s.delegatedApprovalPersistContext()
	rec, ok, err := s.threadsDB.GetDelegatedApprovalRequest(ctx, endpointID, threadID, actionID)
	cancel()
	if err != nil || !ok {
		return
	}
	action := delegatedApprovalActionFromRecord(rec)
	if action.ActionID == "" {
		return
	}
	action.Status = FlowerApprovalStatusUnavailable
	action.State = FlowerApprovalStateUnavailable
	action.CanApprove = false
	action.ReadOnlyReason = firstNonEmptyString(strings.TrimSpace(reason), "This delegated approval is no longer available.")
	action.DeliveryState = FlowerApprovalDeliveryUnavailable
	action.Version++
	now := time.Now().UnixMilli()
	ctx, cancel = s.delegatedApprovalPersistContext()
	changed, err := s.threadsDB.MarkDelegatedApprovalUnavailable(ctx, endpointID, threadID, actionID, reason, string(mustFlowerPayload(action)), now)
	cancel()
	if err != nil || !changed {
		return
	}
	s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID,
		ThreadID:   threadID,
		RunID:      strings.TrimSpace(action.RunID),
		TurnID:     strings.TrimSpace(action.TurnID),
		Kind:       FlowerLiveApprovalResolved,
		Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: action}),
	})
}

func (s *Service) delegatedApprovalPersistContext() (context.Context, context.CancelFunc) {
	persistTO := defaultPersistOpTimeout
	if s != nil && s.persistOpTO > 0 {
		persistTO = s.persistOpTO
	}
	return context.WithTimeout(context.Background(), persistTO)
}

func delegatedApprovalActorScope(meta *session.Meta, threadID string) string {
	if meta == nil {
		return strings.TrimSpace(threadID)
	}
	return strings.TrimSpace(meta.EndpointID) + ":" + strings.TrimSpace(meta.UserPublicID) + ":" + strings.TrimSpace(threadID)
}

func delegatedApprovalRecordFromAction(endpointID string, action FlowerApprovalAction) threadstore.DelegatedApprovalRecord {
	rec := threadstore.DelegatedApprovalRecord{
		ActionID:            strings.TrimSpace(action.ActionID),
		EndpointID:          strings.TrimSpace(endpointID),
		ParentRunID:         strings.TrimSpace(action.RunID),
		ParentTurnID:        strings.TrimSpace(action.TurnID),
		State:               strings.TrimSpace(string(action.State)),
		Status:              strings.TrimSpace(string(action.Status)),
		DeliveryState:       strings.TrimSpace(string(action.DeliveryState)),
		ChildExecutionState: strings.TrimSpace(string(action.ChildExecutionState)),
		Version:             action.Version,
		SurfaceEpoch:        action.SurfaceEpoch,
		RequestedAtUnixMs:   action.RequestedAtMs,
		ResolvedAtUnixMs:    action.ResolvedAtMs,
		ExpiresAtUnixMs:     action.ExpiresAtMs,
		ActionJSON:          string(mustFlowerPayload(action)),
		CreatedAtUnixMs:     action.RequestedAtMs,
		UpdatedAtUnixMs:     action.RequestedAtMs,
	}
	if action.DelegatedRef != nil {
		ref := *action.DelegatedRef
		rec.ParentThreadID = strings.TrimSpace(ref.ParentThreadID)
		rec.ParentRunID = firstNonEmptyString(strings.TrimSpace(ref.ParentRunID), rec.ParentRunID)
		rec.ParentTurnID = firstNonEmptyString(strings.TrimSpace(ref.ParentTurnID), rec.ParentTurnID)
		rec.SubagentID = strings.TrimSpace(ref.SubagentID)
		rec.ChildThreadID = strings.TrimSpace(ref.ChildThreadID)
		rec.ChildRunID = strings.TrimSpace(ref.ChildRunID)
		rec.ChildTurnID = strings.TrimSpace(ref.ChildTurnID)
		rec.ChildToolCallID = strings.TrimSpace(ref.ChildToolCallID)
		rec.ApprovalID = strings.TrimSpace(ref.ApprovalID)
		rec.RefHash = delegatedApprovalRefHash(ref)
	}
	return rec
}

func delegatedApprovalActionFromRecord(rec threadstore.DelegatedApprovalRecord) FlowerApprovalAction {
	var action FlowerApprovalAction
	_ = json.Unmarshal([]byte(strings.TrimSpace(rec.ActionJSON)), &action)
	action.ActionID = firstNonEmptyString(strings.TrimSpace(action.ActionID), strings.TrimSpace(rec.ActionID))
	action.Origin = FlowerApprovalOriginDelegatedSubagent
	action.RunID = firstNonEmptyString(strings.TrimSpace(action.RunID), strings.TrimSpace(rec.ParentRunID))
	action.TurnID = firstNonEmptyString(strings.TrimSpace(action.TurnID), strings.TrimSpace(rec.ParentTurnID))
	action.ToolID = firstNonEmptyString(strings.TrimSpace(action.ToolID), strings.TrimSpace(rec.ChildToolCallID))
	action.State = FlowerApprovalState(strings.TrimSpace(firstNonEmptyString(string(action.State), rec.State)))
	action.Status = FlowerApprovalStatus(strings.TrimSpace(firstNonEmptyString(string(action.Status), rec.Status)))
	action.DeliveryState = FlowerApprovalDeliveryState(strings.TrimSpace(firstNonEmptyString(string(action.DeliveryState), rec.DeliveryState)))
	action.ChildExecutionState = FlowerApprovalChildExecutionState(strings.TrimSpace(firstNonEmptyString(string(action.ChildExecutionState), rec.ChildExecutionState)))
	action.Version = firstPositiveInt64(action.Version, rec.Version)
	action.SurfaceEpoch = firstPositiveInt64(action.SurfaceEpoch, rec.SurfaceEpoch)
	action.RequestedAtMs = firstPositiveInt64(action.RequestedAtMs, rec.RequestedAtUnixMs)
	action.ResolvedAtMs = firstPositiveInt64(action.ResolvedAtMs, rec.ResolvedAtUnixMs)
	action.ExpiresAtMs = firstPositiveInt64(action.ExpiresAtMs, rec.ExpiresAtUnixMs)
	if action.DelegatedRef == nil && strings.TrimSpace(rec.ParentThreadID) != "" {
		action.DelegatedRef = &DelegatedApprovalRef{
			ParentThreadID:  strings.TrimSpace(rec.ParentThreadID),
			ParentRunID:     strings.TrimSpace(rec.ParentRunID),
			ParentTurnID:    strings.TrimSpace(rec.ParentTurnID),
			SubagentID:      strings.TrimSpace(rec.SubagentID),
			ChildThreadID:   strings.TrimSpace(rec.ChildThreadID),
			ChildRunID:      strings.TrimSpace(rec.ChildRunID),
			ChildTurnID:     strings.TrimSpace(rec.ChildTurnID),
			ChildToolCallID: strings.TrimSpace(rec.ChildToolCallID),
			ApprovalID:      strings.TrimSpace(rec.ApprovalID),
		}
	}
	switch action.Status {
	case FlowerApprovalStatusUnavailable:
		action.State = FlowerApprovalStateUnavailable
		action.DeliveryState = FlowerApprovalDeliveryUnavailable
		action.CanApprove = false
	case FlowerApprovalStatusPending:
		if action.State == "" {
			action.State = FlowerApprovalStateRequested
		}
		action.CanApprove = action.State == FlowerApprovalStateRequested
	case FlowerApprovalStatusResolved:
		action.CanApprove = false
	}
	if action.Version <= 0 {
		action.Version = 1
	}
	if action.SurfaceEpoch <= 0 {
		action.SurfaceEpoch = 1
	}
	return action
}

func delegatedApprovalRef(parent *run, child *run, req fltools.ApprovalRequest) DelegatedApprovalRef {
	subagentID := firstNonEmptyString(
		strings.TrimSpace(child.threadID),
		strings.TrimSpace(req.Labels["host."+subagentToolHostContextSubagentIDKey]),
		strings.TrimSpace(req.Labels["host."+subagentToolHostContextChildThreadIDKey]),
		strings.TrimSpace(req.HostContext[subagentToolHostContextSubagentIDKey]),
		strings.TrimSpace(req.HostContext[subagentToolHostContextChildThreadIDKey]),
	)
	childRunID := firstNonEmptyString(subagentID, strings.TrimSpace(child.threadID), strings.TrimSpace(req.ID), strings.TrimSpace(req.ApprovalID))
	return DelegatedApprovalRef{
		ParentThreadID:  strings.TrimSpace(parent.threadID),
		ParentRunID:     strings.TrimSpace(parent.id),
		ParentTurnID:    strings.TrimSpace(parent.messageID),
		SubagentID:      subagentID,
		ChildThreadID:   firstNonEmptyString(strings.TrimSpace(child.threadID), subagentID),
		ChildRunID:      childRunID,
		ChildTurnID:     strings.TrimSpace(child.messageID),
		ChildToolCallID: firstNonEmptyString(strings.TrimSpace(req.ID), strings.TrimSpace(req.ApprovalID)),
		ApprovalID:      firstNonEmptyString(strings.TrimSpace(req.ApprovalID), strings.TrimSpace(req.ID)),
	}
}

func validDelegatedApprovalRef(ref DelegatedApprovalRef) bool {
	return strings.TrimSpace(ref.ParentThreadID) != "" &&
		strings.TrimSpace(ref.ParentRunID) != "" &&
		strings.TrimSpace(ref.SubagentID) != "" &&
		strings.TrimSpace(ref.ChildThreadID) != "" &&
		strings.TrimSpace(ref.ChildRunID) != "" &&
		strings.TrimSpace(ref.ChildToolCallID) != "" &&
		strings.TrimSpace(ref.ApprovalID) != ""
}

func delegatedApprovalAction(parent *run, child *run, req fltools.ApprovalRequest, ref DelegatedApprovalRef, actionID string, requestedAt int64, expiresAt int64) FlowerApprovalAction {
	args := floretApprovalArgs(req)
	toolName := strings.TrimSpace(req.Name)
	if toolName == "" {
		toolName = "tool"
	}
	approval := &toolApprovalRequest{
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
	description := toolApprovalDescription(approval)
	if subagent := strings.TrimSpace(ref.SubagentID); subagent != "" {
		description = "Subagent " + subagent + " requests approval. " + description
	}
	return FlowerApprovalAction{
		ActionID:            actionID,
		Origin:              FlowerApprovalOriginDelegatedSubagent,
		RunID:               strings.TrimSpace(parent.id),
		TurnID:              strings.TrimSpace(parent.messageID),
		ToolID:              strings.TrimSpace(ref.ChildToolCallID),
		ToolName:            toolName,
		State:               FlowerApprovalStateRequested,
		Status:              FlowerApprovalStatusPending,
		Revision:            1,
		Version:             1,
		SurfaceEpoch:        1,
		SurfaceRole:         FlowerApprovalSurfacePrimaryAction,
		Scope:               delegatedApprovalScopeThreadDelegatedWait,
		RequestedAtMs:       requestedAt,
		ExpiresAtMs:         expiresAt,
		CanApprove:          true,
		DelegatedRef:        &ref,
		DeliveryState:       FlowerApprovalDeliveryWaiting,
		ChildExecutionState: FlowerApprovalChildExecutionPending,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalLabel(toolName),
			Description: description,
			Command:     strings.TrimSpace(approval.command),
			Cwd:         strings.TrimSpace(approval.cwd),
			Effects:     toolApprovalSummaryEffects(toolName, approval),
			Flags:       append([]string(nil), approval.flags...),
			Targets:     append([]FlowerSafeTarget(nil), approval.targets...),
		},
		StepID: delegatedApprovalArgsHash(args),
	}
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
