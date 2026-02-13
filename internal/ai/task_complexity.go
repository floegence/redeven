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

	reasons := make([]string, 0, 8)
	addReason := func(reason string) {
		reason = strings.TrimSpace(reason)
		if reason == "" {
			return
		}
		for _, existing := range reasons {
			if existing == reason {
				return
			}
		}
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

	hasAttachments := len(attachments) > 0
	hasOpenGoal := strings.TrimSpace(openGoal) != ""
	hasLongInput := len([]rune(raw)) >= 240
	hasMultiLine := strings.Count(raw, "\n") >= 3
	hasHighDepthRequirements := containsAny(raw, []string{
		"全面", "完整", "系统", "深入", "详细", "最终", "分阶段", "多步骤",
	}) || containsAny(lower, []string{
		"comprehensive", "end-to-end", "thorough", "detailed", "final analysis", "deep dive", "multi-step",
	})
	hasPlanningSignals := containsAny(raw, []string{
		"计划", "规划", "步骤", "路线图", "先", "然后", "接着", "下一步",
	}) || containsAny(lower, []string{
		"plan", "roadmap", "step", "then", "next",
	})
	hasExecutionSignals := containsAny(raw, []string{
		"修改", "实现", "重构", "修复", "验证", "测试", "运行", "排查", "分析",
	}) || containsAny(lower, []string{
		"implement", "modify", "refactor", "fix", "verify", "test", "run", "debug", "analyze",
	})
	hasMultiObjectiveSignals := containsAny(raw, []string{
		"并且", "同时", "另外", "以及", "还要",
	}) || containsAny(lower, []string{
		"and ", "also ", "plus ", "as well as ",
	})

	if hasAttachments {
		addReason("attachments_present")
	}
	if hasOpenGoal {
		addReason("open_goal_present")
	}
	if hasLongInput {
		addReason("long_user_input")
	}
	if hasMultiLine {
		addReason("multi_line_request")
	}
	if hasHighDepthRequirements {
		addReason("high_depth_requirements")
	}
	if hasPlanningSignals {
		addReason("planning_signals")
	}
	if hasExecutionSignals {
		addReason("execution_signals")
	}
	if hasMultiObjectiveSignals {
		addReason("multi_objective_signals")
	}

	var level string
	switch {
	case hasAttachments && (hasHighDepthRequirements || hasPlanningSignals || hasExecutionSignals || hasMultiObjectiveSignals || hasOpenGoal):
		level = TaskComplexityComplex
	case hasHighDepthRequirements && hasPlanningSignals && hasExecutionSignals:
		level = TaskComplexityComplex
	case hasMultiObjectiveSignals && hasPlanningSignals && hasExecutionSignals:
		level = TaskComplexityComplex
	case hasLongInput && hasMultiLine && (hasPlanningSignals || hasExecutionSignals || hasHighDepthRequirements):
		level = TaskComplexityComplex
	case hasOpenGoal && hasPlanningSignals && hasExecutionSignals:
		level = TaskComplexityComplex
	case len(reasons) > 0:
		level = TaskComplexityStandard
	default:
		level = TaskComplexitySimple
	}

	return taskComplexityDecision{
		Level:   level,
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
