package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
)

func (r *run) applyFloretThreadProjection(projection flruntime.ThreadTurnProjection) bool {
	return r.applyFloretThreadProjectionInternal(projection, true, false)
}

func (r *run) applyFloretThreadProjectionInternal(projection flruntime.ThreadTurnProjection, emit bool, allowDetached bool) bool {
	if r == nil {
		return false
	}
	if !allowDetached && !r.acceptsPresentationUpdates() {
		return false
	}
	if err := r.validateFloretThreadProjection(projection); err != nil {
		r.rejectFloretContract("turn_projection", err)
		return false
	}
	projectionKey := floretProjectionIdentityKey(projection)
	r.muFloretProjection.Lock()
	if projection.ThroughOrdinal <= r.floretProjectionOrdinal[projectionKey] {
		r.muFloretProjection.Unlock()
		return false
	}
	blocks, err := r.flowerBlocksFromFloretThreadProjection(projection)
	if err != nil {
		r.muFloretProjection.Unlock()
		r.rejectFloretContract("turn_projection", err)
		return false
	}
	r.mu.Lock()
	r.nextBlockIndex = len(blocks)
	r.currentTextBlockIndex = -1
	r.currentThinkingBlockIndex = -1
	r.needNewTextBlock = true
	r.needNewThinkingBlock = true
	r.mu.Unlock()
	r.muAssistant.Lock()
	if r.assistantCreatedAtUnixMs == 0 {
		r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
	}
	oldLen := len(r.assistantBlocks)
	r.assistantBlocks = blocks
	r.muAssistant.Unlock()
	if r.floretProjectionOrdinal == nil {
		r.floretProjectionOrdinal = map[string]int64{}
	}
	r.floretProjectionOrdinal[projectionKey] = projection.ThroughOrdinal
	r.muFloretProjection.Unlock()
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

func (r *run) validateFloretThreadProjection(projection flruntime.ThreadTurnProjection) error {
	if r == nil {
		return errors.New("nil run")
	}
	if err := projection.Validate(); err != nil {
		return err
	}
	if !r.floretThreadProjectionMatchesRun(projection) {
		return errors.New("Floret turn projection identity mismatch")
	}
	return nil
}

func floretProjectionIdentityKey(projection flruntime.ThreadTurnProjection) string {
	return strings.Join([]string{
		strings.TrimSpace(string(projection.ThreadID)),
		strings.TrimSpace(string(projection.TurnID)),
		strings.TrimSpace(string(projection.RunID)),
	}, "\x00")
}

func (r *run) floretThreadProjectionMatchesRun(projection flruntime.ThreadTurnProjection) bool {
	if r == nil {
		return false
	}
	runID := strings.TrimSpace(string(projection.RunID))
	threadID := strings.TrimSpace(string(projection.ThreadID))
	turnID := strings.TrimSpace(string(projection.TurnID))
	if runID == "" || threadID == "" || turnID == "" {
		return false
	}
	if projectionIdentityMatchesRun(runID, threadID, turnID, strings.TrimSpace(r.id), strings.TrimSpace(r.threadID), strings.TrimSpace(r.messageID)) {
		return true
	}
	return projectionIdentityMatchesRun(runID, threadID, turnID, strings.TrimSpace(r.settlementRunID), strings.TrimSpace(r.settlementThreadID), strings.TrimSpace(r.settlementTurnID))
}

func projectionIdentityMatchesRun(projectionRunID string, projectionThreadID string, projectionTurnID string, runID string, threadID string, turnID string) bool {
	if projectionRunID == "" || projectionThreadID == "" || projectionTurnID == "" || runID == "" || threadID == "" || turnID == "" {
		return false
	}
	return projectionRunID == runID && projectionThreadID == threadID && projectionTurnID == turnID
}

func (r *run) flowerBlocksFromFloretThreadProjection(projection flruntime.ThreadTurnProjection) ([]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	if len(projection.Segments) == 0 {
		return nil, nil
	}
	blocks := make([]any, 0, len(projection.Segments))
	for index, segment := range projection.Segments {
		switch segment.Kind {
		case flruntime.ThreadTurnProjectionSegmentAssistantText:
			if strings.TrimSpace(segment.Text) == "" {
				continue
			}
			blocks = append(blocks, &persistedMarkdownBlock{Type: "markdown", Content: segment.Text})
		case flruntime.ThreadTurnProjectionSegmentActivityTimeline:
			if segment.ActivityTimeline == nil {
				return nil, fmt.Errorf("Floret turn projection segment %d is missing activity timeline", index)
			}
			timeline := *observation.CloneActivityTimeline(segment.ActivityTimeline)
			blocks = append(blocks, r.newActivityTimelineBlock(timeline, r.activityTimelineFileActions(timeline)))
		case flruntime.ThreadTurnProjectionSegmentControlSignal:
			continue
		default:
			return nil, fmt.Errorf("unsupported Floret turn projection segment kind %q at segment %d", segment.Kind, index)
		}
	}
	return blocks, nil
}

func (s *Service) activeRunForFloretProjection(endpointID string, threadID string, runID string) *run {
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
	r := s.runs[runID]
	if r == nil {
		return nil
	}
	if strings.TrimSpace(r.endpointID) != endpointID || strings.TrimSpace(r.threadID) != threadID {
		return nil
	}
	return r
}

func (s *Service) applyFloretPendingToolSettlementProjection(ctx context.Context, endpointID string, threadID string, runID string, messageID string, settled flruntime.PendingToolSettlementResult) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := settled.Validate(); err != nil {
		return fmt.Errorf("invalid pending tool settlement projection outcome: %w", err)
	}
	if settled.ProjectionAvailability == flruntime.TurnProjectionAvailabilityUnavailable {
		if active := s.activeRunForFloretProjection(endpointID, threadID, runID); active != nil {
			active.persistRunEvent("floret.projection.unavailable", RealtimeStreamKindLifecycle, map[string]any{
				"source": "pending_tool_settlement",
				"error":  sanitizeLogText(settled.ProjectionError, 240),
			})
		}
		s.broadcastThreadSummary(endpointID, threadID)
		if s.threadMgr != nil {
			s.threadMgr.Wake(endpointID, threadID)
		}
		return nil
	}
	projection := settled.Projection
	if projection == nil {
		return errors.New("ready pending tool settlement is missing projection")
	}
	if active := s.activeRunForFloretProjection(endpointID, threadID, runID); active != nil {
		active.applyFloretThreadProjectionInternal(*projection, active.acceptsPresentationUpdates(), true)
	}
	if err := s.publishFlowerCanonicalTimelineReplacement(ctx, endpointID, threadID, runID, messageID, "terminal_settlement"); err != nil {
		return err
	}
	s.broadcastThreadSummary(endpointID, threadID)
	if s.threadMgr != nil {
		s.threadMgr.Wake(endpointID, threadID)
	}
	return nil
}
