package ai

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	flconfig "github.com/floegence/floret/config"
	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
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

	flowerSubagentProjectionOwnerKind = "subagent_projection"
	flowerSubagentProjectionOwnerID   = "floret"
)

type subagentRuntime interface {
	manage(context.Context, map[string]any) (map[string]any, error)
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
	ThreadID       string
	Path           string
	TaskName       string
	ParentThreadID string
	ParentTurnID   string
	AgentType      string
	ContextMode    string
	Status         string
	LatestTurnID   string
	LastMessage    string
	WaitingPrompt  string
	QueuedInputs   int
	CreatedAtMS    int64
	UpdatedAtMS    int64
	Closed         bool
	CanSendInput   bool
	CanInterrupt   bool
	CanClose       bool
}

type floretSubagentRuntime struct {
	muParent sync.Mutex
	parent   *run

	mu         sync.Mutex
	host       flruntime.Host
	hostKey    string
	storePath  string
	closed     bool
	syncQueued map[string]struct{}
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

func (s *floretSubagentRuntime) manage(ctx context.Context, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
	}
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	if action == "" {
		return nil, fmt.Errorf("missing action")
	}
	parent.persistRunEvent("delegation.manage.begin", RealtimeStreamKindLifecycle, map[string]any{
		"action":        action,
		"provided_keys": subagentValidationProvidedKeys(args),
	})
	var (
		out map[string]any
		err error
	)
	switch action {
	case subagentActionSpawn:
		out, err = s.spawn(ctx, args)
	case subagentActionWait:
		out, err = s.wait(ctx, args)
	case subagentActionList:
		out, err = s.list(ctx, args)
	case subagentActionInspect:
		out, err = s.inspect(ctx, args)
	case subagentActionSendInput:
		out, err = s.sendInput(ctx, args)
	case subagentActionClose:
		out, err = s.close(ctx, args)
	case subagentActionCloseAll:
		out, err = s.closeAllAction(ctx, args)
	default:
		err = fmt.Errorf("unsupported action %q", action)
	}
	if err != nil {
		return nil, err
	}
	parent.persistRunEvent("delegation.manage.end", RealtimeStreamKindLifecycle, map[string]any{
		"action": action,
		"status": strings.TrimSpace(anyToString(out["status"])),
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
	host, storePath, err := s.newHostLocked(parent)
	if err != nil {
		return nil, err
	}
	s.host = host
	s.hostKey = hostKey
	s.storePath = storePath
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

func (s *floretSubagentRuntime) scheduleProjectedSubagentSync(threadID string) {
	if s == nil {
		return
	}
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return
	}
	s.mu.Lock()
	if s.closed || s.host == nil {
		s.mu.Unlock()
		return
	}
	if s.syncQueued == nil {
		s.syncQueued = map[string]struct{}{}
	}
	if _, exists := s.syncQueued[threadID]; exists {
		s.mu.Unlock()
		return
	}
	s.syncQueued[threadID] = struct{}{}
	s.mu.Unlock()

	go func() {
		timer := time.NewTimer(150 * time.Millisecond)
		defer timer.Stop()
		<-timer.C
		defer func() {
			s.mu.Lock()
			delete(s.syncQueued, threadID)
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
		if err := s.syncProjectedSubagentThreadByID(ctx, threadID); err != nil && parent.log != nil {
			parent.log.Debug("subagent projection sync failed", "thread_id", threadID, "error", err)
		}
	}()
}

func (s *floretSubagentRuntime) newHostLocked(parent *run) (flruntime.Host, string, error) {
	if parent == nil {
		return nil, "", errors.New("subagent runtime unavailable")
	}
	resolved, err := parent.resolveSubagentModelGateway()
	if err != nil {
		return nil, "", err
	}
	providerType := strings.ToLower(strings.TrimSpace(resolved.provider.Type))
	modelName := strings.TrimSpace(resolved.modelName)
	adapter := resolved.adapterOverride
	if adapter == nil {
		adapter, err = newProviderAdapter(providerType, strings.TrimSpace(resolved.provider.BaseURL), strings.TrimSpace(resolved.apiKey), resolved.provider.StrictToolSchema)
		if err != nil {
			return nil, "", err
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
		return nil, "", err
	}
	activeTools, childContract := childRun.subagentToolSurface(registry.Snapshot(), flruntime.SubAgentForkNone)
	state := newFloretToolRuntimeState(newRuntimeState("subagents"))
	flTools, err := buildFloretToolRegistry(childRun, activeTools, state)
	if err != nil {
		return nil, "", err
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
	storePath, err := floretSubagentStorePath(parent.stateDir)
	if err != nil {
		return nil, "", err
	}
	store, err := flruntime.OpenSQLiteStore(storePath)
	if err != nil {
		return nil, "", err
	}
	systemPrompt := parent.buildSubagentHostSystemPrompt(activeTools, childContract)
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config:             flconfig.Config{Provider: flconfig.ProviderFake, Model: modelName, SystemPrompt: systemPrompt, Reasoning: config.NormalizeAIReasoningSelection(parent.currentReasoning)},
		ModelGateway:       flProvider,
		Store:              store,
		Tools:              flTools,
		Approver:           floretToolApproverForRun(childRun),
		Sink:               floretSubagentEventSink{runtime: s},
		SubAgentRunTimeout: subagentRunTimeout,
		LoopLimits: flruntime.LoopLimits{
			NoProgressLimit:    2,
			DuplicateToolLimit: 3,
		},
	})
	if err != nil {
		_ = store.Close()
		return nil, "", err
	}
	return host, storePath, nil
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
		terminalExecRunner:    r.terminalExecRunner,
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

func floretSubagentStorePath(stateDir string) (string, error) {
	stateDir = strings.TrimSpace(stateDir)
	if stateDir == "" {
		return "", errors.New("missing state dir for subagent store")
	}
	dir := filepath.Join(stateDir, "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	return filepath.Join(dir, "floret_subagents.sqlite"), nil
}

func ensureFloretThread(ctx context.Context, host flruntime.Host, threadID flruntime.ThreadID) error {
	if host == nil {
		return errors.New("subagent host unavailable")
	}
	if strings.TrimSpace(string(threadID)) == "" {
		return errors.New("missing parent thread id")
	}
	if _, err := host.StartThread(ctx, flruntime.StartThreadRequest{ThreadID: threadID}); err != nil {
		if _, readErr := host.ReadThread(ctx, threadID); readErr != nil {
			return err
		}
	}
	return nil
}

func (s *floretSubagentRuntime) spawn(ctx context.Context, args map[string]any) (map[string]any, error) {
	parent := s.parentRun()
	if parent == nil {
		return nil, errors.New("subagent runtime unavailable")
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
	registry := NewInMemoryToolRegistry()
	if err := registerBuiltInTools(registry, childRun); err != nil {
		return nil, err
	}
	activeChildTools, childContract := childRun.subagentToolSurface(registry.Snapshot(), forkMode)
	childSnapshot := permissionSnapshotWithOwnerIdentity(buildPermissionSnapshot(childRun.permissionType, activeChildTools, nil), parent.endpointID, childThreadID, childThreadID)
	childRun.permissionSnapshot = childSnapshot
	if err := parent.insertChildPermissionSnapshot(childThreadID, childThreadID, childSnapshot); err != nil {
		return nil, fmt.Errorf("persist child permission snapshot: %w", err)
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
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ParentTurnID:   flruntime.TurnID(strings.TrimSpace(parent.messageID)),
		ThreadID:       flruntime.ThreadID(childThreadID),
		TaskName:       taskName,
		Message:        prompt,
		HostProfileRef: agentType,
		ForkMode:       forkMode,
		Labels:         s.runLabels(agentType, childThreadID),
	})
	if err != nil {
		return nil, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	localSnapshot.ContextMode = contextMode
	if err := s.syncProjectedSubagentThread(ctx, localSnapshot); err != nil {
		return nil, err
	}
	item := subagentSnapshotPayload(localSnapshot)
	parent.persistRunEvent("delegation.spawn", RealtimeStreamKindLifecycle, map[string]any{
		"subagent_id": item["subagent_id"],
		"thread_id":   item["thread_id"],
		"agent_type":  item["agent_type"],
		"task_name":   item["task_name"],
		"status":      item["status"],
	})
	bounded := boundedSubagentItem(item)
	return trimSubagentToolResult(map[string]any{
		"status":       "ok",
		"action":       subagentActionSpawn,
		"accepted":     true,
		"subagent_id":  bounded["subagent_id"],
		"thread_id":    bounded["thread_id"],
		"agent_type":   bounded["agent_type"],
		"context_mode": bounded["context_mode"],
		"task_name":    bounded["task_name"],
		"title":        bounded["title"],
		"subagent":     bounded,
		"snapshot":     bounded,
		"item":         bounded,
	}), nil
}

func (s *floretSubagentRuntime) wait(ctx context.Context, args map[string]any) (map[string]any, error) {
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
	result, err := host.WaitSubAgents(ctx, flruntime.WaitSubAgentsRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ChildThreadIDs: childIDs,
		Timeout:        time.Duration(effectiveTimeoutMS) * time.Millisecond,
	})
	if err != nil {
		return nil, err
	}
	if err := s.syncProjectedFloretSubagentThreads(ctx, result.Snapshots); err != nil {
		return nil, err
	}
	snapshots := make([]subagentSnapshot, 0, len(result.Snapshots))
	for _, snapshot := range result.Snapshots {
		local := subagentSnapshotFromFloret(snapshot)
		local = s.withStoredSubagentContextMode(ctx, local)
		snapshots = append(snapshots, local)
	}
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

func (s *floretSubagentRuntime) list(ctx context.Context, args map[string]any) (map[string]any, error) {
	snapshots, err := s.snapshots(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.syncProjectedSubagentThreads(ctx, snapshots); err != nil {
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

func (s *floretSubagentRuntime) inspect(ctx context.Context, args map[string]any) (map[string]any, error) {
	targets := collectInspectTargets(args)
	all, err := s.snapshots(ctx)
	if err != nil {
		return nil, err
	}
	if err := s.syncProjectedSubagentThreads(ctx, all); err != nil {
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
	if len(items) == 1 {
		out["item"] = boundedSubagentItem(items[0])
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
	title := truncateRunes(firstNonEmptyString(taskName, strings.TrimSpace(anyToString(item["title"])), threadID, "Subagent"), 180)
	return map[string]any{
		"subagent_id":        threadID,
		"thread_id":          threadID,
		"agent_type":         strings.TrimSpace(anyToString(item["agent_type"])),
		"context_mode":       normalizeSubagentContextMode(anyToString(item["context_mode"])),
		"title":              title,
		"task_name":          taskName,
		"status":             strings.TrimSpace(anyToString(item["status"])),
		"parent_thread_id":   strings.TrimSpace(anyToString(item["parent_thread_id"])),
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
	title := truncateRunes(firstNonEmptyString(taskName, strings.TrimSpace(anyToString(item["title"])), threadID, "Subagent"), 180)
	lastMessage := truncateRunes(strings.TrimSpace(anyToString(item["last_message"])), 900)
	out := map[string]any{
		"subagent_id":        threadID,
		"thread_id":          threadID,
		"agent_type":         strings.TrimSpace(anyToString(item["agent_type"])),
		"context_mode":       normalizeSubagentContextMode(anyToString(item["context_mode"])),
		"title":              title,
		"task_name":          taskName,
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
		if len(items) == 1 {
			out["item"] = items[0]
		} else {
			delete(out, "item")
		}
	}
	body, err := json.Marshal(out)
	if err != nil || len(body) <= subagentToolResultHardBytes {
		return out
	}
	out["truncated"] = true
	for _, limit := range []int{480, 240, 120, 60} {
		shrinkSubagentToolItems(items, limit)
		out["items"] = items
		if len(items) == 1 {
			out["item"] = items[0]
		} else {
			delete(out, "item")
		}
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
	if len(minimalItems) == 1 {
		minimal["item"] = minimalItems[0]
	}
	return minimal
}

func scrubSubagentForbiddenFields(in map[string]any) map[string]any {
	for _, key := range []string{
		"tool_call", "tool_calls", "tool_result", "tool_results", "stdout", "stderr",
		"command", "args", "args_json", "history", "transcript", "timeline",
		"messages", "entries", "raw", "result_struct",
		"subagents", "snapshots", "snapshots_by_id", "snapshot_count", "task_id",
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

func (s *floretSubagentRuntime) sendInput(ctx context.Context, args map[string]any) (map[string]any, error) {
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
	snapshot, err := host.SendSubAgentInput(ctx, flruntime.SendSubAgentInputRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ChildThreadID:  flruntime.ThreadID(target),
		Message:        strings.TrimSpace(anyToString(args["message"])),
		Interrupt:      parseBoolArg(args, "interrupt", false),
		Labels:         s.runLabels(agentType, target),
	})
	if err != nil {
		return nil, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	if err := s.syncProjectedSubagentThread(ctx, localSnapshot); err != nil {
		return nil, err
	}
	item := subagentSnapshotPayload(localSnapshot)
	bounded := boundedSubagentItem(item)
	return trimSubagentToolResult(map[string]any{
		"status":      "ok",
		"action":      subagentActionSendInput,
		"target":      target,
		"subagent_id": bounded["subagent_id"],
		"thread_id":   bounded["thread_id"],
		"accepted":    true,
		"subagent":    bounded,
		"snapshot":    bounded,
		"item":        bounded,
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

func (s *floretSubagentRuntime) close(ctx context.Context, args map[string]any) (map[string]any, error) {
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
		"subagent":    bounded,
		"snapshot":    bounded,
		"item":        bounded,
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
	if err := s.syncProjectedSubagentThread(ctx, localSnapshot); err != nil {
		return subagentSnapshot{}, err
	}
	return localSnapshot, nil
}

func (s *floretSubagentRuntime) closeAllAction(ctx context.Context, args map[string]any) (map[string]any, error) {
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
	flSnapshots, err := host.ListSubAgents(closeCtx, flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return nil, err
	}
	snapshots := make([]subagentSnapshot, 0, len(flSnapshots))
	for _, snapshot := range flSnapshots {
		snapshots = append(snapshots, subagentSnapshotFromFloret(snapshot))
	}
	affected := make([]string, 0, len(snapshots))
	closedCount := 0
	for _, snapshot := range snapshots {
		if strings.TrimSpace(snapshot.ThreadID) == "" {
			continue
		}
		affected = append(affected, snapshot.ThreadID)
		if snapshot.CanClose {
			if _, err := s.closeSubagentWithHost(closeCtx, host, parent, snapshot.ThreadID); err != nil {
				return nil, err
			}
			closedCount++
		}
	}
	latest, err := s.snapshots(closeCtx)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(latest))
	for _, snapshot := range latest {
		items = append(items, subagentSnapshotPayload(snapshot))
	}
	out := subagentBoundedResult(subagentActionCloseAll, items)
	out["scope"] = "current_run"
	out["closed_count"] = closedCount
	out["stopped_count"] = closedCount
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
	flSnapshots, err := host.ListSubAgents(ctx, flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return
	}
	for _, flSnapshot := range flSnapshots {
		snapshot := subagentSnapshotFromFloret(flSnapshot)
		if strings.TrimSpace(snapshot.ThreadID) == "" || !snapshot.CanClose {
			continue
		}
		_, _ = host.CloseSubAgent(ctx, flruntime.CloseSubAgentRequest{
			ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
			ChildThreadID:  flruntime.ThreadID(snapshot.ThreadID),
		})
	}
}

func (s *floretSubagentRuntime) release() {
	if s == nil {
		return
	}
	s.mu.Lock()
	host := s.host
	s.host = nil
	s.syncQueued = nil
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
		out = append(out, subagentSnapshotFromFloret(snapshot))
	}
	if err := s.syncProjectedSubagentThreads(ctx, out); err != nil {
		return nil, err
	}
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
	childMeta, err := db.GetFlowerThreadMetadata(ctxOrBackground(ctx), endpointID, childThreadID)
	if err != nil {
		return nil, err
	}
	if !isExpectedFlowerSubagentProjection(childMeta, parentThreadID, childThreadID) {
		return nil, sql.ErrNoRows
	}
	if runtime == nil {
		r := s.detachedSubagentParentRun(meta, *parent)
		if r == nil {
			return nil, errors.New("subagent runtime unavailable")
		}
		runtime = newFloretSubagentRuntime(r)
		defer runtime.release()
	}
	host, err := runtime.ensureHost(ctxOrBackground(ctx))
	if err != nil {
		return nil, err
	}
	detail, err := host.ReadSubAgentDetail(ctxOrBackground(ctx), flruntime.ReadSubAgentDetailRequest{
		ParentThreadID: flruntime.ThreadID(parentThreadID),
		ChildThreadID:  flruntime.ThreadID(childThreadID),
		AfterOrdinal:   afterOrdinal,
		Limit:          limit,
		IncludeRaw:     false,
	})
	if err != nil {
		return nil, err
	}
	resp := flowerSubagentDetailResponse(detail)
	if strings.TrimSpace(resp.Summary.ParentThreadID) != parentThreadID || strings.TrimSpace(resp.Summary.ThreadID) != childThreadID {
		return nil, errors.New("subagent identity mismatch")
	}
	resp.Summary.ContextMode = contextModeFromSubagentMetadataJSON(childMeta.ContextJSON)
	return &resp, nil
}

func isExpectedFlowerSubagentProjection(meta *threadstore.FlowerThreadMetadata, parentThreadID string, childThreadID string) bool {
	if meta == nil {
		return false
	}
	return strings.TrimSpace(meta.ThreadID) == strings.TrimSpace(childThreadID) &&
		strings.TrimSpace(meta.ParentThreadID) == strings.TrimSpace(parentThreadID) &&
		strings.TrimSpace(strings.ToLower(meta.OwnerKind)) == flowerSubagentProjectionOwnerKind &&
		strings.TrimSpace(meta.OwnerID) == flowerSubagentProjectionOwnerID
}

func (s *Service) detachedSubagentParentRun(meta *session.Meta, th threadstore.Thread) *run {
	if s == nil || meta == nil {
		return nil
	}
	workingDir := strings.TrimSpace(th.WorkingDir)
	if workingDir == "" {
		workingDir = strings.TrimSpace(s.agentHomeDir)
	}
	modelID := strings.TrimSpace(th.ModelID)
	cfg := s.cfg
	r := newRun(runOptions{
		Log:                   s.log,
		StateDir:              s.stateDir,
		AgentHomeDir:          s.agentHomeDir,
		WorkingDir:            workingDir,
		FilesystemScope:       s.scope,
		Shell:                 s.shell,
		AIConfig:              cfg,
		SessionMeta:           meta,
		ResolveProviderKey:    s.resolveProviderKey,
		ResolveWebSearchKey:   s.resolveWebSearchKey,
		DesktopModelSource:    s.desktopModelSource,
		EndpointID:            strings.TrimSpace(meta.EndpointID),
		ThreadID:              strings.TrimSpace(th.ThreadID),
		UserPublicID:          strings.TrimSpace(meta.UserPublicID),
		UploadsDir:            s.uploadsDir,
		ThreadsDB:             s.threadsDB,
		PersistOpTimeout:      s.persistOpTO,
		SkillManager:          s.skillManager,
		ToolTargetPolicy:      s.toolTargetPolicy,
		TargetToolExecutor:    s.targetToolExecutor,
		AllowSubagentDelegate: false,
		NoUserInteraction:     true,
		SubagentDepth:         1,
	})
	r.currentModelID = modelID
	if r.currentModelID == "" && cfg != nil {
		r.currentModelID = strings.TrimSpace(cfg.CurrentModelID)
	}
	r.currentReasoning = unmarshalReasoningSelection(th.ReasoningSelectionJSON)
	if permissionType, err := normalizePermissionType(threadPermissionTypeString(&th, ""), FlowerPermissionApprovalRequired); err == nil {
		r.permissionType = permissionType
	} else {
		r.permissionType = FlowerPermissionApprovalRequired
	}
	return r
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
	toolCommandByCallID := make(map[string]string)
	resultCallIDs := make(map[string]struct{})
	for _, event := range events {
		if event.Kind != flruntime.SubAgentDetailEventToolResult || event.ToolResult == nil {
			continue
		}
		if callID := strings.TrimSpace(event.ToolResult.CallID); callID != "" {
			resultCallIDs[callID] = struct{}{}
		}
	}
	for _, event := range events {
		if event.Kind != flruntime.SubAgentDetailEventToolCall || event.ToolCall == nil {
			continue
		}
		callID := strings.TrimSpace(event.ToolCall.ID)
		command := bestDisplayCommand(event.ToolCall.ArgsPreview)
		if callID != "" && command != "" {
			toolCommandByCallID[callID] = command
		}
	}
	for _, event := range events {
		out = append(out, flowerSubagentTimelineRow(event, toolCommandByCallID, resultCallIDs))
	}
	return out
}

func flowerSubagentTimelineRow(event flruntime.SubAgentDetailEvent, toolCommandByCallID map[string]string, resultCallIDs map[string]struct{}) FlowerSubagentTimelineRow {
	return FlowerSubagentTimelineRow{
		Ordinal:     event.Ordinal,
		Kind:        strings.TrimSpace(string(event.Kind)),
		Type:        strings.TrimSpace(event.Type),
		CreatedAtMs: timeUnixMS(event.CreatedAt),
		Activity:    flowerSubagentActivityBlock(event, toolCommandByCallID, resultCallIDs),
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

func flowerSubagentActivityBlock(event flruntime.SubAgentDetailEvent, toolCommandByCallID map[string]string, resultCallIDs map[string]struct{}) *ActivityTimelineBlock {
	activityEvent, ok := flowerSubagentObservationEvent(event, toolCommandByCallID, resultCallIDs)
	if !ok {
		return nil
	}
	meta := observation.ActivityRunMeta{
		RunID:    "subagent:" + strings.TrimSpace(string(event.ThreadID)),
		ThreadID: strings.TrimSpace(string(event.ThreadID)),
		TurnID:   firstNonEmptyString(strings.TrimSpace(string(event.TurnID)), fmt.Sprintf("row-%d", event.Ordinal)),
		TraceID:  "subagent:" + strings.TrimSpace(string(event.ThreadID)),
	}
	timeline := observation.BuildActivityTimeline(meta, []observation.Event{activityEvent}, timeUnixMS(event.CreatedAt))
	if len(timeline.Items) == 0 {
		return nil
	}
	block := newActivityTimelineBlock(timeline, nil)
	return &block
}

func flowerSubagentObservationEvent(event flruntime.SubAgentDetailEvent, toolCommandByCallID map[string]string, resultCallIDs map[string]struct{}) (observation.Event, bool) {
	observedAt := event.CreatedAt
	if observedAt.IsZero() {
		observedAt = time.Now()
	}
	base := observation.Event{
		RunID:      "subagent:" + strings.TrimSpace(string(event.ThreadID)),
		ThreadID:   strings.TrimSpace(string(event.ThreadID)),
		TurnID:     firstNonEmptyString(strings.TrimSpace(string(event.TurnID)), fmt.Sprintf("row-%d", event.Ordinal)),
		TraceID:    "subagent:" + strings.TrimSpace(string(event.ThreadID)),
		ObservedAt: observedAt,
		Metadata:   stringMapAsAny(event.Metadata),
	}
	switch event.Kind {
	case flruntime.SubAgentDetailEventToolCall:
		call := event.ToolCall
		if call == nil {
			return observation.Event{}, false
		}
		toolName := strings.TrimSpace(call.Name)
		callID := strings.TrimSpace(call.ID)
		if _, hasResult := resultCallIDs[callID]; hasResult {
			return observation.Event{}, false
		}
		args := flowerSubagentToolCallArgs(toolName, call.ArgsPreview)
		base.Type = observation.EventTypeToolCall
		base.ToolID = firstNonEmptyString(callID, fmt.Sprintf("tool-call-%d", event.Ordinal))
		base.ToolName = toolName
		base.ArgsHash = strings.TrimSpace(call.ArgsHash)
		base.Activity = floretActivityForToolCall(toolName, args)
		return base, toolName != ""
	case flruntime.SubAgentDetailEventToolResult:
		result := event.ToolResult
		if result == nil {
			return observation.Event{}, false
		}
		toolName := strings.TrimSpace(result.ToolName)
		callID := strings.TrimSpace(result.CallID)
		status := toolResultStatusSuccess
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(result.Preview)), "error") || strings.TrimSpace(event.Error) != "" {
			status = toolResultStatusError
			base.Error = firstNonEmptyString(strings.TrimSpace(event.Error), strings.TrimSpace(result.Preview))
		}
		payload := flowerSubagentToolResultPayload(toolName, result, toolCommandByCallID[callID])
		activity, err := floretActivityForToolResult(nil, ToolResult{
			ToolID:     firstNonEmptyString(callID, fmt.Sprintf("tool-result-%d", event.Ordinal)),
			ToolName:   toolName,
			Status:     status,
			Summary:    strings.TrimSpace(result.Preview),
			Data:       payload,
			Truncated:  result.Truncated,
			ContentRef: strings.TrimSpace(result.ContentSHA256),
		})
		if err != nil {
			return observation.Event{}, false
		}
		base.Type = observation.EventTypeToolResult
		base.ToolID = firstNonEmptyString(callID, fmt.Sprintf("tool-result-%d", event.Ordinal))
		base.ToolName = toolName
		base.Activity = activity
		return base, toolName != ""
	case flruntime.SubAgentDetailEventApproval:
		approval := event.Approval
		if approval == nil {
			return observation.Event{}, false
		}
		state := strings.TrimSpace(approval.State)
		base.Type = flowerSubagentApprovalEventType(state)
		base.ToolID = firstNonEmptyString(strings.TrimSpace(approval.ToolID), strings.TrimSpace(approval.ArgsHash), fmt.Sprintf("approval-%d", event.Ordinal))
		base.ToolName = firstNonEmptyString(strings.TrimSpace(approval.ToolName), strings.TrimSpace(approval.ToolKind), "approval")
		base.ToolKind = strings.TrimSpace(approval.ToolKind)
		base.ArgsHash = strings.TrimSpace(approval.ArgsHash)
		base.Message = strings.TrimSpace(approval.Reason)
		base.Activity = &observation.ActivityPresentation{
			Label:       firstNonEmptyString(strings.TrimSpace(approval.ToolName), strings.TrimSpace(approval.ToolKind), "Approval"),
			Description: strings.TrimSpace(approval.Reason),
			Renderer:    observation.ActivityRendererStructured,
			Payload: map[string]any{
				"status":    firstNonEmptyString(state, "requested"),
				"reason":    strings.TrimSpace(approval.Reason),
				"args_hash": strings.TrimSpace(approval.ArgsHash),
			},
		}
		return base, true
	case flruntime.SubAgentDetailEventCustom, flruntime.SubAgentDetailEventInput:
		title := strings.TrimSpace(event.Type)
		if title == "" {
			title = strings.TrimSpace(string(event.Kind))
		}
		body := ""
		if event.Message != nil {
			body = strings.TrimSpace(event.Message.Preview)
		}
		payload := map[string]any{
			"summary": firstNonEmptyString(body, title),
		}
		if details := flowerSubagentMetadataDetails(event.Metadata); details != "" {
			payload["details"] = details
		}
		base.Type = observation.EventTypeControlSignal
		base.ToolID = fmt.Sprintf("event-%d", event.Ordinal)
		base.ToolName = "subagent.event"
		base.Message = title
		base.Result = firstNonEmptyString(body, title)
		base.Activity = &observation.ActivityPresentation{
			Label:       title,
			Description: body,
			Renderer:    observation.ActivityRendererStructured,
			Payload:     payload,
		}
		return base, true
	default:
		return observation.Event{}, false
	}
}

func flowerSubagentMetadataDetails(metadata map[string]string) string {
	if len(metadata) == 0 {
		return ""
	}
	keys := make([]string, 0, len(metadata))
	for key, value := range metadata {
		if strings.TrimSpace(key) != "" && strings.TrimSpace(value) != "" {
			keys = append(keys, strings.TrimSpace(key))
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+": "+strings.TrimSpace(metadata[key]))
	}
	return strings.Join(parts, "\n")
}

func stringMapAsAny(in map[string]string) map[string]any {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]any, len(in))
	for key, value := range in {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key != "" && value != "" {
			out[key] = value
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func flowerSubagentToolCallArgs(toolName string, argsPreview string) map[string]any {
	args := map[string]any{}
	preview := strings.TrimSpace(argsPreview)
	if preview == "" {
		return args
	}
	if decoded, ok := tryDecodeJSONArgs(preview); ok {
		if strings.TrimSpace(toolName) == "terminal.exec" {
			if cmd, _ := decoded["command"].(string); strings.TrimSpace(cmd) != "" {
				args["command"] = strings.TrimSpace(cmd)
			}
		} else if summary := extractSummaryFromDecoded(decoded); summary != "" {
			args["summary"] = summary
		}
		return args
	}
	if strings.TrimSpace(toolName) == "terminal.exec" {
		args["command"] = preview
		return args
	}
	args["summary"] = preview
	return args
}

func tryDecodeJSONArgs(preview string) (map[string]any, bool) {
	preview = strings.TrimSpace(preview)
	if !strings.HasPrefix(preview, "{") {
		return nil, false
	}
	var decoded map[string]any
	if err := json.Unmarshal([]byte(preview), &decoded); err != nil {
		return nil, false
	}
	return decoded, true
}

func extractSummaryFromDecoded(decoded map[string]any) string {
	if cmd, _ := decoded["command"].(string); strings.TrimSpace(cmd) != "" {
		return strings.TrimSpace(cmd)
	}
	if desc, _ := decoded["description"].(string); strings.TrimSpace(desc) != "" {
		return strings.TrimSpace(desc)
	}
	return ""
}

func bestDisplayCommand(argsPreview string) string {
	preview := strings.TrimSpace(argsPreview)
	if preview == "" {
		return ""
	}
	if decoded, ok := tryDecodeJSONArgs(preview); ok {
		if cmd, _ := decoded["command"].(string); strings.TrimSpace(cmd) != "" {
			return strings.TrimSpace(cmd)
		}
	}
	return preview
}

func flowerSubagentToolResultPayload(toolName string, result *flruntime.SubAgentDetailToolResult, command string) map[string]any {
	if result == nil {
		return nil
	}
	payload := map[string]any{}
	preview := strings.TrimSpace(result.Preview)
	if strings.TrimSpace(toolName) == "terminal.exec" {
		if command = strings.TrimSpace(command); command != "" {
			payload["command"] = command
		}
		payload["stdout"] = preview
	} else if preview != "" {
		payload["summary"] = preview
	}
	if result.Truncated {
		payload["truncated"] = true
	}
	if result.ContentSHA256 != "" {
		payload["content_ref"] = strings.TrimSpace(result.ContentSHA256)
	}
	if result.OriginalBytes > 0 || result.VisibleBytes > 0 {
		payload["details"] = fmt.Sprintf("bytes %d/%d", result.VisibleBytes, result.OriginalBytes)
	}
	return payload
}

func flowerSubagentApprovalEventType(state string) string {
	switch strings.TrimSpace(state) {
	case "approved":
		return observation.EventTypeToolApprovalApproved
	case "rejected", "denied", "failed":
		return observation.EventTypeToolApprovalRejected
	case "timed_out":
		return observation.EventTypeToolApprovalTimedOut
	case "canceled", "cancelled":
		return observation.EventTypeToolApprovalCanceled
	default:
		return observation.EventTypeToolApprovalRequested
	}
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
		SummarySchemaVersion: strings.TrimSpace(in.SummarySchemaVersion),
		CompactionGeneration: in.CompactionGeneration,
		Summary:              strings.TrimSpace(in.Summary),
		Trigger:              strings.TrimSpace(in.Trigger),
		Reason:               strings.TrimSpace(in.Reason),
		Phase:                strings.TrimSpace(in.Phase),
		TokensBefore:         in.TokensBefore,
		TokensAfterEstimate:  in.TokensAfterEstimate,
		Metadata:             cloneStringMap(in.Metadata),
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

func (s *floretSubagentRuntime) syncProjectedFloretSubagentThreads(ctx context.Context, snapshots []flruntime.SubAgentSnapshot) error {
	if len(snapshots) == 0 {
		return nil
	}
	items := make([]subagentSnapshot, 0, len(snapshots))
	for _, snapshot := range snapshots {
		items = append(items, subagentSnapshotFromFloret(snapshot))
	}
	return s.syncProjectedSubagentThreads(ctx, items)
}

func (s *floretSubagentRuntime) syncProjectedSubagentThreads(ctx context.Context, snapshots []subagentSnapshot) error {
	for _, snapshot := range snapshots {
		if err := s.syncProjectedSubagentThreadOnly(ctx, snapshot); err != nil {
			return err
		}
	}
	s.publishParentSubagentTimeline(ctx)
	return nil
}

func (s *floretSubagentRuntime) syncProjectedSubagentThreadByID(ctx context.Context, threadID string) error {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return nil
	}
	parent := s.parentRun()
	if parent == nil {
		return nil
	}
	host, err := s.ensureHost(ctx)
	if err != nil {
		return err
	}
	snapshots, err := host.ListSubAgents(ctx, flruntime.ThreadID(strings.TrimSpace(parent.threadID)))
	if err != nil {
		return err
	}
	for _, snapshot := range snapshots {
		if strings.TrimSpace(string(snapshot.ThreadID)) == threadID {
			return s.syncProjectedSubagentThreads(ctx, []subagentSnapshot{subagentSnapshotFromFloret(snapshot)})
		}
	}
	return nil
}

func (s *floretSubagentRuntime) syncProjectedSubagentThread(ctx context.Context, snapshot subagentSnapshot) error {
	if err := s.syncProjectedSubagentThreadOnly(ctx, snapshot); err != nil {
		return err
	}
	s.publishParentSubagentTimeline(ctx)
	return nil
}

func (s *floretSubagentRuntime) syncProjectedSubagentThreadOnly(ctx context.Context, snapshot subagentSnapshot) error {
	parent := s.parentRun()
	if parent == nil || parent.threadsDB == nil {
		return nil
	}
	threadID := strings.TrimSpace(snapshot.ThreadID)
	if threadID == "" {
		return nil
	}
	endpointID := strings.TrimSpace(parent.endpointID)
	parentThreadID := strings.TrimSpace(parent.threadID)
	if endpointID == "" || parentThreadID == "" {
		return nil
	}
	if err := s.ensureProjectedSubagentThreadOwner(ctx, endpointID, threadID); err != nil {
		return err
	}
	snapshot = s.withStoredSubagentContextMode(ctx, snapshot)
	var thread flruntime.ThreadSnapshot
	if isSubagentTerminalStatus(snapshot.Status) {
		host, err := s.ensureHost(ctx)
		if err != nil {
			return err
		}
		thread, err = host.ReadThread(ctx, flruntime.ThreadID(threadID))
		if err != nil {
			if isFloretActiveTurnError(err) {
				s.scheduleProjectedSubagentSync(threadID)
			} else {
				return err
			}
		}
	}

	title := firstNonEmptyString(strings.TrimSpace(snapshot.TaskName), strings.TrimSpace(thread.Title), strings.TrimSpace(snapshot.ThreadID), "Subagent")
	createdAt := firstPositiveInt64(snapshot.CreatedAtMS, timeUnixMS(thread.CreatedAt), time.Now().UnixMilli())
	updatedAt := firstPositiveInt64(snapshot.UpdatedAtMS, timeUnixMS(thread.UpdatedAt), createdAt)
	lastPreview, lastAt := projectedSubagentLastMessage(thread.Messages, snapshot.LastMessage, updatedAt)
	modelID := strings.TrimSpace(parent.currentModelID)
	if modelID == "" && parent.cfg != nil {
		modelID = strings.TrimSpace(parent.cfg.CurrentModelID)
	}
	runStatus, runErrCode, runErr := projectedSubagentRunState(snapshot.Status)
	authorID := strings.TrimSpace(parent.userPublicID)
	authorEmail := ""
	if parent.sessionMeta != nil {
		authorEmail = strings.TrimSpace(parent.sessionMeta.UserEmail)
	}

	if err := parent.threadsDB.UpsertProjectedThreadWithFlowerMetadata(ctx, threadstore.Thread{
		ThreadID:              threadID,
		EndpointID:            endpointID,
		NamespacePublicID:     parentNamespacePublicID(parent),
		ModelID:               modelID,
		ModelLocked:           strings.TrimSpace(modelID) != "",
		PermissionType:        permissionTypeString(parent.permissionType),
		WorkingDir:            strings.TrimSpace(parent.workingDir),
		Title:                 title,
		TitleSource:           threadstore.ThreadTitleSourceAuto,
		RunStatus:             runStatus,
		RunUpdatedAtUnixMs:    updatedAt,
		RunErrorCode:          runErrCode,
		RunError:              runErr,
		LastContextRunID:      strings.TrimSpace(snapshot.LatestTurnID),
		CreatedByUserPublicID: authorID,
		CreatedByUserEmail:    authorEmail,
		UpdatedByUserPublicID: authorID,
		UpdatedByUserEmail:    authorEmail,
		CreatedAtUnixMs:       createdAt,
		UpdatedAtUnixMs:       updatedAt,
		LastMessageAtUnixMs:   lastAt,
		LastMessagePreview:    lastPreview,
	}, threadstore.FlowerThreadMetadata{
		EndpointID:        endpointID,
		ThreadID:          threadID,
		OwnerKind:         flowerSubagentProjectionOwnerKind,
		OwnerID:           flowerSubagentProjectionOwnerID,
		ParentThreadID:    parentThreadID,
		ParentRunID:       strings.TrimSpace(parent.id),
		ContextJSON:       projectedSubagentMetadataJSON(snapshot),
		HomeRuntimeKind:   "local_environment",
		OriginEnvPublicID: endpointID,
		UpdatedAtUnixMs:   updatedAt,
	}); err != nil {
		return err
	}
	for index, message := range thread.Messages {
		projected, ok, err := projectedSubagentMessage(endpointID, threadID, message, index, authorID, authorEmail)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		if _, err := parent.threadsDB.UpsertProjectedMessage(ctx, endpointID, threadID, projected, authorID, authorEmail); err != nil {
			return err
		}
	}
	if childActivity, ok, err := projectedSubagentActivityMessage(endpointID, threadID, snapshot, thread, authorID, authorEmail); err != nil {
		return err
	} else if ok {
		if _, err := parent.threadsDB.UpsertProjectedMessage(ctx, endpointID, threadID, childActivity, authorID, authorEmail); err != nil {
			return err
		}
	}
	return nil
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
	flSnapshots, err := host.ListSubAgents(ctxOrBackground(ctx), flruntime.ThreadID(parentThreadID))
	if err != nil {
		parent.persistRunEvent("delegation.timeline.refresh_error", RealtimeStreamKindLifecycle, map[string]any{
			"error": sanitizeLogText(err.Error(), 240),
		})
		return
	}
	snapshots := make([]subagentSnapshot, 0, len(flSnapshots))
	for _, snapshot := range flSnapshots {
		snapshots = append(snapshots, subagentSnapshotFromFloret(snapshot))
	}
	timeline := buildParentSubagentActivityTimeline(parent, snapshots)
	if len(timeline.Items) == 0 {
		return
	}
	parent.publishActivityTimeline(timeline)
}

func (s *floretSubagentRuntime) ensureProjectedSubagentThreadOwner(ctx context.Context, endpointID string, threadID string) error {
	parent := s.parentRun()
	if parent == nil || parent.threadsDB == nil {
		return nil
	}
	existing, err := parent.threadsDB.GetThread(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	meta, err := parent.threadsDB.GetFlowerThreadMetadata(ctx, endpointID, threadID)
	if err != nil {
		return err
	}
	if existing == nil && meta == nil {
		return nil
	}
	if isFlowerSubagentProjection(meta) && strings.TrimSpace(meta.OwnerID) == flowerSubagentProjectionOwnerID {
		return nil
	}
	return fmt.Errorf("projected subagent thread id %q collides with an existing Flower thread", threadID)
}

func (s *floretSubagentRuntime) withStoredSubagentContextMode(ctx context.Context, snapshot subagentSnapshot) subagentSnapshot {
	contextMode := normalizeSubagentContextMode(snapshot.ContextMode)
	if contextMode != subagentContextModeMissionOnly || strings.TrimSpace(snapshot.ContextMode) != "" {
		snapshot.ContextMode = contextMode
		return snapshot
	}
	if stored := s.snapshotContextMode(ctx, snapshot.ThreadID); stored != "" {
		snapshot.ContextMode = stored
		return snapshot
	}
	snapshot.ContextMode = subagentContextModeMissionOnly
	return snapshot
}

func (s *floretSubagentRuntime) snapshotContextMode(ctx context.Context, threadID string) string {
	parent := s.parentRun()
	if parent == nil || parent.threadsDB == nil {
		return ""
	}
	threadID = strings.TrimSpace(threadID)
	endpointID := strings.TrimSpace(parent.endpointID)
	if threadID == "" || endpointID == "" {
		return ""
	}
	meta, err := parent.threadsDB.GetFlowerThreadMetadata(ctxOrBackground(ctx), endpointID, threadID)
	if err != nil || meta == nil {
		return ""
	}
	return contextModeFromSubagentMetadataJSON(meta.ContextJSON)
}

func contextModeFromSubagentMetadataJSON(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return ""
	}
	value := strings.TrimSpace(anyToString(payload["context_mode"]))
	if value == "" {
		return ""
	}
	return normalizeSubagentContextMode(value)
}

func aggregateSubagentContextMode(snapshots []subagentSnapshot) string {
	for _, snapshot := range snapshots {
		if normalizeSubagentContextMode(snapshot.ContextMode) == subagentContextModeFullHistory {
			return subagentContextModeFullHistory
		}
	}
	return subagentContextModeMissionOnly
}

func (s *floretSubagentRuntime) runLabels(agentType string, childThreadID string) flruntime.RunLabels {
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

func buildParentSubagentActivityTimeline(parent *run, snapshots []subagentSnapshot) observation.ActivityTimeline {
	now := time.Now().UnixMilli()
	timeline := observation.ActivityTimeline{
		SchemaVersion: observation.ActivityTimelineSchemaVersion,
		Summary: observation.ActivitySummary{
			Status:   observation.ActivityStatusSuccess,
			Severity: observation.ActivitySeverityQuiet,
		},
		Items: []observation.ActivityItem{},
	}
	if parent != nil {
		timeline.RunID = strings.TrimSpace(parent.id)
		timeline.ThreadID = strings.TrimSpace(parent.threadID)
		timeline.TurnID = strings.TrimSpace(parent.messageID)
		timeline.TraceID = strings.TrimSpace(parent.id)
	}
	items := make([]subagentSnapshot, 0, len(snapshots))
	for _, snapshot := range snapshots {
		if strings.TrimSpace(snapshot.ThreadID) == "" {
			continue
		}
		items = append(items, snapshot)
	}
	sort.SliceStable(items, func(i, j int) bool {
		leftTerminal := isSubagentTerminalStatus(items[i].Status)
		rightTerminal := isSubagentTerminalStatus(items[j].Status)
		if leftTerminal != rightTerminal {
			return !leftTerminal
		}
		if items[i].UpdatedAtMS != items[j].UpdatedAtMS {
			return items[i].UpdatedAtMS > items[j].UpdatedAtMS
		}
		return strings.TrimSpace(items[i].ThreadID) < strings.TrimSpace(items[j].ThreadID)
	})
	counts := observation.ActivityCounts{}
	for _, snapshot := range items {
		status, severity, attention := parentSubagentActivityState(snapshot.Status)
		switch status {
		case observation.ActivityStatusPending:
			counts.Pending++
		case observation.ActivityStatusRunning:
			counts.Running++
		case observation.ActivityStatusWaiting:
			counts.Waiting++
		case observation.ActivityStatusSuccess:
			counts.Success++
		case observation.ActivityStatusError:
			counts.Error++
		case observation.ActivityStatusCanceled:
			counts.Canceled++
		}
		payload := parentSubagentActivityPayload(snapshot)
		payload["operation"] = "subagents"
		payload["action"] = "inspect"
		title := strings.TrimSpace(anyToString(payload["title"]))
		description := strings.TrimSpace(snapshot.LastMessage)
		if description == "" {
			description = strings.TrimSpace(snapshot.Status)
		}
		startedAt := firstPositiveInt64(snapshot.CreatedAtMS, snapshot.UpdatedAtMS, now)
		endedAt := int64(0)
		if isSubagentTerminalStatus(snapshot.Status) {
			endedAt = firstPositiveInt64(snapshot.UpdatedAtMS, now)
		}
		timeline.Items = append(timeline.Items, observation.ActivityItem{
			ItemID:           "subagents:" + stableProjectionHash(strings.TrimSpace(snapshot.ThreadID)),
			ToolID:           "subagents",
			ToolName:         "subagents",
			Kind:             observation.ActivityKindControl,
			Status:           status,
			Severity:         severity,
			NeedsAttention:   len(attention) > 0,
			AttentionReasons: attention,
			RequiresApproval: false,
			StartedAtUnixMS:  startedAt,
			EndedAtUnixMS:    endedAt,
			Label:            firstNonEmptyString(title, strings.TrimSpace(snapshot.ThreadID), "Subagent"),
			Description:      description,
			Payload:          payload,
		})
	}
	timeline.Summary.TotalItems = len(timeline.Items)
	timeline.Summary.Counts = counts
	timeline.Summary.Status, timeline.Summary.Severity, timeline.Summary.NeedsAttention, timeline.Summary.AttentionReasons = parentSubagentSummaryState(counts)
	return timeline
}

func parentSubagentActivityPayload(snapshot subagentSnapshot) map[string]any {
	title := strings.TrimSpace(snapshot.TaskName)
	if title == "" {
		title = strings.TrimSpace(snapshot.ThreadID)
	}
	lastMessage := strings.TrimSpace(snapshot.LastMessage)
	return map[string]any{
		"id":                 strings.TrimSpace(snapshot.ThreadID),
		"subagent_id":        strings.TrimSpace(snapshot.ThreadID),
		"thread_id":          strings.TrimSpace(snapshot.ThreadID),
		"agent_type":         strings.TrimSpace(snapshot.AgentType),
		"title":              title,
		"task_name":          strings.TrimSpace(snapshot.TaskName),
		"status":             strings.TrimSpace(snapshot.Status),
		"last_message":       lastMessage,
		"waiting_prompt":     strings.TrimSpace(snapshot.WaitingPrompt),
		"queued_inputs":      snapshot.QueuedInputs,
		"parent_thread_id":   strings.TrimSpace(snapshot.ParentThreadID),
		"parent_turn_id":     strings.TrimSpace(snapshot.ParentTurnID),
		"latest_turn_id":     strings.TrimSpace(snapshot.LatestTurnID),
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

func parentSubagentActivityState(status string) (observation.ActivityStatus, observation.ActivitySeverity, []observation.ActivityAttentionReason) {
	switch strings.TrimSpace(status) {
	case subagentStatusQueued:
		return observation.ActivityStatusPending, observation.ActivitySeverityQuiet, nil
	case subagentStatusRunning:
		return observation.ActivityStatusRunning, observation.ActivitySeverityNormal, []observation.ActivityAttentionReason{observation.ActivityAttentionRunning}
	case subagentStatusWaiting:
		return observation.ActivityStatusWaiting, observation.ActivitySeverityBlocking, []observation.ActivityAttentionReason{observation.ActivityAttentionWaiting}
	case subagentStatusCompleted:
		return observation.ActivityStatusSuccess, observation.ActivitySeverityNormal, nil
	case subagentStatusFailed, subagentStatusTimedOut:
		return observation.ActivityStatusError, observation.ActivitySeverityError, []observation.ActivityAttentionReason{observation.ActivityAttentionError}
	case subagentStatusCanceled:
		return observation.ActivityStatusCanceled, observation.ActivitySeverityWarning, nil
	default:
		return observation.ActivityStatusPending, observation.ActivitySeverityQuiet, nil
	}
}

func parentSubagentSummaryState(counts observation.ActivityCounts) (observation.ActivityStatus, observation.ActivitySeverity, bool, []observation.ActivityAttentionReason) {
	if counts.Error > 0 {
		return observation.ActivityStatusError, observation.ActivitySeverityError, true, []observation.ActivityAttentionReason{observation.ActivityAttentionError}
	}
	if counts.Waiting > 0 {
		return observation.ActivityStatusWaiting, observation.ActivitySeverityBlocking, true, []observation.ActivityAttentionReason{observation.ActivityAttentionWaiting}
	}
	if counts.Running > 0 {
		return observation.ActivityStatusRunning, observation.ActivitySeverityNormal, true, []observation.ActivityAttentionReason{observation.ActivityAttentionRunning}
	}
	if counts.Pending > 0 {
		return observation.ActivityStatusPending, observation.ActivitySeverityQuiet, false, nil
	}
	if counts.Canceled > 0 && counts.Success == 0 {
		return observation.ActivityStatusCanceled, observation.ActivitySeverityWarning, false, nil
	}
	return observation.ActivityStatusSuccess, observation.ActivitySeverityNormal, false, nil
}

func subagentSnapshotFromFloret(in flruntime.SubAgentSnapshot) subagentSnapshot {
	return subagentSnapshot{
		ThreadID:       strings.TrimSpace(string(in.ThreadID)),
		Path:           strings.TrimSpace(in.Path),
		TaskName:       strings.TrimSpace(in.TaskName),
		ParentThreadID: strings.TrimSpace(string(in.ParentThreadID)),
		ParentTurnID:   strings.TrimSpace(string(in.ParentTurnID)),
		AgentType:      normalizeSubagentAgentType(in.HostProfileRef),
		Status:         flowerSubagentStatus(in.Status),
		LatestTurnID:   strings.TrimSpace(string(in.LatestTurnID)),
		LastMessage:    strings.TrimSpace(in.LastMessage),
		WaitingPrompt:  strings.TrimSpace(in.WaitingPrompt),
		QueuedInputs:   in.QueuedInputs,
		CreatedAtMS:    timeUnixMS(in.CreatedAt),
		UpdatedAtMS:    timeUnixMS(in.UpdatedAt),
		Closed:         in.Closed,
		CanSendInput:   in.CanSendInput,
		CanInterrupt:   in.CanInterrupt,
		CanClose:       in.CanClose,
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

func projectedSubagentRunState(status string) (string, string, string) {
	switch strings.TrimSpace(status) {
	case subagentStatusCompleted:
		return string(RunStateSuccess), "", ""
	case subagentStatusFailed:
		return string(RunStateFailed), "subagent_failed", "The delegated subagent failed."
	case subagentStatusCanceled:
		return string(RunStateCanceled), "", ""
	case subagentStatusTimedOut:
		return string(RunStateTimedOut), "subagent_timed_out", "The delegated subagent timed out."
	case subagentStatusRunning, subagentStatusWaiting:
		return string(RunStateRunning), "", ""
	default:
		return string(RunStateIdle), "", ""
	}
}

func projectedSubagentMetadataJSON(snapshot subagentSnapshot) string {
	payload := map[string]any{
		"kind":               flowerSubagentProjectionOwnerKind,
		"runtime":            "floret",
		"thread_id":          strings.TrimSpace(snapshot.ThreadID),
		"parent_thread_id":   strings.TrimSpace(snapshot.ParentThreadID),
		"parent_turn_id":     strings.TrimSpace(snapshot.ParentTurnID),
		"task_name":          strings.TrimSpace(snapshot.TaskName),
		"agent_type":         strings.TrimSpace(snapshot.AgentType),
		"context_mode":       normalizeSubagentContextMode(snapshot.ContextMode),
		"status":             strings.TrimSpace(snapshot.Status),
		"latest_turn_id":     strings.TrimSpace(snapshot.LatestTurnID),
		"can_send_input":     snapshot.CanSendInput,
		"can_interrupt":      snapshot.CanInterrupt,
		"can_close":          snapshot.CanClose,
		"updated_at_unix_ms": snapshot.UpdatedAtMS,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(body)
}

func projectedSubagentLastMessage(messages []flruntime.ThreadMessage, fallback string, fallbackAt int64) (string, int64) {
	for i := len(messages) - 1; i >= 0; i-- {
		text := strings.TrimSpace(messages[i].Content)
		if text == "" {
			continue
		}
		at := timeUnixMS(messages[i].CreatedAt)
		if at <= 0 {
			at = fallbackAt
		}
		return truncateRunes(text, 160), at
	}
	text := strings.TrimSpace(fallback)
	if text == "" {
		return "", 0
	}
	return truncateRunes(text, 160), fallbackAt
}

func projectedSubagentMessage(endpointID string, threadID string, msg flruntime.ThreadMessage, index int, authorID string, authorEmail string) (threadstore.Message, bool, error) {
	role := normalizeProjectedSubagentMessageRole(msg.Role)
	content := strings.TrimSpace(msg.Content)
	if role == "" || content == "" {
		return threadstore.Message{}, false, nil
	}
	at := timeUnixMS(msg.CreatedAt)
	if at <= 0 {
		at = time.Now().UnixMilli()
	}
	messageID := projectedSubagentMessageID(threadID, msg, index)
	blockType := "markdown"
	if role == "user" {
		blockType = "text"
	}
	raw, err := json.Marshal(persistedMessage{
		ID:        messageID,
		Role:      role,
		Blocks:    []any{persistedTextBlock{Type: blockType, Content: content}},
		Status:    "complete",
		Timestamp: at,
	})
	if err != nil {
		return threadstore.Message{}, false, err
	}
	return threadstore.Message{
		ThreadID:           threadID,
		EndpointID:         endpointID,
		MessageID:          messageID,
		Role:               role,
		AuthorUserPublicID: authorID,
		AuthorUserEmail:    authorEmail,
		Status:             "complete",
		CreatedAtUnixMs:    at,
		UpdatedAtUnixMs:    at,
		TextContent:        content,
		MessageJSON:        string(raw),
	}, true, nil
}

func projectedSubagentActivityMessage(endpointID string, threadID string, snapshot subagentSnapshot, thread flruntime.ThreadSnapshot, authorID string, authorEmail string) (threadstore.Message, bool, error) {
	if threadID == "" {
		return threadstore.Message{}, false, nil
	}
	at := firstPositiveInt64(snapshot.UpdatedAtMS, timeUnixMS(thread.UpdatedAt), time.Now().UnixMilli())
	messageID := "floret_subagent_activity_" + stableProjectionHash(threadID+"\x00"+strings.TrimSpace(snapshot.LatestTurnID))
	title := firstNonEmptyString(strings.TrimSpace(snapshot.TaskName), strings.TrimSpace(snapshot.ThreadID), "Subagent")
	status := strings.TrimSpace(snapshot.Status)
	summaryStatus := "running"
	if isSubagentTerminalStatus(status) {
		summaryStatus = "success"
		if status == subagentStatusFailed || status == subagentStatusTimedOut {
			summaryStatus = "error"
		}
	}
	itemStatus := summaryStatus
	if status == subagentStatusWaiting {
		itemStatus = "waiting"
	}
	block := map[string]any{
		"type":           "activity-timeline",
		"schema_version": 1,
		"run_id":         strings.TrimSpace(snapshot.LatestTurnID),
		"thread_id":      threadID,
		"turn_id":        strings.TrimSpace(snapshot.LatestTurnID),
		"summary": map[string]any{
			"status":          summaryStatus,
			"severity":        "quiet",
			"needs_attention": status == subagentStatusWaiting || status == subagentStatusFailed,
			"total_items":     1,
			"counts":          map[string]any{itemStatus: 1},
		},
		"items": []map[string]any{{
			"item_id":           "subagent.lifecycle",
			"tool_id":           "subagent.lifecycle",
			"tool_name":         "subagents",
			"kind":              "control",
			"status":            itemStatus,
			"severity":          "quiet",
			"needs_attention":   status == subagentStatusWaiting || status == subagentStatusFailed,
			"requires_approval": false,
			"label":             "Subagent lifecycle",
			"description":       title,
			"payload": map[string]any{
				"operation":          "subagents",
				"action":             "inspect",
				"delegation_runtime": "floret",
				"thread_id":          threadID,
				"subagent_id":        threadID,
				"parent_thread_id":   strings.TrimSpace(snapshot.ParentThreadID),
				"parent_turn_id":     strings.TrimSpace(snapshot.ParentTurnID),
				"latest_turn_id":     strings.TrimSpace(snapshot.LatestTurnID),
				"agent_type":         strings.TrimSpace(snapshot.AgentType),
				"task_name":          title,
				"status":             status,
				"last_message":       strings.TrimSpace(snapshot.LastMessage),
			},
		}},
	}
	raw, err := json.Marshal(persistedMessage{
		ID:        messageID,
		Role:      "assistant",
		Blocks:    []any{block},
		Status:    "complete",
		Timestamp: at,
	})
	if err != nil {
		return threadstore.Message{}, false, err
	}
	return threadstore.Message{
		ThreadID:           threadID,
		EndpointID:         endpointID,
		MessageID:          messageID,
		Role:               "assistant",
		AuthorUserPublicID: authorID,
		AuthorUserEmail:    authorEmail,
		Status:             "complete",
		CreatedAtUnixMs:    at,
		UpdatedAtUnixMs:    at,
		TextContent:        "",
		MessageJSON:        string(raw),
	}, true, nil
}

func projectedSubagentMessageID(threadID string, msg flruntime.ThreadMessage, index int) string {
	turnID := strings.TrimSpace(string(msg.TurnID))
	role := strings.TrimSpace(msg.Role)
	content := strings.TrimSpace(msg.Content)
	createdAt := timeUnixMS(msg.CreatedAt)
	hash := stableProjectionHash(strings.Join([]string{
		strings.TrimSpace(threadID),
		turnID,
		role,
		fmt.Sprintf("%d", createdAt),
		content,
		fmt.Sprintf("%d", index),
	}, "\x00"))
	parts := []string{"floret", "subagent"}
	if turnID != "" && isSafeClientMessageID(turnID) {
		parts = append(parts, turnID)
	}
	parts = append(parts, hash)
	return strings.Join(parts, "_")
}

func stableProjectionHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])[:16]
}

func normalizeProjectedSubagentMessageRole(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "user":
		return "user"
	case "assistant":
		return "assistant"
	case "system":
		return "system"
	default:
		return ""
	}
}

func subagentListPayload(snapshot subagentSnapshot) map[string]any {
	payload := subagentSnapshotPayload(snapshot)
	return map[string]any{
		"subagent_id":        payload["subagent_id"],
		"thread_id":          payload["thread_id"],
		"title":              payload["title"],
		"task_name":          payload["task_name"],
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

func isFloretActiveTurnError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "active turn")
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
		s.runtime.scheduleProjectedSubagentSync(eventThreadID)
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
