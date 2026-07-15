package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/ai/threadstore"
)

const (
	floretEventStepStart             = observation.EventTypeStepStart
	floretEventProviderRequest       = observation.EventTypeProviderRequest
	floretEventProviderFinish        = observation.EventTypeProviderFinish
	floretEventProviderRetry         = observation.EventTypeProviderRetry
	floretEventContextCompact        = observation.EventTypeContextCompact
	floretEventContextCompactDebug   = observation.EventTypeContextCompactDebug
	floretEventContextContinue       = observation.EventTypeContextContinue
	floretEventBudgetExceeded        = observation.EventTypeBudgetExceeded
	floretEventStepEnd               = observation.EventTypeStepEnd
	floretEventRunEnd                = observation.EventTypeRunEnd
	floretEventToolApprovalRequested = observation.EventTypeToolApprovalRequested
	floretEventToolApprovalApproved  = observation.EventTypeToolApprovalApproved
	floretEventToolApprovalRejected  = observation.EventTypeToolApprovalRejected
	floretEventToolApprovalTimedOut  = observation.EventTypeToolApprovalTimedOut
	floretEventToolApprovalCanceled  = observation.EventTypeToolApprovalCanceled
)

type floretEventSink struct {
	run *run
}

func (s floretEventSink) EmitEvent(ev flruntime.Event) {
	r := s.run
	if r == nil {
		return
	}
	if err := r.validateFloretRuntimeEvent(ev); err != nil {
		r.rejectFloretContract("event", err)
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
	if ev.Projection != nil {
		r.applyFloretThreadProjection(*ev.Projection)
	}
	r.recordFloretActivityEvent(ev)
	if ev.Type == observation.EventTypeToolCall || ev.Type == observation.EventTypeToolDispatchStarted || ev.Type == observation.EventTypeToolResult {
		r.persistRunEvent("floret.tool.lifecycle", RealtimeStreamKindTool, map[string]any{
			"event_type":          strings.TrimSpace(string(ev.Type)),
			"step_index":          ev.Step,
			"tool_id":             strings.TrimSpace(ev.ToolID),
			"tool_name":           strings.TrimSpace(ev.ToolName),
			"batch_index":         ev.Metadata["batch_index"],
			"batch_size":          ev.Metadata["batch_size"],
			"recorded_at_unix_ms": time.Now().UnixMilli(),
		})
	}
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
			"step_index":        ev.Step,
			"finish_reason":     strings.TrimSpace(string(ev.FinishReason)),
			"raw_finish_reason": strings.TrimSpace(ev.RawFinishReason),
			"finish_inferred":   ev.FinishInferred,
			"metadata":          ev.Metadata,
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
			"continuation_reason": strings.TrimSpace(string(ev.ContinuationReason)),
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
			"finish_reason":       strings.TrimSpace(string(ev.FinishReason)),
			"raw_finish_reason":   strings.TrimSpace(ev.RawFinishReason),
			"finish_inferred":     ev.FinishInferred,
			"completion_reason":   strings.TrimSpace(string(ev.CompletionReason)),
			"continuation_reason": strings.TrimSpace(string(ev.ContinuationReason)),
			"metadata":            ev.Metadata,
		})
	case floretEventRunEnd:
		r.clearModelIOStatus()
		r.persistRunEvent("floret.run.end", RealtimeStreamKindLifecycle, map[string]any{
			"finish_reason":       strings.TrimSpace(string(ev.FinishReason)),
			"raw_finish_reason":   strings.TrimSpace(ev.RawFinishReason),
			"finish_inferred":     ev.FinishInferred,
			"completion_reason":   strings.TrimSpace(string(ev.CompletionReason)),
			"continuation_reason": strings.TrimSpace(string(ev.ContinuationReason)),
			"error":               strings.TrimSpace(ev.Error),
			"metadata":            ev.Metadata,
		})
	case floretEventToolApprovalRequested, floretEventToolApprovalApproved, floretEventToolApprovalRejected, floretEventToolApprovalTimedOut, floretEventToolApprovalCanceled:
		if ev.Type != floretEventToolApprovalRequested {
			r.syncPendingFloretApprovals(context.Background(), string(ev.Type))
		}
		r.persistRunEvent("floret."+string(ev.Type), RealtimeStreamKindLifecycle, map[string]any{
			"tool_id":   strings.TrimSpace(ev.ToolID),
			"tool_name": strings.TrimSpace(ev.ToolName),
			"metadata":  ev.Metadata,
		})
	}
}

func (r *run) validateFloretRuntimeEvent(ev flruntime.Event) error {
	if err := ev.Validate(); err != nil {
		return err
	}
	if ev.Projection != nil && !r.floretThreadProjectionMatchesRun(*ev.Projection) {
		return errors.New("Floret event projection identity mismatch")
	}
	return nil
}

func (r *run) persistFloretCompactionDebug(debug *observation.CompactionDebugEvent) {
	if r == nil || debug == nil {
		return
	}
	payload := map[string]any{
		"step_index":                     debug.Step,
		"operation_id":                   strings.TrimSpace(debug.OperationID),
		"request_id":                     strings.TrimSpace(debug.RequestID),
		"stage":                          strings.TrimSpace(string(debug.Stage)),
		"status":                         strings.TrimSpace(string(debug.Status)),
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
	usage, err := flowerContextUsageFromFloret(status, strings.TrimSpace(r.id))
	if err != nil {
		r.rejectFloretContract("context_status", err)
		return
	}
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
	projected, err := flowerContextCompactionFromFloret(compaction, strings.TrimSpace(r.id))
	if err != nil {
		r.rejectFloretContract("compaction", err)
		return
	}
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
	switch compaction.Phase {
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

func flowerContextUsageFromFloret(status *observation.ContextStatus, fallbackRunID string) (FlowerContextUsage, error) {
	if status == nil {
		return FlowerContextUsage{}, nil
	}
	if err := status.Validate(); err != nil {
		return FlowerContextUsage{}, err
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
	phase, err := normalizeFlowerContextUsagePhase(status.Phase)
	if err != nil {
		return FlowerContextUsage{}, err
	}
	pressureStatus, err := normalizeFlowerContextPressureStatus(status.Status)
	if err != nil {
		return FlowerContextUsage{}, err
	}
	return FlowerContextUsage{
		RunID:                  runID,
		StepIndex:              status.Step,
		Phase:                  phase,
		InputTokens:            inputTokens,
		ContextWindowTokens:    pressure.ContextWindowTokens,
		ThresholdTokens:        pressure.ThresholdTokens,
		RequestSafeLimitTokens: pressure.RequestSafeLimit,
		OutputHeadroomTokens:   pressure.OutputHeadroomTokens,
		UsedRatio:              status.UsedRatio,
		ThresholdRatio:         status.ThresholdRatio,
		PressureStatus:         pressureStatus,
		Source:                 source,
		UpdatedAtMs:            updatedAt,
	}, nil
}

func flowerContextCompactionFromFloret(compaction *observation.CompactionEvent, fallbackRunID string) (FlowerContextCompaction, error) {
	if compaction == nil {
		return FlowerContextCompaction{}, nil
	}
	if err := compaction.Validate(); err != nil {
		return FlowerContextCompaction{}, err
	}
	updatedAt := compaction.ObservedAt.UnixMilli()
	if updatedAt <= 0 {
		updatedAt = 0
	}
	runID := strings.TrimSpace(compaction.RunID)
	if runID == "" {
		runID = fallbackRunID
	}
	phase, err := normalizeFlowerContextCompactionPhase(compaction.Phase)
	if err != nil {
		return FlowerContextCompaction{}, err
	}
	status, err := normalizeFlowerContextCompactionStatus(compaction.Status)
	if err != nil {
		return FlowerContextCompaction{}, err
	}
	return FlowerContextCompaction{
		OperationID:         strings.TrimSpace(compaction.OperationID),
		RunID:               runID,
		StepIndex:           compaction.Step,
		Phase:               phase,
		Status:              status,
		Trigger:             strings.TrimSpace(compaction.Trigger),
		Reason:              strings.TrimSpace(compaction.Reason),
		TokensBefore:        compaction.TokensBefore,
		TokensAfterEstimate: compaction.TokensAfterEstimate,
		Error:               strings.TrimSpace(compaction.Error),
		UpdatedAtMs:         updatedAt,
	}, nil
}

func normalizeFlowerContextUsagePhase(phase observation.ContextPhase) (string, error) {
	switch phase {
	case observation.ContextPhaseProjectedRequest:
		return "projected_request", nil
	case observation.ContextPhaseProviderUsage:
		return "provider_usage", nil
	default:
		return "", fmt.Errorf("unsupported Floret context phase %q", phase)
	}
}

func normalizeFlowerContextPressureStatus(status observation.ContextDisplayStatus) (string, error) {
	switch status {
	case observation.ContextStatusStable:
		return "stable", nil
	case observation.ContextStatusNearThreshold:
		return "near_threshold", nil
	case observation.ContextStatusWillCompact:
		return "will_compact", nil
	case observation.ContextStatusHardLimit:
		return "hard_limit", nil
	case observation.ContextStatusEstimated:
		return "estimated", nil
	default:
		return "", fmt.Errorf("unsupported Floret context display status %q", status)
	}
}

func normalizeFlowerContextCompactionPhase(phase observation.CompactionPhase) (string, error) {
	switch phase {
	case observation.CompactionPhaseStart:
		return "start", nil
	case observation.CompactionPhaseComplete:
		return "complete", nil
	case observation.CompactionPhaseFailed:
		return "failed", nil
	case observation.CompactionPhaseCancelled:
		return "cancelled", nil
	case observation.CompactionPhaseNoop:
		return "noop", nil
	default:
		return "", fmt.Errorf("unsupported Floret compaction phase %q", phase)
	}
}

func normalizeFlowerContextCompactionStatus(status observation.CompactionStatus) (string, error) {
	switch status {
	case observation.CompactionStatusRunning:
		return "compacting", nil
	case observation.CompactionStatusCompacted:
		return "compacted", nil
	case observation.CompactionStatusFailed:
		return "failed", nil
	case observation.CompactionStatusCancelled:
		return "cancelled", nil
	case observation.CompactionStatusNoop:
		return "noop", nil
	default:
		return "", fmt.Errorf("unsupported Floret compaction status %q", status)
	}
}

func (r *run) rejectFloretContract(kind string, err error) {
	if r == nil || err == nil {
		return
	}
	r.persistRunEvent("floret.contract.rejected", RealtimeStreamKindLifecycle, map[string]any{
		"contract_kind": strings.TrimSpace(kind),
		"error":         sanitizeLogText(err.Error(), 240),
	})
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
			"finish_reason":        strings.TrimSpace(string(stream.FinishReason)),
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
