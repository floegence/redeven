package ai

import (
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
)

const (
	floretEventProviderRequest       = observation.EventTypeProviderRequest
	floretEventProviderFinish        = observation.EventTypeProviderFinish
	floretEventProviderRetry         = observation.EventTypeProviderRetry
	floretEventRunEnd                = observation.EventTypeRunEnd
	floretEventToolApprovalRequested = observation.EventTypeToolApprovalRequested
	floretEventToolApprovalApproved  = observation.EventTypeToolApprovalApproved
	floretEventToolApprovalRejected  = observation.EventTypeToolApprovalRejected
	floretEventToolApprovalTimedOut  = observation.EventTypeToolApprovalTimedOut
	floretEventToolApprovalCanceled  = observation.EventTypeToolApprovalCanceled
	floretEventThreadTitlePending    = observation.EventTypeThreadTitlePending
	floretEventThreadTitleUpdated    = observation.EventTypeThreadTitleUpdated
	floretEventThreadTitleFailed     = observation.EventTypeThreadTitleFailed
)

type floretEventSink struct {
	run *run
}

func (s floretEventSink) EmitEvent(ev flruntime.Event) {
	r := s.run
	if r == nil {
		return
	}
	isTitleEvent := ev.Type == floretEventThreadTitlePending || ev.Type == floretEventThreadTitleUpdated || ev.Type == floretEventThreadTitleFailed
	if err := ev.Validate(); err != nil {
		r.rejectFloretContract("event", err)
		return
	}
	canonicalUserEntry := false
	if canonicalUserEntry {
		err := r.observeFloretCanonicalIdentity(string(ev.RunID), string(ev.ThreadID), string(ev.TurnID))
		if err != nil {
			r.rejectFloretContract("thread_runtime_event", err)
			return
		}
	} else if !isTitleEvent {
		err := r.observeFloretCanonicalIdentity(string(ev.RunID), string(ev.ThreadID), string(ev.TurnID))
		if err != nil {
			r.rejectFloretContract("event_identity", err)
			return
		}
	}
	if err := r.validateFloretRuntimeEvent(ev); err != nil {
		r.rejectFloretContract("event", err)
		return
	}
	if ev.Type == floretEventProviderRequest {
		accepted, err := r.activateFloretProviderAttempt(ev.Metadata)
		if err != nil {
			r.rejectFloretContract("provider_attempt", err)
			return
		}
		if !accepted {
			return
		}
	}
	if isTitleEvent && r.host.requestThreadSummary != nil {
		r.host.requestThreadSummary()
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	if canonicalUserEntry {
		r.ensureAssistantMessageStarted()
	}
	if r.acceptsFloretStreamAttempt(ev.Stream) {
		r.applyFloretStreamObservation(ev.Stream)
	}
	switch ev.Type {
	case floretEventProviderRequest:
		r.recordRunDiagnostic("floret.provider.request", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"provider":   strings.TrimSpace(ev.Provider),
			"model":      strings.TrimSpace(ev.Model),
			"metadata":   ev.Metadata,
		})
	case floretEventProviderFinish:
		r.recordRunDiagnostic("floret.provider.finish", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":        ev.Step,
			"finish_reason":     strings.TrimSpace(string(ev.FinishReason)),
			"raw_finish_reason": strings.TrimSpace(ev.RawFinishReason),
			"finish_inferred":   ev.FinishInferred,
			"metadata":          ev.Metadata,
		})
	case floretEventProviderRetry:
		r.recordRunDiagnostic("floret.provider.retry", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"message":    strings.TrimSpace(ev.Message),
		})
	case floretEventToolApprovalRequested, floretEventToolApprovalApproved, floretEventToolApprovalRejected, floretEventToolApprovalTimedOut, floretEventToolApprovalCanceled:
		r.recordRunDiagnostic("floret."+string(ev.Type), RealtimeStreamKindLifecycle, map[string]any{
			"tool_id":   strings.TrimSpace(ev.ToolID),
			"tool_name": strings.TrimSpace(ev.ToolName),
			"metadata":  ev.Metadata,
		})
	}
}

func (r *run) acceptsFloretStreamAttempt(stream *flruntime.StreamObservation) bool {
	if r == nil || stream == nil {
		return true
	}
	logical := strings.TrimSpace(string(stream.LogicalRequestID))
	attemptID := strings.TrimSpace(stream.AttemptID)
	if logical == "" && attemptID == "" && stream.AttemptEpoch == 0 {
		return true
	}
	if logical == "" || attemptID == "" || stream.AttemptEpoch <= 0 {
		return false
	}
	r.muProviderAttempt.Lock()
	active := r.providerAttempt
	r.muProviderAttempt.Unlock()
	if active.logicalRequestID == "" {
		return false
	}
	if logical != active.logicalRequestID || stream.AttemptEpoch != active.attemptEpoch || attemptID != active.attemptID {
		r.recordRunDiagnostic("floret.provider.stream_dropped", RealtimeStreamKindLifecycle, map[string]any{
			"logical_request_id": logical,
			"attempt_id":         attemptID,
			"attempt_epoch":      stream.AttemptEpoch,
			"active_attempt_id":  active.attemptID,
			"active_epoch":       active.attemptEpoch,
		})
		return false
	}
	return true
}

func (r *run) activateFloretProviderAttempt(metadata map[string]any) (bool, error) {
	if r == nil {
		return false, errors.New("provider attempt owner is unavailable")
	}
	logical, _ := metadata["logical_request_id"].(string)
	attemptID, _ := metadata["attempt_id"].(string)
	epoch := intFromAny(metadata["attempt_epoch"])
	identity := providerAttemptIdentity{
		logicalRequestID: strings.TrimSpace(logical),
		attemptID:        strings.TrimSpace(attemptID),
		attemptEpoch:     epoch,
	}
	if identity.logicalRequestID == "" || identity.attemptID == "" || identity.attemptEpoch <= 0 {
		return false, errors.New("provider request attempt identity is incomplete")
	}
	r.muProviderAttempt.Lock()
	previous := r.providerAttempt
	if previous.logicalRequestID != "" && previous.logicalRequestID != identity.logicalRequestID {
		r.muProviderAttempt.Unlock()
		return false, errors.New("provider request logical identity changed")
	}
	if identity.attemptEpoch < previous.attemptEpoch || identity.attemptEpoch == previous.attemptEpoch && previous.attemptID != "" && previous.attemptID != identity.attemptID {
		r.muProviderAttempt.Unlock()
		return false, nil
	}
	if identity.attemptEpoch == previous.attemptEpoch && previous.attemptID == identity.attemptID {
		r.muProviderAttempt.Unlock()
		return true, nil
	}
	r.providerAttempt = identity
	r.muProviderAttempt.Unlock()

	return true, nil
}

func intFromAny(value any) int {
	switch number := value.(type) {
	case int:
		return number
	case int64:
		return int(number)
	case float64:
		return int(number)
	default:
		return 0
	}
}

func (r *run) validateFloretRuntimeEvent(ev flruntime.Event) error {
	if err := ev.Validate(); err != nil {
		return err
	}
	identity := r.floretRuntimeEventIdentitySnapshot()
	if identity.configured {
		eventThreadID := strings.TrimSpace(string(ev.ThreadID))
		eventTurnID := strings.TrimSpace(string(ev.TurnID))
		eventRunID := strings.TrimSpace(string(ev.RunID))
		if eventThreadID != identity.threadID {
			return errors.New("floret event thread or turn identity mismatch")
		}
		isTitleEvent := ev.Type == floretEventThreadTitlePending || ev.Type == floretEventThreadTitleUpdated || ev.Type == floretEventThreadTitleFailed
		if isTitleEvent {
			threadScoped := eventRunID == "" && eventTurnID == ""
			runScoped := eventRunID == identity.runID && eventTurnID == identity.turnID
			if !threadScoped && !runScoped {
				return errors.New("floret title event identity mismatch")
			}
		} else if eventTurnID != identity.turnID {
			return errors.New("floret event thread or turn identity mismatch")
		} else if identity.checkRunID && eventRunID != identity.runID {
			return errors.New("floret event run identity mismatch")
		}
	}
	return nil
}

func (r *run) expectFloretRuntimeEventIdentity(runID string, threadID string, turnID string, checkRunID bool) {
	if r == nil {
		return
	}
	r.muFloretIdentity.Lock()
	r.floretEventIdentity = floretRuntimeEventIdentity{
		configured: true,
		checkRunID: checkRunID,
		runID:      strings.TrimSpace(runID),
		threadID:   strings.TrimSpace(threadID),
		turnID:     strings.TrimSpace(turnID),
	}
	r.muFloretIdentity.Unlock()
}

func flowerContextUsageFromFloret(usage *flruntime.ThreadContextUsage, totals *flruntime.ThreadTokenUsageTotals) (FlowerContextUsage, error) {
	out := FlowerContextUsage{}
	var err error
	out.ThreadUsage, err = flowerThreadTokenUsageFromFloret(totals)
	if err != nil {
		return out, err
	}
	if usage == nil {
		return out, nil
	}
	for _, item := range []struct {
		source *observation.ContextStatus
		target **FlowerContextSample
	}{{usage.Confirmed, &out.Confirmed}, {usage.Estimate, &out.Estimate}} {
		if item.source == nil {
			continue
		}
		sample, err := flowerContextSampleFromFloret(item.source)
		if err != nil {
			return FlowerContextUsage{}, err
		}
		*item.target = &sample
	}
	if out.Confirmed != nil && out.Confirmed.Available && out.Confirmed.Measured {
		native := usage.Confirmed.Usage
		out.RecentRequestUsage = &FlowerThreadTokenUsage{InputTokens: native.InputTokens, OutputTokens: native.OutputTokens, CacheReadTokens: native.CacheReadTokens, CacheWriteTokens: native.CacheWriteTokens}
	}
	return out, nil
}

func flowerContextSampleFromFloret(status *observation.ContextStatus) (FlowerContextSample, error) {
	if status == nil {
		return FlowerContextSample{}, nil
	}
	// Floret preserves trustworthy totals even when optional attribution is damaged.
	// Statistical limitations never block conversation or interaction updates.
	accounting, _ := observation.ReconcileContextStatus(*status)
	pressure := status.ContextPressure
	usage := status.Usage
	source := strings.TrimSpace(string(pressure.Source))
	if source == "" {
		source = strings.TrimSpace(usage.Source)
	}
	updatedAt := status.ObservedAt.UnixMilli()
	if updatedAt <= 0 {
		updatedAt = 0
	}
	runID := strings.TrimSpace(string(status.RunID))
	if runID == "" {
		return FlowerContextSample{}, errors.New("floret context status missing run id")
	}
	phase, err := normalizeFlowerContextUsagePhase(status.Phase)
	if err != nil {
		return FlowerContextSample{}, err
	}
	pressureStatus, err := normalizeFlowerContextPressureStatus(status.Status)
	if err != nil {
		return FlowerContextSample{}, err
	}
	return FlowerContextSample{
		Available: accounting.Available && accounting.Measured, Measured: accounting.Measured, CharactersAvailable: accounting.CharactersAvailable, CharacterLimitation: accounting.CharacterLimitation,
		RequestID: status.RequestID, AttemptID: status.AttemptID, AttemptEpoch: status.AttemptEpoch, PayloadFingerprint: status.PayloadFingerprint, Provider: status.Provider, Model: status.Model,
		Characters:             accounting.Characters.Clone(),
		RunID:                  runID,
		StepIndex:              status.Step,
		Phase:                  phase,
		InputTokens:            accounting.InputTokens,
		ContextWindowTokens:    pressure.ContextWindowTokens,
		ThresholdTokens:        pressure.ThresholdTokens,
		RequestSafeLimitTokens: pressure.RequestSafeLimit,
		OutputHeadroomTokens:   pressure.OutputHeadroomTokens,
		RequestOutputTokens:    pressure.RequestOutputTokens, OutputControl: pressure.OutputControl, SafetyMarginTokens: pressure.SafetyMarginTokens,
		UsedRatio:      status.UsedRatio,
		ThresholdRatio: status.ThresholdRatio,
		PressureStatus: pressureStatus,
		Source:         source,
		UpdatedAtMs:    updatedAt,
	}, nil
}

func flowerContextCompactionFromFloret(compaction *observation.CompactionEvent) (FlowerContextCompaction, error) {
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
	runID := strings.TrimSpace(string(compaction.RunID))
	if runID == "" {
		return FlowerContextCompaction{}, errors.New("floret compaction missing run id")
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
		Decision:            flowerCompactionDecision(compaction.Decision),
		OperationID:         strings.TrimSpace(compaction.OperationID),
		TurnID:              compaction.TurnID.String(),
		RequestID:           strings.TrimSpace(compaction.RequestID),
		RunID:               runID,
		StepIndex:           compaction.Step,
		Phase:               phase,
		Status:              status,
		Trigger:             strings.TrimSpace(compaction.Trigger),
		Reason:              strings.TrimSpace(compaction.Reason),
		Source:              strings.TrimSpace(compaction.Source),
		TokensBefore:        compaction.TokensBefore,
		TokensAfterEstimate: compaction.TokensAfterEstimate,
		Error:               strings.TrimSpace(compaction.Error),
		UpdatedAtMs:         updatedAt,
	}, nil
}

func flowerCompactionDecision(decision *observation.CompactionDecision) *FlowerCompactionDecision {
	if decision == nil {
		return nil
	}
	candidate := func(snapshot *observation.CompactionRequestSnapshot) *FlowerCompactionRequestSnapshot {
		if snapshot == nil {
			return nil
		}
		return &FlowerCompactionRequestSnapshot{
			PayloadFingerprint: snapshot.PayloadFingerprint, Provider: snapshot.Provider, Model: snapshot.Model,
			EstimatedInputTokens: snapshot.Estimate.EstimatedInputTokens, Source: snapshot.Estimate.Source,
			EstimateMethod: snapshot.Estimate.Method, EstimateConfidence: snapshot.Estimate.Confidence,
			Pressure: snapshot.Pressure, CalibrationRequestID: snapshot.CalibrationRequestID,
		}
	}
	var capacity *FlowerCompactionCapacity
	if c := decision.Capacity; c != nil {
		capacity = &FlowerCompactionCapacity{Kind: c.Kind, Stage: c.Stage, Source: c.Source, ActualBytes: c.ActualBytes, LimitBytes: c.LimitBytes, ActualImages: c.ActualImages, LimitImages: c.LimitImages}
	}
	return &FlowerCompactionDecision{Capacity: capacity, Pressure: decision.Pressure, Before: candidate(decision.Before), After: candidate(decision.After)}
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
	contractErr := fmt.Errorf("invalid Floret %s contract: %w", strings.TrimSpace(kind), err)
	r.muFloretContract.Lock()
	if r.floretContractErr == nil {
		r.floretContractErr = contractErr
	}
	r.muFloretContract.Unlock()
	r.muCancel.Lock()
	cancelFn := r.cancelFn
	r.muCancel.Unlock()
	if cancelFn != nil {
		cancelFn()
	}
	r.recordRunDiagnostic("floret.contract.rejected", RealtimeStreamKindLifecycle, map[string]any{
		"contract_kind": strings.TrimSpace(kind),
		"error":         sanitizeLogText(err.Error(), 240),
	})
}

func (r *run) floretContractError() error {
	if r == nil {
		return nil
	}
	r.muFloretContract.Lock()
	defer r.muFloretContract.Unlock()
	return r.floretContractErr
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
		if stream.Text != "" {
			_ = r.appendTextDelta(stream.Text)
		}
	case flruntime.StreamObservationReasoningDelta:
		if stream.Text != "" {
			_ = r.appendThinkingDelta(stream.Text)
		}
	case flruntime.StreamObservationToolCallStart, flruntime.StreamObservationToolCallDelta, flruntime.StreamObservationToolCallEnd:
	case flruntime.StreamObservationModelRetry:
		r.recordRunDiagnostic("floret.provider.retry.stream", RealtimeStreamKindLifecycle, map[string]any{
			"attempt": stream.Attempt,
			"reason":  strings.TrimSpace(stream.Reason),
		})
	case flruntime.StreamObservationModelStreamDone:
		r.recordRunDiagnostic("floret.provider.stream.done", RealtimeStreamKindLifecycle, map[string]any{
			"attempt":              stream.Attempt,
			"finish_reason":        strings.TrimSpace(string(stream.FinishReason)),
			"raw_finish_reason":    strings.TrimSpace(stream.RawFinishReason),
			"finish_inferred":      stream.FinishInferred,
			"stream_reason_detail": strings.TrimSpace(stream.Reason),
		})
	case flruntime.StreamObservationModelStreamAbort:
		r.recordRunDiagnostic("floret.provider.stream.abort", RealtimeStreamKindLifecycle, map[string]any{
			"attempt": stream.Attempt,
			"reason":  strings.TrimSpace(stream.Reason),
		})
	}
}
