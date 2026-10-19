package ai

import "testing"

func TestBuildLayeredSystemPrompt_DocumentsCanonicalPatchUsage(t *testing.T) {
	t.Parallel()
	prompt := buildPromptForToolRoutingTest(t)
	assertPromptContains(t, prompt, "emit file_path before old_string, new_string or content")
	for _, contract := range []string{"Prefer apply_patch for patch-shaped edits", "After rejection reread and regenerate", "inspect partial changes", "Do not fall back to shell overwrites", "another authorized worktree use absolute-path file tools"} {
		assertPromptContains(t, prompt, contract)
	}
	// Format belongs to the tool contract, not a second system tutorial.
	found := false
	for _, def := range builtInToolDefinitions() {
		if def.Name == "apply_patch" {
			found = true
			for _, contract := range []string{"*** Begin Patch", "*** End Patch", "*** Add File:", "*** Update File:", "*** Move to:", "every content line must start with"} {
				assertPromptContains(t, def.Description, contract)
			}
		}
	}
	if !found {
		t.Fatal("patch definition missing")
	}
	assertPromptNotContains(t, prompt, "*** Add File:")
}
