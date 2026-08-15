package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/v4/observation"
	flprovider "github.com/floegence/floret/v4/provider"
	flruntime "github.com/floegence/floret/v4/runtime"
)

const (
	floretEventStepStart             = observation.EventTypeStepStart
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
	if (ev.Type == floretEventThreadTitlePending || ev.Type == floretEventThreadTitleUpdated || ev.Type == floretEventThreadTitleFailed) && r.host.broadcastThreadSummary != nil {
		_ = r.host.broadcastThreadSummary()
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
	r.applyFloretSourceObservation(ev.Sources)
	r.applyFloretContextStatus(ev.ContextStatus)
	r.applyFloretCompaction(ev.Compaction)
	r.recordFloretActivityEvent(ev)
	switch ev.Type {
	case floretEventProviderRequest:
		r.updateModelIOStatus(FlowerModelIOPhaseWaitingResponse, ev.Step)
		r.recordRunDiagnostic("floret.provider.request", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"provider":   strings.TrimSpace(ev.Provider),
			"model":      strings.TrimSpace(ev.Model),
			"metadata":   ev.Metadata,
		})
	case floretEventProviderFinish:
		r.updateModelIOStatus(FlowerModelIOPhaseFinalizing, ev.Step)
		r.recordRunDiagnostic("floret.provider.finish", RealtimeStreamKindLifecycle, map[string]any{
			"step_index":        ev.Step,
			"finish_reason":     strings.TrimSpace(string(ev.FinishReason)),
			"raw_finish_reason": strings.TrimSpace(ev.RawFinishReason),
			"finish_inferred":   ev.FinishInferred,
			"metadata":          ev.Metadata,
		})
	case floretEventProviderRetry:
		r.updateModelIOStatus(FlowerModelIOPhaseRetrying, ev.Step)
		r.recordRunDiagnostic("floret.provider.retry", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": ev.Step,
			"message":    strings.TrimSpace(ev.Message),
		})
	case floretEventStepStart:
		r.updateModelIOStatus(FlowerModelIOPhasePreparing, ev.Step)
		r.touchActivity()
	case floretEventRunEnd:
		r.clearModelIOStatus()
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
			return errors.New("Floret event thread or turn identity mismatch")
		}
		isTitleEvent := ev.Type == floretEventThreadTitlePending || ev.Type == floretEventThreadTitleUpdated || ev.Type == floretEventThreadTitleFailed
		if isTitleEvent {
			threadScoped := eventRunID == "" && eventTurnID == ""
			runScoped := eventRunID == identity.runID && eventTurnID == identity.turnID
			if !threadScoped && !runScoped {
				return errors.New("Floret title event identity mismatch")
			}
		} else if eventTurnID != identity.turnID {
			return errors.New("Floret event thread or turn identity mismatch")
		} else if identity.checkRunID && eventRunID != identity.runID {
			return errors.New("Floret event run identity mismatch")
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

func (r *run) applyFloretContextStatus(status *observation.ContextStatus) {
	if r == nil || status == nil {
		return
	}
	if !r.acceptsPresentationUpdates() {
		return
	}
	usage, err := flowerContextUsageFromFloret(status)
	if err != nil {
		r.rejectFloretContract("context_status", err)
		return
	}
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
	projected, err := flowerContextCompactionFromFloret(compaction)
	if err != nil {
		r.rejectFloretContract("compaction", err)
		return
	}
	r.bindContextCompactionOperationAnchor(projected.OperationID, compaction.RequestID)
	decoration, err := r.flowerContextCompactionDecoration(projected)
	if err != nil {
		r.rejectFloretContract("compaction_decoration", err)
		return
	}
	r.sendStreamEvent(streamEventContextCompaction{
		Type:               "context-compaction",
		Compaction:         projected,
		TimelineDecoration: decoration,
	})
}

func (r *run) flowerContextCompactionDecoration(compaction FlowerContextCompaction) (FlowerTimelineDecoration, error) {
	operationID := strings.TrimSpace(compaction.OperationID)
	if operationID == "" {
		return FlowerTimelineDecoration{}, errors.New("Floret compaction missing operation id")
	}
	anchor := r.contextCompactionAnchor(operationID)
	return FlowerTimelineDecoration{
		DecorationID: "context-compaction:" + operationID,
		Kind:         "context_compaction",
		Anchor:       anchor,
		Ordinal:      0,
		Compaction:   compaction,
	}, nil
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
	if r.host.lastVisibleTimelineAnchor == nil {
		return FlowerTimelineAnchor{}
	}
	anchor, err := r.host.lastVisibleTimelineAnchor(context.Background())
	if err != nil {
		return FlowerTimelineAnchor{}
	}
	return anchor
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

func flowerContextUsageFromFloret(status *observation.ContextStatus) (FlowerContextUsage, error) {
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
	runID := strings.TrimSpace(string(status.RunID))
	if runID == "" {
		return FlowerContextUsage{}, errors.New("Floret context status missing run id")
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
		return FlowerContextCompaction{}, errors.New("Floret compaction missing run id")
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

func (r *run) applyFloretSourceObservation(sources []flprovider.Source) {
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
		r.recordRunDiagnostic("floret.provider.retry.stream", RealtimeStreamKindLifecycle, map[string]any{
			"attempt": stream.Attempt,
			"reason":  strings.TrimSpace(stream.Reason),
		})
	case flruntime.StreamObservationModelStreamDone:
		r.updateModelIOStatus(FlowerModelIOPhaseFinalizing, stream.Attempt)
		r.recordRunDiagnostic("floret.provider.stream.done", RealtimeStreamKindLifecycle, map[string]any{
			"attempt":              stream.Attempt,
			"finish_reason":        strings.TrimSpace(string(stream.FinishReason)),
			"raw_finish_reason":    strings.TrimSpace(stream.RawFinishReason),
			"finish_inferred":      stream.FinishInferred,
			"stream_reason_detail": strings.TrimSpace(stream.Reason),
		})
	case flruntime.StreamObservationModelStreamAbort:
		r.updateModelIOStatus(FlowerModelIOPhaseRetrying, stream.Attempt)
		r.recordRunDiagnostic("floret.provider.stream.abort", RealtimeStreamKindLifecycle, map[string]any{
			"attempt": stream.Attempt,
			"reason":  strings.TrimSpace(stream.Reason),
		})
	}
}
