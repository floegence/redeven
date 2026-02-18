package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"
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

	subagentActionCreate       = "create"
	subagentActionWait         = "wait"
	subagentActionList         = "list"
	subagentActionInspect      = "inspect"
	subagentActionSteer        = "steer"
	subagentActionTerminate    = "terminate"
	subagentActionTerminateAll = "terminate_all"

	subagentDefaultMaxSteps   = 8
	subagentDefaultTimeoutSec = 180
	subagentSteerMinInterval  = 2 * time.Second
)

type subagentStats struct {
	Steps     int64
	ToolCalls int64
	Tokens    int64
	Cost      float64
	ElapsedMS int64
	Outcome   string
}

type subagentExecutionStats struct {
	toolCalls int64
	tokens    int64
	cost      float64
}

type subagentResult struct {
	Summary      string
	EvidenceRefs []string
	KeyFiles     []map[string]any
	OpenRisks    []string
	NextActions  []string
}

func defaultSubagentResult() subagentResult {
	return subagentResult{
		Summary:      "",
		EvidenceRefs: []string{},
		KeyFiles:     []map[string]any{},
		OpenRisks:    []string{},
		NextActions:  []string{},
	}
}

type subagentTask struct {
	id             string
	taskID         string
	objective      string
	agentType      string
	triggerReason  string
	expectedOutput map[string]any

	mode              string
	modelID           string
	allowedTools      []string
	maxSteps          int
	timeoutSec        int
	forceReadonlyExec bool

	ctx    context.Context
	cancel context.CancelFunc
	doneCh chan struct{}
	input  chan string

	mu            sync.RWMutex
	status        string
	result        subagentResult
	errMsg        string
	startedAt     int64
	endedAt       int64
	updatedAt     int64
	history       []RunHistoryMsg
	stats         subagentStats
	lastSteerAtMS int64
}

func (t *subagentTask) setStatus(status string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.status = strings.TrimSpace(status)
	now := time.Now().UnixMilli()
	if t.startedAt == 0 {
		t.startedAt = now
	}
	if isSubagentTerminalStatus(status) {
		t.endedAt = now
	}
	t.updatedAt = now
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) setResult(summary string, errMsg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.result.Summary = strings.TrimSpace(summary)
	t.errMsg = strings.TrimSpace(errMsg)
	now := time.Now().UnixMilli()
	if t.startedAt == 0 {
		t.startedAt = now
	}
	t.updatedAt = now
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) incrementSteps() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.stats.Steps++
	now := time.Now().UnixMilli()
	if t.startedAt == 0 {
		t.startedAt = now
	}
	t.updatedAt = now
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) setExecutionStats(toolCalls int64, tokens int64, cost float64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if toolCalls < 0 {
		toolCalls = 0
	}
	if tokens < 0 {
		tokens = 0
	}
	if math.IsNaN(cost) || math.IsInf(cost, 0) || cost < 0 {
		cost = 0
	}
	t.stats.ToolCalls = toolCalls
	t.stats.Tokens = tokens
	t.stats.Cost = cost
	t.updatedAt = time.Now().UnixMilli()
	t.recalculateDerivedStatsLocked()
}

func (t *subagentTask) allowSteer(minInterval time.Duration) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := time.Now().UnixMilli()
	if t.lastSteerAtMS > 0 && now-t.lastSteerAtMS < minInterval.Milliseconds() {
		return false
	}
	t.lastSteerAtMS = now
	t.updatedAt = now
	return true
}

func (t *subagentTask) recalculateDerivedStatsLocked() {
	endAt := t.endedAt
	if endAt == 0 {
		endAt = time.Now().UnixMilli()
	}
	if t.startedAt > 0 && endAt >= t.startedAt {
		t.stats.ElapsedMS = endAt - t.startedAt
	}
	t.stats.Outcome = strings.TrimSpace(t.status)
}

func (t *subagentTask) appendHistory(user string, assistant string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	user = strings.TrimSpace(user)
	assistant = strings.TrimSpace(assistant)
	if user != "" {
		t.history = append(t.history, RunHistoryMsg{Role: "user", Text: user})
	}
	if assistant != "" {
		t.history = append(t.history, RunHistoryMsg{Role: "assistant", Text: assistant})
	}
	if len(t.history) > 20 {
		t.history = append([]RunHistoryMsg(nil), t.history[len(t.history)-20:]...)
	}
	t.updatedAt = time.Now().UnixMilli()
}

func (t *subagentTask) historySnapshot() []RunHistoryMsg {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if len(t.history) == 0 {
		return nil
	}
	out := make([]RunHistoryMsg, len(t.history))
	copy(out, t.history)
	return out
}

func collectSubagentExecutionStats(child *run, assistantMessageJSON string) subagentExecutionStats {
	stats := subagentExecutionStats{
		toolCalls: countToolCallsFromAssistantMessageJSON(assistantMessageJSON),
	}
	if child == nil {
		return stats
	}
	runtimeToolCalls, runtimeTokens := child.runtimeStatsSnapshot()
	if runtimeToolCalls > 0 || stats.toolCalls == 0 {
		stats.toolCalls = runtimeToolCalls
	}
	if runtimeTokens > 0 {
		stats.tokens = runtimeTokens
	}
	return stats
}

func countToolCallsFromAssistantMessageJSON(messageJSON string) int64 {
	messageJSON = strings.TrimSpace(messageJSON)
	if messageJSON == "" {
		return 0
	}
	var message map[string]any
	if err := json.Unmarshal([]byte(messageJSON), &message); err != nil {
		return 0
	}
	rawBlocks, _ := message["blocks"].([]any)
	if len(rawBlocks) == 0 {
		return 0
	}
	return countToolCallsInBlocks(rawBlocks)
}

func countToolCallsInBlocks(blocks []any) int64 {
	if len(blocks) == 0 {
		return 0
	}
	var total int64
	for _, raw := range blocks {
		block, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		blockType := strings.ToLower(strings.TrimSpace(anyToString(block["type"])))
		if blockType == "tool-call" {
			name := strings.ToLower(strings.TrimSpace(anyToString(block["toolName"])))
			if shouldCountSubagentTool(name) {
				total++
			}
		}
		children, _ := block["children"].([]any)
		total += countToolCallsInBlocks(children)
	}
	return total
}

func shouldCountSubagentTool(toolName string) bool {
	switch strings.ToLower(strings.TrimSpace(toolName)) {
	case "", "sources", "task_complete", "ask_user":
		return false
	default:
		return true
	}
}

func cloneStringSlice(in []string) []string {
	if len(in) == 0 {
		return []string{}
	}
	out := make([]string, len(in))
	copy(out, in)
	return out
}

func cloneMapList(in []map[string]any) []map[string]any {
	if len(in) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(in))
	for _, item := range in {
		cp := map[string]any{}
		for k, v := range item {
			cp[k] = v
		}
		out = append(out, cp)
	}
	return out
}

func cloneHistoryList(in []RunHistoryMsg) []map[string]any {
	if len(in) == 0 {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(in))
	for _, item := range in {
		role := strings.TrimSpace(item.Role)
		text := strings.TrimSpace(item.Text)
		if role == "" || text == "" {
			continue
		}
		out = append(out, map[string]any{
			"role": role,
			"text": text,
		})
	}
	return out
}

func (t *subagentTask) snapshot() map[string]any {
	t.mu.RLock()
	defer t.mu.RUnlock()

	resultPayload := map[string]any{
		"summary":       t.result.Summary,
		"evidence_refs": cloneStringSlice(t.result.EvidenceRefs),
		"key_files":     cloneMapList(t.result.KeyFiles),
		"open_risks":    cloneStringSlice(t.result.OpenRisks),
		"next_actions":  cloneStringSlice(t.result.NextActions),
	}
	statsPayload := map[string]any{
		"steps":      t.stats.Steps,
		"tool_calls": t.stats.ToolCalls,
		"tokens":     t.stats.Tokens,
		"cost":       t.stats.Cost,
		"elapsed_ms": t.stats.ElapsedMS,
		"outcome":    t.stats.Outcome,
	}
	return map[string]any{
		"id":             t.id,
		"subagent_id":    t.id,
		"task_id":        t.taskID,
		"agent_type":     t.agentType,
		"trigger_reason": t.triggerReason,
		"status":         t.status,
		"result":         t.result.Summary,
		"result_struct":  resultPayload,
		"error":          t.errMsg,
		"started_at_ms":  t.startedAt,
		"ended_at_ms":    t.endedAt,
		"updated_at_ms":  t.updatedAt,
		"stats":          statsPayload,
		"history":        cloneHistoryList(t.history),
	}
}

func (t *subagentTask) eventPayload() map[string]any {
	snapshot := t.snapshot()
	return map[string]any{
		"subagent_id":    snapshot["subagent_id"],
		"task_id":        snapshot["task_id"],
		"agent_type":     snapshot["agent_type"],
		"trigger_reason": snapshot["trigger_reason"],
		"status":         snapshot["status"],
		"updated_at_ms":  snapshot["updated_at_ms"],
		"stats":          snapshot["stats"],
	}
}

func (t *subagentTask) statusSnapshot() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.status
}

type subagentRoleDefaults struct {
	Mode              string
	Allowlist         []string
	MaxSteps          int
	TimeoutSec        int
	ForceReadonlyExec bool
}

type subagentManager struct {
	mu           sync.RWMutex
	parent       *run
	tasks        map[string]*subagentTask
	taskByTaskID map[string]string
	maxDepth     int
	maxParallel  int
}

func newSubagentManager(parent *run) *subagentManager {
	return &subagentManager{
		parent:       parent,
		tasks:        map[string]*subagentTask{},
		taskByTaskID: map[string]string{},
		maxDepth:     3,
		maxParallel:  5,
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

func isValidSubagentAgentType(agentType string) bool {
	switch strings.TrimSpace(strings.ToLower(agentType)) {
	case subagentAgentTypeExplore, subagentAgentTypeWorker, subagentAgentTypeReviewer:
		return true
	default:
		return false
	}
}

func buildRoleDefaults(agentType string) subagentRoleDefaults {
	switch strings.TrimSpace(strings.ToLower(agentType)) {
	case subagentAgentTypeWorker:
		return subagentRoleDefaults{
			Mode:              "act",
			Allowlist:         defaultSubagentToolAllowlistWorker(),
			MaxSteps:          12,
			TimeoutSec:        360,
			ForceReadonlyExec: false,
		}
	case subagentAgentTypeReviewer:
		return subagentRoleDefaults{
			Mode:              "plan",
			Allowlist:         defaultSubagentToolAllowlistReadonly(),
			MaxSteps:          10,
			TimeoutSec:        300,
			ForceReadonlyExec: true,
		}
	default:
		return subagentRoleDefaults{
			Mode:              "plan",
			Allowlist:         defaultSubagentToolAllowlistReadonly(),
			MaxSteps:          subagentDefaultMaxSteps,
			TimeoutSec:        subagentDefaultTimeoutSec,
			ForceReadonlyExec: true,
		}
	}
}

func (m *subagentManager) activeCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	count := 0
	for _, task := range m.tasks {
		if task == nil {
			continue
		}
		if !isSubagentTerminalStatus(task.statusSnapshot()) {
			count++
		}
	}
	return count
}

func (m *subagentManager) getTask(id string) *subagentTask {
	m.mu.RLock()
	defer m.mu.RUnlock()
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	if task, ok := m.tasks[id]; ok {
		return task
	}
	if subagentID, ok := m.taskByTaskID[id]; ok {
		return m.tasks[subagentID]
	}
	return nil
}

func (m *subagentManager) allTasks() []*subagentTask {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]*subagentTask, 0, len(m.tasks))
	for _, task := range m.tasks {
		if task != nil {
			out = append(out, task)
		}
	}
	return out
}

func (m *subagentManager) addTask(task *subagentTask) {
	if m == nil || task == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tasks[task.id] = task
	if taskID := strings.TrimSpace(task.taskID); taskID != "" {
		m.taskByTaskID[taskID] = task.id
	}
}

func (m *subagentManager) closeAll() {
	if m == nil {
		return
	}
	for _, task := range m.allTasks() {
		if task == nil {
			continue
		}
		task.cancel()
	}
}

func sanitizeReadonlyAllowlist(allowlist []string) []string {
	return sanitizeSubagentToolAllowlist(allowlist, defaultSubagentToolAllowlistReadonly(), true)
}

func sanitizeSubagentToolAllowlist(allowlist []string, fallback []string, readonlyOnly bool) []string {
	defByName := make(map[string]ToolDef)
	for _, def := range builtInToolDefinitions() {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		defByName[name] = def
	}
	filter := func(source []string) []string {
		if len(source) == 0 {
			return nil
		}
		seen := make(map[string]struct{})
		out := make([]string, 0, len(source))
		for _, rawName := range source {
			name := strings.TrimSpace(rawName)
			if name == "" {
				continue
			}
			if isSubagentDisallowedTool(name) {
				continue
			}
			if def, ok := defByName[name]; ok && readonlyOnly && def.Mutating {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			out = append(out, name)
		}
		return out
	}
	source := allowlist
	if len(source) == 0 {
		source = append([]string(nil), fallback...)
	}
	out := filter(source)
	if len(out) == 0 && len(fallback) > 0 {
		out = filter(fallback)
	}
	return out
}

func isSubagentDisallowedTool(name string) bool {
	switch strings.TrimSpace(name) {
	case "subagents", "write_todos", "ask_user":
		return true
	default:
		return false
	}
}

func (m *subagentManager) create(ctx context.Context, args map[string]any) (map[string]any, error) {
	_ = ctx
	if m == nil || m.parent == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	if m.parent.subagentDepth+1 > m.maxDepth {
		return nil, fmt.Errorf("subagent depth limit reached")
	}
	if m.activeCount() >= m.maxParallel {
		return nil, fmt.Errorf("subagent parallel limit reached")
	}

	objective := strings.TrimSpace(anyToString(args["objective"]))
	if objective == "" {
		return nil, fmt.Errorf("missing objective")
	}
	if strings.TrimSpace(anyToString(args["task_id"])) != "" {
		return nil, fmt.Errorf("task_id is not supported in create action")
	}

	agentType := strings.ToLower(strings.TrimSpace(anyToString(args["agent_type"])))
	if !isValidSubagentAgentType(agentType) {
		return nil, fmt.Errorf("invalid agent_type")
	}
	triggerReason := strings.TrimSpace(anyToString(args["trigger_reason"]))
	if triggerReason == "" {
		return nil, fmt.Errorf("missing trigger_reason")
	}
	expectedOutput, _ := args["expected_output"].(map[string]any)
	if len(expectedOutput) == 0 {
		return nil, fmt.Errorf("missing expected_output")
	}
	expectedOutputCopy := map[string]any{}
	for k, v := range expectedOutput {
		expectedOutputCopy[strings.TrimSpace(k)] = v
	}

	defaults := buildRoleDefaults(agentType)
	mode := strings.ToLower(strings.TrimSpace(anyToString(args["mode"])))
	if mode == "" {
		mode = defaults.Mode
	}
	if mode != "act" && mode != "plan" {
		mode = defaults.Mode
	}

	maxSteps := parseIntArg(args, "budget.max_steps", defaults.MaxSteps)
	if maxSteps <= 0 {
		maxSteps = defaults.MaxSteps
	}
	if maxSteps > 32 {
		maxSteps = 32
	}
	timeoutSec := parseIntArg(args, "budget.timeout_sec", defaults.TimeoutSec)
	if timeoutSec <= 0 {
		timeoutSec = defaults.TimeoutSec
	}
	if timeoutSec > 900 {
		timeoutSec = 900
	}

	allowedTools := sanitizeSubagentToolAllowlist(extractStringSlice(args["allowed_tools"]), defaults.Allowlist, defaults.ForceReadonlyExec)

	modelID := strings.TrimSpace(m.parent.currentModelID)
	if modelID == "" && m.parent.cfg != nil {
		if def, ok := m.parent.cfg.ResolvedCurrentModelID(); ok {
			modelID = def
		}
	}
	if modelID == "" {
		return nil, fmt.Errorf("missing model for subagent")
	}

	subagentID, err := newToolID()
	if err != nil {
		return nil, err
	}
	taskID := subagentID

	taskCtx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	task := &subagentTask{
		id:                subagentID,
		taskID:            taskID,
		objective:         objective,
		agentType:         agentType,
		triggerReason:     triggerReason,
		expectedOutput:    expectedOutputCopy,
		mode:              mode,
		modelID:           modelID,
		allowedTools:      append([]string(nil), allowedTools...),
		maxSteps:          maxSteps,
		timeoutSec:        timeoutSec,
		forceReadonlyExec: defaults.ForceReadonlyExec,
		ctx:               taskCtx,
		cancel:            cancel,
		doneCh:            make(chan struct{}),
		input:             make(chan string, 8),
		status:            subagentStatusQueued,
		result:            defaultSubagentResult(),
		startedAt:         time.Now().UnixMilli(),
		updatedAt:         time.Now().UnixMilli(),
	}
	task.recalculateDerivedStatsLocked()
	m.addTask(task)
	task.setStatus(subagentStatusRunning)

	beginPayload := task.eventPayload()
	m.parent.persistRunEvent("delegation.create.begin", RealtimeStreamKindLifecycle, beginPayload)
	go m.runTask(task, objective)

	return map[string]any{
		"status":          "ok",
		"action":          subagentActionCreate,
		"subagent_id":     task.id,
		"task_id":         task.taskID,
		"agent_type":      task.agentType,
		"trigger_reason":  task.triggerReason,
		"subagent_status": task.statusSnapshot(),
	}, nil
}

func (m *subagentManager) runTask(task *subagentTask, firstInput string) {
	if m == nil || m.parent == nil || task == nil {
		return
	}
	defer close(task.doneCh)
	defer task.cancel()
	input := strings.TrimSpace(firstInput)

	if err := task.ctx.Err(); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			task.setStatus(subagentStatusTimedOut)
			task.setResult(task.result.Summary, "subagent timed out")
		} else {
			task.setStatus(subagentStatusCanceled)
			task.setResult(task.result.Summary, "subagent canceled")
		}
		m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
		return
	}

	runID, err := NewRunID()
	if err != nil {
		task.setStatus(subagentStatusFailed)
		task.setResult("", err.Error())
		m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
		return
	}
	messageID, err := newMessageID()
	if err != nil {
		task.setStatus(subagentStatusFailed)
		task.setResult("", err.Error())
		m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
		return
	}

	task.incrementSteps()
	history := task.historySnapshot()
	child := newRun(runOptions{
		Log:                   m.parent.log,
		StateDir:              m.parent.stateDir,
		FSRoot:                m.parent.fsRoot,
		Shell:                 m.parent.shell,
		AIConfig:              m.parent.cfg,
		SessionMeta:           m.parent.sessionMeta,
		ResolveProviderKey:    m.parent.resolveProviderKey,
		ResolveWebSearchKey:   m.parent.resolveWebSearchKey,
		RunID:                 runID,
		ChannelID:             m.parent.channelID,
		EndpointID:            m.parent.endpointID,
		ThreadID:              m.parent.threadID,
		UserPublicID:          m.parent.userPublicID,
		MessageID:             messageID,
		MaxWallTime:           time.Duration(task.timeoutSec) * time.Second,
		IdleTimeout:           m.parent.idleTimeout,
		ToolApprovalTimeout:   m.parent.toolApprovalTO,
		SubagentDepth:         m.parent.subagentDepth + 1,
		AllowSubagentDelegate: false,
		ToolAllowlist:         append([]string(nil), task.allowedTools...),
		ForceReadonlyExec:     task.forceReadonlyExec,
		NoUserInteraction:     true,
	})

	req := RunRequest{
		Model:     task.modelID,
		Objective: task.objective,
		History:   history,
		Input:     RunInput{Text: input},
		Options: RunOptions{
			Mode:            task.mode,
			MaxSteps:        task.maxSteps,
			MaxNoToolRounds: nativeDefaultNoToolRounds,
		},
	}

	err = child.run(task.ctx, req)
	assistantMessageJSON, assistantText, _, snapshotErr := child.snapshotAssistantMessageJSON()
	if snapshotErr != nil {
		assistantMessageJSON = ""
		assistantText = ""
	}
	stats := collectSubagentExecutionStats(child, assistantMessageJSON)
	task.setExecutionStats(stats.toolCalls, stats.tokens, stats.cost)
	task.appendHistory(input, assistantText)

	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			task.setStatus(subagentStatusTimedOut)
			task.setResult(assistantText, "subagent timed out")
		} else if errors.Is(err, context.Canceled) {
			task.setStatus(subagentStatusCanceled)
			task.setResult(assistantText, "subagent canceled")
		} else {
			task.setStatus(subagentStatusFailed)
			task.setResult(assistantText, strings.TrimSpace(err.Error()))
		}
		m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
		return
	}

	finalReason := strings.TrimSpace(child.getFinalizationReason())
	if classifyFinalizationReason(finalReason) == finalizationClassWaitingUser {
		task.setStatus(subagentStatusFailed)
		task.setResult(assistantText, "subagent blocked by no-user-interaction policy")
		payload := task.eventPayload()
		payload["reason"] = "no_user_interaction_policy"
		m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, payload)
		return
	}

	task.setStatus(subagentStatusCompleted)
	task.setResult(assistantText, "")
	m.parent.persistRunEvent("delegation.create.end", RealtimeStreamKindLifecycle, task.eventPayload())
}

func (m *subagentManager) sendInput(id string, message string, interrupt bool) (map[string]any, error) {
	if m == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	id = strings.TrimSpace(id)
	message = strings.TrimSpace(message)
	if id == "" || message == "" {
		return nil, fmt.Errorf("missing id or message")
	}
	task := m.getTask(id)
	if task == nil {
		return map[string]any{"id": id, "status": "not_found"}, nil
	}
	if interrupt {
		task.cancel()
	}
	select {
	case task.input <- message:
		m.parent.persistRunEvent("delegation.interaction.begin", RealtimeStreamKindLifecycle, task.eventPayload())
		return task.snapshot(), nil
	default:
		return nil, fmt.Errorf("subagent input queue is full")
	}
}

func (m *subagentManager) wait(ctx context.Context, ids []string) (map[string]any, bool) {
	if m == nil {
		return map[string]any{}, false
	}
	set := map[string]struct{}{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" {
			set[id] = struct{}{}
		}
	}
	pick := make([]*subagentTask, 0)
	for _, task := range m.allTasks() {
		if task == nil {
			continue
		}
		if len(set) > 0 {
			if _, ok := set[task.id]; !ok {
				continue
			}
		}
		pick = append(pick, task)
	}
	if len(pick) == 0 {
		return map[string]any{}, false
	}
	m.parent.persistRunEvent("delegation.wait.begin", RealtimeStreamKindLifecycle, map[string]any{"targets": len(pick)})
	ticker := time.NewTicker(120 * time.Millisecond)
	defer ticker.Stop()
	for {
		allFinal := true
		for _, task := range pick {
			if task == nil {
				continue
			}
			if !isSubagentTerminalStatus(task.statusSnapshot()) {
				allFinal = false
				break
			}
		}
		if allFinal {
			out := make(map[string]any, len(pick))
			for _, task := range pick {
				out[task.id] = task.snapshot()
			}
			m.parent.persistRunEvent("delegation.wait.end", RealtimeStreamKindLifecycle, map[string]any{"targets": len(pick), "timed_out": false})
			return out, false
		}
		select {
		case <-ctx.Done():
			out := make(map[string]any, len(pick))
			for _, task := range pick {
				out[task.id] = task.snapshot()
			}
			m.parent.persistRunEvent("delegation.wait.end", RealtimeStreamKindLifecycle, map[string]any{"targets": len(pick), "timed_out": true})
			return out, true
		case <-ticker.C:
		}
	}
}

func (m *subagentManager) close(id string) (map[string]any, error) {
	if m == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("missing id")
	}
	task := m.getTask(id)
	if task == nil {
		return map[string]any{"id": id, "status": "not_found"}, nil
	}
	m.parent.persistRunEvent("delegation.close.begin", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": id})
	task.cancel()
	select {
	case <-task.doneCh:
	case <-time.After(2 * time.Second):
	}
	out := task.snapshot()
	m.parent.persistRunEvent("delegation.close.end", RealtimeStreamKindLifecycle, task.eventPayload())
	return out, nil
}

func parseBoolArg(args map[string]any, key string, fallback bool) bool {
	raw, ok := args[key]
	if !ok {
		return fallback
	}
	switch v := raw.(type) {
	case bool:
		return v
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "y", "on":
			return true
		case "0", "false", "no", "n", "off":
			return false
		default:
			return fallback
		}
	default:
		return fallback
	}
}

func (m *subagentManager) manage(ctx context.Context, args map[string]any) (map[string]any, error) {
	if m == nil {
		return nil, errors.New("subagent manager unavailable")
	}
	action := strings.ToLower(strings.TrimSpace(anyToString(args["action"])))
	if action == "" {
		return nil, fmt.Errorf("missing action")
	}
	m.parent.persistRunEvent("delegation.manage.begin", RealtimeStreamKindLifecycle, map[string]any{"action": action})
	var out map[string]any
	var err error
	switch action {
	case subagentActionCreate:
		out, err = m.create(ctx, args)
	case subagentActionWait:
		out, err = m.manageWait(ctx, args)
	case subagentActionList:
		out, err = m.manageList(args)
	case subagentActionInspect:
		out, err = m.manageInspect(args)
	case subagentActionSteer:
		out, err = m.manageSteer(args)
	case subagentActionTerminate:
		out, err = m.manageTerminate(args)
	case subagentActionTerminateAll:
		out, err = m.manageTerminateAll(args)
	default:
		err = fmt.Errorf("unsupported action %q", action)
	}
	if err != nil {
		return nil, err
	}
	m.parent.persistRunEvent("delegation.manage.end", RealtimeStreamKindLifecycle, map[string]any{
		"action": action,
		"status": strings.TrimSpace(anyToString(out["status"])),
	})
	return out, nil
}

func sortTasksByUpdatedDesc(tasks []*subagentTask) {
	sort.Slice(tasks, func(i, j int) bool {
		left := tasks[i].snapshot()
		right := tasks[j].snapshot()
		leftUpdated := parseIntRaw(left["updated_at_ms"], 0)
		rightUpdated := parseIntRaw(right["updated_at_ms"], 0)
		if leftUpdated == rightUpdated {
			leftStart := parseIntRaw(left["started_at_ms"], 0)
			rightStart := parseIntRaw(right["started_at_ms"], 0)
			return leftStart > rightStart
		}
		return leftUpdated > rightUpdated
	})
}

func (m *subagentManager) manageList(args map[string]any) (map[string]any, error) {
	runningOnly := parseBoolArg(args, "running_only", false)
	limit := parseIntArg(args, "limit", 50)
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	tasks := m.allTasks()
	sortTasksByUpdatedDesc(tasks)

	items := make([]map[string]any, 0, len(tasks))
	counts := map[string]int{
		subagentStatusQueued:    0,
		subagentStatusRunning:   0,
		subagentStatusWaiting:   0,
		subagentStatusCompleted: 0,
		subagentStatusFailed:    0,
		subagentStatusCanceled:  0,
		subagentStatusTimedOut:  0,
	}
	for _, task := range tasks {
		if task == nil {
			continue
		}
		snapshot := task.snapshot()
		status := strings.TrimSpace(anyToString(snapshot["status"]))
		if _, ok := counts[status]; ok {
			counts[status]++
		}
		if runningOnly && isSubagentTerminalStatus(status) {
			continue
		}
		item := map[string]any{
			"subagent_id":    snapshot["subagent_id"],
			"task_id":        snapshot["task_id"],
			"agent_type":     snapshot["agent_type"],
			"trigger_reason": snapshot["trigger_reason"],
			"status":         status,
			"updated_at_ms":  snapshot["updated_at_ms"],
			"stats":          snapshot["stats"],
		}
		items = append(items, item)
		if len(items) >= limit {
			break
		}
	}
	return map[string]any{
		"status":             "ok",
		"action":             subagentActionList,
		"total":              len(tasks),
		"running_only":       runningOnly,
		"queued":             counts[subagentStatusQueued],
		"running":            counts[subagentStatusRunning],
		"waiting_input":      counts[subagentStatusWaiting],
		"completed":          counts[subagentStatusCompleted],
		"failed":             counts[subagentStatusFailed],
		"canceled":           counts[subagentStatusCanceled],
		"timed_out":          counts[subagentStatusTimedOut],
		"items":              items,
		"updated_at_unix_ms": time.Now().UnixMilli(),
	}, nil
}

func (m *subagentManager) manageWait(ctx context.Context, args map[string]any) (map[string]any, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	timeoutMS := parseIntArg(args, "timeout_ms", 30_000)
	if timeoutMS < 10_000 {
		timeoutMS = 10_000
	}
	if timeoutMS > 300_000 {
		timeoutMS = 300_000
	}
	ids := extractStringSlice(args["ids"])
	waitCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMS)*time.Millisecond)
	defer cancel()
	snapshots, timedOut := m.wait(waitCtx, ids)
	return map[string]any{
		"status":     "ok",
		"action":     subagentActionWait,
		"ids":        ids,
		"timeout_ms": timeoutMS,
		"timed_out":  timedOut,
		"snapshots":  snapshots,
	}, nil
}

func (m *subagentManager) manageInspect(args map[string]any) (map[string]any, error) {
	target := strings.TrimSpace(anyToString(args["target"]))
	task := m.getTask(target)
	if task == nil {
		return map[string]any{
			"status": "not_found",
			"action": subagentActionInspect,
			"target": target,
		}, nil
	}
	return map[string]any{
		"status": "ok",
		"action": subagentActionInspect,
		"target": target,
		"item":   task.snapshot(),
	}, nil
}

func (m *subagentManager) manageSteer(args map[string]any) (map[string]any, error) {
	target := strings.TrimSpace(anyToString(args["target"]))
	message := strings.TrimSpace(anyToString(args["message"]))
	interrupt := parseBoolArg(args, "interrupt", false)
	if target == "" || message == "" {
		return nil, fmt.Errorf("missing target or message")
	}
	task := m.getTask(target)
	if task == nil {
		return map[string]any{
			"status": "not_found",
			"action": subagentActionSteer,
			"target": target,
		}, nil
	}
	if isSubagentTerminalStatus(task.statusSnapshot()) {
		return map[string]any{
			"status":      "already_terminal",
			"action":      subagentActionSteer,
			"subagent_id": task.id,
			"target":      target,
		}, nil
	}
	if !task.allowSteer(subagentSteerMinInterval) {
		return map[string]any{
			"status":      "rate_limited",
			"action":      subagentActionSteer,
			"subagent_id": task.id,
			"target":      target,
		}, nil
	}
	snapshot, err := m.sendInput(task.id, message, interrupt)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":      "ok",
		"action":      subagentActionSteer,
		"subagent_id": task.id,
		"target":      target,
		"accepted":    true,
		"snapshot":    snapshot,
	}, nil
}

func (m *subagentManager) manageTerminate(args map[string]any) (map[string]any, error) {
	target := strings.TrimSpace(anyToString(args["target"]))
	if target == "" {
		return nil, fmt.Errorf("missing target")
	}
	task := m.getTask(target)
	if task == nil {
		return map[string]any{
			"status": "not_found",
			"action": subagentActionTerminate,
			"target": target,
		}, nil
	}
	if isSubagentTerminalStatus(task.statusSnapshot()) {
		return map[string]any{
			"status":      "already_terminal",
			"action":      subagentActionTerminate,
			"target":      target,
			"subagent_id": task.id,
			"snapshot":    task.snapshot(),
		}, nil
	}
	snapshot, err := m.close(task.id)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"status":      "ok",
		"action":      subagentActionTerminate,
		"target":      target,
		"subagent_id": task.id,
		"killed":      true,
		"snapshot":    snapshot,
	}, nil
}

func (m *subagentManager) manageTerminateAll(args map[string]any) (map[string]any, error) {
	scope := strings.ToLower(strings.TrimSpace(anyToString(args["scope"])))
	if scope == "" {
		scope = "current_run"
	}
	if scope != "current_run" {
		return nil, fmt.Errorf("forbidden scope")
	}

	tasks := m.allTasks()
	killedCount := 0
	alreadyTerminalCount := 0
	affectedIDs := make([]string, 0, len(tasks))

	for _, task := range tasks {
		if task == nil {
			continue
		}
		affectedIDs = append(affectedIDs, task.id)
		if isSubagentTerminalStatus(task.statusSnapshot()) {
			alreadyTerminalCount++
			continue
		}
		if _, err := m.close(task.id); err != nil {
			return nil, err
		}
		killedCount++
	}

	return map[string]any{
		"status":                 "ok",
		"action":                 subagentActionTerminateAll,
		"scope":                  scope,
		"killed_count":           killedCount,
		"already_terminal_count": alreadyTerminalCount,
		"affected_ids":           affectedIDs,
	}, nil
}

func parseIntArg(args map[string]any, key string, fallback int) int {
	if len(args) == 0 {
		return fallback
	}
	if !strings.Contains(key, ".") {
		return parseIntRaw(args[key], fallback)
	}
	parts := strings.Split(key, ".")
	current := any(args)
	for _, part := range parts {
		m, ok := current.(map[string]any)
		if !ok {
			return fallback
		}
		current = m[part]
	}
	return parseIntRaw(current, fallback)
}

func parseIntRaw(v any, fallback int) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	case float32:
		return int(x)
	default:
		return fallback
	}
}

func defaultSubagentToolAllowlistReadonly() []string {
	defs := builtInToolDefinitions()
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		if def.Mutating {
			continue
		}
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if isSubagentDisallowedTool(name) {
			continue
		}
		out = append(out, name)
	}
	return out
}

func defaultSubagentToolAllowlistWorker() []string {
	defs := builtInToolDefinitions()
	out := make([]string, 0, len(defs))
	for _, def := range defs {
		name := strings.TrimSpace(def.Name)
		if name == "" {
			continue
		}
		if isSubagentDisallowedTool(name) {
			continue
		}
		out = append(out, name)
	}
	return out
}
