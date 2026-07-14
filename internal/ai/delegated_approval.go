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
		allow := h.allow
		decided := h.decided
		canceled := h.canceled
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
	if h == nil || h.promoted == nil {
		return
	}
	h.promotedOnce.Do(func() { close(h.promoted) })
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
	close(h.done)
	h.decided = true
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
	if err := s.validateDelegatedApprovalSnapshotIdentity(parent, ref); err != nil {
		return nil, false, err
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
		err := s.threadsDB.UpsertDelegatedApprovalRequest(ctx, delegatedApprovalRecordFromAction(strings.TrimSpace(parent.endpointID), runUserPublicID(parent), action))
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
		promoted:   make(chan struct{}),
		action:     action,
		endpointID: strings.TrimSpace(parent.endpointID),
		parentUser: runUserPublicID(parent),
	}
	s.delegatedApprovals[actionID] = handle
	s.mu.Unlock()

	event := s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: strings.TrimSpace(parent.endpointID),
		ThreadID:   strings.TrimSpace(parent.threadID),
		RunID:      strings.TrimSpace(parent.id),
		TurnID:     strings.TrimSpace(parent.messageID),
		Kind:       FlowerLiveApprovalRequested,
		Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: action}),
	})
	var payload FlowerLiveApprovalPayload
	if decodeFlowerPayload(event.Payload, &payload) && payload.Action.ActionID == actionID {
		handle.mu.Lock()
		handle.action = payload.Action
		handle.mu.Unlock()
		if s.threadsDB != nil {
			ctx, cancel := s.delegatedApprovalPersistContext()
			updated, err := s.threadsDB.UpdatePendingDelegatedApprovalPresentation(ctx, delegatedApprovalRecordFromAction(strings.TrimSpace(parent.endpointID), runUserPublicID(parent), payload.Action))
			cancel()
			if err != nil || !updated {
				reason := "failed to persist delegated approval queue state"
				if err != nil {
					reason = err.Error()
				}
				s.markDelegatedApprovalUnavailable(actionID, reason)
				if err != nil {
					return nil, false, err
				}
				return nil, false, errors.New(reason)
			}
		}
	}
	return handle, true, nil
}

func (s *Service) validateDelegatedApprovalSnapshotIdentity(parent *run, ref DelegatedApprovalRef) error {
	if s == nil || s.threadsDB == nil || parent == nil {
		return nil
	}
	endpointID := strings.TrimSpace(parent.endpointID)
	childThreadID := strings.TrimSpace(ref.ChildThreadID)
	childRunID := strings.TrimSpace(ref.ChildRunID)
	if endpointID == "" || childThreadID == "" || childRunID == "" {
		return nil
	}
	ctx, cancel := s.delegatedApprovalPersistContext()
	_, ok, err := s.threadsDB.GetFinalizedChildPermissionSnapshot(ctx, endpointID, childThreadID, childRunID)
	cancel()
	if err != nil {
		return err
	}
	if !ok {
		ctx, cancel = s.delegatedApprovalPersistContext()
		rec, byThreadOK, byThreadErr := s.threadsDB.GetFinalizedChildPermissionSnapshotByThread(ctx, endpointID, childThreadID)
		cancel()
		if byThreadErr != nil {
			return byThreadErr
		}
		if byThreadOK && strings.TrimSpace(rec.ChildRunID) != childRunID {
			return errors.New("delegated approval child run identity mismatch")
		}
		return errors.New("delegated approval child permission snapshot missing")
	}
	return nil
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
	queueErr := s.validateApprovalQueueSubmissionLocked(endpointID, threadID, actionID, req.QueueGeneration, req.QueueRevision)
	var liveAction FlowerApprovalAction
	if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil && stream.State.ApprovalActions != nil {
		liveAction = stream.State.ApprovalActions[actionID]
	}
	handle := s.delegatedApprovals[actionID]
	s.mu.Unlock()

	if req.ExpectedSeq > 0 && req.ExpectedSeq > cursor {
		return nil, approvalConflict("approval cursor changed")
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
			return nil, approvalConflict("delegated approval is no longer available")
		}
		storedRec = rec
		if !delegatedApprovalOwnerMatches(meta, rec.ParentUserPublicID) {
			return nil, errors.New("run not found")
		}
		storedAction = delegatedApprovalActionFromRecord(rec)
		if storedAction.ActionID == "" {
			return nil, approvalConflict("delegated approval changed")
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
			return nil, approvalConflict("delegated approval is no longer pending")
		}
	}
	if queueErr != nil {
		return nil, queueErr
	}
	if handle == nil {
		if s.threadsDB != nil {
			s.markDelegatedApprovalRecordUnavailable(endpointID, threadID, actionID, "delegated approval channel is unavailable")
		}
		return nil, approvalConflict("delegated approval is no longer available")
	}
	if s.threadsDB == nil && !delegatedApprovalOwnerMatches(meta, handle.parentUser) {
		return nil, errors.New("run not found")
	}
	if liveAction.ActionID == "" {
		return nil, approvalConflict("delegated approval changed")
	}
	if liveAction.Origin != FlowerApprovalOriginDelegatedSubagent {
		return nil, errors.New("approval action is not delegated")
	}
	if liveAction.Status != FlowerApprovalStatusPending || liveAction.State != FlowerApprovalStateRequested {
		return nil, approvalConflict("approval is no longer pending")
	}
	if !liveAction.CanApprove {
		return nil, approvalConflict(firstNonEmptyString(liveAction.ReadOnlyReason, "approval is not available"))
	}
	if liveAction.Version != req.Version || liveAction.SurfaceEpoch != req.SurfaceEpoch {
		return nil, approvalConflict("approval version changed")
	}
	if liveAction.DelegatedRef == nil {
		return nil, approvalConflict("delegated approval changed")
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
			RefHash:          delegatedApprovalRefHash(*req.DelegatedRef),
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
			return nil, approvalConflict("delegated approval decision conflicts with an earlier submission")
		}
		if !result.Accepted {
			return nil, approvalConflict("delegated approval changed")
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
		return nil, normalizeApprovalDecisionError(err, "delegated approval decision was already resolved")
	}
	resolved.Status = FlowerApprovalStatusResolved
	resolved.DeliveryState = FlowerApprovalDeliveryDelivered
	if s.threadsDB != nil {
		version := resolved.Version
		if storedRec.Version > 0 {
			version = storedRec.Version
		}
		ctx, cancel := s.delegatedApprovalPersistContext()
		changed, err := s.threadsDB.MarkDelegatedApprovalDelivered(ctx, endpointID, threadID, actionID, version, string(mustFlowerPayload(resolved)), time.Now().UnixMilli())
		cancel()
		if err != nil {
			return nil, err
		}
		if !changed {
			s.mu.Lock()
			delete(s.delegatedApprovals, actionID)
			s.mu.Unlock()
			ackUnknown := resolved
			ackUnknown.DeliveryState = FlowerApprovalDeliveryAckUnknown
			ackUnknown.ReadOnlyReason = "Delegated approval was released to the subagent, but delivery acknowledgement could not be confirmed."
			ackUnknown.Version = version + 1
			ctx, cancel = s.delegatedApprovalPersistContext()
			ackChanged, ackErr := s.threadsDB.MarkDelegatedApprovalAckUnknown(ctx, endpointID, threadID, actionID, ackUnknown.ReadOnlyReason, string(mustFlowerPayload(ackUnknown)), time.Now().UnixMilli())
			cancel()
			if ackErr != nil {
				return nil, ackErr
			}
			if !ackChanged {
				return nil, approvalConflict("delegated approval delivery state changed")
			}
			event := s.appendFlowerLiveEvent(FlowerLiveEvent{
				EndpointID: endpointID,
				ThreadID:   threadID,
				RunID:      delegatedApprovalParentRunID(ackUnknown),
				TurnID:     strings.TrimSpace(ackUnknown.TurnID),
				Kind:       FlowerLiveApprovalResolved,
				Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: ackUnknown}),
			})
			return &SubmitFlowerApprovalResponse{OK: true, CurrentCursor: event.Seq}, nil
		}
	}

	s.mu.Lock()
	delete(s.delegatedApprovals, actionID)
	s.mu.Unlock()

	event := s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID,
		ThreadID:   threadID,
		RunID:      delegatedApprovalParentRunID(resolved),
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
		RefHash:          delegatedApprovalRefHash(*req.DelegatedRef),
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
		return nil, true, approvalConflict("delegated approval decision conflicts with an earlier submission")
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
	handle.cancel()
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
		RunID:      delegatedApprovalParentRunID(action),
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
		RunID:      delegatedApprovalParentRunID(action),
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

func delegatedApprovalRecordFromAction(endpointID string, parentUserPublicID string, action FlowerApprovalAction) threadstore.DelegatedApprovalRecord {
	rec := threadstore.DelegatedApprovalRecord{
		ActionID:            strings.TrimSpace(action.ActionID),
		EndpointID:          strings.TrimSpace(endpointID),
		ParentUserPublicID:  strings.TrimSpace(parentUserPublicID),
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
	if meta == nil {
		return false
	}
	return strings.TrimSpace(parentUserPublicID) != "" &&
		strings.TrimSpace(meta.UserPublicID) != "" &&
		strings.TrimSpace(parentUserPublicID) == strings.TrimSpace(meta.UserPublicID)
}

func delegatedApprovalActionFromRecord(rec threadstore.DelegatedApprovalRecord) FlowerApprovalAction {
	var action FlowerApprovalAction
	_ = json.Unmarshal([]byte(strings.TrimSpace(rec.ActionJSON)), &action)
	action.ActionID = firstNonEmptyString(strings.TrimSpace(action.ActionID), strings.TrimSpace(rec.ActionID))
	action.Origin = FlowerApprovalOriginDelegatedSubagent
	action.RunID = ""
	action.TurnID = firstNonEmptyString(strings.TrimSpace(action.TurnID), strings.TrimSpace(rec.ParentTurnID))
	action.ToolID = ""
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

func delegatedApprovalParentRunID(action FlowerApprovalAction) string {
	if runID := strings.TrimSpace(action.RunID); runID != "" {
		return runID
	}
	if action.DelegatedRef != nil {
		return strings.TrimSpace(action.DelegatedRef.ParentRunID)
	}
	return ""
}

func delegatedApprovalRef(parent *run, child *run, req fltools.ApprovalRequest) DelegatedApprovalRef {
	subagentID := firstNonEmptyString(
		strings.TrimSpace(child.threadID),
		strings.TrimSpace(req.Labels["host."+subagentToolHostContextSubagentIDKey]),
		strings.TrimSpace(req.Labels["host."+subagentToolHostContextChildThreadIDKey]),
		strings.TrimSpace(req.HostContext[subagentToolHostContextSubagentIDKey]),
		strings.TrimSpace(req.HostContext[subagentToolHostContextChildThreadIDKey]),
	)
	childThreadID := firstNonEmptyString(strings.TrimSpace(child.threadID), subagentID)
	childRunID := delegatedApprovalChildRunID(child, req, childThreadID, strings.TrimSpace(parent.id))
	return DelegatedApprovalRef{
		ParentThreadID:  strings.TrimSpace(parent.threadID),
		ParentRunID:     strings.TrimSpace(parent.id),
		ParentTurnID:    strings.TrimSpace(parent.messageID),
		SubagentID:      subagentID,
		ChildThreadID:   childThreadID,
		ChildRunID:      childRunID,
		ChildTurnID:     strings.TrimSpace(child.messageID),
		ChildToolCallID: firstNonEmptyString(strings.TrimSpace(req.ID), strings.TrimSpace(req.ApprovalID)),
		ApprovalID:      firstNonEmptyString(strings.TrimSpace(req.ApprovalID), strings.TrimSpace(req.ID)),
	}
}

func delegatedApprovalChildRunID(child *run, req fltools.ApprovalRequest, childThreadID string, parentRunID string) string {
	explicit := firstNonEmptyString(
		strings.TrimSpace(req.HostContext[subagentToolHostContextChildRunIDKey]),
		strings.TrimSpace(req.Labels["host."+subagentToolHostContextChildRunIDKey]),
	)
	if explicit != "" && explicit != strings.TrimSpace(childThreadID) && explicit != strings.TrimSpace(parentRunID) {
		return explicit
	}
	return ""
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
	command := strings.TrimSpace(approval.command)
	cwd := strings.TrimSpace(approval.cwd)
	targets := append([]FlowerSafeTarget(nil), approval.targets...)
	return FlowerApprovalAction{
		ActionID:            actionID,
		Origin:              FlowerApprovalOriginDelegatedSubagent,
		TurnID:              strings.TrimSpace(parent.messageID),
		ToolName:            toolName,
		State:               FlowerApprovalStateRequested,
		Status:              FlowerApprovalStatusPending,
		Revision:            1,
		Version:             1,
		SurfaceEpoch:        1,
		SurfaceRole:         FlowerApprovalSurfacePrimaryAction,
		Scope:               delegatedApprovalScopeThreadDelegatedWait,
		RequestedAtMs:       requestedAt,
		ExpiresAtMs:         0,
		CanApprove:          true,
		BatchIndex:          req.BatchIndex,
		BatchSize:           max(1, req.BatchSize),
		DelegatedRef:        &ref,
		DeliveryState:       FlowerApprovalDeliveryWaiting,
		ChildExecutionState: FlowerApprovalChildExecutionPending,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalDisplayLabel(toolName, toolApprovalPresentationArgs(toolName, command, cwd, targets)),
			Description: description,
			Command:     command,
			Cwd:         cwd,
			Effects:     toolApprovalSummaryEffects(toolName, approval),
			Flags:       append([]string(nil), approval.flags...),
			Targets:     targets,
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
