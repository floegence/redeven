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
	Type string `json:"type"`
	observation.ActivityTimeline
}

func newActivityTimelineBlock(timeline observation.ActivityTimeline) ActivityTimelineBlock {
	if timeline.SchemaVersion <= 0 {
		timeline.SchemaVersion = observation.ActivityTimelineSchemaVersion
	}
	return ActivityTimelineBlock{
		Type:             activityTimelineBlockType,
		ActivityTimeline: timeline,
	}
}

func (r *run) ensureActivityTimelineBlockIndex(preferred int) int {
	if r == nil {
		return -1
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.activityTimelineStarted {
		return r.activityBlockIndex
	}
	idx := preferred
	if idx < 0 {
		idx = r.nextBlockIndex
	}
	if idx < 0 {
		idx = 0
	}
	r.activityBlockIndex = idx
	r.activityTimelineStarted = true
	if r.nextBlockIndex <= idx {
		r.nextBlockIndex = idx + 1
	}
	r.needNewTextBlock = true
	r.needNewThinkingBlock = true
	return idx
}

func (r *run) recordFloretActivityEvent(ev flruntime.Event) {
	if r == nil || !isActivityObservationEvent(ev.Type) {
		return
	}
	r.recordObservationActivityEvent(observationEventFromFloret(ev))
}

func (r *run) recordObservationActivityEvent(ev observation.Event) {
	if r == nil || !isActivityObservationEvent(ev.Type) {
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
	r.muAssistant.Lock()
	r.activityEvents = append(r.activityEvents, ev)
	events := append([]observation.Event(nil), r.activityEvents...)
	r.muAssistant.Unlock()

	timeline := observation.BuildActivityTimeline(r.activityRunMeta(), events, time.Now().UnixMilli())
	r.publishActivityTimeline(timeline)
}

func (r *run) publishActivityTimeline(timeline observation.ActivityTimeline) {
	if r == nil {
		return
	}
	timeline = r.normalizeActivityTimeline(timeline)
	if err := observation.ValidateActivityTimeline(timeline); err != nil {
		r.persistRunEvent("activity.timeline.invalid", RealtimeStreamKindTool, map[string]any{
			"error": sanitizeLogText(err.Error(), 240),
		})
		return
	}
	idx := r.ensureActivityTimelineBlockIndex(-1)
	if idx < 0 {
		return
	}
	block := newActivityTimelineBlock(timeline)
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

func observationEventFromFloret(ev flruntime.Event) observation.Event {
	observedAt := ev.Timestamp
	if observedAt.IsZero() {
		observedAt = time.Now()
	}
	return observation.Event{
		Type:         strings.TrimSpace(ev.Type),
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
		Metadata:     ev.Metadata,
		ObservedAt:   observedAt,
	}
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
