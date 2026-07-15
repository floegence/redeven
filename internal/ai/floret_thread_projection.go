package ai

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
)

func (r *run) applyFloretThreadProjection(projection flruntime.ThreadTurnProjection) bool {
	return r.applyFloretThreadProjectionInternal(projection, true, false, true)
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
	r.mu.Unlock()
	r.muAssistant.Lock()
	if r.assistantCreatedAtUnixMs == 0 {
		r.assistantCreatedAtUnixMs = time.Now().UnixMilli()
	}
	blocks = r.blocksWithTerminalLifecycleFloorLocked(blocks)
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

func (r *run) markTerminalSettlementProjectionApplied() {
	if r == nil {
		return
	}
	r.terminalSettlement.Store(true)
}

func (r *run) hasTerminalSettlementProjectionApplied() bool {
	return r != nil && r.terminalSettlement.Load()
}

func (r *run) blocksWithTerminalLifecycleFloorLocked(blocks []any) []any {
	if r == nil || len(blocks) == 0 || len(r.assistantBlocks) == 0 {
		return blocks
	}
	floor := r.terminalLifecycleFloorItemsLocked()
	if len(floor) == 0 {
		return blocks
	}

	var out []any
	for idx, raw := range blocks {
		block, ok := activityTimelineBlockFromValue(raw)
		if !ok || len(block.Items) == 0 {
			continue
		}
		timeline := observation.CloneActivityTimeline(&block.ActivityTimeline)
		if timeline == nil {
			continue
		}
		changed := false
		for itemIdx, item := range timeline.Items {
			key := terminalLifecycleItemKey(item)
			if key == "" || !terminalActivityStatusCanBeDowngraded(item.Status) {
				continue
			}
			preserved, ok := floor[key]
			if !ok {
				continue
			}
			timeline.Items[itemIdx] = preserved
			changed = true
		}
		if !changed {
			continue
		}
		timeline.Summary = observation.RebuildActivitySummary(*timeline)
		block.ActivityTimeline = *timeline
		if out == nil {
			out = make([]any, len(blocks))
			copy(out, blocks)
		}
		out[idx] = block
	}
	if out == nil {
		return blocks
	}
	return out
}

func (r *run) terminalLifecycleFloorItemsLocked() map[string]observation.ActivityItem {
	if r == nil {
		return nil
	}
	out := map[string]observation.ActivityItem{}
	for _, raw := range r.assistantBlocks {
		block, ok := activityTimelineBlockFromValue(raw)
		if !ok || len(block.Items) == 0 {
			continue
		}
		timeline := observation.CloneActivityTimeline(&block.ActivityTimeline)
		if timeline == nil {
			continue
		}
		for _, item := range timeline.Items {
			key := terminalLifecycleItemKey(item)
			if key == "" || !terminalActivityStatusIsTerminal(item.Status) {
				continue
			}
			out[key] = item
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func terminalLifecycleItemKey(item observation.ActivityItem) string {
	if strings.TrimSpace(item.ToolName) != "terminal.exec" {
		return ""
	}
	if toolID := strings.TrimSpace(item.ToolID); toolID != "" {
		return toolID
	}
	itemID := strings.TrimSpace(item.ItemID)
	if strings.HasPrefix(itemID, "tool:") {
		itemID = strings.TrimSpace(strings.TrimPrefix(itemID, "tool:"))
	}
	return itemID
}

func terminalActivityStatusIsTerminal(status observation.ActivityStatus) bool {
	switch status {
	case observation.ActivityStatusSuccess, observation.ActivityStatusError, observation.ActivityStatusCanceled:
		return true
	default:
		return false
	}
}

func terminalActivityStatusCanBeDowngraded(status observation.ActivityStatus) bool {
	switch status {
	case observation.ActivityStatusPending, observation.ActivityStatusRunning, observation.ActivityStatusWaiting:
		return true
	default:
		return false
	}
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
			blocks = append(blocks, r.newActivityTimelineBlock(timeline, r.activityTimelineFileActions(timeline)))
		case flruntime.ThreadTurnProjectionSegmentControlSignal:
			continue
		}
	}
	return blocks, true
}

func (s *Service) settlePendingToolWithActiveFloretRun(ctx context.Context, endpointID string, threadID string, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	return s.settlePendingToolWithActiveRedevenRun(ctx, endpointID, threadID, string(req.RunID), req)
}

func (s *Service) settlePendingToolWithActiveRedevenRun(ctx context.Context, endpointID string, threadID string, redevenRunID string, req flruntime.PendingToolSettlementRequest) (flruntime.PendingToolSettlementResult, error) {
	if s == nil {
		return flruntime.PendingToolSettlementResult{}, errors.New("nil service")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if active := s.runForFloretSettlement(endpointID, threadID, redevenRunID); active != nil {
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

func (s *Service) applyFloretPendingToolSettlementProjection(ctx context.Context, endpointID string, threadID string, runID string, messageID string, projection flruntime.ThreadTurnProjection) error {
	if s == nil {
		return errors.New("nil service")
	}
	if active := s.runForFloretSettlement(endpointID, threadID, runID); active != nil {
		active.markTerminalSettlementProjectionApplied()
		if active.acceptsPresentationUpdates() {
			active.applyFloretThreadProjection(projection)
		} else {
			active.applyFloretTerminalThreadProjection(projection)
		}
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
