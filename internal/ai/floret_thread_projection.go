package ai

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	flruntime "github.com/floegence/floret/runtime"
)

func (r *run) applyFloretThreadProjection(projection flruntime.ThreadTurnProjection) bool {
	return r.applyFloretThreadProjectionInternal(projection, true, false, false)
}

func (r *run) applyFloretTerminalThreadProjection(projection flruntime.ThreadTurnProjection) bool {
	return r.applyFloretThreadProjectionInternal(projection, false, true, true)
}

func (r *run) applyFloretThreadProjectionInternal(projection flruntime.ThreadTurnProjection, emit bool, allowDetached bool, requireIdentity bool) bool {
	if r == nil {
		return false
	}
	if !allowDetached && !r.acceptsPresentationUpdates() {
		return false
	}
	if !r.floretThreadProjectionMatchesRun(projection, requireIdentity) {
		return false
	}
	blocks, valid := r.flowerBlocksFromFloretThreadProjectionChecked(projection)
	if !valid {
		return false
	}
	if len(blocks) == 0 {
		blocks = []any{&persistedMarkdownBlock{Type: "markdown", Content: ""}}
	}
	r.mu.Lock()
	r.nextBlockIndex = len(blocks)
	r.currentTextBlockIndex = -1
	r.currentThinkingBlockIndex = -1
	r.needNewTextBlock = true
	r.needNewThinkingBlock = true
	r.activitySegmentActive = false
	r.activitySegmentBlockIndex = -1
	r.mu.Unlock()
	r.muAssistant.Lock()
	if r.assistantCreatedAtUnixMs == 0 {
		r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
	}
	oldLen := len(r.assistantBlocks)
	r.assistantBlocks = blocks
	r.floretThreadProjectionApplied = true
	r.muAssistant.Unlock()
	if !emit {
		return true
	}
	for idx, block := range blocks {
		r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	}
	for idx := len(blocks); idx < oldLen; idx++ {
		r.sendStreamEvent(streamEventBlockSet{
			Type:       "block-set",
			MessageID:  r.messageID,
			BlockIndex: idx,
			Block:      persistedMarkdownBlock{Type: "markdown", Content: ""},
		})
	}
	return true
}

func (r *run) floretThreadProjectionMatchesRun(projection flruntime.ThreadTurnProjection, requireIdentity bool) bool {
	if r == nil {
		return false
	}
	runID := strings.TrimSpace(string(projection.RunID))
	threadID := strings.TrimSpace(string(projection.ThreadID))
	turnID := strings.TrimSpace(string(projection.TurnID))
	if requireIdentity && (runID == "" || threadID == "" || turnID == "") {
		return false
	}
	if runID != "" && runID != strings.TrimSpace(r.id) {
		return false
	}
	if threadID != "" && threadID != strings.TrimSpace(r.threadID) {
		return false
	}
	if turnID != "" && turnID != strings.TrimSpace(r.messageID) {
		return false
	}
	return true
}

func (r *run) flowerBlocksFromFloretThreadProjection(projection flruntime.ThreadTurnProjection) []any {
	blocks, _ := r.flowerBlocksFromFloretThreadProjectionChecked(projection)
	return blocks
}

func (r *run) flowerBlocksFromFloretThreadProjectionChecked(projection flruntime.ThreadTurnProjection) ([]any, bool) {
	if r == nil || len(projection.Segments) == 0 {
		return nil, true
	}
	blocks := make([]any, 0, len(projection.Segments))
	for _, segment := range projection.Segments {
		switch segment.Kind {
		case flruntime.ThreadTurnProjectionSegmentAssistantText:
			if strings.TrimSpace(segment.Text) == "" {
				continue
			}
			blocks = append(blocks, &persistedMarkdownBlock{Type: "markdown", Content: segment.Text})
		case flruntime.ThreadTurnProjectionSegmentActivityTimeline:
			if segment.ActivityTimeline == nil || len(segment.ActivityTimeline.Items) == 0 {
				continue
			}
			timeline := r.normalizeActivityTimeline(*segment.ActivityTimeline)
			if !r.validateActivityTimelineForProjection(timeline, "floret_thread_projection") {
				return nil, false
			}
			blocks = append(blocks, newActivityTimelineBlock(timeline, r.activityTimelineFileActions(timeline)))
		case flruntime.ThreadTurnProjectionSegmentControlSignal:
			continue
		}
	}
	return blocks, true
}

func (r *run) recordFloretCommittedThreadEvent(ev *flruntime.ThreadDetailEvent) {
	if r == nil || ev == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	if strings.TrimSpace(string(ev.TurnID)) != strings.TrimSpace(r.messageID) {
		return
	}
	r.muAssistant.Lock()
	for _, existing := range r.floretCommittedThreadEvents {
		if floretThreadDetailEventsSameEntry(existing, *ev) {
			r.muAssistant.Unlock()
			return
		}
	}
	r.floretCommittedThreadEvents = append(r.floretCommittedThreadEvents, *ev)
	sort.SliceStable(r.floretCommittedThreadEvents, func(i, j int) bool {
		left := r.floretCommittedThreadEvents[i]
		right := r.floretCommittedThreadEvents[j]
		if left.Ordinal != right.Ordinal {
			return left.Ordinal < right.Ordinal
		}
		if !left.CreatedAt.Equal(right.CreatedAt) {
			return left.CreatedAt.Before(right.CreatedAt)
		}
		return left.ID < right.ID
	})
	r.muAssistant.Unlock()
	r.applyCommittedFloretThreadDetailProjection()
}

func floretThreadDetailEventsSameEntry(left flruntime.ThreadDetailEvent, right flruntime.ThreadDetailEvent) bool {
	leftID := strings.TrimSpace(left.ID)
	rightID := strings.TrimSpace(right.ID)
	if leftID != "" && rightID != "" {
		return leftID == rightID
	}
	return left.Ordinal != 0 && left.Ordinal == right.Ordinal
}

func (r *run) applyCommittedFloretThreadDetailProjection() bool {
	if r == nil {
		return false
	}
	if !r.acceptsPresentationUpdates() {
		return false
	}
	r.muAssistant.Lock()
	events := append([]flruntime.ThreadDetailEvent(nil), r.floretCommittedThreadEvents...)
	r.muAssistant.Unlock()
	if len(events) == 0 {
		return false
	}
	projection := flruntime.ProjectThreadTurn(flruntime.ProjectThreadTurnRequest{
		ThreadID: flruntime.ThreadID(strings.TrimSpace(r.threadID)),
		TurnID:   flruntime.TurnID(strings.TrimSpace(r.messageID)),
		RunID:    flruntime.RunID(strings.TrimSpace(r.id)),
		TraceID:  flruntime.TraceID(strings.TrimSpace(r.id)),
		Events:   events,
	})
	return r.applyFloretThreadProjection(projection)
}

func (r *run) hasFloretThreadDetailProjectionApplied() bool {
	if r == nil {
		return false
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	return r.floretThreadProjectionApplied
}

func (s *Service) settlePendingToolWithActiveFloretRun(ctx context.Context, endpointID string, threadID string, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	if s == nil {
		return flruntime.PendingToolSettlementResult{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if active := s.activeRunForFloretSettlement(endpointID, threadID, string(req.RunID)); active != nil && !active.isDetached() {
		if host := active.activeFloretHost(); host != nil {
			return host.SettlePendingTool(ctx, req)
		}
	}
	return flruntime.PendingToolSettlementResult{}, errors.New("active floret settlement host unavailable")
}

func (s *Service) activeRunForFloretSettlement(endpointID string, threadID string, runID string) *run {
	if s == nil {
		return nil
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	if endpointID == "" || threadID == "" || runID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(s.activeRunByTh[runThreadKey(endpointID, threadID)]) != runID {
		return nil
	}
	return s.runs[runID]
}

func (s *Service) applyFloretPendingToolSettlementProjection(ctx context.Context, endpointID string, threadID string, runID string, messageID string, projection flruntime.ThreadTurnProjection) error {
	if s == nil {
		return errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if active := s.activeRunForFloretSettlement(endpointID, threadID, runID); active != nil {
		if active.acceptsPresentationUpdates() {
			active.applyFloretThreadProjection(projection)
		} else {
			active.applyFloretTerminalThreadProjection(projection)
		}
	}
	return s.persistFloretProjectionToAssistantMessage(ctx, endpointID, threadID, runID, messageID, projection)
}

func (s *Service) persistFloretProjectionToAssistantMessage(ctx context.Context, endpointID string, threadID string, runID string, messageID string, projection flruntime.ThreadTurnProjection) error {
	if s == nil || s.threadsDB == nil {
		return errors.New("threads store not ready")
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	runID = strings.TrimSpace(runID)
	messageID = strings.TrimSpace(messageID)
	if endpointID == "" || threadID == "" || runID == "" || messageID == "" {
		return errors.New("invalid floret projection target")
	}
	ctx, cancel := context.WithTimeout(ctx, s.persistTimeout())
	rowID, raw, err := s.threadsDB.GetTranscriptMessageRowIDAndJSONByMessageID(ctx, endpointID, threadID, messageID)
	cancel()
	if err != nil {
		return err
	}
	status, createdAt, err := persistedMessageStatusAndTimestamp(raw)
	if err != nil {
		return err
	}
	if createdAt <= 0 {
		createdAt = time.Now().UnixMilli()
	}
	projectionRun := &run{
		id:                       runID,
		endpointID:               endpointID,
		threadID:                 threadID,
		messageID:                messageID,
		service:                  s,
		assistantCreatedAtUnixMs: createdAt,
	}
	blocks := projectionRun.flowerBlocksFromFloretThreadProjection(projection)
	if len(blocks) == 0 {
		return errors.New("empty floret projection")
	}
	projectionRun.assistantBlocks = blocks
	rawJSON, _, at, err := projectionRun.snapshotAssistantMessageJSONWithStatus(status)
	if err != nil {
		return err
	}
	if at <= 0 {
		at = createdAt
	}
	ctx, cancel = context.WithTimeout(context.Background(), s.persistTimeout())
	err = s.threadsDB.UpdateTranscriptMessageJSONByRowID(ctx, endpointID, rowID, rawJSON, at)
	cancel()
	if err != nil {
		return err
	}
	s.broadcastTranscriptMessage(endpointID, threadID, runID, rowID, rawJSON, at)
	s.broadcastThreadSummary(endpointID, threadID)
	if s.threadMgr != nil {
		s.threadMgr.Wake(endpointID, threadID)
	}
	return nil
}

func persistedMessageStatusAndTimestamp(raw string) (string, int64, error) {
	var msg persistedMessage
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &msg); err != nil {
		return "", 0, err
	}
	status := normalizeSnapshotMessageStatus(msg.Status)
	if status == "" {
		return "", msg.Timestamp, errors.New("persisted assistant message status is invalid")
	}
	return status, msg.Timestamp, nil
}
