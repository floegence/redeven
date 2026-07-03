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
		timeline.Summary = redevenActivitySummaryForItems(timeline.Items)
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

func redevenActivitySummaryForItems(items []observation.ActivityItem) observation.ActivitySummary {
	summary := observation.ActivitySummary{
		Status:     observation.ActivityStatusPending,
		Severity:   observation.ActivitySeverityQuiet,
		TotalItems: len(items),
	}
	attentionSeen := map[observation.ActivityAttentionReason]struct{}{}
	for _, item := range items {
		switch item.Status {
		case observation.ActivityStatusPending:
			summary.Counts.Pending++
		case observation.ActivityStatusRunning:
			summary.Counts.Running++
		case observation.ActivityStatusWaiting:
			summary.Counts.Waiting++
		case observation.ActivityStatusSuccess:
			summary.Counts.Success++
		case observation.ActivityStatusError:
			summary.Counts.Error++
		case observation.ActivityStatusCanceled:
			summary.Counts.Canceled++
		}
		if item.RequiresApproval {
			summary.Counts.Approval++
		}
		if item.NeedsAttention {
			summary.NeedsAttention = true
		}
		summary.Severity = redevenActivityMaxSeverity(summary.Severity, item.Severity)
		for _, reason := range item.AttentionReasons {
			if _, ok := attentionSeen[reason]; ok {
				continue
			}
			attentionSeen[reason] = struct{}{}
			summary.AttentionReasons = append(summary.AttentionReasons, reason)
		}
	}
	if len(summary.AttentionReasons) > 0 {
		summary.NeedsAttention = true
	}
	switch {
	case summary.Counts.Waiting > 0:
		summary.Status = observation.ActivityStatusWaiting
	case summary.Counts.Running > 0:
		summary.Status = observation.ActivityStatusRunning
	case summary.Counts.Pending > 0:
		summary.Status = observation.ActivityStatusPending
	case summary.Counts.Error > 0:
		summary.Status = observation.ActivityStatusError
	case summary.Counts.Canceled > 0 && summary.Counts.Success == 0:
		summary.Status = observation.ActivityStatusCanceled
	default:
		summary.Status = observation.ActivityStatusSuccess
	}
	if summary.Counts.Error > 0 && summary.Status != observation.ActivityStatusWaiting {
		summary.Status = observation.ActivityStatusError
	}
	if summary.NeedsAttention && summary.Severity == observation.ActivitySeverityQuiet {
		summary.Severity = observation.ActivitySeverityWarning
	}
	return summary
}

func redevenActivityMaxSeverity(left observation.ActivitySeverity, right observation.ActivitySeverity) observation.ActivitySeverity {
	if redevenActivitySeverityRank(right) > redevenActivitySeverityRank(left) {
		return right
	}
	return left
}

func redevenActivitySeverityRank(severity observation.ActivitySeverity) int {
	switch severity {
	case observation.ActivitySeverityBlocking:
		return 4
	case observation.ActivitySeverityError:
		return 3
	case observation.ActivitySeverityWarning:
		return 2
	case observation.ActivitySeverityNormal:
		return 1
	default:
		return 0
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
			blocks = append(blocks, newActivityTimelineBlockWithSidecars(
				timeline,
				r.activityTimelineFileActions(timeline),
				r.activityTimelineSubagentActions(timeline),
			))
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
	if err := s.publishFlowerCanonicalTimelineReplacement(ctx, endpointID, threadID, runID, messageID, "terminal_settlement"); err != nil && s.log != nil {
		s.log.Warn("ai: publish terminal settlement Flower timeline replacement failed", "run_id", runID, "thread_id", threadID, "error", err)
	}
	s.broadcastThreadSummary(endpointID, threadID)
	if s.threadMgr != nil {
		s.threadMgr.Wake(endpointID, threadID)
	}
	return nil
}
