package ai

import "strings"

const (
	runPromptProfileMainInteractive    = "main_interactive"
	runPromptProfileMainAutonomous     = "main_autonomous"
	runPromptProfileSubagentAutonomous = "subagent_autonomous"
)

func resolveRunPromptProfile(raw string, r *run, allowUserInteraction bool) string {
	switch strings.TrimSpace(raw) {
	case runPromptProfileMainInteractive:
		return runPromptProfileMainInteractive
	case runPromptProfileMainAutonomous:
		return runPromptProfileMainAutonomous
	case runPromptProfileSubagentAutonomous:
		return runPromptProfileSubagentAutonomous
	}
	if allowUserInteraction {
		return runPromptProfileMainInteractive
	}
	if r != nil && r.subagentDepth > 0 {
		return runPromptProfileSubagentAutonomous
	}
	return runPromptProfileMainAutonomous
}
