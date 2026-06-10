package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	flengine "github.com/floegence/floret/engine"
	flprovider "github.com/floegence/floret/provider"
	flcache "github.com/floegence/floret/provider/cache"
	flsession "github.com/floegence/floret/session"
	flartifact "github.com/floegence/floret/session/artifact"
	flcontextpolicy "github.com/floegence/floret/session/contextpolicy"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
)

func (r *run) runNative(ctx context.Context, req RunRequest, providerCfg config.AIProvider, apiKey string, taskObjective string, adapterOverride ...Provider) error {
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
	if capability.ProviderID == "" {
		providerID, _, _ := strings.Cut(strings.TrimSpace(req.Model), "/")
		capability.ProviderID = strings.TrimSpace(providerID)
	}
	req.ModelCapability = capability
	if !capability.SupportsReasoningTokens {
		req.Options.ThinkingBudgetTokens = 0
	}
	if !capability.SupportsStrictJSONSchema && strings.EqualFold(strings.TrimSpace(req.Options.ResponseFormat), "json_schema") {
		req.Options.ResponseFormat = "json_object"
	}

	maxSteps := req.Options.MaxSteps
	if maxSteps <= 0 {
		maxSteps = nativeDefaultMaxSteps
	}
	if maxSteps > nativeHardMaxSteps {
		maxSteps = nativeHardMaxSteps
	}
	mode := normalizeRunMode(req.Options.Mode, r.cfg.EffectiveMode())
	req.Options.Mode = mode
	r.runMode = mode
	intent := normalizeRunIntent(req.Options.Intent)
	req.Options.Intent = intent
	executionContract := normalizeExecutionContract(
		req.Options.ExecutionContract,
		intent,
		RunObjectiveModeReplace,
		req.Options.Complexity,
		req.Options.TodoPolicy,
		req.InteractionContract,
	)
	req.Options.ExecutionContract = executionContract
	r.setExecutionContract(executionContract)
	taskComplexity := normalizeTaskComplexity(req.Options.Complexity)
	req.Options.Complexity = taskComplexity

	var adapter Provider
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
	r.persistRunEvent("native.runtime.start", RealtimeStreamKindLifecycle, map[string]any{
		"engine":                       "floret",
		"provider_type":                providerType,
		"model":                        modelName,
		"max_steps":                    maxSteps,
		"mode":                         mode,
		"intent":                       intent,
		"execution_contract":           executionContract,
		"complexity":                   taskComplexity,
		"interaction_contract_enabled": normalizeInteractionContract(req.InteractionContract).Enabled,
	})

	// Social and creative turns are direct conversational projections, not
	// agentic tool-loop fallbacks. Task execution below has a single Floret path.
	if intent == RunIntentSocial {
		return r.runNativeSocial(ctx, adapter, providerCfg, providerType, modelName, mode, req)
	}
	if intent == RunIntentCreative {
		return r.runNativeCreative(ctx, adapter, providerCfg, providerType, modelName, mode, req)
	}

	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		return r.failRun("Failed to initialize tool registry", err)
	}
	protocolProfile := resolveRunProtocolProfile(capability)
	r.persistRunEvent("protocol.profile.resolved", RealtimeStreamKindLifecycle, protocolProfile.eventPayload())
	modeFilter := newModeToolFilter(r.cfg, protocolProfile, !r.noUserInteraction)
	if len(r.toolAllowlist) > 0 {
		allow := make(map[string]struct{}, len(r.toolAllowlist))
		for name := range r.toolAllowlist {
			if name = strings.TrimSpace(name); name != "" {
				allow[name] = struct{}{}
			}
		}
		modeFilter = allowlistModeToolFilter{base: modeFilter, allowlist: allow}
	}
	activeTools := modeFilter.FilterToolsForMode(mode, registry.Snapshot())
	capabilityContract := resolveRunCapabilityContract(r, protocolProfile, activeTools, req.ModelCapability.SupportsAskUserQuestionBatches)
	controlTools := floretControlToolsForContract(registry.Snapshot(), capabilityContract)
	r.persistRunEvent("capability.contract.resolved", RealtimeStreamKindLifecycle, capabilityContract.eventPayload())
	r.persistRunEvent("completion.contract", RealtimeStreamKindLifecycle, map[string]any{
		"contract":           completionContractForExecutionContract(executionContract),
		"intent":             intent,
		"execution_contract": executionContract,
	})
	r.ensureSkillManager()

	if strings.TrimSpace(req.ContextPack.Objective) != "" {
		taskObjective = strings.TrimSpace(req.ContextPack.Objective)
	}
	state := newRuntimeState(taskObjective)
	state.ExecutionContract = executionContract
	state.TodoPolicy = normalizeTodoPolicy(req.Options.TodoPolicy)
	state.MinimumTodoItems = normalizeMinimumTodoItems(state.TodoPolicy, req.Options.MinimumTodoItems)
	state.InteractionContract = normalizeInteractionContract(req.InteractionContract)
	if source, hydrated := r.hydrateTodoRuntimeState(ctx, &state, req.ContextPack); hydrated {
		r.persistRunEvent("todo.hydrated", RealtimeStreamKindLifecycle, map[string]any{
			"source":           source,
			"todo_total_count": state.TodoTotalCount,
			"todo_open_count":  state.TodoOpenCount,
			"todo_in_progress": state.TodoInProgressCount,
			"todo_version":     state.TodoSnapshotVersion,
		})
	}
	sharedState := newFloretToolRuntimeState(state)

	history := flowerMessagesToFloret(buildMessagesForRun(req))
	resumeHistory := flowerMessagesToFloret(buildResumeMessagesForRun(req))
	resumeState, previousState := r.loadFloretPreviousProviderState(ctx, providerCfg, providerType, modelName)
	_ = resumeState

	contextWindow := nativeDefaultContextLimit
	if req.ModelCapability.MaxContextTokens > 0 {
		contextWindow = req.ModelCapability.MaxContextTokens
	}
	inputContextLimit := resolveInputContextLimit(contextWindow, req.Options.MaxInputTokens)
	systemPrompt := r.buildLayeredSystemPrompt(taskObjective, mode, taskComplexity, 0, maxSteps, true, activeTools, state, "", capabilityContract)
	flTools, err := buildFloretToolRegistry(r, activeTools, sharedState)
	if err != nil {
		return r.failRun("Failed to initialize Floret tool registry", err)
	}
	flProvider := newFloretProviderAdapter(
		adapter,
		providerType,
		modelName,
		mode,
		ProviderControls{
			ThinkingBudgetTokens: req.Options.ThinkingBudgetTokens,
			CacheControl:         req.Options.CacheControl,
			ResponseFormat:       req.Options.ResponseFormat,
			Temperature:          req.Options.Temperature,
			TopP:                 req.Options.TopP,
		},
		TurnBudgets{
			MaxSteps:       maxSteps,
			MaxInputTokens: req.Options.MaxInputTokens,
			MaxOutputToken: req.Options.MaxOutputTokens,
			MaxCostUSD:     req.Options.MaxCostUSD,
		},
		r.webSearchMode,
		resumeHistory,
		previousState,
		func(sources []SourceRef) {
			for _, src := range sources {
				r.addWebSource(src.Title, src.URL)
			}
		},
	)
	completionPolicy := flengine.CompletionExplicitSignal
	if completionContractForExecutionContract(executionContract) == completionContractFirstTurn {
		completionPolicy = flengine.CompletionNaturalStop
	}
	engineOptions := flengine.Options{
		RunID:                  strings.TrimSpace(r.id),
		SessionID:              strings.TrimSpace(r.threadID),
		TraceID:                strings.TrimSpace(r.id),
		ProviderName:           providerType,
		Model:                  modelName,
		Labels:                 flengine.RunLabels{Correlation: map[string]string{"thread_id": strings.TrimSpace(r.threadID), "message_id": strings.TrimSpace(r.messageID)}, Host: map[string]string{"endpoint_id": strings.TrimSpace(r.endpointID), "engine": "redeven"}},
		ContextPolicy:          floretContextPolicy(contextWindow, inputContextLimit, req.Options.MaxOutputTokens),
		CompletionPolicy:       completionPolicy,
		ControlSpec:            newFloretControlSpec(r, sharedState, controlTools, taskComplexity, mode),
		PreviousProviderState:  previousState,
		MaxToolCalls:           nativeHardMaxSteps,
		MaxTotalTokens:         int64(req.Options.MaxInputTokens + req.Options.MaxOutputTokens),
		MaxCostUSD:             req.Options.MaxCostUSD,
		MaxLengthContinuations: 2,
		NoProgressLimit:        2,
		DuplicateToolLimit:     3,
	}
	if engineOptions.MaxTotalTokens <= 0 {
		engineOptions.MaxTotalTokens = 0
	}
	flEngine, err := flengine.New(flengine.Config{
		Provider:     flProvider,
		Tools:        flTools,
		Store:        flsession.NewMemoryStore(),
		Prompt:       flcache.NewMemoryStore(),
		Artifacts:    flartifact.NewMemoryStore(),
		SystemPrompt: systemPrompt,
		Sink:         floretEventSink{run: r},
		Options:      engineOptions,
	})
	if err != nil {
		return r.failRun("Failed to initialize Floret engine", err)
	}

	r.emitLifecyclePhase("executing", map[string]any{"engine": "floret", "intent": intent})
	if r.finalizeIfContextCanceledWithRuntimeCloseout(ctx, 0, sharedState.snapshot(), taskComplexity, mode, protocolProfile, req.Options.RequireUserConfirmOnTaskComplete) {
		return nil
	}
	result := flEngine.RunTurn(ctx, flengine.RunInput{
		RunID:                 strings.TrimSpace(r.id),
		SessionID:             strings.TrimSpace(r.threadID),
		TraceID:               strings.TrimSpace(r.id),
		Labels:                engineOptions.Labels,
		PreviousProviderState: previousState,
		History:               history,
	})
	r.recordRuntimeTurnUsage(flowerUsageFromFloret(result.Metrics.Usage), estimateFloretHistoryTokens(systemPrompt, history, activeTools))
	r.setProviderContinuationCandidate(buildProviderContinuationCandidate(
		strings.TrimSpace(providerCfg.ID),
		providerType,
		modelName,
		providerCfg.BaseURL,
		floretProviderStateToFlower(result.ProviderState),
	))
	if ctx.Err() != nil && result.Status != flengine.Completed && result.Status != flengine.Waiting {
		if r.finalizeIfContextCanceledWithRuntimeCloseout(ctx, result.Metrics.Steps, sharedState.snapshot(), taskComplexity, mode, protocolProfile, req.Options.RequireUserConfirmOnTaskComplete) {
			return nil
		}
	}
	return r.projectFloretResult(ctx, result, req, sharedState.snapshot(), taskComplexity, mode, protocolProfile)
}

func (r *run) loadFloretPreviousProviderState(ctx context.Context, providerCfg config.AIProvider, providerType string, modelName string) (providerTurnResumeState, *flprovider.State) {
	resumeState, err := r.loadProviderTurnResumeState(ctx, providerCfg, providerType, modelName)
	if err != nil {
		r.persistRunEvent("provider.continuation.load_failed", RealtimeStreamKindLifecycle, map[string]any{
			"provider_type": providerType,
			"error":         sanitizeLogText(err.Error(), 240),
		})
		return providerTurnResumeState{SkipReason: "load_failed"}, nil
	}
	if resumeState.Enabled {
		r.persistRunEvent("provider.continuation.available", RealtimeStreamKindLifecycle, map[string]any{
			"provider_type":        providerType,
			"provider_id":          strings.TrimSpace(providerCfg.ID),
			"model":                modelName,
			"continuation_kind":    providerContinuationKindOpenAIResponses,
			"previous_response_id": resumeState.PreviousResponseID,
			"provider_base_url":    canonicalProviderContinuationBaseURL(providerType, providerCfg.BaseURL),
		})
		return resumeState, &flprovider.State{Kind: providerContinuationKindOpenAIResponses, ID: strings.TrimSpace(resumeState.PreviousResponseID)}
	}
	if strings.TrimSpace(resumeState.SkipReason) != "" {
		r.persistRunEvent("provider.continuation.skipped", RealtimeStreamKindLifecycle, map[string]any{
			"provider_type": providerType,
			"provider_id":   strings.TrimSpace(providerCfg.ID),
			"model":         modelName,
			"reason":        resumeState.SkipReason,
		})
	}
	return resumeState, nil
}

func (r *run) projectFloretResult(ctx context.Context, result flengine.Result, req RunRequest, state runtimeState, complexity string, mode string, profile RunProtocolProfile) error {
	step := result.Metrics.Steps
	if step <= 0 {
		step = 1
	}
	switch result.Status {
	case flengine.Completed:
		if signal := result.ControlSignal; signal != nil && strings.TrimSpace(signal.Name) == "task_complete" {
			resultText := strings.TrimSpace(signal.OutputText)
			if resultText == "" {
				resultText = strings.TrimSpace(anyToString(signal.Payload["result"]))
			}
			for _, ref := range extractStringListFromAny(signal.Payload["evidence_refs"]) {
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
			if r.attemptRuntimeCloseout(step, state, complexity, mode, profile, req.Options.RequireUserConfirmOnTaskComplete, runtimeCloseoutAttempt{
				Source:   runtimeCloseoutAttemptSourceTextOnlyTurn,
				Fallback: resultText,
			}) {
				return nil
			}
			gatePassed, gateReason := evaluateTaskCompletionGate(resultText, state, complexity, mode)
			r.persistRunEvent("completion.attempt", RealtimeStreamKindLifecycle, map[string]any{
				"step_index":          step,
				"attempt":             "task_complete",
				"completion_contract": completionContractForExecutionContract(state.ExecutionContract),
				"gate_passed":         gatePassed,
				"gate_reason":         gateReason,
				"complexity":          complexity,
				"mode":                strings.TrimSpace(mode),
				"engine":              "floret",
			})
			if !gatePassed {
				return r.failRun("Task completion rejected by completion gate", fmt.Errorf("task_complete rejected: %s", gateReason))
			}
			if strings.TrimSpace(resultText) != "" && !r.hasNonEmptyAssistantText() {
				_ = r.appendTextDelta(resultText)
			}
			r.setCanonicalMarkdownCandidate(resultText)
			r.reconcileCanonicalMarkdownMessage(resultText)
			r.emitSourcesToolBlock("task_complete")
			r.setFinalizationReason("task_complete")
			r.setEndReason("complete")
			r.emitLifecyclePhase("ended", map[string]any{"reason": "task_complete", "step_index": step})
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
			return nil
		}
		if r.attemptRuntimeCloseout(step, state, complexity, mode, profile, req.Options.RequireUserConfirmOnTaskComplete, runtimeCloseoutAttempt{
			Source:   runtimeCloseoutAttemptSourceTextOnlyTurn,
			Fallback: result.Output,
		}) {
			return nil
		}
		if completionContractForExecutionContract(state.ExecutionContract) == completionContractFirstTurn && strings.TrimSpace(result.Output) != "" {
			if !r.hasNonEmptyAssistantText() {
				_ = r.appendTextDelta(strings.TrimSpace(result.Output))
			}
			r.setCanonicalMarkdownCandidate(result.Output)
			r.reconcileCanonicalMarkdownMessage(result.Output)
			r.setFinalizationReason("hybrid_first_turn_reply")
			r.setEndReason("complete")
			r.emitLifecyclePhase("ended", map[string]any{"reason": "hybrid_first_turn_reply", "step_index": step})
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
			return nil
		}
		return r.projectFloretMissingExplicitCompletion(ctx, step, state)
	case flengine.Waiting:
		if signal := result.ControlSignal; signal != nil {
			switch strings.TrimSpace(signal.Name) {
			case "ask_user":
				return r.projectFloretAskUserWaiting(ctx, step, signal, state)
			case "exit_plan_mode":
				return r.projectFloretExitPlanModeWaiting(ctx, step, signal, state)
			}
		}
		return r.failRun("Run entered waiting state without a supported control signal", errors.New("unsupported waiting control signal"))
	case flengine.Cancelled:
		if r.finalizeIfContextCanceledWithRuntimeCloseout(ctx, step, state, complexity, mode, profile, req.Options.RequireUserConfirmOnTaskComplete) {
			return nil
		}
		if r.finalizeIfContextCanceled(ctx) {
			return nil
		}
		return r.failRun("Floret run was canceled", context.Canceled)
	case flengine.Failed:
		if result.Err == nil {
			result.Err = errors.New("floret engine failed")
		}
		if finishReason := floretFailureFinishReason(result); finishReason != "" {
			r.persistFloretNativeTurnResult(step, result, req.Options.Intent, finishReason)
			return r.failReplyFinish(
				step,
				state.ExecutionContract,
				finishReason,
				floretFailureFinalizationReason(finishReason),
				floretFailureMessage(finishReason),
			)
		}
		return r.failRun("Floret engine failed", result.Err)
	default:
		return r.failRun("Floret engine returned unknown status", fmt.Errorf("unknown floret status %q", result.Status))
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

func floretFailureFinishReason(result flengine.Result) string {
	finishReason := normalizeReplyFinishReason(string(result.FinishReason))
	if finishReason == "unknown" {
		finishReason = normalizeReplyFinishReason(result.RawFinishReason)
	}
	if classifyReplyFinish(finishReason) == replyFinishClassBlocked {
		return finishReason
	}
	if errors.Is(result.Err, flengine.ErrContentFiltered) {
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

func (r *run) persistFloretNativeTurnResult(step int, result flengine.Result, intent string, finishReason string) {
	if r == nil {
		return
	}
	usage := flowerUsageFromFloret(result.Metrics.Usage)
	r.persistRunEvent("native.turn.result", RealtimeStreamKindLifecycle, map[string]any{
		"step_index":    step,
		"finish_reason": normalizeReplyFinishReason(finishReason),
		"tool_calls":    result.Metrics.ToolCalls,
		"usage": map[string]any{
			"input_tokens":     usage.InputTokens,
			"output_tokens":    usage.OutputTokens,
			"reasoning_tokens": usage.ReasoningTokens,
		},
		"engine": "floret",
		"intent": strings.TrimSpace(intent),
	})
}

func (r *run) projectFloretAskUserWaiting(ctx context.Context, step int, signal *flengine.ControlSignal, state runtimeState) error {
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
	closeout, closeoutErr := r.closeOpenTodosBeforeWaitingUser(ctx, step, ask.Question, "model_signal")
	if closeoutErr != nil {
		r.persistRunEvent("todos.closeout.waiting_user_failed", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": step,
			"source":     "model_signal",
			"error":      strings.TrimSpace(closeoutErr.Error()),
		})
		return closeoutErr
	}
	r.emitAskUserToolBlock(ask, "model_signal", state.InteractionContract)
	r.reconcileCanonicalWaitingUserMessage()
	finalReason := finalizationReasonForAskUserSource("model_signal")
	r.persistRunEvent("ask_user.waiting", RealtimeStreamKindLifecycle, map[string]any{
		"question":                     ask.Question,
		"questions_count":              len(ask.Questions),
		"choices_count":                requestUserInputQuestionChoiceCount(ask.Questions),
		"reason_code":                  ask.ReasonCode,
		"required_inputs":              len(ask.RequiredFromUser),
		"evidence_refs":                len(ask.EvidenceRefs),
		"source":                       "model_signal",
		"appended_to_message":          false,
		"finalization_reason":          finalReason,
		"interaction_contract_enabled": normalizeInteractionContract(state.InteractionContract).Enabled,
		"todo_closeout": map[string]any{
			"updated":          closeout.Updated,
			"version_before":   closeout.VersionBefore,
			"version_after":    closeout.VersionAfter,
			"open_before":      closeout.OpenBefore,
			"open_after":       closeout.OpenAfter,
			"total_before":     closeout.TotalBefore,
			"total_after":      closeout.TotalAfter,
			"conflict_retries": closeout.ConflictRetries,
		},
	})
	r.setFinalizationReason(finalReason)
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{"reason": finalReason, "step_index": step})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return nil
}

func (r *run) projectFloretExitPlanModeWaiting(ctx context.Context, step int, signal *flengine.ControlSignal, state runtimeState) error {
	if signal == nil {
		return errors.New("nil exit_plan_mode control signal")
	}
	var args ExitPlanModeArgs
	if raw, ok := signal.Payload["args"].(ExitPlanModeArgs); ok {
		args = raw
	} else {
		args.Summary = strings.TrimSpace(anyToString(signal.Payload["summary"]))
	}
	result, ok := signal.Payload["waiting_prompt"].(*RequestUserInputPrompt)
	if !ok || result == nil {
		return errors.New("exit_plan_mode missing waiting prompt")
	}
	exitResult := ExitPlanModeResult{
		WaitingPrompt: result,
		Summary:       strings.TrimSpace(anyToString(signal.Payload["summary"])),
	}
	question := strings.TrimSpace(exitResult.WaitingPrompt.PublicSummary)
	if question == "" && len(exitResult.WaitingPrompt.Questions) > 0 {
		question = strings.TrimSpace(exitResult.WaitingPrompt.Questions[0].Question)
	}
	closeout, closeoutErr := r.closeOpenTodosBeforeWaitingUser(ctx, step, question, "exit_plan_mode")
	if closeoutErr != nil {
		r.persistRunEvent("todos.closeout.waiting_user_failed", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": step,
			"source":     "exit_plan_mode",
			"error":      strings.TrimSpace(closeoutErr.Error()),
		})
		return closeoutErr
	}
	r.emitExitPlanModeToolBlock(strings.TrimSpace(signal.CallID), args, exitResult)
	r.reconcileCanonicalWaitingUserMessage()
	r.persistRunEvent("exit_plan_mode.waiting", RealtimeStreamKindLifecycle, map[string]any{
		"summary":                      strings.TrimSpace(exitResult.Summary),
		"questions_count":              len(exitResult.WaitingPrompt.Questions),
		"choices_count":                requestUserInputQuestionChoiceCount(exitResult.WaitingPrompt.Questions),
		"source":                       "exit_plan_mode",
		"finalization_reason":          finalizationReasonExitPlanModeWaiting,
		"interaction_contract_enabled": normalizeInteractionContract(state.InteractionContract).Enabled,
		"todo_closeout": map[string]any{
			"updated":          closeout.Updated,
			"version_before":   closeout.VersionBefore,
			"version_after":    closeout.VersionAfter,
			"open_before":      closeout.OpenBefore,
			"open_after":       closeout.OpenAfter,
			"total_before":     closeout.TotalBefore,
			"total_after":      closeout.TotalAfter,
			"conflict_retries": closeout.ConflictRetries,
		},
	})
	r.setFinalizationReason(finalizationReasonExitPlanModeWaiting)
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{"reason": finalizationReasonExitPlanModeWaiting, "step_index": step})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return nil
}

func (r *run) projectFloretMissingExplicitCompletion(ctx context.Context, step int, state runtimeState) error {
	signal := defaultGuardAskUserSignal(
		"I still do not have explicit completion. Please provide missing requirements, or ask me to continue with a specific next action.",
		nil,
		"missing_explicit_completion",
	)
	signal = normalizeAskUserSignal(signal)
	pass, reason := evaluateGuardAskUserGate("missing_explicit_completion", state, TaskComplexityStandard)
	r.persistRunEvent("ask_user.attempt", RealtimeStreamKindLifecycle, map[string]any{
		"step_index":                   step,
		"source":                       "missing_explicit_completion",
		"gate_passed":                  pass,
		"gate_reason":                  reason,
		"question_len":                 len([]rune(strings.TrimSpace(signal.Question))),
		"questions_count":              len(signal.Questions),
		"choices_count":                requestUserInputQuestionChoiceCount(signal.Questions),
		"reason_code":                  signal.ReasonCode,
		"required_inputs_count":        len(signal.RequiredFromUser),
		"evidence_refs_count":          len(signal.EvidenceRefs),
		"validation_mode":              "deterministic_contract_state",
		"todo_tracking":                state.TodoTrackingEnabled,
		"todo_open_count":              state.TodoOpenCount,
		"interaction_contract_enabled": normalizeInteractionContract(state.InteractionContract).Enabled,
	})
	if !pass {
		return r.failRun("Run ended without explicit completion", fmt.Errorf("missing explicit completion: ask_user gate rejected: %s", reason))
	}
	closeout, closeoutErr := r.closeOpenTodosBeforeWaitingUser(ctx, step, signal.Question, "missing_explicit_completion")
	if closeoutErr != nil {
		r.persistRunEvent("todos.closeout.waiting_user_failed", RealtimeStreamKindLifecycle, map[string]any{
			"step_index": step,
			"source":     "missing_explicit_completion",
			"error":      strings.TrimSpace(closeoutErr.Error()),
		})
		return closeoutErr
	}
	r.emitAskUserToolBlock(signal, "missing_explicit_completion", state.InteractionContract)
	r.reconcileCanonicalWaitingUserMessage()
	finalReason := finalizationReasonForAskUserSource("missing_explicit_completion")
	r.persistRunEvent("ask_user.waiting", RealtimeStreamKindLifecycle, map[string]any{
		"question":                     signal.Question,
		"questions_count":              len(signal.Questions),
		"choices_count":                requestUserInputQuestionChoiceCount(signal.Questions),
		"reason_code":                  signal.ReasonCode,
		"required_inputs":              len(signal.RequiredFromUser),
		"evidence_refs":                len(signal.EvidenceRefs),
		"source":                       "missing_explicit_completion",
		"appended_to_message":          false,
		"finalization_reason":          finalReason,
		"interaction_contract_enabled": normalizeInteractionContract(state.InteractionContract).Enabled,
		"todo_closeout": map[string]any{
			"updated":          closeout.Updated,
			"version_before":   closeout.VersionBefore,
			"version_after":    closeout.VersionAfter,
			"open_before":      closeout.OpenBefore,
			"open_after":       closeout.OpenAfter,
			"total_before":     closeout.TotalBefore,
			"total_after":      closeout.TotalAfter,
			"conflict_retries": closeout.ConflictRetries,
		},
	})
	r.setFinalizationReason(finalReason)
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{"reason": finalReason, "step_index": step})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return nil
}

func flowerMessagesToFloret(messages []Message) []flsession.Message {
	out := make([]flsession.Message, 0, len(messages))
	for _, msg := range messages {
		role := flsession.Role(strings.ToLower(strings.TrimSpace(msg.Role)))
		switch role {
		case flsession.System, flsession.User, flsession.Assistant, flsession.Tool:
		default:
			role = flsession.User
		}
		if role == flsession.Tool {
			for _, part := range msg.Content {
				if !strings.EqualFold(strings.TrimSpace(part.Type), "tool_result") {
					continue
				}
				text := strings.TrimSpace(part.Text)
				if text == "" && len(part.JSON) > 0 {
					text = string(part.JSON)
				}
				out = append(out, flsession.Message{
					Role:       flsession.Tool,
					Content:    text,
					ToolCallID: toolCallIDFromPart(part),
					ToolName:   strings.TrimSpace(part.ToolName),
				})
			}
			continue
		}
		if role == flsession.Assistant {
			assistantText := messageTextForFloret(msg, false)
			reasoning := messageReasoningForFloret(msg)
			if strings.TrimSpace(assistantText) != "" || strings.TrimSpace(reasoning) != "" {
				out = append(out, flsession.Message{Role: role, Content: assistantText, Reasoning: reasoning})
			}
			for _, part := range msg.Content {
				if !strings.EqualFold(strings.TrimSpace(part.Type), "tool_call") {
					continue
				}
				args := strings.TrimSpace(part.ArgsJSON)
				if args == "" && len(part.JSON) > 0 {
					args = strings.TrimSpace(string(part.JSON))
				}
				if args == "" {
					args = "{}"
				}
				out = append(out, flsession.Message{
					Role:       flsession.Assistant,
					Content:    "tool_call",
					Reasoning:  reasoning,
					ToolCallID: toolCallIDFromPart(part),
					ToolName:   strings.TrimSpace(part.ToolName),
					ToolArgs:   args,
				})
			}
			continue
		}
		text := messageTextForFloret(msg, true)
		if strings.TrimSpace(text) == "" {
			continue
		}
		out = append(out, flsession.Message{Role: role, Content: text})
	}
	return out
}

func messageTextForFloret(msg Message, includeAttachments bool) string {
	parts := make([]string, 0, len(msg.Content))
	for _, part := range msg.Content {
		switch strings.ToLower(strings.TrimSpace(part.Type)) {
		case "text":
			if txt := strings.TrimSpace(part.Text); txt != "" {
				parts = append(parts, txt)
			}
		case "file", "image":
			if !includeAttachments {
				continue
			}
			label := strings.TrimSpace(part.Text)
			if label == "" {
				label = strings.TrimSpace(part.FileURI)
			}
			if label != "" {
				parts = append(parts, "Attachment: "+label)
			}
		}
	}
	return strings.Join(parts, "\n\n")
}

func messageReasoningForFloret(msg Message) string {
	parts := make([]string, 0, 1)
	for _, part := range msg.Content {
		if strings.EqualFold(strings.TrimSpace(part.Type), "reasoning") && strings.TrimSpace(part.Text) != "" {
			parts = append(parts, strings.TrimSpace(part.Text))
		}
	}
	return strings.Join(parts, "\n\n")
}

func floretContextPolicy(contextWindow int, inputLimit int, maxOutput int) flcontextpolicy.Policy {
	if contextWindow <= 0 {
		contextWindow = nativeDefaultContextLimit
	}
	if inputLimit <= 0 {
		inputLimit = resolveInputContextLimit(contextWindow, 0)
	}
	threshold := int64(inputLimit)
	if threshold <= 0 {
		threshold = int64(contextWindow)
	}
	return flcontextpolicy.Normalize(flcontextpolicy.Policy{
		ContextWindowTokens:   int64(contextWindow),
		MaxOutputTokens:       int64(maxOutput),
		ReservedOutputTokens:  int64(maxOutput),
		RecentTailTokens:      threshold,
		RecentUserTokens:      threshold / 2,
		MaxCompactionFailures: 2,
	})
}

func estimateFloretHistoryTokens(systemPrompt string, history []flsession.Message, tools []ToolDef) int {
	total := utf8.RuneCountInString(systemPrompt) / 4
	for _, msg := range history {
		total += utf8.RuneCountInString(msg.Content) / 4
		total += utf8.RuneCountInString(msg.Reasoning) / 4
		total += utf8.RuneCountInString(msg.ToolArgs) / 4
	}
	for _, tool := range tools {
		total += utf8.RuneCountInString(tool.Name) / 4
		total += utf8.RuneCountInString(tool.Description) / 4
		total += len(tool.InputSchema) / 4
	}
	if total <= 0 {
		return 1
	}
	return total
}
