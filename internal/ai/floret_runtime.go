package ai

import (
	"context"
	"errors"
	"fmt"
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

	permissionType, err := normalizePermissionType(req.Options.PermissionType, "")
	if err != nil {
		return r.failRun("Invalid permission type", err)
	}
	if strings.TrimSpace(req.Options.PermissionType) == "" {
		permissionType, err = normalizePermissionType(r.cfg.EffectivePermissionType(), permissionType)
		if err != nil {
			return r.failRun("Invalid configured permission type", err)
		}
	}
	req.Options.PermissionType = permissionTypeString(permissionType)
	r.permissionType = permissionType
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
	r.persistRunEvent("web_search.config", RealtimeStreamKindLifecycle, map[string]any{
		"resolved":          webSearchCapability.Mode,
		"reason":            webSearchCapability.Reason,
		"web_search_tool":   webSearchCapability.RegisterTool,
		"provider_type":     providerType,
		"provider_base_url": strings.TrimSpace(providerCfg.BaseURL),
		"model":             modelName,
	})
	r.persistRunEvent("floret.host_turn.start", RealtimeStreamKindLifecycle, map[string]any{
		"engine":          "floret",
		"provider_type":   providerType,
		"model":           modelName,
		"max_tool_calls":  modelGatewayHardMaxToolCalls,
		"permission_type": permissionTypeString(permissionType),
	})

	state := newRuntimeState(taskObjective)
	if source, hydrated := r.hydrateTodoRuntimeState(ctx, &state); hydrated {
		r.persistRunEvent("todo.hydrated", RealtimeStreamKindLifecycle, map[string]any{
			"source":           source,
			"todo_total_count": state.TodoTotalCount,
			"todo_open_count":  state.TodoOpenCount,
			"todo_in_progress": state.TodoInProgressCount,
			"todo_version":     state.TodoSnapshotVersion,
		})
	}
	sharedState := newFloretToolRuntimeState(state)
	r.ensureSkillManager()

	providerContinuation := newProviderContinuationProjector(r, providerCfg.ID, providerType, modelName, providerCfg.BaseURL)
	previousState, err := providerContinuation.PreviousState(ctx)
	if err != nil {
		return r.failRun("Failed to load provider continuation", err)
	}
	contextWindow := modelGatewayDefaultContextWindowTokens
	if req.ModelCapability.MaxContextTokens > 0 {
		contextWindow = req.ModelCapability.MaxContextTokens
	}
	hostLabels := floretHostLabelsForRun(r)
	surfaceConfig := r.buildDynamicToolSurfaceConfig(taskObjective, taskComplexity, req.ModelCapability.SupportsAskUserQuestionBatches, sharedState, hostLabels)
	r.dynamicSurfaceConfig = surfaceConfig
	initialSurface, err := r.buildRunToolSurface(ctx, surfaceConfig, permissionType)
	if err != nil {
		return r.failRun("Failed to initialize dynamic tool surface", err)
	}
	r.persistRunEvent("capability.contract.resolved", RealtimeStreamKindLifecycle, initialSurface.CapabilityContract.eventPayload())
	toolSurfaceProvider := r.dynamicToolSurfaceProvider(surfaceConfig, initialSurface.PermissionType, true)
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
			MaxInputTokens: req.Options.MaxInputTokens,
			MaxOutputToken: req.Options.MaxOutputTokens,
			MaxCostUSD:     req.Options.MaxCostUSD,
		},
		r.webSearchMode,
	)
	completionPolicy := flruntime.TurnCompletionNaturalStop
	controlSpec, err := newFloretControlSpec(r, sharedState, initialSurface.ControlTools, taskComplexity)
	if err != nil {
		return r.failRun("Failed to initialize Floret control tools", err)
	}
	labels := flruntime.RunLabels{Correlation: map[string]string{"thread_id": strings.TrimSpace(r.threadID), "message_id": strings.TrimSpace(r.messageID)}, Host: initialSurface.HostContext}
	maxTotalTokens := int64(req.Options.MaxInputTokens + req.Options.MaxOutputTokens)
	if maxTotalTokens <= 0 {
		maxTotalTokens = 0
	}
	floretCfg := redevenFloretAdapterConfig(initialSurface.SystemPrompt, floretModelContextPolicy(contextWindow, req.Options.MaxOutputTokens), req.Options.ReasoningSelection)
	store, err := r.openFloretThreadStore()
	if err != nil {
		return r.failRun("Failed to initialize Floret context store", err)
	}
	defer func() { _ = store.Close() }()
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config:              floretCfg,
		ModelGateway:        flProvider,
		Store:               store,
		Tools:               initialSurface.FloretTools,
		Approver:            floretToolApproverForRun(r),
		Sink:                floretEventSink{run: r},
		ToolSurfaceProvider: toolSurfaceProvider,
		LoopLimits: flruntime.LoopLimits{
			NoProgressLimit:    2,
			DuplicateToolLimit: 3,
		},
	})
	if err != nil {
		return r.failRun("Failed to initialize Floret host", err)
	}
	r.setActiveFloretHost(host)
	defer r.setActiveFloretHost(nil)
	threadID := flruntime.ThreadID(strings.TrimSpace(r.threadID))
	if err := ensureFloretThread(ctx, host, threadID); err != nil {
		return r.failRun("Failed to initialize Floret thread", err)
	}
	r.emitLifecyclePhase("executing", map[string]any{"engine": "floret"})
	result, err := host.RunTurn(ctx, flruntime.RunTurnRequest{
		RunID:                 flruntime.RunID(strings.TrimSpace(r.id)),
		ThreadID:              threadID,
		TurnID:                flruntime.TurnID(strings.TrimSpace(r.messageID)),
		Input:                 floretCurrentTurnInput(req.Input),
		Labels:                labels,
		PreviousProviderState: previousState,
		Completion:            completionPolicy,
		Signals:               controlSpec,
		Limits: flruntime.TurnLimits{
			MaxToolCalls:           modelGatewayHardMaxToolCalls,
			MaxTotalTokens:         maxTotalTokens,
			MaxCostUSD:             req.Options.MaxCostUSD,
			MaxLengthContinuations: 2,
		},
		Reasoning:         req.Options.ReasoningSelection,
		ManualCompactions: r,
	})
	if err != nil && result.Status == "" {
		return r.failRunWithCode(classifyRunFailureCode(err, runErrorCodeFloretEngineFailed), "", err)
	}
	if !r.acceptsEngineResultProjection() {
		return nil
	}
	if result.Status == flruntime.TurnStatusCompleted || result.Status == flruntime.TurnStatusWaiting {
		r.applyFloretThreadProjection(result.Projection)
	}
	r.recordRuntimeTurnUsage(flowerUsageFromFloret(result.Metrics.ProviderUsage), 0)
	r.setProviderContinuationCandidate(providerContinuation.Candidate(floretProviderStateToFlower(result.ProviderState)))
	if ctx.Err() != nil && result.Status != flruntime.TurnStatusCompleted && result.Status != flruntime.TurnStatusWaiting {
		return r.failRun("Floret run was canceled", ctx.Err())
	}
	return r.projectFloretResult(ctx, result, req, sharedState.snapshot(), taskComplexity, permissionTypeString(r.permissionType))
}

func (r *run) projectFloretResult(ctx context.Context, result flruntime.TurnResult, req RunRequest, state runtimeState, complexity string, permissionType string) error {
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
			gatePassed, gateReason := evaluateTaskCompletionGate(resultText, state, complexity, permissionType)
			r.persistRunEvent("completion.attempt", RealtimeStreamKindLifecycle, map[string]any{
				"step_index":      step,
				"attempt":         "task_complete",
				"gate_passed":     gatePassed,
				"gate_reason":     gateReason,
				"complexity":      complexity,
				"permission_type": strings.TrimSpace(permissionType),
				"engine":          "floret",
			})
			if !gatePassed {
				return r.failRun("Task completion rejected by completion gate", fmt.Errorf("task_complete rejected: %s", gateReason))
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
		if r.finalizeIfContextCanceled(ctx) {
			return nil
		}
		return r.failRun("Floret run was canceled", context.Canceled)
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
		Provider:      flconfig.ProviderFake,
		Model:         "redeven-model-adapter",
		SystemPrompt:  systemPrompt,
		ContextPolicy: contextPolicy,
		Reasoning:     reasoning,
	}
}

func floretFailureFinishReason(result flruntime.TurnResult) string {
	finishReason := normalizeReplyFinishReason(result.FinishReason)
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
	r.persistRunEvent("floret.host_turn.result", RealtimeStreamKindLifecycle, map[string]any{
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
	if ask.Question == "" {
		ask.Question = strings.TrimSpace(signal.OutputText)
	}
	if ask.Question == "" && len(ask.Questions) > 0 {
		ask.Question = strings.TrimSpace(ask.Questions[0].Question)
	}
	if ask.Question == "" {
		ask.Question = "I need clarification to continue safely."
	}
	r.persistAskUserWaitingPrompt(ask, "model_signal", strings.TrimSpace(signal.CallID))
	r.reconcileCanonicalWaitingUserMessage()
	finalReason := finalizationReasonForAskUserSource("model_signal")
	r.persistRunEvent("ask_user.waiting", RealtimeStreamKindLifecycle, map[string]any{
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

func floretCurrentTurnInput(input RunInput) string {
	parts := make([]string, 0, 1+len(input.Attachments))
	if text := strings.TrimSpace(input.Text); text != "" {
		parts = append(parts, text)
	}
	for _, attachment := range input.Attachments {
		label := strings.TrimSpace(attachment.Name)
		if label == "" {
			label = strings.TrimSpace(attachment.URL)
		}
		if label == "" {
			continue
		}
		line := "Attachment: " + label
		if mimeType := strings.TrimSpace(attachment.MimeType); mimeType != "" {
			line += " (" + mimeType + ")"
		}
		if uri := strings.TrimSpace(attachment.URL); uri != "" && uri != label {
			line += "\n" + uri
		}
		parts = append(parts, line)
	}
	return strings.Join(parts, "\n\n")
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

func (r *run) openFloretThreadStore() (*flruntime.Store, error) {
	path, err := floretThreadStorePath(r.stateDir)
	if err != nil {
		return nil, err
	}
	return flruntime.OpenSQLiteStore(path)
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
