package ai

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPatchDiagnosticsExplainRejectedContextWithoutEffects(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, before, body, reason, remedy string
		chunk, sourceLine, searchLine      int
	}{
		{"out_of_order", "early\nlate\nmiddle\nlate\n", "@@\n-late\n+LATE\n@@\n-early\n+EARLY", "out_of_order", "original file order", 2, 1, 3},
		{"overlapping_context", "a\nb\nc\nd\n", "@@\n a\n-b\n+B\n c\n@@\n c\n-d\n+D", "overlapping_context", "one chunk", 2, 3, 4},
		{"earlier_anchor", "section:\na\nb\n", "@@\n-b\n+B\n@@ section:\n-a\n+A", "out_of_order", "original file order", 2, 1, 4},
		{"before_anchor", "early\nsection:\nlate\n", "@@ section:\n-early\n+EARLY", "before_anchor", "anchor", 1, 1, 3},
		{"stale_content", "value=0.35\n", "@@\n-value=0.55\n+value=0.08", "context_not_found", "current file", 1, 0, 1},
		{"missing_anchor", "a\nb\n", "@@ missing:\n-a\n+A", "context_not_found", "current file", 1, 0, 1},
		{"not_at_eof", "a\nb\n", "@@\n-a\n+A\n*** End of File", "eof_context_mismatch", "End of File", 1, 1, 2},
		{"eof_overlap", "a\nb\nc\n", "@@\n a\n-b\n+B\n@@\n b\n-c\n+C\n*** End of File", "overlapping_context", "one chunk", 2, 2, 3},
		{"repeated_earlier_text", "a\na\nb\n", "@@\n-b\n+B\n@@\n-a\n+A", "context_before_cursor", "unique context", 2, 1, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "f.txt")
			if err := os.WriteFile(path, []byte(tc.before), 0600); err != nil {
				t.Fatal(err)
			}
			patch := "*** Begin Patch\n*** Add File: first.txt\n+first\n*** Update File: f.txt\n" + tc.body + "\n*** End Patch"
			_, err := applyUnifiedDiff(dir, patch)
			var failure *patchApplyError
			if !errors.As(err, &failure) {
				t.Fatalf("expected validation failure, got %v", err)
			}
			result := patchToolError(failure)
			for key, want := range map[string]any{"effect": "none", "reason": tc.reason, "chunk": tc.chunk, "search_from_line": tc.searchLine} {
				if result.Meta[key] != want {
					t.Errorf("%s=%v, want %v; error=%v", key, result.Meta[key], want, err)
				}
			}
			if tc.sourceLine > 0 && result.Meta["source_line"] != tc.sourceLine {
				t.Errorf("source_line=%v, want %d", result.Meta["source_line"], tc.sourceLine)
			}
			if tc.sourceLine == 0 {
				if _, ok := result.Meta["source_line"]; ok {
					t.Error("invented a source location for missing text")
				}
			}
			if !strings.Contains(result.Message, "f.txt") || !strings.Contains(result.Message, "patch body line") || !strings.Contains(strings.Join(result.SuggestedFixes, " "), tc.remedy) {
				t.Errorf("incomplete diagnosis: %+v", result)
			}
			got, err := os.ReadFile(path)
			if err != nil || string(got) != tc.before {
				t.Fatalf("file changed: %q, %v", got, err)
			}
			if _, err := os.Stat(filepath.Join(dir, "first.txt")); !os.IsNotExist(err) {
				t.Fatalf("validation produced effects: %v", err)
			}
		})
	}
}

func TestPatchDiagnosticsExplainAmbiguousReorderingWithoutEffects(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, before, body, ambiguity, remedy string
		chunk, sourceLine, searchLine         int
	}{
		{
			"first_chunk", "early\nlate\nlate\n",
			"@@\n-late\n+LATE\n@@\n-early\n+EARLY",
			"automatic reordering is unsafe: chunk 1 has multiple exact matches",
			"add unique context to chunk 1", 2, 1, 3,
		},
		{
			"repeated_chunks_with_different_edits",
			"header\nvisible\nidle\nvisible\nidle\nstart\nvisible\nidle\n",
			"@@\n-header\n+HEADER\n@@\n-visible\n+hidden\n idle\n@@\n-visible\n+hidden\n idle\n@@\n-visible\n+ready\n idle\n@@\n-start\n+START",
			"automatic reordering is unsafe: chunk 2 has multiple exact matches",
			"add unique context to chunk 2", 5, 6, 9,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "f.txt")
			if err := os.WriteFile(path, []byte(tc.before), 0600); err != nil {
				t.Fatal(err)
			}
			patch := "*** Begin Patch\n*** Add File: first.txt\n+first\n*** Update File: f.txt\n" + tc.body + "\n*** End Patch"
			_, err := applyUnifiedDiff(dir, patch)
			var failure *patchApplyError
			if !errors.As(err, &failure) {
				t.Fatalf("expected validation failure, got %v", err)
			}
			result := patchToolError(failure)
			if result.Code != "PATCH_VALIDATION_FAILED" || result.Retryable {
				t.Fatalf("unexpected error classification: %+v", result)
			}
			for key, want := range map[string]any{
				"effect": "none", "reason": "out_of_order", "chunk": tc.chunk,
				"source_line": tc.sourceLine, "search_from_line": tc.searchLine,
			} {
				if result.Meta[key] != want {
					t.Errorf("%s=%v, want %v", key, result.Meta[key], want)
				}
			}
			if !strings.Contains(result.Message, tc.ambiguity) || !strings.Contains(strings.Join(result.SuggestedFixes, " "), tc.remedy) {
				t.Errorf("missing ambiguity and repair instruction: %+v", result)
			}
			got, err := os.ReadFile(path)
			if err != nil || string(got) != tc.before {
				t.Fatalf("rejected patch changed file: %q, %v", got, err)
			}
			if _, err := os.Stat(filepath.Join(dir, "first.txt")); !os.IsNotExist(err) {
				t.Fatalf("rejected patch created file: %v", err)
			}
		})
	}
}

func TestPatchDuplicateFileDiagnosticUsesCanonicalPath(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	if err := os.WriteFile(path, []byte("a\nb\n"), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Update File: f.txt\n@@\n-a\n+A\n*** Update File: " + path + "\n@@\n-b\n+B\n*** End Patch"
	_, err := applyUnifiedDiff(dir, patch)
	var failure *patchApplyError
	if !errors.As(err, &failure) {
		t.Fatalf("expected validation failure: %v", err)
	}
	result := patchToolError(failure)
	if result.Meta["reason"] != "duplicate_file_operation" || result.Meta["effect"] != "none" || !strings.Contains(strings.Join(result.SuggestedFixes, " "), "one *** Update File:") {
		t.Fatalf("diagnostic=%+v", result)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "a\nb\n" {
		t.Fatalf("duplicate operations changed file: %q, %v", got, err)
	}
}

func TestPatchDuplicateOperationPrecedesDependentContentValidation(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	path := filepath.Join(dir, "f.txt")
	if err := os.WriteFile(path, []byte("a\n"), 0600); err != nil {
		t.Fatal(err)
	}
	patch := "*** Begin Patch\n*** Update File: f.txt\n@@\n-a\n+A\n*** Update File: f.txt\n@@\n-A\n+B\n*** End Patch"
	_, err := applyUnifiedDiff(dir, patch)
	var failure *patchApplyError
	if !errors.As(err, &failure) || patchToolError(failure).Meta["reason"] != "duplicate_file_operation" {
		t.Fatalf("duplicate operation hidden by stale context: %v", err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != "a\n" {
		t.Fatalf("duplicate operations changed file: %q, %v", got, err)
	}
}
