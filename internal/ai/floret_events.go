package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
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
	if err := r.validateFloretRuntimeEvent(ev); err != nil {
		r.rejectFloretContract("event", err)
		return
	}
	canonicalUserEntry := ev.Type == observation.EventTypeThreadEntryCommitted && ev.Committed != nil && ev.Committed.Kind == flruntime.ThreadDetailEventUserMessage
	if canonicalUserEntry {
		r.floretAdmitted.Store(true)
		if r.awaitFloretAdmission.Load() {
			if err := r.publishCanonicalUserAdmission(); err != nil {
				r.completeUserTurnAdmission(nil)
				r.rejectFloretContract("turn_admission", err)
				return
			}
			r.floretPresentationReady.Store(true)
			r.completeUserTurnAdmission(nil)
		}
	}
	if ev.Type == floretEventThreadTitleUpdated && r.host.broadcastThreadSummary != nil {
		_ = r.host.broadcastThreadSummary()
	}
	// The validated canonical user entry is the admission boundary for live
	// assistant state. A draft created after it can be rendered against the
	// canonical timeline without guessing its place.
	if !r.acceptsPresentationUpdates() {
		return
	}
	if canonicalUserEntry {
		r.ensureAssistantMessageStarted()
	}
	r.applyFloretStreamObservation(ev.Stream)
	r.applyFloretSourceObservation(ev.Sources)
	r.applyFloretContextStatus(ev.ContextStatus)
	r.applyFloretCompaction(ev.Compaction)
	if ev.Projection != nil {
		r.applyFloretThreadProjection(*ev.Projection)
	}
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
		if ev.Type != floretEventToolApprovalRequested {
			if err := r.syncPendingFloretApprovals(context.Background(), string(ev.Type)); err != nil {
				r.rejectFloretContract("pending_approvals", err)
				return
			}
		}
		r.recordRunDiagnostic("floret."+string(ev.Type), RealtimeStreamKindLifecycle, map[string]any{
			"tool_id":   strings.TrimSpace(ev.ToolID),
			"tool_name": strings.TrimSpace(ev.ToolName),
			"metadata":  ev.Metadata,
		})
	}
}

func (r *run) publishCanonicalUserAdmission() error {
	if r == nil {
		return errors.New("run admission coordinator is unavailable")
	}
	if err := r.commitPendingTurnCommandAdmission(false); err != nil {
		return err
	}
	if r.host.broadcastThreadSummary == nil {
		return errors.New("run thread snapshot publisher is unavailable")
	}
	if err := r.host.broadcastThreadSummary(); err != nil {
		return fmt.Errorf("publish admitted thread snapshot: %w", err)
	}
	if r.host.replaceLiveDraftWithCanonicalTimeline == nil {
		return errors.New("canonical timeline publisher is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), r.persistTimeout())
	defer cancel()
	if err := r.host.replaceLiveDraftWithCanonicalTimeline(ctx, r.id, r.turnID, r.messageID, "canonical_admission"); err != nil {
		return fmt.Errorf("publish canonical admission timeline: %w", err)
	}
	return nil
}

func (r *run) validateFloretRuntimeEvent(ev flruntime.Event) error {
	if err := ev.Validate(); err != nil {
		return err
	}
	identity := r.floretEventIdentity
	if identity.configured {
		eventThreadID := strings.TrimSpace(string(ev.ThreadID))
		eventTurnID := strings.TrimSpace(string(ev.TurnID))
		eventRunID := strings.TrimSpace(string(ev.RunID))
		if eventThreadID != identity.threadID {
			return errors.New("Floret event thread or turn identity mismatch")
		}
		isTitleEvent := ev.Type == floretEventThreadTitleUpdated || ev.Type == floretEventThreadTitleFailed
		if isTitleEvent {
			if eventRunID != "" || (eventTurnID != "" && eventTurnID != identity.turnID) {
				return errors.New("Floret title event identity mismatch")
			}
		} else if eventTurnID != identity.turnID {
			return errors.New("Floret event thread or turn identity mismatch")
		} else if identity.checkRunID && eventRunID != identity.runID {
			return errors.New("Floret event run identity mismatch")
		}
	}
	if ev.Projection != nil && !r.floretThreadProjectionMatchesRun(*ev.Projection) {
		return errors.New("Floret event projection identity mismatch")
	}
	return nil
}

func (r *run) expectFloretRuntimeEventIdentity(runID string, threadID string, turnID string, checkRunID bool) {
	if r == nil {
		return
	}
	r.floretEventIdentity = floretRuntimeEventIdentity{
		configured: true,
		checkRunID: checkRunID,
		runID:      strings.TrimSpace(runID),
		threadID:   strings.TrimSpace(threadID),
		turnID:     strings.TrimSpace(turnID),
	}
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
	switch compaction.Phase {
	case observation.CompactionPhaseComplete, observation.CompactionPhaseFailed, observation.CompactionPhaseCancelled, observation.CompactionPhaseNoop:
		r.finishManualCompaction(compaction.RequestID)
	}
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
	runID := strings.TrimSpace(status.RunID)
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
	runID := strings.TrimSpace(compaction.RunID)
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
