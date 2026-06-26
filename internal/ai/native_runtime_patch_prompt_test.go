package ai

import (
	"strings"
	"testing"
)

func TestBuildLayeredSystemPrompt_DocumentsCanonicalPatchUsage(t *testing.T) {
	t.Parallel()

	r := newRun(runOptions{
		AgentHomeDir: t.TempDir(),
		WorkingDir:   t.TempDir(),
		Shell:        "bash",
	})

	prompt := r.buildLayeredSystemPrompt(
		"Update a source file",
		permissionTypeString(FlowerPermissionApprovalRequired),
		TaskComplexityStandard,
		0,
		true,
		[]ToolDef{{Name: "terminal.exec"}, {Name: "file.read"}, {Name: "file.edit"}, {Name: "file.write"}, {Name: "apply_patch"}},
		newRuntimeState("Update a source file"),
		"",
		runCapabilityContract{},
	)

	if !strings.Contains(prompt, "Use the available file tools for file inspection and mutation, apply_patch for patch-shaped edits") {
		t.Fatalf("prompt missing file mutation workflow guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "send exactly one canonical patch document from `*** Begin Patch` to `*** End Patch`") {
		t.Fatalf("prompt missing canonical patch envelope guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "do NOT send `diff --git` or raw `---` / `+++` diffs for normal edits") {
		t.Fatalf("prompt missing no-unified-diff guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "prefix every new content line with `+`") {
		t.Fatalf("prompt missing add-file content-line prefix guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "re-read the current file contents and regenerate a fresh canonical Begin/End Patch once") {
		t.Fatalf("prompt missing apply_patch recovery guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "do NOT fall back to shell redirection or ad-hoc file overwrite commands for normal edits") {
		t.Fatalf("prompt missing no-shell-overwrite recovery rule: %q", prompt)
	}
}
