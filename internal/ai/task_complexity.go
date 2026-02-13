package ai

import (
	"strings"
)

const (
	TaskComplexitySimple   = "simple"
	TaskComplexityStandard = "standard"
	TaskComplexityComplex  = "complex"
)

type taskComplexityDecision struct {
	Level   string   `json:"level"`
	Score   int      `json:"score"`
	Reasons []string `json:"reasons,omitempty"`
}

func normalizeTaskComplexity(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case TaskComplexitySimple:
		return TaskComplexitySimple
	case TaskComplexityComplex:
		return TaskComplexityComplex
	default:
		return TaskComplexityStandard
	}
}

func classifyTaskComplexity(userInput string, attachments []RunAttachmentIn, openGoal string) taskComplexityDecision {
	raw := strings.TrimSpace(userInput)
	lower := strings.ToLower(raw)

	score := 0
	reasons := make([]string, 0, 8)
	add := func(delta int, reason string) {
		if delta <= 0 {
			return
		}
		reason = strings.TrimSpace(reason)
		if reason == "" {
			return
		}
		score += delta
		reasons = append(reasons, reason)
	}
	containsAny := func(text string, parts []string) bool {
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if strings.Contains(text, part) {
				return true
			}
		}
		return false
	}

	if len(attachments) > 0 {
		add(2, "attachments_present")
	}
	if strings.TrimSpace(openGoal) != "" {
		add(1, "open_goal_present")
	}
	if len([]rune(raw)) >= 240 {
		add(1, "long_user_input")
	}
	if strings.Count(raw, "\n") >= 3 {
		add(1, "multi_line_request")
	}

	if containsAny(raw, []string{
		"全面", "完整", "系统", "深入", "详细", "最终", "分阶段", "多步骤",
	}) || containsAny(lower, []string{
		"comprehensive", "end-to-end", "thorough", "detailed", "final analysis", "deep dive", "multi-step",
	}) {
		add(1, "high_depth_requirements")
	}

	if containsAny(raw, []string{
		"计划", "规划", "步骤", "路线图", "先", "然后", "接着", "下一步",
	}) || containsAny(lower, []string{
		"plan", "roadmap", "step", "then", "next",
	}) {
		add(1, "planning_signals")
	}

	if containsAny(raw, []string{
		"修改", "实现", "重构", "修复", "验证", "测试", "运行", "排查", "分析",
	}) || containsAny(lower, []string{
		"implement", "modify", "refactor", "fix", "verify", "test", "run", "debug", "analyze",
	}) {
		add(1, "execution_signals")
	}

	if containsAny(raw, []string{
		"并且", "同时", "另外", "以及", "还要",
	}) || containsAny(lower, []string{
		"and ", "also ", "plus ", "as well as ",
	}) {
		add(1, "multi_objective_signals")
	}

	var level string
	switch {
	case score >= 5:
		level = TaskComplexityComplex
	case score >= 2:
		level = TaskComplexityStandard
	default:
		level = TaskComplexitySimple
	}

	return taskComplexityDecision{
		Level:   level,
		Score:   score,
		Reasons: reasons,
	}
}

func maybeEscalateTaskComplexity(current string, state runtimeState, normalCalls []ToolCall, step int) string {
	level := normalizeTaskComplexity(current)
	if level == TaskComplexityComplex {
		return level
	}

	actionFacts := len(state.CompletedActionFacts) + len(state.BlockedActionFacts)
	if state.TodoTrackingEnabled {
		if state.TodoOpenCount > 1 || actionFacts >= 3 || step >= 2 {
			return TaskComplexityComplex
		}
		if level == TaskComplexitySimple {
			return TaskComplexityStandard
		}
	}

	if level == TaskComplexitySimple {
		if len(normalCalls) >= 2 || actionFacts >= 2 {
			return TaskComplexityStandard
		}
	}

	if level == TaskComplexityStandard {
		if len(normalCalls) >= 3 || actionFacts >= 4 {
			return TaskComplexityComplex
		}
	}

	return level
}
