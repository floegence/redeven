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

	flconfig "github.com/floegence/floret/v7/config"
	flprovider "github.com/floegence/floret/v7/provider"
	flruntime "github.com/floegence/floret/v7/runtime"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/config"
)

func (r *run) prepareFloretHostedAgent(ctx context.Context, req RunRequest, providerCfg config.AIProvider, apiKey string, adapterOverride ...ModelGateway) (*flruntime.Agent, error) {
	if r == nil {
		return nil, errors.New("nil run")
	}
	providerType := strings.ToLower(strings.TrimSpace(providerCfg.Type))
	_, modelName, ok := strings.Cut(strings.TrimSpace(req.Model), "/")
	if !ok {
		modelName = strings.TrimSpace(req.Model)
	}
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return nil, r.failRun("Invalid model id", fmt.Errorf("invalid model id %q", strings.TrimSpace(req.Model)))
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

	var adapter ModelGateway
	if len(adapterOverride) > 0 && adapterOverride[0] != nil {
		adapter = adapterOverride[0]
	} else {
		var err error
		adapter, err = newProviderAdapter(providerType, strings.TrimSpace(providerCfg.BaseURL), strings.TrimSpace(apiKey), providerCfg.StrictToolSchema)
		if err != nil {
			return nil, r.failRun("Failed to initialize provider adapter", err)
		}
	}

	webSearchCapability := resolveProviderWebSearchCapability(providerCfg, modelName)
	if enableFlowerWebSearchTool(providerCfg, webSearchCapability) {
		webSearchCapability.RegisterTool = true
	}
	r.webSearchMode = webSearchCapability.Mode
	r.webSearchToolEnabled = webSearchCapability.RegisterTool
	r.attachmentToolReadEnabled = req.ModelCapability.SupportsTools && r.host.openLiveAttachment != nil
	r.recordRunDiagnostic("web_search.config", RealtimeStreamKindLifecycle, map[string]any{
		"resolved":          webSearchCapability.Mode,
		"reason":            webSearchCapability.Reason,
		"web_search_tool":   webSearchCapability.RegisterTool,
		"provider_type":     providerType,
		"provider_base_url": strings.TrimSpace(providerCfg.BaseURL),
		"model":             modelName,
	})
	sharedState := newFloretToolRuntimeState(newTodoRuntimeState())
	r.toolRuntimeState = sharedState
	r.ensureSkillManager()

	contextWindow := modelGatewayDefaultContextWindowTokens
	if req.ModelCapability.MaxContextTokens > 0 {
		contextWindow = req.ModelCapability.MaxContextTokens
	}
	hostLabels := floretHostLabelsForRun(r)
	surfaceConfig := r.buildRunToolSurfaceConfig(req.ModelCapability.SupportsAskUserQuestionBatches, sharedState, hostLabels)
	r.effectPermissionSurfaceConfig = surfaceConfig
	initialSurface, err := r.buildRunToolSurface(ctx, surfaceConfig)
	if err != nil {
		return nil, r.failRun("Failed to initialize run tool surface", err)
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
		withFloretAttachmentToolRead(r.attachmentToolReadEnabled),
		withFloretRequestAdmission(r.admitFloretProviderRequest),
	)
	labels := flruntime.RunLabels{Correlation: map[string]string{
		"thread_id":  strings.TrimSpace(r.threadID),
		"turn_id":    strings.TrimSpace(r.turnID),
		"message_id": strings.TrimSpace(r.messageID),
	}, Host: initialSurface.HostContext}
	gatewayIdentity, err := redevenFloretGatewayIdentity(providerCfg.ID, providerType, providerCfg.BaseURL, capability.WireModelName, flProvider.stateCompatibilityRoute())
	if err != nil {
		return nil, r.failRun("Failed to initialize Floret model identity", err)
	}
	var frozenAttachments map[string]frozenFloretAttachment
	if req.Retry == nil {
		contextProjection, err := floretContextProjectionForInputWithAuthority(req.Input, r.canonicalReferenceAuthority)
		if err != nil {
			return nil, r.failRun("Failed to prepare linked context", err)
		}
		turnInput, err := r.floretTurnInput(ctx, req.Input, contextProjection.References)
		if err != nil {
			return nil, r.failRun("Failed to prepare message attachments", err)
		}
		_, frozenAttachments, err = r.preflightFloretTurnAttachments(ctx, turnInput, flProvider)
		if err != nil {
			return nil, r.failRun("Failed to validate message attachments", err)
		}
	}
	attachmentResolver := r.floretAttachmentResolver(frozenAttachments, flProvider)
	flProvider.attachmentResolver = func(ctx context.Context, attachment flprovider.Attachment) (ContentPart, error) {
		return attachmentResolver(ctx, runtimeAttachmentFromProvider(attachment))
	}
	flProvider.identity = gatewayIdentity
	agent, err := buildFloretThreadAgent(
		r,
		initialSurface,
		labels,
		floretModelContextPolicy(contextWindow, req.Options.MaxOutputTokens, req.ModelCapability.MaxOutputTokens),
		req.Options,
		flProvider,
		flowerManualCompactionSource(req.Input, r.executionKey),
	)
	if err != nil {
		return nil, r.failRun("Failed to initialize Floret host", err)
	}
	return agent, nil
}

// buildFloretThreadAgent is the Redeven effect adapter boundary. It assembles
// provider, tools, authorization and observation capabilities; it does not
// admit a turn, register a run, wait for a receipt, or publish a projection.
// ThreadRuntime owns those lifecycle decisions after this function returns.
func buildFloretThreadAgent(
	r *run,
	surface runToolSurface,
	labels flruntime.RunLabels,
	contextPolicy flconfig.ContextPolicy,
	options RunOptions,
	provider *floretProviderAdapter,
	manualCompactions flruntime.ManualCompactionSource,
) (*flruntime.Agent, error) {
	if r == nil || provider == nil {
		return nil, errors.New("floret effect adapter requires a run and provider")
	}
	agentOptions := []flruntime.AgentOption{
		flruntime.WithAgentTools(surface.FloretToolItems...),
		flruntime.WithAgentRunLabels(labels),
		flruntime.WithAgentEffectAuthorization(floretEffectAuthorizationGateForRun(r)),
		flruntime.WithAgentEventSink(floretEventSink{run: r}),
		flruntime.WithAgentThreadTitleMode(flruntime.ThreadTitleModeProvider),
		flruntime.WithAgentLoopLimits(flruntime.LoopLimits{NoProgressLimit: 2, DuplicateToolLimit: 3}),
	}
	if provider.providerType == "deepseek" && provider.webSearch == providerWebSearchModeDeepSeekNative {
		agentOptions = append(agentOptions, flruntime.WithAgentHostedTools(flprovider.HostedToolDefinition{Name: "web_search", Type: "web_search"}))
	}
	if manualCompactions != nil {
		agentOptions = append(agentOptions, flruntime.WithAgentManualCompactions(manualCompactions))
	}
	return flruntime.NewAgent(
		redevenFloretAgentConfig(surface.SystemPrompt, contextPolicy, options.ReasoningSelection),
		provider,
		agentOptions...,
	)
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

func redevenFloretAgentConfig(systemPrompt string, contextPolicy flconfig.ContextPolicy, reasoning config.AIReasoningSelection) flconfig.AgentConfig {
	return flconfig.AgentConfig{
		Profile:      flconfig.AgentProfile{ID: "redeven-flower", Name: "Flower"},
		SystemPrompt: systemPrompt,
		Context:      contextPolicy,
		Reasoning:    reasoning,
	}
}

func redevenFloretGatewayIdentity(providerID string, providerType string, baseURL string, modelName string, route string) (flprovider.Identity, error) {
	providerID = strings.TrimSpace(providerID)
	providerType = strings.ToLower(strings.TrimSpace(providerType))
	modelName = strings.TrimSpace(modelName)
	route = strings.TrimSpace(route)
	if providerID == "" || providerType == "" || modelName == "" || route == "" {
		return flprovider.Identity{}, errors.New("floret model gateway identity requires provider, type, model, and route")
	}
	endpoint, err := normalizedFloretGatewayBaseURL(baseURL)
	if err != nil {
		return flprovider.Identity{}, err
	}
	digest := sha256.Sum256([]byte(strings.Join([]string{providerID, providerType, endpoint, modelName, route}, "\x00")))
	return flprovider.Identity{
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

func floretModelContextPolicy(contextWindow int, requestedMaxOutput int, capabilityMaxOutput int) flconfig.ContextPolicy {
	if contextWindow <= 0 {
		contextWindow = modelGatewayDefaultContextWindowTokens
	}
	maxOutput := requestedMaxOutput
	if maxOutput <= 0 {
		maxOutput = capabilityMaxOutput
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
