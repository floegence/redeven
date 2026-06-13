package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	flconfig "github.com/floegence/floret/config"
	flruntime "github.com/floegence/floret/runtime"
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
	taskComplexity := TaskComplexityStandard

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
		"engine":        "floret",
		"provider_type": providerType,
		"model":         modelName,
		"max_steps":     maxSteps,
		"mode":          mode,
	})

	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		return r.failRun("Failed to initialize tool registry", err)
	}
	modeFilter := newModeToolFilter(r.cfg, !r.noUserInteraction)
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
	capabilityContract := resolveRunCapabilityContract(r, activeTools, req.ModelCapability.SupportsAskUserQuestionBatches)
	controlTools := floretControlToolsForContract(registry.Snapshot(), capabilityContract)
	r.persistRunEvent("capability.contract.resolved", RealtimeStreamKindLifecycle, capabilityContract.eventPayload())
	r.ensureSkillManager()

	if strings.TrimSpace(req.ContextPack.Objective) != "" {
		taskObjective = strings.TrimSpace(req.ContextPack.Objective)
	}
	state := newRuntimeState(taskObjective)
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

	history, err := flowerMessagesToFloret(buildMessagesForRun(req))
	if err != nil {
		return r.failRun("Failed to project Floret transcript", err)
	}
	resumeHistory, err := flowerMessagesToFloret(buildResumeMessagesForRun(req))
	if err != nil {
		return r.failRun("Failed to project Floret resume transcript", err)
	}
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
		func(sources []SourceRef) {
			for _, src := range sources {
				r.addWebSource(src.Title, src.URL)
			}
		},
	)
	flProvider.bindStreamRun(r)
	completionPolicy := flruntime.TurnCompletionNaturalStop
	hostLabels := floretHostLabelsForRun(r)
	controlSpec, err := newFloretControlSpec(r, sharedState, controlTools, taskComplexity, mode)
	if err != nil {
		return r.failRun("Failed to initialize Floret control tools", err)
	}
	labels := flruntime.RunLabels{Correlation: map[string]string{"thread_id": strings.TrimSpace(r.threadID), "message_id": strings.TrimSpace(r.messageID)}, Host: hostLabels}
	maxTotalTokens := int64(req.Options.MaxInputTokens + req.Options.MaxOutputTokens)
	if maxTotalTokens <= 0 {
		maxTotalTokens = 0
	}
	floretProvider, err := floretProviderName(providerType)
	if err != nil {
		return r.failRun("Unsupported Floret provider type", err)
	}
	floretCfg := flconfig.Config{
		Provider:      floretProvider,
		Model:         modelName,
		BaseURL:       strings.TrimSpace(providerCfg.BaseURL),
		APIKey:        strings.TrimSpace(apiKey),
		SystemPrompt:  systemPrompt,
		ContextPolicy: floretContextPolicy(contextWindow, inputContextLimit, req.Options.MaxOutputTokens),
	}
	if floretCfg.Provider == flconfig.ProviderOpenAICompatible && floretCfg.BaseURL == "" {
		floretCfg.BaseURL = "http://model-gateway.invalid"
	}
	if floretProviderRequiresAPIKey(floretCfg.Provider) && floretCfg.APIKey == "" {
		floretCfg.APIKey = "model-gateway"
	}

	r.emitLifecyclePhase("executing", map[string]any{"engine": "floret"})
	result, err := flruntime.RunProjectedTurn(ctx, flruntime.ProjectedTurnOptions{
		Config:       floretCfg,
		ModelGateway: flProvider,
		Tools:        flTools,
		Sink:         floretEventSink{run: r},
		LoopLimits: flruntime.LoopLimits{
			NoProgressLimit:    2,
			DuplicateToolLimit: 3,
		},
	}, flruntime.ProjectedTurnRequest{
		RunID:                 flruntime.RunID(strings.TrimSpace(r.id)),
		ThreadID:              flruntime.ThreadID(strings.TrimSpace(r.threadID)),
		TurnID:                flruntime.TurnID(strings.TrimSpace(r.messageID)),
		TraceID:               flruntime.TraceID(strings.TrimSpace(r.id)),
		PromptScopeID:         flruntime.PromptScopeID(strings.TrimSpace(r.threadID)),
		History:               history,
		Labels:                labels,
		PreviousProviderState: previousState,
		Completion:            completionPolicy,
		Signals:               controlSpec,
		Limits: flruntime.TurnLimits{
			MaxToolCalls:           nativeHardMaxSteps,
			MaxTotalTokens:         maxTotalTokens,
			MaxCostUSD:             req.Options.MaxCostUSD,
			MaxLengthContinuations: 2,
		},
	})
	if err != nil && result.Status == "" {
		return r.failRun("Failed to run Floret projected turn", err)
	}
	r.publishActivityTimeline(result.ActivityTimeline)
	r.recordRuntimeTurnUsage(flowerUsageFromFloret(result.Metrics.ProviderUsage), estimateFloretHistoryTokens(systemPrompt, history, activeTools))
	providerState := flProvider.currentProviderState()
	r.setProviderContinuationCandidate(buildProviderContinuationCandidate(
		strings.TrimSpace(providerCfg.ID),
		providerType,
		modelName,
		providerCfg.BaseURL,
		floretProviderStateToFlower(providerState),
	))
	if ctx.Err() != nil && result.Status != flruntime.TurnStatusCompleted && result.Status != flruntime.TurnStatusWaiting {
		return r.failRun("Floret run was canceled", ctx.Err())
	}
	return r.projectFloretResult(ctx, result, req, sharedState.snapshot(), taskComplexity, mode)
}

func (r *run) loadFloretPreviousProviderState(ctx context.Context, providerCfg config.AIProvider, providerType string, modelName string) (providerTurnResumeState, *flruntime.ModelState) {
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
		return resumeState, &flruntime.ModelState{Kind: providerContinuationKindOpenAIResponses, ID: strings.TrimSpace(resumeState.PreviousResponseID)}
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

func (r *run) projectFloretResult(ctx context.Context, result flruntime.ProjectedTurnResult, req RunRequest, state runtimeState, complexity string, mode string) error {
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
			gatePassed, gateReason := evaluateTaskCompletionGate(resultText, state, complexity, mode)
			r.persistRunEvent("completion.attempt", RealtimeStreamKindLifecycle, map[string]any{
				"step_index":  step,
				"attempt":     "task_complete",
				"gate_passed": gatePassed,
				"gate_reason": gateReason,
				"complexity":  complexity,
				"mode":        strings.TrimSpace(mode),
				"engine":      "floret",
			})
			if !gatePassed {
				return r.failRun("Task completion rejected by completion gate", fmt.Errorf("task_complete rejected: %s", gateReason))
			}
			if strings.TrimSpace(resultText) != "" && !r.hasNonEmptyAssistantText() {
				_ = r.appendTextDelta(resultText)
			}
			r.setCanonicalMarkdownCandidate(resultText)
			r.reconcileCanonicalMarkdownMessage(resultText)
			r.recordTaskCompleteSignal(strings.TrimSpace(signal.CallID), resultText, evidenceRefs)
			r.recordSourcesActivity("task_complete")
			r.setFinalizationReason("task_complete")
			r.setEndReason("complete")
			r.emitLifecyclePhase("ended", map[string]any{"reason": "task_complete", "step_index": step})
			r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
			return nil
		}
		if strings.TrimSpace(result.Output) != "" && !r.hasNonEmptyAssistantText() {
			_ = r.appendTextDelta(strings.TrimSpace(result.Output))
		}
		r.setCanonicalMarkdownCandidate(result.Output)
		r.reconcileCanonicalMarkdownMessage(result.Output)
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
			case "exit_plan_mode":
				return r.projectFloretExitPlanModeWaiting(step, signal)
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
			resultErr = errors.New("floret projected turn failed")
		}
		if finishReason := floretFailureFinishReason(result); finishReason != "" {
			r.persistFloretNativeTurnResult(step, result, finishReason)
			return r.failReplyFinish(step, finishReason, floretFailureFinalizationReason(finishReason), floretFailureMessage(finishReason))
		}
		return r.failRun("Floret projected turn failed", resultErr)
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

func floretProviderName(providerType string) (string, error) {
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	providerType = strings.ReplaceAll(providerType, "_", "-")
	switch providerType {
	case "openai", "anthropic", "moonshot", "chatglm", "deepseek", "qwen":
		return providerType, nil
	case "openai-compatible", "desktop-model-source":
		return flconfig.ProviderOpenAICompatible, nil
	default:
		return "", fmt.Errorf("unsupported provider type %q", providerType)
	}
}

func floretProviderRequiresAPIKey(providerName string) bool {
	switch strings.TrimSpace(providerName) {
	case flconfig.ProviderFake:
		return false
	default:
		return true
	}
}

func floretFailureFinishReason(result flruntime.ProjectedTurnResult) string {
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

func (r *run) persistFloretNativeTurnResult(step int, result flruntime.ProjectedTurnResult, finishReason string) {
	if r == nil {
		return
	}
	usage := flowerUsageFromFloret(result.Metrics.ProviderUsage)
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
	})
}

func (r *run) projectFloretAskUserWaiting(step int, signal *flruntime.TurnSignal) error {
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
	r.recordAskUserWaitingSignal(ask, "model_signal")
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

func (r *run) projectFloretExitPlanModeWaiting(step int, signal *flruntime.TurnSignal) error {
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
	result = normalizeRequestUserInputPrompt(result)
	if result == nil || strings.TrimSpace(result.ToolName) != "exit_plan_mode" {
		return errors.New("exit_plan_mode waiting prompt has invalid tool identity")
	}
	exitResult := ExitPlanModeResult{
		WaitingPrompt: result,
		Summary:       strings.TrimSpace(anyToString(signal.Payload["summary"])),
	}
	r.recordExitPlanModeWaitingSignal(strings.TrimSpace(signal.CallID), args, exitResult)
	r.reconcileCanonicalWaitingUserMessage()
	r.persistRunEvent("exit_plan_mode.waiting", RealtimeStreamKindLifecycle, map[string]any{
		"summary":             strings.TrimSpace(exitResult.Summary),
		"questions_count":     len(exitResult.WaitingPrompt.Questions),
		"choices_count":       requestUserInputQuestionChoiceCount(exitResult.WaitingPrompt.Questions),
		"source":              "exit_plan_mode",
		"finalization_reason": finalizationReasonExitPlanModeWaiting,
	})
	r.setFinalizationReason(finalizationReasonExitPlanModeWaiting)
	r.setEndReason("complete")
	r.emitLifecyclePhase("ended", map[string]any{"reason": finalizationReasonExitPlanModeWaiting, "step_index": step})
	r.sendStreamEvent(streamEventMessageEnd{Type: "message-end", MessageID: r.messageID})
	return nil
}

func flowerMessagesToFloret(messages []Message) ([]flruntime.TranscriptMessage, error) {
	out := make([]flruntime.TranscriptMessage, 0, len(messages))
	for i, msg := range messages {
		role := strings.ToLower(strings.TrimSpace(msg.Role))
		switch role {
		case "user", "assistant", "tool":
		case "system":
			continue
		default:
			return nil, fmt.Errorf("message %d has unsupported role %q", i, msg.Role)
		}
		if role == "tool" {
			for _, part := range msg.Content {
				if !strings.EqualFold(strings.TrimSpace(part.Type), "tool_result") {
					continue
				}
				text := strings.TrimSpace(part.Text)
				if text == "" && len(part.JSON) > 0 {
					text = string(part.JSON)
				}
				out = append(out, flruntime.TranscriptMessage{
					Role:       "tool",
					Content:    text,
					ToolCallID: toolCallIDFromPart(part),
					ToolName:   strings.TrimSpace(part.ToolName),
				})
			}
			continue
		}
		if role == "assistant" {
			assistantText := messageTextForFloret(msg, false)
			reasoning := messageReasoningForFloret(msg)
			if strings.TrimSpace(assistantText) != "" || strings.TrimSpace(reasoning) != "" {
				out = append(out, flruntime.TranscriptMessage{Role: role, Content: assistantText, Reasoning: reasoning})
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
				out = append(out, flruntime.TranscriptMessage{
					Role:       "assistant",
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
		out = append(out, flruntime.TranscriptMessage{Role: role, Content: text})
	}
	return out, nil
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

func floretContextPolicy(contextWindow int, inputLimit int, maxOutput int) flconfig.ContextPolicy {
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
	return flconfig.ContextPolicy{
		ContextWindowTokens:   int64(contextWindow),
		MaxOutputTokens:       int64(maxOutput),
		ReservedOutputTokens:  int64(maxOutput),
		RecentTailTokens:      threshold,
		RecentUserTokens:      threshold / 2,
		MaxCompactionFailures: 2,
	}
}

func estimateFloretHistoryTokens(systemPrompt string, history []flruntime.TranscriptMessage, tools []ToolDef) int {
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
