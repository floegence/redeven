package ai

import (
	"strings"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
)

const (
	floretEventStepStart             = "step_start"
	floretEventProviderRequest       = "provider_request"
	floretEventProviderFinish        = "provider_finish"
	floretEventProviderRetry         = "provider_retry"
	floretEventContextCompact        = "context_compact"
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
	r.recordFloretActivityEvent(ev)
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
	r.persistRunEvent("context.compaction.updated", RealtimeStreamKindContext, flowerContextCompactionPayload(projected))
	r.sendStreamEvent(streamEventContextCompaction{
		Type:            "context-compaction",
		Compaction:      projected,
		AnchorMessageID: strings.TrimSpace(compaction.TurnID),
	})
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
	runID := strings.TrimSpace(status.RunID)
	if runID == "" {
		runID = fallbackRunID
	}
	return FlowerContextUsage{
		RunID:                  runID,
		StepIndex:              status.Step,
		Phase:                  strings.TrimSpace(status.Phase),
		InputTokens:            inputTokens,
		ContextWindowTokens:    pressure.ContextWindowTokens,
		ThresholdTokens:        pressure.ThresholdTokens,
		RequestSafeLimitTokens: pressure.RequestSafeLimit,
		OutputHeadroomTokens:   pressure.OutputHeadroomTokens,
		UsedRatio:              status.UsedRatio,
		ThresholdRatio:         status.ThresholdRatio,
		PressureStatus:         strings.TrimSpace(status.Status),
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
		OperationID:          strings.TrimSpace(compaction.OperationID),
		RunID:                runID,
		AnchorMessageID:      strings.TrimSpace(compaction.TurnID),
		StepIndex:            compaction.Step,
		Phase:                strings.TrimSpace(compaction.Phase),
		Status:               normalizeFlowerContextCompactionStatus(compaction.Status),
		Trigger:              strings.TrimSpace(compaction.Trigger),
		Reason:               strings.TrimSpace(compaction.Reason),
		CompactionID:         strings.TrimSpace(compaction.CompactionID),
		CompactionGeneration: compaction.CompactionGeneration,
		CompactionWindowID:   strings.TrimSpace(compaction.CompactionWindowID),
		TokensBefore:         compaction.TokensBefore,
		TokensAfterEstimate:  compaction.TokensAfterEstimate,
		Error:                strings.TrimSpace(compaction.Error),
		UpdatedAtMs:          updatedAt,
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
	default:
		return strings.TrimSpace(status)
	}
}

func flowerContextUsagePayload(usage FlowerContextUsage) map[string]any {
	return map[string]any{
		"usage": usage,
	}
}

func flowerContextCompactionPayload(compaction FlowerContextCompaction) map[string]any {
	return map[string]any{
		"compaction": compaction,
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
