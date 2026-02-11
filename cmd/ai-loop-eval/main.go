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
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/floegence/redeven-agent/internal/ai"
	"github.com/floegence/redeven-agent/internal/config"
	"github.com/floegence/redeven-agent/internal/session"
	"github.com/floegence/redeven-agent/internal/settings"
)

type evalVariant struct {
	ID            string `json:"id"`
	PromptProfile string `json:"prompt_profile"`
	LoopProfile   string `json:"loop_profile"`
}

type evalTask struct {
	ID                     string        `json:"id"`
	Title                  string        `json:"title"`
	Stage                  string        `json:"stage"`
	Category               string        `json:"category,omitempty"`
	Turns                  []string      `json:"turns"`
	MaxSteps               int           `json:"max_steps"`
	TimeoutPerTurn         time.Duration `json:"timeout_per_turn"`
	RequireEvidence        bool          `json:"require_evidence"`
	MustContain            []string      `json:"must_contain"`
	Forbidden              []string      `json:"forbidden"`
	HardFailEvents         []string      `json:"hard_fail_events,omitempty"`
	MustNotEndWithFallback bool          `json:"must_not_end_with_fallback"`
}

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
	Variant         evalVariant    `json:"variant"`
	Task            evalTask       `json:"task"`
	Turns           []turnMetrics  `json:"turns"`
	FinalText       string         `json:"final_text"`
	DurationTotalMS int64          `json:"duration_total_ms"`
	Score           scoreBreakdown `json:"score"`
	Outcome         taskOutcome    `json:"outcome"`
	WorkspacePath   string         `json:"workspace_path"`
}

type scoreBreakdown struct {
	Accuracy   float64 `json:"accuracy"`
	Natural    float64 `json:"natural"`
	Efficiency float64 `json:"efficiency"`
	Overall    float64 `json:"overall"`
}

type variantSummary struct {
	Variant      evalVariant        `json:"variant"`
	Stage1Avg    float64            `json:"stage1_avg"`
	Stage2Avg    float64            `json:"stage2_avg"`
	FinalOverall float64            `json:"final_overall"`
	TaskResults  map[string]float64 `json:"task_results"`
}

type evalReport struct {
	GeneratedAt       time.Time                 `json:"generated_at"`
	ModelID           string                    `json:"model_id"`
	WorkspacePath     string                    `json:"workspace_path"`
	VariantCount      int                       `json:"variant_count"`
	Stage1TaskIDs     []string                  `json:"stage1_task_ids"`
	Stage2TaskIDs     []string                  `json:"stage2_task_ids"`
	Results           []taskResult              `json:"results"`
	Summaries         []variantSummary          `json:"summaries"`
	Recommended       evalVariant               `json:"recommended"`
	RecommendedReason string                    `json:"recommended_reason"`
	Gate              gateReport                `json:"gate"`
	VariantMetrics    map[string]variantMetrics `json:"variant_metrics"`
}

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
	baselinePath := flag.String("baseline", filepath.Clean("eval/baselines/open_source_best.json"), "benchmark baseline json path")
	topK := flag.Int("top-k", 6, "top variants promoted from stage1 to stage2")
	maxVariants := flag.Int("max-variants", 0, "optional cap of evaluated variants (0 = all)")
	enforceGate := flag.Bool("enforce-gate", false, "enforce hard gate against open-source benchmark baselines")
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

	cfgPath := config.DefaultConfigPath()
	cfg, err := config.Load(cfgPath)
	if err != nil {
		fatalf("failed to load config: %v", err)
	}
	if cfg.AI == nil {
		fatalf("ai config is not enabled")
	}
	modelID, ok := cfg.AI.DefaultModelID()
	if !ok {
		fatalf("missing default model in AI config")
	}
	secretsPath := filepath.Join(filepath.Dir(cfgPath), "secrets.json")
	secretsStore := settings.NewSecretsStore(secretsPath)

	resolver := func(providerID string) (string, bool, error) {
		return secretsStore.GetAIProviderAPIKey(providerID)
	}

	timestamp := time.Now().Format("20060102-150405")
	outDir := strings.TrimSpace(*reportDir)
	if outDir == "" {
		home, _ := os.UserHomeDir()
		outDir = filepath.Join(home, ".redeven", "ai", "evals", timestamp)
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		fatalf("failed to create output dir: %v", err)
	}

	stateDir := filepath.Join(outDir, "state")
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		fatalf("failed to create state dir: %v", err)
	}

	service, err := ai.NewService(ai.Options{
		StateDir:              stateDir,
		FSRoot:                workspacePath,
		Shell:                 "bash",
		Config:                cfg.AI,
		RunMaxWallTime:        3 * time.Minute,
		RunIdleTimeout:        75 * time.Second,
		ToolApprovalTimeout:   20 * time.Second,
		PersistOpTimeout:      10 * time.Second,
		ResolveProviderAPIKey: resolver,
	})
	if err != nil {
		fatalf("failed to init AI service: %v", err)
	}
	defer func() { _ = service.Close() }()

	variants := buildVariants()
	if *maxVariants > 0 && *maxVariants < len(variants) {
		variants = variants[:*maxVariants]
	}
	if len(variants) < 20 && *maxVariants == 0 {
		fatalf("variant count must be at least 20, current=%d", len(variants))
	}

	tasks, loadErr := loadTaskSpecs(strings.TrimSpace(*taskSpecPath), workspacePath)
	if loadErr != nil {
		fatalf("failed to load task specs: %v", loadErr)
	}
	stage1Tasks := filterTasksByStage(tasks, "screen")
	stage2Tasks := filterTasksByStage(tasks, "deep")
	if len(stage1Tasks) == 0 || len(stage2Tasks) == 0 {
		fatalf("task stage configuration invalid")
	}

	fmt.Printf("[ai-loop-eval] model=%s variants=%d stage1_tasks=%d stage2_tasks=%d\n", modelID, len(variants), len(stage1Tasks), len(stage2Tasks))

	ctx := context.Background()
	results := make([]taskResult, 0, len(variants)*(len(stage1Tasks)+len(stage2Tasks)))

	stage1Scores := make(map[string]float64, len(variants))
	for i, v := range variants {
		fmt.Printf("[stage1] (%d/%d) variant=%s\n", i+1, len(variants), v.ID)
		avg, stageResults := runVariantTasks(ctx, service, modelID, workspacePath, v, stage1Tasks)
		stage1Scores[v.ID] = avg
		results = append(results, stageResults...)
	}

	topVariants := pickTopVariants(variants, stage1Scores, *topK)
	stage2Scores := make(map[string]float64, len(topVariants))
	for i, v := range topVariants {
		fmt.Printf("[stage2] (%d/%d) variant=%s\n", i+1, len(topVariants), v.ID)
		avg, stageResults := runVariantTasks(ctx, service, modelID, workspacePath, v, stage2Tasks)
		stage2Scores[v.ID] = avg
		results = append(results, stageResults...)
	}

	summaries := summarizeVariants(variants, results, stage1Scores, stage2Scores)
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].FinalOverall > summaries[j].FinalOverall
	})

	variantMetricsMap := aggregateVariantMetrics(results)
	thresholds := gateThresholds{
		MinPassRate:         clamp01(*minPassRate),
		MinLoopSafetyRate:   clamp01(*minLoopSafetyRate),
		MinFallbackFreeRate: clamp01(*minFallbackFreeRate),
		MinAverageAccuracy:  clampScore(*minAverageAccuracy),
	}
	gate := gateReport{
		Enabled:          false,
		Thresholds:       thresholds,
		Status:           "skipped",
		VariantDecisions: nil,
	}

	recommended := summaries[0].Variant
	if baseline := strings.TrimSpace(*baselinePath); baseline != "" {
		baselines, loadErr := loadBenchmarkBaselines(baseline)
		if loadErr != nil {
			if *enforceGate {
				fatalf("failed to load baseline while enforce-gate=true: %v", loadErr)
			}
			fmt.Printf("[ai-loop-eval] baseline skipped: %v\n", loadErr)
		} else {
			gate = evaluateGate(variants, variantMetricsMap, baselines, thresholds, recommended)
			gate.Enabled = true
			gate.BaselinePath = filepath.Clean(baseline)
			if gate.Status == "pass" {
				if v, ok := pickBestPassedVariant(summaries, gate.PassedVariantIDs); ok {
					recommended = v
					gate.RecommendedVariantID = v.ID
				}
			}
		}
	}

	reason := buildRecommendReason(summaries, recommended, gate)
	report := evalReport{
		GeneratedAt:       time.Now(),
		ModelID:           modelID,
		WorkspacePath:     workspacePath,
		VariantCount:      len(variants),
		Stage1TaskIDs:     taskIDs(stage1Tasks),
		Stage2TaskIDs:     taskIDs(stage2Tasks),
		Results:           results,
		Summaries:         summaries,
		Recommended:       recommended,
		RecommendedReason: reason,
		Gate:              gate,
		VariantMetrics:    variantMetricsMap,
	}

	jsonPath := filepath.Join(outDir, "report.json")
	if err := writeJSON(jsonPath, report); err != nil {
		fatalf("failed to write report.json: %v", err)
	}
	mdPath := filepath.Join(outDir, "report.md")
	if err := writeMarkdown(mdPath, report); err != nil {
		fatalf("failed to write report.md: %v", err)
	}

	fmt.Printf("[ai-loop-eval] recommended prompt=%s loop=%s (%s)\n", recommended.PromptProfile, recommended.LoopProfile, reason)
	fmt.Printf("[ai-loop-eval] report dir: %s\n", outDir)
	if gate.Enabled {
		fmt.Printf("[ai-loop-eval] gate status: %s\n", gate.Status)
		if len(gate.FailReasons) > 0 {
			fmt.Printf("[ai-loop-eval] gate reasons: %s\n", strings.Join(gate.FailReasons, "; "))
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

func buildVariants() []evalVariant {
	promptProfiles := []string{
		"natural_evidence_v2",
		"concise_direct_v1",
		"strict_no_preamble_v1",
		"evidence_sections_v1",
		"recovery_heavy_v1",
		"minimal_progress_v1",
	}
	loopProfiles := []string{
		"adaptive_default_v2",
		"fast_exit_v1",
		"deep_analysis_v1",
		"conservative_recovery_v1",
	}
	out := make([]evalVariant, 0, len(promptProfiles)*len(loopProfiles))
	for _, pp := range promptProfiles {
		for _, lp := range loopProfiles {
			id := pp + "__" + lp
			out = append(out, evalVariant{ID: id, PromptProfile: pp, LoopProfile: lp})
		}
	}
	return out
}

func runVariantTasks(ctx context.Context, svc *ai.Service, modelID string, workspacePath string, variant evalVariant, tasks []evalTask) (float64, []taskResult) {
	if len(tasks) == 0 {
		return 0, nil
	}
	results := make([]taskResult, 0, len(tasks))
	total := 0.0
	for _, task := range tasks {
		res := runTask(ctx, svc, modelID, workspacePath, variant, task)
		results = append(results, res)
		total += res.Score.Overall
		fmt.Printf("  - task=%s score=%.2f acc=%.2f nat=%.2f eff=%.2f\n", task.ID, res.Score.Overall, res.Score.Accuracy, res.Score.Natural, res.Score.Efficiency)
	}
	return total / float64(len(tasks)), results
}

func runTask(ctx context.Context, svc *ai.Service, modelID string, workspacePath string, variant evalVariant, task evalTask) taskResult {
	channelID := sanitizeID("ch_eval_" + variant.ID + "_" + task.ID)
	meta := &session.Meta{
		EndpointID:        "env_ai_loop_eval",
		NamespacePublicID: "ns_ai_loop_eval",
		ChannelID:         channelID,
		UserPublicID:      "u_ai_loop_eval",
		UserEmail:         "u_ai_loop_eval@example.com",
		CanRead:           true,
		CanWrite:          false,
		CanExecute:        true,
		CanAdmin:          false,
	}
	thread, err := svc.CreateThread(ctx, meta, "eval-"+task.ID, modelID)
	if err != nil {
		return taskResult{Variant: variant, Task: task, Score: scoreBreakdown{Overall: 0}}
	}

	turns := make([]turnMetrics, 0, len(task.Turns))
	started := time.Now()
	for _, turnText := range task.Turns {
		runID, ridErr := ai.NewRunID()
		if ridErr != nil {
			turns = append(turns, turnMetrics{RunError: ridErr.Error()})
			continue
		}
		timeout := task.TimeoutPerTurn
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
			Options: ai.RunOptions{
				MaxSteps:      task.MaxSteps,
				PromptProfile: variant.PromptProfile,
				LoopProfile:   variant.LoopProfile,
				EvalTag:       variant.ID + ":" + task.ID,
			},
		}, writer)
		dur := time.Since(oneStart)
		cancel()

		metrics := turnMetrics{RunID: runID, Duration: dur, DurationMS: dur.Milliseconds(), MonitorAbort: monitor.abortState()}
		if runErr != nil {
			metrics.RunError = runErr.Error()
		}
		reasonFlow := make([]string, 0, 12)
		events, evErr := svc.ListRunEvents(context.Background(), meta, runID, 1200)
		if evErr == nil {
			for _, ev := range events.Events {
				eventType := strings.TrimSpace(strings.ToLower(ev.EventType))
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
		turns = append(turns, metrics)
	}

	finalText := extractLatestAssistantText(ctx, svc, meta, thread.ThreadID)
	totalDur := time.Since(started)
	score := evaluateScore(task, workspacePath, finalText, turns)
	result := taskResult{
		Variant:         variant,
		Task:            task,
		Turns:           turns,
		FinalText:       finalText,
		DurationTotalMS: totalDur.Milliseconds(),
		Score:           score,
		WorkspacePath:   workspacePath,
	}
	result.Outcome = assessTaskOutcome(task, result)
	return result
}

func evaluateScore(task evalTask, workspacePath string, finalText string, turns []turnMetrics) scoreBreakdown {
	accuracy := 100.0
	natural := 100.0
	efficiency := 100.0

	lower := strings.ToLower(finalText)
	for _, must := range task.MustContain {
		if !matchesRequirement(lower, must) {
			accuracy -= 15
		}
	}
	for _, ban := range task.Forbidden {
		if strings.Contains(lower, strings.ToLower(strings.TrimSpace(ban))) {
			accuracy -= 35
			natural -= 20
		}
	}
	if task.RequireEvidence && !containsEvidencePath(finalText, workspacePath) {
		accuracy -= 28
	}
	if utf8.RuneCountInString(strings.TrimSpace(finalText)) < 40 {
		accuracy -= 18
		natural -= 15
	}
	if looksPreambleOnly(finalText) {
		natural -= 35
	}
	for _, phrase := range fallbackFinalPhrases {
		if strings.Contains(lower, phrase) {
			accuracy -= 40
			natural -= 25
			break
		}
	}
	natural -= float64(repetitionPenalty(finalText))

	totalSeconds := 0.0
	attempts := 0
	toolCalls := 0
	toolErrors := 0
	for _, turn := range turns {
		totalSeconds += turn.Duration.Seconds()
		attempts += turn.AttemptCount
		toolCalls += turn.ToolCallCount
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
	efficiency -= math.Min(55, totalSeconds*1.2)
	if attempts > len(turns) {
		efficiency -= float64((attempts - len(turns)) * 9)
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
	workspacePath = filepath.Clean(workspacePath)
	if workspacePath == "" {
		return false
	}
	if strings.Contains(text, workspacePath) {
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
	preambleHints := []string{"我先", "我会先", "let me", "i will", "先快速", "先看一下", "先扫描"}
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
	finalHints := []string{"结论", "final", "result", "directory", "建议", "风险"}
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
		case '.', '!', '?', ';', '。', '！', '？', '\n':
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

func summarizeVariants(variants []evalVariant, results []taskResult, stage1 map[string]float64, stage2 map[string]float64) []variantSummary {
	byVariant := make(map[string][]taskResult, len(variants))
	for _, r := range results {
		byVariant[r.Variant.ID] = append(byVariant[r.Variant.ID], r)
	}
	out := make([]variantSummary, 0, len(variants))
	for _, v := range variants {
		vr := byVariant[v.ID]
		taskScores := make(map[string]float64, len(vr))
		for _, tr := range vr {
			taskScores[tr.Task.ID] = tr.Score.Overall
		}
		s1 := stage1[v.ID]
		s2, promoted := stage2[v.ID]
		final := 0.0
		if promoted {
			final = clampScore(s1*0.45 + s2*0.55)
		} else {
			// Stage1-only variants are intentionally penalized so final ranking prefers deep-evaluated candidates.
			s2 = 0
			final = clampScore(s1 * 0.4)
		}
		out = append(out, variantSummary{
			Variant:      v,
			Stage1Avg:    s1,
			Stage2Avg:    s2,
			FinalOverall: final,
			TaskResults:  taskScores,
		})
	}
	return out
}

func pickTopVariants(variants []evalVariant, scores map[string]float64, topK int) []evalVariant {
	type pair struct {
		V evalVariant
		S float64
	}
	pairs := make([]pair, 0, len(variants))
	for _, v := range variants {
		pairs = append(pairs, pair{V: v, S: scores[v.ID]})
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].S == pairs[j].S {
			return pairs[i].V.ID < pairs[j].V.ID
		}
		return pairs[i].S > pairs[j].S
	})
	if topK <= 0 || topK > len(pairs) {
		topK = len(pairs)
	}
	out := make([]evalVariant, 0, topK)
	for i := 0; i < topK; i++ {
		out = append(out, pairs[i].V)
	}
	return out
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
		parts := make([]string, 0, len(blocks))
		for _, b := range blocks {
			bm, _ := b.(map[string]any)
			if strings.TrimSpace(strings.ToLower(anyToString(bm["type"]))) != "markdown" {
				continue
			}
			content := strings.TrimSpace(anyToString(bm["content"]))
			if content == "" {
				continue
			}
			parts = append(parts, content)
		}
		if len(parts) > 0 {
			return strings.Join(parts, "\n\n")
		}
	}
	return ""
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

func filterTasksByStage(tasks []evalTask, stage string) []evalTask {
	stage = strings.TrimSpace(strings.ToLower(stage))
	out := make([]evalTask, 0, len(tasks))
	for _, t := range tasks {
		if strings.TrimSpace(strings.ToLower(t.Stage)) == stage {
			out = append(out, t)
		}
	}
	return out
}

func taskIDs(tasks []evalTask) []string {
	out := make([]string, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, t.ID)
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

func pickBestPassedVariant(summaries []variantSummary, passedIDs []string) (evalVariant, bool) {
	if len(summaries) == 0 || len(passedIDs) == 0 {
		return evalVariant{}, false
	}
	allowed := make(map[string]struct{}, len(passedIDs))
	for _, id := range passedIDs {
		allowed[strings.TrimSpace(id)] = struct{}{}
	}
	for _, summary := range summaries {
		if _, ok := allowed[summary.Variant.ID]; ok {
			return summary.Variant, true
		}
	}
	return evalVariant{}, false
}

func buildRecommendReason(summaries []variantSummary, recommended evalVariant, gate gateReport) string {
	stage1 := 0.0
	stage2 := 0.0
	final := 0.0
	for _, summary := range summaries {
		if summary.Variant.ID != recommended.ID {
			continue
		}
		stage1 = summary.Stage1Avg
		stage2 = summary.Stage2Avg
		final = summary.FinalOverall
		break
	}
	reason := fmt.Sprintf("stage1=%.2f, stage2=%.2f, final=%.2f", stage1, stage2, final)
	if gate.Enabled {
		reason += ", gate=" + strings.TrimSpace(strings.ToLower(gate.Status))
	}
	return reason
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
	if len(report.Summaries) == 0 {
		return errors.New("empty summary")
	}
	var b strings.Builder
	b.WriteString("# AI Loop Evaluation Report\n\n")
	b.WriteString(fmt.Sprintf("- Generated at: %s\n", report.GeneratedAt.Format(time.RFC3339)))
	b.WriteString(fmt.Sprintf("- Model: `%s`\n", report.ModelID))
	b.WriteString(fmt.Sprintf("- Workspace: `%s`\n", report.WorkspacePath))
	b.WriteString(fmt.Sprintf("- Variant count: %d\n", report.VariantCount))
	b.WriteString("\n## Recommended Variant\n\n")
	b.WriteString(fmt.Sprintf("- Prompt profile: `%s`\n", report.Recommended.PromptProfile))
	b.WriteString(fmt.Sprintf("- Loop profile: `%s`\n", report.Recommended.LoopProfile))
	b.WriteString(fmt.Sprintf("- Reason: %s\n", report.RecommendedReason))

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
		if len(report.Gate.FailReasons) > 0 {
			b.WriteString("- Fail reasons: " + strings.Join(report.Gate.FailReasons, "; ") + "\n")
		}
	}

	b.WriteString("\n## Ranking\n\n")
	b.WriteString("| Rank | Variant | Stage1 | Stage2 | Final |\n")
	b.WriteString("|---:|---|---:|---:|---:|\n")
	for i, summary := range report.Summaries {
		b.WriteString(fmt.Sprintf("| %d | `%s` | %.2f | %.2f | %.2f |\n", i+1, summary.Variant.ID, summary.Stage1Avg, summary.Stage2Avg, summary.FinalOverall))
	}

	if report.Gate.Enabled && len(report.Gate.VariantDecisions) > 0 {
		b.WriteString("\n## Gate Decisions\n\n")
		b.WriteString("| Variant | Pass | PassRate | LoopSafe | Recovery | FallbackFree | Accuracy |\n")
		b.WriteString("|---|---:|---:|---:|---:|---:|---:|\n")
		for _, decision := range report.Gate.VariantDecisions {
			b.WriteString(fmt.Sprintf(
				"| `%s` | %t | %.2f | %.2f | %.2f | %.2f | %.2f |\n",
				decision.Variant.ID,
				decision.Passed,
				decision.Metrics.PassRate,
				decision.Metrics.LoopSafetyRate,
				decision.Metrics.RecoverySuccessRate,
				decision.Metrics.FallbackFreeRate,
				decision.Metrics.AverageAccuracy,
			))
		}
	}

	b.WriteString("\n## Task Results\n\n")
	for _, result := range report.Results {
		b.WriteString(fmt.Sprintf("### %s / %s\n\n", result.Variant.ID, result.Task.ID))
		b.WriteString(fmt.Sprintf("- Score: %.2f (acc %.2f / nat %.2f / eff %.2f)\n", result.Score.Overall, result.Score.Accuracy, result.Score.Natural, result.Score.Efficiency))
		b.WriteString(fmt.Sprintf("- Outcome: passed=%t loop_safe=%t fallback=%t recovery_candidate=%t recovery_succeeded=%t\n",
			result.Outcome.Passed,
			result.Outcome.LoopSafe,
			result.Outcome.FallbackFinal,
			result.Outcome.RecoveryCandidate,
			result.Outcome.RecoverySucceeded,
		))
		b.WriteString(fmt.Sprintf("- Duration: %d ms\n", result.DurationTotalMS))
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
