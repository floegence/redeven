package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/floegence/redeven/internal/ai"
	"github.com/floegence/redeven/internal/ai/threadstore"
	"github.com/floegence/redeven/internal/pathutil"
)

type taskOutcome struct {
	Passed            bool     `json:"passed"`
	LoopSafe          bool     `json:"loop_safe"`
	FallbackFinal     bool     `json:"fallback_final"`
	RecoveryCandidate bool     `json:"recovery_candidate"`
	RecoverySucceeded bool     `json:"recovery_succeeded"`
	HardFailReasons   []string `json:"hard_fail_reasons,omitempty"`
}

type suiteMetrics struct {
	TaskCount            int     `json:"task_count"`
	PassedTasks          int     `json:"passed_tasks"`
	LoopSafeTasks        int     `json:"loop_safe_tasks"`
	FallbackFreeTasks    int     `json:"fallback_free_tasks"`
	RecoveryCandidates   int     `json:"recovery_candidates"`
	RecoverySucceeded    int     `json:"recovery_succeeded"`
	PassRate             float64 `json:"pass_rate"`
	LoopSafetyRate       float64 `json:"loop_safety_rate"`
	FallbackFreeRate     float64 `json:"fallback_free_rate"`
	RecoverySuccessRate  float64 `json:"recovery_success_rate"`
	AverageAccuracy      float64 `json:"average_accuracy"`
	AverageNatural       float64 `json:"average_natural"`
	AverageEfficiency    float64 `json:"average_efficiency"`
	AverageOverall       float64 `json:"average_overall"`
	HardFailCount        int     `json:"hard_fail_count"`
	HasLoopExhaustedTask bool    `json:"has_loop_exhausted_task"`
}

type benchmarkMetrics struct {
	PassRate            float64 `json:"pass_rate"`
	LoopSafetyRate      float64 `json:"loop_safety_rate"`
	RecoverySuccessRate float64 `json:"recovery_success_rate"`
	FallbackFreeRate    float64 `json:"fallback_free_rate"`
	AverageAccuracy     float64 `json:"average_accuracy"`
}

type benchmarkBaselines struct {
	Sources map[string]benchmarkMetrics `json:"sources"`
}

type gateThresholds struct {
	MinPassRate         float64 `json:"min_pass_rate"`
	MinLoopSafetyRate   float64 `json:"min_loop_safety_rate"`
	MinFallbackFreeRate float64 `json:"min_fallback_free_rate"`
	MinAverageAccuracy  float64 `json:"min_average_accuracy"`
}

type benchmarkDeltas struct {
	PassRate            float64 `json:"pass_rate"`
	LoopSafetyRate      float64 `json:"loop_safety_rate"`
	RecoverySuccessRate float64 `json:"recovery_success_rate"`
	FallbackFreeRate    float64 `json:"fallback_free_rate"`
	AverageAccuracy     float64 `json:"average_accuracy"`
}

type gateReport struct {
	Enabled       bool             `json:"enabled"`
	BaselinePath  string           `json:"baseline_path,omitempty"`
	Thresholds    gateThresholds   `json:"thresholds"`
	ReferenceBest benchmarkMetrics `json:"reference_best"`
	Metrics       suiteMetrics     `json:"metrics"`
	Delta         benchmarkDeltas  `json:"delta_vs_best"`
	Passed        bool             `json:"passed"`
	Status        string           `json:"status"`
	Reasons       []string         `json:"reasons,omitempty"`
}

var fallbackFinalPhrases = []string{
	"i have reached the current automatic loop limit",
	"reply with one concrete next step",
	"assistant finished without a visible response",
	"tool workflow failed",
	"no response",
}

func assessTaskOutcome(task evalTask, result taskResult) taskOutcome {
	out := taskOutcome{
		Passed:            true,
		LoopSafe:          true,
		FallbackFinal:     false,
		RecoveryCandidate: false,
		RecoverySucceeded: true,
	}

	finalTextLower := strings.ToLower(strings.TrimSpace(result.FinalText))
	if task.Assertions.Output.MustNotEndWithFallback || len(task.Assertions.Events.HardFail) > 0 {
		for _, phrase := range fallbackFinalPhrases {
			if strings.Contains(finalTextLower, phrase) {
				out.FallbackFinal = true
				out.Passed = false
				out.LoopSafe = false
				out.HardFailReasons = append(out.HardFailReasons, "fallback_final_message")
				break
			}
		}
	}

	hardEventSet := normalizeNameSet(task.Assertions.Events.HardFail)
	for _, turn := range result.Turns {
		if turn.ToolErrorCount > 0 || turn.RecoveryCount > 0 || turn.CompletionRetrys > 0 || turn.TaskLoopContinue > 0 {
			out.RecoveryCandidate = true
		}
		if turn.LoopExhausted || turn.PhasePingPong || turn.FinalizationReason == "task_turn_limit_reached" {
			out.LoopSafe = false
			out.Passed = false
		}
		if turn.LoopExhausted {
			out.HardFailReasons = append(out.HardFailReasons, "turn_loop_exhausted")
		}
		if turn.PhasePingPong {
			out.HardFailReasons = append(out.HardFailReasons, "phase_pingpong_detected")
		}
		if _, ok := hardEventSet["turn.completion.continue"]; ok && turn.CompletionRetrys > 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "turn_completion_continue")
		}
		if _, ok := hardEventSet["task.loop.continue"]; ok && turn.TaskLoopContinue > 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "task_loop_continue")
		}
		if _, ok := hardEventSet["turn.loop.exhausted"]; ok && turn.LoopExhausted {
			out.Passed = false
		}
		if strings.TrimSpace(turn.MonitorAbort) != "" {
			out.Passed = false
			out.LoopSafe = false
			out.HardFailReasons = append(out.HardFailReasons, "monitor_abort:"+strings.TrimSpace(turn.MonitorAbort))
		}
		if strings.TrimSpace(turn.RunError) != "" {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "run_error")
		}
	}

	output := task.Assertions.Output
	if !containsAllRequirements(finalTextLower, output.MustContain) {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "missing_must_contain")
	}
	if containsForbidden(finalTextLower, output.Forbidden) {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "contains_forbidden")
	}
	if output.RequireEvidence && !containsEvidencePath(result.FinalText, result.WorkspacePath) {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "missing_evidence_path")
	}
	if output.MinEvidencePaths > 0 && len(result.EvidencePaths) < output.MinEvidencePaths {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "insufficient_evidence_paths")
	}
	if output.MinLength > 0 && len([]rune(strings.TrimSpace(result.FinalText))) < output.MinLength {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "output_too_short")
	}

	threadAssertions := task.Assertions.Thread
	if threadAssertions.RunStatus != "" && threadAssertions.RunStatus != strings.TrimSpace(strings.ToLower(result.ThreadState.RunStatus)) {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "thread_run_status_mismatch")
	}
	if threadAssertions.ExecutionMode != "" && threadAssertions.ExecutionMode != strings.TrimSpace(strings.ToLower(result.ThreadState.ExecutionMode)) {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "thread_execution_mode_mismatch")
	}
	switch threadAssertions.WaitingPrompt {
	case "required":
		if !result.ThreadState.WaitingPrompt {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "missing_waiting_prompt")
		}
	case "forbidden":
		if result.ThreadState.WaitingPrompt {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "unexpected_waiting_prompt")
		}
	}

	tools := task.Assertions.Tools
	toolCallsByName := groupToolCallsByName(result.rawToolCalls)
	if tools.MaxCalls > 0 && len(result.rawToolCalls) > tools.MaxCalls {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "too_many_tool_calls")
	}
	for _, name := range tools.MustCall {
		if len(toolCallsByName[normalizeName(name)]) == 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "missing_tool:"+normalizeName(name))
		}
	}
	for _, name := range tools.MustNotCall {
		if len(toolCallsByName[normalizeName(name)]) > 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "forbidden_tool:"+normalizeName(name))
		}
	}
	for _, name := range tools.MustSucceed {
		if !hasSuccessfulToolCall(toolCallsByName[normalizeName(name)]) {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "tool_not_successful:"+normalizeName(name))
		}
	}
	for _, name := range tools.WorkspaceScopedTools {
		toolName := normalizeName(name)
		if violation := firstWorkspaceScopeViolation(toolName, toolCallsByName[toolName], result.WorkspacePath); violation != "" {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "tool_args_escape_workspace:"+toolName)
		}
	}

	events := task.Assertions.Events
	for _, name := range events.MustInclude {
		if result.EventCounts[normalizeName(name)] <= 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "missing_event:"+normalizeName(name))
		}
	}
	for _, name := range events.MustNotHave {
		if result.EventCounts[normalizeName(name)] > 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "forbidden_event:"+normalizeName(name))
		}
	}
	for _, name := range events.HardFail {
		if result.EventCounts[normalizeName(name)] > 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "hard_fail_event:"+normalizeName(name))
		}
	}

	todos := task.Assertions.Todos
	if todos.RequireSnapshot && result.rawTodos == nil {
		out.Passed = false
		out.HardFailReasons = append(out.HardFailReasons, "missing_todo_snapshot")
	}
	if result.rawTodos != nil {
		summary := summarizeTodoItems(result.rawTodos.Todos)
		if todos.RequireNonEmpty && summary.Total == 0 {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "todo_snapshot_empty")
		}
		if todos.RequireClosed && (summary.Pending > 0 || summary.InProgress > 0) {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "todo_snapshot_not_closed")
		}
	}
	if todos.RequireInProgressDiscipline {
		sawSingle, ok := hasWriteTodosInProgressDiscipline(result.rawToolCalls)
		if !ok {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "missing_write_todos_update")
		} else if !sawSingle {
			out.Passed = false
			out.HardFailReasons = append(out.HardFailReasons, "missing_single_in_progress_todo")
		}
	}

	if out.RecoveryCandidate {
		out.RecoverySucceeded = out.Passed && !out.FallbackFinal
	}
	if len(out.HardFailReasons) > 0 {
		out.HardFailReasons = uniqueStrings(out.HardFailReasons)
	}
	return out
}

func aggregateSuiteMetrics(results []taskResult) suiteMetrics {
	metrics := suiteMetrics{TaskCount: len(results)}
	for _, item := range results {
		outcome := item.Outcome
		if outcome.Passed {
			metrics.PassedTasks++
		}
		if outcome.LoopSafe {
			metrics.LoopSafeTasks++
		}
		if !outcome.FallbackFinal {
			metrics.FallbackFreeTasks++
		}
		if outcome.RecoveryCandidate {
			metrics.RecoveryCandidates++
			if outcome.RecoverySucceeded {
				metrics.RecoverySucceeded++
			}
		}
		if !outcome.LoopSafe {
			metrics.HasLoopExhaustedTask = true
		}
		metrics.HardFailCount += len(outcome.HardFailReasons)
		metrics.AverageAccuracy += item.Score.Accuracy
		metrics.AverageNatural += item.Score.Natural
		metrics.AverageEfficiency += item.Score.Efficiency
		metrics.AverageOverall += item.Score.Overall
	}
	if metrics.TaskCount > 0 {
		den := float64(metrics.TaskCount)
		metrics.PassRate = float64(metrics.PassedTasks) / den
		metrics.LoopSafetyRate = float64(metrics.LoopSafeTasks) / den
		metrics.FallbackFreeRate = float64(metrics.FallbackFreeTasks) / den
		metrics.AverageAccuracy /= den
		metrics.AverageNatural /= den
		metrics.AverageEfficiency /= den
		metrics.AverageOverall /= den
	}
	if metrics.RecoveryCandidates > 0 {
		metrics.RecoverySuccessRate = float64(metrics.RecoverySucceeded) / float64(metrics.RecoveryCandidates)
	} else {
		metrics.RecoverySuccessRate = 1.0
	}
	return metrics
}

func firstWorkspaceScopeViolation(toolName string, calls []threadstore.ToolCallRecord, workspacePath string) string {
	workspacePath = filepath.Clean(strings.TrimSpace(workspacePath))
	if workspacePath == "" {
		return "missing_workspace"
	}
	toolName = normalizeName(toolName)
	for _, call := range calls {
		var args any
		raw := strings.TrimSpace(call.ArgsJSON)
		if raw == "" {
			continue
		}
		if err := json.Unmarshal([]byte(raw), &args); err != nil {
			continue
		}
		if violation := findWorkspaceScopeViolation(toolName, args, workspacePath); violation != "" {
			return violation
		}
	}
	return ""
}

func findWorkspaceScopeViolation(toolName string, args any, workspacePath string) string {
	switch toolName {
	case "terminal.exec":
		return findTerminalExecWorkspaceScopeViolation(args, workspacePath)
	case "apply_patch":
		return findApplyPatchWorkspaceScopeViolation(args, workspacePath)
	case "file.read", "file.edit", "file.write":
		return findStructuredFileToolWorkspaceScopeViolation(args, workspacePath)
	}
	return ""
}

func findTerminalExecWorkspaceScopeViolation(args any, workspacePath string) string {
	obj, _ := args.(map[string]any)
	if len(obj) == 0 {
		return ""
	}
	for _, key := range []string{"command", "cwd", "workdir"} {
		raw := anyToString(obj[key])
		for _, candidate := range extractScopedPathCandidates(raw) {
			if violation := validateScopedPathCandidate(candidate, workspacePath); violation != "" {
				return violation
			}
		}
	}
	return ""
}

func findApplyPatchWorkspaceScopeViolation(args any, workspacePath string) string {
	obj, _ := args.(map[string]any)
	if len(obj) == 0 {
		return ""
	}
	patchText := strings.TrimSpace(anyToString(obj["patch"]))
	if patchText == "" {
		return ""
	}
	if strings.Contains(patchText, "../") || strings.Contains(patchText, `..\`) {
		return "parent:" + patchText
	}
	for _, line := range strings.Split(patchText, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "*** Add File: "):
			if violation := validatePatchTargetPath(strings.TrimSpace(strings.TrimPrefix(line, "*** Add File: ")), workspacePath); violation != "" {
				return violation
			}
		case strings.HasPrefix(line, "*** Update File: "):
			if violation := validatePatchTargetPath(strings.TrimSpace(strings.TrimPrefix(line, "*** Update File: ")), workspacePath); violation != "" {
				return violation
			}
		case strings.HasPrefix(line, "*** Delete File: "):
			if violation := validatePatchTargetPath(strings.TrimSpace(strings.TrimPrefix(line, "*** Delete File: ")), workspacePath); violation != "" {
				return violation
			}
		case strings.HasPrefix(line, "*** Move to: "):
			if violation := validatePatchTargetPath(strings.TrimSpace(strings.TrimPrefix(line, "*** Move to: ")), workspacePath); violation != "" {
				return violation
			}
		}
	}
	return ""
}

func findStructuredFileToolWorkspaceScopeViolation(args any, workspacePath string) string {
	obj, _ := args.(map[string]any)
	if len(obj) == 0 {
		return ""
	}
	candidate := strings.TrimSpace(anyToString(obj["file_path"]))
	if candidate == "" {
		return ""
	}
	if strings.Contains(candidate, "../") || strings.Contains(candidate, `..\`) {
		return "parent:" + candidate
	}
	if !filepath.IsAbs(candidate) {
		return ""
	}
	return validateScopedPathCandidate(filepath.Clean(candidate), workspacePath)
}

func validatePatchTargetPath(candidate string, workspacePath string) string {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return ""
	}
	if strings.Contains(candidate, "../") || strings.Contains(candidate, `..\`) {
		return "parent:" + candidate
	}
	if filepath.IsAbs(candidate) {
		return validateScopedPathCandidate(filepath.Clean(candidate), workspacePath)
	}
	return ""
}

func validateScopedPathCandidate(candidate string, workspacePath string) string {
	if strings.HasPrefix(candidate, "parent:") {
		return candidate
	}
	ok, err := pathutil.IsWithinScope(candidate, workspacePath)
	if err != nil || !ok {
		return candidate
	}
	return ""
}

func extractScopedPathCandidates(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	out := make([]string, 0, 4)
	if strings.Contains(raw, "../") || strings.Contains(raw, `..\`) || strings.Contains(raw, "cd ..") {
		out = append(out, "parent:"+raw)
	}
	matches := absolutePathPattern.FindAllString(raw, -1)
	for _, match := range matches {
		candidate := strings.TrimSpace(match)
		candidate = strings.TrimRight(candidate, ".)],;:'\"")
		if candidate == "" || strings.HasPrefix(candidate, "//") {
			continue
		}
		if isAllowedSystemPathCandidate(candidate) {
			continue
		}
		if !filepath.IsAbs(candidate) {
			continue
		}
		out = append(out, filepath.Clean(candidate))
	}
	return out
}

func isAllowedSystemPathCandidate(path string) bool {
	switch filepath.Clean(strings.TrimSpace(path)) {
	case "/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr":
		return true
	default:
		return false
	}
}

func loadBenchmarkBaselines(path string) (benchmarkBaselines, error) {
	cleanPath := strings.TrimSpace(path)
	if cleanPath == "" {
		return benchmarkBaselines{}, fmt.Errorf("missing baseline path")
	}
	cleanPath = filepath.Clean(cleanPath)
	b, err := os.ReadFile(cleanPath)
	if err != nil {
		return benchmarkBaselines{}, err
	}
	var out benchmarkBaselines
	if err := json.Unmarshal(b, &out); err != nil {
		return benchmarkBaselines{}, err
	}
	if len(out.Sources) == 0 {
		return benchmarkBaselines{}, fmt.Errorf("baseline sources is empty")
	}
	return out, nil
}

func referenceBestMetrics(baselines benchmarkBaselines) benchmarkMetrics {
	best := benchmarkMetrics{}
	first := true
	for _, metrics := range baselines.Sources {
		if first {
			best = metrics
			first = false
			continue
		}
		if metrics.PassRate > best.PassRate {
			best.PassRate = metrics.PassRate
		}
		if metrics.LoopSafetyRate > best.LoopSafetyRate {
			best.LoopSafetyRate = metrics.LoopSafetyRate
		}
		if metrics.RecoverySuccessRate > best.RecoverySuccessRate {
			best.RecoverySuccessRate = metrics.RecoverySuccessRate
		}
		if metrics.FallbackFreeRate > best.FallbackFreeRate {
			best.FallbackFreeRate = metrics.FallbackFreeRate
		}
		if metrics.AverageAccuracy > best.AverageAccuracy {
			best.AverageAccuracy = metrics.AverageAccuracy
		}
	}
	return best
}

func evaluateGate(metrics suiteMetrics, baselines benchmarkBaselines, thresholds gateThresholds) gateReport {
	reference := referenceBestMetrics(baselines)
	delta := benchmarkDeltas{
		PassRate:            metrics.PassRate - reference.PassRate,
		LoopSafetyRate:      metrics.LoopSafetyRate - reference.LoopSafetyRate,
		RecoverySuccessRate: metrics.RecoverySuccessRate - reference.RecoverySuccessRate,
		FallbackFreeRate:    metrics.FallbackFreeRate - reference.FallbackFreeRate,
		AverageAccuracy:     metrics.AverageAccuracy - reference.AverageAccuracy,
	}
	reasons := make([]string, 0, 10)
	if metrics.PassRate < thresholds.MinPassRate {
		reasons = append(reasons, fmt.Sprintf("pass_rate %.3f < threshold %.3f", metrics.PassRate, thresholds.MinPassRate))
	}
	if metrics.LoopSafetyRate < thresholds.MinLoopSafetyRate {
		reasons = append(reasons, fmt.Sprintf("loop_safety_rate %.3f < threshold %.3f", metrics.LoopSafetyRate, thresholds.MinLoopSafetyRate))
	}
	if metrics.FallbackFreeRate < thresholds.MinFallbackFreeRate {
		reasons = append(reasons, fmt.Sprintf("fallback_free_rate %.3f < threshold %.3f", metrics.FallbackFreeRate, thresholds.MinFallbackFreeRate))
	}
	if metrics.AverageAccuracy < thresholds.MinAverageAccuracy {
		reasons = append(reasons, fmt.Sprintf("average_accuracy %.2f < threshold %.2f", metrics.AverageAccuracy, thresholds.MinAverageAccuracy))
	}
	if metrics.PassRate < reference.PassRate {
		reasons = append(reasons, fmt.Sprintf("pass_rate %.3f < best_ref %.3f", metrics.PassRate, reference.PassRate))
	}
	if metrics.LoopSafetyRate < reference.LoopSafetyRate {
		reasons = append(reasons, fmt.Sprintf("loop_safety_rate %.3f < best_ref %.3f", metrics.LoopSafetyRate, reference.LoopSafetyRate))
	}
	if metrics.RecoverySuccessRate < reference.RecoverySuccessRate {
		reasons = append(reasons, fmt.Sprintf("recovery_success_rate %.3f < best_ref %.3f", metrics.RecoverySuccessRate, reference.RecoverySuccessRate))
	}
	if metrics.FallbackFreeRate < reference.FallbackFreeRate {
		reasons = append(reasons, fmt.Sprintf("fallback_free_rate %.3f < best_ref %.3f", metrics.FallbackFreeRate, reference.FallbackFreeRate))
	}
	if metrics.AverageAccuracy < reference.AverageAccuracy {
		reasons = append(reasons, fmt.Sprintf("average_accuracy %.2f < best_ref %.2f", metrics.AverageAccuracy, reference.AverageAccuracy))
	}

	return gateReport{
		Enabled:       true,
		Thresholds:    thresholds,
		ReferenceBest: reference,
		Metrics:       metrics,
		Delta:         delta,
		Passed:        len(reasons) == 0,
		Status: func() string {
			if len(reasons) == 0 {
				return "pass"
			}
			return "reject"
		}(),
		Reasons: reasons,
	}
}

func groupToolCallsByName(calls []threadstore.ToolCallRecord) map[string][]threadstore.ToolCallRecord {
	out := make(map[string][]threadstore.ToolCallRecord)
	for _, call := range calls {
		name := normalizeName(call.ToolName)
		out[name] = append(out[name], call)
	}
	return out
}

func hasSuccessfulToolCall(calls []threadstore.ToolCallRecord) bool {
	for _, call := range calls {
		if normalizeName(call.Status) == "success" {
			return true
		}
	}
	return false
}

func hasWriteTodosInProgressDiscipline(calls []threadstore.ToolCallRecord) (bool, bool) {
	sawUpdate := false
	sawSingleInProgress := false
	for _, call := range calls {
		if normalizeName(call.ToolName) != "write_todos" || normalizeName(call.Status) != "success" {
			continue
		}
		items := parseWriteTodosArgs(call)
		if items == nil {
			continue
		}
		sawUpdate = true
		summary := summarizeTodoItems(items)
		if summary.Total > 0 && summary.InProgress == 1 {
			sawSingleInProgress = true
		}
	}
	return sawSingleInProgress, sawUpdate
}

func parseWriteTodosArgs(call threadstore.ToolCallRecord) []ai.TodoItem {
	raw := strings.TrimSpace(call.ArgsJSON)
	if raw == "" {
		return nil
	}
	var payload struct {
		Todos []ai.TodoItem `json:"todos"`
	}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil
	}
	return payload.Todos
}

func normalizeNameSet(items []string) map[string]struct{} {
	out := make(map[string]struct{}, len(items))
	for _, item := range items {
		if key := normalizeName(item); key != "" {
			out[key] = struct{}{}
		}
	}
	return out
}

func normalizeName(raw string) string {
	return strings.TrimSpace(strings.ToLower(raw))
}

func containsAllRequirements(text string, reqs []string) bool {
	for _, req := range reqs {
		if !matchesRequirement(text, req) {
			return false
		}
	}
	return true
}

func containsForbidden(text string, forbidden []string) bool {
	for _, ban := range forbidden {
		if strings.Contains(text, strings.ToLower(strings.TrimSpace(ban))) {
			return true
		}
	}
	return false
}

func uniqueStrings(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, item := range in {
		key := strings.TrimSpace(strings.ToLower(item))
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}
