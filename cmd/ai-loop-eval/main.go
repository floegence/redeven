package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/config"
	"github.com/floegence/redeven/internal/session"
	"github.com/floegence/redeven/internal/settings"
)

type turnMetrics struct {
	RunID                string        `json:"run_id"`
	Duration             time.Duration `json:"-"`
	DurationMS           int64         `json:"duration_ms"`
	AttemptCount         int           `json:"attempt_count"`
	ToolCallCount        int           `json:"tool_call_count"`
	ToolErrorCount       int           `json:"tool_error_count"`
	RecoveryCount        int           `json:"recovery_count"`
	CompletionRetrys     int           `json:"completion_retries"`
	TaskLoopContinue     int           `json:"task_loop_continue"`
	LoopExhausted        bool          `json:"loop_exhausted"`
	PhasePingPong        bool          `json:"phase_pingpong"`
	FinalizationReason   string        `json:"finalization_reason,omitempty"`
	EndState             string        `json:"end_state,omitempty"`
	MonitorAbort         string        `json:"monitor_abort,omitempty"`
	RunError             string        `json:"run_error,omitempty"`
	CompletionReasonFlow []string      `json:"completion_reason_flow,omitempty"`
}

type taskResult struct {
	Task                evalTask             `json:"task"`
	Inputs              []string             `json:"inputs,omitempty"`
	Turns               []turnMetrics        `json:"turns"`
	FinalText           string               `json:"final_text"`
	DurationTotalMS     int64                `json:"duration_total_ms"`
	Score               scoreBreakdown       `json:"score"`
	Outcome             taskOutcome          `json:"outcome"`
	SourceWorkspacePath string               `json:"source_workspace_path"`
	WorkspacePath       string               `json:"workspace_path"`
	WorkspaceMode       string               `json:"workspace_mode,omitempty"`
	WorkspaceSeed       string               `json:"workspace_seed,omitempty"`
	ThreadState         threadStateSummary   `json:"thread_state"`
	ToolCalls           []toolCallSummary    `json:"tool_calls,omitempty"`
	TodoSnapshot        *todoSnapshotSummary `json:"todo_snapshot,omitempty"`
	EventCounts         map[string]int       `json:"event_counts,omitempty"`
	FinalizationReasons []string             `json:"finalization_reasons,omitempty"`
	EvidencePaths       []string             `json:"evidence_paths,omitempty"`

	rawThread    *ai.ThreadView               `json:"-"`
	rawTodos     *ai.ThreadTodosView          `json:"-"`
	rawToolCalls []threadstore.ToolCallRecord `json:"-"`
}

type threadStateSummary struct {
	ThreadID           string   `json:"thread_id,omitempty"`
	ExecutionMode      string   `json:"execution_mode,omitempty"`
	RunStatus          string   `json:"run_status,omitempty"`
	WaitingPrompt      bool     `json:"waiting_prompt"`
	WaitingReasonCode  string   `json:"waiting_reason_code,omitempty"`
	WaitingQuestions   []string `json:"waiting_questions,omitempty"`
	LastMessagePreview string   `json:"last_message_preview,omitempty"`
}

type toolCallSummary struct {
	RunID          string `json:"run_id"`
	ToolID         string `json:"tool_id"`
	ToolName       string `json:"tool_name"`
	Status         string `json:"status"`
	ErrorCode      string `json:"error_code,omitempty"`
	RecoveryAction string `json:"recovery_action,omitempty"`
}

type todoSnapshotSummary struct {
	Version         int64         `json:"version"`
	UpdatedAtUnixMs int64         `json:"updated_at_unix_ms"`
	Total           int           `json:"total"`
	Pending         int           `json:"pending"`
	InProgress      int           `json:"in_progress"`
	Completed       int           `json:"completed"`
	Cancelled       int           `json:"cancelled"`
	Todos           []ai.TodoItem `json:"todos,omitempty"`
}

type scoreBreakdown struct {
	Accuracy   float64 `json:"accuracy"`
	Natural    float64 `json:"natural"`
	Efficiency float64 `json:"efficiency"`
	Overall    float64 `json:"overall"`
}

type evalReport struct {
	GeneratedAt              time.Time               `json:"generated_at"`
	ModelID                  string                  `json:"model_id"`
	TaskSpecPath             string                  `json:"task_spec_path"`
	SourceWorkspacePath      string                  `json:"source_workspace_path"`
	MaterializedWorkspaceDir string                  `json:"materialized_workspace_dir,omitempty"`
	TaskCount                int                     `json:"task_count"`
	Results                  []taskResult            `json:"results"`
	Metrics                  suiteMetrics            `json:"metrics"`
	StageMetrics             map[string]suiteMetrics `json:"stage_metrics,omitempty"`
	Gate                     gateReport              `json:"gate"`
}

type evalProviderKeyResolver func(providerID string) (string, bool, error)

type monitoredResponseWriter struct {
	head    http.Header
	monitor *streamMonitor
}

func (w *monitoredResponseWriter) Header() http.Header {
	if w.head == nil {
		w.head = make(http.Header)
	}
	return w.head
}

func (w *monitoredResponseWriter) WriteHeader(_ int) {}

func (w *monitoredResponseWriter) Write(p []byte) (int, error) {
	if w.monitor != nil {
		w.monitor.feed(p)
	}
	return len(p), nil
}

type streamMonitor struct {
	svc    *ai.Service
	meta   *session.Meta
	runID  string
	ctx    context.Context
	cancel context.CancelFunc

	mu             sync.Mutex
	partial        string
	lastDelta      string
	repeatDelta    int
	toolSigCounter map[string]int
	approvalSeen   map[string]struct{}
	abortReason    string
}

func newStreamMonitor(svc *ai.Service, meta *session.Meta, runID string, ctx context.Context, cancel context.CancelFunc) *streamMonitor {
	return &streamMonitor{
		svc:            svc,
		meta:           meta,
		runID:          runID,
		ctx:            ctx,
		cancel:         cancel,
		toolSigCounter: make(map[string]int),
		approvalSeen:   make(map[string]struct{}),
	}
}

func (m *streamMonitor) feed(p []byte) {
	if m == nil || len(p) == 0 {
		return
	}
	m.mu.Lock()
	m.partial += string(p)
	lines := strings.Split(m.partial, "\n")
	m.partial = lines[len(lines)-1]
	m.mu.Unlock()

	for i := 0; i < len(lines)-1; i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		m.consume(line)
	}
}

func (m *streamMonitor) consume(line string) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(line), &payload); err != nil {
		return
	}
	typ := strings.TrimSpace(strings.ToLower(anyToString(payload["type"])))
	switch typ {
	case "block-delta":
		m.consumeDelta(anyToString(payload["delta"]))
	case "block-set":
		blk, _ := payload["block"].(map[string]any)
		m.consumeBlock(blk)
	}
}

func (m *streamMonitor) consumeDelta(delta string) {
	normalized := normalizeText(delta)
	if normalized == "" {
		return
	}
	m.mu.Lock()
	if normalized == m.lastDelta {
		m.repeatDelta++
	} else {
		m.lastDelta = normalized
		m.repeatDelta = 1
	}
	repeat := m.repeatDelta
	m.mu.Unlock()
	if repeat >= 10 {
		m.abort("repeated_delta")
	}
}

func (m *streamMonitor) consumeBlock(block map[string]any) {
	if len(block) == 0 {
		return
	}
	if strings.TrimSpace(strings.ToLower(anyToString(block["type"]))) != "tool-call" {
		return
	}
	toolName := strings.TrimSpace(strings.ToLower(anyToString(block["toolName"])))
	toolID := strings.TrimSpace(anyToString(block["toolId"]))
	args, _ := block["args"].(map[string]any)
	signature := toolName + "|" + compactJSON(args)

	m.mu.Lock()
	m.toolSigCounter[signature] = m.toolSigCounter[signature] + 1
	count := m.toolSigCounter[signature]
	requiresApproval := anyToBool(block["requiresApproval"])
	approvalState := strings.TrimSpace(strings.ToLower(anyToString(block["approvalState"])))
	_, approvalHandled := m.approvalSeen[toolID]
	if requiresApproval && approvalState == "required" && toolID != "" && !approvalHandled {
		m.approvalSeen[toolID] = struct{}{}
		go m.rejectTool(toolID)
	}
	m.mu.Unlock()

	if count > 16 {
		m.abort("tool_signature_loop")
	}
}

func (m *streamMonitor) rejectTool(toolID string) {
	if m == nil || strings.TrimSpace(toolID) == "" {
		return
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		err := m.svc.ApproveTool(m.meta, m.runID, toolID, false)
		if err == nil {
			return
		}
		select {
		case <-m.ctx.Done():
			return
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func (m *streamMonitor) abort(reason string) {
	if m == nil {
		return
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "monitor_abort"
	}
	m.mu.Lock()
	if m.abortReason != "" {
		m.mu.Unlock()
		return
	}
	m.abortReason = reason
	m.mu.Unlock()
	m.cancel()
}

func (m *streamMonitor) abortState() string {
	if m == nil {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return strings.TrimSpace(m.abortReason)
}

func main() {
	workspace := flag.String("workspace", "/Users/tangjianyin/Downloads/code/openclaw", "workspace absolute path for evaluation tasks")
	reportDir := flag.String("report-dir", "", "output directory for reports (default: ~/.redeven/ai/evals/<timestamp>)")
	taskSpecPath := flag.String("task-spec", filepath.Clean("eval/tasks/default.yaml"), "task specification yaml path")
	baselinePath := flag.String("baseline", filepath.Clean("eval/baselines/open_source_best.json"), "behavioral benchmark baseline json path")
	enforceGate := flag.Bool("enforce-gate", false, "enforce hard gate against configured baselines")
	minPassRate := flag.Float64("min-pass-rate", 0.8, "hard gate minimum pass rate")
	minLoopSafetyRate := flag.Float64("min-loop-safety-rate", 0.95, "hard gate minimum loop safety rate")
	minFallbackFreeRate := flag.Float64("min-fallback-free-rate", 0.98, "hard gate minimum fallback-free rate")
	minAverageAccuracy := flag.Float64("min-accuracy", 80, "hard gate minimum average accuracy")
	flag.Parse()

	workspacePath := strings.TrimSpace(*workspace)
	if workspacePath == "" || !filepath.IsAbs(workspacePath) {
		fatalf("workspace must be an absolute path")
	}
	if st, err := os.Stat(workspacePath); err != nil || !st.IsDir() {
		fatalf("workspace does not exist or is not a directory: %s", workspacePath)
	}

	cfgLayout, err := config.DefaultStateLayout()
	if err != nil {
		fatalf("failed to resolve config path: %v", err)
	}
	cfgPath := cfgLayout.ConfigPath
	cfg, err := config.Load(cfgPath)
	if err != nil {
		fatalf("failed to load config: %v", err)
	}
	if cfg.AI == nil {
		fatalf("ai config is not enabled")
	}
	modelID, ok := cfg.AI.ResolvedCurrentModelID()
	if !ok {
		fatalf("missing current model in AI config")
	}
	secretsPath := filepath.Join(filepath.Dir(cfgPath), "secrets.json")
	secretsStore := settings.NewSecretsStore(secretsPath)

	resolver := func(providerID string) (string, bool, error) {
		return secretsStore.GetAIProviderAPIKey(providerID)
	}

	timestamp := time.Now().Format("20060102-150405")
	outDir := strings.TrimSpace(*reportDir)
	if outDir == "" {
		outDir = filepath.Join(cfgLayout.StateDir, "ai", "evals", timestamp)
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		fatalf("failed to create output dir: %v", err)
	}

	stateDir := filepath.Join(outDir, "state")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		fatalf("failed to create state dir: %v", err)
	}
	materializedWorkspaceRoot := filepath.Join(outDir, "workspaces")
	if err := os.MkdirAll(materializedWorkspaceRoot, 0o700); err != nil {
		fatalf("failed to create task workspace dir: %v", err)
	}

	tasks, loadErr := loadTaskSpecs(strings.TrimSpace(*taskSpecPath))
	if loadErr != nil {
		fatalf("failed to load task specs: %v", loadErr)
	}

	stageMetrics := make(map[string]suiteMetrics)
	fmt.Printf("[ai-loop-eval] model=%s tasks=%d workspace=%s\n", modelID, len(tasks), workspacePath)

	ctx := context.Background()
	results := make([]taskResult, 0, len(tasks))
	for i, task := range tasks {
		fmt.Printf("[task] (%d/%d) %s\n", i+1, len(tasks), task.ID)
		res := runTask(ctx, cfg.AI, resolver, modelID, workspacePath, materializedWorkspaceRoot, stateDir, task)
		results = append(results, res)
		fmt.Printf("  - score=%.2f acc=%.2f nat=%.2f eff=%.2f pass=%t\n", res.Score.Overall, res.Score.Accuracy, res.Score.Natural, res.Score.Efficiency, res.Outcome.Passed)
	}

	metrics := aggregateSuiteMetrics(results)
	for _, stage := range []string{"screen", "deep"} {
		stageResults := filterTaskResultsByStage(results, stage)
		if len(stageResults) == 0 {
			continue
		}
		stageMetrics[stage] = aggregateSuiteMetrics(stageResults)
	}

	thresholds := gateThresholds{
		MinPassRate:         clamp01(*minPassRate),
		MinLoopSafetyRate:   clamp01(*minLoopSafetyRate),
		MinFallbackFreeRate: clamp01(*minFallbackFreeRate),
		MinAverageAccuracy:  clampScore(*minAverageAccuracy),
	}
	gate := gateReport{
		Enabled:    false,
		Thresholds: thresholds,
		Status:     "skipped",
		Metrics:    metrics,
	}

	if baseline := strings.TrimSpace(*baselinePath); baseline != "" {
		baselines, loadErr := loadBenchmarkBaselines(baseline)
		if loadErr != nil {
			if *enforceGate {
				fatalf("failed to load baseline while enforce-gate=true: %v", loadErr)
			}
			fmt.Printf("[ai-loop-eval] baseline skipped: %v\n", loadErr)
		} else {
			gate = evaluateGate(metrics, baselines, thresholds)
			gate.BaselinePath = filepath.Clean(baseline)
		}
	}

	report := evalReport{
		GeneratedAt:              time.Now(),
		ModelID:                  modelID,
		TaskSpecPath:             filepath.Clean(strings.TrimSpace(*taskSpecPath)),
		SourceWorkspacePath:      workspacePath,
		MaterializedWorkspaceDir: materializedWorkspaceRoot,
		TaskCount:                len(results),
		Results:                  results,
		Metrics:                  metrics,
		StageMetrics:             stageMetrics,
		Gate:                     gate,
	}

	jsonPath := filepath.Join(outDir, "report.json")
	if err := writeJSON(jsonPath, report); err != nil {
		fatalf("failed to write report.json: %v", err)
	}
	mdPath := filepath.Join(outDir, "report.md")
	if err := writeMarkdown(mdPath, report); err != nil {
		fatalf("failed to write report.md: %v", err)
	}

	fmt.Printf("[ai-loop-eval] suite pass_rate=%.2f loop_safe=%.2f accuracy=%.2f\n", metrics.PassRate, metrics.LoopSafetyRate, metrics.AverageAccuracy)
	fmt.Printf("[ai-loop-eval] report dir: %s\n", outDir)
	if gate.Enabled {
		fmt.Printf("[ai-loop-eval] gate status: %s\n", gate.Status)
		if len(gate.Reasons) > 0 {
			fmt.Printf("[ai-loop-eval] gate reasons: %s\n", strings.Join(gate.Reasons, "; "))
		}
	}

	if *enforceGate {
		if !gate.Enabled {
			fatalf("enforce-gate=true but gate is not enabled")
		}
		if gate.Status != "pass" {
			fatalf("hard gate rejected this evaluation")
		}
	}
}

func runTask(
	ctx context.Context,
	aiCfg *config.AIConfig,
	resolveProviderAPIKey evalProviderKeyResolver,
	modelID string,
	sourceWorkspace string,
	taskWorkspaceRoot string,
	taskStateRoot string,
	task evalTask,
) taskResult {
	sandbox, err := prepareTaskSandbox(taskWorkspaceRoot, taskStateRoot, task.ID, sourceWorkspace, task.Runtime.Workspace)
	inputs := renderTaskTurns(task.Turns, sandbox.WorkspacePath)
	if err != nil {
		return failedTaskResult(task, sourceWorkspace, sandbox, inputs, "prepare_task_workspace_failed", err)
	}

	runOptions := ai.RunOptions{
		MaxSteps:                         task.Runtime.MaxSteps,
		MaxNoToolRounds:                  task.Runtime.MaxNoToolRounds,
		ReasoningOnly:                    task.Runtime.ReasoningOnly,
		RequireUserConfirmOnTaskComplete: task.Runtime.RequireUserConfirmOnTaskComplete,
		NoUserInteraction:                task.Runtime.NoUserInteraction,
	}
	if sandbox.WorkspaceMode == taskWorkspaceModeSourceReadonly {
		runOptions.ToolAllowlist = evalReadonlyToolAllowlist()
		runOptions.ForceReadonlyExec = true
	}

	svc, err := ai.NewService(ai.Options{
		StateDir:              sandbox.StateDir,
		AgentHomeDir:          sandbox.WorkspacePath,
		Shell:                 "bash",
		Config:                aiCfg,
		RunMaxWallTime:        3 * time.Minute,
		RunIdleTimeout:        75 * time.Second,
		ToolApprovalTimeout:   20 * time.Second,
		PersistOpTimeout:      10 * time.Second,
		ResolveProviderAPIKey: resolveProviderAPIKey,
	})
	if err != nil {
		return failedTaskResult(task, sourceWorkspace, sandbox, inputs, "init_task_service_failed", err)
	}
	defer func() { _ = svc.Close() }()

	channelID := sanitizeID("ch_eval_" + task.ID)
	meta := &session.Meta{
		EndpointID:        "env_ai_loop_eval",
		NamespacePublicID: "ns_ai_loop_eval",
		ChannelID:         channelID,
		UserPublicID:      "u_ai_loop_eval",
		UserEmail:         "u_ai_loop_eval@example.com",
		CanRead:           true,
		CanWrite:          true,
		CanExecute:        true,
		CanAdmin:          false,
	}
	thread, err := svc.CreateThread(ctx, meta, "eval-"+task.ID, modelID, task.Runtime.ExecutionMode, sandbox.WorkspacePath)
	if err != nil {
		return failedTaskResult(task, sourceWorkspace, sandbox, inputs, "create_thread_failed", err)
	}

	turns := make([]turnMetrics, 0, len(inputs))
	eventCounts := make(map[string]int)
	finalizationReasons := make([]string, 0, len(inputs))
	started := time.Now()

	for _, turnText := range inputs {
		runID, ridErr := ai.NewRunID()
		if ridErr != nil {
			turns = append(turns, turnMetrics{RunError: ridErr.Error()})
			continue
		}
		timeout := task.Runtime.TimeoutPerTurn
		if timeout <= 0 {
			timeout = 90 * time.Second
		}
		runCtx, cancel := context.WithTimeout(ctx, timeout)
		monitor := newStreamMonitor(svc, meta, runID, runCtx, cancel)
		writer := &monitoredResponseWriter{monitor: monitor}

		oneStart := time.Now()
		runErr := svc.StartRun(runCtx, meta, runID, ai.RunStartRequest{
			ThreadID: thread.ThreadID,
			Model:    modelID,
			Input:    ai.RunInput{Text: turnText},
			Options:  runOptions,
		}, writer)
		dur := time.Since(oneStart)
		cancel()

		metrics := turnMetrics{RunID: runID, Duration: dur, DurationMS: dur.Milliseconds(), MonitorAbort: monitor.abortState()}
		if runErr != nil {
			metrics.RunError = runErr.Error()
		}
		reasonFlow := make([]string, 0, 12)
		events, evErr := svc.ListRunEvents(context.Background(), meta, runID, 2000)
		if evErr == nil {
			for _, ev := range events.Events {
				eventType := normalizeName(ev.EventType)
				eventCounts[eventType] = eventCounts[eventType] + 1
				switch eventType {
				case "turn.attempt.started":
					metrics.AttemptCount++
				case "tool.call":
					metrics.ToolCallCount++
				case "tool.error":
					metrics.ToolErrorCount++
				case "turn.recovery.triggered":
					metrics.RecoveryCount++
				case "turn.completion.continue":
					metrics.CompletionRetrys++
					if reason := extractReasonFromPayload(ev.Payload); reason != "" {
						reasonFlow = append(reasonFlow, "completion:"+reason)
					}
				case "task.loop.continue":
					metrics.TaskLoopContinue++
					if reason := extractReasonFromPayload(ev.Payload); reason != "" {
						reasonFlow = append(reasonFlow, "task:"+reason)
					}
				case "turn.loop.exhausted":
					metrics.LoopExhausted = true
				case "run.end":
					metrics.FinalizationReason = payloadFieldString(ev.Payload, "finalization_reason")
					metrics.EndState = payloadFieldString(ev.Payload, "state")
				}
			}
		}
		metrics.CompletionReasonFlow = reasonFlow
		metrics.PhasePingPong = detectPhasePingPong(reasonFlow)
		if strings.TrimSpace(strings.ToLower(metrics.FinalizationReason)) == "task_turn_limit_reached" {
			metrics.LoopExhausted = true
		}
		if metrics.AttemptCount == 0 {
			metrics.AttemptCount = 1
		}
		if strings.TrimSpace(metrics.FinalizationReason) != "" {
			finalizationReasons = append(finalizationReasons, strings.TrimSpace(metrics.FinalizationReason))
		}
		turns = append(turns, metrics)
	}

	threadView, _ := svc.GetThread(context.Background(), meta, thread.ThreadID)
	todoView, todoErr := svc.GetThreadTodos(context.Background(), meta, thread.ThreadID)
	if todoErr != nil {
		todoView = nil
	}
	toolCalls, toolErr := svc.ListRecentThreadToolCalls(context.Background(), meta, thread.ThreadID, 200)
	if toolErr != nil {
		toolCalls = nil
	}

	finalText := extractLatestAssistantText(ctx, svc, meta, thread.ThreadID)
	if strings.TrimSpace(finalText) == "" && threadView != nil {
		finalText = strings.TrimSpace(threadView.LastMessagePreview)
	}
	totalDur := time.Since(started)

	result := taskResult{
		Task:                task,
		Inputs:              inputs,
		Turns:               turns,
		FinalText:           finalText,
		DurationTotalMS:     totalDur.Milliseconds(),
		SourceWorkspacePath: sourceWorkspace,
		WorkspacePath:       sandbox.WorkspacePath,
		WorkspaceMode:       sandbox.WorkspaceMode,
		WorkspaceSeed:       sandbox.WorkspaceSeed,
		ThreadState:         summarizeThreadState(threadView),
		ToolCalls:           summarizeToolCalls(toolCalls),
		TodoSnapshot:        buildTodoSnapshotSummary(todoView),
		EventCounts:         eventCounts,
		FinalizationReasons: uniqueStrings(finalizationReasons),
		EvidencePaths:       extractEvidencePaths(finalText, sandbox.WorkspacePath),
		rawThread:           threadView,
		rawTodos:            todoView,
		rawToolCalls:        toolCalls,
	}
	result.Outcome = assessTaskOutcome(task, result)
	result.Score = evaluateScore(task, result, result.Outcome)
	return result
}

func evalReadonlyToolAllowlist() []string {
	return []string{
		"ask_user",
		"exit_plan_mode",
		"file.read",
		"knowledge.search",
		"task_complete",
		"terminal.exec",
		"web.search",
		"write_todos",
	}
}

func failedTaskResult(task evalTask, sourceWorkspace string, sandbox evalTaskSandbox, inputs []string, reason string, err error) taskResult {
	msg := strings.TrimSpace(reason)
	if err != nil {
		msg = msg + ": " + strings.TrimSpace(err.Error())
	}
	return taskResult{
		Task:                task,
		Inputs:              inputs,
		FinalText:           msg,
		Score:               scoreBreakdown{},
		Outcome:             taskOutcome{Passed: false, LoopSafe: false, RecoverySucceeded: false, HardFailReasons: []string{reason}},
		SourceWorkspacePath: sourceWorkspace,
		WorkspacePath:       sandbox.WorkspacePath,
		WorkspaceMode:       sandbox.WorkspaceMode,
		WorkspaceSeed:       sandbox.WorkspaceSeed,
		EventCounts:         map[string]int{},
	}
}

func evaluateScore(task evalTask, result taskResult, outcome taskOutcome) scoreBreakdown {
	accuracy := 100.0
	natural := 100.0
	efficiency := 100.0

	output := task.Assertions.Output
	lower := strings.ToLower(result.FinalText)
	for _, must := range output.MustContain {
		if !matchesRequirement(lower, must) {
			accuracy -= 12
		}
	}
	for _, ban := range output.Forbidden {
		if strings.Contains(lower, strings.ToLower(strings.TrimSpace(ban))) {
			accuracy -= 35
			natural -= 20
		}
	}
	if output.RequireEvidence && len(result.EvidencePaths) == 0 {
		accuracy -= 28
	}
	if output.MinEvidencePaths > 0 && len(result.EvidencePaths) < output.MinEvidencePaths {
		accuracy -= 18
	}
	if output.MinLength > 0 && utf8.RuneCountInString(strings.TrimSpace(result.FinalText)) < output.MinLength {
		accuracy -= 18
		natural -= 12
	}
	if utf8.RuneCountInString(strings.TrimSpace(result.FinalText)) < 40 {
		accuracy -= 12
		natural -= 15
	}
	if looksPreambleOnly(result.FinalText) {
		natural -= 35
	}
	for _, phrase := range fallbackFinalPhrases {
		if strings.Contains(lower, phrase) {
			accuracy -= 40
			natural -= 25
			efficiency -= 20
			break
		}
	}
	natural -= float64(repetitionPenalty(result.FinalText))

	totalSeconds := 0.0
	attempts := 0
	toolCalls := len(result.rawToolCalls)
	toolErrors := 0
	for _, turn := range result.Turns {
		totalSeconds += turn.Duration.Seconds()
		attempts += turn.AttemptCount
		toolErrors += turn.ToolErrorCount
		if turn.MonitorAbort != "" {
			accuracy -= 20
			natural -= 20
			efficiency -= 25
		}
		if turn.LoopExhausted {
			accuracy -= 35
			natural -= 20
			efficiency -= 25
		}
		if turn.PhasePingPong {
			accuracy -= 28
			natural -= 20
			efficiency -= 18
		}
		if strings.TrimSpace(turn.RunError) != "" {
			accuracy -= 18
			efficiency -= 18
		}
	}

	if len(outcome.HardFailReasons) > 0 {
		accuracy -= math.Min(56, float64(len(outcome.HardFailReasons))*8)
	}
	efficiency -= math.Min(55, totalSeconds*1.2)
	if attempts > len(result.Turns) {
		efficiency -= float64((attempts - len(result.Turns)) * 9)
	}
	if toolCalls > 5 {
		efficiency -= float64((toolCalls - 5) * 3)
	}
	if toolErrors > 0 {
		efficiency -= float64(toolErrors * 5)
	}

	accuracy = clampScore(accuracy)
	natural = clampScore(natural)
	efficiency = clampScore(efficiency)
	overall := clampScore(accuracy*0.5 + natural*0.3 + efficiency*0.2)
	return scoreBreakdown{Accuracy: accuracy, Natural: natural, Efficiency: efficiency, Overall: overall}
}

func renderTaskTurns(turns []string, workspace string) []string {
	out := make([]string, 0, len(turns))
	for _, turn := range turns {
		out = append(out, strings.ReplaceAll(turn, "${workspace}", workspace))
	}
	return out
}

func summarizeThreadState(thread *ai.ThreadView) threadStateSummary {
	if thread == nil {
		return threadStateSummary{}
	}
	out := threadStateSummary{
		ThreadID:           strings.TrimSpace(thread.ThreadID),
		ExecutionMode:      strings.TrimSpace(thread.ExecutionMode),
		RunStatus:          strings.TrimSpace(thread.RunStatus),
		WaitingPrompt:      thread.WaitingPrompt != nil,
		LastMessagePreview: strings.TrimSpace(thread.LastMessagePreview),
	}
	if thread.WaitingPrompt != nil {
		out.WaitingReasonCode = strings.TrimSpace(thread.WaitingPrompt.ReasonCode)
		for _, question := range thread.WaitingPrompt.Questions {
			text := strings.TrimSpace(question.Question)
			if text == "" {
				text = strings.TrimSpace(question.Header)
			}
			if text != "" {
				out.WaitingQuestions = append(out.WaitingQuestions, text)
			}
		}
	}
	return out
}

func summarizeToolCalls(calls []threadstore.ToolCallRecord) []toolCallSummary {
	if len(calls) == 0 {
		return nil
	}
	out := make([]toolCallSummary, 0, len(calls))
	for _, call := range calls {
		out = append(out, toolCallSummary{
			RunID:          strings.TrimSpace(call.RunID),
			ToolID:         strings.TrimSpace(call.ToolID),
			ToolName:       strings.TrimSpace(call.ToolName),
			Status:         strings.TrimSpace(call.Status),
			ErrorCode:      strings.TrimSpace(call.ErrorCode),
			RecoveryAction: strings.TrimSpace(call.RecoveryAction),
		})
	}
	return out
}

func buildTodoSnapshotSummary(view *ai.ThreadTodosView) *todoSnapshotSummary {
	if view == nil {
		return nil
	}
	summary := summarizeTodoItems(view.Todos)
	return &todoSnapshotSummary{
		Version:         view.Version,
		UpdatedAtUnixMs: view.UpdatedAtUnixMs,
		Total:           summary.Total,
		Pending:         summary.Pending,
		InProgress:      summary.InProgress,
		Completed:       summary.Completed,
		Cancelled:       summary.Cancelled,
		Todos:           append([]ai.TodoItem(nil), view.Todos...),
	}
}

type todoStats struct {
	Total      int
	Pending    int
	InProgress int
	Completed  int
	Cancelled  int
}

func summarizeTodoItems(items []ai.TodoItem) todoStats {
	stats := todoStats{Total: len(items)}
	for _, item := range items {
		switch strings.TrimSpace(strings.ToLower(item.Status)) {
		case ai.TodoStatusPending:
			stats.Pending++
		case ai.TodoStatusInProgress:
			stats.InProgress++
		case ai.TodoStatusCompleted:
			stats.Completed++
		case ai.TodoStatusCancelled:
			stats.Cancelled++
		}
	}
	return stats
}

func extractLatestAssistantText(ctx context.Context, svc *ai.Service, meta *session.Meta, threadID string) string {
	msgs, err := svc.ListThreadMessages(ctx, meta, threadID, 100, 0)
	if err != nil || msgs == nil || len(msgs.Messages) == 0 {
		return ""
	}
	for i := len(msgs.Messages) - 1; i >= 0; i-- {
		obj := toMessageMap(msgs.Messages[i])
		if len(obj) == 0 {
			continue
		}
		if strings.TrimSpace(strings.ToLower(anyToString(obj["role"]))) != "assistant" {
			continue
		}
		blocks, _ := obj["blocks"].([]any)
		visible := make([]string, 0, len(blocks))
		for _, rawBlock := range blocks {
			block, _ := rawBlock.(map[string]any)
			switch strings.TrimSpace(strings.ToLower(anyToString(block["type"]))) {
			case "markdown", "text", "thinking":
				content := strings.TrimSpace(anyToString(block["content"]))
				if content != "" {
					visible = append(visible, content)
				}
			}
		}
		if len(visible) > 0 {
			return strings.Join(visible, "\n\n")
		}
		for j := len(blocks) - 1; j >= 0; j-- {
			block, _ := blocks[j].(map[string]any)
			if structured := structuredAssistantText(block); structured != "" {
				return structured
			}
		}
	}
	return ""
}

func structuredAssistantText(block map[string]any) string {
	if normalizeName(anyToString(block["type"])) != "tool-call" {
		return ""
	}
	switch strings.TrimSpace(anyToString(block["toolName"])) {
	case "ask_user":
		return extractAskUserText(block["result"], block["args"])
	case "task_complete":
		return extractTaskCompleteText(block["args"])
	default:
		return ""
	}
}

func extractAskUserText(candidates ...any) string {
	for _, raw := range candidates {
		obj, _ := raw.(map[string]any)
		if len(obj) == 0 {
			continue
		}
		if summary := strings.TrimSpace(anyToString(obj["public_summary"])); summary != "" {
			return summary
		}
		questions, _ := obj["questions"].([]any)
		for _, rawQuestion := range questions {
			question, _ := rawQuestion.(map[string]any)
			if text := strings.TrimSpace(anyToString(question["question"])); text != "" {
				return text
			}
			if header := strings.TrimSpace(anyToString(question["header"])); header != "" {
				return header
			}
		}
	}
	return ""
}

func extractTaskCompleteText(raw any) string {
	obj, _ := raw.(map[string]any)
	if len(obj) == 0 {
		return ""
	}
	return strings.TrimSpace(anyToString(obj["result"]))
}

func toMessageMap(v any) map[string]any {
	switch x := v.(type) {
	case map[string]any:
		return x
	case json.RawMessage:
		var out map[string]any
		if err := json.Unmarshal(x, &out); err == nil {
			return out
		}
		return nil
	case []byte:
		var out map[string]any
		if err := json.Unmarshal(x, &out); err == nil {
			return out
		}
		return nil
	default:
		return nil
	}
}

var absolutePathPattern = regexp.MustCompile(`/(?:[^ \t\r\n"'` + "`" + `()<>{}\[\],;:])+`)

func extractEvidencePaths(text string, workspacePath string) []string {
	matches := absolutePathPattern.FindAllString(text, -1)
	if len(matches) == 0 {
		return nil
	}
	workspacePath = filepath.Clean(strings.TrimSpace(workspacePath))
	seen := make(map[string]struct{}, len(matches))
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		path := strings.TrimSpace(match)
		path = strings.TrimRight(path, ".)]")
		if workspacePath != "" && !strings.HasPrefix(path, workspacePath) {
			continue
		}
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		out = append(out, path)
	}
	sort.Strings(out)
	return out
}

func matchesRequirement(text string, requirement string) bool {
	req := strings.TrimSpace(strings.ToLower(requirement))
	if req == "" {
		return true
	}
	parts := strings.Split(req, "|")
	for _, part := range parts {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		if strings.Contains(text, p) {
			return true
		}
	}
	return false
}

func containsEvidencePath(text string, workspacePath string) bool {
	if len(extractEvidencePaths(text, workspacePath)) > 0 {
		return true
	}
	workspacePath = filepath.Clean(workspacePath)
	if workspacePath != "" && strings.Contains(text, workspacePath) {
		return true
	}
	lower := strings.ToLower(text)
	hints := []string{"readme", "package.json", "go.mod", "src/", "cmd/", "internal/"}
	for _, hint := range hints {
		if strings.Contains(lower, hint) {
			return true
		}
	}
	return false
}

func looksPreambleOnly(text string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(text))
	if trimmed == "" {
		return true
	}
	if utf8.RuneCountInString(trimmed) > 180 {
		return false
	}
	preambleHints := []string{"let me", "i will", "first i", "i'll first", "quick scan", "first pass"}
	hasPreamble := false
	for _, hint := range preambleHints {
		if strings.Contains(trimmed, hint) {
			hasPreamble = true
			break
		}
	}
	if !hasPreamble {
		return false
	}
	finalHints := []string{"final", "result", "directory", "conclusion", "recommendation", "risk"}
	for _, hint := range finalHints {
		if strings.Contains(trimmed, hint) {
			return false
		}
	}
	return true
}

func repetitionPenalty(text string) int {
	clean := normalizeText(text)
	if clean == "" {
		return 0
	}
	parts := strings.FieldsFunc(clean, func(r rune) bool {
		switch r {
		case '.', '!', '?', ';', '\n':
			return true
		default:
			return false
		}
	})
	seen := map[string]int{}
	dup := 0
	for _, p := range parts {
		s := strings.TrimSpace(p)
		if utf8.RuneCountInString(s) < 8 {
			continue
		}
		seen[s] = seen[s] + 1
		if seen[s] > 1 {
			dup++
		}
	}
	if dup <= 0 {
		return 0
	}
	penalty := dup * 6
	if penalty > 36 {
		penalty = 36
	}
	return penalty
}

func filterTaskResultsByStage(results []taskResult, stage string) []taskResult {
	stage = normalizeName(stage)
	out := make([]taskResult, 0, len(results))
	for _, result := range results {
		if normalizeName(result.Task.Stage) == stage {
			out = append(out, result)
		}
	}
	return out
}

func anyToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case fmt.Stringer:
		return x.String()
	default:
		return ""
	}
}

func anyToBool(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		x = strings.TrimSpace(strings.ToLower(x))
		return x == "true" || x == "1" || x == "yes"
	case float64:
		return x != 0
	default:
		return false
	}
}

func compactJSON(v any) string {
	if v == nil {
		return "{}"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func normalizeText(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	trimmed = strings.ToLower(trimmed)
	trimmed = strings.Join(strings.Fields(trimmed), " ")
	if utf8.RuneCountInString(trimmed) > 500 {
		trimmed = string([]rune(trimmed)[:500])
	}
	return trimmed
}

func clampScore(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return math.Round(v*100) / 100
}

func sanitizeID(in string) string {
	if strings.TrimSpace(in) == "" {
		return "id"
	}
	var b strings.Builder
	b.Grow(len(in))
	for i := 0; i < len(in); i++ {
		c := in[i]
		switch {
		case c >= 'a' && c <= 'z':
			b.WriteByte(c)
		case c >= 'A' && c <= 'Z':
			b.WriteByte(c)
		case c >= '0' && c <= '9':
			b.WriteByte(c)
		case c == '_' || c == '-':
			b.WriteByte(c)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	if len(out) > 64 {
		out = out[:64]
	}
	return out
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func payloadFieldString(payload any, key string) string {
	obj, ok := payload.(map[string]any)
	if !ok || obj == nil {
		return ""
	}
	return strings.TrimSpace(anyToString(obj[key]))
}

func extractReasonFromPayload(payload any) string {
	reason := strings.TrimSpace(strings.ToLower(payloadFieldString(payload, "reason")))
	if reason == "" {
		return ""
	}
	return reason
}

func detectPhasePingPong(flow []string) bool {
	if len(flow) < 4 {
		return false
	}
	const completionNeed = "completion:needs_synthesis_after_tool_calls"
	const taskNeed = "task:analysis_requires_more_evidence"
	pairs := 0
	for i := 1; i < len(flow); i++ {
		prev := strings.TrimSpace(strings.ToLower(flow[i-1]))
		curr := strings.TrimSpace(strings.ToLower(flow[i]))
		if (prev == completionNeed && curr == taskNeed) || (prev == taskNeed && curr == completionNeed) {
			pairs++
		}
	}
	return pairs >= 3
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	return os.WriteFile(path, b, 0o600)
}

func writeMarkdown(path string, report evalReport) error {
	if report.TaskCount == 0 {
		return errors.New("empty report")
	}
	var b strings.Builder
	b.WriteString("# Flower Behavioral Eval Report\n\n")
	b.WriteString(fmt.Sprintf("- Generated at: %s\n", report.GeneratedAt.Format(time.RFC3339)))
	b.WriteString(fmt.Sprintf("- Model: `%s`\n", report.ModelID))
	b.WriteString(fmt.Sprintf("- Task spec: `%s`\n", report.TaskSpecPath))
	b.WriteString(fmt.Sprintf("- Source workspace: `%s`\n", report.SourceWorkspacePath))
	b.WriteString(fmt.Sprintf("- Materialized task workspaces: `%s`\n", report.MaterializedWorkspaceDir))
	b.WriteString(fmt.Sprintf("- Tasks: %d\n", report.TaskCount))

	b.WriteString("\n## Suite Metrics\n\n")
	b.WriteString(fmt.Sprintf("- Pass rate: %.2f\n", report.Metrics.PassRate))
	b.WriteString(fmt.Sprintf("- Loop safety rate: %.2f\n", report.Metrics.LoopSafetyRate))
	b.WriteString(fmt.Sprintf("- Recovery success rate: %.2f\n", report.Metrics.RecoverySuccessRate))
	b.WriteString(fmt.Sprintf("- Fallback-free rate: %.2f\n", report.Metrics.FallbackFreeRate))
	b.WriteString(fmt.Sprintf("- Average accuracy: %.2f\n", report.Metrics.AverageAccuracy))
	b.WriteString(fmt.Sprintf("- Average overall: %.2f\n", report.Metrics.AverageOverall))

	if len(report.StageMetrics) > 0 {
		b.WriteString("\n## Stage Metrics\n\n")
		b.WriteString("| Stage | Pass | LoopSafe | Recovery | FallbackFree | Accuracy |\n")
		b.WriteString("|---|---:|---:|---:|---:|---:|\n")
		for _, stage := range []string{"screen", "deep"} {
			metrics, ok := report.StageMetrics[stage]
			if !ok {
				continue
			}
			b.WriteString(fmt.Sprintf("| `%s` | %.2f | %.2f | %.2f | %.2f | %.2f |\n", stage, metrics.PassRate, metrics.LoopSafetyRate, metrics.RecoverySuccessRate, metrics.FallbackFreeRate, metrics.AverageAccuracy))
		}
	}

	if report.Gate.Enabled {
		b.WriteString("\n## Gate Status\n\n")
		b.WriteString(fmt.Sprintf("- Status: `%s`\n", report.Gate.Status))
		b.WriteString(fmt.Sprintf("- Baseline: `%s`\n", report.Gate.BaselinePath))
		b.WriteString(fmt.Sprintf("- Thresholds: pass>=%.2f loop_safe>=%.2f fallback_free>=%.2f accuracy>=%.2f\n",
			report.Gate.Thresholds.MinPassRate,
			report.Gate.Thresholds.MinLoopSafetyRate,
			report.Gate.Thresholds.MinFallbackFreeRate,
			report.Gate.Thresholds.MinAverageAccuracy,
		))
		b.WriteString(fmt.Sprintf("- Best reference: pass=%.2f loop_safe=%.2f recovery=%.2f fallback_free=%.2f accuracy=%.2f\n",
			report.Gate.ReferenceBest.PassRate,
			report.Gate.ReferenceBest.LoopSafetyRate,
			report.Gate.ReferenceBest.RecoverySuccessRate,
			report.Gate.ReferenceBest.FallbackFreeRate,
			report.Gate.ReferenceBest.AverageAccuracy,
		))
		if len(report.Gate.Reasons) > 0 {
			b.WriteString("- Reasons: " + strings.Join(report.Gate.Reasons, "; ") + "\n")
		}
	}

	b.WriteString("\n## Task Results\n\n")
	for _, result := range report.Results {
		b.WriteString(fmt.Sprintf("### %s\n\n", result.Task.ID))
		b.WriteString(fmt.Sprintf("- Score: %.2f (acc %.2f / nat %.2f / eff %.2f)\n", result.Score.Overall, result.Score.Accuracy, result.Score.Natural, result.Score.Efficiency))
		b.WriteString(fmt.Sprintf("- Outcome: passed=%t loop_safe=%t fallback=%t recovery_candidate=%t recovery_succeeded=%t\n",
			result.Outcome.Passed,
			result.Outcome.LoopSafe,
			result.Outcome.FallbackFinal,
			result.Outcome.RecoveryCandidate,
			result.Outcome.RecoverySucceeded,
		))
		b.WriteString(fmt.Sprintf("- Thread: mode=`%s` status=`%s` waiting_prompt=%t\n",
			result.ThreadState.ExecutionMode,
			result.ThreadState.RunStatus,
			result.ThreadState.WaitingPrompt,
		))
		b.WriteString(fmt.Sprintf("- Workspace: mode=`%s` path=`%s`\n", result.WorkspaceMode, result.WorkspacePath))
		if seed := strings.TrimSpace(result.WorkspaceSeed); seed != "" {
			b.WriteString(fmt.Sprintf("- Workspace seed: `%s`\n", seed))
		}
		b.WriteString(fmt.Sprintf("- Tool calls: %d\n", len(result.ToolCalls)))
		if result.TodoSnapshot != nil {
			b.WriteString(fmt.Sprintf("- Todos: total=%d pending=%d in_progress=%d completed=%d cancelled=%d\n",
				result.TodoSnapshot.Total,
				result.TodoSnapshot.Pending,
				result.TodoSnapshot.InProgress,
				result.TodoSnapshot.Completed,
				result.TodoSnapshot.Cancelled,
			))
		}
		if len(result.EvidencePaths) > 0 {
			b.WriteString("- Evidence paths: " + strings.Join(result.EvidencePaths, ", ") + "\n")
		}
		if len(result.Outcome.HardFailReasons) > 0 {
			b.WriteString("- Hard fail reasons: " + strings.Join(result.Outcome.HardFailReasons, ", ") + "\n")
		}
		if txt := strings.TrimSpace(result.FinalText); txt != "" {
			preview := txt
			if utf8.RuneCountInString(preview) > 260 {
				preview = string([]rune(preview)[:260]) + "..."
			}
			b.WriteString(fmt.Sprintf("- Output preview: %s\n", strings.ReplaceAll(preview, "\n", " ")))
		}
		b.WriteString("\n")
	}
	return os.WriteFile(path, []byte(b.String()), 0o600)
}

func fatalf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[ai-loop-eval] "+format+"\n", args...)
	os.Exit(1)
}
