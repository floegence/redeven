package ai

import (
	"context"
	"errors"
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

func (s *Service) settlePendingToolWithActiveFloretRun(ctx context.Context, endpointID string, threadID string, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	if s == nil {
		return flruntime.PendingToolSettlementResult{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if active := s.runForFloretSettlement(endpointID, threadID, string(req.RunID)); active != nil {
		if host := active.activeFloretHost(); host != nil {
			return host.SettlePendingTool(ctx, req)
		}
	}
	host, err := s.openFloretMaintenanceHost()
	if err != nil {
		return flruntime.PendingToolSettlementResult{}, err
	}
	defer host.Close()
	return host.SettlePendingTool(ctx, req)
}

func (s *Service) runForFloretSettlement(endpointID string, threadID string, runID string) *run {
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

func (s *Service) applyFloretPendingToolSettlementProjection(_ context.Context, endpointID string, threadID string, runID string, messageID string, projection flruntime.ThreadTurnProjection) error {
	if s == nil {
		return errors.New("nil service")
	}
	if active := s.runForFloretSettlement(endpointID, threadID, runID); active != nil {
		if active.acceptsPresentationUpdates() {
			active.applyFloretThreadProjection(projection)
		} else {
			active.applyFloretTerminalThreadProjection(projection)
		}
	}
	s.broadcastThreadSummary(endpointID, threadID)
	if s.threadMgr != nil {
		s.threadMgr.Wake(endpointID, threadID)
	}
	return nil
}
