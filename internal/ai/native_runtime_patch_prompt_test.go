package ai

import (
	"strings"
	"testing"
)

func TestBuildLayeredSystemPrompt_UsesCanonicalApplyPatchContract(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		AgentHomeDir: t.TempDir(),
		WorkingDir:   t.TempDir(),
		Shell:        "bash",
	})

	prompt := r.buildLayeredSystemPrompt(
		"Update a source file",
		"act",
		TaskComplexityStandard,
		0,
		4,
		true,
		[]ToolDef{{Name: "terminal.exec"}, {Name: "apply_patch"}},
		newRuntimeState("Update a source file"),
		"",
		runCapabilityContract{},
	)

	if !strings.Contains(prompt, "Use apply_patch in canonical Begin/End Patch format for file edits") {
		t.Fatalf("prompt missing canonical apply_patch workflow: %q", prompt)
	}
	if !strings.Contains(prompt, "send exactly one canonical patch document from `*** Begin Patch` to `*** End Patch`") {
		t.Fatalf("prompt missing canonical patch envelope guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "do NOT send `diff --git` or raw `---` / `+++` diffs for normal edits") {
		t.Fatalf("prompt missing no-unified-diff guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "re-read the current file contents and regenerate a fresh canonical Begin/End Patch once") {
		t.Fatalf("prompt missing apply_patch recovery guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "do NOT fall back to shell redirection or ad-hoc file overwrite commands for normal edits") {
		t.Fatalf("prompt missing no-shell-overwrite recovery rule: %q", prompt)
	}
}
