package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const (
	floretEventStepStart             = "step_start"
	floretEventProviderRequest       = "provider_request"
	floretEventProviderFinish        = "provider_finish"
	floretEventProviderRetry         = "provider_retry"
	floretEventContextCompact        = "context_compact"
	floretEventContextCompactDebug   = "context_compact_debug"
	floretEventContextContinue       = "context_continue"
	floretEventBudgetExceeded        = "budget_exceeded"
	floretEventStepEnd               = "step_end"
	floretEventRunEnd                = "run_end"
	floretEventToolApprovalRequested = "tool_approval_requested"
	floretEventToolApprovalApproved  = "tool_approval_approved"
	floretEventToolApprovalRejected  = "tool_approval_rejected"
	floretEventToolApprovalTimedOut  = "tool_approval_timed_out"
	floretEventToolApprovalCanceled  = "tool_approval_canceled"
)

type floretEventSink struct {
	run *run
}

func floretEventMetadataString(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	return strings.TrimSpace(anyToString(metadata[key]))
}

func (s floretEventSink) EmitEvent(ev flruntime.Event) {
	r := s.run
	if r == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	r.applyFloretStreamObservation(ev.Stream)
	r.applyFloretSourceObservation(ev.Sources)
	r.applyFloretContextStatus(ev.ContextStatus)
	r.applyFloretCompaction(ev.Compaction)
	r.persistFloretCompactionDebug(ev.CompactionDebug)
	r.recordFloretActivityEvent(ev)
	r.recordFloretCommittedThreadEvent(ev.Committed)
	switch ev.Type {
	case floretEventProviderRequest:
		r.updateModelIOStatus(FlowerModelIOPhaseWaitingResponse, ev.Step)
		r.persistRunEvent("floret.provider.request", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"provider":   strings.TrimSpace(ev.Provider),
			"model":      strings.TrimSpace(ev.Model),
			"metadata":   ev.Metadata,
		})
	case floretEventProviderFinish:
		r.updateModelIOStatus(FlowerModelIOPhaseFinalizing, ev.Step)
		r.persistRunEvent("floret.provider.finish", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":    ev.Step,
			"finish_reason": strings.TrimSpace(ev.FinishReason),
			"metadata":      ev.Metadata,
		})
	case floretEventProviderRetry:
		r.updateModelIOStatus(FlowerModelIOPhaseRetrying, ev.Step)
		r.persistRunEvent("floret.provider.retry", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"message":    strings.TrimSpace(ev.Message),
		})
	case floretEventContextCompact:
		if ev.Compaction == nil {
			r.persistRunEvent("floret.context.compact", RealtimeStreamKindLifecycle, map[string]any{
				"step_index": ev.Step,
				"message":    strings.TrimSpace(ev.Message),
				"metadata":   ev.Metadata,
			})
		}
	case floretEventContextContinue:
		r.persistRunEvent("floret.context.continue", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":          ev.Step,
			"message":             strings.TrimSpace(ev.Message),
			"detail":              strings.TrimSpace(ev.Result),
			"continuation_reason": floretEventMetadataString(ev.Metadata, "continuation_reason"),
			"metadata":            ev.Metadata,
		})
	case floretEventBudgetExceeded:
		r.persistRunEvent("floret.budget.exceeded", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"metadata":   ev.Metadata,
		})
	case floretEventStepStart:
		r.updateModelIOStatus(FlowerModelIOPhasePreparing, ev.Step)
		r.touchActivity()
	case floretEventStepEnd:
		r.persistRunEvent("floret.step.end", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":          ev.Step,
			"finish_reason":       strings.TrimSpace(ev.FinishReason),
			"completion_reason":   floretEventMetadataString(ev.Metadata, "completion_reason"),
			"continuation_reason": floretEventMetadataString(ev.Metadata, "continuation_reason"),
			"metadata":            ev.Metadata,
		})
	case floretEventRunEnd:
		r.clearModelIOStatus()
		r.persistRunEvent("floret.run.end", RealtimeStreamKindLifecycle, map[string]any{
			"finish_reason": strings.TrimSpace(ev.FinishReason),
			"error":         strings.TrimSpace(ev.Error),
			"metadata":      ev.Metadata,
		})
	case floretEventToolApprovalRequested, floretEventToolApprovalApproved, floretEventToolApprovalRejected, floretEventToolApprovalTimedOut, floretEventToolApprovalCanceled:
		r.persistRunEvent("floret."+ev.Type, RealtimeStreamKindLifecycle, map[string]any{
			"tool_id":   strings.TrimSpace(ev.ToolID),
			"tool_name": strings.TrimSpace(ev.ToolName),
			"metadata":  ev.Metadata,
		})
	}
}

func (r *run) persistFloretCompactionDebug(debug *observation.CompactionDebugEvent) {
	if r == nil || debug == nil {
		return
	}
	payload := map[string]any{
		"step_index":                     debug.Step,
		"operation_id":                   strings.TrimSpace(debug.OperationID),
		"request_id":                     strings.TrimSpace(debug.RequestID),
		"stage":                          strings.TrimSpace(debug.Stage),
		"status":                         strings.TrimSpace(debug.Status),
		"trigger":                        strings.TrimSpace(debug.Trigger),
		"reason":                         strings.TrimSpace(debug.Reason),
		"source":                         strings.TrimSpace(debug.Source),
		"compaction_convergence_attempt": debug.CompactionConvergenceAttempt,
		"history_message_count":          debug.HistoryMessageCount,
		"active_message_count":           debug.ActiveMessageCount,
		"tokens_before":                  debug.TokensBefore,
		"tokens_after_estimate":          debug.TokensAfterEstimate,
		"context_before":                 debug.ContextBefore,
		"context_after":                  debug.ContextAfter,
		"before_pressure":                debug.BeforePressure,
		"request_estimate":               debug.RequestEstimate,
		"validated_context_pressure":     debug.ValidatedContextPressure,
		"hard_limit_exceeded":            debug.HardLimitExceeded,
		"fixed_input_tokens":             debug.FixedInputTokens,
		"reducible_input_tokens":         debug.ReducibleInputTokens,
		"request_safe_limit":             debug.RequestSafeLimit,
		"compact_target_tokens":          debug.CompactedContextTargetTokens,
		"next_compact_target_tokens":     debug.NextCompactedContextTargetTokens,
		"consecutive_failures":           debug.ConsecutiveFailures,
		"duration_ms":                    debug.DurationMS,
		"provider_state_kind":            strings.TrimSpace(debug.ProviderStateKind),
		"next_action":                    strings.TrimSpace(debug.NextAction),
		"error":                          strings.TrimSpace(debug.Error),
	}
	if !debug.ObservedAt.IsZero() {
		payload["observed_at_unix_ms"] = debug.ObservedAt.UnixMilli()
	}
	r.persistRunEvent("floret.context.compact.debug", RealtimeStreamKindContext, payload)
}

func (r *run) applyFloretContextStatus(status *observation.ContextStatus) {
	if r == nil || status == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	usage := flowerContextUsageFromFloret(status, strings.TrimSpace(r.id))
	r.persistRunEvent("context.usage.updated", RealtimeStreamKindContext, flowerContextUsagePayload(usage))
	r.sendStreamEvent(streamEventContextUsage{
		Type:  "context-usage",
		Usage: usage,
	})
}

func (r *run) applyFloretCompaction(compaction *observation.CompactionEvent) {
	if r == nil || compaction == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	projected := flowerContextCompactionFromFloret(compaction, strings.TrimSpace(r.id))
	if !r.hostManagedContextCompaction {
		r.bindContextCompactionOperationAnchor(projected.OperationID, compaction.RequestID)
		r.noteManualCompactionOperation(compaction.RequestID, projected.OperationID)
		decoration := r.flowerContextCompactionDecoration(projected)
		r.persistRunEvent("context.compaction.updated", RealtimeStreamKindContext, flowerContextCompactionPayload(projected, decoration))
		r.sendStreamEvent(streamEventContextCompaction{
			Type:               "context-compaction",
			Compaction:         projected,
			TimelineDecoration: decoration,
		})
	}
	switch strings.TrimSpace(compaction.Phase) {
	case observation.CompactionPhaseComplete:
		r.setCompletedContextCompaction(*compaction)
		r.finishManualCompaction(compaction.RequestID)
	case observation.CompactionPhaseFailed, observation.CompactionPhaseCancelled, observation.CompactionPhaseNoop:
		r.finishManualCompaction(compaction.RequestID)
	}
}

func (r *run) flowerContextCompactionDecoration(compaction FlowerContextCompaction) FlowerTimelineDecoration {
	operationID := strings.TrimSpace(compaction.OperationID)
	if operationID == "" {
		operationID = fmt.Sprintf("%s:%d:%s", strings.TrimSpace(compaction.RunID), compaction.StepIndex, strings.TrimSpace(compaction.Phase))
		compaction.OperationID = operationID
	}
	anchor := r.contextCompactionAnchor(operationID)
	return FlowerTimelineDecoration{
		DecorationID: "context-compaction:" + operationID,
		Kind:         "context_compaction",
		Anchor:       anchor,
		Ordinal:      0,
		Compaction:   compaction,
	}
}

func (r *run) bindContextCompactionOperationAnchor(operationID string, requestID string) {
	if r == nil {
		return
	}
	operationID = strings.TrimSpace(operationID)
	requestID = strings.TrimSpace(requestID)
	if operationID == "" || requestID == "" || operationID == requestID {
		return
	}
	r.muManualCompaction.Lock()
	anchor := r.contextCompactionAnchors[requestID]
	r.muManualCompaction.Unlock()
	if validFlowerTimelineAnchor(anchor) {
		r.setContextCompactionAnchor(operationID, anchor)
	}
}

func (r *run) contextCompactionAnchor(operationID string) FlowerTimelineAnchor {
	if r == nil {
		return FlowerTimelineAnchor{}
	}
	operationID = strings.TrimSpace(operationID)
	if operationID == "" {
		return FlowerTimelineAnchor{}
	}
	r.muManualCompaction.Lock()
	if anchor := r.contextCompactionAnchors[operationID]; validFlowerTimelineAnchor(anchor) {
		r.muManualCompaction.Unlock()
		return anchor
	}
	r.muManualCompaction.Unlock()

	anchor := r.captureFlowerTimelineAnchor()
	if validFlowerTimelineAnchor(anchor) {
		r.muManualCompaction.Lock()
		if r.contextCompactionAnchors == nil {
			r.contextCompactionAnchors = make(map[string]FlowerTimelineAnchor)
		}
		r.contextCompactionAnchors[operationID] = anchor
		r.muManualCompaction.Unlock()
	}
	return anchor
}

func (r *run) setContextCompactionAnchor(operationID string, anchor FlowerTimelineAnchor) {
	if r == nil || strings.TrimSpace(operationID) == "" || !validFlowerTimelineAnchor(anchor) {
		return
	}
	r.muManualCompaction.Lock()
	defer r.muManualCompaction.Unlock()
	if r.contextCompactionAnchors == nil {
		r.contextCompactionAnchors = make(map[string]FlowerTimelineAnchor)
	}
	r.contextCompactionAnchors[strings.TrimSpace(operationID)] = anchor
}

func (r *run) captureFlowerTimelineAnchor() FlowerTimelineAnchor {
	if r == nil {
		return FlowerTimelineAnchor{}
	}
	if anchor := r.captureAssistantDraftTimelineAnchor(); validFlowerTimelineAnchor(anchor) {
		return anchor
	}
	return r.lastPersistedFlowerTimelineAnchor()
}

func (r *run) captureAssistantDraftTimelineAnchor() FlowerTimelineAnchor {
	if r == nil {
		return FlowerTimelineAnchor{}
	}
	messageID := strings.TrimSpace(r.messageID)
	if messageID == "" {
		return FlowerTimelineAnchor{}
	}
	r.muAssistant.Lock()
	defer r.muAssistant.Unlock()
	for i := len(r.assistantBlocks) - 1; i >= 0; i-- {
		block := r.assistantBlocks[i]
		if itemID, ok := lastVisibleActivityItemID(block); ok {
			blockIndex := i
			return FlowerTimelineAnchor{
				TargetKind:     "activity_item",
				MessageID:      messageID,
				BlockIndex:     &blockIndex,
				ActivityItemID: itemID,
				Edge:           "after",
			}
		}
		if flowerBlockHasVisibleContent(block) {
			blockIndex := i
			return FlowerTimelineAnchor{
				TargetKind: "block",
				MessageID:  messageID,
				BlockIndex: &blockIndex,
				Edge:       "after",
			}
		}
	}
	return FlowerTimelineAnchor{}
}

func (r *run) lastPersistedFlowerTimelineAnchor() FlowerTimelineAnchor {
	if r == nil || r.threadsDB == nil {
		return FlowerTimelineAnchor{}
	}
	endpointID := strings.TrimSpace(r.endpointID)
	threadID := strings.TrimSpace(r.threadID)
	if endpointID == "" || threadID == "" {
		return FlowerTimelineAnchor{}
	}
	persistTO := r.persistOpTimeout
	if persistTO <= 0 {
		persistTO = defaultPersistOpTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), persistTO)
	defer cancel()
	messages, _, _, err := r.threadsDB.ListMessages(ctx, endpointID, threadID, 500, 0)
	if err != nil {
		return FlowerTimelineAnchor{}
	}
	return lastVisibleFlowerTimelineAnchorFromMessages(messages)
}

func lastVisibleFlowerTimelineAnchorFromMessages(messages []threadstore.Message) FlowerTimelineAnchor {
	if len(messages) == 0 {
		return FlowerTimelineAnchor{}
	}
	timeline := make([]FlowerTimelineMessage, 0, len(messages))
	for _, message := range messages {
		projected, ok, err := flowerTimelineMessageFromTranscript(message)
		if err != nil || !ok {
			continue
		}
		timeline = append(timeline, projected)
	}
	return lastVisibleFlowerTimelineAnchorFromTimeline(timeline)
}

func lastVisibleFlowerTimelineAnchorFromTimeline(timeline []FlowerTimelineMessage) FlowerTimelineAnchor {
	for messageIndex := len(timeline) - 1; messageIndex >= 0; messageIndex-- {
		message := timeline[messageIndex]
		messageID := strings.TrimSpace(message.MessageID)
		if messageID == "" {
			continue
		}
		for blockIndex := len(message.Blocks) - 1; blockIndex >= 0; blockIndex-- {
			block := message.Blocks[blockIndex]
			if itemID, ok := lastVisibleActivityItemID(block); ok {
				index := blockIndex
				return FlowerTimelineAnchor{
					TargetKind:     "activity_item",
					MessageID:      messageID,
					BlockIndex:     &index,
					ActivityItemID: itemID,
					Edge:           "after",
				}
			}
			if flowerBlockHasVisibleContent(block) {
				index := blockIndex
				return FlowerTimelineAnchor{
					TargetKind: "block",
					MessageID:  messageID,
					BlockIndex: &index,
					Edge:       "after",
				}
			}
		}
		if strings.TrimSpace(message.Content) != "" {
			return FlowerTimelineAnchor{
				TargetKind: "message",
				MessageID:  messageID,
				Edge:       "after",
			}
		}
	}
	return FlowerTimelineAnchor{}
}

func lastVisibleActivityItemID(block any) (string, bool) {
	timeline, ok := activityTimelineFromAny(block)
	if !ok || len(timeline.Items) == 0 {
		return "", false
	}
	for i := len(timeline.Items) - 1; i >= 0; i-- {
		if itemID := strings.TrimSpace(timeline.Items[i].ItemID); itemID != "" {
			return itemID, true
		}
	}
	return "", false
}

func flowerBlockHasVisibleContent(block any) bool {
	switch v := block.(type) {
	case *persistedMarkdownBlock:
		return v != nil && strings.TrimSpace(v.Content) != ""
	case persistedMarkdownBlock:
		return strings.TrimSpace(v.Content) != ""
	case *persistedThinkingBlock:
		return v != nil && strings.TrimSpace(v.Content) != ""
	case persistedThinkingBlock:
		return strings.TrimSpace(v.Content) != ""
	case map[string]any:
		blockType := strings.TrimSpace(anyToString(v["type"]))
		switch blockType {
		case "markdown", "text", "thinking":
			return strings.TrimSpace(anyToString(v["content"])) != ""
		default:
			return false
		}
	default:
		return false
	}
}

func flowerContextUsageFromFloret(status *observation.ContextStatus, fallbackRunID string) FlowerContextUsage {
	if status == nil {
		return FlowerContextUsage{}
	}
	pressure := status.ContextPressure
	usage := status.Usage
	inputTokens := usage.WindowInputTokens
	if inputTokens <= 0 {
		inputTokens = usage.InputTokens + usage.CacheReadTokens + usage.CacheWriteTokens
	}
	if inputTokens <= 0 {
		inputTokens = pressure.WindowInputTokens
	}
	if inputTokens <= 0 {
		inputTokens = pressure.ProjectedInputTokens
	}
	source := strings.TrimSpace(string(pressure.Source))
	if source == "" {
		source = strings.TrimSpace(usage.Source)
	}
	updatedAt := status.ObservedAt.UnixMilli()
	if updatedAt <= 0 {
		updatedAt = 0
	}
	runID := strings.TrimSpace(fallbackRunID)
	if runID == "" {
		runID = strings.TrimSpace(status.RunID)
	}
	return FlowerContextUsage{
		RunID:                  runID,
		StepIndex:              status.Step,
		Phase:                  normalizeFlowerContextUsagePhase(status.Phase),
		InputTokens:            inputTokens,
		ContextWindowTokens:    pressure.ContextWindowTokens,
		ThresholdTokens:        pressure.ThresholdTokens,
		RequestSafeLimitTokens: pressure.RequestSafeLimit,
		OutputHeadroomTokens:   pressure.OutputHeadroomTokens,
		UsedRatio:              status.UsedRatio,
		ThresholdRatio:         status.ThresholdRatio,
		PressureStatus:         normalizeFlowerContextPressureStatus(status.Status),
		Source:                 source,
		UpdatedAtMs:            updatedAt,
	}
}

func flowerContextCompactionFromFloret(compaction *observation.CompactionEvent, fallbackRunID string) FlowerContextCompaction {
	if compaction == nil {
		return FlowerContextCompaction{}
	}
	updatedAt := compaction.ObservedAt.UnixMilli()
	if updatedAt <= 0 {
		updatedAt = 0
	}
	runID := strings.TrimSpace(compaction.RunID)
	if runID == "" {
		runID = fallbackRunID
	}
	return FlowerContextCompaction{
		OperationID:         strings.TrimSpace(compaction.OperationID),
		RunID:               runID,
		StepIndex:           compaction.Step,
		Phase:               normalizeFlowerContextCompactionPhase(compaction.Phase),
		Status:              normalizeFlowerContextCompactionStatus(compaction.Status),
		Trigger:             strings.TrimSpace(compaction.Trigger),
		Reason:              strings.TrimSpace(compaction.Reason),
		TokensBefore:        compaction.TokensBefore,
		TokensAfterEstimate: compaction.TokensAfterEstimate,
		Error:               strings.TrimSpace(compaction.Error),
		UpdatedAtMs:         updatedAt,
	}
}

func normalizeFlowerContextUsagePhase(phase string) string {
	switch strings.TrimSpace(phase) {
	case "projected_request":
		return "projected_request"
	case "provider_usage":
		return "provider_usage"
	default:
		return "projected_request"
	}
}

func normalizeFlowerContextPressureStatus(status string) string {
	switch strings.TrimSpace(status) {
	case observation.ContextStatusStable:
		return "stable"
	case observation.ContextStatusNearThreshold:
		return "near_threshold"
	case observation.ContextStatusWillCompact:
		return "will_compact"
	case observation.ContextStatusHardLimit:
		return "hard_limit"
	case observation.ContextStatusEstimated:
		return "estimated"
	default:
		return "stable"
	}
}

func normalizeFlowerContextCompactionPhase(phase string) string {
	switch strings.TrimSpace(phase) {
	case observation.CompactionPhaseStart:
		return "start"
	case observation.CompactionPhaseComplete:
		return "complete"
	case observation.CompactionPhaseFailed:
		return "failed"
	case observation.CompactionPhaseCancelled:
		return "cancelled"
	case observation.CompactionPhaseNoop:
		return "noop"
	default:
		return "checkpoint"
	}
}

func normalizeFlowerContextCompactionStatus(status string) string {
	switch strings.TrimSpace(status) {
	case observation.CompactionStatusRunning:
		return "compacting"
	case observation.CompactionStatusCompacted:
		return "compacted"
	case observation.CompactionStatusFailed:
		return "failed"
	case observation.CompactionStatusCancelled:
		return "cancelled"
	case observation.CompactionStatusNoop:
		return "noop"
	default:
		return "checkpoint"
	}
}

func flowerContextUsagePayload(usage FlowerContextUsage) map[string]any {
	return map[string]any{
		"usage": usage,
	}
}

func flowerContextCompactionPayload(compaction FlowerContextCompaction, decoration FlowerTimelineDecoration) map[string]any {
	return map[string]any{
		"compaction":          compaction,
		"timeline_decoration": decoration,
	}
}

func (r *run) applyFloretSourceObservation(sources []flruntime.SourceRef) {
	if r == nil || len(sources) == 0 {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	for _, src := range sources {
		r.addWebSource(strings.TrimSpace(src.Title), strings.TrimSpace(src.URL))
	}
}

func (r *run) applyFloretStreamObservation(stream *flruntime.StreamObservation) {
	if r == nil || stream == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	switch stream.Type {
	case flruntime.StreamObservationAssistantDelta:
		r.updateModelIOStatus(FlowerModelIOPhaseStreaming, stream.Attempt)
		if stream.Text != "" {
			_ = r.appendTextDelta(stream.Text)
		}
	case flruntime.StreamObservationReasoningDelta:
		r.updateModelIOStatus(FlowerModelIOPhaseStreaming, stream.Attempt)
		if stream.Text != "" {
			r.touchActivity()
			_ = r.appendThinkingDelta(stream.Text)
		}
	case flruntime.StreamObservationToolCallStart, flruntime.StreamObservationToolCallDelta, flruntime.StreamObservationToolCallEnd:
		r.updateModelIOStatus(FlowerModelIOPhaseStreaming, stream.Attempt)
	case flruntime.StreamObservationModelRetry:
		r.updateModelIOStatus(FlowerModelIOPhaseRetrying, stream.Attempt)
		r.persistRunEvent("floret.provider.retry.stream", RealtimeStreamKindLifecycle, map[string]any{
			"attempt": stream.Attempt,
			"reason":  strings.TrimSpace(stream.Reason),
		})
	case flruntime.StreamObservationModelStreamDone:
		r.updateModelIOStatus(FlowerModelIOPhaseFinalizing, stream.Attempt)
		r.persistRunEvent("floret.provider.stream.done", RealtimeStreamKindLifecycle, map[string]any{
			"attempt":              stream.Attempt,
			"finish_reason":        strings.TrimSpace(stream.FinishReason),
			"raw_finish_reason":    strings.TrimSpace(stream.RawFinishReason),
			"finish_inferred":      stream.FinishInferred,
			"stream_reason_detail": strings.TrimSpace(stream.Reason),
		})
	case flruntime.StreamObservationModelStreamAbort:
		r.updateModelIOStatus(FlowerModelIOPhaseRetrying, stream.Attempt)
		r.persistRunEvent("floret.provider.stream.abort", RealtimeStreamKindLifecycle, map[string]any{
			"attempt": stream.Attempt,
			"reason":  strings.TrimSpace(stream.Reason),
		})
	}
}
