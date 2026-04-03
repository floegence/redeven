package ai

import (
	"strings"
	"testing"
)

func TestBuildLayeredSystemPrompt_PrefersStructuredFileOpsButKeepsApplyPatchCompatibility(t *testing.T) {
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
		[]ToolDef{{Name: "terminal.exec"}, {Name: "file.read"}, {Name: "file.edit"}, {Name: "file.write"}, {Name: "apply_patch"}},
		newRuntimeState("Update a source file"),
		"",
		runCapabilityContract{ProtocolProfile: defaultStructuredProtocolProfile()},
	)

	if !strings.Contains(prompt, "`apply_patch` remains available as a compatibility fallback") {
		t.Fatalf("prompt should still keep apply_patch compatibility guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "Primary file tools: `file.read`, `file.edit`, and `file.write`.") {
		t.Fatalf("prompt missing structured file tool guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "Use file.read for focused inspection, file.edit for exact replacements, file.write for full-file writes") {
		t.Fatalf("prompt missing structured workflow guidance: %q", prompt)
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
