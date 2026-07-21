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

	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
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
	draftMessageIDByTurn := make(map[string]string, len(state.Messages))
	identityMismatch := false
	for key, draft := range state.Messages {
		messageID := strings.TrimSpace(key)
		turnID := strings.TrimSpace(draft.TurnID)
		ref, ok := canonicalTurns[turnID]
		if !ok || messageID == "" || strings.TrimSpace(draft.MessageID) != messageID || strings.TrimSpace(draft.ThreadID) != threadID ||
			turnID == "" || strings.TrimSpace(draft.RunID) == "" || strings.TrimSpace(draft.RunID) != ref.runID {
			identityMismatch = true
			continue
		}
		if existing := draftMessageIDByTurn[turnID]; existing != "" && existing != messageID {
			identityMismatch = true
			continue
		}
		draftMessageIDByTurn[turnID] = messageID
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
		draftMessageIDByTurn = map[string]string{}
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
			turnID := strings.TrimSpace(state.Messages[messageID].TurnID)
			delete(state.Messages, messageID)
			if draftMessageIDByTurn[turnID] == messageID {
				delete(draftMessageIDByTurn, turnID)
			}
		}
	}
	usedDrafts := make(map[string]struct{}, len(state.Messages))
	out := make([]FlowerTimelineMessage, 0, len(msgs)+len(state.Messages))
	appendDraft := func(turnID string) error {
		messageID := draftMessageIDByTurn[turnID]
		draft, ok := state.Messages[messageID]
		if !ok {
			return nil
		}
		live, ok := flowerTimelineMessageFromLiveDraft(draft, activeMessageID)
		if !ok {
			return errors.New("canonical live draft is not renderable")
		}
		out = append(out, live)
		usedDrafts[messageID] = struct{}{}
		return nil
	}
	for _, msg := range msgs {
		if msg.Decoration != nil {
			continue
		}
		turnID := strings.TrimSpace(msg.CanonicalTurn)
		if strings.TrimSpace(msg.MessageID) == turnID {
			if draftMessageIDByTurn[turnID] != "" {
				if err := appendDraft(turnID); err != nil {
					return flowerTimelineProjection{}, err
				}
				continue
			}
		}
		persisted, ok, err := flowerTimelineMessageFromRaw(threadID, turnID, msg.CanonicalRun, msg.MessageID, msg.MessageJSON)
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

func (s *Service) replaceFlowerLiveDraftWithCanonicalTimeline(ctx context.Context, endpointID string, threadID string, runID string, turnID string, messageID string, reason string) error {
	if s == nil {
		return errors.New("nil service")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	turnID = strings.TrimSpace(turnID)
	messageID = strings.TrimSpace(messageID)
	if endpointID == "" || threadID == "" || runID == "" || turnID == "" {
		return errors.New("invalid canonical timeline replacement identity")
	}
	identityMismatch := false
	s.mu.Lock()
	if stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]; stream != nil && messageID != "" {
		if draft, ok := stream.State.Messages[messageID]; ok {
			if strings.TrimSpace(draft.ThreadID) != threadID || strings.TrimSpace(draft.TurnID) != turnID ||
				strings.TrimSpace(draft.RunID) != runID || strings.TrimSpace(draft.MessageID) != messageID {
				identityMismatch = true
			} else {
				delete(stream.State.Messages, messageID)
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

func flowerTimelineMessageFromRaw(threadID string, canonicalTurnID string, runID string, messageID string, raw json.RawMessage) (FlowerTimelineMessage, bool, error) {
	var record struct {
		ID         string            `json:"id"`
		TurnID     string            `json:"turn_id"`
		Role       string            `json:"role"`
		Status     string            `json:"status"`
		Timestamp  int64             `json:"timestamp"`
		Blocks     []json.RawMessage `json:"blocks"`
		References json.RawMessage   `json:"references"`
	}
	if err := json.Unmarshal(raw, &record); err != nil {
		return FlowerTimelineMessage{}, false, err
	}
	canonicalTurnID = strings.TrimSpace(canonicalTurnID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	recordTurnID := strings.TrimSpace(record.TurnID)
	if threadID == "" || runID == "" || canonicalTurnID == "" || recordTurnID == "" || recordTurnID != canonicalTurnID {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message has invalid turn identity")
	}
	id := strings.TrimSpace(record.ID)
	messageID = strings.TrimSpace(messageID)
	if id == "" {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message is missing message identity")
	}
	if messageID == "" || id != messageID {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message identity differs from its row")
	}
	role := strings.TrimSpace(record.Role)
	if role != "user" && role != "assistant" && role != "system" {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message has invalid role")
	}
	status := strings.TrimSpace(record.Status)
	switch status {
	case "streaming", "error", "complete", "canceled":
	default:
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message has invalid status")
	}
	if record.Timestamp <= 0 {
		return FlowerTimelineMessage{}, false, errors.New("canonical timeline message has invalid timestamp")
	}
	references, err := decodeFlowerTimelineMessageReferences(record.References, role)
	if err != nil {
		return FlowerTimelineMessage{}, false, err
	}
	blocks := make([]any, 0, len(record.Blocks))
	for index, block := range record.Blocks {
		var value any
		if err := json.Unmarshal(block, &value); err != nil {
			return FlowerTimelineMessage{}, false, fmt.Errorf("canonical timeline message block %d is invalid: %w", index, err)
		}
		if value == nil {
			return FlowerTimelineMessage{}, false, fmt.Errorf("canonical timeline message block %d is null", index)
		}
		if _, ok := value.(map[string]any); !ok {
			return FlowerTimelineMessage{}, false, fmt.Errorf("canonical timeline message block %d is not an object", index)
		}
		blocks = append(blocks, value)
	}
	return FlowerTimelineMessage{
		MessageID:    id,
		ThreadID:     threadID,
		TurnID:       canonicalTurnID,
		RunID:        runID,
		Role:         role,
		Content:      flowerTimelineTextFromBlocks(blocks),
		Status:       status,
		CreatedAtMs:  record.Timestamp,
		Blocks:       blocks,
		References:   references,
		Live:         false,
		ActiveCursor: false,
	}, true, nil
}

func decodeFlowerTimelineMessageReferences(raw json.RawMessage, role string) ([]FlowerMessageReference, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	if role != "user" {
		return nil, errors.New("canonical timeline message references require the user role")
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, errors.New("canonical timeline message references must be an array")
	}
	out := make([]FlowerMessageReference, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for index, item := range items {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(item, &fields); err != nil || fields == nil {
			return nil, fmt.Errorf("canonical timeline message reference %d must be an object", index)
		}
		for field := range fields {
			switch field {
			case "reference_id", "kind", "label", "text", "truncated":
			default:
				return nil, fmt.Errorf("canonical timeline message reference %d contains forbidden field %q", index, field)
			}
		}
		var reference FlowerMessageReference
		if err := json.Unmarshal(item, &reference); err != nil {
			return nil, fmt.Errorf("canonical timeline message reference %d is invalid: %w", index, err)
		}
		reference.ReferenceID = strings.TrimSpace(reference.ReferenceID)
		reference.Kind = strings.TrimSpace(reference.Kind)
		reference.Label = strings.TrimSpace(reference.Label)
		if reference.ReferenceID == "" || reference.Label == "" {
			return nil, fmt.Errorf("canonical timeline message reference %d has incomplete identity", index)
		}
		if _, exists := seen[reference.ReferenceID]; exists {
			return nil, fmt.Errorf("canonical timeline message reference %q is duplicated", reference.ReferenceID)
		}
		switch reference.Kind {
		case string(flruntime.MessageReferenceFile), string(flruntime.MessageReferenceDirectory):
			if _, textPresent := fields["text"]; textPresent {
				return nil, fmt.Errorf("canonical timeline message reference %q exposes host-only path text", reference.ReferenceID)
			}
		case string(flruntime.MessageReferenceText), string(flruntime.MessageReferenceTerminal), string(flruntime.MessageReferenceProcess):
		default:
			return nil, fmt.Errorf("canonical timeline message reference %q has invalid kind", reference.ReferenceID)
		}
		seen[reference.ReferenceID] = struct{}{}
		out = append(out, reference)
	}
	return out, nil
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
	threadID := strings.TrimSpace(draft.ThreadID)
	turnID := strings.TrimSpace(draft.TurnID)
	runID := strings.TrimSpace(draft.RunID)
	role := strings.TrimSpace(draft.Role)
	status := strings.TrimSpace(draft.Status)
	if messageID == "" || threadID == "" || turnID == "" || runID == "" || role != "assistant" {
		return FlowerTimelineMessage{}, false
	}
	switch status {
	case "streaming", "error", "complete", "canceled":
	default:
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
	return FlowerTimelineMessage{
		MessageID:    messageID,
		ThreadID:     threadID,
		TurnID:       turnID,
		RunID:        runID,
		Role:         role,
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
	if endpointID == "" || runID == "" || toolID == "" || actionID == "" || threadID == "" {
		return nil, errors.New("invalid request")
	}

	s.mu.Lock()
	requestedRun := s.runs[runID]
	authorityRun := s.runs[strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)])]
	s.mu.Unlock()
	if req.Origin == FlowerApprovalOriginControlConfirm {
		if !flowerApprovalRunOwnedBySession(requestedRun, endpointID, threadID, meta.UserPublicID) {
			return nil, errors.New("run not found")
		}
		if req.ExpectedSeq <= 0 || req.Revision <= 0 || req.Version <= 0 || req.SurfaceEpoch <= 0 {
			return nil, errors.New("invalid request")
		}
		liveAction, ok := s.flowerLiveControlApproval(endpointID, threadID, actionID)
		if !ok {
			return nil, approvalConflict("approval is no longer pending")
		}
		return s.submitControlConfirmationApproval(requestedRun, endpointID, threadID, runID, toolID, actionID, liveAction, req)
	}
	if req.Origin != FlowerApprovalOriginMainTool && req.Origin != FlowerApprovalOriginDelegatedSubagent {
		return nil, errors.New("invalid approval origin")
	}
	if !flowerApprovalRunOwnedBySession(authorityRun, endpointID, threadID, meta.UserPublicID) {
		return nil, errors.New("run not found")
	}
	if req.QueueGeneration <= 0 || req.QueueRevision <= 0 || req.Revision <= 0 {
		return nil, errors.New("invalid request")
	}
	decisionID := strings.TrimSpace(req.IdempotencyKey)
	if decisionID == "" {
		return nil, errors.New("approval idempotency key is required")
	}
	queue, pending, ok, err := authorityRun.currentFloretApproval(context.Background(), actionID, runID, toolID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, approvalConflict("approval is no longer pending")
	}
	approval, err := authorityRun.flowerApprovalActionFromFloretRecord(pending, queue)
	if err != nil {
		return nil, err
	}
	if approval.ActionID != actionID {
		return nil, approvalConflict("approval action changed")
	}
	if approval.RunID != runID || approval.ToolID != toolID || approval.Origin != req.Origin {
		return nil, approvalConflict("approval action changed")
	}
	if approval.Revision != req.Revision {
		return nil, approvalConflict("approval revision changed")
	}
	if queue.Generation != req.QueueGeneration || queue.Revision != req.QueueRevision {
		return nil, approvalConflict("approval runtime state changed")
	}
	if !approval.CanApprove {
		return nil, approvalConflict(firstNonEmptyString(approval.ReadOnlyReason, "approval is not available"))
	}
	decision := flruntime.ApprovalDecisionReject
	if req.Approved {
		decision = flruntime.ApprovalDecisionApprove
	}
	result, err := authorityRun.activeFloretHost().ResolveApproval(context.Background(), flruntime.ResolveApprovalRequest{
		DecisionID: decisionID, ExpectedRootThreadID: queue.RootThreadID,
		ExpectedGeneration: queue.Generation, ExpectedRevision: queue.Revision,
		ExpectedCurrent: flruntime.ApprovalIdentity{
			ApprovalID: pending.ApprovalID, ThreadID: pending.ThreadID, TurnID: pending.TurnID, RunID: pending.RunID,
			ToolCallID: pending.ToolCallID, EffectAttemptID: pending.EffectAttemptID,
		},
		ExpectedApprovalRevision: pending.Revision,
		Decision:                 decision,
	})
	if err != nil {
		return nil, normalizeApprovalDecisionError(err, "approval decision was already resolved")
	}
	if err := result.Validate(); err != nil {
		return nil, fmt.Errorf("invalid Floret approval resolution: %w", err)
	}
	resolved, err := s.publishFloretApprovalResult(endpointID, threadID, authorityRun, result)
	if err != nil {
		return nil, err
	}
	return &SubmitFlowerApprovalResponse{OK: true, CurrentCursor: resolved}, nil
}

func (s *Service) flowerLiveControlApproval(endpointID string, threadID string, actionID string) (FlowerApprovalAction, bool) {
	if s == nil {
		return FlowerApprovalAction{}, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	stream := s.flowerLiveByThread[runThreadKey(endpointID, threadID)]
	if stream == nil {
		return FlowerApprovalAction{}, false
	}
	action, ok := stream.State.ApprovalActions[strings.TrimSpace(actionID)]
	if !ok || !validFlowerControlApprovalAction(action, FlowerLiveApprovalRequested) {
		return FlowerApprovalAction{}, false
	}
	return action, true
}

func flowerApprovalRunOwnedBySession(r *run, endpointID string, threadID string, userPublicID string) bool {
	return r != nil && strings.TrimSpace(r.endpointID) == strings.TrimSpace(endpointID) &&
		strings.TrimSpace(r.threadID) == strings.TrimSpace(threadID) && !r.isDetached() &&
		strings.TrimSpace(r.userPublicID) == strings.TrimSpace(userPublicID)
}

func (s *Service) publishFloretApprovalResult(endpointID string, threadID string, r *run, result flruntime.ResolveApprovalResult) (int64, error) {
	if s == nil || r == nil {
		return 0, errors.New("approval projection is unavailable")
	}
	if err := result.Validate(); err != nil {
		return 0, fmt.Errorf("invalid Floret approval resolution: %w", err)
	}
	actions, err := r.flowerApprovalActionsFromFloretQueue(result.Queue)
	if err != nil {
		return 0, err
	}
	queue, err := flowerApprovalQueueFromFloret(result.Queue, actions)
	if err != nil {
		return 0, err
	}
	event := s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID,
		ThreadID:   threadID,
		RunID:      strings.TrimSpace(r.id),
		TurnID:     strings.TrimSpace(r.turnID),
		Kind:       FlowerLiveApprovalQueueReplaced,
		Payload: mustFlowerPayload(FlowerLiveApprovalQueuePayload{
			Actions:       actions,
			ApprovalQueue: *queue,
		}),
	})
	if !r.isDetached() {
		r.publishThreadApprovalStateForCanonicalQueue(actions)
	}
	return event.Seq, nil
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
	if r.activeFloretHost() == nil {
		r.publishThreadApprovalStateForCanonicalQueue(nil)
	} else if err := r.syncFloretApprovalQueue(context.Background()); err != nil {
		return nil, fmt.Errorf("refresh Floret approval queue after control confirmation: %w", err)
	}
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
	event = appendFlowerLiveEventLocked(stream, event)
	applyFlowerLiveEventToMaterializedState(&stream.State, stream.ApprovalIndex, event)
	if event.Kind == FlowerLiveApprovalQueueReplaced && s.log != nil && stream.State.ApprovalQueue != nil {
		queue := stream.State.ApprovalQueue
		s.log.Debug("flower approval queue", "endpoint_id", event.EndpointID, "thread_id", event.ThreadID, "generation", queue.Generation, "revision", queue.Revision, "current_action_id", queue.CurrentActionID, "position", queue.CurrentPosition, "total", queue.Total, "unresolved", queue.UnresolvedCount)
	}
	s.mu.Unlock()
	return event
}

func appendFlowerLiveEventLocked(stream *flowerLiveThreadStream, event FlowerLiveEvent) FlowerLiveEvent {
	event.Seq = stream.NextSeq
	stream.NextSeq++
	event = flowerLiveEventWithAssignedSeqPayload(stream, event)
	event.Payload = cloneRawMessage(event.Payload)
	stream.Events = append(stream.Events, cloneFlowerLiveEvent(event))
	if len(stream.Events) > flowerLiveEventBufferLimit {
		copy(stream.Events, stream.Events[len(stream.Events)-flowerLiveEventBufferLimit:])
		stream.Events = stream.Events[:flowerLiveEventBufferLimit]
	}
	return event
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
	if event.Kind == FlowerLiveApprovalQueueReplaced {
		var payload FlowerLiveApprovalQueuePayload
		if !decodeFlowerPayload(event.Payload, &payload) {
			return event
		}
		for index := range payload.Actions {
			action := payload.Actions[index]
			if action.ExpectedSeq < 0 {
				return event
			}
			if action.ExpectedSeq == 0 {
				action.ExpectedSeq = event.Seq
			}
			payload.Actions[index] = action
		}
		if !validFlowerCanonicalApprovalReplacement(payload) {
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
	if payload.Action.ExpectedSeq < 0 {
		return event
	}
	if payload.Action.ExpectedSeq == 0 {
		if current, ok := stream.State.ApprovalActions[payload.Action.ActionID]; ok && current.ExpectedSeq > 0 {
			payload.Action.ExpectedSeq = current.ExpectedSeq
		} else if event.Kind == FlowerLiveApprovalRequested {
			payload.Action.ExpectedSeq = event.Seq
		} else {
			return event
		}
	}
	if !validFlowerControlApprovalAction(payload.Action, event.Kind) {
		return event
	}
	event.Payload = mustFlowerPayload(payload)
	return event
}

func validFlowerControlApprovalAction(action FlowerApprovalAction, kind FlowerLiveKind) bool {
	if action.Origin != FlowerApprovalOriginControlConfirm ||
		strings.TrimSpace(action.ActionID) == "" ||
		strings.TrimSpace(action.RunID) == "" ||
		strings.TrimSpace(action.ToolID) == "" ||
		strings.TrimSpace(action.ToolName) == "" ||
		action.Revision <= 0 || action.Version != action.Revision || action.SurfaceEpoch <= 0 ||
		action.RequestedAtMs <= 0 || action.BatchIndex < 0 || action.BatchSize <= 0 ||
		action.BatchIndex >= action.BatchSize || action.ExpectedSeq <= 0 ||
		action.QueueGeneration != 0 || action.QueueOrder != 0 || action.BatchIndex != 0 || action.BatchSize != 1 ||
		strings.TrimSpace(action.Summary.Label) == "" {
		return false
	}
	switch kind {
	case FlowerLiveApprovalRequested:
		return action.State == FlowerApprovalStateRequested && action.Status == FlowerApprovalStatusPending &&
			action.CanApprove && action.ResolvedAtMs == 0
	case FlowerLiveApprovalResolved:
		if action.Status == FlowerApprovalStatusUnavailable {
			return action.State == FlowerApprovalStateUnavailable && !action.CanApprove && action.ResolvedAtMs > 0
		}
		return action.Status == FlowerApprovalStatusResolved &&
			(action.State == FlowerApprovalStateApproved || action.State == FlowerApprovalStateRejected ||
				action.State == FlowerApprovalStateTimedOut || action.State == FlowerApprovalStateCanceled) &&
			!action.CanApprove && action.ResolvedAtMs > 0
	default:
		return false
	}
}

func validFlowerCanonicalApprovalReplacement(payload FlowerLiveApprovalQueuePayload) bool {
	queue := payload.ApprovalQueue
	if queue.Generation < 0 || queue.Revision < 0 || queue.CurrentPosition < 0 ||
		queue.Total < 0 || queue.UnresolvedCount < 0 ||
		queue.Total != len(payload.Actions) || queue.UnresolvedCount != len(payload.Actions) {
		return false
	}
	if len(payload.Actions) == 0 {
		return strings.TrimSpace(queue.CurrentActionID) == "" && queue.CurrentPosition == 0
	}
	if queue.Generation <= 0 || queue.Revision <= 0 || queue.CurrentPosition != 1 || strings.TrimSpace(queue.CurrentActionID) == "" {
		return false
	}
	actionIDs := make(map[string]struct{}, len(payload.Actions))
	queueOrders := make(map[int64]struct{}, len(payload.Actions))
	actionableCount := 0
	for index, action := range payload.Actions {
		actionID := strings.TrimSpace(action.ActionID)
		if (action.Origin != FlowerApprovalOriginMainTool && action.Origin != FlowerApprovalOriginDelegatedSubagent) ||
			actionID == "" || strings.TrimSpace(action.RunID) == "" || strings.TrimSpace(action.ToolID) == "" ||
			strings.TrimSpace(action.ToolName) == "" || action.State != FlowerApprovalStateRequested ||
			action.Status != FlowerApprovalStatusPending || action.Revision <= 0 || action.Version != action.Revision ||
			action.SurfaceEpoch <= 0 || action.QueueGeneration <= 0 || action.SurfaceEpoch != action.QueueGeneration ||
			action.QueueGeneration != queue.Generation || action.QueueOrder <= 0 || action.ExpectedSeq <= 0 ||
			action.RequestedAtMs <= 0 || action.BatchIndex < 0 || action.BatchSize <= 0 ||
			action.BatchIndex >= action.BatchSize || !strings.HasPrefix(strings.TrimSpace(action.Scope), "thread:") ||
			strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(action.Scope), "thread:")) == "" ||
			strings.TrimSpace(action.Summary.Label) == "" {
			return false
		}
		if _, exists := actionIDs[actionID]; exists {
			return false
		}
		actionIDs[actionID] = struct{}{}
		if _, exists := queueOrders[action.QueueOrder]; exists {
			return false
		}
		queueOrders[action.QueueOrder] = struct{}{}
		if index > 0 && payload.Actions[index-1].QueueOrder >= action.QueueOrder {
			return false
		}
		if action.CanApprove {
			actionableCount++
			if actionID != queue.CurrentActionID {
				return false
			}
		}
	}
	return payload.Actions[0].ActionID == queue.CurrentActionID && actionableCount <= 1
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
			TurnID:     strings.TrimSpace(ev.TurnID),
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
			base(FlowerLiveRunStarted, FlowerLiveRunStartedPayload{RunID: strings.TrimSpace(ev.RunID), TurnID: strings.TrimSpace(ev.TurnID), MessageID: messageID, Status: string(RunStateRunning)}),
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
		return []FlowerLiveEvent{base(FlowerLiveMessageBlockSet, FlowerLiveMessageBlockSetPayload{
			MessageID:  messageID,
			BlockIndex: stream.BlockIndex,
			Block:      block,
		})}
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
		return []FlowerLiveEvent{base(kind, FlowerLiveApprovalPayload{Action: stream.Action, ApprovalQueue: cloneFlowerApprovalQueue(stream.ApprovalQueue)})}
	case streamEventApprovalQueue:
		return []FlowerLiveEvent{base(FlowerLiveApprovalQueueReplaced, FlowerLiveApprovalQueuePayload{
			Actions:       append([]FlowerApprovalAction(nil), stream.Actions...),
			ApprovalQueue: stream.ApprovalQueue,
		})}
	default:
		return nil
	}
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
		if decodeFlowerPayload(event.Payload, &payload) && strings.TrimSpace(payload.MessageID) != "" &&
			strings.TrimSpace(event.ThreadID) != "" && strings.TrimSpace(event.TurnID) != "" && strings.TrimSpace(event.RunID) != "" &&
			strings.TrimSpace(payload.Role) == "assistant" && strings.TrimSpace(payload.Status) == "streaming" {
			id := strings.TrimSpace(payload.MessageID)
			msg, exists := state.Messages[id]
			if exists && (strings.TrimSpace(msg.ThreadID) != strings.TrimSpace(event.ThreadID) ||
				strings.TrimSpace(msg.TurnID) != strings.TrimSpace(event.TurnID) ||
				strings.TrimSpace(msg.RunID) != strings.TrimSpace(event.RunID) ||
				strings.TrimSpace(msg.MessageID) != id) {
				return
			}
			msg.ThreadID = strings.TrimSpace(event.ThreadID)
			msg.TurnID = strings.TrimSpace(event.TurnID)
			msg.RunID = strings.TrimSpace(event.RunID)
			msg.MessageID = id
			msg.Role = "assistant"
			msg.Status = "streaming"
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
	case FlowerLiveApprovalQueueReplaced:
		var payload FlowerLiveApprovalQueuePayload
		if !decodeFlowerPayload(event.Payload, &payload) || !validFlowerCanonicalApprovalReplacement(payload) {
			return
		}
		if current := state.ApprovalQueue; current != nil &&
			(payload.ApprovalQueue.Generation < current.Generation ||
				payload.ApprovalQueue.Generation == current.Generation && payload.ApprovalQueue.Revision < current.Revision) {
			return
		}
		actions := make(map[string]FlowerApprovalAction, len(payload.Actions)+len(state.ApprovalActions))
		for actionID, action := range state.ApprovalActions {
			if action.Origin == FlowerApprovalOriginControlConfirm {
				actions[actionID] = action
			}
		}
		for _, action := range payload.Actions {
			actionID := strings.TrimSpace(action.ActionID)
			if actionID == "" || action.Origin == FlowerApprovalOriginControlConfirm ||
				action.Status != FlowerApprovalStatusPending || action.State != FlowerApprovalStateRequested {
				continue
			}
			actions[actionID] = action
			clearFlowerModelIOForRun(state, action.RunID)
			markFlowerLiveRunWaitingApproval(state, action.RunID)
			if approvals != nil {
				approvals[actionID] = action.State
			}
		}
		state.ApprovalActionsSeen = true
		state.ApprovalActions = actions
		state.ApprovalQueue = cloneFlowerApprovalQueue(&payload.ApprovalQueue)
	case FlowerLiveApprovalRequested, FlowerLiveApprovalResolved:
		var payload FlowerLiveApprovalPayload
		if decodeFlowerPayload(event.Payload, &payload) && validFlowerControlApprovalAction(payload.Action, event.Kind) {
			state.ApprovalActionsSeen = true
			if event.Kind == FlowerLiveApprovalRequested {
				clearFlowerModelIOForRun(state, payload.Action.RunID)
			}
			action := payload.Action
			if event.Kind == FlowerLiveApprovalRequested && approvals != nil {
				if _, hadPrev := approvals[action.ActionID]; hadPrev {
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
				delete(state.ApprovalActions, action.ActionID)
				if approvals != nil {
					approvals[action.ActionID] = action.State
				}
				return
			}
			if action.Status == FlowerApprovalStatusUnavailable {
				action.CanApprove = false
			}
			state.ApprovalActions[action.ActionID] = action
			if event.Kind == FlowerLiveApprovalRequested && action.Status == FlowerApprovalStatusPending {
				markFlowerLiveRunWaitingApproval(state, action.RunID)
			}
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

func ensureFlowerLiveMessageForEvent(state *FlowerLiveMaterializedState, event FlowerLiveEvent, messageID string) (FlowerLiveMessageDraft, bool) {
	if state == nil {
		return FlowerLiveMessageDraft{}, false
	}
	messageID = strings.TrimSpace(messageID)
	threadID := strings.TrimSpace(event.ThreadID)
	turnID := strings.TrimSpace(event.TurnID)
	runID := strings.TrimSpace(event.RunID)
	if messageID == "" || threadID == "" || turnID == "" || runID == "" {
		return FlowerLiveMessageDraft{}, false
	}
	msg, ok := state.Messages[messageID]
	if !ok || strings.TrimSpace(msg.ThreadID) != threadID || strings.TrimSpace(msg.TurnID) != turnID ||
		strings.TrimSpace(msg.RunID) != runID || strings.TrimSpace(msg.MessageID) != messageID {
		return FlowerLiveMessageDraft{}, false
	}
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
		TitleStatus:            strings.TrimSpace(ev.TitleStatus),
		ModelID:                strings.TrimSpace(ev.ModelID),
		PermissionType:         strings.TrimSpace(ev.PermissionType),
		QueuedTurnCount:        &queued,
		QueuedTurns:            cloneQueuedTurnViews(ev.QueuedTurns),
		QueuedTurnsSet:         true,
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
		TitleSet:               true,
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
	if patch.TitleSet {
		current.TitleSet = true
		current.Title = strings.TrimSpace(patch.Title)
	}
	if strings.TrimSpace(patch.TitleStatus) != "" {
		current.TitleStatus = strings.TrimSpace(patch.TitleStatus)
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
	if patch.QueuedTurnsSet {
		current.QueuedTurnsSet = true
		current.QueuedTurns = cloneQueuedTurnViews(patch.QueuedTurns)
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
		TurnID:        strings.TrimSpace(r.turnID),
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

func flowerApprovalActionID(runID string, toolID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(runID) + "\x00" + strings.TrimSpace(toolID)))
	return "appr_" + base64.RawURLEncoding.EncodeToString(sum[:18])
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
	out.QueuedTurns = cloneQueuedTurnViews(in.QueuedTurns)
	out.QueuedTurnsSet = in.QueuedTurnsSet
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

func cloneQueuedTurnViews(in []QueuedTurnView) []QueuedTurnView {
	if in == nil {
		return nil
	}
	out := make([]QueuedTurnView, len(in))
	for index, item := range in {
		out[index] = item
		out[index].Attachments = append([]FollowupAttachmentView(nil), item.Attachments...)
		out[index].ContextAction = normalizeContextActionEnvelope(item.ContextAction)
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
