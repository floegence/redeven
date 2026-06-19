package ai

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
)

const activityTimelineBlockType = "activity-timeline"

type ActivityTimelineBlock struct {
	Type        string                              `json:"type"`
	FileActions map[string]FlowerActivityFileAction `json:"file_actions,omitempty"`
	observation.ActivityTimeline
}

func newActivityTimelineBlock(timeline observation.ActivityTimeline, fileActions map[string]FlowerActivityFileAction) ActivityTimelineBlock {
	if timeline.SchemaVersion <= 0 {
		timeline.SchemaVersion = observation.ActivityTimelineSchemaVersion
	}
	return ActivityTimelineBlock{
		Type:             activityTimelineBlockType,
		FileActions:      cloneFlowerActivityFileActions(fileActions),
		ActivityTimeline: timeline,
	}
}

func cloneFlowerActivityFileActions(in map[string]FlowerActivityFileAction) map[string]FlowerActivityFileAction {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]FlowerActivityFileAction, len(in))
	for key, value := range in {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		value.ActionID = strings.TrimSpace(value.ActionID)
		value.DisplayName = strings.TrimSpace(value.DisplayName)
		value.PreviewPath = strings.TrimSpace(value.PreviewPath)
		value.DirectoryPath = strings.TrimSpace(value.DirectoryPath)
		if value.ActionID == "" || value.DisplayName == "" {
			continue
		}
		out[key] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func activityPayloadString(payload map[string]any, key string) string {
	if len(payload) == 0 {
		return ""
	}
	return strings.TrimSpace(anyToString(payload[key]))
}

func activityPayloadRecords(payload map[string]any, key string) []map[string]any {
	if len(payload) == 0 {
		return nil
	}
	items, _ := payload[key].([]any)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, record)
	}
	return out
}

func (r *run) activityTimelineFileActions(timeline observation.ActivityTimeline) map[string]FlowerActivityFileAction {
	if r == nil || len(timeline.Items) == 0 {
		return nil
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if len(r.activityFileActions) == 0 {
		return nil
	}
	out := map[string]FlowerActivityFileAction{}
	addAction := func(actionID string) {
		actionID = strings.TrimSpace(actionID)
		if actionID == "" {
			return
		}
		action, ok := r.activityFileActions[actionID]
		if !ok {
			return
		}
		out[actionID] = action
	}
	for _, item := range timeline.Items {
		addAction(activityPayloadString(item.Payload, "file_action_id"))
		for _, mutation := range activityPayloadRecords(item.Payload, "mutations") {
			addAction(activityPayloadString(mutation, "file_action_id"))
		}
	}
	return cloneFlowerActivityFileActions(out)
}

func (r *run) finishActivitySegment() {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.activitySegmentActive = false
	r.activitySegmentBlockIndex = -1
	r.mu.Unlock()
	r.muAssistant.Lock()
	r.activitySegmentEvents = nil
	r.muAssistant.Unlock()
}

func (r *run) ensureActivitySegmentBlockIndex(preferred int) int {
	if r == nil {
		return -1
	}
	r.mu.Lock()
	if r.activitySegmentActive && r.activitySegmentBlockIndex >= 0 {
		idx := r.activitySegmentBlockIndex
		r.mu.Unlock()
		return idx
	}
	idx := preferred
	if idx < 0 {
		idx = r.nextBlockIndex
	}
	if idx < 0 {
		idx = 0
	}
	r.activitySegmentActive = true
	r.activitySegmentBlockIndex = idx
	if r.nextBlockIndex <= idx {
		r.nextBlockIndex = idx + 1
	}
	r.needNewTextBlock = true
	r.needNewThinkingBlock = true
	r.mu.Unlock()
	r.muAssistant.Lock()
	r.activitySegmentEvents = nil
	r.muAssistant.Unlock()
	return idx
}

func (r *run) recordFloretActivityEvent(ev flruntime.Event) {
	if r == nil || !isActivityObservationEvent(ev.Type) {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	activityEvent, ok := observationActivityEventFromFloret(ev)
	if !ok {
		return
	}
	r.recordObservationActivityEvent(activityEvent)
}

func (r *run) recordObservationActivityEvent(ev observation.Event) {
	if r == nil || !isActivityObservationEvent(ev.Type) {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	if !shouldRecordObservationActivityEvent(ev) {
		return
	}
	if ev.RunID == "" {
		ev.RunID = strings.TrimSpace(r.id)
	}
	if ev.ThreadID == "" {
		ev.ThreadID = strings.TrimSpace(r.threadID)
	}
	if ev.TurnID == "" {
		ev.TurnID = strings.TrimSpace(r.messageID)
	}
	if ev.TraceID == "" {
		ev.TraceID = strings.TrimSpace(r.id)
	}
	if ev.ObservedAt.IsZero() {
		ev.ObservedAt = time.Now()
	}

	r.mu.Lock()
	segmentActive := r.activitySegmentActive
	r.mu.Unlock()
	r.muAssistant.Lock()
	previewEvents := make([]observation.Event, 0, len(r.activitySegmentEvents)+1)
	if segmentActive {
		previewEvents = append(previewEvents, r.activitySegmentEvents...)
	}
	previewEvents = append(previewEvents, ev)
	r.muAssistant.Unlock()
	preview := observation.BuildActivityTimeline(r.activityRunMeta(), previewEvents, time.Now().UnixMilli())
	if len(preview.Items) == 0 {
		return
	}

	if r.ensureActivitySegmentBlockIndex(-1) < 0 {
		return
	}
	r.muAssistant.Lock()
	r.activitySegmentEvents = append(r.activitySegmentEvents, ev)
	events := append([]observation.Event(nil), r.activitySegmentEvents...)
	r.muAssistant.Unlock()

	timeline := observation.BuildActivityTimeline(r.activityRunMeta(), events, time.Now().UnixMilli())
	r.publishActivityTimeline(timeline)
}

func shouldRecordObservationActivityEvent(ev observation.Event) bool {
	if strings.TrimSpace(ev.Type) != observation.EventTypeRunEnd {
		return true
	}
	if strings.TrimSpace(ev.Error) != "" {
		return true
	}
	message := strings.TrimSpace(ev.Message)
	return message == string(observation.ActivityStatusWaiting) ||
		message == string(observation.ActivityStatusCanceled) ||
		message == "cancelled"
}

func (r *run) publishFinalActivityTimeline(timeline observation.ActivityTimeline) {
	if r == nil || len(timeline.Items) == 0 {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	timeline = removeSyntheticSuccessfulFinalToolItems(timeline)
	if len(timeline.Items) == 0 {
		return
	}
	r.mu.Lock()
	hasSegment := r.activityTimelineProjected
	r.mu.Unlock()
	if hasSegment {
		return
	}
	r.publishActivityTimeline(timeline)
}

func removeSyntheticSuccessfulFinalToolItems(timeline observation.ActivityTimeline) observation.ActivityTimeline {
	items := make([]observation.ActivityItem, 0, len(timeline.Items))
	for _, item := range timeline.Items {
		if item.Kind == observation.ActivityKindTool && item.Status == observation.ActivityStatusSuccess && anyToString(item.Payload["status"]) != toolResultStatusSuccess {
			continue
		}
		items = append(items, item)
	}
	timeline.Items = items
	timeline.Summary = activityTimelineSummaryFromItems(timeline.Summary, items)
	return timeline
}

func activityTimelineSummaryFromItems(existing observation.ActivitySummary, items []observation.ActivityItem) observation.ActivitySummary {
	summary := existing
	summary.TotalItems = len(items)
	summary.Counts = observation.ActivityCounts{}
	summary.NeedsAttention = false
	summary.AttentionReasons = nil
	summary.Status = observation.ActivityStatusSuccess
	summary.Severity = observation.ActivitySeverityQuiet
	if len(items) == 0 {
		return summary
	}
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
		if item.NeedsAttention {
			summary.NeedsAttention = true
			summary.AttentionReasons = append(summary.AttentionReasons, item.AttentionReasons...)
		}
	}
	if summary.Counts.Error > 0 {
		summary.Status = observation.ActivityStatusError
		summary.Severity = observation.ActivitySeverityError
		return summary
	}
	if summary.Counts.Waiting > 0 {
		summary.Status = observation.ActivityStatusWaiting
		summary.Severity = observation.ActivitySeverityBlocking
		return summary
	}
	if summary.Counts.Running > 0 {
		summary.Status = observation.ActivityStatusRunning
		summary.Severity = observation.ActivitySeverityNormal
		return summary
	}
	if summary.Counts.Pending > 0 {
		summary.Status = observation.ActivityStatusPending
		summary.Severity = observation.ActivitySeverityQuiet
		return summary
	}
	if summary.Counts.Canceled > 0 {
		summary.Status = observation.ActivityStatusCanceled
		summary.Severity = observation.ActivitySeverityWarning
		return summary
	}
	summary.Status = observation.ActivityStatusSuccess
	summary.Severity = observation.ActivitySeverityNormal
	return summary
}

func (r *run) publishActivityTimeline(timeline observation.ActivityTimeline) {
	if r == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	timeline = r.normalizeActivityTimeline(timeline)
	if len(timeline.Items) == 0 {
		return
	}
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		r.persistRunEvent("activity.timeline.invalid", RealtimeStreamKindTool, map[string]any{
			"error": sanitizeLogText(err.Error(), 240),
		})
		return
	}
	idx := r.ensureActivitySegmentBlockIndex(-1)
	if idx < 0 {
		return
	}
	fileActions := r.activityTimelineFileActions(timeline)
	block := newActivityTimelineBlock(timeline, fileActions)
	r.muAssistant.Lock()
	r.persistEnsureIndex(idx)
	r.assistantBlocks[idx] = block
	r.muAssistant.Unlock()

	r.persistRunEvent("activity.timeline.projected", RealtimeStreamKindTool, map[string]any{
		"block_index":     idx,
		"run_id":          strings.TrimSpace(timeline.RunID),
		"thread_id":       strings.TrimSpace(timeline.ThreadID),
		"turn_id":         strings.TrimSpace(timeline.TurnID),
		"status":          strings.TrimSpace(string(timeline.Summary.Status)),
		"severity":        strings.TrimSpace(string(timeline.Summary.Severity)),
		"needs_attention": timeline.Summary.NeedsAttention,
		"total_items":     timeline.Summary.TotalItems,
	})
	r.sendStreamEvent(streamEventBlockSet{Type: "block-set", MessageID: r.messageID, BlockIndex: idx, Block: block})
	r.mu.Lock()
	r.activityTimelineProjected = true
	r.mu.Unlock()
}

func (r *run) normalizeActivityTimeline(timeline observation.ActivityTimeline) observation.ActivityTimeline {
	if timeline.SchemaVersion <= 0 {
		timeline.SchemaVersion = observation.ActivityTimelineSchemaVersion
	}
	if strings.TrimSpace(timeline.RunID) == "" {
		timeline.RunID = strings.TrimSpace(r.id)
	}
	if strings.TrimSpace(timeline.ThreadID) == "" {
		timeline.ThreadID = strings.TrimSpace(r.threadID)
	}
	if strings.TrimSpace(timeline.TurnID) == "" {
		timeline.TurnID = strings.TrimSpace(r.messageID)
	}
	if strings.TrimSpace(timeline.TraceID) == "" {
		timeline.TraceID = strings.TrimSpace(r.id)
	}
	return timeline
}

func (r *run) activityRunMeta() observation.ActivityRunMeta {
	if r == nil {
		return observation.ActivityRunMeta{}
	}
	return observation.ActivityRunMeta{
		RunID:    strings.TrimSpace(r.id),
		ThreadID: strings.TrimSpace(r.threadID),
		TurnID:   strings.TrimSpace(r.messageID),
		TraceID:  strings.TrimSpace(r.id),
	}
}

func observationActivityEventFromFloret(ev flruntime.Event) (observation.Event, bool) {
	observedAt := ev.Timestamp
	if observedAt.IsZero() {
		observedAt = time.Now()
	}
	eventType := strings.TrimSpace(ev.Type)
	if eventType == observation.EventTypeRunEnd && !floretRunEndShouldProjectActivity(ev) {
		return observation.Event{}, false
	}
	return observation.Event{
		Type:         eventType,
		TraceID:      strings.TrimSpace(string(ev.TraceID)),
		RunID:        strings.TrimSpace(string(ev.RunID)),
		ThreadID:     strings.TrimSpace(string(ev.ThreadID)),
		TurnID:       strings.TrimSpace(string(ev.TurnID)),
		Step:         ev.Step,
		Provider:     strings.TrimSpace(ev.Provider),
		Model:        strings.TrimSpace(ev.Model),
		Message:      strings.TrimSpace(ev.Message),
		Result:       strings.TrimSpace(ev.Result),
		Error:        strings.TrimSpace(ev.Error),
		ToolID:       strings.TrimSpace(ev.ToolID),
		ToolName:     strings.TrimSpace(ev.ToolName),
		ToolKind:     strings.TrimSpace(ev.ToolKind),
		ArgsHash:     strings.TrimSpace(ev.ArgsHash),
		DurationMS:   ev.DurationMS,
		FinishReason: strings.TrimSpace(ev.FinishReason),
		Activity:     ev.Activity,
		Metadata:     ev.Metadata,
		ObservedAt:   observedAt,
	}, true
}

func floretRunEndShouldProjectActivity(ev flruntime.Event) bool {
	if strings.TrimSpace(ev.Error) != "" {
		return true
	}
	message := strings.TrimSpace(ev.Message)
	return message == string(observation.ActivityStatusWaiting) ||
		message == string(observation.ActivityStatusCanceled) ||
		message == "cancelled"
}

func isActivityObservationEvent(eventType string) bool {
	switch strings.TrimSpace(eventType) {
	case observation.EventTypeToolCall,
		observation.EventTypeToolResult,
		observation.EventTypeToolApprovalRequested,
		observation.EventTypeToolApprovalApproved,
		observation.EventTypeToolApprovalRejected,
		observation.EventTypeToolApprovalTimedOut,
		observation.EventTypeToolApprovalCanceled,
		observation.EventTypeHostedToolCall,
		observation.EventTypeHostedToolResult,
		observation.EventTypeControlSignal,
		observation.EventTypeBudgetExceeded,
		observation.EventTypeRunEnd:
		return true
	default:
		return false
	}
}

func activityTimelineFromAny(block any) (observation.ActivityTimeline, bool) {
	switch v := block.(type) {
	case ActivityTimelineBlock:
		return v.ActivityTimeline, true
	case *ActivityTimelineBlock:
		if v != nil {
			return v.ActivityTimeline, true
		}
	case observation.ActivityTimeline:
		return v, true
	case *observation.ActivityTimeline:
		if v != nil {
			return *v, true
		}
	case map[string]any:
		if strings.TrimSpace(anyToString(v["type"])) != activityTimelineBlockType {
			return observation.ActivityTimeline{}, false
		}
		raw, err := json.Marshal(v)
		if err != nil {
			return observation.ActivityTimeline{}, false
		}
		var out ActivityTimelineBlock
		if err := json.Unmarshal(raw, &out); err != nil {
			return observation.ActivityTimeline{}, false
		}
		return out.ActivityTimeline, true
	}
	return observation.ActivityTimeline{}, false
}

func (r *run) setWaitingPrompt(prompt *RequestUserInputPrompt) {
	if r == nil {
		return
	}
	normalized := normalizeRequestUserInputPrompt(prompt)
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if normalized == nil {
		r.waitingPrompt = nil
		return
	}
	cp := *normalized
	cp.RequiredFromUser = append([]string(nil), normalized.RequiredFromUser...)
	cp.EvidenceRefs = append([]string(nil), normalized.EvidenceRefs...)
	cp.Questions = normalizeRequestUserInputQuestions(normalized.Questions)
	r.waitingPrompt = &cp
}

func (r *run) snapshotWaitingPrompt() *RequestUserInputPrompt {
	if r == nil {
		return nil
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	if r.waitingPrompt == nil {
		return nil
	}
	cp := *r.waitingPrompt
	cp.RequiredFromUser = append([]string(nil), r.waitingPrompt.RequiredFromUser...)
	cp.EvidenceRefs = append([]string(nil), r.waitingPrompt.EvidenceRefs...)
	cp.Questions = normalizeRequestUserInputQuestions(r.waitingPrompt.Questions)
	return &cp
}
