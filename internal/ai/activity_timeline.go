package ai

import (
	"encoding/json"
	"strings"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
)

const activityTimelineBlockType = "activity-timeline"

type ActivityTimelineBlock struct {
	Type        string                              `json:"type"`
	FileActions map[string]FlowerActivityFileAction `json:"file_actions,omitempty"`
	observation.ActivityTimeline
}

type activityTimelinePublicIdentity struct {
	RunID    string
	ThreadID string
	TurnID   string
	TraceID  string
}

func newActivityTimelineBlock(timeline observation.ActivityTimeline, fileActions map[string]FlowerActivityFileAction) ActivityTimelineBlock {
	return newActivityTimelineBlockWithPublicIdentity(timeline, fileActions, activityTimelinePublicIdentity{})
}

func newActivityTimelineBlockWithPublicIdentity(timeline observation.ActivityTimeline, fileActions map[string]FlowerActivityFileAction, publicIdentity activityTimelinePublicIdentity) ActivityTimelineBlock {
	if timeline.SchemaVersion <= 0 {
		timeline.SchemaVersion = observation.ActivityTimelineSchemaVersion
	}
	timeline = publicActivityTimelineForBlock(timeline, publicIdentity)
	return ActivityTimelineBlock{
		Type:             activityTimelineBlockType,
		FileActions:      cloneFlowerActivityFileActions(fileActions),
		ActivityTimeline: timeline,
	}
}

func (r *run) newActivityTimelineBlock(timeline observation.ActivityTimeline, fileActions map[string]FlowerActivityFileAction) ActivityTimelineBlock {
	publicIdentity := activityTimelinePublicIdentity{}
	if r != nil {
		publicIdentity = activityTimelinePublicIdentity{
			RunID:    strings.TrimSpace(r.id),
			ThreadID: strings.TrimSpace(r.threadID),
			TurnID:   strings.TrimSpace(r.messageID),
			TraceID:  strings.TrimSpace(r.id),
		}
	}
	return newActivityTimelineBlockWithPublicIdentity(timeline, fileActions, publicIdentity)
}

func publicActivityTimelineForBlock(timeline observation.ActivityTimeline, publicIdentity activityTimelinePublicIdentity) observation.ActivityTimeline {
	timeline.RunID = strings.TrimSpace(publicIdentity.RunID)
	timeline.ThreadID = strings.TrimSpace(publicIdentity.ThreadID)
	timeline.TurnID = strings.TrimSpace(publicIdentity.TurnID)
	timeline.TraceID = strings.TrimSpace(publicIdentity.TraceID)
	if len(timeline.Items) == 0 {
		return timeline
	}
	items := make([]observation.ActivityItem, len(timeline.Items))
	copy(items, timeline.Items)
	for index := range items {
		toolName := strings.TrimSpace(items[index].ToolName)
		if toolName != "subagents" || len(items[index].Payload) == 0 {
			continue
		}
		items[index].Payload = publicActivityPayloadForTool(toolName, items[index].Payload)
	}
	timeline.Items = items
	return timeline
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

func (r *run) recordFloretActivityEvent(ev flruntime.Event) {
	if r == nil || !isActivityObservationEvent(ev.Type) {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	if modelIOEndsBeforeActivity(ev.Type) {
		r.clearModelIOStatus()
	}
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
	if modelIOEndsBeforeActivity(ev.Type) {
		r.clearModelIOStatus()
	}
}

func shouldRecordObservationActivityEvent(ev observation.Event) bool {
	if ev.Type != observation.EventTypeRunEnd {
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

func modelIOEndsBeforeActivity(eventType observation.EventType) bool {
	switch eventType {
	case observation.EventTypeToolCall,
		observation.EventTypeHostedToolCall,
		observation.EventTypeToolApprovalRequested,
		observation.EventTypeControlSignal:
		return true
	default:
		return false
	}
}

func activityTimelineBlockFromValue(value any) (ActivityTimelineBlock, bool) {
	switch block := value.(type) {
	case ActivityTimelineBlock:
		return block, true
	case *ActivityTimelineBlock:
		if block != nil {
			return *block, true
		}
	}
	return ActivityTimelineBlock{}, false
}

func isActivityObservationEvent(eventType observation.EventType) bool {
	switch eventType {
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
	cp.ReasoningSelection = config.NormalizeAIReasoningSelection(normalized.ReasoningSelection)
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
	cp.ReasoningSelection = config.NormalizeAIReasoningSelection(r.waitingPrompt.ReasoningSelection)
	cp.RequiredFromUser = append([]string(nil), r.waitingPrompt.RequiredFromUser...)
	cp.EvidenceRefs = append([]string(nil), r.waitingPrompt.EvidenceRefs...)
	cp.Questions = normalizeRequestUserInputQuestions(r.waitingPrompt.Questions)
	return &cp
}
