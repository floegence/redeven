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
	muParent sync.Mutex
	parent   *run

	mu             sync.Mutex
	host           flruntime.Host
	hostKey        string
	closed         bool
	timelineQueued map[string]struct{}
}

func newFloretSubagentRuntime(parent *run) *floretSubagentRuntime {
	runtime := &floretSubagentRuntime{}
	runtime.attachParentRun(parent)
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
	parent.persistRunEvent("delegation.manage.begin", RealtimeStreamKindLifecycle, map[string]any{
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
	if actions := flowerToolSubagentActivityActions(toolCallID, action, out); len(actions) > 0 {
		parent.upsertActivityTimelineSubagentActions(actions)
	}
	parent.persistRunEvent("delegation.manage.end", RealtimeStreamKindLifecycle, map[string]any{
		"action":       action,
		"tool_call_id": toolCallID,
		"status":       strings.TrimSpace(anyToString(out["status"])),
	})
	return out, nil
}

func (s *floretSubagentRuntime) ensureHost(ctx context.Context) (flruntime.Host, error) {
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

	hostKey, err := parent.subagentHostConfigKey()
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
		_ = s.host.Close()
		s.host = nil
		s.hostKey = ""
	}
	host, err := s.newHostLocked(parent)
	if err != nil {
		return nil, err
	}
	s.host = host
	s.hostKey = hostKey
	if err := ensureFloretThread(ctx, host, flruntime.ThreadID(strings.TrimSpace(parent.threadID))); err != nil {
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

func (s *floretSubagentRuntime) currentHost() flruntime.Host {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.host
}

func (s *floretSubagentRuntime) scheduleParentSubagentTimelineRefresh(threadID string) {
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
	if s.timelineQueued == nil {
		s.timelineQueued = map[string]struct{}{}
	}
	if _, exists := s.timelineQueued[threadID]; exists {
		s.mu.Unlock()
		return
	}
	s.timelineQueued[threadID] = struct{}{}
	s.mu.Unlock()

	go func() {
		timer := time.NewTimer(150 * time.Millisecond)
		defer timer.Stop()
		<-timer.C
		defer func() {
			s.mu.Lock()
			delete(s.timelineQueued, threadID)
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
		s.publishParentSubagentTimeline(ctx)
	}()
}

func (s *floretSubagentRuntime) newHostLocked(parent *run) (flruntime.Host, error) {
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	resolved, err := parent.resolveSubagentModelGateway()
	if err != nil {
		return nil, err
	}
	providerType := strings.ToLower(strings.TrimSpace(resolved.provider.Type))
	modelName := strings.TrimSpace(resolved.modelName)
	adapter := resolved.adapterOverride
	if adapter == nil {
		adapter, err = newProviderAdapter(providerType, strings.TrimSpace(resolved.provider.BaseURL), strings.TrimSpace(resolved.apiKey), resolved.provider.StrictToolSchema)
		if err != nil {
			return nil, err
		}
	}
	webSearchCapability := resolveProviderWebSearchCapability(resolved.provider, modelName)
	if enableFlowerWebSearchTool(resolved.provider, webSearchCapability) {
		webSearchCapability.RegisterTool = true
	}
	parent.webSearchMode = webSearchCapability.Mode
	parent.webSearchToolEnabled = webSearchCapability.RegisterTool

	modelCapability := parent.resolveRunModelCapability(parent.currentModelID)
	childRun := parent.subagentChildRun()
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, childRun); err != nil {
		return nil, err
	}
	activeTools, childContract := childRun.subagentToolSurface(registry.Snapshot(), flruntime.SubAgentForkNone)
	state := newFloretToolRuntimeState(newRuntimeState("subagents"))
	flTools, err := buildFloretToolRegistry(childRun, activeTools, state)
	if err != nil {
		return nil, err
	}
	flProvider := newFloretProviderAdapter(
		adapter,
		providerType,
		modelName,
		ProviderControls{
			ReasoningSelection:  config.NormalizeAIReasoningSelection(parent.currentReasoning),
			ReasoningCapability: modelCapability.ReasoningCapability,
		},
		TurnBudgets{},
		parent.webSearchMode,
		withDisabledFloretCoreControlTools(childContract.HiddenControlTools...),
	)
	store, err := parent.openFloretThreadStore()
	if err != nil {
		return nil, err
	}
	systemPrompt := parent.buildSubagentHostSystemPrompt(activeTools, childContract)
	surfaceProvider := s.dynamicSubagentToolSurfaceProvider(state)
	contextWindow := modelGatewayDefaultContextWindowTokens
	if modelCapability.MaxContextTokens > 0 {
		contextWindow = modelCapability.MaxContextTokens
	}
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config:               flconfig.Config{SystemPrompt: systemPrompt, ContextPolicy: floretModelContextPolicy(contextWindow, 0), Reasoning: config.NormalizeAIReasoningSelection(parent.currentReasoning)},
		ModelGateway:         flProvider,
		ModelGatewayIdentity: redevenFloretGatewayIdentity(resolved.provider.ID, modelName),
		Store:                store,
		Tools:                flTools,
		Approver:             floretToolApproverForRun(childRun),
		Sink:                 floretSubagentEventSink{runtime: s},
		ToolSurfaceProvider:  surfaceProvider,
		SubAgentRunTimeout:   subagentRunTimeout,
		LoopLimits: flruntime.LoopLimits{
			NoProgressLimit:    2,
			DuplicateToolLimit: 3,
		},
	})
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	return host, nil
}

func (r *run) subagentHostConfigKey() (string, error) {
	if r == nil {
		return "", errors.New("nil run")
	}
	resolved, err := r.resolveSubagentModelGateway()
	if err != nil {
		return "", err
	}
	providerAPIKeyDigest := ""
	if strings.TrimSpace(resolved.apiKey) != "" {
		providerAPIKeyDigest = stableSecretDigest(resolved.apiKey)
	}
	webSearchCapability := resolveProviderWebSearchCapability(resolved.provider, strings.TrimSpace(resolved.modelName))
	webSearchKeyDigest := ""
	webSearchKeyState := "unused"
	if enableFlowerWebSearchTool(resolved.provider, webSearchCapability) && r.resolveWebSearchKey != nil {
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
		"model_id":             strings.TrimSpace(r.currentModelID),
		"provider_id":          strings.TrimSpace(resolved.provider.ID),
		"provider_type":        strings.TrimSpace(resolved.provider.Type),
		"provider_base_url":    strings.TrimSpace(resolved.provider.BaseURL),
		"provider_api_key":     providerAPIKeyDigest,
		"model_name":           strings.TrimSpace(resolved.modelName),
		"reasoning_selection":  config.NormalizeAIReasoningSelection(r.currentReasoning),
		"strict_tool_schema":   resolved.provider.StrictToolSchema,
		"web_search_mode":      providerWebSearchConfigKey(resolved.provider.WebSearch),
		"web_search_resolved":  webSearchCapability.Mode,
		"web_search_tool":      enableFlowerWebSearchTool(resolved.provider, webSearchCapability),
		"web_search_key_state": webSearchKeyState,
		"web_search_api_key":   webSearchKeyDigest,
		"adapter_override":     resolved.adapterOverride != nil,
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

func providerWebSearchConfigKey(in *config.AIProviderWebSearch) map[string]string {
	if in == nil {
		return nil
	}
	return map[string]string{
		"mode": strings.ToLower(strings.TrimSpace(in.Mode)),
	}
}

func (r *run) resolveSubagentModelGateway() (resolvedRunModelGateway, error) {
	if r == nil {
		return resolvedRunModelGateway{}, errors.New("nil run")
	}
	modelID := strings.TrimSpace(r.currentModelID)
	if modelID == "" && r.cfg != nil {
		if def := strings.TrimSpace(r.cfg.CurrentModelID); def != "" && r.cfg.IsAllowedModelID(def) {
			modelID = def
		}
	}
	if modelID == "" {
		return resolvedRunModelGateway{}, fmt.Errorf("missing model for subagent")
	}
	providerID, _, ok := strings.Cut(modelID, "/")
	resolved, err := r.resolveModelGatewayForModel(modelID, strings.TrimSpace(providerID), ok)
	if err != nil {
		return resolvedRunModelGateway{}, err
	}
	if strings.TrimSpace(resolved.userMessage) != "" {
		return resolvedRunModelGateway{}, resolved.err
	}
	if strings.TrimSpace(resolved.modelName) == "" {
		return resolvedRunModelGateway{}, fmt.Errorf("missing model name for subagent")
	}
	return resolved, nil
}

func (r *run) subagentChildRun() *run {
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
		Service:               r.service,
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
		ThreadsDB:             r.threadsDB,
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
	child.permissionType = subagentPermissionLimit(r)
	child.currentModelID = r.currentModelID
	child.currentReasoning = config.NormalizeAIReasoningSelection(r.currentReasoning)
	child.subagentDepth = r.subagentDepth + 1
	child.allowSubagentDelegate = false
	child.noUserInteraction = true
	child.allowDelegatedApproval = true
	child.delegatedApprovalParent = r
	if len(r.permissionSnapshot.VisibleToolNames) > 0 {
		child.toolAllowlist = stringSet(r.permissionSnapshot.VisibleToolNames...)
	}
	return child
}

func subagentPermissionLimit(parent *run) FlowerPermissionType {
	if parent == nil || parent.permissionType == "" {
		return FlowerPermissionApprovalRequired
	}
	return parent.permissionType
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
		childRun := parent.subagentChildRun()
		if childRun == nil {
			return flruntime.ToolSurface{}, errors.New("subagent child runtime unavailable")
		}
		childThreadID := strings.TrimSpace(string(req.ThreadID))
		if childThreadID == "" {
			childThreadID = strings.TrimSpace(req.HostContext[subagentToolHostContextChildThreadIDKey])
		}
		childRunID := strings.TrimSpace(req.HostContext[subagentToolHostContextChildRunIDKey])
		if childRunID == "" {
			return flruntime.ToolSurface{}, errors.New("missing subagent child run identity")
		}
		childRun.threadID = childThreadID
		childRun.id = childRunID
		childRun.messageID = strings.TrimSpace(string(req.TurnID))
		childRun.permissionType = parent.currentThreadPermissionType(ctx, subagentPermissionLimit(parent))
		registry := NewInMemoryToolRegistry()
		if err := registerBuiltInTools(registry, childRun); err != nil {
			return flruntime.ToolSurface{}, err
		}
		forkMode, err := s.childForkModeForThread(ctx, childThreadID)
		if err != nil {
			parent.persistRunEvent("subagent.tool_surface.error", RealtimeStreamKindLifecycle, map[string]any{
				"phase":           strings.TrimSpace(req.Phase),
				"step":            req.Step,
				"subagent_id":     childThreadID,
				"child_thread_id": childThreadID,
				"child_run_id":    childRunID,
				"error":           err.Error(),
			})
			return flruntime.ToolSurface{}, err
		}
		activeTools, childContract := childRun.subagentToolSurface(registry.Snapshot(), forkMode)
		childSnapshot := permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(childRun.permissionType, activeTools, nil), parent.endpointID, childThreadID, childRunID)
		childRun.permissionSnapshot = childSnapshot
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
			hostContext[subagentToolHostContextSubagentIDKey] = childThreadID
		}
		if childRunID != "" && childRunID != childThreadID {
			hostContext[subagentToolHostContextChildRunIDKey] = childRunID
		}
		hostContext[subagentToolHostContextParentPermissionKey] = permissionTypeString(childRun.permissionType)
		epoch := permissionSurfaceEpoch(childSnapshot)
		key := firstNonEmptyString(childThreadID, strings.TrimSpace(string(req.PromptScopeID)), "subagent")
		mu.Lock()
		changed := epoch != "" && lastEpochByThread[key] != epoch
		if changed {
			lastEpochByThread[key] = epoch
		}
		mu.Unlock()
		if changed {
			parent.persistRunEvent("subagent.tool_surface.updated", RealtimeStreamKindLifecycle, map[string]any{
				"phase":             strings.TrimSpace(req.Phase),
				"step":              req.Step,
				"subagent_id":       childThreadID,
				"child_thread_id":   childThreadID,
				"child_run_id":      childRunID,
				"permission_type":   permissionTypeString(childRun.permissionType),
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

func ensureFloretThread(ctx context.Context, host flruntime.Host, threadID flruntime.ThreadID) error {
	if host == nil {
		return errors.New("subagent host unavailable")
	}
	if strings.TrimSpace(string(threadID)) == "" {
		return errors.New("missing parent thread id")
	}
	_, err := host.EnsureThread(ctx, flruntime.EnsureThreadRequest{ThreadID: threadID})
	return err
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
	if err := s.requireCurrentHostForSpawn(parent); err != nil {
		return nil, err
	}
	agentType := normalizeSubagentAgentType(anyToString(args["agent_type"]))
	taskName := strings.TrimSpace(anyToString(args["task_name"]))
	if taskName == "" {
		taskName = strings.TrimSpace(anyToString(args["title"]))
	}
	taskDescription := strings.TrimSpace(anyToString(args["task_description"]))
	if taskDescription == "" {
		return nil, errors.New("subagents spawn requires task_description")
	}
	message := strings.TrimSpace(anyToString(args["message"]))
	objective := strings.TrimSpace(anyToString(args["objective"]))
	if message == "" {
		message = objective
	}
	if taskName == "" {
		taskName = deriveSubagentTaskName(message)
	}
	contextMode := normalizeSubagentContextMode(anyToString(args["context_mode"]))
	forkMode := subagentForkModeForContextMode(contextMode)
	childThreadID, err := NewThreadID()
	if err != nil {
		return nil, err
	}
	childRun := parent.subagentChildRun()
	childRunID, err := NewRunID()
	if err != nil {
		return nil, err
	}
	childRunID = strings.TrimSpace(childRunID)
	if childRunID == "" || childRunID == childThreadID {
		return nil, errors.New("invalid child run identity")
	}
	childRun.id = childRunID
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, childRun); err != nil {
		return nil, err
	}
	activeChildTools, childContract := childRun.subagentToolSurface(registry.Snapshot(), forkMode)
	childSnapshot := permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(childRun.permissionType, activeChildTools, nil), parent.endpointID, childThreadID, childRunID)
	childRun.permissionSnapshot = childSnapshot
	if err := parent.insertChildPermissionSnapshotProvisional(childThreadID, childRunID, toolCallID, childSnapshot); err != nil {
		return nil, fmt.Errorf("persist provisional child permission snapshot: %w", err)
	}
	prompt := buildFlowerSubagentPrompt(flowerSubagentPromptSpec{
		AgentType:   agentType,
		TaskName:    taskName,
		Message:     message,
		Objective:   objective,
		ContextMode: contextMode,
		Contract:    childContract,
	})
	snapshot, err := host.SpawnSubAgent(ctx, flruntime.SpawnSubAgentRequest{
		ParentThreadID:  flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ParentTurnID:    flruntime.TurnID(strings.TrimSpace(parent.messageID)),
		ThreadID:        flruntime.ThreadID(childThreadID),
		TaskName:        taskName,
		TaskDescription: taskDescription,
		Message:         prompt,
		HostProfileRef:  agentType,
		ForkMode:        forkMode,
		Labels:          s.runLabels(agentType, childThreadID, childRunID),
	})
	if err != nil {
		return nil, err
	}
	if err := parent.finalizeChildPermissionSnapshot(childThreadID, childRunID, childSnapshot.SnapshotID); err != nil {
		return nil, fmt.Errorf("finalize child permission snapshot: %w", err)
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	s.refreshSubagentTimeline(ctx, localSnapshot)
	item := subagentSnapshotPayload(localSnapshot)
	parent.persistRunEvent("delegation.spawn", RealtimeStreamKindLifecycle, map[string]any{
		"subagent_id":      item["subagent_id"],
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
		"subagent_id":      bounded["subagent_id"],
		"thread_id":        bounded["thread_id"],
		"agent_type":       bounded["agent_type"],
		"context_mode":     bounded["context_mode"],
		"task_name":        bounded["task_name"],
		"task_description": bounded["task_description"],
		"title":            bounded["title"],
		"items":            []map[string]any{bounded},
	}), nil
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
	ids := extractStringSlice(args["ids"])
	childIDs := make([]flruntime.ThreadID, 0, len(ids))
	for _, id := range ids {
		if id = strings.TrimSpace(id); id != "" {
			childIDs = append(childIDs, flruntime.ThreadID(id))
		}
	}
	s.upsertRunningWaitToolSidecar(ctx, toolCallID, host, parent, childIDs)
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
	s.refreshSubagentTimeline(ctx, snapshots...)
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
	if threadID == "" {
		threadID = strings.TrimSpace(anyToString(item["subagent_id"]))
	}
	taskName := truncateRunes(strings.TrimSpace(anyToString(item["task_name"])), 180)
	taskDescription := truncateRunes(strings.TrimSpace(anyToString(item["task_description"])), 500)
	title := truncateRunes(firstNonEmptyString(taskName, strings.TrimSpace(anyToString(item["title"])), threadID), 180)
	return map[string]any{
		"subagent_id":        threadID,
		"thread_id":          threadID,
		"agent_type":         strings.TrimSpace(anyToString(item["agent_type"])),
		"context_mode":       normalizeSubagentContextMode(anyToString(item["context_mode"])),
		"title":              title,
		"task_name":          taskName,
		"task_description":   taskDescription,
		"status":             strings.TrimSpace(anyToString(item["status"])),
		"parent_thread_id":   strings.TrimSpace(anyToString(item["parent_thread_id"])),
		"started_at_ms":      nonNegativeInt64Local(parseInt64Raw(item["started_at_ms"], 0)),
		"created_at_ms":      nonNegativeInt64Local(parseInt64Raw(item["created_at_ms"], 0)),
		"updated_at_ms":      nonNegativeInt64Local(parseInt64Raw(item["updated_at_ms"], 0)),
		"detail_available":   threadID != "",
		"detail_ref":         subagentDetailRef(threadID),
		"detail_omitted":     true,
		"delegation_runtime": "floret",
	}
}

func boundedSubagentItem(item map[string]any) map[string]any {
	threadID := strings.TrimSpace(anyToString(item["thread_id"]))
	if threadID == "" {
		threadID = strings.TrimSpace(anyToString(item["subagent_id"]))
	}
	taskName := truncateRunes(strings.TrimSpace(anyToString(item["task_name"])), 180)
	taskDescription := truncateRunes(strings.TrimSpace(anyToString(item["task_description"])), 500)
	title := truncateRunes(firstNonEmptyString(taskName, strings.TrimSpace(anyToString(item["title"])), threadID), 180)
	lastMessage := truncateRunes(strings.TrimSpace(anyToString(item["last_message"])), 900)
	out := map[string]any{
		"subagent_id":        threadID,
		"thread_id":          threadID,
		"agent_type":         strings.TrimSpace(anyToString(item["agent_type"])),
		"context_mode":       normalizeSubagentContextMode(anyToString(item["context_mode"])),
		"title":              title,
		"task_name":          taskName,
		"task_description":   taskDescription,
		"status":             strings.TrimSpace(anyToString(item["status"])),
		"last_message":       lastMessage,
		"result_digest":      lastMessage,
		"waiting_prompt":     truncateRunes(strings.TrimSpace(anyToString(item["waiting_prompt"])), 700),
		"queued_inputs":      nonNegativeInt(parseIntRaw(item["queued_inputs"], 0)),
		"parent_thread_id":   strings.TrimSpace(anyToString(item["parent_thread_id"])),
		"created_at_ms":      nonNegativeInt64Local(parseInt64Raw(item["created_at_ms"], 0)),
		"updated_at_ms":      nonNegativeInt64Local(parseInt64Raw(item["updated_at_ms"], 0)),
		"closed":             anyToBool(item["closed"]),
		"can_send_input":     anyToBool(item["can_send_input"]),
		"can_interrupt":      anyToBool(item["can_interrupt"]),
		"can_close":          anyToBool(item["can_close"]),
		"detail_available":   threadID != "",
		"detail_ref":         subagentDetailRef(threadID),
		"detail_omitted":     true,
		"delegation_runtime": "floret",
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
	out = scrubSubagentForbiddenFields(cloneAnyMap(out))
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
		delete(out, "item")
	}
	body, err := json.Marshal(out)
	if err != nil || len(body) <= subagentToolResultHardBytes {
		return out
	}
	out["truncated"] = true
	for _, limit := range []int{480, 240, 120, 60} {
		shrinkSubagentToolItems(items, limit)
		out["items"] = items
		delete(out, "item")
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
		delete(out, "item")
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
	delete(out, "item")
	out["agent_count"] = 0
	out["items_omitted"] = true
	return out
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
		for _, key := range []string{"waiting_prompt", "last_message", "result_digest", "task_name", "title"} {
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
		if threadID == "" {
			threadID = strings.TrimSpace(anyToString(item["subagent_id"]))
		}
		minimalItems = append(minimalItems, map[string]any{
			"subagent_id":      threadID,
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

func scrubSubagentForbiddenFields(in map[string]any) map[string]any {
	for _, key := range []string{
		"tool_call", "tool_calls", "tool_result", "tool_results", "stdout", "stderr",
		"command", "args", "args_json", "history", "transcript", "timeline",
		"messages", "entries", "raw", "result_struct",
		"subagent", "subagents", "snapshot", "snapshots", "snapshots_by_id", "item", "snapshot_count", "task_id",
		"parent_turn_id", "latest_turn_id",
	} {
		delete(in, key)
	}
	for key, value := range in {
		switch typed := value.(type) {
		case map[string]any:
			in[key] = scrubSubagentForbiddenFields(typed)
		case []map[string]any:
			next := make([]map[string]any, 0, len(typed))
			for _, item := range typed {
				next = append(next, scrubSubagentForbiddenFields(item))
			}
			in[key] = next
		case []any:
			next := make([]any, 0, len(typed))
			for _, item := range typed {
				if rec, ok := item.(map[string]any); ok {
					next = append(next, scrubSubagentForbiddenFields(rec))
				} else {
					next = append(next, item)
				}
			}
			in[key] = next
		}
	}
	return in
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

func (s *floretSubagentRuntime) sendInput(ctx context.Context, _ string, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	host, err := s.ensureHost(ctx)
	if err != nil {
		return nil, err
	}
	target := strings.TrimSpace(anyToString(args["target"]))
	agentType, err := s.subagentAgentTypeForTarget(ctx, host, target)
	if err != nil {
		return nil, err
	}
	childRunID := s.childRunIDForThread(target)
	snapshot, err := host.SendSubAgentInput(ctx, flruntime.SendSubAgentInputRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ChildThreadID:  flruntime.ThreadID(target),
		Message:        strings.TrimSpace(anyToString(args["message"])),
		Interrupt:      parseBoolArg(args, "interrupt", false),
		Labels:         s.runLabels(agentType, target, childRunID),
	})
	if err != nil {
		return nil, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	s.refreshSubagentTimeline(ctx, localSnapshot)
	item := subagentSnapshotPayload(localSnapshot)
	bounded := boundedSubagentItem(item)
	return trimSubagentToolResult(map[string]any{
		"status":      "ok",
		"action":      subagentActionSendInput,
		"target":      target,
		"subagent_id": bounded["subagent_id"],
		"thread_id":   bounded["thread_id"],
		"accepted":    true,
		"items":       []map[string]any{bounded},
	}), nil
}

func (s *floretSubagentRuntime) requireCurrentHostForSpawn(parent *run) error {
	if s == nil || parent == nil {
		return errors.New("subagent runtime unavailable")
	}
	want, err := parent.subagentHostConfigKey()
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

func (s *floretSubagentRuntime) subagentAgentTypeForTarget(ctx context.Context, host flruntime.Host, target string) (string, error) {
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
	return "", nil
}

func (s *floretSubagentRuntime) close(ctx context.Context, _ string, args map[string]any) (map[string]any, error) {
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
	snapshot, err := s.closeSubagentWithHost(closeCtx, host, parent, target)
	if err != nil {
		return nil, err
	}
	item := subagentSnapshotPayload(snapshot)
	bounded := boundedSubagentItem(item)
	out := map[string]any{
		"status":      "ok",
		"action":      subagentActionClose,
		"target":      target,
		"subagent_id": bounded["subagent_id"],
		"thread_id":   bounded["thread_id"],
		"closed":      true,
		"stopped":     true,
		"items":       []map[string]any{bounded},
	}
	return trimSubagentToolResult(applySubagentTimeoutFields(out, requestedTimeoutMS, effectiveTimeoutMS, timeoutSource)), nil
}

func (s *floretSubagentRuntime) closeSubagentWithHost(ctx context.Context, host flruntime.Host, parent *run, target string) (subagentSnapshot, error) {
	if host == nil {
		return subagentSnapshot{}, errors.New("subagent host unavailable")
	}
	if parent == nil {
		return subagentSnapshot{}, errors.New("subagent runtime unavailable")
	}
	target = strings.TrimSpace(target)
	snapshot, err := host.CloseSubAgent(ctx, flruntime.CloseSubAgentRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ChildThreadID:  flruntime.ThreadID(target),
	})
	if err != nil {
		return subagentSnapshot{}, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	s.refreshSubagentTimeline(ctx, localSnapshot)
	return localSnapshot, nil
}

func (s *floretSubagentRuntime) closeAllAction(ctx context.Context, _ string, args map[string]any) (map[string]any, error) {
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
	result, err := host.CloseSubAgents(closeCtx, flruntime.CloseSubAgentsRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		Reason:         "parent_close_all",
	})
	if err != nil {
		return nil, err
	}
	snapshots := make([]subagentSnapshot, 0, len(result.Snapshots))
	affected := make([]string, 0, len(result.Snapshots))
	for _, snapshot := range result.Snapshots {
		if id := strings.TrimSpace(string(snapshot.ThreadID)); id != "" {
			affected = append(affected, id)
		}
		snapshots = append(snapshots, subagentSnapshotFromFloret(snapshot))
	}
	s.refreshSubagentTimeline(closeCtx, snapshots...)
	items := make([]map[string]any, 0, len(snapshots))
	for _, snapshot := range snapshots {
		items = append(items, subagentSnapshotPayload(snapshot))
	}
	out := subagentBoundedResult(subagentActionCloseAll, items)
	out["scope"] = "current_run"
	out["closed_count"] = result.Closed
	out["stopped_count"] = result.Closed
	out["affected_ids"] = affected
	return trimSubagentToolResult(applySubagentTimeoutFields(out, requestedTimeoutMS, effectiveTimeoutMS, timeoutSource)), nil
}

func (s *floretSubagentRuntime) closeAllExisting(ctx context.Context) {
	if s == nil {
		return
	}
	parent := s.parentRun()
	if parent == nil {
		return
	}
	s.mu.Lock()
	host := s.host
	s.mu.Unlock()
	if host == nil {
		return
	}
	_, _ = host.CloseSubAgents(ctx, flruntime.CloseSubAgentsRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		Reason:         "parent_stop",
	})
}

func (s *floretSubagentRuntime) release() {
	if s == nil {
		return
	}
	s.mu.Lock()
	host := s.host
	s.host = nil
	s.timelineQueued = nil
	s.closed = true
	s.mu.Unlock()
	if host != nil {
		_ = host.Close()
	}
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
	s.refreshSubagentTimeline(ctx, out...)
	return out, nil
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
	runtime := s.subagentRuntimes[runThreadKey(endpointID, parentThreadID)]
	s.mu.Unlock()
	if db == nil {
		return nil, errors.New("threads store not ready")
	}
	parent, err := db.GetThread(ctxOrBackground(ctx), endpointID, parentThreadID)
	if err != nil {
		return nil, err
	}
	if parent == nil {
		return nil, sql.ErrNoRows
	}
	var detailHost interface {
		ReadSubAgentDetail(context.Context, flruntime.ReadSubAgentDetailRequest) (flruntime.SubAgentDetail, error)
		Close() error
	}
	if runtime != nil {
		detailHost = runtime.currentHost()
	}
	if detailHost == nil {
		host, err := s.openFloretMaintenanceHost()
		if err != nil {
			return nil, err
		}
		detailHost = host
		defer detailHost.Close()
	}
	detail, err := detailHost.ReadSubAgentDetail(ctxOrBackground(ctx), flruntime.ReadSubAgentDetailRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		ChildThreadID:  flruntime.ThreadID(childThreadID),
		AfterOrdinal:   afterOrdinal,
		Limit:          limit,
		IncludeRaw:     false,
	})
	if err != nil {
		if isFloretSubagentNotFoundError(err) {
			return nil, sql.ErrNoRows
		}
		return nil, err
	}
	resp := flowerSubagentDetailResponse(detail)
	if strings.TrimSpace(resp.Summary.ParentThreadID) != parentThreadID || strings.TrimSpace(resp.Summary.ThreadID) != childThreadID {
		return nil, sql.ErrNoRows
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

func flowerSubagentDetailResponse(detail flruntime.SubAgentDetail) FlowerSubagentDetailResponse {
	return FlowerSubagentDetailResponse{
		Summary:       flowerSubagentSummary(detail.Snapshot),
		Timeline:      flowerSubagentTimelineRows(detail.Events),
		NextOrdinal:   detail.NextOrdinal,
		HasMore:       detail.HasMore,
		RetainedFrom:  detail.RetainedFrom,
		GeneratedAtMs: timeUnixMS(detail.GeneratedAt),
	}
}

func flowerSubagentSummary(snapshot flruntime.SubAgentSnapshot) FlowerSubagentSummary {
	local := subagentSnapshotFromFloret(snapshot)
	title := strings.TrimSpace(local.TaskName)
	if title == "" {
		title = strings.TrimSpace(local.ThreadID)
	}
	return FlowerSubagentSummary{
		ParentThreadID:  local.ParentThreadID,
		SubagentID:      local.ThreadID,
		ThreadID:        local.ThreadID,
		TaskName:        local.TaskName,
		TaskDescription: local.TaskDescription,
		Title:           title,
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

func flowerSubagentTimelineRows(events []flruntime.SubAgentDetailEvent) []FlowerSubagentTimelineRow {
	out := make([]FlowerSubagentTimelineRow, 0, len(events))
	for _, event := range events {
		out = append(out, flowerSubagentTimelineRow(event))
	}
	return out
}

func flowerSubagentTimelineRow(event flruntime.SubAgentDetailEvent) FlowerSubagentTimelineRow {
	return FlowerSubagentTimelineRow{
		Ordinal:     event.Ordinal,
		Kind:        strings.TrimSpace(string(event.Kind)),
		Type:        strings.TrimSpace(event.Type),
		CreatedAtMs: timeUnixMS(event.CreatedAt),
		Activity:    flowerSubagentActivityBlock(event.ActivityTimeline),
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

func flowerSubagentActivityBlock(timeline *observation.ActivityTimeline) *ActivityTimelineBlock {
	if timeline == nil || len(timeline.Items) == 0 {
		return nil
	}
	block := newActivityTimelineBlock(*timeline, nil)
	return &block
}

func flowerSubagentDetailMessage(in *flruntime.SubAgentDetailMessage) *FlowerSubagentDetailMessage {
	if in == nil {
		return nil
	}
	return &FlowerSubagentDetailMessage{
		Role:    strings.TrimSpace(in.Role),
		Text:    strings.TrimSpace(in.Preview),
		Preview: strings.TrimSpace(in.Preview),
	}
}

func flowerSubagentToolCallView(in *flruntime.SubAgentDetailToolCall) *FlowerSubagentToolCallView {
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

func flowerSubagentToolResultView(in *flruntime.SubAgentDetailToolResult) *FlowerSubagentToolResultView {
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

func flowerSubagentApprovalView(in *flruntime.SubAgentDetailApproval) *FlowerSubagentApprovalView {
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

func flowerSubagentTurnMarkerView(in *flruntime.SubAgentDetailTurnMarker) *FlowerSubagentTurnMarkerView {
	if in == nil {
		return nil
	}
	return &FlowerSubagentTurnMarkerView{
		Status:   strings.TrimSpace(in.Status),
		Metadata: cloneStringMap(in.Metadata),
	}
}

func flowerSubagentCompactionView(in *flruntime.SubAgentDetailCompaction) *FlowerSubagentCompactionView {
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

func flowerSubagentGenericView(event flruntime.SubAgentDetailEvent) *FlowerSubagentGenericView {
	if event.Kind != flruntime.SubAgentDetailEventCustom {
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

func (s *floretSubagentRuntime) refreshSubagentTimeline(ctx context.Context, snapshots ...subagentSnapshot) {
	_ = snapshots
	s.publishParentSubagentTimeline(ctx)
}

func (s *floretSubagentRuntime) upsertRunningWaitToolSidecar(ctx context.Context, toolCallID string, host flruntime.Host, parent *run, childIDs []flruntime.ThreadID) {
	if s == nil || host == nil || parent == nil {
		return
	}
	toolItemID := flowerToolActivityItemID(toolCallID)
	if toolItemID == "" || !parent.acceptsPresentationUpdates() {
		return
	}
	parentThreadID := strings.TrimSpace(parent.threadID)
	if parentThreadID == "" {
		return
	}
	result, err := host.ListSubAgentActivityTimeline(ctxOrBackground(ctx), flruntime.ListSubAgentActivityTimelineRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		Meta:           parent.activityRunMeta(),
	})
	if err != nil {
		parent.persistRunEvent("delegation.timeline.wait_sidecar_error", RealtimeStreamKindLifecycle, map[string]any{
			"error": sanitizeLogText(err.Error(), 240),
		})
		return
	}
	parent.refreshActivityTimelineSidecars(result.Timeline, s.flowerParentSubagentActivityActions(result.Timeline))
	items := flowerSubagentActionItemsFromTimeline(result.Timeline, childIDs)
	if len(items) == 0 {
		return
	}
	parent.upsertActivityTimelineSubagentActions(map[string]FlowerActivitySubagentAction{
		toolItemID: flowerSubagentActivityActionFromItems(subagentActionWait, parentThreadID, items),
	})
}

func (s *floretSubagentRuntime) publishParentSubagentTimeline(ctx context.Context) {
	parent := s.parentRun()
	if parent == nil || !parent.acceptsPresentationUpdates() {
		return
	}
	host := s.currentHost()
	if host == nil {
		return
	}
	parentThreadID := strings.TrimSpace(parent.threadID)
	if parentThreadID == "" {
		return
	}
	result, err := host.ListSubAgentActivityTimeline(ctxOrBackground(ctx), flruntime.ListSubAgentActivityTimelineRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		Meta:           parent.activityRunMeta(),
	})
	if err != nil {
		parent.persistRunEvent("delegation.timeline.refresh_error", RealtimeStreamKindLifecycle, map[string]any{
			"error": sanitizeLogText(err.Error(), 240),
		})
		return
	}
	if len(result.Timeline.Items) == 0 {
		return
	}
	parent.refreshActivityTimelineSidecars(result.Timeline, s.flowerParentSubagentActivityActions(result.Timeline))
}

func (s *floretSubagentRuntime) flowerParentSubagentActivityActions(timeline observation.ActivityTimeline) map[string]FlowerActivitySubagentAction {
	out := map[string]FlowerActivitySubagentAction{}
	for _, item := range timeline.Items {
		itemID := strings.TrimSpace(item.ItemID)
		if itemID == "" {
			continue
		}
		action, ok := flowerSubagentActivityActionFromPayload(subagentActionInspect, item.Payload)
		if !ok {
			continue
		}
		out[itemID] = action
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func flowerToolSubagentActivityActions(toolCallID string, action string, payload map[string]any) map[string]FlowerActivitySubagentAction {
	itemID := flowerToolActivityItemID(toolCallID)
	if itemID == "" {
		return nil
	}
	subagentAction, ok := flowerSubagentActivityActionFromPayload(action, payload)
	if !ok {
		return nil
	}
	return map[string]FlowerActivitySubagentAction{itemID: subagentAction}
}

func flowerToolActivityItemID(toolCallID string) string {
	toolCallID = strings.TrimSpace(toolCallID)
	if toolCallID == "" {
		return ""
	}
	if strings.HasPrefix(toolCallID, "tool:") {
		return toolCallID
	}
	return "tool:" + toolCallID
}

func flowerSubagentActivityActionFromPayload(defaultAction string, payload map[string]any) (FlowerActivitySubagentAction, bool) {
	if len(payload) == 0 {
		return FlowerActivitySubagentAction{}, false
	}
	action := strings.TrimSpace(anyToString(payload["action"]))
	if action == "" {
		action = strings.TrimSpace(defaultAction)
	}
	if action == "" {
		action = subagentActionInspect
	}
	items := flowerSubagentActionItemsFromPayload(payload)
	threadID := strings.TrimSpace(anyToString(payload["thread_id"]))
	if threadID == "" {
		threadID = strings.TrimSpace(anyToString(payload["subagent_id"]))
	}
	agentType := strings.TrimSpace(anyToString(payload["agent_type"]))
	if agentType == "" {
		agentType = normalizeSubagentAgentType(anyToString(payload["host_profile_ref"]))
	}
	title := strings.TrimSpace(anyToString(payload["title"]))
	taskName := strings.TrimSpace(anyToString(payload["task_name"]))
	taskDescription := strings.TrimSpace(anyToString(payload["task_description"]))
	if title == "" {
		title = taskName
	}
	if threadID == "" && len(items) == 1 {
		threadID = strings.TrimSpace(firstNonEmptyString(items[0].ThreadID, items[0].SubagentID))
		if title == "" {
			title = firstNonEmptyString(items[0].Title, items[0].TaskName)
		}
		if taskName == "" {
			taskName = items[0].TaskName
		}
		if taskDescription == "" {
			taskDescription = items[0].TaskDescription
		}
		if agentType == "" {
			agentType = items[0].AgentType
		}
	}
	status := ""
	if rawStatus := strings.TrimSpace(anyToString(payload["status"])); rawStatus != "" {
		status = flowerSubagentStatus(flruntime.SubAgentStatus(rawStatus))
	}
	startedAtMS := nonNegativeInt64Local(parseInt64Raw(payload["started_at_ms"], 0))
	createdAtMS := nonNegativeInt64Local(parseInt64Raw(payload["created_at_ms"], 0))
	updatedAtMS := nonNegativeInt64Local(parseInt64Raw(payload["updated_at_ms"], 0))
	if threadID == "" && len(items) == 0 && taskName == "" && title == "" && taskDescription == "" {
		return FlowerActivitySubagentAction{}, false
	}
	return FlowerActivitySubagentAction{
		Operation:         "subagents",
		Action:            action,
		DelegationRuntime: "floret",
		ThreadID:          threadID,
		SubagentID:        threadID,
		ParentThreadID:    strings.TrimSpace(anyToString(payload["parent_thread_id"])),
		TaskName:          taskName,
		TaskDescription:   taskDescription,
		Title:             title,
		AgentType:         agentType,
		Status:            status,
		StartedAtMS:       startedAtMS,
		CreatedAtMS:       createdAtMS,
		UpdatedAtMS:       updatedAtMS,
		Items:             items,
	}, true
}

func flowerSubagentActivityActionFromItems(action string, parentThreadID string, items []FlowerActivitySubagentActionItem) FlowerActivitySubagentAction {
	out := FlowerActivitySubagentAction{
		Operation:         "subagents",
		Action:            strings.TrimSpace(action),
		DelegationRuntime: "floret",
		ParentThreadID:    strings.TrimSpace(parentThreadID),
		Items:             cloneFlowerActivitySubagentActionItems(items),
	}
	if out.Action == "" {
		out.Action = subagentActionInspect
	}
	if len(out.Items) == 1 {
		item := out.Items[0]
		out.ThreadID = strings.TrimSpace(firstNonEmptyString(item.ThreadID, item.SubagentID))
		out.SubagentID = out.ThreadID
		out.TaskName = item.TaskName
		out.TaskDescription = item.TaskDescription
		out.Title = item.Title
		out.AgentType = item.AgentType
		out.Status = item.Status
		out.StartedAtMS = item.StartedAtMS
		out.CreatedAtMS = item.CreatedAtMS
		out.UpdatedAtMS = item.UpdatedAtMS
	}
	return out
}

func flowerSubagentActionItemsFromTimeline(timeline observation.ActivityTimeline, childIDs []flruntime.ThreadID) []FlowerActivitySubagentActionItem {
	if len(timeline.Items) == 0 {
		return nil
	}
	targets := subagentThreadIDSet(childIDs)
	out := make([]FlowerActivitySubagentActionItem, 0, len(timeline.Items))
	for _, item := range timeline.Items {
		action, ok := flowerSubagentActivityActionFromPayload(subagentActionInspect, item.Payload)
		if !ok {
			continue
		}
		next, ok := flowerSubagentActionItemFromAction(action)
		if !ok {
			continue
		}
		if len(targets) > 0 {
			threadID := strings.TrimSpace(firstNonEmptyString(next.ThreadID, next.SubagentID))
			if _, ok := targets[threadID]; !ok {
				continue
			}
		}
		out = append(out, next)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func subagentThreadIDSet(childIDs []flruntime.ThreadID) map[string]struct{} {
	if len(childIDs) == 0 {
		return nil
	}
	out := map[string]struct{}{}
	for _, id := range childIDs {
		if value := strings.TrimSpace(string(id)); value != "" {
			out[value] = struct{}{}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func flowerSubagentActionItemFromAction(action FlowerActivitySubagentAction) (FlowerActivitySubagentActionItem, bool) {
	threadID := strings.TrimSpace(firstNonEmptyString(action.ThreadID, action.SubagentID))
	if threadID == "" && len(action.Items) == 1 {
		return action.Items[0], true
	}
	if threadID == "" {
		return FlowerActivitySubagentActionItem{}, false
	}
	return FlowerActivitySubagentActionItem{
		ThreadID:        threadID,
		SubagentID:      threadID,
		TaskName:        action.TaskName,
		TaskDescription: action.TaskDescription,
		Title:           action.Title,
		AgentType:       action.AgentType,
		Status:          action.Status,
		StartedAtMS:     action.StartedAtMS,
		CreatedAtMS:     action.CreatedAtMS,
		UpdatedAtMS:     action.UpdatedAtMS,
	}, true
}

func flowerSubagentActionItemsFromPayload(payload map[string]any) []FlowerActivitySubagentActionItem {
	items := subagentItemsFromAny(payload["items"])
	if len(items) == 0 {
		return nil
	}
	out := make([]FlowerActivitySubagentActionItem, 0, len(items))
	for _, item := range items {
		threadID := strings.TrimSpace(anyToString(item["thread_id"]))
		if threadID == "" {
			threadID = strings.TrimSpace(anyToString(item["subagent_id"]))
		}
		if threadID == "" {
			continue
		}
		agentType := strings.TrimSpace(anyToString(item["agent_type"]))
		if agentType == "" {
			agentType = normalizeSubagentAgentType(anyToString(item["host_profile_ref"]))
		}
		status := ""
		if rawStatus := strings.TrimSpace(anyToString(item["status"])); rawStatus != "" {
			status = flowerSubagentStatus(flruntime.SubAgentStatus(rawStatus))
		}
		title := strings.TrimSpace(anyToString(item["title"]))
		taskName := strings.TrimSpace(anyToString(item["task_name"]))
		taskDescription := strings.TrimSpace(anyToString(item["task_description"]))
		if title == "" {
			title = taskName
		}
		out = append(out, FlowerActivitySubagentActionItem{
			ThreadID:        threadID,
			SubagentID:      threadID,
			TaskName:        taskName,
			TaskDescription: taskDescription,
			Title:           title,
			AgentType:       agentType,
			Status:          status,
			StartedAtMS:     nonNegativeInt64Local(parseInt64Raw(item["started_at_ms"], 0)),
			CreatedAtMS:     nonNegativeInt64Local(parseInt64Raw(item["created_at_ms"], 0)),
			UpdatedAtMS:     nonNegativeInt64Local(parseInt64Raw(item["updated_at_ms"], 0)),
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func aggregateSubagentContextMode(snapshots []subagentSnapshot) string {
	for _, snapshot := range snapshots {
		if normalizeSubagentContextMode(snapshot.ContextMode) == subagentContextModeFullHistory {
			return subagentContextModeFullHistory
		}
	}
	return subagentContextModeMissionOnly
}

func (s *floretSubagentRuntime) childRunIDForThread(childThreadID string) string {
	parent := s.parentRun()
	if parent == nil || parent.threadsDB == nil {
		return ""
	}
	childThreadID = strings.TrimSpace(childThreadID)
	if childThreadID == "" {
		return ""
	}
	lookupCtx, cancel := persistContextForRun(parent)
	defer cancel()
	rec, ok, err := parent.threadsDB.GetFinalizedChildPermissionSnapshotByThread(lookupCtx, strings.TrimSpace(parent.endpointID), childThreadID)
	if err != nil || !ok {
		return ""
	}
	childRunID := strings.TrimSpace(rec.ChildRunID)
	if childRunID == "" || childRunID == childThreadID {
		return ""
	}
	return childRunID
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
		host[subagentToolHostContextSubagentIDKey] = childThreadID
	}
	childRunID = strings.TrimSpace(childRunID)
	if childRunID != "" && childRunID != childThreadID {
		host[subagentToolHostContextChildRunIDKey] = childRunID
	}
	if rawAgentType := strings.TrimSpace(agentType); rawAgentType != "" {
		normalized := normalizeSubagentAgentType(rawAgentType)
		host[subagentToolHostContextAgentTypeKey] = normalized
	}
	host[subagentToolHostContextParentPermissionKey] = permissionTypeString(subagentPermissionLimit(parent))
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
	title := strings.TrimSpace(snapshot.TaskName)
	if title == "" {
		title = strings.TrimSpace(snapshot.ThreadID)
	}
	lastMessage := strings.TrimSpace(snapshot.LastMessage)
	return map[string]any{
		"id":                 snapshot.ThreadID,
		"subagent_id":        snapshot.ThreadID,
		"thread_id":          snapshot.ThreadID,
		"agent_type":         snapshot.AgentType,
		"context_mode":       normalizeSubagentContextMode(snapshot.ContextMode),
		"title":              title,
		"task_name":          snapshot.TaskName,
		"task_description":   snapshot.TaskDescription,
		"status":             snapshot.Status,
		"last_message":       lastMessage,
		"waiting_prompt":     snapshot.WaitingPrompt,
		"queued_inputs":      snapshot.QueuedInputs,
		"parent_thread_id":   snapshot.ParentThreadID,
		"parent_turn_id":     snapshot.ParentTurnID,
		"latest_turn_id":     snapshot.LatestTurnID,
		"started_at_ms":      snapshot.CreatedAtMS,
		"created_at_ms":      snapshot.CreatedAtMS,
		"updated_at_ms":      snapshot.UpdatedAtMS,
		"closed":             snapshot.Closed,
		"can_send_input":     snapshot.CanSendInput,
		"can_interrupt":      snapshot.CanInterrupt,
		"can_close":          snapshot.CanClose,
		"delegation_runtime": "floret",
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
		"subagent_id":        payload["subagent_id"],
		"thread_id":          payload["thread_id"],
		"title":              payload["title"],
		"task_name":          payload["task_name"],
		"task_description":   payload["task_description"],
		"agent_type":         payload["agent_type"],
		"context_mode":       payload["context_mode"],
		"status":             payload["status"],
		"updated_at_ms":      payload["updated_at_ms"],
		"last_message":       payload["last_message"],
		"can_send_input":     payload["can_send_input"],
		"can_interrupt":      payload["can_interrupt"],
		"can_close":          payload["can_close"],
		"delegation_runtime": "floret",
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

func deriveSubagentTaskName(message string) string {
	words := strings.Fields(strings.TrimSpace(message))
	if len(words) == 0 {
		return "subagent"
	}
	if len(words) > 6 {
		words = words[:6]
	}
	name := strings.Join(words, " ")
	if len([]rune(name)) > 80 {
		name = string([]rune(name)[:80])
	}
	return strings.TrimSpace(name)
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
	Objective   string
	ContextMode string
	Contract    subagentCapabilityContract
}

func buildFlowerSubagentPrompt(spec flowerSubagentPromptSpec) string {
	agentType := normalizeSubagentAgentType(spec.AgentType)
	contract := spec.Contract
	lines := []string{
		"# Delegated Mission",
		strings.TrimSpace(firstNonEmptyString(spec.Message, spec.Objective, spec.TaskName)),
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
	if s.runtime != nil {
		s.runtime.scheduleParentSubagentTimelineRefresh(eventThreadID)
	}
	parent.persistRunEvent("delegation.child.event", RealtimeStreamKindLifecycle, map[string]any{
		"event_type": strings.TrimSpace(ev.Type),
		"thread_id":  eventThreadID,
		"turn_id":    strings.TrimSpace(string(ev.TurnID)),
		"tool_id":    strings.TrimSpace(ev.ToolID),
		"tool_name":  strings.TrimSpace(ev.ToolName),
		"step_index": ev.Step,
		"error":      strings.TrimSpace(ev.Error),
	})
}
