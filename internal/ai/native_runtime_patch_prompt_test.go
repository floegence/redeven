package ai

import "testing"

func TestPatchFormatRemainsInToolDefinition(t *testing.T) {
	t.Parallel()
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
}
