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
