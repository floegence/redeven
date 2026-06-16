package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	"github.com/floegence/redeven/internal/session"
)

const flowerLiveEventBufferLimit = 5000

type flowerLiveThreadStream struct {
	NextSeq       int64
	Events        []FlowerLiveEvent
	State         FlowerLiveMaterializedState
	ApprovalIndex map[string]FlowerApprovalState
}

func newFlowerLiveThreadStream() *flowerLiveThreadStream {
	return &flowerLiveThreadStream{
		NextSeq: 1,
		State: FlowerLiveMaterializedState{
			MessageOrder:    []string{},
			Messages:        map[string]FlowerLiveMessageDraft{},
			Runs:            map[string]FlowerLiveRunState{},
			ApprovalActions: map[string]FlowerApprovalAction{},
			InputRequests:   map[string]RequestUserInputPrompt{},
		},
		ApprovalIndex: map[string]FlowerApprovalState{},
	}
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

	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}

	endpointID := strings.TrimSpace(meta.EndpointID)
	msgs, _, _, err := db.ListMessages(ctx, endpointID, threadID, 200, 0)
	if err != nil {
		return nil, err
	}
	messages := make([]json.RawMessage, 0, len(msgs))
	for _, msg := range msgs {
		safe, err := SanitizeActivityTimelineMessageJSON(msg.MessageJSON)
		if err != nil {
			return nil, err
		}
		if len(safe) > 0 {
			messages = append(messages, safe)
		}
	}

	s.mu.Lock()
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	retainedFromSeq := s.flowerLiveRetainedFromSeqLocked(endpointID, threadID)
	state := s.flowerLiveMaterializedStateLocked(endpointID, threadID)
	s.mu.Unlock()

	return &FlowerLiveBootstrapResponse{
		SchemaVersion:      FlowerLiveSchemaVersion,
		EndpointID:         endpointID,
		ThreadID:           threadID,
		Cursor:             cursor,
		RetainedFromSeq:    retainedFromSeq,
		Thread:             *thread,
		TranscriptMessages: messages,
		LiveState:          state,
		GeneratedAtMs:      time.Now().UnixMilli(),
	}, nil
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
	if stream == nil {
		s.mu.Unlock()
		if afterSeq > 0 {
			event := flowerLiveResyncEvent(endpointID, threadID, afterSeq, "cursor_expired")
			return &FlowerLiveEventsResponse{Events: []FlowerLiveEvent{event}, NextCursor: afterSeq, RetainedFromSeq: 0}, nil
		}
		return &FlowerLiveEventsResponse{Events: []FlowerLiveEvent{}, NextCursor: 0, RetainedFromSeq: 0}, nil
	}

	nextCursor := stream.NextSeq - 1
	retainedFromSeq := int64(0)
	if len(stream.Events) > 0 {
		retainedFromSeq = stream.Events[0].Seq
	}
	if afterSeq > 0 && retainedFromSeq > 0 && afterSeq < retainedFromSeq {
		event := flowerLiveResyncEvent(endpointID, threadID, afterSeq, "cursor_expired")
		s.mu.Unlock()
		return &FlowerLiveEventsResponse{Events: []FlowerLiveEvent{event}, NextCursor: afterSeq, RetainedFromSeq: retainedFromSeq}, nil
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

	return &FlowerLiveEventsResponse{Events: events, NextCursor: nextCursor, HasMore: hasMore, RetainedFromSeq: retainedFromSeq}, nil
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
	if endpointID == "" || runID == "" || toolID == "" || actionID == "" || threadID == "" || req.ExpectedSeq <= 0 || req.Revision <= 0 {
		return nil, errors.New("invalid request")
	}

	s.mu.Lock()
	r := s.runs[runID]
	cursor := s.flowerLiveCursorLocked(endpointID, threadID)
	var liveAction FlowerApprovalAction
	if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil && stream.State.ApprovalActions != nil {
		liveAction = stream.State.ApprovalActions[actionID]
	}
	s.mu.Unlock()
	if r == nil || strings.TrimSpace(r.endpointID) != endpointID || strings.TrimSpace(r.threadID) != threadID || r.isDetached() {
		return nil, errors.New("run not found")
	}
	if strings.TrimSpace(r.userPublicID) != strings.TrimSpace(meta.UserPublicID) {
		return nil, errors.New("run not found")
	}
	if req.ExpectedSeq > cursor {
		return nil, ErrRunChanged
	}

	approval, ok := r.snapshotToolApproval(toolID)
	if !ok {
		return nil, errors.New("approval no longer pending")
	}
	if approval.ActionID != actionID {
		return nil, errors.New("approval action mismatch")
	}
	if liveAction.ActionID == "" || liveAction.RunID != runID || liveAction.ToolID != toolID {
		return nil, ErrRunChanged
	}
	if liveAction.Status != FlowerApprovalStatusPending || liveAction.State != FlowerApprovalStateRequested {
		return nil, errors.New("approval no longer pending")
	}
	if !liveAction.CanApprove {
		return nil, errors.New(firstNonEmptyString(liveAction.ReadOnlyReason, "approval is not available"))
	}
	if liveAction.Revision != req.Revision || liveAction.ExpectedSeq != req.ExpectedSeq {
		return nil, ErrRunChanged
	}
	if approval.Revision != liveAction.Revision {
		return nil, ErrRunChanged
	}
	if !approval.CanApprove {
		return nil, errors.New(firstNonEmptyString(approval.ReadOnlyReason, "approval is not available"))
	}
	if err := r.approveTool(toolID, req.Approved); err != nil {
		return nil, err
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
		MessageOrder:    []string{},
		Messages:        map[string]FlowerLiveMessageDraft{},
		Runs:            map[string]FlowerLiveRunState{},
		ApprovalActions: map[string]FlowerApprovalAction{},
		InputRequests:   map[string]RequestUserInputPrompt{},
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
	stream := s.flowerLiveByThread[threadKey]
	if stream == nil {
		stream = newFlowerLiveThreadStream()
		s.flowerLiveByThread[threadKey] = stream
	}
	event.Seq = stream.NextSeq
	stream.NextSeq++
	event = flowerLiveEventWithAssignedSeqPayload(event)
	event.Payload = cloneRawMessage(event.Payload)
	stream.Events = append(stream.Events, cloneFlowerLiveEvent(event))
	if len(stream.Events) > flowerLiveEventBufferLimit {
		copy(stream.Events, stream.Events[len(stream.Events)-flowerLiveEventBufferLimit:])
		stream.Events = stream.Events[:flowerLiveEventBufferLimit]
	}
	applyFlowerLiveEventToMaterializedState(&stream.State, stream.ApprovalIndex, event)
	s.mu.Unlock()
	return event
}

func flowerLiveEventWithAssignedSeqPayload(event FlowerLiveEvent) FlowerLiveEvent {
	if event.Kind != FlowerLiveApprovalRequested && event.Kind != FlowerLiveApprovalResolved {
		return event
	}
	var payload FlowerLiveApprovalPayload
	if !decodeFlowerPayload(event.Payload, &payload) || strings.TrimSpace(payload.Action.ActionID) == "" {
		return event
	}
	if event.Kind == FlowerLiveApprovalRequested && payload.Action.ExpectedSeq <= 0 {
		payload.Action.ExpectedSeq = event.Seq
	}
	if event.Kind == FlowerLiveApprovalResolved {
		payload.Action.CanApprove = false
	}
	event.Payload = mustFlowerPayload(payload)
	return event
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
	case RealtimeEventTypeTranscript:
		messageID, ok := messageIDFromJSON(ev.MessageJSON)
		if !ok {
			return nil
		}
		return []FlowerLiveEvent{base(FlowerLiveMessageCommitted, FlowerLiveMessageCommittedPayload{
			MessageID: messageID,
			Message:   cloneRawMessage(ev.MessageJSON),
		})}
	case RealtimeEventTypeTranscriptReset:
		return []FlowerLiveEvent{base(FlowerLiveResyncRequired, FlowerLiveResyncRequiredPayload{Reason: firstNonEmptyString(ev.ResetReason, "transcript_reset")})}
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
			events = append(events, base(FlowerLiveActivityUpdated, FlowerLiveActivityUpdatedPayload{
				RunID:      strings.TrimSpace(ev.RunID),
				MessageID:  messageID,
				BlockIndex: stream.BlockIndex,
				Activity:   block,
			}))
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
		if len(stream.Payload) == 0 {
			return nil
		}
		return []FlowerLiveEvent{base(FlowerLiveUsageUpdated, FlowerLiveUsageUpdatedPayload{Usage: cloneStringAnyMap(stream.Payload)})}
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
	s.mu.Lock()
	r := s.runs[runID]
	s.mu.Unlock()

	out := make([]FlowerLiveEvent, 0)
	for _, item := range timeline.Items {
		if !item.RequiresApproval || strings.TrimSpace(item.ToolID) == "" {
			continue
		}
		action := flowerApprovalActionFromActivity(runID, item)
		if r != nil {
			if pending, ok := r.snapshotToolApproval(item.ToolID); ok {
				action = pending
			}
		}
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
		kind := FlowerLiveApprovalResolved
		if action.Status == FlowerApprovalStatusPending {
			kind = FlowerLiveApprovalRequested
		}
		out = append(out, base(kind, FlowerLiveApprovalPayload{Action: action}))
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
		}
	case FlowerLiveRunStatusChanged:
		var payload FlowerLiveRunStatusChangedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.RunID) != "" {
			run := state.Runs[payload.RunID]
			run.RunID = strings.TrimSpace(payload.RunID)
			run.Status = strings.TrimSpace(payload.Status)
			run.WaitingPrompt = payload.WaitingPrompt
			run.ErrorCode = strings.TrimSpace(payload.ErrorCode)
			run.Error = strings.TrimSpace(payload.Error)
			if flowerLiveRunStatusIsTerminal(run.Status) {
				delete(state.Runs, payload.RunID)
			} else {
				state.Runs[payload.RunID] = run
			}
		}
	case FlowerLiveMessageStarted:
		var payload FlowerLiveMessageStartedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.MessageID) != "" {
			id := strings.TrimSpace(payload.MessageID)
			msg := state.Messages[id]
			msg.MessageID = id
			msg.Role = firstNonEmptyString(strings.TrimSpace(payload.Role), "assistant")
			msg.Status = firstNonEmptyString(strings.TrimSpace(payload.Status), "streaming")
			msg.CreatedAtMs = payload.CreatedAtMs
			if !stringSliceContains(state.MessageOrder, id) {
				state.MessageOrder = append(state.MessageOrder, id)
			}
			state.Messages[id] = msg
		}
	case FlowerLiveMessageBlockStart:
		var payload FlowerLiveMessageBlockStartedPayload
		if decodeFlowerPayload(event.Payload, &payload) {
			upsertFlowerLiveBlock(state, payload.MessageID, payload.BlockIndex, FlowerLiveBlock{Type: normalizeLiveBlockType(payload.BlockType)})
		}
	case FlowerLiveMessageBlockDelta:
		var payload FlowerLiveMessageBlockDeltaPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.MessageID) != "" && payload.BlockIndex >= 0 && payload.Delta != "" {
			msg := ensureFlowerLiveMessage(state, payload.MessageID)
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
			upsertFlowerLiveBlock(state, payload.MessageID, payload.BlockIndex, FlowerLiveBlock{Type: blockType, Block: raw})
		}
	case FlowerLiveMessageCommitted:
		var payload FlowerLiveMessageCommittedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.MessageID) != "" {
			delete(state.Messages, strings.TrimSpace(payload.MessageID))
			state.MessageOrder = removeStringValue(state.MessageOrder, strings.TrimSpace(payload.MessageID))
		}
	case FlowerLiveMessageFailed:
		var payload FlowerLiveMessageFailedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.MessageID) != "" {
			msg := ensureFlowerLiveMessage(state, payload.MessageID)
			msg.Status = "error"
			state.Messages[msg.MessageID] = msg
		}
	case FlowerLiveApprovalRequested, FlowerLiveApprovalResolved:
		var payload FlowerLiveApprovalPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.Action.ActionID) != "" {
			action := payload.Action
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
						if current.ExpectedSeq <= 0 && action.ExpectedSeq > 0 {
							current.ExpectedSeq = action.ExpectedSeq
							state.ApprovalActions[action.ActionID] = current
						}
					}
					return
				}
				approvals[action.ActionID] = action.State
			}
			if action.Status == FlowerApprovalStatusResolved {
				action.CanApprove = false
				delete(state.ApprovalActions, action.ActionID)
				if approvals != nil {
					approvals[action.ActionID] = action.State
				}
				return
			}
			state.ApprovalActions[action.ActionID] = action
		}
	case FlowerLiveInputRequested:
		var payload FlowerLiveInputRequestedPayload
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.Request.PromptID) != "" {
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

func flowerLiveRunStatusIsTerminal(status string) bool {
	switch NormalizeRunState(status) {
	case RunStateSuccess, RunStateFailed, RunStateCanceled, RunStateTimedOut:
		return true
	default:
		return false
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
	if state.MessageOrder == nil {
		state.MessageOrder = []string{}
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
		if !stringSliceContains(state.MessageOrder, messageID) {
			state.MessageOrder = append(state.MessageOrder, messageID)
		}
	}
	return msg
}

func upsertFlowerLiveBlock(state *FlowerLiveMaterializedState, messageID string, blockIndex int, block FlowerLiveBlock) {
	if state == nil || strings.TrimSpace(messageID) == "" || blockIndex < 0 {
		return
	}
	msg := ensureFlowerLiveMessage(state, messageID)
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
	return FlowerLiveThreadPatch{
		ThreadID:            strings.TrimSpace(ev.ThreadID),
		Title:               strings.TrimSpace(ev.Title),
		ModelID:             "",
		ExecutionMode:       strings.TrimSpace(ev.ExecutionMode),
		QueuedTurnCount:     &queued,
		RunStatus:           strings.TrimSpace(ev.RunStatus),
		RunErrorCode:        strings.TrimSpace(ev.RunErrorCode),
		RunError:            strings.TrimSpace(ev.RunError),
		WaitingPrompt:       ev.WaitingPrompt,
		LastContextRunID:    strings.TrimSpace(ev.LastContextRunID),
		UpdatedAtUnixMs:     ev.UpdatedAtUnixMs,
		LastMessageAtUnixMs: ev.LastMessageAtUnixMs,
		LastMessagePreview:  strings.TrimSpace(ev.LastMessagePreview),
	}
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
	if patch.ModelLocked != nil {
		current.ModelLocked = patch.ModelLocked
	}
	if strings.TrimSpace(patch.ExecutionMode) != "" {
		current.ExecutionMode = strings.TrimSpace(patch.ExecutionMode)
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
	if strings.TrimSpace(patch.LastContextRunID) != "" {
		current.LastContextRunID = strings.TrimSpace(patch.LastContextRunID)
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

func (r *run) snapshotToolApproval(toolID string) (FlowerApprovalAction, bool) {
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
	action := r.toolApprovalActionLocked(toolID, approval)
	r.mu.Unlock()
	return action, true
}

func (r *run) toolApprovalActionLocked(toolID string, approval *toolApprovalRequest) FlowerApprovalAction {
	toolName := strings.TrimSpace(approval.toolName)
	if toolName == "" {
		toolName = "tool"
	}
	return FlowerApprovalAction{
		ActionID:      flowerApprovalActionID(r.id, toolID),
		RunID:         strings.TrimSpace(r.id),
		TurnID:        strings.TrimSpace(r.messageID),
		ToolID:        toolID,
		ToolName:      toolName,
		State:         FlowerApprovalStateRequested,
		Status:        FlowerApprovalStatusPending,
		Revision:      1,
		RequestedAtMs: approval.requestedAtMs,
		ExpiresAtMs:   approval.expiresAtMs,
		CanApprove:    true,
		Summary: FlowerApprovalSummary{
			Label:       toolApprovalLabel(toolName),
			Description: "Review this tool before it runs.",
			Effects:     toolApprovalEffects(toolName),
		},
	}
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
		RunID:         strings.TrimSpace(runID),
		ToolID:        toolID,
		ToolName:      toolName,
		State:         state,
		Status:        approvalStatusForState(state),
		Revision:      1,
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

func messageIDFromJSON(raw json.RawMessage) (string, bool) {
	var record struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return "", false
	}
	id := strings.TrimSpace(record.ID)
	return id, id != ""
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
		ThreadPatch:     cloneFlowerLiveThreadPatch(in.ThreadPatch),
		MessageOrder:    append([]string(nil), in.MessageOrder...),
		Messages:        map[string]FlowerLiveMessageDraft{},
		Runs:            map[string]FlowerLiveRunState{},
		ApprovalActions: map[string]FlowerApprovalAction{},
		InputRequests:   map[string]RequestUserInputPrompt{},
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
	if in.ModelLocked != nil {
		value := *in.ModelLocked
		out.ModelLocked = &value
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

func cloneStringAnyMap(in map[string]any) map[string]any {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]any, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func stringSliceContains(values []string, want string) bool {
	want = strings.TrimSpace(want)
	if want == "" {
		return false
	}
	for _, value := range values {
		if strings.TrimSpace(value) == want {
			return true
		}
	}
	return false
}

func removeStringValue(values []string, target string) []string {
	target = strings.TrimSpace(target)
	if target == "" || len(values) == 0 {
		return values
	}
	out := values[:0]
	for _, value := range values {
		if strings.TrimSpace(value) != target {
			out = append(out, value)
		}
	}
	return append([]string(nil), out...)
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
