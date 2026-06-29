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
	Type            string                                  `json:"type"`
	FileActions     map[string]FlowerActivityFileAction     `json:"file_actions,omitempty"`
	SubagentActions map[string]FlowerActivitySubagentAction `json:"subagent_actions,omitempty"`
	observation.ActivityTimeline
}

func newActivityTimelineBlock(timeline observation.ActivityTimeline, fileActions map[string]FlowerActivityFileAction) ActivityTimelineBlock {
	return newActivityTimelineBlockWithSidecars(timeline, fileActions, nil)
}

func newActivityTimelineBlockWithSidecars(timeline observation.ActivityTimeline, fileActions map[string]FlowerActivityFileAction, subagentActions map[string]FlowerActivitySubagentAction) ActivityTimelineBlock {
	if timeline.SchemaVersion <= 0 {
		timeline.SchemaVersion = observation.ActivityTimelineSchemaVersion
	}
	return ActivityTimelineBlock{
		Type:             activityTimelineBlockType,
		FileActions:      cloneFlowerActivityFileActions(fileActions),
		SubagentActions:  cloneFlowerActivitySubagentActions(subagentActions),
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

type FlowerActivitySubagentAction struct {
	Operation         string `json:"operation,omitempty"`
	Action            string `json:"action,omitempty"`
	DelegationRuntime string `json:"delegation_runtime,omitempty"`
	ThreadID          string `json:"thread_id,omitempty"`
	SubagentID        string `json:"subagent_id,omitempty"`
	ParentThreadID    string `json:"parent_thread_id,omitempty"`
	TaskName          string `json:"task_name,omitempty"`
	Title             string `json:"title,omitempty"`
	AgentType         string `json:"agent_type,omitempty"`
	ContextMode       string `json:"context_mode,omitempty"`
	Status            string `json:"status,omitempty"`
	LastMessage       string `json:"last_message,omitempty"`
	WaitingPrompt     string `json:"waiting_prompt,omitempty"`
	QueuedInputs      int    `json:"queued_inputs,omitempty"`
	CanSendInput      bool   `json:"can_send_input,omitempty"`
	CanInterrupt      bool   `json:"can_interrupt,omitempty"`
	CanClose          bool   `json:"can_close,omitempty"`
	UpdatedAtMS       int64  `json:"updated_at_ms,omitempty"`
}

func cloneFlowerActivitySubagentActions(in map[string]FlowerActivitySubagentAction) map[string]FlowerActivitySubagentAction {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]FlowerActivitySubagentAction, len(in))
	for key, value := range in {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		value.Operation = strings.TrimSpace(value.Operation)
		value.Action = strings.TrimSpace(value.Action)
		value.DelegationRuntime = strings.TrimSpace(value.DelegationRuntime)
		value.ThreadID = strings.TrimSpace(value.ThreadID)
		value.SubagentID = strings.TrimSpace(value.SubagentID)
		value.ParentThreadID = strings.TrimSpace(value.ParentThreadID)
		value.TaskName = strings.TrimSpace(value.TaskName)
		value.Title = strings.TrimSpace(value.Title)
		value.AgentType = strings.TrimSpace(value.AgentType)
		value.ContextMode = strings.TrimSpace(value.ContextMode)
		value.Status = strings.TrimSpace(value.Status)
		value.LastMessage = strings.TrimSpace(value.LastMessage)
		value.WaitingPrompt = strings.TrimSpace(value.WaitingPrompt)
		if value.Operation == "" && value.Action == "" && value.ThreadID == "" && value.SubagentID == "" {
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
	return idx
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

func modelIOEndsBeforeActivity(eventType string) bool {
	switch strings.TrimSpace(eventType) {
	case observation.EventTypeToolCall,
		observation.EventTypeHostedToolCall,
		observation.EventTypeToolApprovalRequested,
		observation.EventTypeControlSignal:
		return true
	default:
		return false
	}
}

func (r *run) publishActivityTimeline(timeline observation.ActivityTimeline) {
	r.publishActivityTimelineWithSidecars(timeline, nil)
}

func (r *run) publishActivityTimelineWithSidecars(timeline observation.ActivityTimeline, subagentActions map[string]FlowerActivitySubagentAction) {
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
	block := newActivityTimelineBlockWithSidecars(timeline, fileActions, subagentActions)
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
