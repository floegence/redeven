package ai

import (
	"encoding/json"
	"strings"

	"github.com/floegence/floret/v4/identity"
	"github.com/floegence/floret/v4/observation"
	flruntime "github.com/floegence/floret/v4/runtime"
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

func publicActivityTimelineForBlock(timeline observation.ActivityTimeline, publicIdentity activityTimelinePublicIdentity) observation.ActivityTimeline {
	timeline.RunID = identity.RunID(strings.TrimSpace(publicIdentity.RunID))
	timeline.ThreadID = identity.ThreadID(strings.TrimSpace(publicIdentity.ThreadID))
	timeline.TurnID = identity.TurnID(strings.TrimSpace(publicIdentity.TurnID))
	timeline.TraceID = identity.TraceID(strings.TrimSpace(publicIdentity.TraceID))
	if len(timeline.Items) == 0 {
		return timeline
	}
	items := make([]observation.ActivityItem, len(timeline.Items))
	copy(items, timeline.Items)
	for index := range items {
		toolName := strings.TrimSpace(items[index].ToolName)
		if toolName != "subagents" || items[index].Presentation == nil || items[index].Presentation.Payload == nil {
			continue
		}
		payload := activityPayloadMap(items[index].Presentation.Payload)
		publicPayload := publicActivityPayloadForTool(toolName, payload)
		items[index].Presentation = cloneActivityPresentation(items[index].Presentation)
		items[index].Presentation.Payload = activityPayloadForRenderer(items[index].Presentation.Renderer, publicPayload)
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
