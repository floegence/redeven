package ai

import (
	"strings"
	"testing"
)

func TestBuildLayeredSystemPrompt_DocumentsCanonicalPatchUsage(t *testing.T) {
	t.Parallel()

	prompt := buildPromptForToolRoutingTest(t)

	if !strings.Contains(prompt, "Prefer apply_patch for patch-shaped edits inside the run working directory") {
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
	if !strings.Contains(prompt, "re-read the current file contents and regenerate a fresh canonical patch") {
		t.Fatalf("prompt missing apply_patch recovery guidance: %q", prompt)
	}
	if !strings.Contains(prompt, "do NOT fall back to shell redirection or ad-hoc file overwrite commands for normal edits") {
		t.Fatalf("prompt missing no-shell-overwrite recovery rule: %q", prompt)
	}
}
