package ai

import "strings"

type replyFinishClass string

const (
	replyFinishClassClean      replyFinishClass = "clean"
	replyFinishClassRetry      replyFinishClass = "retry"
	replyFinishClassBlocked    replyFinishClass = "blocked"
	replyFinishClassToolSignal replyFinishClass = "tool_signal"
	replyFinishClassInvalid    replyFinishClass = "invalid"
)

func normalizeReplyFinishReason(reason string) string {
	switch strings.ToLower(strings.TrimSpace(reason)) {
	case "", "stop":
		return "stop"
	case "length":
		return "length"
	case "content_filter":
		return "content_filter"
	case "tool_calls", "function_call":
		return "tool_calls"
	default:
		return "unknown"
	}
}

func classifyReplyFinish(reason string) replyFinishClass {
	switch normalizeReplyFinishReason(reason) {
	case "stop":
		return replyFinishClassClean
	case "length":
		return replyFinishClassRetry
	case "content_filter":
		return replyFinishClassBlocked
	case "tool_calls":
		return replyFinishClassToolSignal
	default:
		return replyFinishClassInvalid
	}
}

func implicitReplyCompletionEligible(reason string) bool {
	return classifyReplyFinish(reason) == replyFinishClassClean
}
