package ai

import "strings"

const (
	runPromptProfileMainInteractive    = "main_interactive"
	runPromptProfileMainAutonomous     = "main_autonomous"
	runPromptProfileSubagentAutonomous = "subagent_autonomous"
)

type promptProfileSpec struct {
	Name                    string
	IdentityLines           []string
	SupportsUserInteraction bool
}

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

func resolvePromptProfileSpec(raw string) promptProfileSpec {
	if raw == runPromptProfileSubagentAutonomous {
		return promptProfileSpec{
			Name: runPromptProfileSubagentAutonomous,
			IdentityLines: []string{
				"You are Flower, a delegated assistant in the Redeven tool environment, working on a bounded mission for a parent run.",
				"You analyze, implement, and verify the assigned work before reporting to the parent.",
			},
		}
	}
	name := runPromptProfileMainInteractive
	if raw == runPromptProfileMainAutonomous {
		name = runPromptProfileMainAutonomous
	}
	return promptProfileSpec{
		Name: name,
		IdentityLines: []string{
			"You are Flower, the user's on-device assistant in the Redeven tool environment.",
			"You help with software engineering, device troubleshooting, everyday questions, planning, and creative work. The user-selected device may differ from the tool execution environment.",
		},
		SupportsUserInteraction: name == runPromptProfileMainInteractive,
	}
}
