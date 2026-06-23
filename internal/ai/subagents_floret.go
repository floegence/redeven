package ai

import (
	"context"
	"crypto/sha256"
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

	subagentDefaultTimeoutMS = 30_000
	subagentMaxTimeoutMS     = 300_000

	flowerSubagentProjectionOwnerKind = "subagent_projection"
	flowerSubagentProjectionOwnerID   = "floret"
)

type subagentRuntime interface {
	manage(context.Context, map[string]any) (map[string]any, error)
	release()
	snapshots(context.Context) ([]subagentSnapshot, error)
}

type subagentSnapshot struct {
	ThreadID       string
	Path           string
	TaskName       string
	ParentThreadID string
	ParentTurnID   string
	AgentType      string
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
	modeFilter := newModeToolFilter(childRun.cfg, false)
	modeFilter = childRun.withToolAllowlistFilter(modeFilter)
	activeTools := modeFilter.FilterToolsForMode(config.AIModeAct, registry.Snapshot())
	activeTools = filterSubagentChildTools(activeTools)
	state := newFloretToolRuntimeState(newRuntimeState("subagents"))
	flTools, err := buildFloretToolRegistry(childRun, activeTools, state)
	if err != nil {
		return nil, "", err
	}
	flProvider := newFloretProviderAdapter(
		adapter,
		providerType,
		modelName,
		"act",
		ProviderControls{
			ReasoningSelection:  config.NormalizeAIReasoningSelection(parent.currentReasoning),
			ReasoningCapability: modelCapability.ReasoningCapability,
		},
		TurnBudgets{},
		parent.webSearchMode,
		withDisabledFloretCoreControlTools("ask_user"),
	)
	storePath, err := floretSubagentStorePath(parent.stateDir)
	if err != nil {
		return nil, "", err
	}
	store, err := flruntime.OpenSQLiteStore(storePath)
	if err != nil {
		return nil, "", err
	}
	systemPrompt := parent.buildSubagentHostSystemPrompt(activeTools)
	host, err := flruntime.NewHost(flruntime.HostOptions{
		Config:       flconfig.Config{Provider: flconfig.ProviderFake, Model: modelName, SystemPrompt: systemPrompt, Reasoning: config.NormalizeAIReasoningSelection(parent.currentReasoning)},
		ModelGateway: flProvider,
		Store:        store,
		Tools:        flTools,
		Approver:     floretToolApproverForRun(childRun),
		Sink:         floretSubagentEventSink{runtime: s},
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
		"require_approval":     r.cfg.EffectiveRequireUserApproval(),
		"block_dangerous":      r.cfg.EffectiveBlockDangerousCommands(),
		"run_mode":             subagentToolModeLimit(r),
		"tool_allowlist":       allowlist,
		"force_readonly_exec":  r.forceReadonlyExec,
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
		ForceReadonlyExec:     r.forceReadonlyExec,
		NoUserInteraction:     true,
		WebSearchToolEnabled:  r.webSearchToolEnabled,
		WebSearchMode:         r.webSearchMode,
		SkillManager:          r.skillManager,
		ToolTargetPolicy:      r.toolTargetPolicy,
		TargetToolExecutor:    r.targetToolExecutor,
		terminalExecRunner:    r.terminalExecRunner,
	})
	child.runMode = subagentToolModeLimit(r)
	child.currentModelID = r.currentModelID
	child.currentReasoning = config.NormalizeAIReasoningSelection(r.currentReasoning)
	return child
}

func subagentToolModeLimit(parent *run) string {
	if parent == nil {
		return config.AIModeAct
	}
	return normalizeRunMode(strings.TrimSpace(parent.runMode), config.AIModeAct)
}

func filterSubagentChildTools(in []ToolDef) []ToolDef {
	out := make([]ToolDef, 0, len(in))
	for _, def := range in {
		switch strings.TrimSpace(def.Name) {
		case "", "subagents", "ask_user", "write_todos", "exit_plan_mode":
			continue
		default:
			out = append(out, def)
		}
	}
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
	prompt := buildFlowerSubagentPrompt(flowerSubagentPromptSpec{
		AgentType:  agentType,
		TaskName:   taskName,
		Message:    message,
		Objective:  objective,
		ParentMode: subagentToolModeLimit(parent),
	})
	snapshot, err := host.SpawnSubAgent(ctx, flruntime.SpawnSubAgentRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ParentTurnID:   flruntime.TurnID(strings.TrimSpace(parent.messageID)),
		TaskName:       taskName,
		Message:        prompt,
		HostProfileRef: agentType,
		ForkMode:       flruntime.SubAgentForkNone,
		Labels:         s.runLabels(agentType, true),
	})
	if err != nil {
		return nil, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
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
	return map[string]any{
		"status":      "ok",
		"action":      subagentActionSpawn,
		"accepted":    true,
		"subagent_id": item["subagent_id"],
		"thread_id":   item["thread_id"],
		"task_id":     item["thread_id"],
		"agent_type":  item["agent_type"],
		"task_name":   item["task_name"],
		"title":       item["title"],
		"subagent":    item,
		"snapshot":    item,
	}, nil
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
	timeoutMS := parseIntArg(args, "timeout_ms", subagentDefaultTimeoutMS)
	if timeoutMS <= 0 {
		timeoutMS = subagentDefaultTimeoutMS
	}
	if timeoutMS > subagentMaxTimeoutMS {
		timeoutMS = subagentMaxTimeoutMS
	}
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
		Timeout:        time.Duration(timeoutMS) * time.Millisecond,
	})
	if err != nil {
		return nil, err
	}
	if err := s.syncProjectedFloretSubagentThreads(ctx, result.Snapshots); err != nil {
		return nil, err
	}
	snapshots := subagentPayloadsFromFloret(result.Snapshots)
	return map[string]any{
		"status":          "ok",
		"action":          subagentActionWait,
		"ids":             ids,
		"target_ids":      ids,
		"timeout_ms":      timeoutMS,
		"timed_out":       result.TimedOut,
		"snapshots":       snapshotsByID(snapshots),
		"snapshots_by_id": snapshotsByID(snapshots),
		"items":           snapshots,
		"subagents":       snapshots,
		"agent_count":     len(snapshots),
		"snapshot_count":  len(snapshots),
	}, nil
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
	out := counts.payload()
	out["status"] = "ok"
	out["action"] = subagentActionList
	out["total"] = len(snapshots)
	out["running_only"] = runningOnly
	out["items"] = items
	out["subagents"] = items
	out["agent_count"] = len(items)
	out["updated_at_unix_ms"] = time.Now().UnixMilli()
	return out, nil
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
	out := map[string]any{
		"status":          status,
		"action":          subagentActionInspect,
		"requested_ids":   targets,
		"requested_count": len(targets),
		"found_count":     len(items),
		"missing_count":   len(missing),
		"missing_ids":     missing,
		"items":           items,
		"subagents":       items,
		"agent_count":     len(items),
	}
	if target := strings.TrimSpace(anyToString(args["target"])); target != "" {
		out["target"] = target
	}
	if len(targets) > 0 {
		out["ids"] = targets
	}
	if len(items) == 1 {
		out["item"] = items[0]
	}
	return out, nil
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
		Labels:         s.runLabels(agentType, false),
	})
	if err != nil {
		return nil, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	if err := s.syncProjectedSubagentThread(ctx, localSnapshot); err != nil {
		return nil, err
	}
	item := subagentSnapshotPayload(localSnapshot)
	return map[string]any{
		"status":      "ok",
		"action":      subagentActionSendInput,
		"target":      target,
		"subagent_id": item["subagent_id"],
		"thread_id":   item["thread_id"],
		"accepted":    true,
		"subagent":    item,
		"snapshot":    item,
	}, nil
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
	snapshot, err := host.CloseSubAgent(ctx, flruntime.CloseSubAgentRequest{
		ParentThreadID: flruntime.ThreadID(strings.TrimSpace(parent.threadID)),
		ChildThreadID:  flruntime.ThreadID(target),
	})
	if err != nil {
		return nil, err
	}
	localSnapshot := subagentSnapshotFromFloret(snapshot)
	if err := s.syncProjectedSubagentThread(ctx, localSnapshot); err != nil {
		return nil, err
	}
	item := subagentSnapshotPayload(localSnapshot)
	return map[string]any{
		"status":      "ok",
		"action":      subagentActionClose,
		"target":      target,
		"subagent_id": item["subagent_id"],
		"thread_id":   item["thread_id"],
		"closed":      true,
		"subagent":    item,
		"snapshot":    item,
	}, nil
}

func (s *floretSubagentRuntime) closeAllAction(ctx context.Context, args map[string]any) (map[string]any, error) {
	_ = args
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
			if _, err := s.close(ctx, map[string]any{"target": snapshot.ThreadID}); err != nil {
				return nil, err
			}
			closedCount++
		}
	}
	latest, err := s.snapshots(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(latest))
	for _, snapshot := range latest {
		items = append(items, subagentSnapshotPayload(snapshot))
	}
	return map[string]any{
		"status":          "ok",
		"action":          subagentActionCloseAll,
		"scope":           "current_run",
		"closed_count":    closedCount,
		"affected_ids":    affected,
		"items":           items,
		"subagents":       items,
		"snapshots":       snapshotsByID(items),
		"snapshots_by_id": snapshotsByID(items),
		"agent_count":     len(affected),
	}, nil
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

	if err := parent.threadsDB.UpsertProjectedThread(ctx, threadstore.Thread{
		ThreadID:              threadID,
		EndpointID:            endpointID,
		NamespacePublicID:     parentNamespacePublicID(parent),
		ModelID:               modelID,
		ModelLocked:           strings.TrimSpace(modelID) != "",
		ExecutionMode:         "act",
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
	}); err != nil {
		return err
	}
	if err := parent.threadsDB.UpsertFlowerThreadMetadata(ctx, threadstore.FlowerThreadMetadata{
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

func (s *floretSubagentRuntime) runLabels(agentType string, approvedWorkerGrant bool) flruntime.RunLabels {
	parent := s.parentRun()
	if parent == nil {
		return flruntime.RunLabels{}
	}
	host := floretHostLabelsForRun(parent)
	if rawAgentType := strings.TrimSpace(agentType); rawAgentType != "" {
		normalized := normalizeSubagentAgentType(rawAgentType)
		host[subagentToolHostContextAgentTypeKey] = normalized
		if normalized == subagentAgentTypeWorker && approvedWorkerGrant {
			host[subagentToolHostContextApprovedWorkerKey] = "true"
		}
	}
	host[subagentToolHostContextParentModeKey] = subagentToolModeLimit(parent)
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

func subagentPayloadsFromFloret(in []flruntime.SubAgentSnapshot) []map[string]any {
	out := make([]map[string]any, 0, len(in))
	for _, snapshot := range in {
		out = append(out, subagentSnapshotPayload(subagentSnapshotFromFloret(snapshot)))
	}
	return out
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
		"task_id":            strings.TrimSpace(snapshot.ThreadID),
		"agent_type":         strings.TrimSpace(snapshot.AgentType),
		"title":              title,
		"task_name":          strings.TrimSpace(snapshot.TaskName),
		"objective":          lastMessage,
		"status":             strings.TrimSpace(snapshot.Status),
		"subagent_status":    strings.TrimSpace(snapshot.Status),
		"result":             lastMessage,
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

func snapshotsByID(items []map[string]any) map[string]any {
	out := make(map[string]any, len(items))
	for _, item := range items {
		id := strings.TrimSpace(anyToString(item["subagent_id"]))
		if id != "" {
			out[id] = item
		}
	}
	return out
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
	result := strings.TrimSpace(snapshot.LastMessage)
	return map[string]any{
		"id":                 snapshot.ThreadID,
		"subagent_id":        snapshot.ThreadID,
		"thread_id":          snapshot.ThreadID,
		"task_id":            snapshot.ThreadID,
		"agent_type":         snapshot.AgentType,
		"title":              title,
		"task_name":          snapshot.TaskName,
		"objective":          result,
		"status":             snapshot.Status,
		"subagent_status":    snapshot.Status,
		"result":             result,
		"last_message":       result,
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
		"result_struct":      map[string]any{"summary": result},
		"stats":              map[string]any{"outcome": snapshot.Status, "queued_inputs": snapshot.QueuedInputs},
		"history":            []map[string]any{},
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
		"task_id":            payload["task_id"],
		"title":              payload["title"],
		"task_name":          payload["task_name"],
		"agent_type":         payload["agent_type"],
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
	AgentType  string
	TaskName   string
	Message    string
	Objective  string
	ParentMode string
}

func buildFlowerSubagentPrompt(spec flowerSubagentPromptSpec) string {
	agentType := normalizeSubagentAgentType(spec.AgentType)
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
		"- Do not create additional subagents and do not ask the user for input.",
		"- Return a concise final handoff with: summary, evidence, changed files if any, open risks, and suggested parent actions.",
	}
	if mode := normalizeRunMode(strings.TrimSpace(spec.ParentMode), config.AIModeAct); mode == config.AIModePlan {
		lines = append(lines, "- The parent thread is in plan mode: inspect and reason only. Mutating tool calls are blocked until the parent leaves plan mode.")
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

func (r *run) buildSubagentHostSystemPrompt(activeTools []ToolDef) string {
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
		"Do not create more subagents, do not ask the user for input, and keep your final handoff concise.",
		"Use tools for evidence when needed, follow repository rules, and respect readonly constraints stated in the mission.",
		"The visible tool list is the parent thread's maximum delegated surface; each mission may further restrict it through its profile and parent mode.",
	}
	if len(toolNames) > 0 {
		lines = append(lines, "Available tools: "+strings.Join(toolNames, ", "))
	}
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
