package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	flconfig "github.com/floegence/floret/config"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	fltools "github.com/floegence/floret/tools"
	contextmodel "github.com/floegence/redeven/internal/ai/context/model"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/websearch"
)

const (
	subagentStatusQueued    = "queued"
	subagentStatusRunning   = "running"
	subagentStatusWaiting   = "waiting_input"
	subagentStatusCompleted = "completed"
	subagentStatusFailed    = "failed"
	subagentStatusCanceled  = "canceled"
	subagentStatusTimedOut  = "timed_out"

	subagentAgentTypeExplore  = "explore"
	subagentAgentTypeWorker   = "worker"
	subagentAgentTypeReviewer = "reviewer"

	subagentActionSpawn     = "spawn"
	subagentActionWait      = "wait"
	subagentActionList      = "list"
	subagentActionInspect   = "inspect"
	subagentActionSendInput = "send_input"
	subagentActionClose     = "close"
	subagentActionCloseAll  = "close_all"

	subagentContextModeMissionOnly = "mission_only"
	subagentContextModeFullHistory = "full_history"

	subagentDefaultTimeoutMS = 300_000
	subagentMaxTimeoutMS     = 1_200_000
	subagentRunTimeout       = 20 * time.Minute

	subagentModelItemTargetBytes = 2 * 1024
	subagentModelItemHardBytes   = 4 * 1024
	subagentToolResultHardBytes  = 20 * 1024
)

type subagentRuntime interface {
	manage(context.Context, string, map[string]any) (map[string]any, error)
	release()
	snapshots(context.Context) ([]subagentSnapshot, error)
}

type subagentCapabilityContract struct {
	VisibleTools          []string
	HiddenControlTools    []string
	HiddenToolSet         map[string]struct{}
	AllowSpawnSubagents   bool
	AllowUserApproval     bool
	AllowUserInput        bool
	ForkMode              flruntime.SubAgentForkMode
	FinalHandoffBudget    int
	ProgressSummaryBudget int
}

type subagentFinalHandoffReport struct {
	Summary                string                      `json:"summary,omitempty"`
	Reports                []subagentHandoffReportItem `json:"reports,omitempty"`
	Evidence               []string                    `json:"evidence,omitempty"`
	ChangedFiles           []string                    `json:"changed_files,omitempty"`
	Verification           []string                    `json:"verification,omitempty"`
	OpenRisks              []string                    `json:"open_risks,omitempty"`
	SuggestedParentActions []string                    `json:"suggested_parent_actions,omitempty"`
}

type subagentProgressSummary struct {
	Summary                string                        `json:"summary,omitempty"`
	Items                  []subagentProgressSummaryItem `json:"items,omitempty"`
	CurrentState           string                        `json:"current_state,omitempty"`
	Blockers               []string                      `json:"blockers,omitempty"`
	NextExpectedStep       string                        `json:"next_expected_step,omitempty"`
	SuggestedParentActions []string                      `json:"suggested_parent_actions,omitempty"`
}

type subagentHandoffReportItem struct {
	ThreadID  string `json:"thread_id,omitempty"`
	TaskName  string `json:"task_name,omitempty"`
	AgentType string `json:"agent_type,omitempty"`
	Status    string `json:"status,omitempty"`
	Handoff   string `json:"handoff,omitempty"`
}

type subagentProgressSummaryItem struct {
	ThreadID      string `json:"thread_id,omitempty"`
	TaskName      string `json:"task_name,omitempty"`
	AgentType     string `json:"agent_type,omitempty"`
	Status        string `json:"status,omitempty"`
	CurrentSignal string `json:"current_signal,omitempty"`
}

type subagentSnapshot struct {
	ThreadID        string
	Path            string
	TaskName        string
	TaskDescription string
	ParentThreadID  string
	ParentTurnID    string
	AgentType       string
	ContextMode     string
	Status          string
	LatestTurnID    string
	LastMessage     string
	WaitingPrompt   string
	QueuedInputs    int
	CreatedAtMS     int64
	UpdatedAtMS     int64
	Closed          bool
	CanSendInput    bool
	CanInterrupt    bool
	CanClose        bool
}

type floretSubagentRuntime struct {
	muParent                   sync.Mutex
	parent                     *run
	resolveExactChildExecution func(context.Context, string, string) (subagentExecutionCapabilities, error)

	mu                   sync.Mutex
	host                 floretSubagentHost
	hostKey              string
	closed               bool
	subagentsPatchQueued map[string]struct{}
}

type subagentExecutionCapabilities struct {
	host    runHostCapabilities
	product runProductCapabilities
}

// floretSubagentExecutionOwner is retained only by the validated resolver
// closure installed in a runtime. The runtime exposed to a run contains no raw
// arbitrary-child binder: every requested child must pass canonical membership
// and finalized product-audit validation before this owner binds exact
// execution capabilities.
type floretSubagentExecutionOwner struct {
	runtime *floretSubagentRuntime
	bind    func(*run, string, string) (subagentExecutionCapabilities, error)
}

type resolvedSubagentRunModel struct {
	RunModel        resolvedRunModel
	Capability      contextmodel.ModelCapability
	ProviderType    string
	ModelName       string
	WireModelName   string
	AdapterOverride ModelGateway
	APIKey          string
}

func newFloretSubagentRuntime(parent *run) *floretSubagentRuntime {
	runtime := &floretSubagentRuntime{}
	runtime.attachParentRun(parent)
	return runtime
}

func newFloretSubagentRuntimeWithExecutionOwner(parent *run, bind func(*run, string, string) (subagentExecutionCapabilities, error)) *floretSubagentRuntime {
	runtime := newFloretSubagentRuntime(parent)
	owner := &floretSubagentExecutionOwner{runtime: runtime, bind: bind}
	runtime.resolveExactChildExecution = owner.resolve
	return runtime
}

func (s *floretSubagentRuntime) attachParentRun(parent *run) {
	if s == nil || parent == nil {
		return
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	s.muParent.Lock()
	s.parent = parent
	s.muParent.Unlock()
}

func (s *floretSubagentRuntime) parentRun() *run {
	if s == nil {
		return nil
	}
	s.muParent.Lock()
	parent := s.parent
	s.muParent.Unlock()
	return parent
}

func (s *floretSubagentRuntime) manage(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	toolCallID = strings.TrimSpace(toolCallID)
	if toolCallID == "" {
		generated, err := newToolID()
		if err != nil {
			return nil, err
		}
		toolCallID = generated
	}
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	if action == "" {
		return nil, fmt.Errorf("missing action")
	}
	parent.recordRunDiagnostic("delegation.manage.begin", RealtimeStreamKindLifecycle, map[string]any{
		"action":             action,
		"tool_call_id":       toolCallID,
		"provided_keys":      subagentValidationProvidedKeys(args),
		"contract_call_type": "subagents",
	})
	var (
		out map[string]any
		err error
	)
	switch action {
	case subagentActionSpawn:
		out, err = s.spawn(ctx, toolCallID, args)
	case subagentActionWait:
		out, err = s.wait(ctx, toolCallID, args)
	case subagentActionList:
		out, err = s.list(ctx, toolCallID, args)
	case subagentActionInspect:
		out, err = s.inspect(ctx, toolCallID, args)
	case subagentActionSendInput:
		out, err = s.sendInput(ctx, toolCallID, args)
	case subagentActionClose:
		out, err = s.close(ctx, toolCallID, args)
	case subagentActionCloseAll:
		out, err = s.closeAllAction(ctx, toolCallID, args)
	default:
		err = fmt.Errorf("unsupported action %q", action)
	}
	if err != nil {
		return nil, err
	}
	parent.recordRunDiagnostic("delegation.manage.end", RealtimeStreamKindLifecycle, map[string]any{
		"action":       action,
		"tool_call_id": toolCallID,
		"status":       strings.TrimSpace(anyToString(out["status"])),
	})
	return out, nil
}

func (s *floretSubagentRuntime) ensureHost(ctx context.Context) (floretSubagentHost, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, errors.New("subagent runtime closed")
	}
	if s.host != nil && s.hostKey == "" {
		defer s.mu.Unlock()
		return s.host, nil
	}
	s.mu.Unlock()

	resolvedModel, err := parent.resolveSubagentRunModel(ctx)
	if err != nil {
		return nil, err
	}
	hostKey, err := parent.subagentHostConfigKey(ctx, resolvedModel)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errors.New("subagent runtime closed")
	}
	if s.host != nil && s.hostKey == hostKey {
		return s.host, nil
	}
	if s.host != nil {
		active, err := s.hostHasActiveSubagentsLocked(ctx, parent)
		if err != nil {
			return nil, err
		}
		if active {
			return s.host, nil
		}
		s.host = nil
		s.hostKey = ""
	}
	host, err := s.newHostLocked(ctx, parent, resolvedModel)
	if err != nil {
		return nil, err
	}
	s.host = host
	s.hostKey = hostKey
	if _, err := host.ListSubAgents(ctx, flruntime.ThreadID(strings.TrimSpace(parent.threadID))); err != nil {
		s.host = nil
		s.hostKey = ""
		return nil, err
	}
	return s.host, nil
}

func (s *floretSubagentRuntime) hostHasActiveSubagentsLocked(ctx context.Context, parent *run) (bool, error) {
	if s == nil || s.host == nil || parent == nil {
		return false, nil
	}
	snapshots, err := s.host.ListSubAgents(ctx, flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return false, err
	}
	for _, snapshot := range snapshots {
		if !isSubagentTerminalStatus(flowerSubagentStatus(snapshot.Status)) {
			return true, nil
		}
	}
	return false, nil
}

func (s *floretSubagentRuntime) currentHost() floretSubagentHost {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.host
}

func (s *floretSubagentRuntime) scheduleParentSubagentsPatch(threadID string) {
	if s == nil {
		return
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		threadID = "parent"
	}
	s.mu.Lock()
	if s.closed || s.host == nil {
		s.mu.Unlock()
		return
	}
	if s.subagentsPatchQueued == nil {
		s.subagentsPatchQueued = map[string]struct{}{}
	}
	if _, exists := s.subagentsPatchQueued[threadID]; exists {
		s.mu.Unlock()
		return
	}
	s.subagentsPatchQueued[threadID] = struct{}{}
	s.mu.Unlock()

	go func() {
		timer := time.NewTimer(150 * time.Millisecond)
		defer timer.Stop()
		<-timer.C
		defer func() {
			s.mu.Lock()
			delete(s.subagentsPatchQueued, threadID)
			s.mu.Unlock()
		}()
		s.mu.Lock()
		closed := s.closed
		s.mu.Unlock()
		if closed {
			return
		}
		parent := s.parentRun()
		if parent == nil {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), parent.persistTimeout())
		defer cancel()
		s.publishParentSubagentsPatch(ctx)
	}()
}

func (s *floretSubagentRuntime) newHostLocked(ctx context.Context, parent *run, resolved resolvedSubagentRunModel) (floretSubagentHost, error) {
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	providerType := strings.ToLower(strings.TrimSpace(resolved.RunModel.Provider.Type))
	if providerType == "" {
		providerType = strings.ToLower(strings.TrimSpace(resolved.ProviderType))
	}
	modelName := strings.TrimSpace(resolved.ModelName)
	wireModelName := strings.TrimSpace(resolved.WireModelName)
	if wireModelName == "" {
		wireModelName = modelName
	}
	adapter := resolved.AdapterOverride
	if adapter == nil {
		var err error
		adapter, err = newProviderAdapter(providerType, strings.TrimSpace(resolved.RunModel.Provider.BaseURL), strings.TrimSpace(resolved.APIKey), resolved.RunModel.Provider.StrictToolSchema)
		if err != nil {
			return nil, err
		}
	}
	webSearchCapability := resolveProviderWebSearchCapability(resolved.RunModel.Provider, modelName)
	if enableFlowerWebSearchTool(resolved.RunModel.Provider, webSearchCapability) {
		webSearchCapability.RegisterTool = true
	}
	parent.webSearchMode = webSearchCapability.Mode
	parent.webSearchToolEnabled = webSearchCapability.RegisterTool

	modelCapability := resolved.Capability
	childRun := parent.subagentPolicyRun()
	childRun.setPendingToolSettlementOwnerResolver(func() floretPendingToolSettler { return s.currentHost() })
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, childRun); err != nil {
		return nil, err
	}
	activeTools, childContract := childRun.subagentToolSurface(registry.Snapshot(), flruntime.SubAgentForkNone)
	initialSnapshot := permissionSnapshotWithOwnerIdentity(
		buildPermissionSnapshot(childRun.currentPermissionType(), activeTools, nil),
		parent.endpointID,
		"subagent_host_initial",
		parent.id,
	)
	childRun.setPermissionState(initialSnapshot.PermissionType, initialSnapshot)
	state := newFloretToolRuntimeState(newRuntimeState("subagents"))
	// Every executable child registry is produced by surfaceProvider after the
	// canonical child identity is known. The base registry has no handlers, so
	// provisional or parent authority cannot dispatch an effect.
	flTools := fltools.NewRegistry()
	flProvider := newFloretProviderAdapter(
		adapter,
		providerType,
		wireModelName,
		ProviderControls{
			ReasoningSelection:  config.NormalizeAIReasoningSelection(parent.currentReasoning),
			ReasoningCapability: modelCapability.ReasoningCapability,
		},
		TurnBudgets{},
		parent.webSearchMode,
		withDisabledFloretCoreControlTools(childContract.HiddenControlTools...),
		withFloretRequestAttachmentResolver(s.resolveSubagentMessageAttachment, modelCapability.SupportsImageInput, modelCapability.SupportsFileInput),
		withFloretBeforeRequest(childRun.floretContractError),
	)
	if parent.floretSubagentHostFactory == nil {
		return nil, errors.New("floret subagent host factory not ready")
	}
	systemPrompt := parent.buildSubagentHostSystemPrompt(activeTools, childContract)
	surfaceProvider := s.dynamicSubagentToolSurfaceProvider(state)
	contextWindow := modelGatewayDefaultContextWindowTokens
	if modelCapability.MaxContextTokens > 0 {
		contextWindow = modelCapability.MaxContextTokens
	}
	maxOutputTokens := 0
	if modelCapability.MaxOutputTokens > 0 {
		maxOutputTokens = modelCapability.MaxOutputTokens
	}
	gatewayIdentity, err := redevenFloretGatewayIdentity(resolved.RunModel.Provider.ID, providerType, resolved.RunModel.Provider.BaseURL, wireModelName, flProvider.stateCompatibilityRoute())
	if err != nil {
		return nil, err
	}
	host, err := parent.floretSubagentHostFactory(ctx, flruntime.SubAgentHostOptions{
		Config:                  flconfig.Config{SystemPrompt: systemPrompt, ContextPolicy: floretModelContextPolicy(contextWindow, maxOutputTokens), Reasoning: config.NormalizeAIReasoningSelection(parent.currentReasoning)},
		ModelGateway:            flProvider,
		ModelGatewayIdentity:    gatewayIdentity,
		Tools:                   flTools,
		EffectAuthorizationGate: floretEffectAuthorizationGateForRun(parent),
		Sink:                    floretSubagentEventSink{runtime: s},
		ToolSurfaceProvider:     surfaceProvider,
		SubAgentRunTimeout:      subagentRunTimeout,
		ThreadTitleMode:         flruntime.ThreadTitleModeProvider,
		LoopLimits: flruntime.LoopLimits{
			NoProgressLimit:    2,
			DuplicateToolLimit: 3,
		},
	})
	if err != nil {
		return nil, err
	}
	return host, nil
}

func (s *floretSubagentRuntime) resolveSubagentMessageAttachment(ctx context.Context, req flruntime.ModelRequest, attachment flruntime.MessageAttachment) (ContentPart, error) {
	parent := s.parentRun()
	childThreadID := strings.TrimSpace(string(req.ThreadID))
	if parent == nil || childThreadID == "" || childThreadID == strings.TrimSpace(parent.threadID) {
		return ContentPart{}, errors.New("SubAgent attachment authority identity is incomplete")
	}
	if labeled := strings.TrimSpace(req.Labels.Host[subagentToolHostContextChildThreadIDKey]); labeled != "" && labeled != childThreadID {
		return ContentPart{}, errors.New("SubAgent attachment authority identity mismatch")
	}
	forkMode, err := s.childForkModeForThread(ctxOrBackground(ctx), childThreadID)
	if err != nil {
		return ContentPart{}, err
	}
	if forkMode != flruntime.SubAgentForkFullPath {
		return ContentPart{}, errors.New("SubAgent attachment is outside the child context authority")
	}
	return parent.resolveFloretMessageAttachment(ctxOrBackground(ctx), attachment)
}

func (r *run) resolveSubagentRunModel(ctx context.Context) (resolvedSubagentRunModel, error) {
	if r == nil {
		return resolvedSubagentRunModel{}, errors.New("nil run")
	}
	if r.host.resolveRunModel == nil {
		return resolvedSubagentRunModel{}, errors.New("SubAgent model resolver is unavailable")
	}
	resolved, err := r.host.resolveRunModel(ctxOrBackground(ctx), r.cfg, "", r.currentModelID, r)
	if err != nil {
		return resolvedSubagentRunModel{}, err
	}
	capability := contextmodel.NormalizeCapability(resolved.Capability)
	modelName := strings.TrimSpace(resolved.ModelName)
	if modelName == "" {
		modelName = strings.TrimSpace(resolved.ID)
	}
	if capability.ModelName == "" {
		capability.ModelName = modelName
	}
	if capability.ProviderID == "" {
		capability.ProviderID = strings.TrimSpace(resolved.ProviderID)
	}
	if capability.ProviderType == "" {
		capability.ProviderType = strings.ToLower(strings.TrimSpace(resolved.Provider.Type))
	}
	if capability.WireModelName == "" {
		capability.WireModelName = modelName
	}
	wireModelName := strings.TrimSpace(capability.WireModelName)
	providerIDOK := strings.TrimSpace(resolved.ProviderID) != ""
	gateway, err := r.resolveModelGatewayForModel(resolved.ID, strings.TrimSpace(resolved.ProviderID), providerIDOK)
	if err != nil {
		return resolvedSubagentRunModel{}, err
	}
	if strings.TrimSpace(gateway.userMessage) != "" {
		return resolvedSubagentRunModel{}, gateway.err
	}
	if strings.TrimSpace(gateway.modelName) == "" && modelName == "" {
		return resolvedSubagentRunModel{}, fmt.Errorf("missing model name for subagent")
	}
	providerType := strings.ToLower(strings.TrimSpace(resolved.Provider.Type))
	if providerType == "" {
		providerType = strings.ToLower(strings.TrimSpace(gateway.provider.Type))
	}
	if modelName == "" {
		modelName = strings.TrimSpace(gateway.modelName)
	}
	if wireModelName == "" {
		wireModelName = modelName
	}
	return resolvedSubagentRunModel{
		RunModel:        resolved,
		Capability:      capability,
		ProviderType:    providerType,
		ModelName:       modelName,
		WireModelName:   wireModelName,
		AdapterOverride: gateway.adapterOverride,
		APIKey:          gateway.apiKey,
	}, nil
}

func (r *run) subagentHostConfigKey(ctx context.Context, resolved resolvedSubagentRunModel) (string, error) {
	if r == nil {
		return "", errors.New("nil run")
	}
	if strings.TrimSpace(resolved.RunModel.ID) == "" {
		var err error
		resolved, err = r.resolveSubagentRunModel(ctx)
		if err != nil {
			return "", err
		}
	}
	providerAPIKeyDigest := ""
	if strings.TrimSpace(resolved.APIKey) != "" {
		providerAPIKeyDigest = stableSecretDigest(resolved.APIKey)
	}
	webSearchCapability := resolveProviderWebSearchCapability(resolved.RunModel.Provider, strings.TrimSpace(resolved.ModelName))
	webSearchKeyDigest := ""
	webSearchKeyState := "unused"
	if enableFlowerWebSearchTool(resolved.RunModel.Provider, webSearchCapability) && r.resolveWebSearchKey != nil {
		key, ok, err := r.resolveWebSearchKey(websearch.ProviderBrave)
		switch {
		case err != nil:
			webSearchKeyState = "resolver_error:" + sanitizeLogText(err.Error(), 120)
		case ok && strings.TrimSpace(key) != "":
			webSearchKeyState = "resolved"
			webSearchKeyDigest = stableSecretDigest(key)
		default:
			webSearchKeyState = "missing"
		}
	}
	allowlist := mapKeys(r.toolAllowlist)
	sort.Strings(allowlist)
	targetPolicy := normalizeToolTargetPolicy(r.toolTargetPolicy)
	allowedTargets := append([]string(nil), targetPolicy.AllowedTargetIDs...)
	sort.Strings(allowedTargets)
	payload := map[string]any{
		"model_id":             strings.TrimSpace(resolved.RunModel.ID),
		"provider_id":          strings.TrimSpace(resolved.RunModel.Provider.ID),
		"provider_type":        strings.TrimSpace(resolved.RunModel.Provider.Type),
		"provider_base_url":    strings.TrimSpace(resolved.RunModel.Provider.BaseURL),
		"provider_api_key":     providerAPIKeyDigest,
		"model_name":           strings.TrimSpace(resolved.ModelName),
		"wire_model_name":      strings.TrimSpace(resolved.WireModelName),
		"model_capability":     subagentModelCapabilityFingerprint(resolved.Capability),
		"reasoning_selection":  config.NormalizeAIReasoningSelection(r.currentReasoning),
		"strict_tool_schema":   resolved.RunModel.Provider.StrictToolSchema,
		"web_search_mode":      providerWebSearchConfigKey(resolved.RunModel.Provider.WebSearch),
		"web_search_resolved":  webSearchCapability.Mode,
		"web_search_tool":      enableFlowerWebSearchTool(resolved.RunModel.Provider, webSearchCapability),
		"web_search_key_state": webSearchKeyState,
		"web_search_api_key":   webSearchKeyDigest,
		"adapter_override":     resolved.AdapterOverride != nil,
		"permission_type":      permissionTypeString(subagentPermissionLimit(r)),
		"tool_allowlist":       allowlist,
		"no_user_interaction":  r.noUserInteraction,
		"target_policy_mode":   targetPolicy.Mode,
		"target_default_id":    targetPolicy.DefaultTargetID,
		"target_allowed_ids":   allowedTargets,
		"session_can_read":     r.sessionMeta != nil && r.sessionMeta.CanRead,
		"session_can_write":    r.sessionMeta != nil && r.sessionMeta.CanWrite,
		"session_can_execute":  r.sessionMeta != nil && r.sessionMeta.CanExecute,
		"session_endpoint_id":  strings.TrimSpace(r.endpointID),
		"session_namespace_id": parentNamespacePublicID(r),
		"session_user_public":  strings.TrimSpace(r.userPublicID),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:]), nil
}

func stableSecretDigest(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func subagentModelCapabilityFingerprint(capability contextmodel.ModelCapability) string {
	capability = contextmodel.NormalizeCapability(capability)
	body, err := json.Marshal(capability)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func providerWebSearchConfigKey(in *config.AIProviderWebSearch) map[string]string {
	if in == nil {
		return nil
	}
	return map[string]string{
		"mode": strings.ToLower(strings.TrimSpace(in.Mode)),
	}
}

type subagentParentAuthority struct {
	threadID                string
	approvalTimeout         time.Duration
	currentPermission       func(context.Context) (FlowerPermissionType, error)
	registerApproval        func(*run, flruntime.EffectAuthorizationRequest) (*delegatedApprovalHandle, bool, error)
	markApprovalUnavailable func(string, string)
}

func (r *run) bindSubagentParentAuthority(parent *run) {
	if r == nil || parent == nil {
		return
	}
	authority := &subagentParentAuthority{
		threadID:          strings.TrimSpace(parent.threadID),
		approvalTimeout:   parent.toolApprovalTO,
		currentPermission: parent.currentThreadPermissionType,
	}
	if parent.host.registerDelegatedApproval != nil {
		authority.registerApproval = func(child *run, req flruntime.EffectAuthorizationRequest) (*delegatedApprovalHandle, bool, error) {
			return parent.host.registerDelegatedApproval(parent, child, req)
		}
	}
	authority.markApprovalUnavailable = parent.host.markDelegatedApprovalUnavailable
	r.subagentParentAuthority = authority
}

func (r *run) subagentChildRun(execution subagentExecutionCapabilities) *run {
	if strings.TrimSpace(execution.host.authorityThreadID) == "" || execution.host.lockEffectAuthority == nil || execution.host.terminal == nil {
		return nil
	}
	return r.newSubagentRun(execution.host, execution.product)
}

func (r *run) subagentPolicyRun() *run {
	return r.newSubagentRun(runHostCapabilities{}, runProductCapabilities{})
}

func (r *run) newSubagentRun(host runHostCapabilities, product runProductCapabilities) *run {
	if r == nil {
		return nil
	}
	child := newRun(runOptions{
		Log:                   r.log,
		StateDir:              r.stateDir,
		AgentHomeDir:          r.agentHomeDir,
		WorkingDir:            r.workingDir,
		FilesystemScope:       r.scope,
		Shell:                 r.shell,
		HostCapabilities:      host,
		AIConfig:              r.cfg,
		SessionMeta:           r.sessionMeta,
		ResolveProviderKey:    r.resolveProviderKey,
		ResolveWebSearchKey:   r.resolveWebSearchKey,
		DesktopModelSource:    r.desktopModelSource,
		RunID:                 r.id,
		ChannelID:             r.channelID,
		EndpointID:            r.endpointID,
		UserPublicID:          r.userPublicID,
		UploadsDir:            r.uploadsDir,
		ProductCapabilities:   product,
		EffectAuthorizations:  r.effectAuthorizations,
		PersistOpTimeout:      r.persistOpTimeout,
		SubagentDepth:         r.subagentDepth + 1,
		AllowSubagentDelegate: false,
		ToolAllowlist:         mapKeys(r.toolAllowlist),
		NoUserInteraction:     true,
		WebSearchToolEnabled:  r.webSearchToolEnabled,
		WebSearchMode:         r.webSearchMode,
		SkillManager:          r.skillManager,
		ToolTargetPolicy:      r.toolTargetPolicy,
		TargetToolExecutor:    r.targetToolExecutor,
	})
	child.setPermissionType(subagentPermissionLimit(r))
	child.currentModelID = r.currentModelID
	child.currentReasoning = config.NormalizeAIReasoningSelection(r.currentReasoning)
	child.subagentDepth = r.subagentDepth + 1
	child.allowSubagentDelegate = false
	child.noUserInteraction = true
	child.allowDelegatedApproval = true
	child.bindSubagentParentAuthority(r)
	parentSnapshot := r.currentPermissionSnapshot()
	if len(parentSnapshot.VisibleToolNames) > 0 {
		child.toolAllowlist = stringSet(parentSnapshot.VisibleToolNames...)
	}
	return child
}

func subagentPermissionLimit(parent *run) FlowerPermissionType {
	permissionType := parent.currentPermissionType()
	if parent == nil || permissionType == "" {
		return FlowerPermissionApprovalRequired
	}
	return permissionType
}

func (r *run) subagentToolSurface(all []ToolDef, forkMode flruntime.SubAgentForkMode) ([]ToolDef, subagentCapabilityContract) {
	if r == nil {
		contract := resolveSubagentCapabilityContract(nil, nil, forkMode)
		return nil, contract
	}
	permissionFilter := newPermissionToolFilter(false)
	permissionFilter = r.withToolAllowlistFilter(permissionFilter)
	contract := resolveSubagentCapabilityContract(r, nil, forkMode)
	activeTools := permissionFilter.FilterTools(subagentPermissionLimit(r), all)
	activeTools = filterSubagentChildTools(activeTools, contract)
	contract.VisibleTools = mapToolNames(activeTools)
	return activeTools, contract
}

func (s *floretSubagentRuntime) dynamicSubagentToolSurfaceProvider(state *floretToolRuntimeState) flruntime.ToolSurfaceProvider {
	var mu sync.Mutex
	lastEpochByThread := map[string]string{}
	return func(ctx context.Context, req flruntime.ToolSurfaceRequest) (flruntime.ToolSurface, error) {
		parent := s.parentRun()
		if parent == nil {
			return flruntime.ToolSurface{}, errors.New("subagent runtime unavailable")
		}
		childThreadID := strings.TrimSpace(string(req.ThreadID))
		if childThreadID == "" {
			childThreadID = strings.TrimSpace(req.HostContext[subagentToolHostContextChildThreadIDKey])
		}
		childRunID := strings.TrimSpace(req.HostContext[subagentToolHostContextChildRunIDKey])
		if childRunID == "" {
			return flruntime.ToolSurface{}, errors.New("missing subagent child run identity")
		}
		execution, err := s.childExecutionCapabilities(ctx, childThreadID, childRunID)
		if err != nil {
			return flruntime.ToolSurface{}, err
		}
		childRun := parent.subagentChildRun(execution)
		if childRun == nil {
			return flruntime.ToolSurface{}, errors.New("subagent child runtime unavailable")
		}
		childRun.setPendingToolSettlementOwnerResolver(func() floretPendingToolSettler { return s.currentHost() })
		childRun.threadID = childThreadID
		childRun.id = childRunID
		childRun.messageID = strings.TrimSpace(string(req.TurnID))
		childRun.settlementThreadID = strings.TrimSpace(string(req.ThreadID))
		childRun.settlementRunID = strings.TrimSpace(string(req.RunID))
		childRun.settlementTurnID = strings.TrimSpace(string(req.TurnID))
		forkMode, err := s.childForkModeForThread(ctx, childThreadID)
		if err != nil {
			parent.recordRunDiagnostic("subagent.tool_surface.error", RealtimeStreamKindLifecycle, map[string]any{
				"phase":           strings.TrimSpace(req.Phase),
				"step":            req.Step,
				"child_thread_id": childThreadID,
				"child_run_id":    childRunID,
				"error":           err.Error(),
			})
			return flruntime.ToolSurface{}, err
		}
		activeTools, childContract, childSnapshot, err := childRun.buildCurrentSubagentPermissionSurface(ctx, forkMode)
		if err != nil {
			return flruntime.ToolSurface{}, err
		}
		flTools, err := buildFloretToolRegistry(childRun, activeTools, state)
		if err != nil {
			return flruntime.ToolSurface{}, err
		}
		hostContext := cloneStringMap(req.HostContext)
		if hostContext == nil {
			hostContext = floretHostLabelsForRun(parent)
		}
		if childThreadID != "" {
			hostContext[subagentToolHostContextChildThreadIDKey] = childThreadID
		}
		if childRunID != "" && childRunID != childThreadID {
			hostContext[subagentToolHostContextChildRunIDKey] = childRunID
		}
		hostContext[subagentToolHostContextForkModeKey] = string(forkMode)
		hostContext[floretToolHostContextPermissionSnapshotIDKey] = strings.TrimSpace(childSnapshot.SnapshotID)
		hostContext[floretToolHostContextPermissionEpochKey] = permissionSurfaceEpoch(childSnapshot)
		hostContext[floretToolHostContextAuthorityThreadIDKey] = strings.TrimSpace(parent.threadID)
		epoch := permissionSurfaceEpoch(childSnapshot)
		key := firstNonEmptyString(childThreadID, strings.TrimSpace(string(req.PromptScopeID)), "subagent")
		mu.Lock()
		changed := epoch != "" && lastEpochByThread[key] != epoch
		if changed {
			lastEpochByThread[key] = epoch
		}
		mu.Unlock()
		if changed {
			parent.recordRunDiagnostic("subagent.tool_surface.updated", RealtimeStreamKindLifecycle, map[string]any{
				"phase":             strings.TrimSpace(req.Phase),
				"step":              req.Step,
				"child_thread_id":   childThreadID,
				"child_run_id":      childRunID,
				"permission_type":   permissionTypeString(childSnapshot.PermissionType),
				"snapshot_id":       strings.TrimSpace(childSnapshot.SnapshotID),
				"snapshot_hash":     strings.TrimSpace(childSnapshot.SnapshotHash),
				"registry_hash":     strings.TrimSpace(childSnapshot.RegistryHash),
				"schema_hash":       strings.TrimSpace(childSnapshot.SchemaHash),
				"presentation_hash": strings.TrimSpace(childSnapshot.PresentationHash),
			})
		}
		return flruntime.ToolSurface{
			Tools:        flTools,
			SystemPrompt: childRun.buildSubagentHostSystemPrompt(activeTools, childContract),
			HostContext:  hostContext,
			Epoch:        epoch,
			Reason:       "parent_thread_permission",
		}, nil
	}
}

func (s *floretSubagentRuntime) childExecutionCapabilities(ctx context.Context, childThreadID string, childRunID string) (subagentExecutionCapabilities, error) {
	if s == nil {
		return subagentExecutionCapabilities{}, errors.New("SubAgent execution authority is unavailable")
	}
	resolve := s.resolveExactChildExecution
	if resolve == nil {
		return subagentExecutionCapabilities{}, errors.New("SubAgent execution capability resolver is unavailable")
	}
	return resolve(ctxOrBackground(ctx), strings.TrimSpace(childThreadID), strings.TrimSpace(childRunID))
}

func (o *floretSubagentExecutionOwner) resolve(ctx context.Context, childThreadID string, childRunID string) (subagentExecutionCapabilities, error) {
	if o == nil || o.runtime == nil || o.bind == nil {
		return subagentExecutionCapabilities{}, errors.New("SubAgent execution authority is unavailable")
	}
	s := o.runtime
	parent := s.parentRun()
	host := s.currentHost()
	childThreadID = strings.TrimSpace(childThreadID)
	childRunID = strings.TrimSpace(childRunID)
	if parent == nil || host == nil || childThreadID == "" || childRunID == "" || childThreadID == childRunID {
		return subagentExecutionCapabilities{}, errors.New("SubAgent execution authority identity is incomplete")
	}
	snapshots, err := host.ListSubAgents(ctxOrBackground(ctx), flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return subagentExecutionCapabilities{}, err
	}
	owned := false
	for _, snapshot := range snapshots {
		if strings.TrimSpace(string(snapshot.ParentThreadID)) == strings.TrimSpace(parent.threadID) && strings.TrimSpace(string(snapshot.ThreadID)) == childThreadID {
			owned = true
			break
		}
	}
	if !owned {
		return subagentExecutionCapabilities{}, errors.New("SubAgent execution target is not owned by the current parent")
	}
	auditRunID, err := s.childRunIDForThread(childThreadID)
	if err != nil {
		return subagentExecutionCapabilities{}, err
	}
	if auditRunID != childRunID {
		return subagentExecutionCapabilities{}, errors.New("SubAgent execution run identity does not match the finalized permission audit")
	}
	return o.bind(parent, childThreadID, childRunID)
}

func (r *run) buildCurrentSubagentPermissionSurface(ctx context.Context, forkMode flruntime.SubAgentForkMode) ([]ToolDef, subagentCapabilityContract, PermissionSnapshot, error) {
	if r == nil || r.subagentParentAuthority == nil || r.subagentParentAuthority.currentPermission == nil {
		return nil, subagentCapabilityContract{}, PermissionSnapshot{}, errors.New("subagent permission authority is unavailable")
	}
	switch forkMode {
	case flruntime.SubAgentForkNone, flruntime.SubAgentForkFullPath:
	default:
		return nil, subagentCapabilityContract{}, PermissionSnapshot{}, fmt.Errorf("invalid subagent fork mode %q", forkMode)
	}
	permissionType, err := r.subagentParentAuthority.currentPermission(ctx)
	if err != nil {
		return nil, subagentCapabilityContract{}, PermissionSnapshot{}, err
	}
	r.setPermissionType(permissionType)
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, r); err != nil {
		return nil, subagentCapabilityContract{}, PermissionSnapshot{}, err
	}
	activeTools, contract := r.subagentToolSurface(registry.Snapshot(), forkMode)
	snapshot := permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(permissionType, activeTools, nil), r.endpointID, r.threadID, r.id)
	snapshot, err = r.freezePermissionSnapshot(snapshot)
	if err != nil {
		return nil, subagentCapabilityContract{}, PermissionSnapshot{}, fmt.Errorf("persist current child permission snapshot: %w", err)
	}
	return activeTools, contract, snapshot, nil
}

func (r *run) refreshCurrentSubagentPermissionSnapshot(ctx context.Context, authorityThreadID string, forkMode flruntime.SubAgentForkMode) (PermissionSnapshot, error) {
	if r == nil || r.subagentParentAuthority == nil {
		return PermissionSnapshot{}, errors.New("subagent permission authority is unavailable")
	}
	if strings.TrimSpace(authorityThreadID) == "" || strings.TrimSpace(authorityThreadID) != strings.TrimSpace(r.subagentParentAuthority.threadID) {
		return PermissionSnapshot{}, errors.New("subagent permission authority thread mismatch")
	}
	_, _, snapshot, err := r.buildCurrentSubagentPermissionSurface(ctx, forkMode)
	return snapshot, err
}

func (s *floretSubagentRuntime) childForkModeForThread(ctx context.Context, childThreadID string) (flruntime.SubAgentForkMode, error) {
	childThreadID = strings.TrimSpace(childThreadID)
	if childThreadID == "" {
		return "", errors.New("missing subagent child thread identity")
	}
	parent := s.parentRun()
	host := s.currentHost()
	if parent == nil || host == nil {
		return "", errors.New("subagent runtime host unavailable")
	}
	snapshots, err := host.ListSubAgents(ctx, flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return "", fmt.Errorf("read subagent fork mode: %w", err)
	}
	for _, snapshot := range snapshots {
		if strings.TrimSpace(string(snapshot.ThreadID)) == childThreadID && snapshot.ForkMode != "" {
			return snapshot.ForkMode, nil
		}
	}
	return "", fmt.Errorf("subagent %q fork mode not found", childThreadID)
}

func filterSubagentChildTools(in []ToolDef, contract subagentCapabilityContract) []ToolDef {
	out := make([]ToolDef, 0, len(in))
	hidden := contract.HiddenToolSet
	if len(hidden) == 0 {
		hidden = subagentHiddenToolSet(contract.HiddenControlTools)
	}
	for _, def := range in {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if _, ok := hidden[name]; ok {
			continue
		}
		out = append(out, def)
	}
	return out
}

func resolveSubagentCapabilityContract(parent *run, tools []ToolDef, forkMode flruntime.SubAgentForkMode) subagentCapabilityContract {
	hidden := []string{"subagents", "ask_user", "write_todos"}
	contract := subagentCapabilityContract{
		VisibleTools:          mapToolNames(tools),
		HiddenControlTools:    hidden,
		HiddenToolSet:         subagentHiddenToolSet(hidden),
		AllowSpawnSubagents:   false,
		AllowUserApproval:     parent != nil && parent.subagentDepth > 0 && parent.allowDelegatedApproval,
		AllowUserInput:        false,
		ForkMode:              forkMode,
		FinalHandoffBudget:    1800,
		ProgressSummaryBudget: 700,
	}
	return contract
}

func subagentHiddenToolSet(names []string) map[string]struct{} {
	out := make(map[string]struct{}, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		out[name] = struct{}{}
	}
	return out
}

func mapToolNames(tools []ToolDef) []string {
	if len(tools) == 0 {
		return nil
	}
	out := make([]string, 0, len(tools))
	seen := map[string]struct{}{}
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

func (s *floretSubagentRuntime) spawn(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	toolCallID = strings.TrimSpace(toolCallID)
	if toolCallID == "" {
		return nil, errors.New("missing subagents spawn tool call id")
	}
	host, err := s.ensureHost(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.requireCurrentHostForSpawn(ctx, parent); err != nil {
		return nil, err
	}
	agentType := normalizeSubagentAgentType(anyToString(args["agent_type"]))
	if _, exists := args["title"]; exists {
		return nil, errors.New("subagents spawn does not accept title; use task_name")
	}
	if _, exists := args["objective"]; exists {
		return nil, errors.New("subagents spawn does not accept objective; use message")
	}
	taskName := strings.TrimSpace(anyToString(args["task_name"]))
	if taskName == "" {
		return nil, errors.New("subagents spawn requires task_name")
	}
	taskDescription := strings.TrimSpace(anyToString(args["task_description"]))
	if taskDescription == "" {
		return nil, errors.New("subagents spawn requires task_description")
	}
	message := strings.TrimSpace(anyToString(args["message"]))
	if message == "" {
		return nil, errors.New("subagents spawn requires message")
	}
	contextMode := normalizeSubagentContextMode(anyToString(args["context_mode"]))
	forkMode := subagentForkModeForContextMode(contextMode)
	publicationID, childThreadID, childRunID, err := subagentSpawnIdentities(parent.threadID, parent.messageID, toolCallID)
	if err != nil {
		return nil, err
	}
	childRun := parent.subagentPolicyRun()
	parentAuthorization, ok := toolAuthorizationSnapshotFromContext(ctx)
	if !ok {
		return nil, errors.New("subagents spawn authorization snapshot is unavailable")
	}
	childRun.setPermissionType(parentAuthorization.PermissionType)
	childRun.toolAllowlist = stringSet(parentAuthorization.VisibleToolNames...)
	childRun.id = childRunID
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, childRun); err != nil {
		return nil, err
	}
	activeChildTools, childContract := childRun.subagentToolSurface(registry.Snapshot(), forkMode)
	childPermissionType := childRun.currentPermissionType()
	childSnapshot := permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(childPermissionType, activeChildTools, nil), parent.endpointID, childThreadID, childRunID)
	childRun.setPermissionState(childPermissionType, childSnapshot)
	prompt := buildFlowerSubagentPrompt(flowerSubagentPromptSpec{
		AgentType:   agentType,
		TaskName:    taskName,
		Message:     message,
		ContextMode: contextMode,
		Contract:    childContract,
	})
	spawnRequest := flruntime.SpawnSubAgentRequest{
		PublicationID:   publicationID,
		ParentThreadID:  flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ParentTurnID:    flruntime.TurnID(strings.TrimSpace(parent.messageID)),
		ThreadID:        flruntime.ThreadID(childThreadID),
		TaskName:        taskName,
		TaskDescription: taskDescription,
		Message:         prompt,
		HostProfileRef:  agentType,
		ForkMode:        forkMode,
		Labels:          s.runLabels(agentType, childThreadID, childRunID),
	}
	if err := prepareSubAgentPublication(parent, toolCallID, parentAuthorization, childSnapshot, spawnRequest); err != nil {
		return nil, fmt.Errorf("prepare SubAgent publication: %w", err)
	}
	snapshot, err := host.SpawnSubAgent(ctx, spawnRequest)
	if err != nil {
		if failErr := failSubAgentPublication(parent, publicationID, childThreadID, childRunID, childSnapshot.SnapshotID); failErr != nil {
			return nil, errors.Join(err, fmt.Errorf("record failed SubAgent publication: %w", failErr))
		}
		return nil, err
	}
	if err := validateSubAgentPublicationSnapshot(spawnRequest, snapshot); err != nil {
		if failErr := failSubAgentPublication(parent, publicationID, childThreadID, childRunID, childSnapshot.SnapshotID); failErr != nil {
			return nil, errors.Join(err, fmt.Errorf("record invalid SubAgent publication result: %w", failErr))
		}
		return nil, err
	}
	if err := finalizeSubAgentPublication(parent, publicationID, childThreadID, childRunID, childSnapshot.SnapshotID); err != nil {
		return nil, fmt.Errorf("finalize SubAgent publication: %w", err)
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	s.refreshSubagentsPatch(ctx, localSnapshot)
	item := subagentSnapshotPayload(localSnapshot)
	parent.recordRunDiagnostic("delegation.spawn", RealtimeStreamKindLifecycle, map[string]any{
		"thread_id":        item["thread_id"],
		"agent_type":       item["agent_type"],
		"task_name":        item["task_name"],
		"task_description": item["task_description"],
		"status":           item["status"],
	})
	bounded := boundedSubagentItem(item)
	return trimSubagentToolResult(map[string]any{
		"status":           "ok",
		"action":           subagentActionSpawn,
		"accepted":         true,
		"thread_id":        bounded["thread_id"],
		"agent_type":       bounded["agent_type"],
		"context_mode":     bounded["context_mode"],
		"task_name":        bounded["task_name"],
		"task_description": bounded["task_description"],
		"items":            []map[string]any{bounded},
	}), nil
}

func prepareSubAgentPublication(parent *run, toolCallID string, parentSnapshot PermissionSnapshot, childSnapshot PermissionSnapshot, request flruntime.SpawnSubAgentRequest) error {
	if parent == nil || parent.product.preparePublication == nil || parent.sessionMeta == nil {
		return errors.New("SubAgent publication persistence context is unavailable")
	}
	requestJSON, err := json.Marshal(request)
	if err != nil {
		return err
	}
	requestSum := sha256.Sum256(requestJSON)
	sessionMetaJSON, err := marshalQueuedTurnSessionMeta(parent.sessionMeta)
	if err != nil {
		return err
	}
	reasoningJSON, err := json.Marshal(config.NormalizeAIReasoningSelection(parent.currentReasoning))
	if err != nil {
		return err
	}
	childRecord, err := parent.childPermissionSnapshotRecord(string(request.ThreadID), subagentChildRunIDFromLabels(request.Labels), toolCallID, "provisional", parentSnapshot, childSnapshot)
	if err != nil {
		return err
	}
	operation := threadstore.SubAgentPublicationOperation{
		PublicationID:          strings.TrimSpace(string(request.PublicationID)),
		EndpointID:             strings.TrimSpace(parent.endpointID),
		ParentThreadID:         strings.TrimSpace(string(request.ParentThreadID)),
		ParentTurnID:           strings.TrimSpace(string(request.ParentTurnID)),
		ParentRunID:            strings.TrimSpace(parent.id),
		SpawnToolCallID:        strings.TrimSpace(toolCallID),
		ChildThreadID:          strings.TrimSpace(string(request.ThreadID)),
		ChildRunID:             strings.TrimSpace(childRecord.ChildRunID),
		ChildSnapshotID:        strings.TrimSpace(childSnapshot.SnapshotID),
		RequestJSON:            string(requestJSON),
		RequestHash:            hex.EncodeToString(requestSum[:]),
		SessionMetaJSON:        sessionMetaJSON,
		ModelID:                strings.TrimSpace(parent.currentModelID),
		ReasoningSelectionJSON: string(reasoningJSON),
		State:                  threadstore.SubAgentPublicationPending,
		CreatedAtUnixMs:        childRecord.CreatedAtUnixMs,
	}
	ctx, cancel := persistContextForRun(parent)
	defer cancel()
	return parent.product.prepareSubAgentPublication(ctx, operation, childRecord)
}

func subagentChildRunIDFromLabels(labels flruntime.RunLabels) string {
	return strings.TrimSpace(labels.Host[subagentToolHostContextChildRunIDKey])
}

func finalizeSubAgentPublication(parent *run, publicationID string, childThreadID string, childRunID string, childSnapshotID string) error {
	if parent == nil || parent.product.finalizePublication == nil {
		return errors.New("SubAgent publication persistence context is unavailable")
	}
	ctx, cancel := persistContextForRun(parent)
	defer cancel()
	ok, err := parent.product.finalizeSubAgentPublication(ctx, strings.TrimSpace(publicationID), strings.TrimSpace(childSnapshotID), strings.TrimSpace(childThreadID), strings.TrimSpace(childRunID), time.Now().UnixMilli())
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("SubAgent publication was not finalized")
	}
	return nil
}

func failSubAgentPublication(parent *run, publicationID string, childThreadID string, childRunID string, childSnapshotID string) error {
	if parent == nil || parent.product.failPublication == nil {
		return errors.New("SubAgent publication persistence context is unavailable")
	}
	ctx, cancel := persistContextForRun(parent)
	defer cancel()
	ok, err := parent.product.failSubAgentPublication(ctx, strings.TrimSpace(publicationID), strings.TrimSpace(childSnapshotID), strings.TrimSpace(childThreadID), strings.TrimSpace(childRunID), time.Now().UnixMilli())
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("SubAgent publication failure was not recorded")
	}
	return nil
}

func decodePendingSubAgentPublicationRequest(operation threadstore.SubAgentPublicationOperation) (flruntime.SpawnSubAgentRequest, error) {
	var request flruntime.SpawnSubAgentRequest
	if err := decodeStrictJSON(operation.RequestJSON, &request); err != nil {
		return flruntime.SpawnSubAgentRequest{}, err
	}
	body, err := json.Marshal(request)
	if err != nil {
		return flruntime.SpawnSubAgentRequest{}, err
	}
	sum := sha256.Sum256(body)
	if hex.EncodeToString(sum[:]) != strings.TrimSpace(operation.RequestHash) {
		return flruntime.SpawnSubAgentRequest{}, errors.New("SubAgent publication request hash mismatch")
	}
	if strings.TrimSpace(string(request.PublicationID)) != strings.TrimSpace(operation.PublicationID) ||
		strings.TrimSpace(string(request.ParentThreadID)) != strings.TrimSpace(operation.ParentThreadID) ||
		strings.TrimSpace(string(request.ParentTurnID)) != strings.TrimSpace(operation.ParentTurnID) ||
		strings.TrimSpace(string(request.ThreadID)) != strings.TrimSpace(operation.ChildThreadID) ||
		subagentChildRunIDFromLabels(request.Labels) != strings.TrimSpace(operation.ChildRunID) {
		return flruntime.SpawnSubAgentRequest{}, errors.New("SubAgent publication request identity mismatch")
	}
	return request, nil
}

func validateSubAgentPublicationSnapshot(request flruntime.SpawnSubAgentRequest, snapshot flruntime.SubAgentSnapshot) error {
	if strings.TrimSpace(string(snapshot.ThreadID)) != strings.TrimSpace(string(request.ThreadID)) ||
		strings.TrimSpace(string(snapshot.ParentThreadID)) != strings.TrimSpace(string(request.ParentThreadID)) {
		return errors.New("Floret SubAgent publication result identity mismatch")
	}
	return nil
}

func (s *floretSubagentRuntime) wait(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	host, err := s.ensureHost(ctx)
	if err != nil {
		return nil, err
	}
	requestedTimeoutMS, effectiveTimeoutMS, timeoutSource := subagentTimeoutDecision(args)
	ids := normalizeSubagentThreadIDs(args["ids"])
	childIDs := make([]flruntime.ThreadID, 0, len(ids))
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" {
			childIDs = append(childIDs, flruntime.ThreadID(id))
		}
	}
	s.publishParentSubagentsPatch(ctx)
	result, err := host.WaitSubAgents(ctx, flruntime.WaitSubAgentsRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ChildThreadIDs: childIDs,
		Timeout:        time.Duration(effectiveTimeoutMS) * time.Millisecond,
	})
	if err != nil {
		return nil, err
	}
	snapshots := make([]subagentSnapshot, 0, len(result.Snapshots))
	for _, snapshot := range result.Snapshots {
		local := subagentSnapshotFromFloret(snapshot)
		snapshots = append(snapshots, local)
	}
	s.refreshSubagentsPatch(ctx, snapshots...)
	contextMode := aggregateSubagentContextMode(snapshots)
	forkMode := subagentForkModeForContextMode(contextMode)
	waitContract := resolveSubagentCapabilityContract(parent, nil, forkMode)
	boundedSnapshots := boundedSubagentStatusItems(snapshots)
	out := map[string]any{
		"status":               "ok",
		"action":               subagentActionWait,
		"ids":                  ids,
		"target_ids":           ids,
		"requested_timeout_ms": requestedTimeoutMS,
		"effective_timeout_ms": effectiveTimeoutMS,
		"timeout_ms":           effectiveTimeoutMS,
		"timeout_source":       timeoutSource,
		"timed_out":            result.TimedOut,
		"context_mode":         contextMode,
		"detail_omitted":       true,
		"detail_strategy":      "ui_detail_api",
	}
	if result.TimedOut {
		out["progress_summary"] = buildSubagentProgressSummary(parent, snapshots, waitContract)
	} else {
		out["final_handoff_report"] = buildSubagentFinalHandoffReport(parent, snapshots, waitContract)
	}
	out["items"] = boundedSnapshots
	out["counts"] = subagentModelStatusCounts(boundedSnapshots)
	out["agent_count"] = len(boundedSnapshots)
	return trimSubagentToolResult(out), nil
}

func (s *floretSubagentRuntime) list(ctx context.Context, _ string, args map[string]any) (map[string]any, error) {
	snapshots, err := s.snapshots(ctx)
	if err != nil {
		return nil, err
	}
	runningOnly := parseBoolArg(args, "running_only", false)
	limit := parseIntArg(args, "limit", 50)
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	sort.SliceStable(snapshots, func(i, j int) bool {
		if snapshots[i].UpdatedAtMS == snapshots[j].UpdatedAtMS {
			return snapshots[i].CreatedAtMS > snapshots[j].CreatedAtMS
		}
		return snapshots[i].UpdatedAtMS > snapshots[j].UpdatedAtMS
	})
	items := make([]map[string]any, 0, len(snapshots))
	counts := subagentStatusCounts{}
	for _, snapshot := range snapshots {
		counts.add(snapshot.Status)
		if runningOnly && isSubagentTerminalStatus(snapshot.Status) {
			continue
		}
		items = append(items, subagentListPayload(snapshot))
		if len(items) >= limit {
			break
		}
	}
	out := subagentBoundedResult(subagentActionList, items)
	for key, value := range counts.payload() {
		out[key] = value
	}
	out["total"] = len(snapshots)
	out["running_only"] = runningOnly
	out["updated_at_unix_ms"] = time.Now().UnixMilli()
	return trimSubagentToolResult(out), nil
}

func (s *floretSubagentRuntime) inspect(ctx context.Context, _ string, args map[string]any) (map[string]any, error) {
	targets := collectInspectTargets(args)
	all, err := s.snapshots(ctx)
	if err != nil {
		return nil, err
	}
	byID := map[string]subagentSnapshot{}
	for _, snapshot := range all {
		key := strings.TrimSpace(snapshot.ThreadID)
		if key != "" {
			byID[key] = snapshot
		}
	}
	items := make([]map[string]any, 0, len(targets))
	missing := make([]string, 0)
	for _, target := range targets {
		if snapshot, ok := byID[strings.TrimSpace(target)]; ok {
			items = append(items, subagentSnapshotPayload(snapshot))
		} else {
			missing = append(missing, target)
		}
	}
	status := "ok"
	if len(items) == 0 {
		status = "not_found"
	} else if len(missing) > 0 {
		status = "partial"
	}
	out := subagentBoundedResult(subagentActionInspect, items)
	out["status"] = status
	out["requested_ids"] = targets
	out["requested_count"] = len(targets)
	out["found_count"] = len(items)
	out["missing_count"] = len(missing)
	out["missing_ids"] = missing
	if target := strings.TrimSpace(anyToString(args["target"])); target != "" {
		out["target"] = target
	}
	if len(targets) > 0 {
		out["ids"] = targets
	}
	return trimSubagentToolResult(out), nil
}

func subagentBoundedResult(action string, items []map[string]any) map[string]any {
	bounded := boundedSubagentItems(items)
	return map[string]any{
		"status":          "ok",
		"action":          strings.TrimSpace(action),
		"items":           bounded,
		"agent_count":     len(bounded),
		"counts":          subagentModelStatusCounts(bounded),
		"detail_omitted":  true,
		"detail_strategy": "ui_detail_api",
	}
}

func subagentTimeoutDecision(args map[string]any) (int, int, string) {
	raw, provided := args["timeout_ms"]
	requested := parseIntArg(map[string]any{"timeout_ms": raw}, "timeout_ms", subagentDefaultTimeoutMS)
	source := "request"
	if !provided || requested <= 0 {
		requested = subagentDefaultTimeoutMS
		source = "default"
	}
	effective := requested
	if effective > subagentMaxTimeoutMS {
		effective = subagentMaxTimeoutMS
		source = "max"
	}
	return requested, effective, source
}

func subagentActionTimeoutContext(ctx context.Context, args map[string]any) (context.Context, context.CancelFunc, int, int, string) {
	requestedTimeoutMS, effectiveTimeoutMS, timeoutSource := subagentTimeoutDecision(args)
	base := ctx
	if base == nil {
		base = context.Background()
	}
	next, cancel := context.WithTimeout(base, time.Duration(effectiveTimeoutMS)*time.Millisecond)
	return next, cancel, requestedTimeoutMS, effectiveTimeoutMS, timeoutSource
}

func applySubagentTimeoutFields(out map[string]any, requestedTimeoutMS int, effectiveTimeoutMS int, timeoutSource string) map[string]any {
	if out == nil {
		out = map[string]any{}
	}
	out["requested_timeout_ms"] = requestedTimeoutMS
	out["effective_timeout_ms"] = effectiveTimeoutMS
	out["timeout_ms"] = effectiveTimeoutMS
	out["timeout_source"] = timeoutSource
	return out
}

func boundedSubagentItems(items []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, boundedSubagentItem(item))
	}
	return out
}

func boundedSubagentStatusItems(snapshots []subagentSnapshot) []map[string]any {
	out := make([]map[string]any, 0, len(snapshots))
	for _, snapshot := range snapshots {
		out = append(out, boundedSubagentStatusItem(subagentSnapshotPayload(snapshot)))
	}
	return out
}

func boundedSubagentStatusItemsFromAny(raw any) []map[string]any {
	items := subagentItemsFromAny(raw)
	if len(items) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, boundedSubagentStatusItem(item))
	}
	return out
}

func boundedSubagentStatusItem(item map[string]any) map[string]any {
	threadID := strings.TrimSpace(anyToString(item["thread_id"]))
	taskName := truncateRunes(strings.TrimSpace(anyToString(item["task_name"])), 180)
	taskDescription := truncateRunes(strings.TrimSpace(anyToString(item["task_description"])), 500)
	return map[string]any{
		"thread_id":        threadID,
		"agent_type":       strings.TrimSpace(anyToString(item["agent_type"])),
		"context_mode":     normalizeSubagentContextMode(anyToString(item["context_mode"])),
		"task_name":        taskName,
		"task_description": taskDescription,
		"status":           strings.TrimSpace(anyToString(item["status"])),
		"parent_thread_id": strings.TrimSpace(anyToString(item["parent_thread_id"])),
		"started_at_ms":    nonNegativeInt64Local(parseInt64Raw(item["started_at_ms"], 0)),
		"created_at_ms":    nonNegativeInt64Local(parseInt64Raw(item["created_at_ms"], 0)),
		"updated_at_ms":    nonNegativeInt64Local(parseInt64Raw(item["updated_at_ms"], 0)),
		"detail_available": threadID != "",
		"detail_ref":       subagentDetailRef(threadID),
		"detail_omitted":   true,
	}
}

func boundedSubagentItem(item map[string]any) map[string]any {
	threadID := strings.TrimSpace(anyToString(item["thread_id"]))
	taskName := truncateRunes(strings.TrimSpace(anyToString(item["task_name"])), 180)
	taskDescription := truncateRunes(strings.TrimSpace(anyToString(item["task_description"])), 500)
	lastMessage := truncateRunes(strings.TrimSpace(anyToString(item["last_message"])), 900)
	out := map[string]any{
		"thread_id":        threadID,
		"agent_type":       strings.TrimSpace(anyToString(item["agent_type"])),
		"context_mode":     normalizeSubagentContextMode(anyToString(item["context_mode"])),
		"task_name":        taskName,
		"task_description": taskDescription,
		"status":           strings.TrimSpace(anyToString(item["status"])),
		"last_message":     lastMessage,
		"result_digest":    lastMessage,
		"waiting_prompt":   truncateRunes(strings.TrimSpace(anyToString(item["waiting_prompt"])), 700),
		"queued_inputs":    nonNegativeInt(parseIntRaw(item["queued_inputs"], 0)),
		"parent_thread_id": strings.TrimSpace(anyToString(item["parent_thread_id"])),
		"created_at_ms":    nonNegativeInt64Local(parseInt64Raw(item["created_at_ms"], 0)),
		"updated_at_ms":    nonNegativeInt64Local(parseInt64Raw(item["updated_at_ms"], 0)),
		"closed":           anyToBool(item["closed"]),
		"can_send_input":   anyToBool(item["can_send_input"]),
		"can_interrupt":    anyToBool(item["can_interrupt"]),
		"can_close":        anyToBool(item["can_close"]),
		"detail_available": threadID != "",
		"detail_ref":       subagentDetailRef(threadID),
		"detail_omitted":   true,
	}
	if status := strings.TrimSpace(anyToString(out["status"])); status == subagentStatusCompleted {
		resultDigest := strings.TrimSpace(anyToString(item["result_digest"]))
		if resultDigest == "" {
			resultDigest = strings.TrimSpace(anyToString(item["last_message"]))
		}
		out["result_digest"] = truncateRunes(resultDigest, 900)
	} else {
		out["result_digest"] = ""
	}
	for {
		body, err := json.Marshal(out)
		if err != nil || len(body) <= subagentModelItemHardBytes {
			return out
		}
		lastMessage = truncateRunes(lastMessage, len([]rune(lastMessage))/2)
		if lastMessage == "" {
			out["result_digest"] = ""
			out["last_message"] = ""
			out["truncated"] = true
			return out
		}
		out["last_message"] = lastMessage
		if strings.TrimSpace(anyToString(out["status"])) == subagentStatusCompleted {
			out["result_digest"] = lastMessage
		}
		out["truncated"] = true
	}
}

func trimSubagentToolResult(out map[string]any) map[string]any {
	out = projectSubagentToolResult(out)
	out["detail_omitted"] = true
	if strings.TrimSpace(anyToString(out["detail_strategy"])) == "" {
		out["detail_strategy"] = "ui_detail_api"
	}
	var items []map[string]any
	if strings.TrimSpace(anyToString(out["action"])) == subagentActionWait {
		items = boundedSubagentStatusItemsFromAny(out["items"])
	} else {
		items = boundedSubagentItems(subagentItemsFromAny(out["items"]))
	}
	if items != nil {
		out["items"] = items
	}
	body, err := json.Marshal(out)
	if err != nil || len(body) <= subagentToolResultHardBytes {
		return out
	}
	out["truncated"] = true
	for _, limit := range []int{480, 240, 120, 60} {
		shrinkSubagentToolItems(items, limit)
		out["items"] = items
		body, err = json.Marshal(out)
		if err != nil || len(body) <= subagentToolResultHardBytes {
			return out
		}
	}
	for len(items) > 1 {
		omitted := len(items) - maxInt(1, len(items)/2)
		items = items[:len(items)-omitted]
		out["items"] = items
		out["agent_count"] = len(items)
		out["omitted_count"] = parseIntRaw(out["omitted_count"], 0) + omitted
		body, err = json.Marshal(out)
		if err != nil || len(body) <= subagentToolResultHardBytes {
			return out
		}
	}
	out = minimalSubagentToolResult(out, items)
	body, err = json.Marshal(out)
	if err != nil || len(body) <= subagentToolResultHardBytes {
		return out
	}
	delete(out, "items")
	out["agent_count"] = 0
	out["items_omitted"] = true
	return out
}

func projectSubagentToolResult(in map[string]any) map[string]any {
	allowed := subagentToolResultAllowedKeys()
	out := make(map[string]any, len(in))
	for key, value := range in {
		if _, ok := allowed[key]; ok {
			out[key] = value
		}
	}
	return out
}

func subagentToolResultAllowedKeys() map[string]struct{} {
	return stringSet(
		"status", "action", "accepted", "thread_id", "agent_type",
		"context_mode", "task_name", "task_description", "items",
		"agent_count", "counts", "detail_omitted", "detail_strategy",
		"ids", "target_ids", "requested_ids", "requested_count",
		"requested_timeout_ms", "effective_timeout_ms", "timeout_ms",
		"timeout_source", "timed_out", "progress_summary",
		"final_handoff_report", "found_count", "missing_count", "missing_ids",
		"target", "closed", "stopped", "closed_count", "stopped_count",
		"affected_ids", "scope", "total", "running_only", "updated_at_unix_ms",
		"omitted_count", "truncated", "items_omitted", "error",
	)
}

func normalizeSubagentContextMode(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case subagentContextModeFullHistory:
		return subagentContextModeFullHistory
	default:
		return subagentContextModeMissionOnly
	}
}

func subagentForkModeForContextMode(mode string) flruntime.SubAgentForkMode {
	switch normalizeSubagentContextMode(mode) {
	case subagentContextModeFullHistory:
		return flruntime.SubAgentForkFullPath
	default:
		return flruntime.SubAgentForkNone
	}
}

func contextModeForSubagentForkMode(mode flruntime.SubAgentForkMode) string {
	switch mode {
	case flruntime.SubAgentForkFullPath:
		return subagentContextModeFullHistory
	default:
		return subagentContextModeMissionOnly
	}
}

func buildSubagentFinalHandoffReport(parent *run, snapshots []subagentSnapshot, contract subagentCapabilityContract) map[string]any {
	report := subagentFinalHandoffReport{
		Summary:                subagentCompletionSummary(snapshots),
		Reports:                []subagentHandoffReportItem{},
		Evidence:               []string{},
		ChangedFiles:           []string{},
		Verification:           []string{},
		OpenRisks:              []string{},
		SuggestedParentActions: []string{},
	}
	perReportBudget := 520
	if len(snapshots) > 0 && contract.FinalHandoffBudget > 0 {
		perReportBudget = maxInt(180, contract.FinalHandoffBudget/maxInt(1, len(snapshots)))
	}
	for _, item := range snapshots {
		status := strings.TrimSpace(item.Status)
		taskName := strings.TrimSpace(item.TaskName)
		finalHandoff := truncateRunes(strings.TrimSpace(item.LastMessage), perReportBudget)
		if status == subagentStatusCompleted || status == subagentStatusFailed || status == subagentStatusCanceled || status == subagentStatusTimedOut {
			report.Reports = append(report.Reports, subagentHandoffReportItem{
				ThreadID:  strings.TrimSpace(item.ThreadID),
				TaskName:  taskName,
				AgentType: strings.TrimSpace(item.AgentType),
				Status:    status,
				Handoff:   finalHandoff,
			})
		}
		if taskName != "" && status != subagentStatusQueued {
			report.Verification = appendLimited(report.Verification, taskName+": "+status, 5)
		}
		if status == subagentStatusFailed || status == subagentStatusTimedOut {
			report.OpenRisks = appendLimited(report.OpenRisks, subagentStatusLine(item), 5)
		}
	}
	if contract.ForkMode == flruntime.SubAgentForkFullPath {
		report.SuggestedParentActions = appendLimited(report.SuggestedParentActions, "Review the inherited context and decide whether additional parent follow-up is needed.", 4)
	}
	if parent != nil && parent.subagentDepth > 0 {
		report.SuggestedParentActions = appendLimited(report.SuggestedParentActions, "Keep the next parent reply concise and target the remaining blocker or verification step.", 4)
	}
	return trimSubagentDecisionPayload(map[string]any{
		"summary":                  report.Summary,
		"reports":                  report.Reports,
		"evidence":                 report.Evidence,
		"changed_files":            report.ChangedFiles,
		"verification":             report.Verification,
		"open_risks":               report.OpenRisks,
		"suggested_parent_actions": report.SuggestedParentActions,
	}, contract.FinalHandoffBudget)
}

func buildSubagentProgressSummary(parent *run, snapshots []subagentSnapshot, contract subagentCapabilityContract) map[string]any {
	summary := subagentProgressSummary{
		Summary:                subagentProgressHeadline(snapshots),
		Items:                  []subagentProgressSummaryItem{},
		CurrentState:           subagentAggregateCurrentState(snapshots),
		Blockers:               []string{},
		NextExpectedStep:       "Continue watching progress or intervene if a child is blocked.",
		SuggestedParentActions: []string{},
	}
	for _, item := range snapshots {
		status := strings.TrimSpace(item.Status)
		currentSignal := ""
		if status == subagentStatusWaiting {
			currentSignal = truncateRunes(strings.TrimSpace(item.WaitingPrompt), 220)
		}
		summary.Items = append(summary.Items, subagentProgressSummaryItem{
			ThreadID:      strings.TrimSpace(item.ThreadID),
			TaskName:      strings.TrimSpace(item.TaskName),
			AgentType:     strings.TrimSpace(item.AgentType),
			Status:        status,
			CurrentSignal: currentSignal,
		})
		if status == subagentStatusWaiting || status == subagentStatusFailed || status == subagentStatusTimedOut {
			summary.Blockers = appendLimited(summary.Blockers, subagentStatusLine(item), 5)
		}
	}
	if contract.ForkMode == flruntime.SubAgentForkFullPath {
		summary.SuggestedParentActions = appendLimited(summary.SuggestedParentActions, "Keep the inherited context available until the child settles.", 4)
	}
	return trimSubagentDecisionPayload(map[string]any{
		"summary":                  summary.Summary,
		"items":                    summary.Items,
		"current_state":            summary.CurrentState,
		"blockers":                 summary.Blockers,
		"next_expected_step":       summary.NextExpectedStep,
		"suggested_parent_actions": summary.SuggestedParentActions,
	}, contract.ProgressSummaryBudget)
}

func subagentCompletionSummary(snapshots []subagentSnapshot) string {
	if len(snapshots) == 0 {
		return "No delegated subagents matched the wait request."
	}
	counts := map[string]int{}
	for _, snapshot := range snapshots {
		counts[strings.TrimSpace(snapshot.Status)]++
	}
	parts := make([]string, 0, 4)
	for _, status := range []string{subagentStatusCompleted, subagentStatusFailed, subagentStatusCanceled, subagentStatusTimedOut} {
		if count := counts[status]; count > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", count, status))
		}
	}
	if len(parts) == 0 {
		return fmt.Sprintf("%d delegated subagent(s) returned from wait.", len(snapshots))
	}
	return "Delegated subagents finished wait: " + strings.Join(parts, ", ") + "."
}

func subagentProgressHeadline(snapshots []subagentSnapshot) string {
	if len(snapshots) == 0 {
		return "No delegated subagents matched the timed wait request."
	}
	active := 0
	waiting := 0
	for _, snapshot := range snapshots {
		switch strings.TrimSpace(snapshot.Status) {
		case subagentStatusRunning, subagentStatusQueued:
			active++
		case subagentStatusWaiting:
			waiting++
		}
	}
	if waiting > 0 {
		return fmt.Sprintf("Timed wait returned while %d subagent(s) need attention and %d remain active.", waiting, active)
	}
	return fmt.Sprintf("Timed wait returned while %d subagent(s) remain active.", active)
}

func subagentAggregateCurrentState(snapshots []subagentSnapshot) string {
	for _, snapshot := range snapshots {
		if strings.TrimSpace(snapshot.Status) == subagentStatusWaiting {
			return subagentStatusWaiting
		}
	}
	for _, snapshot := range snapshots {
		status := strings.TrimSpace(snapshot.Status)
		if status == subagentStatusRunning || status == subagentStatusQueued {
			return subagentStatusRunning
		}
	}
	if len(snapshots) == 0 {
		return "empty"
	}
	return "settled"
}

func subagentStatusLine(item subagentSnapshot) string {
	taskName := strings.TrimSpace(item.TaskName)
	if taskName == "" {
		taskName = strings.TrimSpace(item.ThreadID)
	}
	status := strings.TrimSpace(item.Status)
	if status == "" {
		status = "unknown"
	}
	return strings.TrimSpace(taskName + ": " + status)
}

func trimSubagentDecisionPayload(out map[string]any, budget int) map[string]any {
	if budget <= 0 {
		budget = 600
	}
	hardBytes := maxInt(512, budget*6)
	body, err := json.Marshal(out)
	if err != nil || len(body) <= hardBytes {
		return out
	}
	out["truncated"] = true
	shrinkStringSlicesInMap(out, []string{"evidence", "verification", "open_risks", "suggested_parent_actions"}, 180)
	if reports, ok := out["reports"].([]subagentHandoffReportItem); ok {
		for i := range reports {
			reports[i].Handoff = truncateRunes(reports[i].Handoff, 320)
		}
		out["reports"] = reports
	}
	if items, ok := out["items"].([]subagentProgressSummaryItem); ok {
		for i := range items {
			items[i].CurrentSignal = truncateRunes(items[i].CurrentSignal, 180)
		}
		out["items"] = items
	}
	body, err = json.Marshal(out)
	if err != nil || len(body) <= hardBytes {
		return out
	}
	if reports, ok := out["reports"].([]subagentHandoffReportItem); ok && len(reports) > 3 {
		out["reports"] = reports[:3]
		out["omitted_reports"] = len(reports) - 3
	}
	if items, ok := out["items"].([]subagentProgressSummaryItem); ok && len(items) > 5 {
		out["items"] = items[:5]
		out["omitted_items"] = len(items) - 5
	}
	return out
}

func shrinkStringSlicesInMap(out map[string]any, keys []string, limit int) {
	for _, key := range keys {
		values, ok := out[key].([]string)
		if !ok {
			continue
		}
		for i := range values {
			values[i] = truncateRunes(values[i], limit)
		}
		out[key] = values
	}
}

func subagentItemsFromAny(raw any) []map[string]any {
	switch typed := raw.(type) {
	case []map[string]any:
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, cloneAnyMap(item))
		}
		return out
	case []any:
		out := make([]map[string]any, 0, len(typed))
		for _, value := range typed {
			item, ok := value.(map[string]any)
			if ok {
				out = append(out, cloneAnyMap(item))
			}
		}
		return out
	default:
		return nil
	}
}

func shrinkSubagentToolItems(items []map[string]any, maxRunes int) {
	for _, item := range items {
		for _, key := range []string{"waiting_prompt", "last_message", "result_digest", "task_name"} {
			if text := strings.TrimSpace(anyToString(item[key])); text != "" {
				item[key] = truncateRunes(text, maxRunes)
				item["truncated"] = true
			}
		}
	}
}

func minimalSubagentToolResult(out map[string]any, items []map[string]any) map[string]any {
	minimalItems := make([]map[string]any, 0, len(items))
	for _, item := range items {
		threadID := strings.TrimSpace(anyToString(item["thread_id"]))
		minimalItems = append(minimalItems, map[string]any{
			"thread_id":        threadID,
			"status":           strings.TrimSpace(anyToString(item["status"])),
			"detail_available": anyToBool(item["detail_available"]) || threadID != "",
			"detail_ref":       subagentDetailRef(threadID),
			"detail_omitted":   true,
		})
	}
	minimal := map[string]any{
		"status":          strings.TrimSpace(anyToString(out["status"])),
		"action":          strings.TrimSpace(anyToString(out["action"])),
		"items":           minimalItems,
		"agent_count":     len(minimalItems),
		"counts":          out["counts"],
		"detail_omitted":  true,
		"detail_strategy": "ui_detail_api",
		"truncated":       true,
	}
	for _, key := range []string{
		"requested_timeout_ms", "effective_timeout_ms", "timeout_ms", "timeout_source",
		"timed_out", "requested_ids", "requested_count", "found_count", "missing_count",
		"missing_ids", "target", "ids", "target_ids", "closed_count", "stopped_count",
		"affected_ids", "scope", "total", "running_only", "updated_at_unix_ms",
		"omitted_count",
	} {
		if value, ok := out[key]; ok {
			minimal[key] = value
		}
	}
	return minimal
}

func subagentModelStatusCounts(items []map[string]any) map[string]int {
	counts := map[string]int{}
	for _, item := range items {
		status := strings.TrimSpace(anyToString(item["status"]))
		if status == "" {
			status = "unknown"
		}
		counts[status]++
	}
	return counts
}

func subagentDetailRef(threadID string) string {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return ""
	}
	return "subagent://" + threadID
}

func parseInt64Raw(v any, fallback int64) int64 {
	switch x := v.(type) {
	case int:
		return int64(x)
	case int64:
		return x
	case float64:
		return int64(x)
	case float32:
		return int64(x)
	default:
		return fallback
	}
}

func nonNegativeInt(v int) int {
	if v < 0 {
		return 0
	}
	return v
}

func nonNegativeInt64Local(v int64) int64 {
	if v < 0 {
		return 0
	}
	return v
}

func (s *floretSubagentRuntime) sendInput(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	host, err := s.ensureHost(ctx)
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(anyToString(args["target"]))
	if target == "" {
		return nil, errors.New("subagents send_input requires target")
	}
	agentType, err := s.subagentAgentTypeForTarget(ctx, host, target)
	if err != nil {
		return nil, err
	}
	childRunID, err := s.childRunIDForThread(target)
	if err != nil {
		return nil, err
	}
	inputRequestID, err := subagentInputRequestID(parent.threadID, target, toolCallID)
	if err != nil {
		return nil, err
	}
	snapshot, err := host.SendSubAgentInput(ctx, flruntime.SendSubAgentInputRequest{
		InputRequestID: inputRequestID,
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ChildThreadID:  flruntime.ThreadID(target),
		Message:        strings.TrimSpace(anyToString(args["message"])),
		Interrupt:      parseBoolArg(args, "interrupt", false),
		Labels:         s.runLabels(agentType, target, childRunID),
	})
	if err != nil {
		return nil, err
	}
	if err := validateSubAgentActionSnapshot(parent.threadID, target, snapshot, subagentActionSendInput); err != nil {
		return nil, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	s.refreshSubagentsPatch(ctx, localSnapshot)
	item := subagentSnapshotPayload(localSnapshot)
	bounded := boundedSubagentItem(item)
	return trimSubagentToolResult(map[string]any{
		"status":    "ok",
		"action":    subagentActionSendInput,
		"target":    target,
		"thread_id": bounded["thread_id"],
		"accepted":  true,
		"items":     []map[string]any{bounded},
	}), nil
}

func (s *floretSubagentRuntime) requireCurrentHostForSpawn(ctx context.Context, parent *run) error {
	if s == nil || parent == nil {
		return errors.New("subagent runtime unavailable")
	}
	want, err := parent.subagentHostConfigKey(ctx, resolvedSubagentRunModel{})
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	got := strings.TrimSpace(s.hostKey)
	if s.host != nil && got != "" && strings.TrimSpace(want) != "" && got != strings.TrimSpace(want) {
		return errors.New("subagent host configuration changed while active subagents exist; close existing subagents before spawning another child")
	}
	return nil
}

func (s *floretSubagentRuntime) subagentAgentTypeForTarget(ctx context.Context, host floretSubagentHost, target string) (string, error) {
	parent := s.parentRun()
	if parent == nil {
		return "", errors.New("subagent runtime unavailable")
	}
	if host == nil {
		return "", errors.New("subagent host unavailable")
	}
	target = strings.TrimSpace(target)
	if target == "" {
		return "", nil
	}
	snapshots, err := host.ListSubAgents(ctx, flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return "", err
	}
	for _, snapshot := range snapshots {
		if strings.TrimSpace(string(snapshot.ThreadID)) == target {
			return normalizeSubagentAgentType(snapshot.HostProfileRef), nil
		}
	}
	return "", errors.New("SubAgent target is not owned by the current parent")
}

func (s *floretSubagentRuntime) close(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	host, err := s.ensureHost(ctx)
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(anyToString(args["target"]))
	closeCtx, cancel, requestedTimeoutMS, effectiveTimeoutMS, timeoutSource := subagentActionTimeoutContext(ctx, args)
	defer cancel()
	snapshot, err := s.closeSubagentWithHost(closeCtx, host, parent, target, subagentCloseOperationID(parent.threadID, target, "user_close", toolCallID), "user_close")
	if err != nil {
		return nil, err
	}
	item := subagentSnapshotPayload(snapshot)
	bounded := boundedSubagentItem(item)
	out := map[string]any{
		"status":    "ok",
		"action":    subagentActionClose,
		"target":    target,
		"thread_id": bounded["thread_id"],
		"closed":    true,
		"stopped":   true,
		"items":     []map[string]any{bounded},
	}
	if err := s.cleanupTerminalProcessesForSnapshots(closeCtx, []subagentSnapshot{snapshot}); err != nil {
		return nil, fmt.Errorf("cleanup subagent terminal processes: %w", err)
	}
	return trimSubagentToolResult(applySubagentTimeoutFields(out, requestedTimeoutMS, effectiveTimeoutMS, timeoutSource)), nil
}

func (s *floretSubagentRuntime) closeSubagentWithHost(ctx context.Context, host floretSubagentHost, parent *run, target string, operationID string, reason string) (subagentSnapshot, error) {
	if host == nil {
		return subagentSnapshot{}, errors.New("subagent host unavailable")
	}
	if parent == nil {
		return subagentSnapshot{}, errors.New("subagent runtime unavailable")
	}
	target = strings.TrimSpace(target)
	snapshot, err := host.CloseSubAgent(ctx, flruntime.CloseSubAgentRequest{
		CloseOperationID: strings.TrimSpace(operationID),
		ParentThreadID:   flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ChildThreadID:    flruntime.ThreadID(target),
		Reason:           strings.TrimSpace(reason),
	})
	if err != nil {
		return subagentSnapshot{}, err
	}
	if err := validateSubAgentActionSnapshot(parent.threadID, target, snapshot, subagentActionClose); err != nil {
		return subagentSnapshot{}, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	s.refreshSubagentsPatch(ctx, localSnapshot)
	return localSnapshot, nil
}

func (s *floretSubagentRuntime) closeAllAction(ctx context.Context, toolCallID string, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	host, err := s.ensureHost(ctx)
	if err != nil {
		return nil, err
	}
	closeCtx, cancel, requestedTimeoutMS, effectiveTimeoutMS, timeoutSource := subagentActionTimeoutContext(ctx, args)
	defer cancel()
	result, err := closeSubagentsWithHost(closeCtx, host, strings.TrimSpace(parent.threadID), "parent_close_all", toolCallID)
	if err != nil {
		return nil, err
	}
	snapshots := make([]subagentSnapshot, 0, len(result))
	affected := make([]string, 0, len(result))
	closedCount := 0
	for _, snapshot := range result {
		if id := strings.TrimSpace(string(snapshot.ThreadID)); id != "" {
			affected = append(affected, id)
		}
		local := subagentSnapshotFromFloret(snapshot)
		if local.Closed {
			closedCount++
		}
		snapshots = append(snapshots, local)
	}
	s.refreshSubagentsPatch(closeCtx, snapshots...)
	items := make([]map[string]any, 0, len(snapshots))
	for _, snapshot := range snapshots {
		items = append(items, subagentSnapshotPayload(snapshot))
	}
	out := subagentBoundedResult(subagentActionCloseAll, items)
	out["scope"] = "current_run"
	out["closed_count"] = closedCount
	out["stopped_count"] = closedCount
	out["affected_ids"] = affected
	if err := s.cleanupTerminalProcessesForSnapshots(closeCtx, snapshots); err != nil {
		return nil, fmt.Errorf("cleanup subagent terminal processes: %w", err)
	}
	return trimSubagentToolResult(applySubagentTimeoutFields(out, requestedTimeoutMS, effectiveTimeoutMS, timeoutSource)), nil
}

func (s *floretSubagentRuntime) cleanupTerminalProcessesForTerminalSubagents(ctx context.Context) error {
	parent := s.parentRun()
	if parent == nil {
		return nil
	}
	host := s.currentHost()
	if host == nil {
		return nil
	}
	snapshots, err := host.ListSubAgents(ctx, flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return err
	}
	local := make([]subagentSnapshot, 0, len(snapshots))
	for _, snapshot := range snapshots {
		local = append(local, subagentSnapshotFromFloret(snapshot))
	}
	return s.cleanupTerminalProcessesForSnapshots(ctx, local)
}

func (r *run) cleanupSubagentTerminalProcesses(ctx context.Context) error {
	if r == nil || r.host.subagentRuntime == nil {
		return nil
	}
	runtime := r.host.subagentRuntime()
	if runtime == nil {
		return nil
	}
	return runtime.cleanupTerminalProcessesForTerminalSubagents(ctx)
}

func (s *Service) subagentRuntimeForParent(endpointID string, threadID string) *floretSubagentRuntime {
	if s == nil {
		return nil
	}
	endpointID = strings.TrimSpace(endpointID)
	threadID = strings.TrimSpace(threadID)
	if endpointID == "" || threadID == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.subagentRuntimes[runThreadKey(endpointID, threadID)]
}

func (s *floretSubagentRuntime) cleanupTerminalProcessesForSnapshots(ctx context.Context, snapshots []subagentSnapshot) error {
	parent := s.parentRun()
	if parent == nil || len(snapshots) == 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	var errs []error
	cleaned := 0
	for _, snapshot := range snapshots {
		if !isSubagentTerminalStatus(snapshot.Status) {
			continue
		}
		childThreadID := strings.TrimSpace(snapshot.ThreadID)
		childRunID, err := s.childRunIDForThread(childThreadID)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		execution, err := s.childExecutionCapabilities(ctx, childThreadID, childRunID)
		if err != nil {
			errs = append(errs, err)
			continue
		}
		processes := execution.host.terminal.ProcessesForRun(childRunID)
		for _, proc := range processes {
			settled, err := proc.finalizePendingForRunEnd(ctx)
			if settled {
				cleaned++
			}
			if err != nil {
				errs = append(errs, err)
			}
		}
	}
	if cleaned > 0 {
		parent.recordRunDiagnostic("delegation.terminal_cleanup", RealtimeStreamKindLifecycle, map[string]any{
			"settled_count": cleaned,
		})
	}
	if len(errs) > 0 {
		return errors.Join(errs...)
	}
	return nil
}

func (s *floretSubagentRuntime) closeAllExisting(ctx context.Context) error {
	if s == nil {
		return errors.New("subagent runtime unavailable")
	}
	parent := s.parentRun()
	if parent == nil {
		return errors.New("subagent parent authority unavailable")
	}
	host := s.currentHost()
	if host == nil {
		return errors.New("active SubAgent host unavailable")
	}
	_, err := closeSubagentsWithHost(ctx, host, strings.TrimSpace(parent.threadID), "parent_stop", strings.TrimSpace(parent.messageID))
	return err
}

func closeSubagentsWithHost(ctx context.Context, host floretSubagentHost, parentThreadID string, reason string, operationSeed string) ([]flruntime.SubAgentSnapshot, error) {
	if host == nil {
		return nil, errors.New("active SubAgent host unavailable")
	}
	parentThreadID = strings.TrimSpace(parentThreadID)
	reason = strings.TrimSpace(reason)
	if parentThreadID == "" || reason == "" {
		return nil, errors.New("SubAgent close authority identity is incomplete")
	}
	snapshots, err := host.ListSubAgents(ctx, flruntime.ThreadID(parentThreadID))
	if err != nil {
		return nil, err
	}
	result := make([]flruntime.SubAgentSnapshot, 0, len(snapshots))
	for _, snapshot := range snapshots {
		if !snapshot.CanClose || snapshot.Closed {
			result = append(result, snapshot)
			continue
		}
		childThreadID := strings.TrimSpace(string(snapshot.ThreadID))
		if childThreadID == "" {
			return nil, errors.New("Floret SubAgent snapshot is missing thread identity")
		}
		closed, err := host.CloseSubAgent(ctx, flruntime.CloseSubAgentRequest{
			CloseOperationID: subagentCloseOperationID(parentThreadID, childThreadID, reason, operationSeed),
			ParentThreadID:   flruntime.ThreadID(parentThreadID),
			ChildThreadID:    flruntime.ThreadID(childThreadID),
			Reason:           reason,
		})
		if err != nil {
			return nil, err
		}
		result = append(result, closed)
	}
	return result, nil
}

func subagentCloseOperationID(parentThreadID string, childThreadID string, reason string, seed string) string {
	sum := sha256.Sum256([]byte(strings.Join([]string{
		strings.TrimSpace(parentThreadID), strings.TrimSpace(childThreadID), strings.TrimSpace(reason), strings.TrimSpace(seed),
	}, "\x00")))
	return "subagent_close_" + hex.EncodeToString(sum[:18])
}

func subagentSpawnIdentities(parentThreadID string, parentTurnID string, toolCallID string) (string, string, string, error) {
	parentThreadID = strings.TrimSpace(parentThreadID)
	parentTurnID = strings.TrimSpace(parentTurnID)
	toolCallID = strings.TrimSpace(toolCallID)
	if parentThreadID == "" || parentTurnID == "" || toolCallID == "" {
		return "", "", "", errors.New("SubAgent publication identity is incomplete")
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{parentThreadID, parentTurnID, toolCallID}, "\x00")))
	suffix := hex.EncodeToString(sum[:18])
	return "subagent_publication_" + suffix, "th_" + suffix, "run_" + suffix, nil
}

func subagentInputRequestID(parentThreadID string, childThreadID string, toolCallID string) (string, error) {
	parentThreadID = strings.TrimSpace(parentThreadID)
	childThreadID = strings.TrimSpace(childThreadID)
	toolCallID = strings.TrimSpace(toolCallID)
	if parentThreadID == "" || childThreadID == "" || toolCallID == "" {
		return "", errors.New("SubAgent input request identity is incomplete")
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{parentThreadID, childThreadID, toolCallID}, "\x00")))
	return "subagent_input_" + hex.EncodeToString(sum[:18]), nil
}

func (s *floretSubagentRuntime) release() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.host = nil
	s.subagentsPatchQueued = nil
	s.closed = true
	s.mu.Unlock()
}

func (s *floretSubagentRuntime) snapshots(ctx context.Context) ([]subagentSnapshot, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	host, err := s.ensureHost(ctx)
	if err != nil {
		return nil, err
	}
	flSnapshots, err := host.ListSubAgents(ctx, flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return nil, err
	}
	out := make([]subagentSnapshot, 0, len(flSnapshots))
	for _, snapshot := range flSnapshots {
		local := subagentSnapshotFromFloret(snapshot)
		out = append(out, local)
	}
	s.refreshSubagentsPatch(ctx, out...)
	return out, nil
}

func (s *Service) ListFlowerSubagents(ctx context.Context, meta *session.Meta, parentThreadID string) ([]FlowerSubagentSummary, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return nil, errors.New("missing endpoint_id")
	}
	return s.listFlowerSubagentsForEndpoint(ctx, endpointID, parentThreadID)
}

func (s *Service) listFlowerSubagentsForEndpoint(ctx context.Context, endpointID string, parentThreadID string) ([]FlowerSubagentSummary, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	parentThreadID = strings.TrimSpace(parentThreadID)
	endpointID = strings.TrimSpace(endpointID)
	if endpointID == "" || parentThreadID == "" {
		return nil, errors.New("invalid request")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	parent, err := db.GetThreadSettings(ctxOrBackground(ctx), endpointID, parentThreadID)
	if err != nil {
		return nil, err
	}
	if parent == nil {
		return nil, sql.ErrNoRows
	}

	// Detached/UI reads must use the provider-free canonical read capability.
	// An interactive subagent host owns execution state and must not become a
	// second read authority merely because it is cached for a live runtime.
	host, err := s.openFloretSubagentReadHost(ctx, parentThreadID)
	if err != nil {
		return nil, err
	}
	snapshots, err := host.ListSubAgents(ctxOrBackground(ctx), flruntime.ThreadID(parentThreadID))
	if err != nil {
		return nil, err
	}
	out := make([]FlowerSubagentSummary, 0, len(snapshots))
	for _, snapshot := range snapshots {
		summary := flowerSubagentSummary(snapshot)
		if strings.TrimSpace(summary.ThreadID) == "" {
			return nil, errors.New("invalid Floret subagent list contract: empty child thread id")
		}
		if strings.TrimSpace(summary.ParentThreadID) != parentThreadID {
			return nil, fmt.Errorf("invalid Floret subagent list contract: child %q has parent %q, want %q", summary.ThreadID, summary.ParentThreadID, parentThreadID)
		}
		out = append(out, summary)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].UpdatedAtUnixMs == out[j].UpdatedAtUnixMs {
			return out[i].CreatedAtUnixMs > out[j].CreatedAtUnixMs
		}
		return out[i].UpdatedAtUnixMs > out[j].UpdatedAtUnixMs
	})
	return out, nil
}

func (s *Service) publishFlowerSubagentsPatch(ctx context.Context, endpointID string, parentThreadID string) {
	if s == nil {
		return
	}
	endpointID = strings.TrimSpace(endpointID)
	parentThreadID = strings.TrimSpace(parentThreadID)
	if endpointID == "" || parentThreadID == "" {
		return
	}
	subagents, err := s.listFlowerSubagentsForEndpoint(ctxOrBackground(ctx), endpointID, parentThreadID)
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai: failed to publish flower subagents patch", "endpoint_id", endpointID, "thread_id", parentThreadID, "error", err)
		}
		return
	}
	s.appendFlowerLiveEvent(FlowerLiveEvent{
		EndpointID: endpointID,
		ThreadID:   parentThreadID,
		AtUnixMs:   time.Now().UnixMilli(),
		Kind:       FlowerLiveThreadPatched,
		Payload: mustFlowerPayload(FlowerLiveThreadPatchedPayload{
			Patch: FlowerLiveThreadPatch{
				ThreadID:     parentThreadID,
				Subagents:    subagents,
				SubagentsSet: true,
			},
		}),
	})
}

func (s *Service) GetFlowerSubagentDetail(ctx context.Context, meta *session.Meta, parentThreadID string, childThreadID string, afterOrdinal int64, limit int) (*FlowerSubagentDetailResponse, error) {
	if s == nil {
		return nil, errors.New("nil service")
	}
	if err := requireRWX(meta); err != nil {
		return nil, err
	}
	parentThreadID = strings.TrimSpace(parentThreadID)
	childThreadID = strings.TrimSpace(childThreadID)
	if parentThreadID == "" || childThreadID == "" {
		return nil, errors.New("invalid request")
	}
	if afterOrdinal < 0 {
		return nil, errors.New("invalid after_ordinal")
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 500 {
		limit = 500
	}
	endpointID := strings.TrimSpace(meta.EndpointID)
	if endpointID == "" {
		return nil, errors.New("missing endpoint_id")
	}
	s.mu.Lock()
	db := s.threadsDB
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	parent, err := db.GetThreadSettings(ctxOrBackground(ctx), endpointID, parentThreadID)
	if err != nil {
		return nil, err
	}
	if parent == nil {
		return nil, sql.ErrNoRows
	}
	detailHost, err := s.openFloretSubagentReadHost(ctx, parentThreadID)
	if err != nil {
		return nil, err
	}
	detail, err := detailHost.ReadSubAgentDetail(ctxOrBackground(ctx), flruntime.ReadSubAgentDetailRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		ChildThreadID:  flruntime.ThreadID(childThreadID),
		AfterOrdinal:   afterOrdinal,
		Limit:          limit,
		IncludeRaw:     true,
	})
	if err != nil {
		if isFloretSubagentNotFoundError(err) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	resp, err := flowerSubagentDetailResponse(detail)
	if err != nil {
		if s.log != nil {
			s.log.Warn("ai: rejected Floret subagent detail contract", "thread_id", parentThreadID, "child_thread_id", childThreadID, "error", err)
		}
		return nil, fmt.Errorf("invalid Floret subagent detail contract: %w", err)
	}
	if strings.TrimSpace(resp.Summary.ParentThreadID) != parentThreadID || strings.TrimSpace(resp.Summary.ThreadID) != childThreadID {
		return nil, fmt.Errorf(
			"invalid Floret subagent detail contract: parent %q child %q, want parent %q child %q",
			resp.Summary.ParentThreadID,
			resp.Summary.ThreadID,
			parentThreadID,
			childThreadID,
		)
	}
	resp.Summary.ContextMode = contextModeForSubagentForkMode(detail.Snapshot.ForkMode)
	return &resp, nil
}

func isFloretSubagentNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, flruntime.ErrSubAgentNotFound)
}

func flowerSubagentDetailResponse(detail flruntime.SubAgentDetail) (FlowerSubagentDetailResponse, error) {
	if err := detail.Context.Validate(); err != nil {
		return FlowerSubagentDetailResponse{}, err
	}
	contextUsage, err := flowerSubagentDetailContextUsage(detail.Context)
	if err != nil {
		return FlowerSubagentDetailResponse{}, err
	}
	contextCompactions, err := flowerSubagentDetailContextCompactions(detail.Context)
	if err != nil {
		return FlowerSubagentDetailResponse{}, err
	}
	timelineDecorations, err := flowerSubagentDetailTimelineDecorations(detail, contextCompactions)
	if err != nil {
		return FlowerSubagentDetailResponse{}, err
	}
	return FlowerSubagentDetailResponse{
		Summary:             flowerSubagentSummary(detail.Snapshot),
		Timeline:            flowerSubagentTimelineRows(detail.Events),
		Activity:            flowerSubagentActivityBlockValue(detail.ActivityTimeline),
		ContextUsage:        contextUsage,
		ContextCompactions:  contextCompactions,
		TimelineDecorations: timelineDecorations,
		NextOrdinal:         detail.NextOrdinal,
		HasMore:             detail.HasMore,
		RetainedFrom:        detail.RetainedFrom,
		GeneratedAtMs:       timeUnixMS(detail.GeneratedAt),
	}, nil
}

func flowerSubagentDetailContextUsage(contextBlock flruntime.ThreadContextSnapshot) (*FlowerContextUsage, error) {
	if contextBlock.Usage == nil {
		return nil, nil
	}
	usage, err := flowerContextUsageFromFloret(contextBlock.Usage)
	if err != nil {
		return nil, err
	}
	return &usage, nil
}

func flowerSubagentDetailContextCompactions(contextBlock flruntime.ThreadContextSnapshot) ([]FlowerContextCompaction, error) {
	if len(contextBlock.Compactions) == 0 {
		return nil, nil
	}
	out := make([]FlowerContextCompaction, 0, len(contextBlock.Compactions))
	for _, compaction := range contextBlock.Compactions {
		projected, err := flowerContextCompactionFromFloret(&compaction)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(projected.OperationID) == "" {
			continue
		}
		out = append(out, projected)
	}
	return out, nil
}

func flowerSubagentDetailTimelineDecorations(detail flruntime.SubAgentDetail, compactions []FlowerContextCompaction) ([]FlowerTimelineDecoration, error) {
	if len(compactions) == 0 {
		return nil, nil
	}
	anchorsByOperationID, err := flowerSubagentDetailCompactionAnchors(detail)
	if err != nil {
		return nil, err
	}
	if len(anchorsByOperationID) == 0 {
		return nil, nil
	}
	out := make([]FlowerTimelineDecoration, 0, len(compactions))
	ordinalByAnchor := map[string]int{}
	for _, compaction := range compactions {
		operationID := strings.TrimSpace(compaction.OperationID)
		anchor, ok := anchorsByOperationID[operationID]
		if !ok {
			continue
		}
		anchorKey := strings.Join([]string{
			anchor.TargetKind,
			anchor.MessageID,
			fmt.Sprint(valueOrDefaultInt(anchor.BlockIndex, -1)),
			anchor.ActivityItemID,
			anchor.Edge,
		}, "\x1f")
		ordinal := ordinalByAnchor[anchorKey]
		ordinalByAnchor[anchorKey] = ordinal + 1
		out = append(out, FlowerTimelineDecoration{
			DecorationID: "subagent-context-compaction:" + operationID,
			Kind:         "context_compaction",
			Anchor:       anchor,
			Ordinal:      ordinal,
			Compaction:   compaction,
		})
	}
	return out, nil
}

func flowerSubagentDetailCompactionAnchors(detail flruntime.SubAgentDetail) (map[string]FlowerTimelineAnchor, error) {
	out := map[string]FlowerTimelineAnchor{}
	threadID := strings.TrimSpace(string(detail.Snapshot.ThreadID))
	if threadID == "" {
		return nil, errors.New("Floret subagent detail missing thread id")
	}
	events := append([]flruntime.ThreadDetailEvent(nil), detail.Events...)
	sort.SliceStable(events, func(i, j int) bool {
		return events[i].Ordinal < events[j].Ordinal
	})
	latestMessageByTurn := map[string]string{}
	for _, event := range events {
		if messageID := flowerSubagentVisibleMessageID(threadID, event); messageID != "" {
			latestMessageByTurn[strings.TrimSpace(string(event.TurnID))] = messageID
		}
		if event.Compaction == nil {
			continue
		}
		operationID := strings.TrimSpace(event.Compaction.OperationID)
		requestID := strings.TrimSpace(event.Compaction.RequestID)
		source := strings.TrimSpace(event.Compaction.Source)
		if operationID == "" || requestID == "" || source == "" {
			return nil, errors.New("Floret subagent compaction detail requires operation id, request id, and source")
		}
		turnID := strings.TrimSpace(string(event.TurnID))
		if turnID == "" {
			return nil, errors.New("Floret subagent compaction detail missing turn id")
		}
		messageID := strings.TrimSpace(latestMessageByTurn[turnID])
		if messageID == "" {
			continue
		}
		out[operationID] = FlowerTimelineAnchor{
			TargetKind: "message",
			MessageID:  messageID,
			Edge:       "after",
		}
	}
	return out, nil
}

func flowerSubagentVisibleMessageID(threadID string, event flruntime.ThreadDetailEvent) string {
	switch event.Kind {
	case flruntime.ThreadDetailEventUserMessage:
		if flowerSubagentRawDelegatedMission(event.Metadata) {
			return ""
		}
	case flruntime.ThreadDetailEventAssistantMessage, flruntime.ThreadDetailEventError:
	default:
		return ""
	}
	text := ""
	if event.Message != nil {
		text = strings.TrimSpace(event.Message.Preview)
	}
	if text == "" {
		text = strings.TrimSpace(event.Error)
	}
	if text == "" {
		return ""
	}
	suffix := "message"
	if event.Kind == flruntime.ThreadDetailEventError {
		suffix = "error"
	}
	return fmt.Sprintf("%s:%d:%s", flowerSubagentSafeIDPart(threadID), maxInt64(0, event.Ordinal), suffix)
}

func flowerSubagentRawDelegatedMission(metadata map[string]string) bool {
	if strings.TrimSpace(metadata["raw_omitted"]) == "true" {
		return false
	}
	return strings.TrimSpace(metadata["subagent_prompt_kind"]) == "delegated_mission"
}

func flowerSubagentSafeIDPart(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	invalid := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '.' || r == ':' || r == '-' {
			b.WriteRune(r)
			invalid = false
			continue
		}
		if !invalid {
			b.WriteByte('_')
			invalid = true
		}
	}
	out := b.String()
	if out == "" {
		return "subagent"
	}
	return out
}

func valueOrDefaultInt(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func flowerSubagentSummary(snapshot flruntime.SubAgentSnapshot) FlowerSubagentSummary {
	local := subagentSnapshotFromFloret(snapshot)
	return FlowerSubagentSummary{
		ParentThreadID:  local.ParentThreadID,
		ThreadID:        local.ThreadID,
		TaskName:        local.TaskName,
		TaskDescription: local.TaskDescription,
		AgentType:       local.AgentType,
		ContextMode:     normalizeSubagentContextMode(local.ContextMode),
		Status:          local.Status,
		LastMessage:     local.LastMessage,
		WaitingPrompt:   local.WaitingPrompt,
		QueuedInputs:    local.QueuedInputs,
		CanSendInput:    local.CanSendInput,
		CanInterrupt:    local.CanInterrupt,
		CanClose:        local.CanClose,
		CreatedAtUnixMs: local.CreatedAtMS,
		UpdatedAtUnixMs: local.UpdatedAtMS,
	}
}

func cloneFlowerSubagentSummaries(in []FlowerSubagentSummary) []FlowerSubagentSummary {
	if in == nil {
		return nil
	}
	out := make([]FlowerSubagentSummary, 0, len(in))
	for _, item := range in {
		item.ParentThreadID = strings.TrimSpace(item.ParentThreadID)
		item.ThreadID = strings.TrimSpace(item.ThreadID)
		item.TaskName = strings.TrimSpace(item.TaskName)
		item.TaskDescription = strings.TrimSpace(item.TaskDescription)
		item.AgentType = strings.TrimSpace(item.AgentType)
		item.ContextMode = normalizeSubagentContextMode(item.ContextMode)
		item.Status = strings.TrimSpace(item.Status)
		item.LastMessage = strings.TrimSpace(item.LastMessage)
		item.WaitingPrompt = strings.TrimSpace(item.WaitingPrompt)
		if item.ThreadID == "" {
			continue
		}
		out = append(out, item)
	}
	if len(out) == 0 {
		return []FlowerSubagentSummary{}
	}
	return out
}

func flowerSubagentTimelineRows(events []flruntime.ThreadDetailEvent) []FlowerSubagentTimelineRow {
	out := make([]FlowerSubagentTimelineRow, 0, len(events))
	for _, event := range events {
		out = append(out, flowerSubagentTimelineRow(event))
	}
	return out
}

func flowerSubagentTimelineRow(event flruntime.ThreadDetailEvent) FlowerSubagentTimelineRow {
	return FlowerSubagentTimelineRow{
		Ordinal:     event.Ordinal,
		Kind:        strings.TrimSpace(string(event.Kind)),
		Type:        strings.TrimSpace(event.Type),
		CreatedAtMs: timeUnixMS(event.CreatedAt),
		Message:     flowerSubagentDetailMessage(event.Message),
		ToolCall:    flowerSubagentToolCallView(event.ToolCall),
		ToolResult:  flowerSubagentToolResultView(event.ToolResult),
		Approval:    flowerSubagentApprovalView(event.Approval),
		TurnMarker:  flowerSubagentTurnMarkerView(event.TurnMarker),
		Compaction:  flowerSubagentCompactionView(event.Compaction),
		Generic:     flowerSubagentGenericView(event),
		Error:       strings.TrimSpace(event.Error),
		Metadata:    cloneStringMap(event.Metadata),
	}
}

func flowerSubagentActivityBlockValue(timeline observation.ActivityTimeline) *ActivityTimelineBlock {
	if len(timeline.Items) == 0 {
		return nil
	}
	block := newActivityTimelineBlock(timeline, nil)
	return &block
}

func flowerSubagentDetailMessage(in *flruntime.ThreadDetailMessage) *FlowerSubagentDetailMessage {
	if in == nil {
		return nil
	}
	text := strings.TrimSpace(in.Content)
	if text == "" {
		text = strings.TrimSpace(in.Preview)
	}
	out := &FlowerSubagentDetailMessage{
		Role:    strings.TrimSpace(in.Role),
		Text:    text,
		Preview: strings.TrimSpace(in.Preview),
	}
	for _, attachment := range in.Attachments {
		uploadID, err := uploadIDFromFloretResourceRef(attachment.ResourceRef)
		if err != nil {
			continue
		}
		out.Attachments = append(out.Attachments, FollowupAttachmentView{
			Name: strings.TrimSpace(attachment.Name), MimeType: strings.TrimSpace(attachment.MIMEType),
			URL: uploadURLPrefix + uploadID,
		})
	}
	return out
}

func flowerSubagentToolCallView(in *flruntime.ThreadDetailToolCall) *FlowerSubagentToolCallView {
	if in == nil {
		return nil
	}
	return &FlowerSubagentToolCallView{
		ID:          strings.TrimSpace(in.ID),
		Name:        strings.TrimSpace(in.Name),
		ArgsPreview: strings.TrimSpace(in.ArgsPreview),
		ArgsHash:    strings.TrimSpace(in.ArgsHash),
	}
}

func flowerSubagentToolResultView(in *flruntime.ThreadDetailToolResult) *FlowerSubagentToolResultView {
	if in == nil {
		return nil
	}
	return &FlowerSubagentToolResultView{
		CallID:        strings.TrimSpace(in.CallID),
		ToolName:      strings.TrimSpace(in.ToolName),
		Status:        strings.TrimSpace(in.Status),
		Preview:       strings.TrimSpace(in.Preview),
		Truncated:     in.Truncated,
		OriginalBytes: in.OriginalBytes,
		VisibleBytes:  in.VisibleBytes,
		OriginalLines: in.OriginalLines,
		VisibleLines:  in.VisibleLines,
		Strategy:      strings.TrimSpace(in.Strategy),
		ContentSHA256: strings.TrimSpace(in.ContentSHA256),
	}
}

func flowerSubagentApprovalView(in *flruntime.ThreadDetailApproval) *FlowerSubagentApprovalView {
	if in == nil {
		return nil
	}
	return &FlowerSubagentApprovalView{
		State:    strings.TrimSpace(in.State),
		ToolID:   strings.TrimSpace(in.ToolID),
		ToolName: strings.TrimSpace(in.ToolName),
		ToolKind: strings.TrimSpace(in.ToolKind),
		ArgsHash: strings.TrimSpace(in.ArgsHash),
		Reason:   strings.TrimSpace(in.Reason),
		Metadata: cloneStringMap(in.Metadata),
	}
}

func flowerSubagentTurnMarkerView(in *flruntime.ThreadDetailTurnMarker) *FlowerSubagentTurnMarkerView {
	if in == nil {
		return nil
	}
	return &FlowerSubagentTurnMarkerView{
		Status:   strings.TrimSpace(in.Status),
		Metadata: cloneStringMap(in.Metadata),
	}
}

func flowerSubagentCompactionView(in *flruntime.ThreadDetailCompaction) *FlowerSubagentCompactionView {
	if in == nil {
		return nil
	}
	return &FlowerSubagentCompactionView{
		Trigger:             strings.TrimSpace(in.Trigger),
		Reason:              strings.TrimSpace(in.Reason),
		Phase:               strings.TrimSpace(in.Phase),
		TokensBefore:        in.TokensBefore,
		TokensAfterEstimate: in.TokensAfterEstimate,
		Metadata:            cloneStringMap(in.Metadata),
	}
}

func flowerSubagentGenericView(event flruntime.ThreadDetailEvent) *FlowerSubagentGenericView {
	if event.Kind != flruntime.ThreadDetailEventCustom {
		return nil
	}
	title := strings.TrimSpace(event.Type)
	if title == "" {
		title = strings.TrimSpace(string(event.Kind))
	}
	body := ""
	if event.Message != nil {
		body = strings.TrimSpace(event.Message.Preview)
	}
	return &FlowerSubagentGenericView{
		Title:    title,
		Body:     body,
		Metadata: cloneStringMap(event.Metadata),
	}
}

func (s *floretSubagentRuntime) refreshSubagentsPatch(ctx context.Context, snapshots ...subagentSnapshot) {
	_ = snapshots
	s.publishParentSubagentsPatch(ctx)
}

func (s *floretSubagentRuntime) publishParentSubagentsPatch(ctx context.Context) {
	parent := s.parentRun()
	if parent == nil || parent.host.publishSubagentsPatch == nil {
		return
	}
	parent.host.publishSubagentsPatch(ctxOrBackground(ctx))
}

func aggregateSubagentContextMode(snapshots []subagentSnapshot) string {
	for _, snapshot := range snapshots {
		if normalizeSubagentContextMode(snapshot.ContextMode) == subagentContextModeFullHistory {
			return subagentContextModeFullHistory
		}
	}
	return subagentContextModeMissionOnly
}

func (s *floretSubagentRuntime) childRunIDForThread(childThreadID string) (string, error) {
	parent := s.parentRun()
	if parent == nil || parent.product.finalizedChildSnapshot == nil {
		return "", errors.New("SubAgent permission audit store is unavailable")
	}
	childThreadID = strings.TrimSpace(childThreadID)
	if childThreadID == "" {
		return "", errors.New("SubAgent child identity is incomplete")
	}
	lookupCtx, cancel := persistContextForRun(parent)
	defer cancel()
	rec, ok, err := parent.product.loadFinalizedChildSnapshot(lookupCtx, childThreadID)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", errors.New("SubAgent finalized permission audit is missing")
	}
	if strings.TrimSpace(rec.ParentThreadID) != strings.TrimSpace(parent.threadID) || strings.TrimSpace(rec.ChildThreadID) != childThreadID {
		return "", errors.New("SubAgent permission audit authority mismatch")
	}
	childRunID := strings.TrimSpace(rec.ChildRunID)
	if childRunID == "" || childRunID == childThreadID {
		return "", errors.New("SubAgent permission audit run identity is invalid")
	}
	return childRunID, nil
}

func validateSubAgentActionSnapshot(parentThreadID string, childThreadID string, snapshot flruntime.SubAgentSnapshot, action string) error {
	parentThreadID = strings.TrimSpace(parentThreadID)
	childThreadID = strings.TrimSpace(childThreadID)
	if parentThreadID == "" || childThreadID == "" ||
		strings.TrimSpace(string(snapshot.ParentThreadID)) != parentThreadID ||
		strings.TrimSpace(string(snapshot.ThreadID)) != childThreadID {
		return fmt.Errorf("Floret SubAgent %s result identity mismatch", strings.TrimSpace(action))
	}
	return nil
}

func (s *floretSubagentRuntime) runLabels(agentType string, childThreadID string, childRunID string) flruntime.RunLabels {
	parent := s.parentRun()
	if parent == nil {
		return flruntime.RunLabels{}
	}
	host := floretHostLabelsForRun(parent)
	childThreadID = strings.TrimSpace(childThreadID)
	if childThreadID != "" {
		host[subagentToolHostContextChildThreadIDKey] = childThreadID
	}
	childRunID = strings.TrimSpace(childRunID)
	if childRunID != "" && childRunID != childThreadID {
		host[subagentToolHostContextChildRunIDKey] = childRunID
	}
	if rawAgentType := strings.TrimSpace(agentType); rawAgentType != "" {
		normalized := normalizeSubagentAgentType(rawAgentType)
		host[subagentToolHostContextAgentTypeKey] = normalized
	}
	return flruntime.RunLabels{
		Correlation: map[string]string{
			"parent_run_id":    strings.TrimSpace(parent.id),
			"parent_thread_id": strings.TrimSpace(parent.threadID),
			"parent_turn_id":   strings.TrimSpace(parent.messageID),
			"child_run_id":     childRunID,
		},
		Host: host,
	}
}

type subagentStatusCounts struct {
	Queued    int
	Running   int
	Waiting   int
	Completed int
	Failed    int
	Canceled  int
	TimedOut  int
}

func (c *subagentStatusCounts) add(status string) {
	switch strings.TrimSpace(status) {
	case subagentStatusQueued:
		c.Queued++
	case subagentStatusRunning:
		c.Running++
	case subagentStatusWaiting:
		c.Waiting++
	case subagentStatusCompleted:
		c.Completed++
	case subagentStatusFailed:
		c.Failed++
	case subagentStatusCanceled:
		c.Canceled++
	case subagentStatusTimedOut:
		c.TimedOut++
	}
}

func (c subagentStatusCounts) payload() map[string]any {
	return map[string]any{
		"queued":        c.Queued,
		"running":       c.Running,
		"waiting_input": c.Waiting,
		"completed":     c.Completed,
		"failed":        c.Failed,
		"canceled":      c.Canceled,
		"timed_out":     c.TimedOut,
	}
}

func subagentSnapshotFromFloret(in flruntime.SubAgentSnapshot) subagentSnapshot {
	return subagentSnapshot{
		ThreadID:        strings.TrimSpace(string(in.ThreadID)),
		Path:            strings.TrimSpace(in.Path),
		TaskName:        strings.TrimSpace(in.TaskName),
		TaskDescription: strings.TrimSpace(in.TaskDescription),
		ParentThreadID:  strings.TrimSpace(string(in.ParentThreadID)),
		ParentTurnID:    strings.TrimSpace(string(in.ParentTurnID)),
		AgentType:       normalizeSubagentAgentType(in.HostProfileRef),
		ContextMode:     contextModeForSubagentForkMode(in.ForkMode),
		Status:          flowerSubagentStatus(in.Status),
		LatestTurnID:    strings.TrimSpace(string(in.LatestTurnID)),
		LastMessage:     strings.TrimSpace(in.LastMessage),
		WaitingPrompt:   strings.TrimSpace(in.WaitingPrompt),
		QueuedInputs:    in.QueuedInputs,
		CreatedAtMS:     timeUnixMS(in.CreatedAt),
		UpdatedAtMS:     timeUnixMS(in.UpdatedAt),
		Closed:          in.Closed,
		CanSendInput:    in.CanSendInput,
		CanInterrupt:    in.CanInterrupt,
		CanClose:        in.CanClose,
	}
}

func subagentSnapshotPayload(snapshot subagentSnapshot) map[string]any {
	lastMessage := strings.TrimSpace(snapshot.LastMessage)
	return map[string]any{
		"id":               snapshot.ThreadID,
		"thread_id":        snapshot.ThreadID,
		"agent_type":       snapshot.AgentType,
		"context_mode":     normalizeSubagentContextMode(snapshot.ContextMode),
		"task_name":        snapshot.TaskName,
		"task_description": snapshot.TaskDescription,
		"status":           snapshot.Status,
		"last_message":     lastMessage,
		"waiting_prompt":   snapshot.WaitingPrompt,
		"queued_inputs":    snapshot.QueuedInputs,
		"parent_thread_id": snapshot.ParentThreadID,
		"parent_turn_id":   snapshot.ParentTurnID,
		"latest_turn_id":   snapshot.LatestTurnID,
		"started_at_ms":    snapshot.CreatedAtMS,
		"created_at_ms":    snapshot.CreatedAtMS,
		"updated_at_ms":    snapshot.UpdatedAtMS,
		"closed":           snapshot.Closed,
		"can_send_input":   snapshot.CanSendInput,
		"can_interrupt":    snapshot.CanInterrupt,
		"can_close":        snapshot.CanClose,
	}
}

func parentNamespacePublicID(r *run) string {
	if r == nil || r.sessionMeta == nil {
		return ""
	}
	return strings.TrimSpace(r.sessionMeta.NamespacePublicID)
}

func subagentListPayload(snapshot subagentSnapshot) map[string]any {
	payload := subagentSnapshotPayload(snapshot)
	return map[string]any{
		"thread_id":        payload["thread_id"],
		"task_name":        payload["task_name"],
		"task_description": payload["task_description"],
		"agent_type":       payload["agent_type"],
		"context_mode":     payload["context_mode"],
		"status":           payload["status"],
		"updated_at_ms":    payload["updated_at_ms"],
		"last_message":     payload["last_message"],
		"can_send_input":   payload["can_send_input"],
		"can_interrupt":    payload["can_interrupt"],
		"can_close":        payload["can_close"],
	}
}

func flowerSubagentStatus(status flruntime.SubAgentStatus) string {
	switch status {
	case flruntime.SubAgentStatusIdle:
		return subagentStatusQueued
	case flruntime.SubAgentStatusRunning:
		return subagentStatusRunning
	case flruntime.SubAgentStatusWaiting, flruntime.SubAgentStatusInterrupted:
		return subagentStatusWaiting
	case flruntime.SubAgentStatusCompleted:
		return subagentStatusCompleted
	case flruntime.SubAgentStatusFailed:
		return subagentStatusFailed
	case flruntime.SubAgentStatusCancelled, flruntime.SubAgentStatusClosed:
		return subagentStatusCanceled
	default:
		value := strings.TrimSpace(string(status))
		if value == "" {
			return subagentStatusQueued
		}
		return value
	}
}

func isSubagentTerminalStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case subagentStatusCompleted, subagentStatusFailed, subagentStatusCanceled, subagentStatusTimedOut:
		return true
	default:
		return false
	}
}

func normalizeSubagentAgentType(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if isValidSubagentAgentType(value) {
		return value
	}
	return subagentAgentTypeExplore
}

func isValidSubagentAgentType(agentType string) bool {
	switch strings.TrimSpace(strings.ToLower(agentType)) {
	case subagentAgentTypeExplore, subagentAgentTypeWorker, subagentAgentTypeReviewer:
		return true
	default:
		return false
	}
}

func timeUnixMS(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

type flowerSubagentPromptSpec struct {
	AgentType   string
	TaskName    string
	Message     string
	ContextMode string
	Contract    subagentCapabilityContract
}

func buildFlowerSubagentPrompt(spec flowerSubagentPromptSpec) string {
	agentType := normalizeSubagentAgentType(spec.AgentType)
	contract := spec.Contract
	lines := []string{
		"# Delegated Mission",
		strings.TrimSpace(spec.Message),
		"",
		"# Role",
		subagentRolePrompt(agentType),
		"",
		"# Operating Contract",
		"- You are working for the parent Flower thread, not directly for the end user.",
		"- Finish the delegated slice independently and verify concrete claims with tools when needed.",
		"- Do not delegate, spawn child work, or ask the user for input.",
		"- Return a final handoff report with: summary, evidence, changed files if any, verification, open risks, and suggested parent actions.",
	}
	if normalizeSubagentContextMode(spec.ContextMode) == subagentContextModeFullHistory {
		lines = append(lines, "- The parent explicitly granted full-history context; use it to ground decisions, but do not echo process detail back unless it is decision-relevant.")
	} else {
		lines = append(lines, "- The parent granted mission-only context; rely on the delegated mission, visible tools, and current evidence.")
	}
	if len(contract.VisibleTools) > 0 {
		lines = append(lines, "- Available tools: "+strings.Join(contract.VisibleTools, ", "))
	}
	if agentType != subagentAgentTypeWorker {
		lines = append(lines, "- This profile is readonly: inspect, reason, and report; do not edit files or run mutating commands.")
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func subagentRolePrompt(agentType string) string {
	switch normalizeSubagentAgentType(agentType) {
	case subagentAgentTypeWorker:
		return "Worker: implement or verify the assigned slice. Use mutating tools only when the delegated mission truly requires it and the parent/user policy allows it."
	case subagentAgentTypeReviewer:
		return "Reviewer: independently review code, design, tests, and risks. Prefer evidence, precise file references, and actionable findings."
	default:
		return "Explorer: investigate a bounded question, gather evidence, and report options or findings without changing the workspace."
	}
}

func (r *run) buildSubagentHostSystemPrompt(activeTools []ToolDef, contract subagentCapabilityContract) string {
	toolNames := make([]string, 0, len(activeTools))
	for _, def := range activeTools {
		if name := strings.TrimSpace(def.Name); name != "" {
			toolNames = append(toolNames, name)
		}
	}
	sort.Strings(toolNames)
	lines := []string{
		"You are Flower operating a delegated subagent thread.",
		"Complete only the mission given by the parent thread.",
		"Do not delegate, spawn child work, or ask the user for input, and keep your final handoff complete but focused.",
		"Use tools for evidence when needed, follow repository rules, and respect readonly constraints stated in the mission.",
		"When the arguments are fully known and calls do not depend on one another, emit those calls together in the same response.",
		"When a call depends on a previous result, wait for that result and emit the dependent call in a later response.",
		"The runtime does not infer dependencies or conflicts between calls; express dependencies through response boundaries.",
		"The visible tool list is the parent thread's maximum delegated surface; each mission may further restrict it through its profile and parent mode.",
	}
	if len(toolNames) > 0 {
		lines = append(lines, "Available tools: "+strings.Join(toolNames, ", "))
	}
	lines = append(lines, "Each delegated mission states its own context mode. Follow that mission-level context contract.")
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

type floretSubagentEventSink struct {
	runtime *floretSubagentRuntime
}

func (s floretSubagentEventSink) EmitEvent(ev flruntime.Event) {
	var parent *run
	if s.runtime != nil {
		parent = s.runtime.parentRun()
	}
	if parent == nil {
		return
	}
	parentThreadID := strings.TrimSpace(parent.threadID)
	eventThreadID := strings.TrimSpace(string(ev.ThreadID))
	if eventThreadID == "" || eventThreadID == parentThreadID {
		floretEventSink{run: parent}.EmitEvent(ev)
		return
	}
	if err := ev.Validate(); err != nil {
		parent.rejectFloretContract("subagent_event", err)
		return
	}
	if s.runtime != nil {
		s.runtime.scheduleParentSubagentsPatch(eventThreadID)
	}
}
