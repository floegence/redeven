package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
)

const flowerLiveEventBufferLimit = 5000

type flowerLiveThreadStream struct {
	NextSeq           int64
	NextApprovalOrder int64
	Events            []FlowerLiveEvent
	State             FlowerLiveMaterializedState
	ApprovalIndex     map[string]FlowerApprovalState
}

func newFlowerLiveThreadStream() *flowerLiveThreadStream {
	return &flowerLiveThreadStream{
		NextSeq:           1,
		NextApprovalOrder: 1,
		State: FlowerLiveMaterializedState{
			Messages:            map[string]FlowerLiveMessageDraft{},
			Runs:                map[string]FlowerLiveRunState{},
			ApprovalActions:     map[string]FlowerApprovalAction{},
			ApprovalActionsSeen: true,
			InputRequests:       map[string]RequestUserInputPrompt{},
		},
		ApprovalIndex: map[string]FlowerApprovalState{},
	}
}

func cloneFlowerApprovalQueue(in *FlowerApprovalQueue) *FlowerApprovalQueue {
	if in == nil {
		return nil
	}
	out := *in
	return &out
}

func (s *Service) threadHasPendingApprovals(endpointID string, threadID string) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	stream := s.flowerLiveByThread[runThreadKey(strings.TrimSpace(endpointID), strings.TrimSpace(threadID))]
	return stream != nil && stream.State.ApprovalQueue != nil && stream.State.ApprovalQueue.UnresolvedCount > 0
}

func (s *Service) promoteCurrentApprovalWaiterLocked(queue *FlowerApprovalQueue, actions map[string]FlowerApprovalAction) {
	if s == nil || queue == nil || strings.TrimSpace(queue.CurrentActionID) == "" {
		return
	}
	action := actions[strings.TrimSpace(queue.CurrentActionID)]
	if action.ActionID == "" {
		return
	}
	if action.Origin == FlowerApprovalOriginDelegatedSubagent {
		if handle := s.delegatedApprovals[action.ActionID]; handle != nil {
			handle.promote()
		}
		return
	}
	if r := s.runs[strings.TrimSpace(action.RunID)]; r != nil {
		r.promoteToolApproval(action.ToolID)
	}
}

func (s *Service) validateApprovalQueueSubmissionLocked(endpointID string, threadID string, actionID string, generation int64, revision int64) error {
	stream := s.flowerLiveByThread[runThreadKey(strings.TrimSpace(endpointID), strings.TrimSpace(threadID))]
	if stream == nil || stream.State.ApprovalQueue == nil {
		return approvalConflict("approval queue is no longer available")
	}
	queue := stream.State.ApprovalQueue
	if generation <= 0 || revision <= 0 || queue.Generation != generation || queue.Revision != revision {
		return approvalConflict("approval queue changed")
	}
	if strings.TrimSpace(queue.CurrentActionID) != strings.TrimSpace(actionID) {
		return approvalConflict("approval action is not the current queue item")
	}
	return nil
}

func (s *Service) cancelThreadApprovalQueueLocked(endpointID string, threadID string, reason string) []FlowerApprovalAction {
	stream := s.flowerLiveByThread[runThreadKey(strings.TrimSpace(endpointID), strings.TrimSpace(threadID))]
	if stream == nil || stream.State.ApprovalQueue == nil || stream.State.ApprovalQueue.UnresolvedCount == 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	delegated := make([]FlowerApprovalAction, 0)
	actionIDs := make([]string, 0, stream.State.ApprovalQueue.UnresolvedCount)
	for actionID, action := range stream.State.ApprovalActions {
		if action.Status == FlowerApprovalStatusPending && action.State == FlowerApprovalStateRequested {
			actionIDs = append(actionIDs, actionID)
		}
	}
	sort.Slice(actionIDs, func(i, j int) bool {
		return stream.State.ApprovalActions[actionIDs[i]].QueueOrder < stream.State.ApprovalActions[actionIDs[j]].QueueOrder
	})
	for _, actionID := range actionIDs {
		action := stream.State.ApprovalActions[actionID]
		if action.Origin == FlowerApprovalOriginDelegatedSubagent {
			if handle := s.delegatedApprovals[actionID]; handle != nil {
				handle.cancel()
				delete(s.delegatedApprovals, actionID)
			}
			action.DeliveryState = FlowerApprovalDeliveryUnavailable
			action.Version++
		}
		action.State = FlowerApprovalStateCanceled
		action.Status = FlowerApprovalStatusResolved
		action.CanApprove = false
		action.ResolvedAtMs = now
		action.ReadOnlyReason = strings.TrimSpace(reason)
		if action.Origin == FlowerApprovalOriginDelegatedSubagent {
			delegated = append(delegated, action)
		}
		event := FlowerLiveEvent{
			SchemaVersion: FlowerLiveSchemaVersion,
			EndpointID:    endpointID,
			ThreadID:      threadID,
			RunID:         action.RunID,
			TurnID:        action.TurnID,
			AtUnixMs:      now,
			Kind:          FlowerLiveApprovalResolved,
			Payload:       mustFlowerPayload(FlowerLiveApprovalPayload{Action: action}),
		}
		event = appendFlowerLiveEventLocked(stream, event)
		applyFlowerLiveEventToMaterializedState(&stream.State, stream.ApprovalIndex, event)
	}
	stream.State.ApprovalQueue.CurrentActionID = ""
	stream.State.ApprovalQueue.CurrentPosition = 0
	stream.State.ApprovalQueue.UnresolvedCount = 0
	normalizeFlowerApprovalQueueActions(&stream.State)
	return delegated
}

func (s *Service) GetFlowerThreadLiveBootstrap(ctx context.Context, meta *session.Meta, threadID string) (*FlowerLiveBootstrapResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}

	thread, err := s.GetThread(ctx, meta, threadID)
	if err != nil {
		return nil, err
	}
	if thread == nil {
		return nil, sql.ErrNoRows
	}
	subagents, err := s.listFlowerSubagentsForEndpoint(ctx, strings.TrimSpace(meta.EndpointID), threadID)
	if err != nil {
		return nil, err
	}
	thread.Subagents = subagents

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	s.mu.Lock()
	state := s.flowerLiveMaterializedStateLocked(endpointID, threadID)
	streamGeneration := s.flowerLiveStreamGenerationValue()
	s.mu.Unlock()

	canonicalContextState, err := s.flowerLiveCanonicalContextState(ctx, endpointID, threadID)
	if err != nil {
		return nil, err
	}
	state = mergeFlowerLiveCanonicalContextState(state, canonicalContextState)
	normalizeFlowerApprovalQueueActions(&state)

	timeline, err := s.buildFlowerTimelineProjection(ctx, endpointID, threadID, state)
	if err != nil {
		return nil, err
	}
	// buildFlowerTimelineProjection may have invalidated stale drafts and
	// emitted a resync event. The bootstrap state was copied before that
	// reconciliation, so reflect the stream's current messages and cursor.
	s.mu.Lock()
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	retainedFromSeq := s.flowerLiveRetainedFromSeqLocked(endpointID, threadID)
	state.Messages = s.flowerLiveMaterializedStateLocked(endpointID, threadID).Messages
	s.mu.Unlock()
	state.TimelineDecorations = timeline.TimelineDecorations

	return &FlowerLiveBootstrapResponse{
		SchemaVersion:    FlowerLiveSchemaVersion,
		EndpointID:       endpointID,
		ThreadID:         threadID,
		StreamGeneration: streamGeneration,
		Cursor:           cursor,
		RetainedFromSeq:  retainedFromSeq,
		Thread:           *thread,
		TimelineMessages: timeline.Messages,
		LiveState:        state,
		GeneratedAtMs:    time.Now().UnixMilli(),
	}, nil
}

func visibleResolvedDelegatedApprovalAction(action FlowerApprovalAction) bool {
	if action.Origin != FlowerApprovalOriginDelegatedSubagent {
		return false
	}
	switch action.DeliveryState {
	case FlowerApprovalDeliveryPending,
		FlowerApprovalDeliveryDelivered,
		FlowerApprovalDeliveryFailed,
		FlowerApprovalDeliveryAckUnknown,
		FlowerApprovalDeliveryUnavailable:
		return true
	default:
		return false
	}
}

func (s *Service) ListFlowerThreadLiveEvents(ctx context.Context, meta *session.Meta, threadID string, afterSeq int64, limit int) (*FlowerLiveEventsResponse, error) {
	_ = ctx
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil, errors.New("missing thread_id")
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if afterSeq < 0 {
		afterSeq = 0
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	threadKey := runThreadKey(endpointID, threadID)
	if threadKey == "" {
		return nil, errors.New("invalid request")
	}

	s.mu.Lock()
	stream := s.flowerLiveByThread[threadKey]
	streamGeneration := s.flowerLiveStreamGenerationValue()
	if stream == nil {
		s.mu.Unlock()
		if afterSeq > 0 {
			event := flowerLiveResyncEvent(endpointID, threadID, afterSeq, "cursor_expired")
			return &FlowerLiveEventsResponse{StreamGeneration: streamGeneration, Events: []FlowerLiveEvent{event}, NextCursor: afterSeq, RetainedFromSeq: 0}, nil
		}
		return &FlowerLiveEventsResponse{StreamGeneration: streamGeneration, Events: []FlowerLiveEvent{}, NextCursor: 0, RetainedFromSeq: 0}, nil
	}

	nextCursor := stream.NextSeq - 1
	retainedFromSeq := int64(0)
	if len(stream.Events) > 0 {
		retainedFromSeq = stream.Events[0].Seq
	}
	if afterSeq > 0 && retainedFromSeq > 0 && afterSeq < retainedFromSeq {
		event := flowerLiveResyncEvent(endpointID, threadID, afterSeq, "cursor_expired")
		s.mu.Unlock()
		return &FlowerLiveEventsResponse{StreamGeneration: streamGeneration, Events: []FlowerLiveEvent{event}, NextCursor: afterSeq, RetainedFromSeq: retainedFromSeq}, nil
	}

	events := make([]FlowerLiveEvent, 0, limit)
	for _, event := range stream.Events {
		if event.Seq <= afterSeq {
			continue
		}
		events = append(events, cloneFlowerLiveEvent(event))
		if len(events) >= limit {
			break
		}
	}
	hasMore := false
	if len(events) > 0 {
		lastSeq := events[len(events)-1].Seq
		for _, event := range stream.Events {
			if event.Seq > lastSeq {
				hasMore = true
				break
			}
		}
		nextCursor = lastSeq
	}
	s.mu.Unlock()

	return &FlowerLiveEventsResponse{StreamGeneration: streamGeneration, Events: events, NextCursor: nextCursor, HasMore: hasMore, RetainedFromSeq: retainedFromSeq}, nil
}

func (s *Service) flowerLiveCanonicalContextState(ctx context.Context, endpointID string, threadID string) (FlowerLiveMaterializedState, error) {
	if s == nil {
		return emptyFlowerLiveMaterializedState(), errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return emptyFlowerLiveMaterializedState(), errors.New("invalid request")
	}
	host, err := s.openFloretThreadReadHost(ctx, threadID)
	if err != nil {
		return emptyFlowerLiveMaterializedState(), err
	}
	snapshot, err := host.ReadThreadContext(ctx, flruntime.ThreadID(threadID))
	if err != nil {
		return emptyFlowerLiveMaterializedState(), err
	}
	if err := snapshot.Validate(); err != nil {
		return emptyFlowerLiveMaterializedState(), err
	}
	state := emptyFlowerLiveMaterializedState()
	if snapshot.Usage != nil {
		usage, err := flowerContextUsageFromFloret(snapshot.Usage)
		if err != nil {
			return emptyFlowerLiveMaterializedState(), err
		}
		state.ContextUsage = &usage
	}
	state.ContextCompactions = make([]FlowerContextCompaction, 0, len(snapshot.Compactions))
	for i := range snapshot.Compactions {
		compaction, err := flowerContextCompactionFromFloret(&snapshot.Compactions[i])
		if err != nil {
			return emptyFlowerLiveMaterializedState(), err
		}
		state.ContextCompactions = append(state.ContextCompactions, compaction)
	}
	return state, nil
}

func mergeFlowerLiveCanonicalContextState(live FlowerLiveMaterializedState, canonical FlowerLiveMaterializedState) FlowerLiveMaterializedState {
	out := cloneFlowerLiveMaterializedState(live)
	if canonical.ContextUsage != nil && (out.ContextUsage == nil || canonical.ContextUsage.UpdatedAtMs > out.ContextUsage.UpdatedAtMs) {
		out.ContextUsage = cloneFlowerContextUsage(canonical.ContextUsage)
	}
	for _, compaction := range canonical.ContextCompactions {
		out.ContextCompactions = mergeFlowerContextCompaction(out.ContextCompactions, compaction)
	}
	for _, decoration := range canonical.TimelineDecorations {
		out.TimelineDecorations = mergeFlowerTimelineDecoration(out.TimelineDecorations, decoration)
	}
	return out
}

func mergeFlowerContextCompaction(compactions []FlowerContextCompaction, persisted FlowerContextCompaction) []FlowerContextCompaction {
	operationID := strings.TrimSpace(persisted.OperationID)
	if operationID == "" {
		return compactions
	}
	out := cloneFlowerContextCompactions(compactions)
	for i, compaction := range out {
		if strings.TrimSpace(compaction.OperationID) == operationID {
			if persisted.UpdatedAtMs > compaction.UpdatedAtMs {
				out[i] = persisted
			}
			return out
		}
	}
	return append(out, persisted)
}

func mergeFlowerTimelineDecoration(decorations []FlowerTimelineDecoration, persisted FlowerTimelineDecoration) []FlowerTimelineDecoration {
	decorationID := strings.TrimSpace(persisted.DecorationID)
	if decorationID == "" {
		return decorations
	}
	out := cloneFlowerTimelineDecorations(decorations)
	for i, decoration := range out {
		if strings.TrimSpace(decoration.DecorationID) == decorationID {
			if persisted.Compaction.UpdatedAtMs > decoration.Compaction.UpdatedAtMs {
				persisted.Anchor = decoration.Anchor
				persisted.Ordinal = decoration.Ordinal
				out[i] = persisted
			}
			return out
		}
	}
	return append(out, persisted)
}

type flowerTimelineProjection struct {
	Messages            []FlowerTimelineMessage
	TimelineDecorations []FlowerTimelineDecoration
}

func (s *Service) buildFlowerTimelineProjection(ctx context.Context, endpointID string, threadID string, state FlowerLiveMaterializedState) (flowerTimelineProjection, error) {
	if s == nil {
		return flowerTimelineProjection{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return flowerTimelineProjection{}, errors.New("invalid request")
	}

	msgs, err := s.loadThreadTimelineMessages(ctx, endpointID, threadID)
	if err != nil {
		return flowerTimelineProjection{}, err
	}
	type canonicalTurnRef struct {
		runID  string
		status flruntime.TurnStatus
	}
	canonicalTurns := make(map[string]canonicalTurnRef, len(msgs)/2+1)
	canonicalAssistant := make(map[string]struct{}, len(msgs)/2+1)
	projectionDecorations := make([]FlowerTimelineDecoration, 0)
	for _, msg := range msgs {
		turnID := strings.TrimSpace(msg.CanonicalTurn)
		if turnID != "" {
			canonicalTurns[turnID] = canonicalTurnRef{runID: strings.TrimSpace(msg.CanonicalRun), status: msg.TurnStatus}
			if strings.TrimSpace(msg.MessageID) == turnID && msg.Decoration == nil {
				canonicalAssistant[turnID] = struct{}{}
			}
		}
		if msg.Decoration != nil {
			if err := msg.Decoration.Validate(); err != nil {
				return flowerTimelineProjection{}, fmt.Errorf("invalid persisted timeline decoration: %w", err)
			}
			projectionDecorations = append(projectionDecorations, *msg.Decoration)
			continue
		}
		if len(msg.MessageJSON) == 0 {
			return flowerTimelineProjection{}, errors.New("timeline item has neither message nor decoration")
		}
	}
	activeMessageID := activeFlowerCursorMessageID(state)
	terminalDraftIDs := make([]string, 0)
	identityMismatch := false
	for key, draft := range state.Messages {
		messageID := strings.TrimSpace(key)
		ref, ok := canonicalTurns[messageID]
		if !ok || strings.TrimSpace(draft.MessageID) != messageID || strings.TrimSpace(draft.ThreadID) != threadID ||
			strings.TrimSpace(draft.TurnID) != messageID || strings.TrimSpace(draft.RunID) == "" || strings.TrimSpace(draft.RunID) != ref.runID {
			identityMismatch = true
			continue
		}
		if ref.status == flruntime.TurnStatusCompleted || ref.status == flruntime.TurnStatusFailed || ref.status == flruntime.TurnStatusCancelled {
			terminalDraftIDs = append(terminalDraftIDs, messageID)
		}
	}
	if identityMismatch {
		// A draft that cannot be matched to Floret has no trustworthy position or
		// lifecycle. Drop every live draft and rebuild from the canonical timeline;
		// the resync event tells connected clients to replace their materialized
		// state as well.
		s.triggerFlowerLiveTimelineResync(endpointID, threadID, "live_draft_canonical_identity_mismatch")
		state.Messages = map[string]FlowerLiveMessageDraft{}
	}
	if len(terminalDraftIDs) > 0 {
		s.mu.Lock()
		if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil {
			for _, messageID := range terminalDraftIDs {
				delete(stream.State.Messages, messageID)
			}
		}
		s.mu.Unlock()
		for _, messageID := range terminalDraftIDs {
			delete(state.Messages, messageID)
		}
	}
	usedDrafts := make(map[string]struct{}, len(state.Messages))
	out := make([]FlowerTimelineMessage, 0, len(msgs)+len(state.Messages))
	appendDraft := func(turnID string) error {
		draft, ok := state.Messages[turnID]
		if !ok {
			return nil
		}
		live, ok := flowerTimelineMessageFromLiveDraft(draft, activeMessageID)
		if !ok {
			return errors.New("canonical live draft is not renderable")
		}
		out = append(out, live)
		usedDrafts[turnID] = struct{}{}
		return nil
	}
	for _, msg := range msgs {
		if msg.Decoration != nil {
			continue
		}
		turnID := strings.TrimSpace(msg.CanonicalTurn)
		if strings.TrimSpace(msg.MessageID) == turnID {
			if _, ok := state.Messages[turnID]; ok {
				if err := appendDraft(turnID); err != nil {
					return flowerTimelineProjection{}, err
				}
				continue
			}
		}
		persisted, ok, err := flowerTimelineMessageFromRaw(msg.MessageID, "", "", msg.CreatedAt, msg.MessageJSON)
		if err != nil {
			return flowerTimelineProjection{}, err
		}
		if ok {
			persisted.ActiveCursor = persisted.MessageID == activeMessageID
			out = append(out, persisted)
		}
		if strings.TrimSpace(msg.MessageID) != turnID {
			if _, hasAssistant := canonicalAssistant[turnID]; !hasAssistant {
				if err := appendDraft(turnID); err != nil {
					return flowerTimelineProjection{}, err
				}
			}
		}
	}
	if len(usedDrafts) != len(state.Messages) {
		reason := "live_draft_missing_canonical_position"
		s.triggerFlowerLiveTimelineResync(endpointID, threadID, reason)
		return flowerTimelineProjection{}, fmt.Errorf("flower live timeline resync required: %s", reason)
	}
	decorations, err := mergeFlowerTimelineDecorationsStrict(state.TimelineDecorations, projectionDecorations)
	if err != nil {
		return flowerTimelineProjection{}, err
	}
	return flowerTimelineProjection{Messages: out, TimelineDecorations: decorations}, nil
}

func (s *Service) triggerFlowerLiveTimelineResync(endpointID string, threadID string, reason string) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	s.mu.Lock()
	if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil {
		stream.State.Messages = map[string]FlowerLiveMessageDraft{}
	}
	s.mu.Unlock()
	s.appendFlowerLiveEvent(flowerLiveResyncEvent(endpointID, threadID, 0, reason))
}

func (s *Service) buildFlowerTimelineMessages(ctx context.Context, endpointID string, threadID string, state FlowerLiveMaterializedState) ([]FlowerTimelineMessage, error) {
	projection, err := s.buildFlowerTimelineProjection(ctx, endpointID, threadID, state)
	if err != nil {
		return nil, err
	}
	return projection.Messages, nil
}

func mergeFlowerTimelineDecorationsStrict(current []FlowerTimelineDecoration, additions []FlowerTimelineDecoration) ([]FlowerTimelineDecoration, error) {
	out := cloneFlowerTimelineDecorations(current)
	indexByID := make(map[string]int, len(out))
	for i, decoration := range out {
		if err := decoration.Validate(); err != nil {
			return nil, fmt.Errorf("invalid live timeline decoration: %w", err)
		}
		indexByID[strings.TrimSpace(decoration.DecorationID)] = i
	}
	for _, decoration := range additions {
		if err := decoration.Validate(); err != nil {
			return nil, fmt.Errorf("invalid projected timeline decoration: %w", err)
		}
		decorationID := strings.TrimSpace(decoration.DecorationID)
		if i, ok := indexByID[decorationID]; ok {
			out[i] = decoration
			continue
		}
		indexByID[decorationID] = len(out)
		out = append(out, decoration)
	}
	return out, nil
}

func (s *Service) publishFlowerCanonicalTimelineReplacement(ctx context.Context, endpointID string, threadID string, runID string, turnID string, reason string) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return errors.New("invalid request")
	}

	s.mu.Lock()
	state := s.flowerLiveMaterializedStateLocked(endpointID, threadID)
	streamGeneration := s.flowerLiveStreamGenerationValue()
	snapshotThroughSeq := s.flowerLiveCursorLocked(endpointID, threadID)
	s.mu.Unlock()

	timeline, err := s.buildFlowerTimelineProjection(ctx, endpointID, threadID, state)
	if err != nil {
		return err
	}
	state.TimelineDecorations = timeline.TimelineDecorations
	payload := FlowerLiveTimelineReplacedPayload{
		Messages:            timeline.Messages,
		StreamGeneration:    streamGeneration,
		SnapshotThroughSeq:  snapshotThroughSeq,
		ThreadPatch:         cloneFlowerLiveThreadPatch(state.ThreadPatch),
		LiveState:           cloneFlowerLiveMaterializedState(state),
		ContextUsage:        cloneFlowerContextUsage(state.ContextUsage),
		ContextCompactions:  cloneFlowerContextCompactions(state.ContextCompactions),
		TimelineDecorations: cloneFlowerTimelineDecorations(timeline.TimelineDecorations),
	}
	s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: strings.TrimSpace(endpointID),
		ThreadID:   strings.TrimSpace(threadID),
		RunID:      strings.TrimSpace(runID),
		TurnID:     strings.TrimSpace(turnID),
		TraceID:    strings.TrimSpace(runID),
		Step:       strings.TrimSpace(reason),
		Kind:       FlowerLiveTimelineReplaced,
		Payload:    mustFlowerPayload(payload),
	})
	return nil
}

func (s *Service) replaceFlowerLiveDraftWithCanonicalTimeline(ctx context.Context, endpointID string, threadID string, runID string, turnID string, reason string) error {
	if s == nil {
		return errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	turnID = strings.TrimSpace(turnID)
	if endpointID == "" || threadID == "" || runID == "" || turnID == "" {
		return errors.New("invalid canonical timeline replacement identity")
	}
	identityMismatch := false
	s.mu.Lock()
	if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil {
		if draft, ok := stream.State.Messages[turnID]; ok {
			if strings.TrimSpace(draft.ThreadID) != threadID || strings.TrimSpace(draft.TurnID) != turnID ||
				strings.TrimSpace(draft.RunID) != runID || strings.TrimSpace(draft.MessageID) != turnID {
				identityMismatch = true
			} else {
				delete(stream.State.Messages, turnID)
			}
		}
	}
	s.mu.Unlock()
	if identityMismatch {
		s.triggerFlowerLiveTimelineResync(endpointID, threadID, "terminal_draft_canonical_identity_mismatch")
	}
	return s.publishFlowerCanonicalTimelineReplacement(ctx, endpointID, threadID, runID, turnID, reason)
}

func activeFlowerCursorMessageID(state FlowerLiveMaterializedState) string {
	for _, run := range state.Runs {
		status := NormalizeRunState(run.Status)
		if status == RunStateRunning || status == RunStateAccepted || status == RunStateRecovering || status == RunStateFinalizing {
			if id := strings.TrimSpace(run.MessageID); id != "" {
				return id
			}
		}
	}
	return ""
}

func flowerTimelineMessageFromRaw(messageID string, role string, status string, createdAtUnixMs int64, raw json.RawMessage) (FlowerTimelineMessage, bool, error) {
	var record struct {
		ID                 string            `json:"id"`
		Role               string            `json:"role"`
		Status             string            `json:"status"`
		Timestamp          int64             `json:"timestamp"`
		Blocks             []json.RawMessage `json:"blocks"`
		ContextAction      any               `json:"contextAction"`
		ContextActionSnake any               `json:"context_action"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return FlowerTimelineMessage{}, false, err
	}
	id := firstNonEmptyString(strings.TrimSpace(record.ID), strings.TrimSpace(messageID))
	if id == "" {
		return FlowerTimelineMessage{}, false, nil
	}
	blocks := make([]any, 0, len(record.Blocks))
	for _, block := range record.Blocks {
		var value any
		if err := json.Unmarshal(block, &value); err == nil && value != nil {
			blocks = append(blocks, value)
		}
	}
	contextAction := record.ContextAction
	if contextAction == nil {
		contextAction = record.ContextActionSnake
	}
	return FlowerTimelineMessage{
		MessageID:     id,
		Role:          firstNonEmptyString(strings.TrimSpace(record.Role), strings.TrimSpace(role)),
		Content:       flowerTimelineTextFromBlocks(blocks),
		Status:        firstNonEmptyString(strings.TrimSpace(record.Status), strings.TrimSpace(status)),
		CreatedAtMs:   firstPositiveInt64(record.Timestamp, createdAtUnixMs),
		Blocks:        blocks,
		ContextAction: contextAction,
		Live:          false,
		ActiveCursor:  false,
	}, true, nil
}

func flowerTimelineTextFromBlocks(blocks []any) string {
	parts := make([]string, 0, len(blocks))
	for _, block := range blocks {
		if text := assistantVisibleTextFromBlock(block); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "\n\n")
}

func flowerTimelineMessageFromLiveDraft(draft FlowerLiveMessageDraft, activeMessageID string) (FlowerTimelineMessage, bool) {
	messageID := strings.TrimSpace(draft.MessageID)
	if messageID == "" {
		return FlowerTimelineMessage{}, false
	}
	blocks := make([]any, 0, len(draft.Blocks))
	contentParts := make([]string, 0, len(draft.Blocks))
	for _, block := range draft.Blocks {
		value := flowerLiveBlockToTimelineBlock(block)
		if value != nil {
			blocks = append(blocks, value)
		}
		if text := flowerLiveBlockText(block); text != "" {
			contentParts = append(contentParts, text)
		}
	}
	status := firstNonEmptyString(strings.TrimSpace(draft.Status), "streaming")
	return FlowerTimelineMessage{
		MessageID:    messageID,
		Role:         firstNonEmptyString(strings.TrimSpace(draft.Role), "assistant"),
		Content:      strings.Join(contentParts, "\n\n"),
		Status:       status,
		CreatedAtMs:  draft.CreatedAtMs,
		Blocks:       blocks,
		Live:         true,
		ActiveCursor: messageID == strings.TrimSpace(activeMessageID) && status == "streaming",
	}, true
}

func flowerLiveBlockToTimelineBlock(block FlowerLiveBlock) any {
	blockType := strings.TrimSpace(block.Type)
	if blockType == "" {
		blockType = blockTypeFromRaw(block.Block)
	}
	if len(block.Block) > 0 {
		var value any
		if err := json.Unmarshal(block.Block, &value); err == nil {
			return value
		}
	}
	if blockType == "" {
		return nil
	}
	out := map[string]any{"type": blockType}
	if strings.TrimSpace(block.Content) != "" {
		out["content"] = block.Content
	}
	return out
}

func flowerLiveBlockText(block FlowerLiveBlock) string {
	switch strings.TrimSpace(block.Type) {
	case "markdown", "text":
		return strings.TrimSpace(block.Content)
	default:
		return ""
	}
}

func firstPositiveInt64(values ...int64) int64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func (s *Service) SubmitFlowerApproval(meta *session.Meta, req SubmitFlowerApprovalRequest) (*SubmitFlowerApprovalResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	runID := strings.TrimSpace(req.RunID)
	toolID := strings.TrimSpace(req.ToolID)
	actionID := strings.TrimSpace(req.ActionID)
	threadID := strings.TrimSpace(req.ThreadID)
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" || runID == "" || toolID == "" || actionID == "" || threadID == "" || req.ExpectedSeq <= 0 || req.Revision <= 0 || req.Version <= 0 || req.SurfaceEpoch <= 0 {
		if req.Origin == FlowerApprovalOriginDelegatedSubagent || req.DelegatedRef != nil {
			return s.submitDelegatedFlowerApproval(meta, req)
		}
		return nil, errors.New("invalid request")
	}

	s.mu.Lock()
	r := s.runs[runID]
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	queueErr := s.validateApprovalQueueSubmissionLocked(endpointID, threadID, actionID, req.QueueGeneration, req.QueueRevision)
	var liveAction FlowerApprovalAction
	if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil && stream.State.ApprovalActions != nil {
		liveAction = stream.State.ApprovalActions[actionID]
	}
	s.mu.Unlock()
	if queueErr != nil {
		return nil, queueErr
	}
	if req.Origin == FlowerApprovalOriginDelegatedSubagent || liveAction.Origin == FlowerApprovalOriginDelegatedSubagent || req.DelegatedRef != nil {
		return s.submitDelegatedFlowerApproval(meta, req)
	}
	if r == nil || strings.TrimSpace(r.endpointID) != endpointID || strings.TrimSpace(r.threadID) != threadID || r.isDetached() {
		return nil, errors.New("run not found")
	}
	if strings.TrimSpace(r.userPublicID) != strings.TrimSpace(meta.UserPublicID) {
		return nil, errors.New("run not found")
	}
	if req.ExpectedSeq > cursor {
		return nil, approvalConflict("approval cursor changed")
	}
	if liveAction.Origin == FlowerApprovalOriginControlConfirm || req.Origin == FlowerApprovalOriginControlConfirm {
		return s.submitControlConfirmationApproval(r, endpointID, threadID, runID, toolID, actionID, liveAction, req)
	}

	pending, ok, err := r.pendingFloretApproval(context.Background(), toolID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, approvalConflict("approval is no longer pending")
	}
	approval, err := r.flowerApprovalActionFromFloretPending(pending)
	if err != nil {
		return nil, err
	}
	if approval.ActionID != actionID {
		return nil, approvalConflict("approval action changed")
	}
	if liveAction.ActionID == "" || liveAction.RunID != runID || liveAction.ToolID != toolID {
		return nil, approvalConflict("approval action changed")
	}
	if liveAction.Status != FlowerApprovalStatusPending || liveAction.State != FlowerApprovalStateRequested {
		return nil, approvalConflict("approval is no longer pending")
	}
	if !liveAction.CanApprove {
		return nil, approvalConflict(firstNonEmptyString(liveAction.ReadOnlyReason, "approval is not available"))
	}
	if liveAction.Revision != req.Revision || liveAction.ExpectedSeq != req.ExpectedSeq {
		return nil, approvalConflict("approval revision changed")
	}
	if liveAction.Version != req.Version || liveAction.SurfaceEpoch != req.SurfaceEpoch {
		return nil, approvalConflict("approval version changed")
	}
	if approval.Revision != liveAction.Revision || approval.SurfaceEpoch != liveAction.SurfaceEpoch {
		return nil, approvalConflict("approval runtime state changed")
	}
	if !approval.CanApprove {
		return nil, approvalConflict(firstNonEmptyString(approval.ReadOnlyReason, "approval is not available"))
	}
	if err := r.approveTool(toolID, req.Approved); err != nil {
		return nil, normalizeApprovalDecisionError(err, "approval decision was already resolved")
	}

	state := FlowerApprovalStateRejected
	if req.Approved {
		state = FlowerApprovalStateApproved
	}
	approval = liveAction
	approval.State = state
	approval.Status = FlowerApprovalStatusResolved
	approval.CanApprove = false
	approval.ResolvedAtMs = time.Now().UnixMilli()
	resolved := s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID,
		ThreadID:   threadID,
		RunID:      runID,
		TurnID:     approval.TurnID,
		Kind:       FlowerLiveApprovalResolved,
		Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: approval}),
	})
	r.publishRunningAfterApprovalIfNoPending(approval.ActionID)
	return &SubmitFlowerApprovalResponse{OK: true, CurrentCursor: resolved.Seq}, nil
}

func (s *Service) submitControlConfirmationApproval(r *run, endpointID string, threadID string, runID string, toolID string, actionID string, liveAction FlowerApprovalAction, req SubmitFlowerApprovalRequest) (*SubmitFlowerApprovalResponse, error) {
	if s == nil || r == nil {
		return nil, errors.New("run not found")
	}
	if liveAction.ActionID == "" || liveAction.RunID != runID || liveAction.ToolID != toolID || liveAction.ActionID != actionID {
		return nil, approvalConflict("approval action changed")
	}
	if liveAction.Origin != FlowerApprovalOriginControlConfirm {
		return nil, approvalConflict("approval action changed")
	}
	if liveAction.Status != FlowerApprovalStatusPending || liveAction.State != FlowerApprovalStateRequested {
		return nil, approvalConflict("approval is no longer pending")
	}
	if !liveAction.CanApprove {
		return nil, approvalConflict(firstNonEmptyString(liveAction.ReadOnlyReason, "approval is not available"))
	}
	if liveAction.Revision != req.Revision || liveAction.ExpectedSeq != req.ExpectedSeq {
		return nil, approvalConflict("approval revision changed")
	}
	if liveAction.Version != req.Version || liveAction.SurfaceEpoch != req.SurfaceEpoch {
		return nil, approvalConflict("approval version changed")
	}
	if err := r.approveTool(toolID, req.Approved); err != nil {
		return nil, normalizeApprovalDecisionError(err, "approval decision was already resolved")
	}
	state := FlowerApprovalStateRejected
	if req.Approved {
		state = FlowerApprovalStateApproved
	}
	approval := liveAction
	approval.State = state
	approval.Status = FlowerApprovalStatusResolved
	approval.CanApprove = false
	approval.ResolvedAtMs = time.Now().UnixMilli()
	resolved := s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID,
		ThreadID:   threadID,
		RunID:      runID,
		TurnID:     approval.TurnID,
		Kind:       FlowerLiveApprovalResolved,
		Payload:    mustFlowerPayload(FlowerLiveApprovalPayload{Action: approval}),
	})
	r.publishRunningAfterApprovalIfNoPending(approval.ActionID)
	return &SubmitFlowerApprovalResponse{OK: true, CurrentCursor: resolved.Seq}, nil
}

func (s *Service) flowerLiveCursorLocked(endpointID string, threadID string) int64 {
	if s == nil {
		return 0
	}
	threadKey := runThreadKey(endpointID, threadID)
	if threadKey == "" {
		return 0
	}
	stream := s.flowerLiveByThread[threadKey]
	if stream == nil || stream.NextSeq <= 0 {
		return 0
	}
	return stream.NextSeq - 1
}

func (s *Service) flowerLiveRetainedFromSeqLocked(endpointID string, threadID string) int64 {
	if s == nil {
		return 0
	}
	threadKey := runThreadKey(endpointID, threadID)
	if threadKey == "" {
		return 0
	}
	stream := s.flowerLiveByThread[threadKey]
	if stream == nil || len(stream.Events) == 0 {
		return 0
	}
	return stream.Events[0].Seq
}

func (s *Service) flowerLiveMaterializedStateLocked(endpointID string, threadID string) FlowerLiveMaterializedState {
	threadKey := runThreadKey(endpointID, threadID)
	if threadKey == "" {
		return emptyFlowerLiveMaterializedState()
	}
	stream := s.flowerLiveByThread[threadKey]
	if stream == nil {
		return emptyFlowerLiveMaterializedState()
	}
	return cloneFlowerLiveMaterializedState(stream.State)
}

func emptyFlowerLiveMaterializedState() FlowerLiveMaterializedState {
	return FlowerLiveMaterializedState{
		Messages:            map[string]FlowerLiveMessageDraft{},
		Runs:                map[string]FlowerLiveRunState{},
		ModelIO:             nil,
		ContextUsage:        nil,
		ContextCompactions:  []FlowerContextCompaction{},
		TimelineDecorations: []FlowerTimelineDecoration{},
		ApprovalActions:     map[string]FlowerApprovalAction{},
		ApprovalActionsSeen: false,
		InputRequests:       map[string]RequestUserInputPrompt{},
	}
}

func (s *Service) appendFlowerLiveEvent(event FlowerLiveEvent) FlowerLiveEvent {
	if s == nil {
		return event
	}
	event.EndpointID = strings.TrimSpace(event.EndpointID)
	event.ThreadID = strings.TrimSpace(event.ThreadID)
	if event.EndpointID == "" || event.ThreadID == "" || event.Kind == "" {
		return event
	}
	if event.AtUnixMs <= 0 {
		event.AtUnixMs = time.Now().UnixMilli()
	}
	event.SchemaVersion = FlowerLiveSchemaVersion
	threadKey := runThreadKey(event.EndpointID, event.ThreadID)
	if threadKey == "" {
		return event
	}

	s.mu.Lock()
	if s.flowerLiveByThread == nil {
		s.flowerLiveByThread = map[string]*flowerLiveThreadStream{}
	}
	stream := s.flowerLiveByThread[threadKey]
	if stream == nil {
		stream = newFlowerLiveThreadStream()
		s.flowerLiveByThread[threadKey] = stream
	}
	event = s.flowerApprovalEventWithCurrentDeadlineLocked(stream, event)
	event = appendFlowerLiveEventLocked(stream, event)
	applyFlowerLiveEventToMaterializedState(&stream.State, stream.ApprovalIndex, event)
	normalizeFlowerApprovalQueueActions(&stream.State)
	if promoted, ok := s.flowerCurrentApprovalDeadlineEventLocked(stream, event); ok {
		promoted = appendFlowerLiveEventLocked(stream, promoted)
		applyFlowerLiveEventToMaterializedState(&stream.State, stream.ApprovalIndex, promoted)
		normalizeFlowerApprovalQueueActions(&stream.State)
	}
	s.promoteCurrentApprovalWaiterLocked(stream.State.ApprovalQueue, stream.State.ApprovalActions)
	if (event.Kind == FlowerLiveApprovalRequested || event.Kind == FlowerLiveApprovalResolved) && s.log != nil && stream.State.ApprovalQueue != nil {
		queue := stream.State.ApprovalQueue
		s.log.Debug("flower approval queue", "endpoint_id", event.EndpointID, "thread_id", event.ThreadID, "generation", queue.Generation, "revision", queue.Revision, "current_action_id", queue.CurrentActionID, "position", queue.CurrentPosition, "total", queue.Total, "unresolved", queue.UnresolvedCount)
	}
	s.mu.Unlock()
	return event
}

func (s *Service) flowerApprovalEventWithCurrentDeadlineLocked(stream *flowerLiveThreadStream, event FlowerLiveEvent) FlowerLiveEvent {
	if s == nil || stream == nil || event.Kind != FlowerLiveApprovalRequested {
		return event
	}
	var payload FlowerLiveApprovalPayload
	if !decodeFlowerPayload(event.Payload, &payload) || payload.Action.Status != FlowerApprovalStatusPending ||
		payload.Action.State != FlowerApprovalStateRequested || payload.Action.ExpiresAtMs > 0 {
		return event
	}
	actionID := strings.TrimSpace(payload.Action.ActionID)
	queue := stream.State.ApprovalQueue
	isCurrent := queue == nil || queue.UnresolvedCount == 0 || strings.TrimSpace(queue.CurrentActionID) == "" ||
		strings.TrimSpace(queue.CurrentActionID) == actionID
	if actionID == "" || !isCurrent {
		return event
	}
	timeout := s.approvalTimeout
	if timeout <= 0 {
		timeout = defaultToolApprovalTO
	}
	payload.Action.ExpiresAtMs = time.Now().Add(timeout).UnixMilli()
	event.Payload = mustFlowerPayload(payload)
	return event
}

func (s *Service) flowerCurrentApprovalDeadlineEventLocked(stream *flowerLiveThreadStream, cause FlowerLiveEvent) (FlowerLiveEvent, bool) {
	if s == nil || stream == nil || cause.Kind != FlowerLiveApprovalResolved || stream.State.ApprovalQueue == nil {
		return FlowerLiveEvent{}, false
	}
	actionID := strings.TrimSpace(stream.State.ApprovalQueue.CurrentActionID)
	action := stream.State.ApprovalActions[actionID]
	if actionID == "" || action.ActionID == "" || action.ExpiresAtMs > 0 {
		return FlowerLiveEvent{}, false
	}
	timeout := s.approvalTimeout
	if timeout <= 0 {
		timeout = defaultToolApprovalTO
	}
	action.ExpiresAtMs = time.Now().Add(timeout).UnixMilli()
	return FlowerLiveEvent{
		SchemaVersion: FlowerLiveSchemaVersion,
		EndpointID:    cause.EndpointID,
		ThreadID:      cause.ThreadID,
		RunID:         action.RunID,
		TurnID:        action.TurnID,
		TraceID:       cause.TraceID,
		Step:          action.StepID,
		AtUnixMs:      time.Now().UnixMilli(),
		Kind:          FlowerLiveApprovalRequested,
		Payload: mustFlowerPayload(FlowerLiveApprovalPayload{
			Action:        action,
			ApprovalQueue: cloneFlowerApprovalQueue(stream.State.ApprovalQueue),
		}),
	}, true
}

func appendFlowerLiveEventLocked(stream *flowerLiveThreadStream, event FlowerLiveEvent) FlowerLiveEvent {
	event.Seq = stream.NextSeq
	stream.NextSeq++
	event = normalizeFlowerApprovalQueueEventLocked(stream, event)
	event = flowerLiveEventWithAssignedSeqPayload(stream, event)
	event.Payload = cloneRawMessage(event.Payload)
	stream.Events = append(stream.Events, cloneFlowerLiveEvent(event))
	if len(stream.Events) > flowerLiveEventBufferLimit {
		copy(stream.Events, stream.Events[len(stream.Events)-flowerLiveEventBufferLimit:])
		stream.Events = stream.Events[:flowerLiveEventBufferLimit]
	}
	return event
}

func normalizeFlowerApprovalQueueEventLocked(stream *flowerLiveThreadStream, event FlowerLiveEvent) FlowerLiveEvent {
	if stream == nil || (event.Kind != FlowerLiveApprovalRequested && event.Kind != FlowerLiveApprovalResolved) {
		return event
	}
	var payload FlowerLiveApprovalPayload
	if !decodeFlowerPayload(event.Payload, &payload) || strings.TrimSpace(payload.Action.ActionID) == "" {
		return event
	}
	action := payload.Action
	actionID := strings.TrimSpace(action.ActionID)
	queue := cloneFlowerApprovalQueue(stream.State.ApprovalQueue)
	if queue == nil {
		queue = &FlowerApprovalQueue{}
	}
	current, exists := stream.State.ApprovalActions[actionID]
	if event.Kind == FlowerLiveApprovalRequested && action.Status == FlowerApprovalStatusPending && action.State == FlowerApprovalStateRequested {
		if exists && current.QueueGeneration > 0 && current.QueueOrder > 0 {
			action.QueueGeneration = current.QueueGeneration
			action.QueueOrder = current.QueueOrder
		} else {
			if queue.UnresolvedCount == 0 {
				queue.Generation++
				if queue.Generation <= 0 {
					queue.Generation = 1
				}
				queue.Revision = 0
				queue.CurrentActionID = ""
				queue.CurrentPosition = 0
				queue.Total = 0
			}
			if stream.NextApprovalOrder <= 0 {
				stream.NextApprovalOrder = 1
			}
			action.QueueGeneration = queue.Generation
			action.QueueOrder = stream.NextApprovalOrder
			stream.NextApprovalOrder++
			queue.Revision++
			queue.Total++
			queue.UnresolvedCount++
			if strings.TrimSpace(queue.CurrentActionID) == "" {
				queue.CurrentActionID = actionID
			}
		}
	} else if event.Kind == FlowerLiveApprovalResolved {
		if exists {
			action.QueueGeneration = current.QueueGeneration
			action.QueueOrder = current.QueueOrder
			action.BatchIndex = current.BatchIndex
			action.BatchSize = current.BatchSize
		}
		if queue.UnresolvedCount > 0 && exists && current.Status == FlowerApprovalStatusPending {
			queue.Revision++
			queue.UnresolvedCount--
		}
		queue.CurrentActionID = nextFlowerApprovalQueueActionID(stream.State.ApprovalActions, actionID, queue.Generation)
		if queue.UnresolvedCount <= 0 || queue.CurrentActionID == "" {
			queue.UnresolvedCount = 0
			queue.CurrentActionID = ""
			queue.CurrentPosition = 0
		} else {
			queue.CurrentPosition = queue.Total - queue.UnresolvedCount + 1
		}
	}
	if queue.UnresolvedCount > 0 && queue.CurrentPosition <= 0 {
		queue.CurrentPosition = queue.Total - queue.UnresolvedCount + 1
	}
	action.SurfaceRole = FlowerApprovalSurfaceLocator
	action.CanApprove = false
	if event.Kind == FlowerLiveApprovalRequested && actionID == queue.CurrentActionID {
		action.SurfaceRole = FlowerApprovalSurfacePrimaryAction
		action.CanApprove = true
		action.ReadOnlyReason = ""
	}
	payload.Action = action
	payload.ApprovalQueue = cloneFlowerApprovalQueue(queue)
	event.Payload = mustFlowerPayload(payload)
	return event
}

func nextFlowerApprovalQueueActionID(actions map[string]FlowerApprovalAction, excludeID string, generation int64) string {
	var next FlowerApprovalAction
	for _, action := range actions {
		if strings.TrimSpace(action.ActionID) == strings.TrimSpace(excludeID) ||
			action.Status != FlowerApprovalStatusPending || action.State != FlowerApprovalStateRequested ||
			action.QueueGeneration != generation || action.QueueOrder <= 0 {
			continue
		}
		if next.QueueOrder == 0 || action.QueueOrder < next.QueueOrder {
			next = action
		}
	}
	return strings.TrimSpace(next.ActionID)
}

func flowerLiveEventWithAssignedSeqPayload(stream *flowerLiveThreadStream, event FlowerLiveEvent) FlowerLiveEvent {
	if event.Kind == FlowerLiveContextCompactionUpdated {
		var payload FlowerLiveContextCompactionUpdatedPayload
		if !decodeFlowerPayload(event.Payload, &payload) {
			return event
		}
		if !flowerContextCompactionHasCanonicalIdentity(payload.Compaction) {
			return event
		}
		payload.TimelineDecoration = normalizeFlowerTimelineDecorationForEvent(stream, payload.Compaction, payload.TimelineDecoration)
		if !validFlowerTimelineDecoration(payload.TimelineDecoration) {
			return event
		}
		event.Payload = mustFlowerPayload(payload)
		return event
	}
	if event.Kind != FlowerLiveApprovalRequested && event.Kind != FlowerLiveApprovalResolved {
		return event
	}
	var payload FlowerLiveApprovalPayload
	if !decodeFlowerPayload(event.Payload, &payload) || strings.TrimSpace(payload.Action.ActionID) == "" {
		return event
	}
	if payload.Action.Origin == "" {
		payload.Action.Origin = FlowerApprovalOriginMainTool
	}
	if payload.Action.Version <= 0 {
		payload.Action.Version = payload.Action.Revision
	}
	if payload.Action.Version <= 0 {
		payload.Action.Version = 1
	}
	if event.Kind == FlowerLiveApprovalRequested && payload.Action.ExpectedSeq <= 0 {
		if current, ok := stream.State.ApprovalActions[payload.Action.ActionID]; ok && current.ExpectedSeq > 0 {
			payload.Action.ExpectedSeq = current.ExpectedSeq
		} else {
			payload.Action.ExpectedSeq = event.Seq
		}
	}
	if event.Kind == FlowerLiveApprovalResolved || payload.Action.Status == FlowerApprovalStatusUnavailable {
		payload.Action.CanApprove = false
	}
	event.Payload = mustFlowerPayload(payload)
	return event
}

func normalizeFlowerTimelineDecorationForEvent(stream *flowerLiveThreadStream, compaction FlowerContextCompaction, decoration FlowerTimelineDecoration) FlowerTimelineDecoration {
	operationID := strings.TrimSpace(compaction.OperationID)
	if operationID == "" {
		return FlowerTimelineDecoration{}
	}
	decorationID := "context-compaction:" + operationID
	decoration.DecorationID = decorationID
	decoration.Kind = FlowerTimelineDecorationContextCompaction
	decoration.Compaction = compaction
	if stream != nil {
		for _, existing := range stream.State.TimelineDecorations {
			if strings.TrimSpace(existing.DecorationID) == decorationID {
				decoration.Anchor = existing.Anchor
				decoration.Ordinal = existing.Ordinal
				return decoration
			}
		}
		decoration.Ordinal = len(stream.State.TimelineDecorations)
	}
	if !validFlowerTimelineAnchor(decoration.Anchor) {
		return FlowerTimelineDecoration{}
	}
	return decoration
}

func (s *Service) publishFlowerLiveEventFromRealtime(ev RealtimeEvent) {
	if s == nil {
		return
	}
	for _, event := range s.flowerLiveEventsFromRealtime(ev) {
		s.appendFlowerLiveEvent(event)
	}
}

func (s *Service) flowerLiveEventsFromRealtime(ev RealtimeEvent) []FlowerLiveEvent {
	endpointID := strings.TrimSpace(ev.EndpointID)
	threadID := strings.TrimSpace(ev.ThreadID)
	runID := strings.TrimSpace(ev.RunID)
	at := ev.AtUnixMs
	if at <= 0 {
		at = time.Now().UnixMilli()
	}
	base := func(kind FlowerLiveKind, payload any) FlowerLiveEvent {
		return FlowerLiveEvent{
			EndpointID: endpointID,
			ThreadID:   threadID,
			RunID:      runID,
			TurnID:     messageIDFromRealtime(ev),
			TraceID:    runID,
			AtUnixMs:   at,
			Kind:       kind,
			Payload:    mustFlowerPayload(payload),
		}
	}

	switch ev.EventType {
	case RealtimeEventTypeThreadSummary:
		return []FlowerLiveEvent{base(FlowerLiveThreadPatched, FlowerLiveThreadPatchedPayload{Patch: flowerLiveThreadPatchFromSummary(ev)})}
	case RealtimeEventTypeThreadState:
		events := []FlowerLiveEvent{base(FlowerLiveRunStatusChanged, FlowerLiveRunStatusChangedPayload{
			RunID:         runID,
			Status:        string(NormalizeRunState(ev.RunStatus)),
			ErrorCode:     strings.TrimSpace(ev.RunErrorCode),
			Error:         strings.TrimSpace(ev.RunError),
			WaitingPrompt: ev.WaitingPrompt,
		})}
		if ev.WaitingPrompt != nil {
			events = append(events, base(FlowerLiveInputRequested, FlowerLiveInputRequestedPayload{Request: *ev.WaitingPrompt}))
		} else if NormalizeRunState(ev.RunStatus) != RunStateWaitingUser {
			events = append(events, base(FlowerLiveInputResolved, FlowerLiveInputResolvedPayload{}))
		}
		return events
	case RealtimeEventTypeStream:
		return s.flowerLiveEventsFromStreamEvent(ev, base)
	default:
		return nil
	}
}

func (s *Service) flowerLiveEventsFromStreamEvent(ev RealtimeEvent, base func(FlowerLiveKind, any) FlowerLiveEvent) []FlowerLiveEvent {
	switch stream := ev.StreamEvent.(type) {
	case streamEventMessageStart:
		messageID := strings.TrimSpace(stream.MessageID)
		if messageID == "" {
			return nil
		}
		return []FlowerLiveEvent{
			base(FlowerLiveRunStarted, FlowerLiveRunStartedPayload{RunID: strings.TrimSpace(ev.RunID), TurnID: messageID, MessageID: messageID, Status: string(RunStateRunning)}),
			base(FlowerLiveMessageStarted, FlowerLiveMessageStartedPayload{MessageID: messageID, Role: "assistant", Status: "streaming", CreatedAtMs: ev.AtUnixMs}),
		}
	case streamEventBlockStart:
		blockType := normalizeLiveBlockType(stream.BlockType)
		if strings.TrimSpace(stream.MessageID) == "" || stream.BlockIndex < 0 || blockType == "" {
			return nil
		}
		return []FlowerLiveEvent{base(FlowerLiveMessageBlockStart, FlowerLiveMessageBlockStartedPayload{
			MessageID:  strings.TrimSpace(stream.MessageID),
			BlockIndex: stream.BlockIndex,
			BlockType:  blockType,
		})}
	case streamEventBlockDelta:
		if strings.TrimSpace(stream.MessageID) == "" || stream.BlockIndex < 0 || stream.Delta == "" {
			return nil
		}
		return []FlowerLiveEvent{base(FlowerLiveMessageBlockDelta, FlowerLiveMessageBlockDeltaPayload{
			MessageID:  strings.TrimSpace(stream.MessageID),
			BlockIndex: stream.BlockIndex,
			Delta:      stream.Delta,
		})}
	case streamEventBlockSet:
		messageID := strings.TrimSpace(stream.MessageID)
		if messageID == "" || stream.BlockIndex < 0 {
			return nil
		}
		block := stream.Block
		if isActivityTimelineBlockValue(block) {
			safe, err := SanitizeActivityTimelineBlockValue(block)
			if err != nil {
				return nil
			}
			block = safe
		}
		events := []FlowerLiveEvent{base(FlowerLiveMessageBlockSet, FlowerLiveMessageBlockSetPayload{
			MessageID:  messageID,
			BlockIndex: stream.BlockIndex,
			Block:      block,
		})}
		if isActivityTimelineBlockValue(block) {
			events = append(events, s.flowerLiveApprovalEventsFromActivity(ev, block, base)...)
		}
		return events
	case streamEventError:
		if strings.TrimSpace(stream.MessageID) == "" {
			return nil
		}
		return []FlowerLiveEvent{base(FlowerLiveMessageFailed, FlowerLiveMessageFailedPayload{
			MessageID: strings.TrimSpace(stream.MessageID),
			Error:     strings.TrimSpace(stream.Error),
		})}
	case streamEventContextUsage:
		usage, ok := flowerContextUsageFromStream(stream)
		if !ok {
			return nil
		}
		return []FlowerLiveEvent{base(FlowerLiveContextUsageUpdated, FlowerLiveUsageUpdatedPayload{Usage: usage})}
	case streamEventContextCompaction:
		compaction, ok := flowerContextCompactionFromStream(stream)
		if !ok {
			return nil
		}
		decoration := stream.TimelineDecoration
		if !validFlowerTimelineDecoration(decoration) {
			return nil
		}
		return []FlowerLiveEvent{base(FlowerLiveContextCompactionUpdated, FlowerLiveContextCompactionUpdatedPayload{Compaction: compaction, TimelineDecoration: decoration})}
	case streamEventModelIOStatus:
		return []FlowerLiveEvent{base(FlowerLiveModelIOUpdated, FlowerLiveModelIOUpdatedPayload{Status: flowerModelIOStatusFromStream(stream, strings.TrimSpace(ev.RunID), ev.AtUnixMs)})}
	case streamEventApprovalAction:
		if strings.TrimSpace(stream.Action.ActionID) == "" {
			return nil
		}
		kind := FlowerLiveApprovalResolved
		if stream.Action.Status == FlowerApprovalStatusPending && stream.Action.State == FlowerApprovalStateRequested {
			kind = FlowerLiveApprovalRequested
		}
		return []FlowerLiveEvent{base(kind, FlowerLiveApprovalPayload{Action: stream.Action})}
	default:
		return nil
	}
}

func (s *Service) flowerLiveApprovalEventsFromActivity(ev RealtimeEvent, block any, base func(FlowerLiveKind, any) FlowerLiveEvent) []FlowerLiveEvent {
	timeline, ok := activityTimelineFromAny(block)
	if !ok || len(timeline.Items) == 0 {
		return nil
	}
	runID := strings.TrimSpace(ev.RunID)
	if runID == "" {
		runID = strings.TrimSpace(timeline.RunID)
	}
	if runID == "" {
		return nil
	}

	out := make([]FlowerLiveEvent, 0)
	for _, item := range timeline.Items {
		if !item.RequiresApproval || strings.TrimSpace(item.ToolID) == "" {
			continue
		}
		action := flowerApprovalActionFromActivity(runID, item)
		action.ExpectedSeq = s.flowerLiveApprovalExpectedSeq(ev.EndpointID, ev.ThreadID, action.ActionID)
		state := normalizeFlowerApprovalState(item.ApprovalState)
		if state == "" {
			state = action.State
		}
		action.State = state
		action.Status = approvalStatusForState(state)
		if action.Status == FlowerApprovalStatusResolved {
			action.CanApprove = false
			if action.ResolvedAtMs <= 0 {
				action.ResolvedAtMs = ev.AtUnixMs
			}
		}
		if action.Status != FlowerApprovalStatusResolved && action.Status != FlowerApprovalStatusUnavailable {
			continue
		}
		out = append(out, base(FlowerLiveApprovalResolved, FlowerLiveApprovalPayload{Action: action}))
	}
	return out
}

func applyFlowerLiveEventToMaterializedState(state *FlowerLiveMaterializedState, approvals map[string]FlowerApprovalState, event FlowerLiveEvent) {
	if state == nil {
		return
	}
	ensureFlowerLiveStateMaps(state)
	switch event.Kind {
	case FlowerLiveThreadPatched:
		var payload FlowerLiveThreadPatchedPayload
		if decodeFlowerPayload(event.Payload, &payload) {
			state.ThreadPatch = mergeFlowerLiveThreadPatch(state.ThreadPatch, payload.Patch)
		}
	case FlowerLiveRunStarted:
		var payload FlowerLiveRunStartedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.RunID) != "" {
			state.Runs[payload.RunID] = FlowerLiveRunState{
				RunID:     strings.TrimSpace(payload.RunID),
				Status:    strings.TrimSpace(payload.Status),
				MessageID: strings.TrimSpace(payload.MessageID),
			}
			state.ThreadPatch.RunStatus = strings.TrimSpace(payload.Status)
			if event.AtUnixMs > 0 {
				state.ThreadPatch.RunUpdatedAtUnixMs = event.AtUnixMs
			}
			state.ThreadPatch.RunErrorCode = ""
			state.ThreadPatch.RunError = ""
			state.ThreadPatch.WaitingPrompt = nil
		}
	case FlowerLiveRunStatusChanged:
		var payload FlowerLiveRunStatusChangedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.RunID) != "" {
			run, hasRun := state.Runs[payload.RunID]
			if !hasRun && len(state.Runs) > 0 {
				if flowerLiveRunStatusIsTerminal(payload.Status) {
					clearFlowerModelIOForRun(state, payload.RunID)
				}
				return
			}
			run.RunID = strings.TrimSpace(payload.RunID)
			run.Status = strings.TrimSpace(payload.Status)
			run.WaitingPrompt = payload.WaitingPrompt
			run.ErrorCode = strings.TrimSpace(payload.ErrorCode)
			run.Error = strings.TrimSpace(payload.Error)
			state.ThreadPatch.RunStatus = run.Status
			state.ThreadPatch.RunErrorCode = run.ErrorCode
			state.ThreadPatch.RunError = run.Error
			state.ThreadPatch.WaitingPrompt = payload.WaitingPrompt
			if event.AtUnixMs > 0 {
				state.ThreadPatch.RunUpdatedAtUnixMs = event.AtUnixMs
			}
			if flowerLiveRunStatusIsTerminal(run.Status) {
				delete(state.Runs, payload.RunID)
				clearFlowerModelIOForRun(state, payload.RunID)
				state.ThreadPatch.WaitingPrompt = nil
				for promptID := range state.InputRequests {
					delete(state.InputRequests, promptID)
				}
			} else {
				state.Runs[payload.RunID] = run
				if flowerLiveRunStatusHidesModelIO(run.Status) {
					clearFlowerModelIOForRun(state, payload.RunID)
				}
			}
		}
	case FlowerLiveModelIOUpdated:
		var payload FlowerLiveModelIOUpdatedPayload
		if decodeFlowerPayload(event.Payload, &payload) {
			if payload.Status == nil {
				clearFlowerModelIOForRun(state, event.RunID)
			} else if flowerModelIOStatusMatchesLiveRun(state, payload.Status) {
				state.ModelIO = cloneFlowerModelIOStatus(payload.Status)
			}
		}
	case FlowerLiveContextUsageUpdated:
		var payload FlowerLiveUsageUpdatedPayload
		if decodeFlowerPayload(event.Payload, &payload) && flowerContextUsageHasCanonicalIdentity(payload.Usage) {
			usage := payload.Usage
			state.ContextUsage = cloneFlowerContextUsage(&usage)
		}
	case FlowerLiveContextCompactionUpdated:
		var payload FlowerLiveContextCompactionUpdatedPayload
		if decodeFlowerPayload(event.Payload, &payload) {
			upsertFlowerContextCompaction(state, payload.Compaction, payload.TimelineDecoration)
		}
	case FlowerLiveMessageStarted:
		var payload FlowerLiveMessageStartedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.MessageID) != "" {
			id := strings.TrimSpace(payload.MessageID)
			msg := state.Messages[id]
			msg.ThreadID = strings.TrimSpace(event.ThreadID)
			msg.TurnID = strings.TrimSpace(event.TurnID)
			msg.RunID = strings.TrimSpace(event.RunID)
			msg.MessageID = id
			msg.Role = firstNonEmptyString(strings.TrimSpace(payload.Role), "assistant")
			msg.Status = firstNonEmptyString(strings.TrimSpace(payload.Status), "streaming")
			msg.CreatedAtMs = payload.CreatedAtMs
			state.Messages[id] = msg
		}
	case FlowerLiveMessageBlockStart:
		var payload FlowerLiveMessageBlockStartedPayload
		if decodeFlowerPayload(event.Payload, &payload) {
			upsertFlowerLiveBlock(state, event, payload.MessageID, payload.BlockIndex, FlowerLiveBlock{Type: normalizeLiveBlockType(payload.BlockType)})
		}
	case FlowerLiveMessageBlockDelta:
		var payload FlowerLiveMessageBlockDeltaPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.MessageID) != "" && payload.BlockIndex >= 0 && payload.Delta != "" {
			msg, ok := ensureFlowerLiveMessageForEvent(state, event, payload.MessageID)
			if !ok {
				return
			}
			for len(msg.Blocks) <= payload.BlockIndex {
				msg.Blocks = append(msg.Blocks, FlowerLiveBlock{Type: "markdown"})
			}
			block := msg.Blocks[payload.BlockIndex]
			if block.Type == "" {
				block.Type = "markdown"
			}
			block.Content += payload.Delta
			msg.Blocks[payload.BlockIndex] = block
			state.Messages[msg.MessageID] = msg
		}
	case FlowerLiveMessageBlockSet:
		var payload FlowerLiveMessageBlockSetPayload
		if decodeFlowerPayload(event.Payload, &payload) {
			raw := mustFlowerPayload(payload.Block)
			blockType := blockTypeFromRaw(raw)
			upsertFlowerLiveBlock(state, event, payload.MessageID, payload.BlockIndex, FlowerLiveBlock{Type: blockType, Block: raw})
		}
	case FlowerLiveMessageFailed:
		var payload FlowerLiveMessageFailedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.MessageID) != "" {
			msg, ok := ensureFlowerLiveMessageForEvent(state, event, payload.MessageID)
			if !ok {
				return
			}
			msg.Status = "error"
			state.Messages[msg.MessageID] = msg
		}
	case FlowerLiveApprovalRequested, FlowerLiveApprovalResolved:
		var payload FlowerLiveApprovalPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.Action.ActionID) != "" {
			state.ApprovalActionsSeen = true
			if payload.ApprovalQueue != nil {
				state.ApprovalQueue = cloneFlowerApprovalQueue(payload.ApprovalQueue)
			} else {
				state.ApprovalQueue = nil
			}
			if event.Kind == FlowerLiveApprovalRequested {
				clearFlowerModelIOForRun(state, payload.Action.RunID)
			}
			action := payload.Action
			if action.Origin == "" {
				action.Origin = FlowerApprovalOriginMainTool
			}
			if action.Version <= 0 {
				action.Version = action.Revision
			}
			if action.Version <= 0 {
				action.Version = 1
			}
			if event.Kind == FlowerLiveApprovalRequested && action.ExpectedSeq <= 0 {
				action.ExpectedSeq = event.Seq
			} else if action.ExpectedSeq <= 0 {
				if current, ok := state.ApprovalActions[action.ActionID]; ok {
					action.ExpectedSeq = current.ExpectedSeq
				}
			}
			if event.Kind == FlowerLiveApprovalRequested && approvals != nil {
				if _, hadPrev := approvals[action.ActionID]; hadPrev {
					if current, ok := state.ApprovalActions[action.ActionID]; ok {
						action.ExpectedSeq = firstPositiveInt64(current.ExpectedSeq, action.ExpectedSeq)
						action.QueueGeneration = firstPositiveInt64(current.QueueGeneration, action.QueueGeneration)
						action.QueueOrder = firstPositiveInt64(current.QueueOrder, action.QueueOrder)
						state.ApprovalActions[action.ActionID] = action
					}
					normalizeFlowerApprovalQueueActions(state)
					return
				}
				approvals[action.ActionID] = action.State
			}
			if action.Status == FlowerApprovalStatusResolved {
				action.CanApprove = false
				if (action.Origin == FlowerApprovalOriginMainTool || action.Origin == FlowerApprovalOriginControlConfirm) &&
					(action.State == FlowerApprovalStateApproved || action.State == FlowerApprovalStateRejected) {
					markFlowerLiveRunActiveAfterApproval(state, action.RunID, action.ActionID)
				}
				if visibleResolvedDelegatedApprovalAction(action) {
					state.ApprovalActions[action.ActionID] = action
					if approvals != nil {
						approvals[action.ActionID] = action.State
					}
					normalizeFlowerApprovalQueueActions(state)
					return
				}
				delete(state.ApprovalActions, action.ActionID)
				if approvals != nil {
					approvals[action.ActionID] = action.State
				}
				normalizeFlowerApprovalQueueActions(state)
				return
			}
			if action.Status == FlowerApprovalStatusUnavailable {
				action.CanApprove = false
			}
			state.ApprovalActions[action.ActionID] = action
			if event.Kind == FlowerLiveApprovalRequested && action.Status == FlowerApprovalStatusPending {
				markFlowerLiveRunWaitingApproval(state, action.RunID)
			}
			normalizeFlowerApprovalQueueActions(state)
		}
	case FlowerLiveInputRequested:
		var payload FlowerLiveInputRequestedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.Request.PromptID) != "" {
			clearFlowerModelIOForRun(state, event.RunID)
			state.InputRequests[payload.Request.PromptID] = payload.Request
		}
	case FlowerLiveInputResolved:
		var payload FlowerLiveInputResolvedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.PromptID) != "" {
			delete(state.InputRequests, strings.TrimSpace(payload.PromptID))
		} else if len(state.InputRequests) > 0 {
			for key := range state.InputRequests {
				delete(state.InputRequests, key)
			}
		}
	}
}

func markFlowerLiveRunWaitingApproval(state *FlowerLiveMaterializedState, runID string) {
	if state == nil {
		return
	}
	runID = strings.TrimSpace(runID)
	state.ThreadPatch.RunStatus = string(RunStateWaitingApproval)
	if runID == "" {
		return
	}
	run := state.Runs[runID]
	run.RunID = runID
	run.Status = string(RunStateWaitingApproval)
	state.Runs[runID] = run
}

func markFlowerLiveRunActiveAfterApproval(state *FlowerLiveMaterializedState, runID string, resolvedActionID string) {
	if state == nil {
		return
	}
	runID = strings.TrimSpace(runID)
	resolvedActionID = strings.TrimSpace(resolvedActionID)
	for _, action := range state.ApprovalActions {
		if strings.TrimSpace(action.ActionID) == resolvedActionID {
			continue
		}
		if strings.TrimSpace(action.RunID) == runID &&
			action.Status == FlowerApprovalStatusPending &&
			action.State == FlowerApprovalStateRequested &&
			(action.Origin == FlowerApprovalOriginMainTool || action.Origin == FlowerApprovalOriginControlConfirm) {
			return
		}
	}
	if state.ThreadPatch.RunStatus == string(RunStateWaitingApproval) {
		state.ThreadPatch.RunStatus = string(RunStateRunning)
	}
	if runID == "" {
		return
	}
	run, ok := state.Runs[runID]
	if !ok {
		return
	}
	if strings.TrimSpace(run.Status) == string(RunStateWaitingApproval) {
		run.Status = string(RunStateRunning)
		state.Runs[runID] = run
	}
}

func flowerLiveRunStatusIsTerminal(status string) bool {
	switch NormalizeRunState(status) {
	case RunStateSuccess, RunStateFailed, RunStateCanceled, RunStateTimedOut:
		return true
	default:
		return false
	}
}

func flowerLiveRunStatusHidesModelIO(status string) bool {
	switch NormalizeRunState(status) {
	case RunStateWaitingApproval, RunStateWaitingUser, RunStateSuccess, RunStateFailed, RunStateCanceled, RunStateTimedOut, RunStateIdle:
		return true
	default:
		return false
	}
}

func clearFlowerModelIOForRun(state *FlowerLiveMaterializedState, runID string) {
	if state == nil || state.ModelIO == nil {
		return
	}
	runID = strings.TrimSpace(runID)
	if runID != "" && strings.TrimSpace(state.ModelIO.RunID) == runID {
		state.ModelIO = nil
	}
}

func flowerModelIOStatusMatchesLiveRun(state *FlowerLiveMaterializedState, status *FlowerModelIOStatus) bool {
	if state == nil || status == nil {
		return false
	}
	runID := strings.TrimSpace(status.RunID)
	if runID == "" {
		return false
	}
	run, ok := state.Runs[runID]
	if !ok || strings.TrimSpace(run.RunID) != runID {
		return false
	}
	return !flowerLiveRunStatusHidesModelIO(run.Status)
}

func upsertFlowerContextCompaction(state *FlowerLiveMaterializedState, compaction FlowerContextCompaction, decoration FlowerTimelineDecoration) {
	if state == nil {
		return
	}
	if !flowerContextCompactionHasCanonicalIdentity(compaction) {
		return
	}
	operationID := strings.TrimSpace(compaction.OperationID)
	replaced := false
	for i := range state.ContextCompactions {
		if strings.TrimSpace(state.ContextCompactions[i].OperationID) == operationID {
			state.ContextCompactions[i] = compaction
			replaced = true
			break
		}
	}
	if !replaced {
		state.ContextCompactions = append(state.ContextCompactions, compaction)
	}

	decorationID := "context-compaction:" + operationID
	decoration.DecorationID = decorationID
	decoration.Kind = FlowerTimelineDecorationContextCompaction
	if strings.TrimSpace(decoration.Compaction.OperationID) == "" || decoration.Compaction.UpdatedAtMs < compaction.UpdatedAtMs {
		decoration.Compaction = compaction
	}
	if !validFlowerTimelineDecoration(decoration) {
		return
	}
	for i := range state.TimelineDecorations {
		if strings.TrimSpace(state.TimelineDecorations[i].DecorationID) == decorationID {
			decoration.Ordinal = state.TimelineDecorations[i].Ordinal
			decoration.Anchor = state.TimelineDecorations[i].Anchor
			state.TimelineDecorations[i] = decoration
			return
		}
	}
	state.TimelineDecorations = append(state.TimelineDecorations, decoration)
}

func validFlowerTimelineDecoration(decoration FlowerTimelineDecoration) bool {
	return decoration.Validate() == nil
}

func validFlowerTimelineAnchor(anchor FlowerTimelineAnchor) bool {
	messageID := strings.TrimSpace(anchor.MessageID)
	edge := strings.TrimSpace(anchor.Edge)
	if messageID == "" || (edge != "before" && edge != "after") {
		return false
	}
	switch strings.TrimSpace(anchor.TargetKind) {
	case "message":
		return anchor.BlockIndex == nil && strings.TrimSpace(anchor.ActivityItemID) == ""
	case "block":
		return anchor.BlockIndex != nil && *anchor.BlockIndex >= 0 && strings.TrimSpace(anchor.ActivityItemID) == ""
	case "activity_item":
		return anchor.BlockIndex != nil && *anchor.BlockIndex >= 0 && strings.TrimSpace(anchor.ActivityItemID) != ""
	default:
		return false
	}
}

func flowerModelIOStatusFromStream(stream streamEventModelIOStatus, runID string, atUnixMs int64) *FlowerModelIOStatus {
	phase := normalizeFlowerModelIOPhase(stream.Phase)
	if phase == "" {
		return nil
	}
	if atUnixMs <= 0 {
		atUnixMs = time.Now().UnixMilli()
	}
	if stream.UpdatedAtMs > 0 {
		atUnixMs = stream.UpdatedAtMs
	}
	return &FlowerModelIOStatus{
		Phase:       phase,
		RunID:       firstNonEmptyString(strings.TrimSpace(stream.RunID), strings.TrimSpace(runID)),
		StepIndex:   stream.StepIndex,
		UpdatedAtMs: atUnixMs,
	}
}

func flowerContextUsageFromStream(stream streamEventContextUsage) (FlowerContextUsage, bool) {
	usage := stream.Usage
	if !flowerContextUsageHasCanonicalIdentity(usage) || strings.TrimSpace(usage.Phase) == "" || strings.TrimSpace(usage.PressureStatus) == "" {
		return FlowerContextUsage{}, false
	}
	return usage, true
}

func flowerContextCompactionFromStream(stream streamEventContextCompaction) (FlowerContextCompaction, bool) {
	compaction := stream.Compaction
	if !flowerContextCompactionHasCanonicalIdentity(compaction) || strings.TrimSpace(compaction.Phase) == "" || strings.TrimSpace(compaction.Status) == "" {
		return FlowerContextCompaction{}, false
	}
	return compaction, true
}

func flowerContextUsageHasCanonicalIdentity(usage FlowerContextUsage) bool {
	return strings.TrimSpace(usage.RunID) != "" && usage.UpdatedAtMs > 0
}

func flowerContextCompactionHasCanonicalIdentity(compaction FlowerContextCompaction) bool {
	return strings.TrimSpace(compaction.OperationID) != "" &&
		strings.TrimSpace(compaction.RequestID) != "" &&
		strings.TrimSpace(compaction.RunID) != "" &&
		strings.TrimSpace(compaction.Source) != "" &&
		compaction.UpdatedAtMs > 0
}

func normalizeFlowerModelIOPhase(raw string) FlowerModelIOPhase {
	switch FlowerModelIOPhase(strings.TrimSpace(raw)) {
	case FlowerModelIOPhasePreparing:
		return FlowerModelIOPhasePreparing
	case FlowerModelIOPhaseWaitingResponse:
		return FlowerModelIOPhaseWaitingResponse
	case FlowerModelIOPhaseStreaming:
		return FlowerModelIOPhaseStreaming
	case FlowerModelIOPhaseRetrying:
		return FlowerModelIOPhaseRetrying
	case FlowerModelIOPhaseFinalizing:
		return FlowerModelIOPhaseFinalizing
	default:
		return ""
	}
}

func (s *Service) flowerLiveApprovalExpectedSeq(endpointID string, threadID string, actionID string) int64 {
	if s == nil {
		return 0
	}
	threadKey := runThreadKey(strings.TrimSpace(endpointID), strings.TrimSpace(threadID))
	actionID = strings.TrimSpace(actionID)
	if threadKey == "" || actionID == "" {
		return 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	stream := s.flowerLiveByThread[threadKey]
	if stream == nil || stream.State.ApprovalActions == nil {
		return 0
	}
	action := stream.State.ApprovalActions[actionID]
	return action.ExpectedSeq
}

func normalizeFlowerApprovalQueueActions(state *FlowerLiveMaterializedState) {
	if state == nil || len(state.ApprovalActions) == 0 {
		return
	}
	queue := state.ApprovalQueue
	if queue == nil {
		type candidate struct {
			actionID string
			order    int64
		}
		candidates := make([]candidate, 0, len(state.ApprovalActions))
		for actionID, action := range state.ApprovalActions {
			if action.Status != FlowerApprovalStatusPending || action.State != FlowerApprovalStateRequested {
				continue
			}
			order := firstPositiveInt64(action.QueueOrder, action.ExpectedSeq, action.RequestedAtMs)
			candidates = append(candidates, candidate{actionID: actionID, order: order})
		}
		sort.SliceStable(candidates, func(i, j int) bool {
			if candidates[i].order != candidates[j].order {
				return candidates[i].order < candidates[j].order
			}
			return candidates[i].actionID < candidates[j].actionID
		})
		if len(candidates) > 0 {
			queue = &FlowerApprovalQueue{
				Generation:      1,
				Revision:        int64(len(candidates)),
				CurrentActionID: candidates[0].actionID,
				CurrentPosition: 1,
				Total:           len(candidates),
				UnresolvedCount: len(candidates),
			}
			for index, candidate := range candidates {
				action := state.ApprovalActions[candidate.actionID]
				action.QueueGeneration = queue.Generation
				action.QueueOrder = int64(index + 1)
				state.ApprovalActions[candidate.actionID] = action
			}
			state.ApprovalQueue = queue
		}
	}
	primaryID := ""
	if queue != nil {
		primaryID = strings.TrimSpace(queue.CurrentActionID)
	}
	for actionID, action := range state.ApprovalActions {
		if action.Status != FlowerApprovalStatusPending || action.State != FlowerApprovalStateRequested {
			continue
		}
		if strings.TrimSpace(action.PrimaryWaitAnchor) == "" {
			action.PrimaryWaitAnchor = flowerDelegatedApprovalPrimaryWaitAnchor(action)
		}
		if actionID == primaryID {
			action.SurfaceRole = FlowerApprovalSurfacePrimaryAction
			action.CanApprove = true
			if action.ReadOnlyReason == "Queued for approval" {
				action.ReadOnlyReason = ""
			}
		} else {
			action.SurfaceRole = FlowerApprovalSurfaceLocator
			action.CanApprove = false
			action.ReadOnlyReason = "Queued for approval"
		}
		state.ApprovalActions[actionID] = action
	}
}

func flowerDelegatedApprovalPrimaryWaitAnchor(action FlowerApprovalAction) string {
	if action.DelegatedRef != nil && strings.TrimSpace(action.DelegatedRef.ParentThreadID) != "" {
		return "thread:" + strings.TrimSpace(action.DelegatedRef.ParentThreadID)
	}
	if strings.TrimSpace(action.Scope) != "" {
		return strings.TrimSpace(action.Scope)
	}
	return "thread"
}

func ensureFlowerLiveStateMaps(state *FlowerLiveMaterializedState) {
	if state.Messages == nil {
		state.Messages = map[string]FlowerLiveMessageDraft{}
	}
	if state.Runs == nil {
		state.Runs = map[string]FlowerLiveRunState{}
	}
	if state.ApprovalActions == nil {
		state.ApprovalActions = map[string]FlowerApprovalAction{}
	}
	if state.InputRequests == nil {
		state.InputRequests = map[string]RequestUserInputPrompt{}
	}
}

func ensureFlowerLiveMessage(state *FlowerLiveMaterializedState, messageID string) FlowerLiveMessageDraft {
	ensureFlowerLiveStateMaps(state)
	messageID = strings.TrimSpace(messageID)
	msg := state.Messages[messageID]
	if msg.MessageID == "" {
		msg.MessageID = messageID
		msg.Role = "assistant"
		msg.Status = "streaming"
	}
	return msg
}

func ensureFlowerLiveMessageForEvent(state *FlowerLiveMaterializedState, event FlowerLiveEvent, messageID string) (FlowerLiveMessageDraft, bool) {
	messageID = strings.TrimSpace(messageID)
	threadID := strings.TrimSpace(event.ThreadID)
	turnID := strings.TrimSpace(event.TurnID)
	runID := strings.TrimSpace(event.RunID)
	if messageID == "" || threadID == "" || turnID == "" || runID == "" || messageID != turnID {
		return FlowerLiveMessageDraft{}, false
	}
	msg := ensureFlowerLiveMessage(state, messageID)
	if (strings.TrimSpace(msg.ThreadID) != "" && strings.TrimSpace(msg.ThreadID) != threadID) ||
		(strings.TrimSpace(msg.TurnID) != "" && strings.TrimSpace(msg.TurnID) != turnID) ||
		(strings.TrimSpace(msg.RunID) != "" && strings.TrimSpace(msg.RunID) != runID) {
		return FlowerLiveMessageDraft{}, false
	}
	msg.ThreadID = threadID
	msg.TurnID = turnID
	msg.RunID = runID
	msg.MessageID = messageID
	return msg, true
}

func upsertFlowerLiveBlock(state *FlowerLiveMaterializedState, event FlowerLiveEvent, messageID string, blockIndex int, block FlowerLiveBlock) {
	if state == nil || strings.TrimSpace(messageID) == "" || blockIndex < 0 {
		return
	}
	msg, ok := ensureFlowerLiveMessageForEvent(state, event, messageID)
	if !ok {
		return
	}
	for len(msg.Blocks) <= blockIndex {
		msg.Blocks = append(msg.Blocks, FlowerLiveBlock{Type: "markdown"})
	}
	if strings.TrimSpace(block.Type) == "" {
		block.Type = msg.Blocks[blockIndex].Type
	}
	if strings.TrimSpace(block.Type) == "" {
		block.Type = "markdown"
	}
	msg.Blocks[blockIndex] = block
	state.Messages[msg.MessageID] = msg
}

func flowerLiveThreadPatchFromSummary(ev RealtimeEvent) FlowerLiveThreadPatch {
	queued := ev.QueuedTurnCount
	reasoningSelection := config.NormalizeAIReasoningSelection(ev.ReasoningSelection)
	reasoningCapability := ev.ReasoningCapability.Normalize()
	patch := FlowerLiveThreadPatch{
		ThreadID:               strings.TrimSpace(ev.ThreadID),
		Title:                  strings.TrimSpace(ev.Title),
		ModelID:                strings.TrimSpace(ev.ModelID),
		PermissionType:         strings.TrimSpace(ev.PermissionType),
		QueuedTurnCount:        &queued,
		RunStatus:              strings.TrimSpace(ev.RunStatus),
		RunErrorCode:           strings.TrimSpace(ev.RunErrorCode),
		RunError:               strings.TrimSpace(ev.RunError),
		WaitingPrompt:          ev.WaitingPrompt,
		ActiveRunID:            strings.TrimSpace(ev.ActiveRunID),
		UpdatedAtUnixMs:        ev.UpdatedAtUnixMs,
		LastMessageAtUnixMs:    ev.LastMessageAtUnixMs,
		LastMessagePreview:     strings.TrimSpace(ev.LastMessagePreview),
		ReasoningSelectionSet:  true,
		ReasoningCapabilitySet: true,
	}
	if !reasoningSelection.IsZero() {
		patch.ReasoningSelection = &reasoningSelection
	}
	if !reasoningCapability.IsZero() {
		patch.ReasoningCapability = &reasoningCapability
	}
	return patch
}

func mergeFlowerLiveThreadPatch(current FlowerLiveThreadPatch, patch FlowerLiveThreadPatch) FlowerLiveThreadPatch {
	if strings.TrimSpace(patch.ThreadID) != "" {
		current.ThreadID = strings.TrimSpace(patch.ThreadID)
	}
	if strings.TrimSpace(patch.Title) != "" {
		current.Title = strings.TrimSpace(patch.Title)
	}
	if strings.TrimSpace(patch.ModelID) != "" {
		current.ModelID = strings.TrimSpace(patch.ModelID)
	}
	if strings.TrimSpace(patch.PermissionType) != "" {
		current.PermissionType = strings.TrimSpace(patch.PermissionType)
	}
	if strings.TrimSpace(patch.WorkingDir) != "" {
		current.WorkingDir = strings.TrimSpace(patch.WorkingDir)
	}
	if patch.QueuedTurnCount != nil {
		value := *patch.QueuedTurnCount
		current.QueuedTurnCount = &value
	}
	if strings.TrimSpace(patch.RunStatus) != "" {
		current.RunStatus = strings.TrimSpace(patch.RunStatus)
	}
	if patch.RunUpdatedAtUnixMs > 0 {
		current.RunUpdatedAtUnixMs = patch.RunUpdatedAtUnixMs
	}
	current.RunErrorCode = strings.TrimSpace(patch.RunErrorCode)
	current.RunError = strings.TrimSpace(patch.RunError)
	current.WaitingPrompt = patch.WaitingPrompt
	if strings.TrimSpace(patch.ActiveRunID) != "" {
		current.ActiveRunID = strings.TrimSpace(patch.ActiveRunID)
	}
	if patch.PinnedAtUnixMs > 0 {
		current.PinnedAtUnixMs = patch.PinnedAtUnixMs
	}
	if patch.CreatedAtUnixMs > 0 {
		current.CreatedAtUnixMs = patch.CreatedAtUnixMs
	}
	if patch.UpdatedAtUnixMs > 0 {
		current.UpdatedAtUnixMs = patch.UpdatedAtUnixMs
	}
	if patch.LastMessageAtUnixMs > 0 {
		current.LastMessageAtUnixMs = patch.LastMessageAtUnixMs
	}
	if strings.TrimSpace(patch.LastMessagePreview) != "" {
		current.LastMessagePreview = strings.TrimSpace(patch.LastMessagePreview)
	}
	if patch.SubagentsSet {
		current.SubagentsSet = true
		current.Subagents = cloneFlowerSubagentSummaries(patch.Subagents)
	}
	if patch.ReasoningSelectionSet {
		current.ReasoningSelectionSet = true
		if patch.ReasoningSelection == nil {
			current.ReasoningSelection = nil
		} else {
			selection := config.NormalizeAIReasoningSelection(*patch.ReasoningSelection)
			current.ReasoningSelection = &selection
		}
	} else if patch.ReasoningSelection != nil {
		selection := config.NormalizeAIReasoningSelection(*patch.ReasoningSelection)
		current.ReasoningSelection = &selection
		current.ReasoningSelectionSet = true
	}
	if patch.ReasoningCapabilitySet {
		current.ReasoningCapabilitySet = true
		if patch.ReasoningCapability == nil {
			current.ReasoningCapability = nil
		} else {
			capability := patch.ReasoningCapability.Normalize()
			current.ReasoningCapability = &capability
		}
	} else if patch.ReasoningCapability != nil {
		capability := patch.ReasoningCapability.Normalize()
		current.ReasoningCapability = &capability
		current.ReasoningCapabilitySet = true
	}
	return current
}

func flowerLiveResyncEvent(endpointID string, threadID string, seq int64, reason string) FlowerLiveEvent {
	return FlowerLiveEvent{
		SchemaVersion: FlowerLiveSchemaVersion,
		Seq:           seq,
		EndpointID:    strings.TrimSpace(endpointID),
		ThreadID:      strings.TrimSpace(threadID),
		AtUnixMs:      time.Now().UnixMilli(),
		Kind:          FlowerLiveResyncRequired,
		Payload:       mustFlowerPayload(FlowerLiveResyncRequiredPayload{Reason: strings.TrimSpace(reason)}),
	}
}

func (r *run) snapshotControlConfirmationApproval(toolID string) (FlowerApprovalAction, bool) {
	if r == nil {
		return FlowerApprovalAction{}, false
	}
	toolID = strings.TrimSpace(toolID)
	if toolID == "" {
		return FlowerApprovalAction{}, false
	}
	r.mu.Lock()
	approval := r.toolApprovals[toolID]
	if approval == nil || approval.resolved {
		r.mu.Unlock()
		return FlowerApprovalAction{}, false
	}
	action := r.controlConfirmationApprovalActionLocked(toolID, approval)
	r.mu.Unlock()
	action.Origin = FlowerApprovalOriginControlConfirm
	return action, true
}

func (r *run) controlConfirmationApprovalActionLocked(toolID string, approval *toolApprovalRequest) FlowerApprovalAction {
	toolName := strings.TrimSpace(approval.toolName)
	if toolName == "" {
		toolName = "tool"
	}
	command := strings.TrimSpace(approval.command)
	cwd := strings.TrimSpace(approval.cwd)
	targets := append([]FlowerSafeTarget(nil), approval.targets...)
	return FlowerApprovalAction{
		ActionID:      flowerApprovalActionID(r.id, toolID),
		Origin:        FlowerApprovalOriginControlConfirm,
		RunID:         strings.TrimSpace(r.id),
		TurnID:        strings.TrimSpace(r.messageID),
		ToolID:        toolID,
		ToolName:      toolName,
		State:         FlowerApprovalStateRequested,
		Status:        FlowerApprovalStatusPending,
		Revision:      1,
		Version:       1,
		SurfaceEpoch:  1,
		RequestedAtMs: approval.requestedAtMs,
		ExpiresAtMs:   approval.expiresAtMs,
		CanApprove:    true,
		BatchIndex:    0,
		BatchSize:     1,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalDisplayLabel(toolName, toolApprovalPresentationArgs(toolName, command, cwd, targets)),
			Description: toolApprovalDescription(approval),
			Command:     command,
			Cwd:         cwd,
			Effects:     toolApprovalSummaryEffects(toolName, approval),
			Flags:       append([]string(nil), approval.flags...),
			Targets:     targets,
		},
	}
}

func toolApprovalDescription(approval *toolApprovalRequest) string {
	if approval == nil {
		return "Review this tool before it runs."
	}
	for _, target := range approval.targets {
		if label := strings.TrimSpace(target.Label); label != "" {
			return "Review access to " + label + " before this tool runs."
		}
	}
	return "Review this tool before it runs."
}

func toolApprovalSummaryEffects(toolName string, approval *toolApprovalRequest) []string {
	if approval != nil && len(approval.effects) > 0 {
		return append([]string(nil), approval.effects...)
	}
	return toolApprovalEffects(toolName)
}

func flowerApprovalActionFromActivity(runID string, item observation.ActivityItem) FlowerApprovalAction {
	toolID := strings.TrimSpace(item.ToolID)
	toolName := strings.TrimSpace(item.ToolName)
	if toolName == "" {
		toolName = "tool"
	}
	state := normalizeFlowerApprovalState(item.ApprovalState)
	if state == "" {
		state = FlowerApprovalStateRequested
	}
	startedAt := item.StartedAtUnixMS
	if startedAt <= 0 {
		startedAt = time.Now().UnixMilli()
	}
	action := FlowerApprovalAction{
		ActionID:      flowerApprovalActionID(runID, toolID),
		Origin:        FlowerApprovalOriginMainTool,
		RunID:         strings.TrimSpace(runID),
		ToolID:        toolID,
		ToolName:      toolName,
		State:         state,
		Status:        approvalStatusForState(state),
		Revision:      1,
		Version:       1,
		RequestedAtMs: startedAt,
		CanApprove:    state == FlowerApprovalStateRequested,
		Summary: FlowerApprovalSummary{
			Label:       firstNonEmptyString(strings.TrimSpace(item.Label), toolApprovalLabel(toolName)),
			Description: strings.TrimSpace(item.Description),
			Effects:     toolApprovalEffects(toolName),
		},
	}
	if action.Status == FlowerApprovalStatusResolved {
		action.ResolvedAtMs = item.EndedAtUnixMS
		action.CanApprove = false
	}
	return action
}

func flowerApprovalActionID(runID string, toolID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(runID) + "\x00" + strings.TrimSpace(toolID)))
	return "appr_" + base64.RawURLEncoding.EncodeToString(sum[:18])
}

func normalizeFlowerApprovalState(raw string) FlowerApprovalState {
	switch strings.TrimSpace(raw) {
	case "requested":
		return FlowerApprovalStateRequested
	case "approved":
		return FlowerApprovalStateApproved
	case "rejected":
		return FlowerApprovalStateRejected
	case "timed_out":
		return FlowerApprovalStateTimedOut
	case "canceled", "cancelled":
		return FlowerApprovalStateCanceled
	default:
		return ""
	}
}

func approvalStatusForState(state FlowerApprovalState) FlowerApprovalStatus {
	if state == FlowerApprovalStateRequested || state == "" {
		return FlowerApprovalStatusPending
	}
	return FlowerApprovalStatusResolved
}

func toolApprovalLabel(toolName string) string {
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		return "Tool approval"
	}
	return toolName
}

func toolApprovalDisplayLabel(toolName string, args map[string]any) string {
	fallback := toolApprovalLabel(toolName)
	activity := floretActivityForToolCall(toolName, args)
	if activity == nil {
		return fallback
	}
	if label := strings.TrimSpace(activity.Label); label != "" {
		return label
	}
	return fallback
}

func toolApprovalPresentationArgs(toolName string, command string, cwd string, targets []FlowerSafeTarget) map[string]any {
	args := map[string]any{}
	if strings.TrimSpace(toolName) == "terminal.exec" {
		if command = strings.TrimSpace(command); command != "" {
			args["command"] = command
		}
		if cwd = strings.TrimSpace(cwd); cwd != "" {
			args["cwd"] = cwd
		}
	}
	for _, target := range targets {
		if strings.TrimSpace(target.Kind) != "file" {
			continue
		}
		if label := strings.TrimSpace(target.Label); label != "" {
			args["file_path"] = label
			break
		}
	}
	if len(args) == 0 {
		return nil
	}
	return args
}

func toolApprovalEffects(toolName string) []string {
	switch strings.TrimSpace(toolName) {
	case "terminal.exec":
		return []string{"shell"}
	case "file.edit", "file.write", "apply_patch":
		return []string{"write"}
	case "web.search":
		return []string{"network"}
	default:
		return []string{"tool"}
	}
}

func messageIDFromRealtime(ev RealtimeEvent) string {
	switch stream := ev.StreamEvent.(type) {
	case streamEventMessageStart:
		return strings.TrimSpace(stream.MessageID)
	case streamEventBlockStart:
		return strings.TrimSpace(stream.MessageID)
	case streamEventBlockDelta:
		return strings.TrimSpace(stream.MessageID)
	case streamEventBlockSet:
		return strings.TrimSpace(stream.MessageID)
	case streamEventMessageEnd:
		return strings.TrimSpace(stream.MessageID)
	case streamEventError:
		return strings.TrimSpace(stream.MessageID)
	default:
		return ""
	}
}

func normalizeLiveBlockType(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "markdown", "text":
		return "markdown"
	case "thinking":
		return "thinking"
	case activityTimelineBlockType:
		return activityTimelineBlockType
	default:
		return strings.TrimSpace(strings.ToLower(raw))
	}
}

func blockTypeFromRaw(raw json.RawMessage) string {
	var record struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return ""
	}
	return normalizeLiveBlockType(record.Type)
}

func mustFlowerPayload(value any) json.RawMessage {
	if raw, ok := value.(json.RawMessage); ok {
		return cloneRawMessage(raw)
	}
	b, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(b)
}

func decodeFlowerPayload(raw json.RawMessage, out any) bool {
	if len(raw) == 0 {
		return false
	}
	return json.Unmarshal(raw, out) == nil
}

func cloneFlowerLiveEvent(event FlowerLiveEvent) FlowerLiveEvent {
	event.Payload = cloneRawMessage(event.Payload)
	return event
}

func cloneRawMessage(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}
	return append(json.RawMessage(nil), raw...)
}

func cloneFlowerLiveMaterializedState(in FlowerLiveMaterializedState) FlowerLiveMaterializedState {
	out := FlowerLiveMaterializedState{
		ThreadPatch:         cloneFlowerLiveThreadPatch(in.ThreadPatch),
		Messages:            map[string]FlowerLiveMessageDraft{},
		Runs:                map[string]FlowerLiveRunState{},
		ModelIO:             cloneFlowerModelIOStatus(in.ModelIO),
		ContextUsage:        cloneFlowerContextUsage(in.ContextUsage),
		ContextCompactions:  cloneFlowerContextCompactions(in.ContextCompactions),
		TimelineDecorations: cloneFlowerTimelineDecorations(in.TimelineDecorations),
		ApprovalActions:     map[string]FlowerApprovalAction{},
		ApprovalActionsSeen: in.ApprovalActionsSeen,
		ApprovalQueue:       cloneFlowerApprovalQueue(in.ApprovalQueue),
		InputRequests:       map[string]RequestUserInputPrompt{},
	}
	for key, value := range in.Messages {
		out.Messages[key] = cloneFlowerLiveMessageDraft(value)
	}
	for key, value := range in.Runs {
		out.Runs[key] = cloneFlowerLiveRunState(value)
	}
	for key, value := range in.ApprovalActions {
		out.ApprovalActions[key] = value
	}
	for key, value := range in.InputRequests {
		out.InputRequests[key] = value
	}
	return out
}

func cloneFlowerLiveThreadPatch(in FlowerLiveThreadPatch) FlowerLiveThreadPatch {
	out := in
	out.Subagents = cloneFlowerSubagentSummaries(in.Subagents)
	out.SubagentsSet = in.SubagentsSet
	if in.ReasoningSelection != nil {
		value := config.NormalizeAIReasoningSelection(*in.ReasoningSelection)
		out.ReasoningSelection = &value
	}
	if in.ReasoningCapability != nil {
		value := in.ReasoningCapability.Normalize()
		out.ReasoningCapability = &value
	}
	return out
}

func cloneFlowerLiveMessageDraft(in FlowerLiveMessageDraft) FlowerLiveMessageDraft {
	out := in
	out.Blocks = make([]FlowerLiveBlock, len(in.Blocks))
	for i, block := range in.Blocks {
		block.Block = cloneRawMessage(block.Block)
		out.Blocks[i] = block
	}
	return out
}

func cloneFlowerLiveRunState(in FlowerLiveRunState) FlowerLiveRunState {
	out := in
	if in.WaitingPrompt != nil {
		cp := *in.WaitingPrompt
		out.WaitingPrompt = &cp
	}
	return out
}

func cloneFlowerModelIOStatus(in *FlowerModelIOStatus) *FlowerModelIOStatus {
	if in == nil {
		return nil
	}
	out := *in
	return &out
}

func cloneFlowerContextUsage(in *FlowerContextUsage) *FlowerContextUsage {
	if in == nil {
		return nil
	}
	out := *in
	return &out
}

func cloneFlowerContextCompactions(in []FlowerContextCompaction) []FlowerContextCompaction {
	if len(in) == 0 {
		return nil
	}
	out := make([]FlowerContextCompaction, len(in))
	copy(out, in)
	return out
}

func cloneFlowerTimelineDecorations(in []FlowerTimelineDecoration) []FlowerTimelineDecoration {
	if len(in) == 0 {
		return nil
	}
	out := make([]FlowerTimelineDecoration, len(in))
	copy(out, in)
	return out
}

func assertNoFullMessageInDelta(event FlowerLiveEvent) error {
	if event.Kind != FlowerLiveMessageBlockDelta {
		return nil
	}
	var payload map[string]any
	if err := json.Unmarshal(event.Payload, &payload); err != nil {
		return err
	}
	for _, key := range []string{"message", "messages", "block", "blocks"} {
		if _, ok := payload[key]; ok {
			return fmt.Errorf("delta payload contains %s", key)
		}
	}
	return nil
}
