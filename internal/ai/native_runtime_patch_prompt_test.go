package ai

import "testing"

func TestBuildLayeredSystemPrompt_DocumentsCanonicalPatchUsage(t *testing.T) {
	t.Parallel()
	prompt := buildPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "Generate arguments in schema order for target-first activity previews")
	for _, contract := range []string{"Prefer apply_patch within its working directory", "After rejection reread and regenerate", "After partial execution, inspect completed actions", "Do not fall back to shell overwrites", "another authorized worktree use absolute-path file tools"} {
		assertPromptContains(t, prompt, contract)
	}
	// Format belongs to the tool contract, not a second system tutorial.
	found := false
	for _, def := range builtInToolDefinitions() {
		if def.Name == "apply_patch" {
			found = true
			for _, contract := range []string{"*** Begin Patch", "*** End Patch", "*** Add File:", "*** Update File:", "*** Move to:", "Prefix added lines with +"} {
				assertPromptContains(t, string(def.InputSchema), contract)
			}
		}
	}
	if !found {
		t.Fatal("patch definition missing")
	}
	assertPromptNotContains(t, prompt, "*** Add File:")
}
