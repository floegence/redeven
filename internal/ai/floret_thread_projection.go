package ai

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/floegence/floret/v3/observation"
	flruntime "github.com/floegence/floret/v3/runtime"
)

func (r *run) applyFloretThreadProjection(projection flruntime.ThreadTurnProjection) bool {
	return r.applyFloretThreadProjectionInternal(projection, true, false)
}

func (r *run) applyFloretThreadProjectionDelta(delta flruntime.ThreadTurnProjectionDelta) bool {
	applied, err := r.applyFloretThreadProjectionDeltaInternal(delta)
	if err != nil {
		r.rejectFloretContract("turn_projection_delta", err)
		return false
	}
	return applied
}

func (r *run) applyFloretThreadProjectionDeltaInternal(delta flruntime.ThreadTurnProjectionDelta) (bool, error) {
	if r == nil || !r.acceptsPresentationUpdates() {
		return false, nil
	}
	projectionStartedAt := time.Now()
	if r.liveMetrics != nil {
		r.liveMetrics.projectionDeltas.Add(1)
		defer func() {
			r.liveMetrics.projectionNanoseconds.Add(uint64(time.Since(projectionStartedAt)))
		}()
	}
	key := strings.Join([]string{
		strings.TrimSpace(string(delta.ThreadID)),
		strings.TrimSpace(string(delta.TurnID)),
		strings.TrimSpace(string(delta.RunID)),
	}, "\x00")
	r.muFloretProjection.Lock()
	previous, hasPrevious := r.floretProjectionDeltaByKey[key]
	var previousPointer *flruntime.ThreadTurnProjection
	if hasPrevious && delta.BaseThroughOrdinal > 0 {
		previousPointer = &previous
	}
	projection, err := flruntime.ApplyThreadTurnProjectionDelta(previousPointer, delta)
	if err != nil {
		r.muFloretProjection.Unlock()
		return false, err
	}
	if r.floretProjectionDeltaByKey == nil {
		r.floretProjectionDeltaByKey = map[string]flruntime.ThreadTurnProjection{}
	}
	r.floretProjectionDeltaByKey[key] = projection
	r.muFloretProjection.Unlock()
	return r.applyFloretThreadProjectionContent(projection, true, false, true), nil
}

func (r *run) rememberFloretProjectionDeltaLineage(projection flruntime.ThreadTurnProjection) {
	if r == nil {
		return
	}
	key := floretProjectionIdentityKey(projection)
	r.muFloretProjection.Lock()
	if r.floretProjectionDeltaByKey == nil {
		r.floretProjectionDeltaByKey = map[string]flruntime.ThreadTurnProjection{}
	}
	previous, ok := r.floretProjectionDeltaByKey[key]
	if !ok || projection.ThroughOrdinal >= previous.ThroughOrdinal {
		r.floretProjectionDeltaByKey[key] = projection
	}
	r.muFloretProjection.Unlock()
}

func (r *run) applyFloretThreadProjectionInternal(projection flruntime.ThreadTurnProjection, emit bool, allowDetached bool) bool {
	return r.applyFloretThreadProjectionContent(projection, emit, allowDetached, false)
}

func (r *run) applyFloretThreadProjectionContent(projection flruntime.ThreadTurnProjection, emit bool, allowDetached bool, allowDeltaLineage bool) bool {
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
	if !allowDeltaLineage && projection.ThroughOrdinal <= r.floretProjectionOrdinal[projectionKey] {
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
	oldBlocks := append([]any(nil), r.assistantBlocks...)
	oldLen := len(oldBlocks)
	r.assistantBlocks = blocks
	r.muAssistant.Unlock()
	if r.floretProjectionOrdinal == nil {
		r.floretProjectionOrdinal = map[string]int64{}
	}
	if r.floretProjectionByKey == nil {
		r.floretProjectionByKey = map[string]flruntime.ThreadTurnProjection{}
	}
	if projection.ThroughOrdinal > r.floretProjectionOrdinal[projectionKey] {
		r.floretProjectionOrdinal[projectionKey] = projection.ThroughOrdinal
	}
	r.floretProjectionByKey[projectionKey] = projection
	r.muFloretProjection.Unlock()
	if !emit {
		return true
	}
	for idx, block := range blocks {
		if idx < oldLen && reflect.DeepEqual(oldBlocks[idx], block) {
			continue
		}
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

func (r *run) floretCanonicalProjectionBlocks() ([]any, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	runID, threadID, turnID := r.floretCanonicalIdentity()
	if runID == "" || threadID == "" || turnID == "" {
		return nil, nil
	}
	key := strings.Join([]string{threadID, turnID, runID}, "\x00")
	r.muFloretProjection.Lock()
	projection, ok := r.floretProjectionByKey[key]
	r.muFloretProjection.Unlock()
	if !ok {
		return nil, nil
	}
	return r.flowerBlocksFromFloretThreadProjection(projection)
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
	canonicalRunID, canonicalThreadID, canonicalTurnID := r.floretCanonicalIdentity()
	return projectionIdentityMatchesRun(runID, threadID, turnID, canonicalRunID, canonicalThreadID, canonicalTurnID)
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
	for _, r := range s.runs {
		if r == nil || strings.TrimSpace(r.endpointID) != endpointID || strings.TrimSpace(r.threadID) != threadID {
			continue
		}
		canonicalRunID, canonicalThreadID, _ := r.floretCanonicalIdentity()
		if canonicalRunID == runID && canonicalThreadID == threadID {
			return r
		}
	}
	return nil
}

func (s *Service) applyFloretPendingToolSettlementProjection(ctx context.Context, endpointID string, threadID string, runID string, turnID string, settled flruntime.PendingToolSettlementResult) error {
	if s == nil {
		return errors.New("nil service")
	}
	if err := settled.Validate(); err != nil {
		return fmt.Errorf("invalid pending tool settlement projection outcome: %w", err)
	}
	if settled.ProjectionAvailability == flruntime.TurnProjectionAvailabilityUnavailable {
		if active := s.activeRunForFloretProjection(endpointID, threadID, runID); active != nil {
			active.recordRunDiagnostic("floret.projection.unavailable", RealtimeStreamKindLifecycle, map[string]any{
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
	active := s.activeRunForFloretProjection(endpointID, threadID, runID)
	if active != nil {
		active.applyFloretThreadProjectionInternal(*projection, active.acceptsPresentationUpdates(), true)
	}
	messageID := ""
	if active != nil && strings.TrimSpace(active.turnID) == strings.TrimSpace(turnID) {
		messageID = strings.TrimSpace(active.messageID)
	}
	if err := s.replaceFlowerLiveDraftWithCanonicalTimeline(ctx, endpointID, threadID, runID, turnID, messageID, "terminal_settlement"); err != nil {
		return err
	}
	s.broadcastThreadSummary(endpointID, threadID)
	if s.threadMgr != nil {
		s.threadMgr.Wake(endpointID, threadID)
	}
	return nil
}
