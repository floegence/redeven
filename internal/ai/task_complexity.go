package ai

import "strings"

const (
	TaskComplexitySimple   = "simple"
	TaskComplexityStandard = "standard"
	TaskComplexityComplex  = "complex"
)

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

const (
	TodoPolicyNone        = "none"
	TodoPolicyRecommended = "recommended"
	TodoPolicyRequired    = "required"
)

func normalizeTodoPolicy(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case TodoPolicyNone:
		return TodoPolicyNone
	case TodoPolicyRequired:
		return TodoPolicyRequired
	default:
		return TodoPolicyRecommended
	}
}

func normalizeMinimumTodoItems(policy string, raw int) int {
	if normalizeTodoPolicy(policy) != TodoPolicyRequired {
		return 0
	}
	if raw < 3 {
		return 3
	}
	return raw
}
