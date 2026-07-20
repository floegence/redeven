package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
)

func (r *run) runFloretHostedTurn(ctx context.Context, req RunRequest, providerCfg config.AIProvider, apiKey string, taskObjective string, adapterOverride ...ModelGateway) error {
	if r == nil {
		return errors.New("nil run")
	}
	providerType := strings.ToLower(strings.TrimSpace(providerCfg.Type))
	_, modelName, ok := strings.Cut(strings.TrimSpace(req.Model), "/")
	if !ok {
		modelName = strings.TrimSpace(req.Model)
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return r.failRun("Invalid model id", fmt.Errorf("invalid model id %q", strings.TrimSpace(req.Model)))
	}

	capability := contextmodel.NormalizeCapability(req.ModelCapability)
	if capability.ModelName == "" {
		capability.ModelName = modelName
	}
	if capability.WireModelName == "" {
		capability.WireModelName = modelName
	}
	if capability.ProviderID == "" {
		providerID, _, _ := strings.Cut(strings.TrimSpace(req.Model), "/")
		capability.ProviderID = strings.TrimSpace(providerID)
	}
	req.ModelCapability = capability
	if !capability.SupportsStrictJSONSchema && strings.EqualFold(strings.TrimSpace(req.Options.ResponseFormat), "json_schema") {
		req.Options.ResponseFormat = "json_object"
	}

	taskComplexity := TaskComplexityStandard

	var adapter ModelGateway
	if len(adapterOverride) > 0 && adapterOverride[0] != nil {
		adapter = adapterOverride[0]
	} else {
		var err error
		adapter, err = newProviderAdapter(providerType, strings.TrimSpace(providerCfg.BaseURL), strings.TrimSpace(apiKey), providerCfg.StrictToolSchema)
		if err != nil {
			return r.failRun("Failed to initialize provider adapter", err)
		}
	}

	webSearchCapability := resolveProviderWebSearchCapability(providerCfg, modelName)
	if enableFlowerWebSearchTool(providerCfg, webSearchCapability) {
		webSearchCapability.RegisterTool = true
	}
	r.webSearchMode = webSearchCapability.Mode
	r.webSearchToolEnabled = webSearchCapability.RegisterTool
	r.recordRunDiagnostic("web_search.config", RealtimeStreamKindLifecycle, map[string]any{
		"resolved":          webSearchCapability.Mode,
		"reason":            webSearchCapability.Reason,
		"web_search_tool":   webSearchCapability.RegisterTool,
		"provider_type":     providerType,
		"provider_base_url": strings.TrimSpace(providerCfg.BaseURL),
		"model":             modelName,
	})
	state := newRuntimeState(taskObjective)
	if source, hydrated := r.hydrateTodoRuntimeState(ctx, &state); hydrated {
		r.recordRunDiagnostic("todo.hydrated", RealtimeStreamKindLifecycle, map[string]any{
			"source":           source,
			"todo_total_count": state.TodoTotalCount,
			"todo_open_count":  state.TodoOpenCount,
			"todo_in_progress": state.TodoInProgressCount,
			"todo_version":     state.TodoSnapshotVersion,
		})
	}
	sharedState := newFloretToolRuntimeState(state)
	r.ensureSkillManager()

	contextWindow := modelGatewayDefaultContextWindowTokens
	if req.ModelCapability.MaxContextTokens > 0 {
		contextWindow = req.ModelCapability.MaxContextTokens
	}
	hostLabels := floretHostLabelsForRun(r)
	surfaceConfig := r.buildDynamicToolSurfaceConfig(taskObjective, taskComplexity, req.ModelCapability.SupportsAskUserQuestionBatches, sharedState, hostLabels)
	r.dynamicSurfaceConfig = surfaceConfig
	initialSurface, err := r.prepareRunToolSurface(ctx, surfaceConfig)
	if err != nil {
		return r.failRun("Failed to initialize dynamic tool surface", err)
	}
	req.Options.PermissionType = permissionTypeString(initialSurface.PermissionType)
	r.recordRunDiagnostic("floret.host_turn.start", RealtimeStreamKindLifecycle, map[string]any{
		"engine":                        "floret",
		"provider_type":                 providerType,
		"parallel_tool_calls_wire_mode": string(resolveParallelToolCallsWireMode(providerType, strings.TrimSpace(providerCfg.BaseURL))),
		"model":                         modelName,
		"max_tool_calls":                modelGatewayHardMaxToolCalls,
		"permission_type":               permissionTypeString(initialSurface.PermissionType),
	})
	r.recordRunDiagnostic("capability.contract.resolved", RealtimeStreamKindLifecycle, initialSurface.CapabilityContract.eventPayload())
	toolSurfaceProvider := r.dynamicToolSurfaceProvider(surfaceConfig, true)
	flProvider := newFloretProviderAdapter(
		adapter,
		providerType,
		capability.WireModelName,
		ProviderControls{
			ReasoningSelection:  req.Options.ReasoningSelection,
			ReasoningCapability: req.ModelCapability.ReasoningCapability,
			CacheControl:        req.Options.CacheControl,
			ResponseFormat:      req.Options.ResponseFormat,
			Temperature:         req.Options.Temperature,
			TopP:                req.Options.TopP,
		},
		TurnBudgets{
			MaxOutputToken: req.Options.MaxOutputTokens,
			MaxCostUSD:     req.Options.MaxCostUSD,
		},
		r.webSearchMode,
		withFloretAttachmentResolver(r.resolveFloretMessageAttachment, req.ModelCapability.SupportsImageInput, req.ModelCapability.SupportsFileInput),
		withFloretBeforeRequest(r.floretContractError),
	)
	completionPolicy := flruntime.TurnCompletionNaturalStop
	controlSpec, err := newFloretControlSpec(r, sharedState, initialSurface.ControlTools, taskComplexity)
	if err != nil {
		return r.failRun("Failed to initialize Floret control tools", err)
	}
	labels := flruntime.RunLabels{Correlation: map[string]string{
		"thread_id":  strings.TrimSpace(r.threadID),
		"turn_id":    strings.TrimSpace(r.turnID),
		"message_id": strings.TrimSpace(r.messageID),
	}, Host: initialSurface.HostContext}
	floretCfg := redevenFloretAdapterConfig(initialSurface.SystemPrompt, floretModelContextPolicy(contextWindow, req.Options.MaxOutputTokens), req.Options.ReasoningSelection)
	if r.floretHostFactory == nil {
		return r.failRun("Failed to initialize Floret host", errors.New("floret host factory not ready"))
	}
	gatewayIdentity, err := redevenFloretGatewayIdentity(providerCfg.ID, providerType, providerCfg.BaseURL, capability.WireModelName, flProvider.stateCompatibilityRoute())
	if err != nil {
		return r.failRun("Failed to initialize Floret model identity", err)
	}
	supplementalContext, err := floretSupplementalContextForInput(req.Input)
	if err != nil {
		return r.failRun("Failed to prepare linked context", err)
	}
	turnInput, err := r.floretTurnInput(ctx, req.Input)
	if err != nil {
		return r.failRun("Failed to prepare message attachments", err)
	}
	turnInput, frozenAttachments, err := r.preflightFloretTurnAttachments(ctx, turnInput, flProvider)
	if err != nil {
		return r.failRun("Failed to validate message attachments", err)
	}
	flProvider.attachmentResolver = r.floretAttachmentResolver(frozenAttachments)
	host, err := r.floretHostFactory(ctx, flruntime.TurnExecutionHostOptions{
		Config:                  floretCfg,
		ModelGateway:            flProvider,
		ModelGatewayIdentity:    gatewayIdentity,
		Tools:                   initialSurface.FloretTools,
		EffectAuthorizationGate: floretEffectAuthorizationGateForRun(r),
		Sink:                    floretEventSink{run: r},
		ToolSurfaceProvider:     toolSurfaceProvider,
		ThreadTitleMode:         flruntime.ThreadTitleModeProvider,
		LoopLimits: flruntime.LoopLimits{
			NoProgressLimit:    2,
			DuplicateToolLimit: 3,
		},
	})
	if err != nil {
		return r.failRun("Failed to initialize Floret host", err)
	}
	if err := r.commitPermissionSnapshot(initialSurface.PermissionSnapshot); err != nil {
		return r.failRun("Failed to persist permission snapshot", err)
	}
	var turnHost floretTurnHost = host
	r.setActiveFloretHost(turnHost)
	defer r.setActiveFloretHost(nil)
	threadID := flruntime.ThreadID(strings.TrimSpace(r.threadID))
	r.expectFloretRuntimeEventIdentity(r.id, r.threadID, r.turnID, true)
	r.emitLifecyclePhase("executing", map[string]any{"engine": "floret"})
	if payload := floretContextActionInjectedEventPayload(req.Input.ContextAction, supplementalContext); payload != nil {
		r.recordRunDiagnostic("flower.context_action.injected", RealtimeStreamKindLifecycle, payload)
	}
	result, err := turnHost.RunTurn(ctx, flruntime.RunTurnRequest{
		RunID:               flruntime.RunID(strings.TrimSpace(r.id)),
		ThreadID:            threadID,
		TurnID:              flruntime.TurnID(strings.TrimSpace(r.turnID)),
		Input:               turnInput,
		SupplementalContext: supplementalContext.Items,
		Labels:              labels,
		Completion:          completionPolicy,
		Signals:             controlSpec,
		Limits: flruntime.TurnLimits{
			MaxToolCalls:           modelGatewayHardMaxToolCalls,
			MaxInputTokens:         int64(req.Options.MaxInputTokens),
			MaxCostUSD:             req.Options.MaxCostUSD,
			MaxLengthContinuations: 2,
		},
		Reasoning:         req.Options.ReasoningSelection,
		ManualCompactions: r,
	})
	if contractErr := r.floretContractError(); contractErr != nil {
		if r.isDetached() {
			return nil
		}
		return r.failRunWithCode(runErrorCodeFloretEngineFailed, "", contractErr)
	}
	projectionUnavailable := false
	if result.Status != "" {
		projectionUnavailable = result.ProjectionAvailability == flruntime.TurnProjectionAvailabilityUnavailable
		if projectionErr := result.Validate(); projectionErr != nil {
			r.rejectFloretContract("turn_projection_outcome", projectionErr)
			if r.isDetached() {
				return nil
			}
			return r.failRunWithCode(runErrorCodeFloretEngineFailed, "", projectionErr)
		}
	}
	if projectionUnavailable {
		r.recordRunDiagnostic("floret.projection.unavailable", RealtimeStreamKindLifecycle, map[string]any{
			"source": "run_turn",
			"error":  sanitizeLogText(result.ProjectionError, 240),
		})
	}
	if result.Status.IsTerminal() && r.host.replaceLiveDraftWithCanonicalTimeline != nil {
		if replaceErr := r.host.replaceLiveDraftWithCanonicalTimeline(context.Background(), r.id, r.turnID, r.messageID, "terminal_projection"); replaceErr != nil {
			r.recordRunDiagnostic("flower.timeline.replace_failed", RealtimeStreamKindLifecycle, map[string]any{"error": replaceErr.Error()})
		}
	}
	if reason := r.floretParentTerminalSubagentCloseReason(ctx, result, err); reason != "" {
		if closeErr := r.closeParentTerminalSubagents(context.Background(), reason); closeErr != nil {
			if r.log != nil {
				r.log.Warn("ai: close parent terminal subagents failed", "run_id", r.id, "thread_id", r.threadID, "reason", reason, "error", closeErr)
			}
			r.recordRunDiagnostic("subagent.parent_terminal_close_failed", RealtimeStreamKindLifecycle, map[string]any{
				"reason": reason,
				"error":  closeErr.Error(),
			})
		}
	}
	_, cleanupErr := r.cleanupRunTerminalProcesses()
	if cleanupErr != nil {
		if r.log != nil {
			r.log.Warn("ai: cleanup run terminal processes failed", "run_id", r.id, "thread_id", r.threadID, "error", cleanupErr)
		}
		r.recordRunDiagnostic("terminal.cleanup_failed", RealtimeStreamKindLifecycle, map[string]any{
			"error": cleanupErr.Error(),
		})
	}
	if subagentCleanupErr := r.cleanupSubagentTerminalProcesses(context.Background()); subagentCleanupErr != nil {
		if r.log != nil {
			r.log.Warn("ai: cleanup subagent terminal processes failed", "run_id", r.id, "thread_id", r.threadID, "error", subagentCleanupErr)
		}
		r.recordRunDiagnostic("subagent.terminal_cleanup_failed", RealtimeStreamKindLifecycle, map[string]any{
			"error": subagentCleanupErr.Error(),
		})
	}
	if err != nil && result.Status == "" {
		if r.isDetached() {
			return nil
		}
		if cancelReason := strings.TrimSpace(r.getCancelReason()); cancelReason == "canceled" || cancelReason == "timed_out" {
			return r.projectFloretCancelledResult(ctx, int(result.Metrics.Steps))
		}
		return r.failRunWithCode(classifyRunFailureCode(err, runErrorCodeFloretEngineFailed), "", err)
	}
	if err != nil {
		switch result.Status {
		case flruntime.TurnStatusFailed:
			// The returned error is the execution outcome. Result.Error is a
			// diagnostic projection of that error and must not replace it.
			result.Error = err.Error()
		case flruntime.TurnStatusCancelled:
			// Cancellation keeps its product lifecycle projection below.
		default:
			if r.isDetached() {
				return nil
			}
			return r.failRunWithCode(classifyRunFailureCode(err, runErrorCodeFloretEngineFailed), "", err)
		}
	}
	if result.Status == flruntime.TurnStatusCompleted || result.Status == flruntime.TurnStatusWaiting {
		if !r.acceptsEngineResultProjection() {
			return nil
		}
		if result.Projection != nil {
			r.applyFloretThreadProjection(*result.Projection)
		}
	}
	if result.Status == flruntime.TurnStatusCancelled {
		if r.isDetached() {
			if result.Projection != nil {
				r.applyFloretThreadProjectionInternal(*result.Projection, false, true)
			}
			return nil
		}
		if result.Projection != nil {
			r.applyFloretThreadProjection(*result.Projection)
		}
	}
	if r.acceptsEngineResultProjection() {
		r.recordRuntimeTurnUsage(flowerUsageFromFloret(result.Metrics.ProviderUsage), 0)
	}
	return r.projectFloretResult(ctx, result, req)
}

func (r *run) floretParentTerminalSubagentCloseReason(ctx context.Context, result flruntime.TurnResult, runErr error) string {
	if r == nil || r.subagentDepth > 0 {
		return ""
	}
	cancelReason := strings.TrimSpace(r.getCancelReason())
	switch {
	case cancelReason == "timed_out":
		return "parent_timed_out"
	case cancelReason == "canceled":
		return "parent_cancelled"
	case result.Status == flruntime.TurnStatusCancelled:
		if ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return "parent_timed_out"
		}
		return "parent_cancelled"
	case result.Status == flruntime.TurnStatusFailed:
		return "parent_failed"
	case runErr != nil:
		if errors.Is(runErr, context.DeadlineExceeded) || (ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded)) {
			return "parent_timed_out"
		}
		if errors.Is(runErr, context.Canceled) || (ctx != nil && errors.Is(ctx.Err(), context.Canceled)) {
			return "parent_cancelled"
		}
		return "parent_failed"
	default:
		return ""
	}
}

func (r *run) closeParentTerminalSubagents(ctx context.Context, reason string) error {
	if r == nil {
		return nil
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil
	}
	threadID := strings.TrimSpace(r.threadID)
	if threadID == "" {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	timeout := r.persistTimeout()
	if timeout <= 0 {
		timeout = defaultPersistOpTimeout
	}
	closeCtx, cancel := context.WithTimeout(ctxOrBackground(ctx), timeout)
	defer cancel()

	runtime, ok := r.subagentRuntime.(*floretSubagentRuntime)
	if !ok || runtime == nil {
		return nil
	}
	host := runtime.currentHost()
	if host == nil {
		return nil
	}
	result, err := closeSubagentsWithHost(closeCtx, host, threadID, reason, strings.TrimSpace(r.turnID))
	if err != nil {
		return err
	}
	if r.subagentRuntime != nil {
		if runtime, ok := r.subagentRuntime.(*floretSubagentRuntime); ok {
			snapshots := make([]subagentSnapshot, 0, len(result))
			for _, snapshot := range result {
				snapshots = append(snapshots, subagentSnapshotFromFloret(snapshot))
			}
			runtime.refreshSubagentsPatch(closeCtx, snapshots...)
		}
	}
	r.recordRunDiagnostic("subagent.parent_terminal_close", RealtimeStreamKindLifecycle, map[string]any{
		"reason":       reason,
		"closed_count": len(result),
	})
	return nil
}

func (r *run) projectFloretResult(ctx context.Context, result flruntime.TurnResult, req RunRequest) error {
	if !r.acceptsEngineResultProjection() {
		return nil
	}
	step := result.Metrics.Steps
	if step <= 0 {
		step = 1
	}
	switch result.Status {
	case flruntime.TurnStatusCompleted:
		if signal := result.Signal; signal != nil && strings.TrimSpace(signal.Name) == "task_complete" {
			resultText := strings.TrimSpace(signal.OutputText)
			if resultText == "" {
				resultText = strings.TrimSpace(anyToString(signal.Payload["result"]))
			}
			evidenceRefs := extractStringListFromAny(signal.Payload["evidence_refs"])
			for _, ref := range evidenceRefs {
				r.addWebSource("", ref)
			}
			if req.Options.RequireUserConfirmOnTaskComplete {
				approved, approveErr := r.waitForTaskCompleteConfirm(ctx, resultText)
				if approveErr != nil {
					return r.failRun("Failed to confirm task completion", approveErr)
				}
				if !approved {
					return r.failRun("Task completion rejected by user", errors.New("task completion rejected"))
				}
			}
			r.setFinalizationReason("task_complete")
			r.setEndReason("complete")
			r.emitLifecyclePhase("ended", map[string]any{"reason": "task_complete", "step_index": step})
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
			return nil
		}
		r.setFinalizationReason("natural_stop")
		r.setEndReason("complete")
		r.emitLifecyclePhase("ended", map[string]any{"reason": "natural_stop", "step_index": step})
		r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
		return nil
	case flruntime.TurnStatusWaiting:
		if signal := result.Signal; signal != nil {
			switch strings.TrimSpace(signal.Name) {
			case "ask_user":
				return r.projectFloretAskUserWaiting(step, signal)
			}
		}
		return r.failRun("Run entered waiting state without a supported control signal", errors.New("unsupported waiting control signal"))
	case flruntime.TurnStatusCancelled:
		return r.projectFloretCancelledResult(ctx, step)
	case flruntime.TurnStatusFailed:
		resultErr := errors.New(strings.TrimSpace(result.Error))
		if strings.TrimSpace(result.Error) == "" {
			resultErr = errors.New("floret host turn failed")
		}
		if finishReason := floretFailureFinishReason(result); finishReason != "" {
			r.persistFloretHostTurnResult(step, result, finishReason)
			return r.failReplyFinish(step, finishReason, floretFailureFinalizationReason(finishReason), floretFailureMessage(finishReason))
		}
		return r.failRunWithCode(classifyRunFailureCode(resultErr, runErrorCodeFloretEngineFailed), "", resultErr)
	default:
		return r.failRunWithCode(runErrorCodeFloretEngineFailed, "", fmt.Errorf("unknown floret status %q", result.Status))
	}
}

func (r *run) projectFloretCancelledResult(ctx context.Context, step int) error {
	reason := "canceled"
	if r != nil && r.getCancelReason() == "timed_out" {
		reason = "timed_out"
	} else if ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		reason = "timed_out"
	}
	r.setFinalizationReason(reason)
	r.setEndReason(reason)
	r.emitLifecyclePhase("ended", map[string]any{"reason": reason, "step_index": step})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return nil
}

func enableFlowerWebSearchTool(providerCfg config.AIProvider, capability providerWebSearchCapability) bool {
	if capability.RegisterTool {
		return true
	}
	if strings.TrimSpace(capability.Mode) != providerWebSearchModeExternalBrave {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(providerCfg.Type), "openai_compatible")
}

func redevenFloretAdapterConfig(systemPrompt string, contextPolicy flconfig.ContextPolicy, reasoning config.AIReasoningSelection) flconfig.Config {
	return flconfig.Config{
		SystemPrompt:  systemPrompt,
		ContextPolicy: contextPolicy,
		Reasoning:     reasoning,
	}
}

func redevenFloretGatewayIdentity(providerID string, providerType string, baseURL string, modelName string, route string) (flruntime.ModelGatewayIdentity, error) {
	providerID = strings.TrimSpace(providerID)
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	modelName = strings.TrimSpace(modelName)
	route = strings.TrimSpace(route)
	if providerID == "" || providerType == "" || modelName == "" || route == "" {
		return flruntime.ModelGatewayIdentity{}, errors.New("Floret model gateway identity requires provider, type, model, and route")
	}
	endpoint, err := normalizedFloretGatewayBaseURL(baseURL)
	if err != nil {
		return flruntime.ModelGatewayIdentity{}, err
	}
	digest := sha256.Sum256([]byte(strings.Join([]string{providerID, providerType, endpoint, modelName, route}, "\x00")))
	return flruntime.ModelGatewayIdentity{
		Provider:              providerID,
		Model:                 modelName,
		StateCompatibilityKey: hex.EncodeToString(digest[:]),
	}, nil
}

func normalizedFloretGatewayBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "default", nil
	}
	u, err := url.Parse(raw)
	if err != nil || strings.TrimSpace(u.Scheme) == "" || strings.TrimSpace(u.Host) == "" {
		return "", fmt.Errorf("invalid provider base URL %q", raw)
	}
	if u.User != nil {
		return "", errors.New("provider base URL must not contain user information")
	}
	u.Scheme = strings.ToLower(u.Scheme)
	u.Host = strings.ToLower(u.Host)
	u.Path = strings.TrimRight(u.Path, "/")
	u.RawPath = ""
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func floretFailureFinishReason(result flruntime.TurnResult) string {
	finishReason := normalizeReplyFinishReason(string(result.FinishReason))
	if finishReason == "unknown" {
		finishReason = normalizeReplyFinishReason(result.RawFinishReason)
	}
	if classifyReplyFinish(finishReason) == replyFinishClassBlocked {
		return finishReason
	}
	if strings.Contains(strings.ToLower(result.Error), "content filtered") {
		return "content_filter"
	}
	return ""
}

func floretFailureFinalizationReason(finishReason string) string {
	switch classifyReplyFinish(finishReason) {
	case replyFinishClassBlocked:
		return "reply_finish_blocked"
	default:
		return "reply_finish_invalid"
	}
}

func floretFailureMessage(finishReason string) string {
	switch classifyReplyFinish(finishReason) {
	case replyFinishClassBlocked:
		return "AI provider blocked the reply before Flower could finish the answer."
	default:
		return "AI provider returned an invalid terminal state before Flower could finish."
	}
}

func (r *run) persistFloretHostTurnResult(step int, result flruntime.TurnResult, finishReason string) {
	if r == nil {
		return
	}
	usage := flowerUsageFromFloret(result.Metrics.ProviderUsage)
	r.recordRunDiagnostic("floret.host_turn.result", RealtimeStreamKindLifecycle, map[string]any{
		"step_index":    step,
		"finish_reason": normalizeReplyFinishReason(finishReason),
		"tool_calls":    result.Metrics.ToolCalls,
		"usage": map[string]any{
			"input_tokens":     usage.InputTokens,
			"output_tokens":    usage.OutputTokens,
			"reasoning_tokens": usage.ReasoningTokens,
		},
		"engine": "floret",
	})
}

func (r *run) projectFloretAskUserWaiting(step int, signal *flruntime.TurnSignal) error {
	if !r.acceptsEngineResultProjection() {
		return nil
	}
	if signal == nil {
		return errors.New("nil ask_user control signal")
	}
	payload := signal.Payload
	questions := parseAskUserQuestionsAny(payload["questions"])
	ask := normalizeAskUserSignal(askUserSignal{
		Questions:        questions,
		ReasonCode:       strings.TrimSpace(anyToString(payload["reason_code"])),
		RequiredFromUser: extractStringListFromAny(payload["required_from_user"]),
		EvidenceRefs:     extractStringListFromAny(payload["evidence_refs"]),
	})
	if ask.Question == "" && len(ask.Questions) > 0 {
		ask.Question = strings.TrimSpace(ask.Questions[0].Question)
	}
	if reason := validateAskUserSignal(ask); reason != "" {
		return errors.New(askUserValidationError(reason, ask.ContractError))
	}
	r.persistAskUserWaitingPrompt(ask, "model_signal", strings.TrimSpace(signal.CallID))
	r.reconcileCanonicalWaitingUserMessage()
	finalReason := finalizationReasonForAskUserSource("model_signal")
	r.recordRunDiagnostic("ask_user.waiting", RealtimeStreamKindLifecycle, map[string]any{
		"question":            ask.Question,
		"questions_count":     len(ask.Questions),
		"choices_count":       requestUserInputQuestionChoiceCount(ask.Questions),
		"reason_code":         ask.ReasonCode,
		"required_inputs":     len(ask.RequiredFromUser),
		"evidence_refs":       len(ask.EvidenceRefs),
		"source":              "model_signal",
		"appended_to_message": false,
		"finalization_reason": finalReason,
	})
	r.setFinalizationReason(finalReason)
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{"reason": finalReason, "step_index": step})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return nil
}

func floretModelContextPolicy(contextWindow int, maxOutput int) flconfig.ContextPolicy {
	if contextWindow <= 0 {
		contextWindow = modelGatewayDefaultContextWindowTokens
	}
	return flconfig.ContextPolicy{
		ContextWindowTokens:   int64(contextWindow),
		MaxOutputTokens:       int64(maxOutput),
		ReservedOutputTokens:  int64(maxOutput),
		MaxCompactionFailures: 2,
	}
}

func floretThreadStorePath(stateDir string) (string, error) {
	stateDir = strings.TrimSpace(stateDir)
	if stateDir == "" {
		return "", errors.New("missing state dir for Floret thread store")
	}
	dir := filepath.Join(stateDir, "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return filepath.Join(dir, "floret_threads.sqlite"), nil
}
