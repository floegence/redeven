package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	subagentStatusQueued      = "queued"
	subagentStatusRunning     = "running"
	subagentStatusWaiting     = "waiting_input"
	subagentStatusCompleted   = "completed"
	subagentStatusFailed      = "failed"
	subagentStatusCanceled    = "canceled"
	subagentStatusTimedOut    = "timed_out"
	subagentDefaultMaxSteps   = 8
	subagentDefaultTimeoutSec = 180
)

type subagentTask struct {
	id           string
	taskID       string
	objective    string
	mode         string
	modelID      string
	allowedTools []string
	maxSteps     int
	timeoutSec   int

	ctx    context.Context
	cancel context.CancelFunc
	doneCh chan struct{}
	input  chan string

	mu        sync.RWMutex
	status    string
	result    string
	errMsg    string
	startedAt int64
	endedAt   int64
	history   []RunHistoryMsg
}

func (t *subagentTask) setStatus(status string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.status = strings.TrimSpace(status)
	if t.startedAt == 0 {
		t.startedAt = time.Now().UnixMilli()
	}
	if isSubagentTerminalStatus(status) {
		t.endedAt = time.Now().UnixMilli()
	}
}

func (t *subagentTask) setResult(result string, errMsg string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.result = strings.TrimSpace(result)
	t.errMsg = strings.TrimSpace(errMsg)
	if t.startedAt == 0 {
		t.startedAt = time.Now().UnixMilli()
	}
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

func (t *subagentTask) snapshot() map[string]any {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return map[string]any{
		"id":            t.id,
		"task_id":       t.taskID,
		"status":        t.status,
		"result":        t.result,
		"error":         t.errMsg,
		"started_at_ms": t.startedAt,
		"ended_at_ms":   t.endedAt,
	}
}

func (t *subagentTask) statusSnapshot() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.status
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

func (m *subagentManager) getTaskByTaskID(taskID string) *subagentTask {
	m.mu.RLock()
	defer m.mu.RUnlock()
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil
	}
	subagentID, ok := m.taskByTaskID[taskID]
	if !ok {
		return nil
	}
	return m.tasks[subagentID]
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

func (m *subagentManager) delegate(ctx context.Context, args map[string]any) (map[string]any, error) {
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
	mode := strings.ToLower(strings.TrimSpace(anyToString(args["mode"])))
	if mode == "" {
		mode = "plan"
	}
	taskID := strings.TrimSpace(anyToString(args["task_id"]))
	if taskID != "" {
		if task := m.getTaskByTaskID(taskID); task != nil {
			select {
			case task.input <- objective:
			default:
				return nil, fmt.Errorf("subagent input queue is full")
			}
			return map[string]any{
				"subagent_id":   task.id,
				"task_id":       task.taskID,
				"status":        task.statusSnapshot(),
				"reopen_parent": true,
				"resumed":       true,
			}, nil
		}
		return map[string]any{
			"task_id":       taskID,
			"status":        "not_found",
			"reopen_parent": false,
			"resumed":       false,
		}, nil
	}

	maxSteps := parseIntArg(args, "budget.max_steps", subagentDefaultMaxSteps)
	if maxSteps <= 0 {
		maxSteps = subagentDefaultMaxSteps
	}
	if maxSteps > 32 {
		maxSteps = 32
	}
	timeoutSec := parseIntArg(args, "budget.timeout_sec", subagentDefaultTimeoutSec)
	if timeoutSec <= 0 {
		timeoutSec = subagentDefaultTimeoutSec
	}
	if timeoutSec > 900 {
		timeoutSec = 900
	}

	allowedTools := extractStringSlice(args["allowed_tools"])
	if len(allowedTools) == 0 {
		allowedTools = defaultSubagentToolAllowlist()
	}
	modelID := strings.TrimSpace(m.parent.currentModelID)
	if modelID == "" && m.parent.cfg != nil {
		if def, ok := m.parent.cfg.DefaultModelID(); ok {
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
	taskID = subagentID

	taskCtx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	task := &subagentTask{
		id:           subagentID,
		taskID:       taskID,
		objective:    objective,
		mode:         mode,
		modelID:      modelID,
		allowedTools: append([]string(nil), allowedTools...),
		maxSteps:     maxSteps,
		timeoutSec:   timeoutSec,
		ctx:          taskCtx,
		cancel:       cancel,
		doneCh:       make(chan struct{}),
		input:        make(chan string, 8),
		status:       subagentStatusQueued,
		startedAt:    time.Now().UnixMilli(),
	}
	m.addTask(task)
	task.setStatus(subagentStatusRunning)
	m.parent.persistRunEvent("delegation.spawn.begin", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": task.id, "task_id": task.taskID})
	go m.runTask(task, objective)
	return map[string]any{
		"subagent_id":   task.id,
		"task_id":       task.taskID,
		"status":        task.statusSnapshot(),
		"reopen_parent": true,
	}, nil
}

func (m *subagentManager) runTask(task *subagentTask, firstInput string) {
	if m == nil || m.parent == nil || task == nil {
		return
	}
	defer close(task.doneCh)
	defer task.cancel()
	input := strings.TrimSpace(firstInput)
	for {
		if err := task.ctx.Err(); err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				task.setStatus(subagentStatusTimedOut)
				task.setResult(task.result, "subagent timed out")
			} else {
				task.setStatus(subagentStatusCanceled)
				task.setResult(task.result, "subagent canceled")
			}
			m.parent.persistRunEvent("delegation.spawn.end", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": task.id, "status": task.statusSnapshot()})
			return
		}

		runID, err := NewRunID()
		if err != nil {
			task.setStatus(subagentStatusFailed)
			task.setResult("", err.Error())
			m.parent.persistRunEvent("delegation.spawn.end", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": task.id, "status": task.statusSnapshot()})
			return
		}
		messageID, err := newMessageID()
		if err != nil {
			task.setStatus(subagentStatusFailed)
			task.setResult("", err.Error())
			m.parent.persistRunEvent("delegation.spawn.end", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": task.id, "status": task.statusSnapshot()})
			return
		}

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
		_, assistantText, _, snapshotErr := child.snapshotAssistantMessageJSON()
		if snapshotErr != nil {
			assistantText = ""
		}
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
			m.parent.persistRunEvent("delegation.spawn.end", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": task.id, "status": task.statusSnapshot()})
			return
		}

		finalReason := strings.TrimSpace(child.getFinalizationReason())
		if classifyFinalizationReason(finalReason) == finalizationClassWaitingUser {
			task.setStatus(subagentStatusWaiting)
			task.setResult(assistantText, "")
			m.parent.persistRunEvent("delegation.interaction.end", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": task.id, "status": task.statusSnapshot()})
			select {
			case <-task.ctx.Done():
				continue
			case next := <-task.input:
				input = strings.TrimSpace(next)
				if input == "" {
					input = "Continue with previous objective."
				}
				task.setStatus(subagentStatusRunning)
				m.parent.persistRunEvent("delegation.interaction.begin", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": task.id})
				continue
			}
		}

		task.setStatus(subagentStatusCompleted)
		task.setResult(assistantText, "")
		m.parent.persistRunEvent("delegation.spawn.end", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": task.id, "status": task.statusSnapshot()})
		return
	}
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
		m.parent.persistRunEvent("delegation.interaction.begin", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": id})
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
	m.parent.persistRunEvent("delegation.close.end", RealtimeStreamKindLifecycle, map[string]any{"subagent_id": id, "status": task.statusSnapshot()})
	return out, nil
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

func defaultSubagentToolAllowlist() []string {
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
		if name == "delegate_task" || name == "send_subagent_input" || name == "wait_subagents" || name == "close_subagent" || name == "write_todos" {
			continue
		}
		out = append(out, name)
	}
	return out
}
